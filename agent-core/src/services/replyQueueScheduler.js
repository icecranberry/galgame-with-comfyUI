/**
 * 回复队列调度器
 *
 * 每 5 分钟扫描一次，处理两件事：
 *   1. 日程分散刷新：检查是否有角色 next_schedule_refresh_at 到期，每次只刷 1 个
 *   2. 回复队列处理：取出到期 waiting 条目，同一角色所有 waiting 消息合并为一条回复
 *
 * 合并逻辑对所有延迟类型通用（exam/shopping/sleeping 等），不仅限于睡觉。
 * sleeping 唯一特殊之处：回复后更新 is_sleeping=0，恢复朋友圈/奇遇系统。
 */

import { getDb, getSystemRules, getWorldSetting } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';
import { getCurrentActivity, syncSleepingState } from './scheduleManager.js';
import { getTimeLight } from './timeLight.js';
import { generateSchedule, assignNextRefreshTime, snapshotTodaySchedule } from './scheduleGenerator.js';
import { splitText } from '../utils/sentenceSplitter.js';
import {
  loadEmotionState, getCompositeEmotion,
  stateToPrompt, affinityToPrompt, loadAffinity,
} from './emotionEngine.js';
import { broadcast } from './unifiedStreamBus.js';

const CHECK_INTERVAL = 1 * 60 * 1000; // 1 分钟

let timer = null;
let processing = false;

// ── 公开 API ──

export function startReplyQueueScheduler() {
  if (timer) return;
  console.log('[replyQueue] Scheduler started (interval: 1min)');

  // 首次延迟 10 秒启动（等待 DB 就绪）
  timer = setTimeout(() => {
    tick();
    timer = setInterval(tick, CHECK_INTERVAL);
    timer.unref?.();
  }, 10_000);
}

export function stopReplyQueueScheduler() {
  if (timer) {
    clearInterval(timer);
    clearTimeout(timer);
    timer = null;
    console.log('[replyQueue] Scheduler stopped');
  }
}

// ── 主 tick ──

async function tick() {
  if (processing) return;
  processing = true;

  try {
    // 1. 日程分散刷新（每次 tick 最多 1 个角色）
    await maybeRefreshOneSchedule();

    // 2. 回复队列处理（每次 tick 最多 1 个角色）
    await processReplyQueue();
  } catch (err) {
    console.error('[replyQueue] tick error:', err.message);
  } finally {
    processing = false;
  }
}

// ── 日程刷新 ──

