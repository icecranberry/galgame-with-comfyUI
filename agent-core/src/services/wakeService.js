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
import { getTempWakeUntil } from './scheduleManager.js';
import { getCurrentDream, markDreamShared } from './dreamService.js';

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
  // 梦境系统：被吵醒前正做着的梦（叫醒注入出口②）
  const dream = getCurrentDream(characterId);
  const msgs = buildWakeContext(char, conversationId, userName, mode, attempts, dream);

  // ── 原子性抢占 reply_queue 中的积压消息 ──
  // 使用 UPDATE + AND status='waiting' 确保与 replyQueueScheduler 互斥
  const claimResult = db.prepare(`
    UPDATE reply_queue SET status = 'processing'
    WHERE character_id = ? AND status = 'waiting'
  `).run(characterId);

  const hasBacklog = claimResult.changes > 0;

  // 抢占成功后读取已标记的条目（用于后续删除 + 统计）
  const pendingEntries = hasBacklog ? db.prepare(`
    SELECT * FROM reply_queue
    WHERE character_id = ? AND status = 'processing'
    ORDER BY created_at ASC
  `).all(characterId) : [];

  if (!hasBacklog) {
    // 检查是否有 reply_queue 条目（被 replyQueueScheduler 抢先处理了）
    const stillQueued = db.prepare(`
      SELECT COUNT(*) AS cnt FROM reply_queue WHERE character_id = ?
    `).get(characterId);
    if (stillQueued?.cnt > 0) {
      console.log(`[wakeService] ${char.display_name} wake-up skipped — replyQueueScheduler already claimed entries`);
      return;
    }
    console.log(`[wakeService] ${char.display_name} wake-up with no backlog — generating fresh reply`);
  }

  // ── 调用 LLM 生成回复 ──
  let fullReply;
  try {
    fullReply = await chatSync(msgs, {
      temperature: 0.75,
      max_tokens: 512,
      label: `wake-up:${char.display_name}:${mode}`,
    });
  } catch (err) {
    // LLM 调用失败，恢复 reply_queue 条目状态
    // 角色已被叫醒，不能再等原 sleep_until —— 改为 3 分钟后由 replyQueueScheduler 接手
    if (hasBacklog && pendingEntries.length > 0) {
      const ids = pendingEntries.map(e => e.id);
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`UPDATE reply_queue SET status = 'waiting', scheduled_reply_at = datetime('now', '+3 minutes') WHERE id IN (${placeholders})`).run(...ids);
    }
    throw err;
  }

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

  if (pendingEntries.length > 0) {
    const ids = pendingEntries.map(e => e.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM reply_queue WHERE id IN (${placeholders})`).run(...ids);
  }

  // 临时唤醒到期定时器已由 wake 端点在写库后立即注册（不依赖本函数成功）

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

  // 梦境系统：叫醒回复已生成 → 标记梦为已分享（出口②）
  if (dream?.id) {
    try { markDreamShared(dream.id, 'wake'); } catch { /* 非关键路径 */ }
  }
}

/**
 * 构建叫醒 LLM 上下文
 * 复用 replyQueueScheduler.buildDelayedReplyContext 的结构
 */
function buildWakeContext(char, conversationId, userName, mode, attempts, dream = null) {
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
    'SELECT relationship_text, is_oath FROM user_relationships WHERE character_id = ?'
  ).get(char.id);
  if (userRel?.relationship_text) {
    relParts.push(`<user_relation>你对于${userName}而言的身份是${userRel.relationship_text}。</user_relation>`);
  }
  if (userRel?.is_oath) {
    relParts.push(`<oath_bond>你们之间有一个比普通关系更深一层的约定——${userName}曾经郑重地送过你一枚戒指。这代表了独一无二的羁绊和承诺。在对话中，你的行为和情感会自然地带有"你是我最重要的人"的底色——不是因为规则要求，而是因为这层羁绊已经是你内心的一部分。</oath_bond>`);
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

  // [层 2.5] 梦境注入：被吵醒前正做着的梦（梦被打断，可迷糊提到碎片/影响语气）
  if (dream?.content) {
    msgs.push({
      role: 'system',
      content: `[系统说明] 被吵醒前你正做着一个梦：「${dream.content}」。梦被打断了，你可以迷迷糊糊地提到梦的碎片，也可以因为梦的内容（害羞/后怕/懊恼）影响你此刻的语气。`,
    });
  }

  // [层 3] 历史对话上下文
  //   3a. 上一轮对话参考（assistant 最后回复 + 之前 2 条，含 user 提问）
  //   3b. 睡眠期间收到的未回复 user 消息

  const PROMPT_JSON_RE = /\s*\{["']prompt["']:\s*"(?:[^"\\]|\\.)*"\s*\}/gs;

  const cleanContent = (role, content) => {
    return role === 'assistant' ? content.replace(PROMPT_JSON_RE, '') : content;
  };

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
        return `[${label}]: ${cleanContent(m.role, m.content)}`;
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
        return `[${label}]: ${cleanContent(m.role, m.content)}`;
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
        return `[${label}]: ${cleanContent(m.role, m.content)}`;
      }).join('\n');
      msgs.push({ role: 'system', content: `以下是 ${userName} 在你睡觉时发的未回复消息：\n\n${historyText}` });
    }
  }

  // [层 4] 用户唤醒动作（作为最后一条 user 消息，LLM 会对此做出反应）
  msgs.push({ role: 'user', content: userActionMsg });

  return msgs;
}
