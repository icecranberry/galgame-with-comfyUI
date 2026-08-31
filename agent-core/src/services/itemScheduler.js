/**
 * 道具系统调度器 — 低频清理线
 *
 * 每 10 分钟一次 tick（itemService.tickCleanup）：
 *   - 到期变身恢复原专属形态
 *   - 删除过期 buff / 限时服饰行
 *   - 超时未出图的 generating 道具标记 ready（前端走兜底图标）
 *     并补记宝箱冷却，避免生成卡死后可重复开箱
 *
 * 生命周期与 eventScheduler 同款：start/stop/restart，processing 锁防重入。
 */

import { tickCleanup } from './itemService.js';

const TICK_INTERVAL_MS = 10 * 60 * 1000;

let timer = null;
let processing = false;

function tick() {
  if (processing) return;
  processing = true;
  try {
    tickCleanup();
  } catch (err) {
    console.error('[itemScheduler] tick error:', err.message);
  } finally {
    processing = false;
  }
}

export function startItemScheduler() {
  if (timer) return;
  timer = setInterval(tick, TICK_INTERVAL_MS);
  console.log('[itemScheduler] started (every 10 min)');
}

export function stopItemScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  console.log('[itemScheduler] stopped');
}

export function restartItemScheduler() {
  stopItemScheduler();
  startItemScheduler();
}
