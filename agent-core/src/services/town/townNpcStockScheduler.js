/**
 * 小镇 NPC 货架调度器
 *
 * 有交易权限的居民每 3 天换一批货（1~5 件）。这里在后台周期性检测：
 *   - 货架为空 / 全部售罄 / 已过 3 天  自动换货并生成文案；
 *   - 图标没画完 / 画失败 / 进程中断  自动补画。
 * 玩家打开货摊时只读结果，不会再有「点开才生成」的等待。
 *
 * 生命周期与 itemScheduler 同款：start/stop，processing 锁防重入。
 */

import { getDb } from '../../db/index.js';
import { config } from '../../config.js';
import { rollNpcStock, stockNeedsRoll, ensureStockImages } from './townNpcStockService.js';
import { townCapabilities } from './townCapabilities.js';

const TICK_INTERVAL_MS = 3 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 25 * 1000;
// 单次 tick 最多换几家的货：每换一家要调一次 LLM，避免并发轰炸。
const MAX_ROLLS_PER_TICK = 3;
// 单次 tick 最多补画几张图。
const MAX_IMAGES_PER_TICK = 3;

let timer = null;
let startupTimer = null;
let processing = false;

export function tradeNpcsDue(db, worldId, now) {
  const npcs = db.prepare('SELECT * FROM town_npcs WHERE town_enabled = 1 ORDER BY id').all();
  return npcs.filter(npc => townCapabilities(npc).includes('trade') && stockNeedsRoll(db, worldId, npc.id, now));
}

async function tick() {
  if (processing || !config.features.town) return;
  processing = true;
  try {
    const db = getDb();
    const world = db.prepare('SELECT world_id FROM town_world_state WHERE singleton = 1').get();
    if (!world?.world_id) return;
    const now = Date.now();
    const due = tradeNpcsDue(db, world.world_id, now);
    for (const npc of due.slice(0, MAX_ROLLS_PER_TICK)) {
      try {
        const goods = await rollNpcStock({ worldId: world.world_id, npcId: npc.id, force: true });
        console.log(`[townStock] rolled ${goods.length} goods for ${npc.display_name}`);
      } catch (err) {
        console.error(`[townStock] roll failed for npc ${npc.id}:`, err?.message || err);
      }
    }
    // 补画没画完的图标（含换货后新生成的、以及上次进程中断留下的）。
    try {
      const painted = await ensureStockImages({ worldId: world.world_id, limit: MAX_IMAGES_PER_TICK, minAgeMs: 45_000 });
      if (painted) console.log(`[townStock] painted ${painted} goods icon(s)`);
    } catch (err) {
      console.error('[townStock] image catch-up failed:', err?.message || err);
    }
  } catch (err) {
    console.error('[townStock] tick error:', err?.message || err);
  } finally {
    processing = false;
  }
}

export function startTownNpcStockScheduler() {
  if (timer) return;
  startupTimer = setTimeout(() => { startupTimer = null; tick().catch(() => {}); }, FIRST_TICK_DELAY_MS);
  timer = setInterval(() => { tick().catch(() => {}); }, TICK_INTERVAL_MS);
  console.log('[townStock] scheduler started (every 3 min, shelf refresh 3 days)');
}

export function stopTownNpcStockScheduler() {
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  console.log('[townStock] scheduler stopped');
}

export function restartTownNpcStockScheduler() {
  stopTownNpcStockScheduler();
  startTownNpcStockScheduler();
}

/** 供测试 / 手动触发使用：跑一轮后台检测。 */
export async function runTownNpcStockTick() {
  await tick();
}
