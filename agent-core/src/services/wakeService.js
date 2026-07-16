/**
 * 叫醒处理服务
 *
 * processWakeUp(characterId, mode, attempts) — 被电话/上门叫醒后的回复处理
 *   mode: 'phone' | 'door' | 'shake'
 *   attempts: 电话尝试次数（仅 phone 模式有效）
 */

import { getDb, getSystemRules, getWorldSetting } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';
import { splitText } from '../utils/sentenceSplitter.js';
import {
  loadEmotionState, getCompositeEmotion,
  affinityToPrompt, loadAffinity,
} from './emotionEngine.js';
import { broadcast } from './unifiedStreamBus.js';
import { scheduleTempWakeExpiry, getTempWakeUntil } from './scheduleManager.js';

/**
 * 处理叫醒：构建 LLM 上下文 → 生成回复 → 写入 DB → 广播 SSE
 */
export async function processWakeUp(characterId, mode, attempts = null) {
  const db = getDb();
  const char = db.prepare(`SELECT id, display_name, base_prompt FROM characters WHERE id = ?`).get(characterId);
  if (!char) throw new Error(`Character ${characterId} not found`);

  const conversationId = `char_${characterId}`;
  const userName = config.user.nickname || '用户';
  const tempWakeUntil = getTempWakeUntil(characterId);

  // ── 构建 LLM 上下文 ──
  const msgs = buildWakeContext(char, conversationId, userName, mode, attempts);

  // ── 检查 reply_queue 中的积压消息 ──
  const pendingEntries = db.prepare(`
    SELECT * FROM reply_queue
    WHERE character_id = ? AND status = 'waiting'
    ORDER BY created_at ASC
  `).all(characterId);

  const hasBacklog = pendingEntries.length > 0;

  // 历史已在 buildWakeContext 中以 role: "user" 格式注入，不重复追加 backlog
  // 积压消息在回复写入后统一标记 done

  // ── 调用 LLM 生成回复 ──
  const fullReply = await chatSync(msgs, {
    temperature: 0.75,
    max_tokens: 512,
    label: `wake-up:${char.display_name}:${mode}`,
  });

  if (!fullReply || fullReply.trim().length === 0) {
    throw new Error('Empty reply from LLM');
  }

  // ── 分句 → 写入 raw_messages + messages ──
  const segments = splitText(fullReply);

  const rawResult = db.prepare(`
    INSERT INTO raw_messages (conversation_id, role, content)
    VALUES (?, 'assistant', ?)
  `).run(conversationId, fullReply);

  const msgIds = [];
  for (let i = 0; i < segments.length; i++) {
    const msgResult = db.prepare(`
      INSERT INTO messages (conversation_id, raw_id, role, content, seq)
      VALUES (?, ?, 'assistant', ?, ?)
    `).run(conversationId, rawResult.lastInsertRowid, segments[i], i);
    msgIds.push(msgResult.lastInsertRowid);
  }

  // ── 标记 reply_queue 积压消息为 done ──
  if (hasBacklog) {
    const ids = pendingEntries.map(e => e.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`
      UPDATE reply_queue SET status = 'done', reply_raw_msg_id = ?, reply_msg_ids = ?, processed_at = datetime(?)
      WHERE id IN (${placeholders})
    `).run(rawResult.lastInsertRowid, JSON.stringify(msgIds), new Date().toISOString(), ...ids);
  }

  // ── 调度临时唤醒过期 ──
  if (tempWakeUntil) {
    scheduleTempWakeExpiry(characterId, tempWakeUntil);
  }

  // ── 通过 SSE 广播回复 ──
  broadcast('delayed_reply', {
    character_id: characterId,
    display_name: char.display_name,
    conversation_id: conversationId,
    messages: segments.map((content, i) => ({
      id: msgIds[i],
      role: 'assistant',
      content,
      seq: i,
    })),
    is_sleep_wakeup: true,
    wake_mode: mode,
    merged_count: hasBacklog ? pendingEntries.length : 0,
    created_at: new Date().toISOString(),
  });

  // 广播叫醒状态变更
  broadcast('schedule_state_change', {
    character_id: characterId,
    is_sleeping: false,
    temporary_wake_until: tempWakeUntil,
    wake_mode: mode,
    wake_attempts: mode === 'phone' ? attempts : 0,
    was_door_woken: mode === 'door' || mode === 'shake' ? 1 : 0,
  });

  console.log(`[wakeService] Woke ${char.display_name} (${mode}), ${segments.length} bubble(s), backlog: ${pendingEntries.length}`);
}

/**
 * 构建叫醒 LLM 上下文
 * 复用 replyQueueScheduler.buildDelayedReplyContext 的结构
 */