async function maybeRefreshOneSchedule() {
  const db = getDb();
  const candidate = db.prepare(`
    SELECT id, display_name, base_prompt FROM characters
    WHERE schedule_enabled = 1
      AND next_schedule_refresh_at IS NOT NULL
      AND next_schedule_refresh_at <= datetime('now')
    ORDER BY next_schedule_refresh_at ASC
    LIMIT 1
  `).get();

  if (!candidate) return;

  console.log(`[replyQueue] Refreshing schedule for ${candidate.display_name}...`);
  try {
    await generateSchedule(candidate);
    snapshotTodaySchedule(candidate.id);
    syncSleepingState(candidate.id);
    assignNextRefreshTime(candidate.id);
    console.log(`[replyQueue] Schedule refreshed for ${candidate.display_name}`);
  } catch (err) {
    console.error(`[replyQueue] Schedule refresh failed for ${candidate.display_name}:`, err.message);
    // 失败也重置刷新时间（1 小时后重试）
    const retryAt = new Date(Date.now() + 3600_000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
    db.prepare('UPDATE characters SET next_schedule_refresh_at = ? WHERE id = ?').run(retryAt, candidate.id);
  }
}

// ── 回复队列处理 ──

async function processReplyQueue() {
  const db = getDb();

  // 取最早到期的一个角色（只取第一条来确定角色，然后拉该角色所有 waiting）
  const entry = db.prepare(`
    SELECT rq.*, c.display_name, c.base_prompt, c.emotion_baseline
    FROM reply_queue rq
    JOIN characters c ON c.id = rq.character_id
    WHERE rq.status = 'waiting'
      AND rq.scheduled_reply_at <= datetime('now')
    ORDER BY rq.scheduled_reply_at ASC
    LIMIT 1
  `).get();

  if (!entry) return;

  // 拉取该角色所有 waiting 消息
  const allPending = db.prepare(`
    SELECT * FROM reply_queue
    WHERE character_id = ? AND status = 'waiting'
    ORDER BY created_at ASC
  `).all(entry.character_id);

  if (allPending.length === 0) return;

  const ids = allPending.map(e => e.id);

  // 全部标记 processing
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE reply_queue SET status = 'processing' WHERE id IN (${placeholders})`).run(...ids);

  const isSleepWakeup = entry.delay_minutes === -1;

  console.log(`[replyQueue] Processing ${allPending.length} queued message(s) for ${entry.display_name}${isSleepWakeup ? ' (sleep wakeup)' : ''}`);

  try {
    const conversationId = entry.conversation_id;
    const characterId = entry.character_id;

    // 构建 LLM 上下文（模拟 chat.js 的关键消息层）
    const msgs = buildDelayedReplyContext(entry, allPending, isSleepWakeup);

    // 调用 LLM 生成回复
    const fullReply = await chatSync(msgs, {
      temperature: 0.72,
      max_tokens: 512,
      label: `delayed-reply:${entry.display_name}`,
    });

    if (!fullReply || fullReply.trim().length === 0) {
      throw new Error('Empty reply from LLM');
    }

    // 分句
    const segments = splitText(fullReply);

    // 写入 raw_messages
    const rawResult = db.prepare(`
      INSERT INTO raw_messages (conversation_id, role, content)
      VALUES (?, 'assistant', ?)
    `).run(conversationId, fullReply);

    // 写入 messages（分句展示）
    const msgIds = [];
    for (let i = 0; i < segments.length; i++) {
      const seq = i; // 使用递增序号
      const msgResult = db.prepare(`
        INSERT INTO messages (conversation_id, raw_id, role, content, seq)
        VALUES (?, ?, 'assistant', ?, ?)
      `).run(conversationId, rawResult.lastInsertRowid, segments[i], seq);
      msgIds.push(msgResult.lastInsertRowid);
    }

    db.prepare(`DELETE FROM reply_queue WHERE id IN (${placeholders})`).run(...ids);

    // 睡觉醒来：更新角色状态，重置叫醒列
    if (isSleepWakeup) {
      db.prepare(`UPDATE characters SET is_sleeping = 0, sleep_until = NULL, wake_attempts = 0, was_door_woken = 0, temporary_wake_until = NULL, wake_mode = NULL WHERE id = ?`)
        .run(characterId);
      console.log(`[replyQueue] ${entry.display_name} woke up, sleep state cleared`);
    }

    // 清除所有 waiting 状态的其他消息（同一批次已合并处理）
    // 不需要——它们已经在 allPending 里并标记为 processing→done

    // 通过统一 SSE 推送到前端
    broadcast('delayed_reply', {
      character_id: characterId,
      display_name: entry.display_name,
      conversation_id: conversationId,
      messages: segments.map((content, i) => ({
        id: msgIds[i],
        role: 'assistant',
        content,
        seq: i,
      })),
      is_sleep_wakeup: isSleepWakeup,
      merged_count: allPending.length,
      created_at: new Date().toISOString(),
    });

    console.log(`[replyQueue] Reply sent for ${entry.display_name}: ${segments.length} bubble(s), ${allPending.length} message(s) merged`);
  } catch (err) {
    console.error(`[replyQueue] Failed for ${entry.display_name}:`, err.message);
    // 失败：第一条重置为 waiting，3 分钟后重试
    db.prepare("UPDATE reply_queue SET status = 'waiting', scheduled_reply_at = datetime('now', '+3 minutes') WHERE id = ?")
      .run(entry.id);
    // 其余条恢复 waiting（它们之前被标记 processing）
    const restIds = ids.filter(id => id !== entry.id);
    if (restIds.length > 0) {
      const restPlaceholders = restIds.map(() => '?').join(',');
      db.prepare(`UPDATE reply_queue SET status = 'waiting' WHERE id IN (${restPlaceholders})`).run(...restIds);
    }
  }
}

// ── LLM 上下文构建 ──

/**
 * 为延迟回复构建 LLM 上下文
 * 复用 chat.js 的关键消息层结构，但不走流式
 */
function buildDelayedReplyContext(entry, allPending, isSleepWakeup) {
  const db = getDb();
  const characterId = entry.character_id;
  const conversationId = entry.conversation_id;
  const chatUserName = config.user.nickname || '用户';

  const msgs = [];

  // msgs[0]: 舞台——破限词 + 世界观
  const jailbreak = getSystemRules();
  const worldSetting = getWorldSetting();
  const stageContent = [jailbreak, worldSetting].filter(Boolean).join('\n\n');
  if (stageContent) msgs.push({ role: 'system', content: stageContent });

  // msgs[1]: 角色人格 + 情绪
  const charParts = [];
  charParts.push(entry.base_prompt || '');

  // 加载情绪状态
  try {
    const emotionState = loadEmotionState(conversationId);
    if (emotionState) {
      const comp = getCompositeEmotion(emotionState);
      const vNorm = (comp.valence + 1) / 2;
      const aNorm = comp.arousal;
      const dNorm = (comp.dominance + 1) / 2;
      const moodV = (comp.mood_valence + 1) / 2;
      const moodA = comp.mood_arousal;
      const moodD = (comp.mood_dominance + 1) / 2;
      const affinity = loadAffinity(characterId);
      const affPrompt = affinityToPrompt(affinity);
      charParts.push(`[当前好感度: ${Math.round(affinity)}/100] ${affPrompt}`);
      charParts.push(`[当前情绪: V=${vNorm.toFixed(2)} A=${aNorm.toFixed(2)} D=${dNorm.toFixed(2)} | 底色: V=${moodV.toFixed(2)} A=${moodA.toFixed(2)} D=${moodD.toFixed(2)}]`);
    }
  } catch (err) {
    // 情绪加载失败非致命
  }
  msgs.push({ role: 'system', content: charParts.join('\n\n') });

  // msgs[2]: 交互关系
  const relParts = [];
  const userRel = db.prepare(
    'SELECT relationship_text, is_oath FROM user_relationships WHERE character_id = ?'
  ).get(characterId);
  if (userRel?.relationship_text) {
    relParts.push(`<user_relation>你对于user而言的身份是${userRel.relationship_text}。</user_relation>`);
  }
  if (userRel?.is_oath) {
    relParts.push(`<oath_bond>你们之间有一个比普通关系更深一层的约定——${chatUserName}曾经郑重地送过你一枚戒指。这代表了独一无二的羁绊和承诺。在对话中，你的行为和情感会自然地带有"你是我最重要的人"的底色——不是因为规则要求，而是因为这层羁绊已经是你内心的一部分。</oath_bond>`);
  }

  // 用户信息
  if (config.user.nickname || config.user.gender || config.user.appearance) {
    const infoParts = [];
    infoParts.push(`消息中标记为"user"的人是"${chatUserName}"`);
    if (config.user.gender) infoParts.push(`性别：${config.user.gender}`);
    if (config.user.appearance) infoParts.push(`外观特征：${config.user.appearance}`);
    relParts.push(`<user_info>${infoParts.join('。')}</user_info>`);
  }
  if (relParts.length > 0) {
    msgs.push({ role: 'system', content: relParts.join('\n') });
  }

  // ── 计算延迟时长 ──
  const now = new Date();
  const firstCreatedAt = entry.created_at
    ? new Date(entry.created_at.replace(' ', 'T'))
    : null;
  const delayMinutes = firstCreatedAt
    ? Math.round((now.getTime() - firstCreatedAt.getTime()) / 60000)
    : null;
  let delayStr = '';
  if (delayMinutes !== null) {
    if (delayMinutes < 1) delayStr = '不到1分钟前';
    else if (delayMinutes < 60) delayStr = `${delayMinutes} 分钟前`;
    else if (delayMinutes < 1440) delayStr = `${Math.round(delayMinutes / 60)} 小时前`;
    else delayStr = `${Math.round(delayMinutes / 1440)} 天前`;
  }

  // 延迟说明（核心）
  const activity = entry.current_activity || '某件事';
  let delayNote;
  if (isSleepWakeup) {
    // 计算距预定起床时间过了多久（处理系统重启后延迟处理的情况）
    const scheduledAt = entry.scheduled_reply_at
      ? new Date(entry.scheduled_reply_at.replace(' ', 'T'))
      : null;
    const minutesSinceWakeup = scheduledAt
      ? (now.getTime() - scheduledAt.getTime()) / 60000
      : 0;

    if (minutesSinceWakeup > 30) {
      // 已经起床很久了（如系统在起床时间之后才启动），读取当前日程上下文
      let scheduleLine = '';
      const currentActivity = getCurrentActivity(characterId);
      if (currentActivity?.activity && currentActivity.activity !== '自由时间') {
        const { timeStr, timeDesc } = getTimeLight();
        scheduleLine = `\n【当前日程】${timeStr}（${timeDesc}），你正在【${currentActivity.location}】${currentActivity.activity}。`;
        if (currentActivity.description) scheduleLine += ` ${currentActivity.description}`;
      }

      delayNote = `[系统说明] 你之前睡觉时 user 在${delayStr}给你发了 ${allPending.length} 条消息。现在你已经起床了。${scheduleLine}`;
      if (allPending.length === 1) {
        delayNote += `\n你拿起手机看到 user 的消息。请用自然的语气回复 user——你现在已经完全清醒了，不必用刚睡醒的语气。`;
      } else {
        delayNote += `\n以下是 user 发的这些消息：`;
        for (let i = 0; i < allPending.length; i++) {
          delayNote += `\n[${i + 1}] ${allPending[i].user_content}`;
        }
        delayNote += `\n请用自然的语气综合回应，就像翻看聊天记录一样。不必用刚睡醒的语气——你已经完全清醒了。可以简单提一下刚才在做什么。`;
      }
    } else {
      // 刚起床（30 分钟内），用迷糊语气
      delayNote = `[系统说明] 你刚才在睡觉。user 在你睡觉时（${delayStr}）给你发了 ${allPending.length} 条消息。`;
      if (allPending.length === 1) {
        delayNote += `\n你刚睡醒，迷迷糊糊看到手机上有 user 的消息。请用刚睡醒的语气自然地回复 user。`;
      } else {
        delayNote += `\n你刚睡醒，迷迷糊糊看到手机上有 user 发的 ${allPending.length} 条消息。依次读完后，用刚睡醒的语气自然地综合回应。不要逐条引用，就像刚睡醒看手机一样一次性聊回去。`;
      }
    }
  } else if (allPending.length === 1) {
    delayNote = `[系统说明] user 在${delayStr}给你发了消息，当时你正在${activity}。因为忙所以没能马上回复。请回复 user，自然地解释一下刚才在做什么（忙了多久、为什么忙）。`;
  } else {
    delayNote = `[系统说明] user 从${delayStr}开始陆续给你发了 ${allPending.length} 条消息，当时你正在${activity}。因为忙所以没能马上回复。以下是这些消息：`;
    for (let i = 0; i < allPending.length; i++) {
      delayNote += `\n[${i + 1}] ${allPending[i].user_content}`;
    }
    delayNote += `\n请像刚看到手机一样，自然地把这几条消息综合回应一下。不要逐条引用格式回复，一次性自然地聊回去，并简单解释一下刚才在${activity}、忙了多久。`;
  }

  msgs.push({ role: 'system', content: delayNote });

  // 历史消息（最近的对话上下文）
  const history = db.prepare(`
    SELECT role, content FROM raw_messages
    WHERE conversation_id = ?
    ORDER BY id ASC
    LIMIT 30
  `).all(conversationId);

  // 检查是否需要加一条 user 消息作为触发
  // 取最后一条作为对话锚点
  if (history.length > 0) {
    msgs.push(...history);
  }

  return msgs;
}
