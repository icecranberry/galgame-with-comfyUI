import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { getSetting, setSetting } from '../db/settings.js';
import { getMomentIntervalMs } from './momentTiming.js';

const KEY = 'moment_interval_schedule';
const save = state => setSetting(KEY, JSON.stringify(state));
function read() {
  try { return JSON.parse(getSetting(KEY)); } catch { return null; }
}

/** 全局只保存一份排期，不改写任何角色的 next_moment_at。 */
export function resetMomentIntervalSchedule(now = Date.now()) {
  const intervalMs = getMomentIntervalMs(config.features);
  const state = intervalMs ? { revision: randomUUID(), intervalMs, nextAt: now + intervalMs, lastAuthor: null } : null;
  save(state);
  return state;
}

export function getMomentIntervalSchedule(now = Date.now()) {
  const intervalMs = getMomentIntervalMs(config.features);
  if (!intervalMs) return null;
  const state = read();
  if (state?.intervalMs === intervalMs && Number.isFinite(state.nextAt) && state.revision) return state;
  return resetMomentIntervalSchedule(now);
}

function pickAuthor(lastAuthor, generateCharacter) {
  const db = getDb();
  const authors = generateCharacter ? db.prepare(`
    SELECT c.* FROM characters c
    WHERE c.moments_disabled = 0
      AND (c.is_sleeping IS NULL OR c.is_sleeping = 0)
      AND (c.temporary_wake_until IS NULL OR c.temporary_wake_until <= datetime('now'))
      AND NOT EXISTS (SELECT 1 FROM character_events e
        WHERE e.character_id = c.id AND e.status IN ('pending','open','engaged'))
      AND NOT EXISTS (SELECT 1 FROM moment_posts p
        WHERE p.character_id = c.id AND p.status = 'generating'
          AND p.created_at >= datetime('now', '-10 minutes'))
  `).all().map(row => ({ row, key: `character:${row.id}`, generate: generateCharacter })) : [];

  // 有其他可发作者时不连续抽到同一人；仅一人可发时允许继续。
  const alternatives = authors.filter(author => author.key !== lastAuthor);
  const pool = alternatives.length ? alternatives : authors;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

/** 由主调度器持有互斥锁；仅角色（含报纸帖）共用名额，返回本轮是否尝试生成。 */
export async function runIntervalMomentTick({ generateCharacter, postComplaint }) {
  const now = Date.now();
  const state = getMomentIntervalSchedule(now);
  if (!state || state.nextAt > now) return false;

  // 先占用这一个名额。重启/长时间离线后只发一条，不追赶错过的次数。
  const reserved = { ...state, revision: randomUUID(), nextAt: now + state.intervalMs };
  save(reserved);
  let retry = false;
  try {
    const complaintAuthor = await postComplaint();
    if (complaintAuthor) {
      reserved.lastAuthor = `character:${complaintAuthor}`;
      return true;
    }
    const author = pickAuthor(state.lastAuthor, generateCharacter);
    if (!author) {
      console.log('[momentScheduler] Interval due, but no eligible author; retry in 30 seconds');
      reserved.nextAt = Date.now() + 30_000;
      return false;
    }
    console.log(`[momentScheduler] Interval due: generating one post for ${author.row.display_name}`);
    await author.generate(author.row);
    reserved.lastAuthor = author.key;
    return true;
  } catch (error) {
    retry = true;
    reserved.nextAt = Date.now() + Math.min(state.intervalMs, 60_000);
    console.error('[momentScheduler] Interval post failed, retry scheduled:', error.message);
    return true;
  } finally {
    // 生成期间用户可能改档；旧任务不得覆盖新的计时或重新启用已关闭的模式。
    if (read()?.revision === reserved.revision && getMomentIntervalMs(config.features) === state.intervalMs) {
      if (!retry && reserved.nextAt <= Date.now()) reserved.nextAt = Date.now() + state.intervalMs;
      save(reserved);
    }
  }
}