function buildWakeContext(char, conversationId, userName, mode, attempts) {
  const db = getDb();
  const msgs = [];

  // [层 0] 破限词 + 世界观
  const jailbreak = getSystemRules();
  const worldSetting = getWorldSetting();
  const stageContent = [jailbreak, worldSetting].filter(Boolean).join('\n\n');
  if (stageContent) msgs.push({ role: 'system', content: stageContent });

  // [层 1] 角色人格 + 情绪 + 好感度 + 关系
  const charParts = [];
  charParts.push(char.base_prompt || '');

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
      const affinity = loadAffinity(char.id);
      const affPrompt = affinityToPrompt(affinity);
      charParts.push(`[当前好感度: ${Math.round(affinity)}/100] ${affPrompt}`);
      charParts.push(`[当前情绪: V=${vNorm.toFixed(2)} A=${aNorm.toFixed(2)} D=${dNorm.toFixed(2)} | 底色: V=${moodV.toFixed(2)} A=${moodA.toFixed(2)} D=${moodD.toFixed(2)}]`);
    }
  } catch (err) {
    // 情绪加载失败非致命
  }
  msgs.push({ role: 'system', content: charParts.join('\n\n') });

  // [层 1.5] 用户关系
  const relParts = [];
  const userRel = db.prepare(
    'SELECT relationship_text FROM user_relationships WHERE character_id = ?'
  ).get(char.id);
  if (userRel?.relationship_text) {
    relParts.push(`<user_relation>你对于${userName}而言的身份是${userRel.relationship_text}。</user_relation>`);
  }
  if (config.user.nickname || config.user.gender || config.user.appearance) {
    const infoParts = [];
    infoParts.push(`消息中标记为"user"的人是"${userName}"`);
    if (config.user.gender) infoParts.push(`性别：${config.user.gender}`);
    if (config.user.appearance) infoParts.push(`外观特征：${config.user.appearance}`);
    relParts.push(`<user_info>${infoParts.join('。')}</user_info>`);
  }
  if (relParts.length > 0) {
    msgs.push({ role: 'system', content: relParts.join('\n') });
  }

  // [层 2] 叫醒系统提示词
  let wakePrompt, userActionMsg;
  switch (mode) {
    case 'phone':
      wakePrompt = `[系统说明] 你被 ${userName} 打来的 ${attempts || 1} 个电话铃声吵醒了，脑袋还昏昏沉沉的。`;
      userActionMsg = `（手机铃声把熟睡中的你吵醒了，你迷迷糊糊摸到手机，看到是${userName}来电...）`;
      break;
    case 'door':
      wakePrompt = `[系统说明] ${userName} 打了三个电话都没叫醒你，于是直接上门把从床上把你摇起来了。`;
      userActionMsg = `（睡梦中你感觉有人在用力摇你...勉强睁开眼，发现${userName}正站在床边，一脸无奈地看着你）`;
      break;
    case 'shake':
      wakePrompt = `[系统说明] ${userName} 又跑到你床边摇你了，你又被晃醒了。`;
      userActionMsg = `（身体被一阵摇晃弄醒，你迷迷糊糊睁开眼，${userName}正俯身看着你）`;
      break;
    default:
      wakePrompt = `[系统说明] ${userName} 把你叫醒了，你迷迷糊糊脑袋很懵。`;
      userActionMsg = `（你感觉到有人在叫你...慢慢睁开眼，看到了${userName}）`;
  }
  msgs.push({ role: 'system', content: wakePrompt });

  // [层 3] 历史对话上下文
  //   3a. 上一轮对话参考（assistant 最后回复 + 之前 2 条，含 user 提问）
  //   3b. 睡眠期间收到的未回复 user 消息

  let hasHistory = false;

  const lastAssistant = db.prepare(`
    SELECT id FROM raw_messages
    WHERE conversation_id = ? AND role = 'assistant'
    ORDER BY id DESC LIMIT 1
  `).get(conversationId);

  if (lastAssistant) {
    // 上一轮对话上下文：最后一条 assistant + 之前最多 2 条消息
    const contextBefore = db.prepare(`
      SELECT role, content FROM raw_messages
      WHERE conversation_id = ? AND id <= ?
      ORDER BY id DESC LIMIT 3
    `).all(conversationId, lastAssistant.id);
    contextBefore.reverse();

    if (contextBefore.length > 0) {
      const contextText = contextBefore.map(m => {
        const label = m.role === 'assistant' ? char.display_name : userName;
        return `[${label}]: ${m.content}`;
      }).join('\n');
      msgs.push({ role: 'system', content: `以下是你们睡着前的最后一段对话，可作为此刻回应的上下文参考：\n\n${contextText}` });
      hasHistory = true;
    }

    // 睡眠期间收到的 user 消息（只取 user role）
    const unreadMessages = db.prepare(`
      SELECT role, content FROM raw_messages
      WHERE conversation_id = ? AND id > ? AND role = 'user'
      ORDER BY id ASC LIMIT 30
    `).all(conversationId, lastAssistant.id);

    if (unreadMessages.length > 0) {
      const unreadText = unreadMessages.map(m => {
        const label = m.role === 'assistant' ? char.display_name : userName;
        return `[${label}]: ${m.content}`;
      }).join('\n');
      msgs.push({ role: 'system', content: `以下是 ${userName} 在你睡觉时发的未回复消息：\n\n${unreadText}` });
      hasHistory = true;
    }
  }

  if (!hasHistory) {
    // fallback: 无 assistant 回复记录 → 取最近历史
    const history = db.prepare(`
      SELECT role, content FROM raw_messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 30
    `).all(conversationId);

    if (history.length > 0) {
      const historyText = history.map(m => {
        const label = m.role === 'assistant' ? char.display_name : userName;
        return `[${label}]: ${m.content}`;
      }).join('\n');
      msgs.push({ role: 'system', content: `以下是 ${userName} 在你睡觉时发的未回复消息：\n\n${historyText}` });
    }
  }

  // [层 4] 用户唤醒动作（作为最后一条 user 消息，LLM 会对此做出反应）
  msgs.push({ role: 'user', content: userActionMsg });

  return msgs;
}
