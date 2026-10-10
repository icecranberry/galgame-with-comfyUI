/**
 * 特殊日程朋友圈队列
 *
 * 被手动编辑 / 聊天约定改写的日程条目（edited 标记，specialMomentStatus='pending'）
 * 在日程时间点到来时发一条特殊朋友圈：不走动机库，只突出这个日程，画面里带上「我」。
 *
 * - 每 5 分钟扫描一次所有角色的当日快照
 * - 启动时立即扫一遍：已过时段的直接标记 expired（过时不候），正在时段内的马上发送
 * - 生成函数由路由层注入（setSpecialScheduleMomentGenerator），避免 service → route 反向依赖
 */

import { getDb } from '../db/index.js';
import { getLocalDateKey } from '../utils/localDate.js';
import { updateSpecialMomentStatus, ensurePendingScheduleChanges } from './scheduleEditor.js';

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 分钟

let specialMomentGenerator = null;
export function setSpecialScheduleMomentGenerator(fn) {
  specialMomentGenerator = fn;
}

function toMin(hhmm) {
  if (!/^\d{1,2}:\d{2}$/.test(String(hhmm || ''))) return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function saveScheduleJson(characterId, schedule) {
  getDb().prepare(
    'UPDATE daily_schedules SET schedule_json = ? WHERE character_id = ? AND schedule_date = ?'
  ).run(JSON.stringify(schedule), characterId, getLocalDateKey());
}

/**
 * 扫描今日所有角色的特殊日程：
 * - 时段内且 pending → 标记 generating 并返回待生成列表
 * - 已过时段且 pending → 标记 expired（过时不候）
 */
export function collectDueSpecialMoments(now = new Date()) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT d.character_id, d.schedule_json, c.display_name, c.moments_disabled
    FROM daily_schedules d
    JOIN characters c ON c.id = d.character_id
    WHERE d.schedule_date = ?
      AND (c.schedule_enabled = 1 OR c.schedule_enabled IS NULL)
  `).all(getLocalDateKey(now));

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const due = [];

  for (const row of rows) {
    if (row.moments_disabled) continue;
    let schedule;
    try { schedule = JSON.parse(row.schedule_json); } catch { continue; }
    if (!Array.isArray(schedule)) continue;

    let changed = false;
    for (const act of schedule) {
      if (!act || !act.edited) continue;
      if (act.specialMomentStatus && act.specialMomentStatus !== 'pending') continue;
      const startMin = toMin(act.startTime);
      const endMin = toMin(act.endTime);
      if (startMin === null || endMin === null || endMin <= startMin) continue; // 跨午夜条目不进队列

      if (nowMin >= startMin && nowMin < endMin) {
        act.specialMomentStatus = 'generating';
        changed = true;
        due.push({
          characterId: row.character_id,
          displayName: row.display_name,
          activity: act,
        });
      } else if (nowMin >= endMin) {
        act.specialMomentStatus = 'expired';
        changed = true;
        console.log(`[specialMoment] Expired (skipped) for ${row.display_name}: ${act.startTime}-${act.endTime} ${act.activity}`);
      }
    }
    if (changed) saveScheduleJson(row.character_id, schedule);
  }

  return due;
}

let processing = false;

/** 扫描并逐条生成特殊朋友圈；生成失败回退 pending，窗口内下轮重试，出窗后自动判过期 */
export async function processSpecialMoments() {
  if (processing) return;
  processing = true;
  try {
    // 先应用到期（含跨天）的待应用约定：明天/后天的约定到今天零点后 5 分钟内合并进当日日程
    try {
      ensurePendingScheduleChanges();
    } catch (err) {
      console.error('[specialMoment] pending schedule changes error:', err.message);
    }
    if (!specialMomentGenerator) return;
    const due = collectDueSpecialMoments();
    for (const item of due) {
      try {
        console.log(`[specialMoment] Generating special moment for ${item.displayName}: ${item.activity.startTime}-${item.activity.endTime} ${item.activity.activity}`);
        await specialMomentGenerator(item);
        updateSpecialMomentStatus(item.characterId, item.activity.startTime, 'sent');
      } catch (err) {
        console.error(`[specialMoment] Failed for ${item.displayName}:`, err.message);
        updateSpecialMomentStatus(item.characterId, item.activity.startTime, 'pending');
      }
    }
  } finally {
    processing = false;
  }
}

let timer = null;

export function startSpecialMomentScheduler() {
  if (timer) return;
  console.log('[specialMoment] Scheduler started (interval:', CHECK_INTERVAL / 60000, 'min)');
  // 启动即检查一次：项目启动时检查所有角色的日程，过时标记 expired，在窗口内的立即发送
  processSpecialMoments().catch(err => console.error('[specialMoment] startup check error:', err.message));
  timer = setInterval(() => {
    processSpecialMoments().catch(err => console.error('[specialMoment] tick error:', err.message));
  }, CHECK_INTERVAL);
  timer.unref?.();
}

export function stopSpecialMomentScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** 测试入口：单次执行扫描+生成 */
export const runSpecialMomentCheck = processSpecialMoments;
