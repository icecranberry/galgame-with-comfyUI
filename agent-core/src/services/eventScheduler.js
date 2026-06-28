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

import { getDb, getSystemRulesWithWorld } from '../db/index.js';
import { generateEvent, concludeEvent, getUrgencyLevel } from './eventGenerator.js';
import { broadcastEventUrgency } from './eventNotificationBus.js';
import { config } from '../config.js';

const BASE_INTERVAL_MIN = 10; // 基准间隔 10 分钟（freq=1）

function getCheckIntervalMs() {
  const freq = config.features.eventFreq ?? 1;
  if (freq <= 0) return Infinity; // 禁用
  // freq=1 → 10min, freq=0.5 → 20min, freq=0.1 → 100min
  const intervalMin = Math.round(BASE_INTERVAL_MIN / freq);
  return intervalMin * 60 * 1000;
}

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

  // 频率控制：eventFreq=0 时关闭自动触发
  const freq = config.features.eventFreq ?? 1;
  if (freq <= 0) {
    console.log('[eventScheduler] eventFreq=0, auto-generation disabled. Skipping tick.');
    return;
  }

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
      console.log(`[eventScheduler] Half-time notification for "${event.title}" (${event.display_name}), engaged=${event.engaged}`);
      try {
        db.prepare(`UPDATE character_events SET half_time_notified = 1 WHERE id = ?`).run(event.id);

        // 根据 urgency 生成不同语气的主动消息
        const isUrgent = event.event_type_key ? getUrgencyLevel(event.event_type_key) : 1;
        const userName = config.user?.nickname || '用户';
        const urgencyNote = isUrgent >= 2
          ? `语气要紧急、需要帮助——像在求助或呼救，推动${userName}尽快回应`
          : `语气轻松自然——像在分享正在发生的事，随手告诉${userName}`;

        const greetingPrompt = `你正在经历一场奇遇事件，现在时间已经过半，但${userName}还没有注意到这件事。

奇遇标题：${event.title}
当前场景：${event.description}
${urgencyNote}

请以${event.display_name}的身份，用第一人称给${userName}发一条主动消息（15-50字），根据事情的紧急程度自然表达——紧急事件呼救求援，日常事件随手分享。`;

        // 构建用户信息 system 消息（含用户-角色关系）
        const userInfoParts = [`对方是${userName}`];
        if (config.user?.gender) userInfoParts.push(config.user.gender);
        if (config.user?.appearance) userInfoParts.push(config.user.appearance);
        if (config.user?.persona) userInfoParts.push(config.user.persona);
        const userRel = db.prepare(
          `SELECT relationship_text FROM user_relationships WHERE character_id = ?`
        ).pluck().get(event.character_id);
        if (userRel) userInfoParts.push(`你对于${userName}而言的身份是${userRel}`);
        const userInfoMsg = `你正在和${userName}聊天，以下是${userName}的相关信息：\n${userInfoParts.filter(Boolean).join('，')}`;

        // 生成主动消息内容
        const { chatSync } = await import('../llm/llm-client.js');
        const jailbreak = getSystemRulesWithWorld({ roleplay: true });
        const greeting = await chatSync([
          { role: 'system', content: jailbreak },
          { role: 'system', content: event.base_prompt },
          { role: 'system', content: userInfoMsg },
          { role: 'user', content: greetingPrompt },
        ], { temperature: 0.8, max_tokens: 128, label: '奇遇紧急联络' });

        // 插入主动聊天消息（和 proactiveChatScheduler 一样的逻辑）
        const conversationId = `char_${event.character_id}`;
        db.prepare(`INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, 'assistant', ?)`).run(conversationId, greeting);
        db.prepare(`INSERT INTO messages (conversation_id, role, content, seq, is_proactive) VALUES (?, 'assistant', ?, 0, 1)`).run(conversationId, greeting);
        db.prepare(`UPDATE characters SET proactive_streak = COALESCE(proactive_streak, 0) + 1, last_message_at = datetime('now') WHERE id = ?`).run(event.character_id);

        broadcastEventUrgency({
          character_id: event.character_id,
          character_name: event.display_name,
          event_id: event.id,
          event_title: event.title,
          event_description: event.description,
          expires_at: event.expires_at,
        });
        console.log(`[eventScheduler] Urgency proactive message sent for ${event.display_name}: "${greeting.slice(0, 50)}..."`);
      } catch (err) {
        console.error(`[eventScheduler] Half-time notification error:`, err.message);
      }
    }

    // ── 3. 新事件生成 ──
    // 全局上限：活跃事件最多 4 个（用户强制触发不受此限，走路由直接调用 generateEvent）
    const activeCount = db.prepare(
      `SELECT COUNT(*) AS count FROM character_events WHERE status IN ('pending','open','engaged')`
    ).get();
    if (activeCount.count >= 4) {
      console.log(`[eventScheduler] Active event count is ${activeCount.count}, max 4 reached. Skipping auto-generation.`);
      return;
    }

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

    // 清理卡住的 processing 标记（>5 分钟未完成）
    const stuckProc = db.prepare(`
      UPDATE character_events SET processing = 0
      WHERE processing = 1
        AND last_interaction_at < datetime('now', '-5 minutes')
    `).run();
    if (stuckProc.changes > 0) {
      console.log(`[eventScheduler] Reset ${stuckProc.changes} stuck processing flag(s)`);
    }
  } catch (err) {
    console.error('[eventScheduler] cleanup error:', err.message);
  }
}

export function startEventScheduler() {
  const intervalMs = getCheckIntervalMs();
  if (intervalMs === Infinity) {
    console.log('[eventScheduler] eventFreq=0, scheduler disabled');
    return;
  }
  console.log('[eventScheduler] Starting (interval:', (intervalMs / 60000).toFixed(1), 'min, freq:', config.features.eventFreq ?? 1, ')');

  // 启动时立即清理僵尸事件
  cleanupStuckEvents();

  // 启动后先等 30 秒再首次检查
  setTimeout(() => {
    tick();
    timer = setInterval(tick, intervalMs);
  }, 30_000);
}

export function stopEventScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[eventScheduler] Stopped');
  }
}

/** 重启调度器（频率变更后调用，使用新的间隔） */
export function restartEventScheduler() {
  stopEventScheduler();
  startEventScheduler();
}
