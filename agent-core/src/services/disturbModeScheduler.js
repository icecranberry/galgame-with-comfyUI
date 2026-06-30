/**
 * 防打扰模式调度器
 *
 * - 启动时延迟 5 秒执行首次检测（等待 DB 就绪）
 * - 之后每 10 分钟检测一次
 * - 在指定时间段内：将选中角色的 moments_disabled / proactive_disabled / events_disabled 全部置 1
 * - 在时间段外：恢复角色的原始开关状态
 * - 只处理 dnd_original_state IS NOT NULL 的角色（即之前被 DND 覆盖过的）
 *   或 dnd_original_state IS NULL 但在选中列表中的角色（即需要首次覆盖的）
 */

import { config } from '../config.js';
import { getDb } from '../db/index.js';

let timer = null;
let initialized = false;

/**
 * 判断当前时间是否在指定时间段内（24 小时制，支持跨午夜）
 */
function isInTimeRange(now, startTime, endTime) {
  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + (m || 0);
  };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = toMinutes(startTime);
  const endMin = toMinutes(endTime);

  if (startMin <= endMin) {
    // 同日时间段，如 08:00 ~ 22:00
    return nowMin >= startMin && nowMin < endMin;
  } else {
    // 跨午夜时间段，如 22:00 ~ 08:00
    return nowMin >= startMin || nowMin < endMin;
  }
}

/**
 * 应用防打扰覆盖：保存原始状态，将三个开关全部置 1
 * 同时恢复那些之前被 DND 覆盖但已移出选中列表的角色
 */
function applyDnd(db, characterIds) {
  // 先恢复已经不在选中列表中的角色
  if (characterIds && characterIds.length > 0) {
    const placeholders = characterIds.map(() => '?').join(',');
    const staleRestored = removeDndExcept(db, placeholders, characterIds);
    if (staleRestored > 0) {
      console.log(`[disturb] restored ${staleRestored} character(s) no longer in selection`);
    }
  } else {
    // 选中列表为空，恢复全部
    removeDnd(db);
    return;
  }

  const placeholders = characterIds.map(() => '?').join(',');
  // 找出需要覆盖的角色（dnd_original_state IS NULL，即未被覆盖过的）
  const toOverride = db.prepare(`
    SELECT id, moments_disabled, proactive_disabled, events_disabled
    FROM characters
    WHERE id IN (${placeholders})
      AND dnd_original_state IS NULL
  `).all(...characterIds);

  const saveStmt = db.prepare(`
    UPDATE characters
    SET dnd_original_state = ?,
        moments_disabled = 1,
        proactive_disabled = 1,
        events_disabled = 1
    WHERE id = ?
  `);

  let count = 0;
  for (const ch of toOverride) {
    const original = JSON.stringify({
      moments_disabled: ch.moments_disabled || 0,
      proactive_disabled: ch.proactive_disabled || 0,
      events_disabled: ch.events_disabled || 0,
    });
    saveStmt.run(original, ch.id);
    count++;
  }
  if (count > 0) {
    console.log(`[disturb] DND applied: ${count} character(s) overridden`);
  }
}

/**
 * 恢复被 DND 覆盖但不在一组 excludedIds 中的角色
 * 用于处理用户从选中列表移除角色的场景
 */
function removeDndExcept(db, placeholders, ids) {
  const overridden = db.prepare(`
    SELECT id, dnd_original_state FROM characters
    WHERE dnd_original_state IS NOT NULL
      AND id NOT IN (${placeholders})
  `).all(...ids);

  if (overridden.length === 0) return 0;

  const restoreStmt = db.prepare(`
    UPDATE characters
    SET moments_disabled = ?,
        proactive_disabled = ?,
        events_disabled = ?,
        dnd_original_state = NULL
    WHERE id = ?
  `);

  for (const ch of overridden) {
    try {
      const original = JSON.parse(ch.dnd_original_state);
      restoreStmt.run(
        original.moments_disabled ?? 0,
        original.proactive_disabled ?? 0,
        original.events_disabled ?? 0,
        ch.id
      );
    } catch (err) {
      console.error(`[disturb] failed to restore character ${ch.id}:`, err.message);
      db.prepare(`UPDATE characters SET dnd_original_state = NULL WHERE id = ?`).run(ch.id);
    }
  }
  return overridden.length;
}

/**
 * 移除防打扰覆盖：恢复原始状态，清除 dnd_original_state
 */
function removeDnd(db) {
  // 找出所有被 DND 覆盖的角色
  const overridden = db.prepare(`
    SELECT id, dnd_original_state FROM characters
    WHERE dnd_original_state IS NOT NULL
  `).all();

  if (overridden.length === 0) return;

  const restoreStmt = db.prepare(`
    UPDATE characters
    SET moments_disabled = ?,
        proactive_disabled = ?,
        events_disabled = ?,
        dnd_original_state = NULL
    WHERE id = ?
  `);

  let count = 0;
  for (const ch of overridden) {
    try {
      const original = JSON.parse(ch.dnd_original_state);
      restoreStmt.run(
        original.moments_disabled ?? 0,
        original.proactive_disabled ?? 0,
        original.events_disabled ?? 0,
        ch.id
      );
      count++;
    } catch (err) {
      console.error(`[disturb] failed to restore character ${ch.id}:`, err.message);
      // 解析失败时也清除标记，避免一直卡住
      db.prepare(`UPDATE characters SET dnd_original_state = NULL WHERE id = ?`).run(ch.id);
    }
  }
  if (count > 0) {
    console.log(`[disturb] DND removed: ${count} character(s) restored`);
  }
}

/**
 * 主检测逻辑
 */
function checkAndApply() {
  if (!config.features.disturbMode) {
    // 总开关关闭时，确保恢复所有被覆盖的角色
    try {
      const db = getDb();
      removeDnd(db);
    } catch (err) {
      console.error('[disturb] removeDnd error:', err.message);
    }
    return;
  }

  // 总开关开启，检查时间段
  try {
    const db = getDb();
    const now = new Date();
    const inRange = isInTimeRange(now, config.disturb.startTime, config.disturb.endTime);

    // 跳过周末：周六(6) / 周日(0)
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    const effectiveInRange = inRange && !(config.disturb.skipWeekends && isWeekend);

    const characterIds = config.disturb.characterIds || [];

    if (effectiveInRange) {
      applyDnd(db, characterIds);
    } else {
      removeDnd(db);
    }
  } catch (err) {
    console.error('[disturb] checkAndApply error:', err.message);
  }
}

/**
 * 启动防打扰调度器
 * - 延迟 5 秒首次检测（等待 DB + 其他服务初始化）
 * - 之后每 10 分钟检测一次
 */
export function startDisturbScheduler() {
  if (timer) return; // 防止重复启动

  // 首次检测：延迟 5 秒
  const initialTimer = setTimeout(() => {
    checkAndApply();
    initialized = true;
    console.log('[disturb] initial check completed, mode:', config.features.disturbMode ? 'ON' : 'OFF');

    // 之后每 10 分钟检测一次
    timer = setInterval(() => {
      checkAndApply();
    }, 10 * 60 * 1000);
    timer.unref(); // 不阻塞进程退出
  }, 5000);
  initialTimer.unref();

  console.log('[disturb] scheduler started (first check in 5s, then every 10min)');
}

/**
 * 强制立即执行一次检测（用于设置变更后即时生效）
 */
export function triggerDisturbCheck() {
  if (!initialized) return; // 还没完成首次初始化就等定时器
  checkAndApply();
}

/**
 * 停止调度器
 */
export function stopDisturbScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[disturb] scheduler stopped');
  }
}
