/**
 * 奇遇事件调度器
 *
 * - 每 10 分钟扫描一次
 * - 到期检查：expires_at <= now → concludeEvent()
 * - 半程通知：已过半且未互动 → 生成主动消息紧急联络
 * - 新事件生成：随机选角色 + 随机选事件类型 → generateEvent()
 * - 事件结束后 4-12h 冷却
 * - processing 锁防并发
 */

import { getDb } from '../db/index.js';
import { generateEvent, concludeEvent } from './eventGenerator.js';
import { broadcastEventUrgency } from './eventNotificationBus.js';
import { config } from '../config.js';

const CHECK_INTERVAL = 10 * 60 * 1000; // 10 分钟

let timer = null;
let processing = false;

function toSQLiteDate(iso) {
  if (!iso) return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

async function tick() {
  if (processing) {
    console.log('[eventScheduler] Previous event still generating, skip this tick');
    return;
  }

  // 功能开关
  if (!config.features.events) return;

  const db = getDb();
  try {
    // ── 1. 到期检查 ──
    const expiredEvents = db.prepare(`
      SELECT ce.*, c.display_name, c.base_prompt
      FROM character_events ce
      JOIN characters c ON c.id = ce.character_id
      WHERE ce.expires_at <= datetime('now')
        AND ce.status IN ('open','engaged')
    `).all();

    for (const event of expiredEvents) {
      console.log(`[eventScheduler] Event expired: "${event.title}" for ${event.display_name} (engaged=${event.engaged})`);
      try {
        const character = { id: event.character_id, display_name: event.display_name, base_prompt: event.base_prompt };
        await concludeEvent(character, event, event.engaged ? 'completed' : 'expired');
      } catch (err) {
        console.error(`[eventScheduler] Conclude error for ${event.display_name}:`, err.message);
      }
    }

    // ── 2. 半程通知 ──
    // 对于 status='open' 且 half_time_notified=0 的事件，检查是否已经过半
    // 半程判断：expires_at - created_at = duration; now >= created_at + duration/2
    const halfTimeEvents = db.prepare(`
      SELECT ce.*, c.display_name, c.base_prompt
      FROM character_events ce
      JOIN characters c ON c.id = ce.character_id
      WHERE ce.status = 'open'
        AND ce.half_time_notified = 0
        AND ce.engaged = 0
        AND datetime(ce.created_at, '+' || ((julianday(ce.expires_at) - julianday(ce.created_at)) * 24 * 60 / 2) || ' minutes') <= datetime('now')
    `).all();

    for (const event of halfTimeEvents) {
      console.log(`[eventScheduler] Half-time notification for "${event.title}" (${event.display_name})`);
      try {
        // 标记已通知
        db.prepare(`UPDATE character_events SET half_time_notified = 1 WHERE id = ?`).run(event.id);

        // 广播紧急联络
        broadcastEventUrgency({
          character_id: event.character_id,
          character_name: event.display_name,
          event_id: event.id,
          event_title: event.title,
          event_description: event.description,
          expires_at: event.expires_at,
        });
      } catch (err) {
        console.error(`[eventScheduler] Half-time notification error:`, err.message);
      }
    }

    // ── 3. 新事件生成 ──
    // 检查是否有角色符合条件：无活跃事件 + events_disabled=0 + 冷却已过
    const candidate = db.prepare(`
      SELECT c.* FROM characters c
      WHERE c.events_disabled = 0
        AND c.id NOT IN (
          SELECT character_id FROM character_events WHERE status IN ('pending','open','engaged')
        )
        AND (
          -- 冷却检查：最后一个 event_history 记录的 ended_at 距现在超过冷却期
          NOT EXISTS (
            SELECT 1 FROM event_history eh
            WHERE eh.character_id = c.id
              AND eh.ended_at > datetime('now', '-4 hours')
          )
          OR
          -- 如果最近事件在 4-12h 之间，用随机判断
          (
            SELECT COUNT(*) FROM event_history eh
            WHERE eh.character_id = c.id
              AND eh.ended_at > datetime('now', '-12 hours')
          ) = 0
        )
      ORDER BY RANDOM() LIMIT 1
    `).get();

    if (!candidate) {
      // 没有可用角色
      const nextUp = db.prepare(`
        SELECT c.display_name, MIN(eh.ended_at) AS last_event
        FROM characters c
        LEFT JOIN event_history eh ON eh.character_id = c.id
        WHERE c.events_disabled = 0
        GROUP BY c.id
        HAVING last_event IS NOT NULL
        ORDER BY last_event ASC LIMIT 1
      `).get();
      if (nextUp) {
        console.log(`[eventScheduler] No available characters. Earliest cooldown ends: ${nextUp.display_name} (last event: ${nextUp.last_event})`);
      } else {
        console.log('[eventScheduler] No event history yet, but all characters have active events or are disabled');
      }
      return;
    }

    processing = true;
    console.log(`[eventScheduler] Generating event for ${candidate.display_name}...`);

    try {
      await generateEvent(candidate);
      console.log(`[eventScheduler] Done: ${candidate.display_name}`);
    } catch (err) {
      console.error(`[eventScheduler] Failed for ${candidate.display_name}:`, err.message);
      if (err.message === 'ALREADY_ACTIVE_EVENT') {
        // 已有活跃事件，跳过（可能被并发触发）
        console.log(`[eventScheduler] ${candidate.display_name} already has active event, skip`);
      }
    }
  } catch (err) {
    console.error('[eventScheduler] tick error:', err.message);
  } finally {
    processing = false;
  }
}

/**
 * 启动时清理僵尸 pending 事件（>10 分钟未完成）
 */
function cleanupStuckEvents() {
  const db = getDb();
  try {
    const stuck = db.prepare(`
      DELETE FROM character_events
      WHERE status = 'pending'
        AND created_at < datetime('now', '-10 minutes')
    `).run();
    if (stuck.changes > 0) {
      console.log(`[eventScheduler] Cleaned up ${stuck.changes} stuck pending event(s)`);
    }
  } catch (err) {
    console.error('[eventScheduler] cleanup error:', err.message);
  }
}

export function startEventScheduler() {
  console.log('[eventScheduler] Starting (interval:', CHECK_INTERVAL / 60000, 'min)');

  // 启动时立即清理僵尸事件
  cleanupStuckEvents();

  // 启动后先等 30 秒再首次检查
  setTimeout(() => {
    tick();
    timer = setInterval(tick, CHECK_INTERVAL);
  }, 30_000);
}

export function stopEventScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[eventScheduler] Stopped');
  }
}
