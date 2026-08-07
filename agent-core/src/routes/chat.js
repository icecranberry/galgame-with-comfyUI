import { Router } from 'express';
import { getDb, getGlobalRule, getSystemRules, getWorldSetting, repairFtsIndex } from '../db/index.js';
import { chatStream, chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';
import { recallChatMemories, CHAT_RAG_TIMEOUT_MS } from '../services/memory/chatMemoryRecall.js';
import { curateChatMemories } from '../services/memoryExtractor.js';
import { deleteByConversation } from '../services/vectorClient.js';
import { clearConversationMemories, rollbackMemoriesFromRawId } from '../services/memory/memoryRepository.js';
import { extractImagePromptResponse, requestNonEmptyImagePrompt } from '../services/imagePromptResponse.js';
import { maybeSummarize, getRecentSummaries } from '../services/summarizer.js';
import { maybeExtractPortrait } from '../services/portraitExtractor.js';
import {
  loadEmotionState, evolveEmotion, evaluateStimulus,
  stateToPrompt, affinityToPrompt, saveEmotionSnapshot, emotionDashboard,
  loadAffinity, saveAffinity, evolveAffinity, getCompositeEmotion,
} from '../services/emotionEngine.js';
import { generateImage, getLastWorkflowMode } from '../services/imageSkill.js';
import { charArtistOverride } from '../services/characterImageOpts.js';
import { RAG_TIMEOUT_FAST_MS } from '../services/imagePromptKnowledge.js';
import { appendOathRing } from '../services/oathUtils.js';
import { getEventVadModifier } from '../services/eventGenerator.js';
import { computeProactiveScore, updateNextProactiveAt, resetUnansweredStreak, getUnansweredStreak } from '../services/proactiveChatScheduler.js';
import { SentenceSplitter } from '../utils/sentenceSplitter.js';
import { invalidateGalleryCache } from './images.js';
import { saveBase64Image } from '../services/imagePaths.js';
import { getReplyDelay, formatScheduleContext, getCurrentActivity, isTempWoken, extendTempWake } from '../services/scheduleManager.js';
import { broadcast } from '../services/unifiedStreamBus.js';
import { getTimeTag, getLightHint, getLightNoteWithWeather, getTimeLightInline } from '../services/timeLight.js';
import { getCoreDialogueRules, JUDGE_PROMPT, detectImageIntent } from '../builtinRules.js';
import { matchAll } from '../services/characterSearch.js';
import { buildChatContext, getSplitHistory } from '../services/contextAssembler.js';

const router = Router();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 打字节奏：按分句文字长度随机 300~900ms，模拟真人打字（短句快、长句慢、带随机抖动） ──
const typingDelay = (text = '') => {
  const len = Math.min(30, (text || '').length || 1); // 长度封顶 30 字，避免超长句停顿过久
  const base = 300 + (len / 30) * 300;                // 长度映射 300~600ms
  const jitter = Math.random() * 300;                 // 随机抖动 0~300ms
  return Math.min(900, Math.round(base + jitter));    // 最终落在 300~900ms
};

// ── 临时表达风格池：小概率注入，让"怎么说"像真人一样随心情/话题变化 ──
// 只影响本次回复，不改变性格底色；放历史聊天之后，越靠近"现在要回复"越容易被接住。
const TEMP_STYLE_POOL = [
  '先吐槽一句，再正常接话',
  '这次带点懒散随意的语气',
  '用一句玩笑话开场，再认真说',
  '这次说话稍微正经一点',
];
const TEMP_STYLE_POOL_OATH = [
  ...TEMP_STYLE_POOL,
  '这次带点撒娇的意味',
  '语气软一点，带点想念',
];

// ── 回复猜想冷却：每个 conversation 生成一次后进入 20s 冷却，用户新消息到达时重置 ──
const guessCooldowns = new Map();  // conversationId -> timestamp(ms)

// ── 智能配图计数器（per-conversation）：每轮用户发言 -1，生图成功后重置为 3，归零时跳过 LLM 判断直接生图 ──
const imageJudgeCounters = new Map();  // conversationId -> count

// ── 睡眠瞄一眼 prompt 缓存（per-character，内存级，服务重启后重置）──
const sleepPromptCache = new Map();  // characterId -> prompt string

// ── character_id → conversation_id 映射 ──
function convId(charId) { return `char_${charId}`; }

// 将 SQLite CURRENT_TIMESTAMP (UTC, 无时区标记) 转为 ISO 8601
// SQLite: "YYYY-MM-DD HH:MM:SS"  →  JS: 被误解析为本地时间（各浏览器行为不一致）
// 统一转为 "YYYY-MM-DDTHH:MM:SS.000Z" 确保前端正确按 UTC 转换显示
function toISODate(sqliteDT) {
  if (!sqliteDT) return sqliteDT;
  return sqliteDT.replace(' ', 'T') + '.000Z';
}

// DELETE /api/characters/:id/messages — 清空角色对话记录
router.delete('/characters/:id/messages', (req, res, next) => {
  const db = getDb();
  const conversationId = convId(req.params.id);

  const doDelete = () => {
    const charId = parseInt(req.params.id, 10);
    // 先统一清理聊天长期记忆及其版本、checkpoint、审计和独立向量索引
    clearConversationMemories(conversationId);
    db.prepare(`DELETE FROM emotion_snapshots WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`DELETE FROM rolling_summaries WHERE conversation_id = ?`).run(conversationId);

    db.prepare(`DELETE FROM user_portraits WHERE character_id = ?`).run(charId);
    // 删除奇遇数据
    db.prepare(`DELETE FROM character_events WHERE character_id = ?`).run(charId);
    db.prepare(`DELETE FROM event_history WHERE character_id = ?`).run(charId);
    // 重置好感度到默认值
    db.prepare(`UPDATE user_relationships SET affinity = 50 WHERE character_id = ?`).run(charId);
    // 重置主动聊天连胜计数
    db.prepare(`UPDATE characters SET proactive_streak = 0 WHERE id = ?`).run(charId);
    // 主表
    db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`DELETE FROM raw_messages WHERE conversation_id = ?`).run(conversationId);
    // 清理 ChromaDB 中该 conversation 的向量
    deleteByConversation(conversationId).then(
      n => { if (n > 0) console.log(`[chat] chroma deleted ${n} vectors for ${conversationId}`); },
      err => console.error(`[chat] chroma cleanup failed for ${conversationId}:`, err.message)
    );
  };

  try {
    doDelete();
  } catch (err) {
    // FTS5 虚拟表损坏时 DELETE 触发器（messages_ad）写入 messages_fts 会失败，
    // 重建 FTS 后重试即可。主表和 raw_messages 的数据不受影响。
    if (err.code === 'SQLITE_CORRUPT_VTAB') {
      console.warn('[chat] FTS5 corrupted during message delete, repairing...');
      try {
        repairFtsIndex();
        doDelete();
        console.log('[chat] retry after FTS repair succeeded');
      } catch (retryErr) {
        console.error('[chat] retry after FTS repair failed:', retryErr.message);
        return next(retryErr);
      }
    } else {
      return next(err);
    }
  }

  res.json({ ok: true });
});

// DELETE /api/characters/:id/messages/last-round — 撤回上一轮对话（仅删 messages + raw_messages）
router.delete('/characters/:id/messages/last-round', (req, res, next) => {
  const db = getDb();
  const conversationId = convId(req.params.id);

  const doDelete = () => {
    // 1. 找到最后一轮对话的起点（最后一条 user 消息的 raw_id）
    const lastUserRaw = db.prepare(`
      SELECT id FROM raw_messages
      WHERE conversation_id = ? AND role = 'user'
      ORDER BY id DESC LIMIT 1
    `).get(conversationId);

    if (!lastUserRaw) {
      // 没有 user 消息 → 全部是主动聊天等 agent 消息，每次撤回最后一条 agent 消息
      const lastAssistantRaw = db.prepare(`
        SELECT id FROM raw_messages
        WHERE conversation_id = ? AND role = 'assistant'
        ORDER BY id DESC LIMIT 1
      `).get(conversationId);
      if (!lastAssistantRaw) {
        return res.json({ ok: true, deleted: 0, message: '没有可撤回的对话' });
      }
      const lastRawId = lastAssistantRaw.id;
      const msgCount = db.prepare(`SELECT COUNT(*) AS c FROM messages WHERE raw_id = ?`).get(lastRawId).c;
      rollbackMemoriesFromRawId(conversationId, lastRawId);
      db.pragma('foreign_keys = OFF');
      try {
        db.prepare(`DELETE FROM messages WHERE raw_id = ?`).run(lastRawId);
        db.prepare(`DELETE FROM rolling_summaries WHERE conversation_id = ? AND end_msg_id >= ?`).run(conversationId, lastRawId);
        db.prepare(`DELETE FROM raw_messages WHERE id = ?`).run(lastRawId);
      } finally {
        db.pragma('foreign_keys = ON');
      }
      console.log(`[chat] undo last round (proactive only): raw=${lastRawId}, ${msgCount} msgs deleted for ${conversationId}`);
      return res.json({ ok: true, deleted: 1 + msgCount });
    }

    const lastUserRawId = lastUserRaw.id;

    // 2. 统计即将删除的数量
    const rawCount = db.prepare(`
      SELECT COUNT(*) AS c FROM raw_messages
      WHERE conversation_id = ? AND id >= ?
    `).get(conversationId, lastUserRawId).c;

    const msgCount = db.prepare(`
      SELECT COUNT(*) AS c FROM messages
      WHERE conversation_id = ? AND raw_id >= ?
    `).get(conversationId, lastUserRawId).c;

    // 3. 先回滚来源覆盖该轮的记忆版本，再删除原始消息
    rollbackMemoriesFromRawId(conversationId, lastUserRawId);
    db.pragma('foreign_keys = OFF');
    try {
      db.prepare(`DELETE FROM rolling_summaries WHERE conversation_id = ? AND end_msg_id >= ?`)
        .run(conversationId, lastUserRawId);
      db.prepare(`DELETE FROM messages WHERE conversation_id = ? AND raw_id >= ?`)
        .run(conversationId, lastUserRawId);

      db.prepare(`DELETE FROM raw_messages WHERE conversation_id = ? AND id >= ?`)
        .run(conversationId, lastUserRawId);
    } finally {
      db.pragma('foreign_keys = ON');
    }

    console.log(`[chat] undo last round: ${rawCount} raw + ${msgCount} msgs deleted for ${conversationId}`);
    res.json({ ok: true, deleted: rawCount + msgCount });
  };

  try {
    doDelete();
  } catch (err) {
    if (err.code === 'SQLITE_CORRUPT_VTAB') {
      console.warn('[chat] FTS5 corrupted during undo last round, repairing...');
      try {
        repairFtsIndex();
        doDelete();
        console.log('[chat] undo last round retry after FTS repair succeeded');
      } catch (retryErr) {
        console.error('[chat] undo last round retry failed:', retryErr.message);
        return next(retryErr);
      }
    } else {
      return next(err);
    }
  }
});

// GET /api/characters/:id/messages — 获取角色全部对话消息（本地 SQLite，数据量可控，无需分页）
router.get('/characters/:id/messages', (req, res) => {
  const db = getDb();
  const conversationId = convId(req.params.id);

  const messages = db.prepare(`
    SELECT id, conversation_id, raw_id, role, content, images, created_at, event_id
    FROM messages
    WHERE conversation_id = ?
    ORDER BY id ASC
  `).all(conversationId).map(m => ({
    ...m,
    created_at: toISODate(m.created_at),
  }));

  // 附带最新好感度快照（切角色后恢复用）
  const lastSnapshot = db.prepare(`
    SELECT affinity, affinity_delta, reason FROM emotion_snapshots
    WHERE conversation_id = ? AND affinity IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `).get(conversationId);

  res.json({
    messages,
    affinity: lastSnapshot ? {
      value: lastSnapshot.affinity,
      delta: lastSnapshot.affinity_delta ?? 0,
      reason: lastSnapshot.reason || '',
    } : null,
  });
});

// GET /api/messages/:id — 单条消息查询（送礼图片轮询用）
router.get('/messages/:id', (req, res) => {
  const db = getDb();
  const msg = db.prepare(
    'SELECT id, role, content, images, created_at FROM messages WHERE id = ?'
  ).get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'not found' });
  res.json({ ...msg, created_at: toISODate(msg.created_at) });
});

// POST /api/characters/:id/chat — 流式对话
router.post('/characters/:id/chat', async (req, res) => {
  const { message, client_msg_id, force_image_gen } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  const db = getDb();
  const characterId = req.params.id;
  const conversationId = convId(characterId);

  // ── 日程系统：回复队列拦截 ──
  if (config.features.schedule !== false) {
    const delayInfo = getReplyDelay(characterId);
    if (delayInfo.delay > 0 || delayInfo.delay === -1) {
      // 非即时回复 → 保存用户消息，写入 reply_queue，不启动 SSE 流

      const delayMinutes = delayInfo.delay === -1
        ? -1
        : delayInfo.delay;

      const scheduledReplyAt = delayInfo.delay === -1
        ? null  // sleeping: 等醒来时处理
        : new Date(Date.now() + delayMinutes * 60000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');

      // sleeping 时设置 scheduled_reply_at 为 sleep_until
      let finalScheduledAt = scheduledReplyAt;
      if (delayInfo.delay === -1) {
        const sleepingStatus = db.prepare('SELECT sleep_until FROM characters WHERE id = ?').get(characterId);
        if (sleepingStatus?.sleep_until) {
          finalScheduledAt = sleepingStatus.sleep_until;
        } else {
          // fallback: 8 小时后（正常情况下不会走到这里）
          finalScheduledAt = new Date(Date.now() + 8 * 3600_000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
        }
      }

      // 幂等检查：client_msg_id 已存在则跳过写入（前端重试保护）
      let userRawId, userMsgId;
      if (client_msg_id) {
        const existing = db.prepare('SELECT id FROM raw_messages WHERE client_msg_id = ?').get(client_msg_id);
        if (existing) {
          // 重试请求：用户消息已写入，检查 reply_queue 是否已有 waiting 条目
          console.log(`[chat] idempotent (sleeping): skipping duplicate user message (client_msg_id=${client_msg_id})`);
          userRawId = existing.id;
          const existingMsg = db.prepare('SELECT id FROM messages WHERE raw_id = ? AND role = ?').get(userRawId, 'user');
          userMsgId = existingMsg?.id;
          // 检查是否已有 waiting 的队列条目
          const existingQueue = db.prepare(
            'SELECT id FROM reply_queue WHERE client_msg_id = ? AND status = ?'
          ).get(client_msg_id, 'waiting');
          if (existingQueue) {
            // 已经排队中，直接返回（完全幂等）
            return res.json({
              queued: true,
              delay: delayInfo.delay,
              delayMinutes: delayMinutes,
              currentActivity: delayInfo.activity,
              estimatedReplyAt: delayInfo.delay === -1
                ? finalScheduledAt
                : new Date(Date.now() + delayMinutes * 60000).toISOString(),
            });
          }
        }
      }
      if (!userRawId) {
        const userRaw = db.prepare(`INSERT INTO raw_messages (conversation_id, role, content, client_msg_id) VALUES (?, 'user', ?, ?)`)
          .run(conversationId, message, client_msg_id || null);
        userRawId = userRaw.lastInsertRowid;
        const userMsg = db.prepare(`INSERT INTO messages (conversation_id, raw_id, role, content, seq) VALUES (?, ?, 'user', ?, 0)`)
          .run(conversationId, userRawId, message);
        userMsgId = userMsg.lastInsertRowid;
      }

      db.prepare(`
        INSERT INTO reply_queue (character_id, conversation_id, user_raw_msg_id, user_msg_id, user_content, client_msg_id, scheduled_reply_at, current_activity, delay_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        characterId, conversationId, userRawId, userMsgId,
        message, client_msg_id || null, finalScheduledAt,
        delayInfo.activity, delayMinutes
      );

      // 重置主动聊天未回复计数（同正常流程）
      resetUnansweredStreak(characterId);

      // ── 睡眠模式：建立 SSE 流，推送 Zzz 消息 + 瞄一眼生图 ──
      if (delayInfo.delay === -1) {
        const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
        if (character) {
          await handleSleepMode(res, characterId, conversationId, userMsgId, character, finalScheduledAt);
          return;
        }
      }

      return res.json({
        queued: true,
        delay: delayInfo.delay,
        delayMinutes: delayMinutes,
        currentActivity: delayInfo.activity,
        estimatedReplyAt: delayInfo.delay === -1
          ? finalScheduledAt
          : new Date(Date.now() + delayMinutes * 60000).toISOString(),
      });
    }

    // ── 安全兜底：日程未拦截但 DB 中标记为睡眠状态 ──
    // 日程系统可能因模板缺失/缓存过期/功能开关等原因未检测到睡眠，
    // 但 characters.is_sleeping 是 scheduleManager 定时同步的可靠标志
    const sleepingChar = db.prepare('SELECT is_sleeping, sleep_until, temporary_wake_until FROM characters WHERE id = ?').get(characterId);
    // isTempWoken 检查"未过期"而非"值存在"——过期残留值不应使睡眠兜底失效
    if (sleepingChar && sleepingChar.is_sleeping === 1 && !isTempWoken(characterId)) {
      const sleepUntil = sleepingChar.sleep_until
        || new Date(Date.now() + 8 * 3600_000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');

      // 保存用户消息 + 写入回复队列（同上面的 sleeping 路径）
      let userRawId, userMsgId;
      if (client_msg_id) {
        const existing = db.prepare('SELECT id FROM raw_messages WHERE client_msg_id = ?').get(client_msg_id);
        if (existing) {
          console.log(`[chat] idempotent (sleeping fallback): skipping duplicate (client_msg_id=${client_msg_id})`);
          userRawId = existing.id;
          const existingMsg = db.prepare('SELECT id FROM messages WHERE raw_id = ? AND role = ?').get(userRawId, 'user');
          userMsgId = existingMsg?.id;
          const existingQueue = db.prepare(
            'SELECT id FROM reply_queue WHERE client_msg_id = ? AND status = ?'
          ).get(client_msg_id, 'waiting');
          if (existingQueue) {
            return res.json({
              queued: true,
              delay: -1,
              delayMinutes: -1,
              currentActivity: '睡觉',
              estimatedReplyAt: sleepUntil,
            });
          }
        }
      }
      if (!userRawId) {
        const userRaw = db.prepare(`INSERT INTO raw_messages (conversation_id, role, content, client_msg_id) VALUES (?, 'user', ?, ?)`)
          .run(conversationId, message, client_msg_id || null);
        userRawId = userRaw.lastInsertRowid;
        const userMsg = db.prepare(`INSERT INTO messages (conversation_id, raw_id, role, content, seq) VALUES (?, ?, 'user', ?, 0)`)
          .run(conversationId, userRawId, message);
        userMsgId = userMsg.lastInsertRowid;
      }

      db.prepare(`
        INSERT INTO reply_queue (character_id, conversation_id, user_raw_msg_id, user_msg_id, user_content, client_msg_id, scheduled_reply_at, current_activity, delay_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        characterId, conversationId, userRawId, userMsgId,
        message, client_msg_id || null, sleepUntil,
        '睡觉', -1
      );

      resetUnansweredStreak(characterId);

      const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
      if (character) {
        await handleSleepMode(res, characterId, conversationId, userMsgId, character, sleepUntil);
        return;
      }

      return res.json({
        queued: true,
        delay: -1,
        delayMinutes: -1,
        currentActivity: '睡觉',
        estimatedReplyAt: sleepUntil,
      });
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // 生图期间 SSE 流可能长时间无数据写入，禁用 socket/response 超时
  req.socket.setTimeout(0);
  res.setTimeout(0);
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // 1. 保存用户消息（双表：raw_messages 完整原文 + messages 单条展示）
    //    幂等检查：client_msg_id 已存在则跳过写入，前端 SSE 流已建立无需重复 commit
    let userMsgId;
    let userRawMsgId;
    if (client_msg_id) {
      const existing = db.prepare('SELECT id FROM raw_messages WHERE client_msg_id = ?').get(client_msg_id);
      if (existing) {
        // 重试请求：用户消息已写入，直接复用（避免 DB 重复记录）
        console.log(`[chat] idempotent: skipping duplicate user message (client_msg_id=${client_msg_id})`);
        userRawMsgId = existing.id;
        userMsgId = db.prepare(`SELECT id FROM messages WHERE raw_id = ? AND role = 'user' ORDER BY id ASC LIMIT 1`).get(existing.id)?.id;
        send('msg_saved', { id: userMsgId, role: 'user', created_at: new Date().toISOString() });
      }
    }
    if (!userRawMsgId) {
      const userRaw = db.prepare(`INSERT INTO raw_messages (conversation_id, role, content, client_msg_id) VALUES (?, 'user', ?, ?)`)
        .run(conversationId, message, client_msg_id || null);
      userRawMsgId = userRaw.lastInsertRowid;
      const userMsg = db.prepare(`INSERT INTO messages (conversation_id, raw_id, role, content, seq) VALUES (?, ?, 'user', ?, 0)`)
        .run(conversationId, userRawMsgId, message);
      userMsgId = userMsg.lastInsertRowid;
      send('msg_saved', { id: userMsgId, role: 'user', created_at: new Date().toISOString() });
    }

    // 1.5 用户发送新消息 → 重置回复猜想冷却，本轮的 assistant 回复可以触发一次猜想
    guessCooldowns.delete(conversationId);

    // 1.6 智能配图计数器 -1（per-conversation）
    const counter = imageJudgeCounters.get(conversationId) ?? 3;
    imageJudgeCounters.set(conversationId, Math.max(0, counter - 1));
    console.log(`[chat] imageJudgeCounter[${conversationId}] decreased to ${imageJudgeCounters.get(conversationId)}`);

    // 2. 加载角色
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);

    // 2.1 用户在跟临时唤醒的角色聊天 → 重置睡眠倒计时，保持活跃清醒
    if (isTempWoken(characterId)) extendTempWake(characterId);

    // 3. 生图意图（正则强匹配 → 提前检测，用于 msgs[2] 格式消息）
    const explicitImageIntent = detectImageIntent(message);

    // 4.5b 活跃奇遇检测（提前查询，供情绪引擎 + 人格层锚点 + 上下文注入三处使用）
    const activeEvent = db.prepare(`
      SELECT id, title, description, current_branch, choice_history, status, engaged, event_type_key, emphasis_delivered, referenced_character_ids
      FROM character_events
      WHERE character_id = ? AND status IN ('open','engaged')
      ORDER BY id DESC LIMIT 1
    `).get(characterId);

    // ── 交叉角色检测（扫描最近三轮对话 + 用户实际输入 + 事件引用）──
    const recentHistory = db.prepare(`
      SELECT role, content FROM raw_messages
      WHERE conversation_id = ? ORDER BY id DESC LIMIT 6
    `).all(conversationId);
    // 提取用户实际输入：message 末尾 </dynamic_context> 之后的部分
    const extractRealContent = (text) => {
      const idx = text.lastIndexOf('</dynamic_context>');
      return idx >= 0 ? text.slice(idx + '</dynamic_context>'.length).trim() : text;
    };
    const recentInputs = recentHistory.map(m => extractRealContent(m.content)).join('\n');
    const realInput = extractRealContent(message);
    const scanText = recentInputs + '\n' + realInput;
    const crossMatches = matchAll(scanText, characterId);
    const eventRefIds = activeEvent?.referenced_character_ids
      ? JSON.parse(activeEvent.referenced_character_ids) : [];
    const allRefIds = [...new Set([...eventRefIds, ...crossMatches.map(m => m.id)])].slice(0, 3);
    const crossChars = allRefIds.map(id => db.prepare(
      'SELECT id, display_name, short_prompt, base_prompt, loras FROM characters WHERE id = ?'
    ).get(id)).filter(Boolean);

    // 4. 情绪状态加载（VAD 三维情绪 → 用于 msgs[1] 身份消息）
    //     好感度提前加载
    let emotionPrompt = '';
    let affinity = null;
    if (config.features.emotion) {
      const emotionBaseline = character
        ? JSON.parse(character.emotion_baseline || '{"valence":0.5,"arousal":0.5,"dominance":0.5}')
        : { valence: 0.5, arousal: 0.5, dominance: 0.5 };
      const emotionState = loadEmotionState(conversationId, emotionBaseline);
      affinity = loadAffinity(characterId);

      // 4.5a 每日首次互动奖励：距上次互动跨天 → +5（在注入 LLM 之前就加成）
      const relRow = db.prepare(
        'SELECT last_interaction_at FROM user_relationships WHERE character_id = ?'
      ).get(characterId);
      const lastAt = relRow?.last_interaction_at;
      if (lastAt) {
        const lastDate = lastAt.slice(0, 10); // "YYYY-MM-DD"
        const today = new Date().toISOString().slice(0, 10);
        if (lastDate !== today) {
          affinity = saveAffinity(characterId, affinity + 5);
          console.log(`[chat] daily first interaction bonus: +5 → affinity=${affinity.toFixed(0)}`);
        }
      } else {
        // 从未互动过 → 首次互动也给奖励
        affinity = saveAffinity(characterId, affinity + 5);
        console.log(`[chat] first ever interaction bonus: +5 → affinity=${affinity.toFixed(0)}`);
      }

      // 4.6 奇遇情绪联动：根据事件类型叠加 VAD 偏移（纯规则映射，零 LLM 开销）
      if (activeEvent && activeEvent.event_type_key) {
        const vadMod = getEventVadModifier(activeEvent.event_type_key);
        if (vadMod) {
          const clamp = v => Math.max(-1, Math.min(1, v));
          emotionState.instant.valence = clamp(emotionState.instant.valence + vadMod.valence);
          emotionState.instant.arousal = clamp(emotionState.instant.arousal + vadMod.arousal);
          emotionState.instant.dominance = clamp(emotionState.instant.dominance + vadMod.dominance);
          emotionState.mood.valence = clamp(emotionState.mood.valence + vadMod.valence * 0.5);
          emotionState.mood.arousal = clamp(emotionState.mood.arousal + vadMod.arousal * 0.5);
          emotionState.mood.dominance = clamp(emotionState.mood.dominance + vadMod.dominance * 0.5);
          console.log(`[chat] 🎭 adventure VAD: ${activeEvent.event_type_key} → V${vadMod.valence>=0?'+':''}${vadMod.valence.toFixed(2)} A${vadMod.arousal>=0?'+':''}${vadMod.arousal.toFixed(2)} D${vadMod.dominance>=0?'+':''}${vadMod.dominance.toFixed(2)}`);
        }
      }

      emotionPrompt = stateToPrompt(emotionState) || '';
    }

    // ═══════════════════════════════════════════
    // 上下文组装 — 稳定块 + 摘要 + checkpoint 历史 + 动态尾部
    // ═══════════════════════════════════════════

    // 当前用户 raw message ID 在幂等命中或写入时已精确记录，用于审计快照。

    // ── 稳定块 [0]：舞台 — 破限词 + 世界观 ──
    const jailbreak = getSystemRules();
    const worldSetting = getWorldSetting();
    const stageContent = [jailbreak, worldSetting].filter(Boolean).join('\n\n');

    // ── 稳定块 [1]：角色基础人格（不含日程、不含奇遇） ──
    const charBaseContent = character?.base_prompt || getDefaultPrompt();

    // ── 稳定块 [2]：用户上下文 + 关系 + 固定格式规则 ──
    const chatUserName = config.user.nickname || '用户';
    const hasUserInfo = config.user.nickname || config.user.gender || config.user.appearance || config.user.persona;

    // 用户→角色关系
    const userRel = db.prepare(
      'SELECT relationship_text, is_oath FROM user_relationships WHERE character_id = ?'
    ).get(characterId);

    // 角色间关系
    const charRels = db.prepare(`
      SELECT 'from' AS direction, cr.relationship_text, c.display_name
      FROM character_relationships cr
      JOIN characters c ON c.id = cr.to_character_id
      WHERE cr.from_character_id = ? AND cr.relationship_text != ''
      UNION ALL
      SELECT 'to' AS direction, cr.relationship_text, c.display_name
      FROM character_relationships cr
      JOIN characters c ON c.id = cr.from_character_id
      WHERE cr.to_character_id = ? AND cr.relationship_text != ''
    `).all(characterId, characterId);

    const userInfoParts = [];
    if (userRel && userRel.relationship_text) {
      userInfoParts.push(`<user_relation>你对于user而言的身份是${userRel.relationship_text}。这个身份为最高优先级，即使你在外有其他身份，但是在user面前就是这样的。请在对话中自然体现这层身份，不必刻意说明，行为举止应符合这层身份。</user_relation>`);
    }
    if (userRel && userRel.is_oath) {
      userInfoParts.push(`<oath_bond>你们之间有一个比普通关系更深一层的约定——${chatUserName}曾经郑重地送过你一枚戒指。这代表了独一无二的羁绊和承诺。在对话中，你的行为和情感会自然地带有"你是我最重要的人"的底色——不是因为规则要求，而是因为这层羁绊已经是你内心的一部分。</oath_bond>`);
    }
    if (hasUserInfo) {
      const infoParts = [`消息中标记为"user"的人是"${chatUserName}"`];
      if (config.user.gender) infoParts.push(`性别：${config.user.gender}`);
      if (config.user.appearance) infoParts.push(`外观特征：${config.user.appearance}`);
      if (config.user.persona) infoParts.push(`其他说明：${config.user.persona}`);
      userInfoParts.push(`<user_info>${infoParts.join('。')}</user_info>`);
    }
    if (charRels.length > 0) {
      const relLines = charRels.map(r => {
        if (r.direction === 'from') return `- ${r.display_name}是你的${r.relationship_text}`;
        return `- ${r.display_name}认为你是她的${r.relationship_text}`;
      }).join('\n');
      userInfoParts.push(`<character_relations>你与其他角色的关系：\n${relLines}\n\n请在对话中自然体现这些关系，不必刻意说明，但当提到或遇到这些角色时，行为举止应符合你们的关系。</character_relations>`);
    }

    // 固定格式规则保持在稳定前缀；随好感度/本轮生图意图变化的长度提示放到动态尾部。
    const coreRules = getCoreDialogueRules({ userName: chatUserName || '用户' });
    userInfoParts.push(`<dialogue_format_rules>
${coreRules}
- **在合适的时机，你会想要和用户分享照片或者给他看某些事物。**
- {"prompt":"Description of the scene"}：对话历史中若出现这种格式，意味着这里出现了一张这样的图片，继续自然对话即可。
</dialogue_format_rules>`);

    const formatContextBlock = userInfoParts.length > 0 ? userInfoParts.join('\n\n') : '';

    // ── 稳定块集合 ──
    const stableBlocks = [stageContent, charBaseContent, formatContextBlock].filter(Boolean);

    // ── 摘要块 ──
    const summaries = getRecentSummaries(conversationId, 1);
    const summaryBlock = summaries.length > 0
      ? '[对话历史摘要 — 以下是你和用户之前对话的摘要，已按时间顺序排列]\n' + summaries[0].summary
      : null;

    // ── checkpoint 历史 + 活跃聊天历史（滑动窗口） ──
    const { checkpoint, checkpointHistory, activeText: activeChatText, activeRounds } = getSplitHistory(db, conversationId, 10, 10, { userName: chatUserName, characterName: character.display_name });
    // [DEBUG] 上下文拆分
    console.log('[DEBUG] afterId:', checkpoint?.end_msg_id || 0, '| checkpoint助手数: 10(固定) | active助手数:', activeRounds);
    if (checkpointHistory.length > 0) {
      const cpAsst = [...checkpointHistory].reverse().find(m => m.role === 'assistant');
      console.log('[DEBUG] checkpoint末条assistant:', cpAsst ? cpAsst.content.slice(0, 60) : '(无)');
    }
    if (activeChatText) {
      const firstLine = activeChatText.split('\n').find(l => l.trim()) || '';
      console.log('[DEBUG] active首行:', firstLine.slice(0, 80));
    }

    // ── 动态尾部块（将附加到最新 user 消息） ──
    const dynamicBlocks = [];
    const memorySnapshot = [];

    // 1. 最近信箱往来
    const recentLetters = db.prepare(`
      SELECT content, content_short, reply_content,
             CAST(julianday('now') - julianday(replied_at) AS INTEGER) AS days_ago
      FROM mailbox_letters
      WHERE character_id = ? AND direction = 'char_to_user' AND status = 'completed'
        AND content != '' AND reply_content != ''
      ORDER BY replied_at DESC LIMIT 2
    `).all(characterId);
    if (recentLetters.length > 0) {
      const letterLines = recentLetters.map(l => {
        const daysLabel = formatRelativeDay(l.days_ago);
        const userBrief = (l.content || '').slice(0, 50);
        const replyBrief = l.content_short || (l.reply_content || '').slice(0, 50);
        return `- ${daysLabel}：${chatUserName}来信"${userBrief}..." → 你回信"${replyBrief}..."`;
      });
      dynamicBlocks.push(`<mailbox_history>你与${chatUserName}的最近信箱往来：\n${letterLines.join('\n')}\n\n可以在对话中自然地提及近期的通信内容，让对话更有连续性。</mailbox_history>`);
    }

    // 2. 最近奇遇总结
    const engagedEvent = db.prepare(`
      SELECT title, summary, ended_at
      FROM event_history WHERE character_id = ? AND engaged = 1
      ORDER BY ended_at DESC LIMIT 1
    `).get(characterId);
    if (engagedEvent) {
      dynamicBlocks.push(`<event_history>\n${character.display_name}最近经历了一些事：\n${engagedEvent.title}：${engagedEvent.summary || ''}\n你可以在对话中自然地提起或询问这些经历。\n</event_history>`);
    }

    // 3. 最近朋友圈（含评论区）
    const recentMoments = db.prepare(`
      SELECT id, content, created_at FROM moment_posts
      WHERE character_id = ? AND status = 'done'
      ORDER BY created_at DESC LIMIT 2
    `).all(characterId);
    if (recentMoments.length > 0) {
      const momentLines = recentMoments.map((m, i) => {
        let line = `${i + 1}. [${m.created_at}] ${m.content}`;
        const hasUserComment = db.prepare(`SELECT COUNT(*) AS cnt FROM moment_comments WHERE post_id = ? AND author_type = 'user'`).get(m.id);
        if (hasUserComment && hasUserComment.cnt > 0) {
          const comments = db.prepare(`
            SELECT mc.author_type, mc.content,
              CASE WHEN mc.author_type = 'character' THEN c.display_name ELSE ? END AS display_name
            FROM moment_comments mc LEFT JOIN characters c ON c.id = mc.author_id AND mc.author_type = 'character'
            WHERE mc.post_id = ? ORDER BY mc.created_at ASC
          `).all(chatUserName, m.id);
          if (comments.length > 0) {
            const commentLines = comments.map(c => {
              const name = c.author_type === 'character' ? c.display_name : chatUserName;
              return `  ${name}：${c.content}`;
            }).join('\n');
            line += `\n  评论区：\n${commentLines}`;
          }
        }
        return line;
      }).join('\n');
      dynamicBlocks.push(`<recent_moments>\n${character.display_name}最近发了朋友圈：\n${momentLines}\n你可以把这些当做聊天话题，自然地在对话中提到。\n</recent_moments>`);
    }

    // 4. 好感度区间描述
    if (config.features.emotion && affinity != null) {
      const affinityMsg = affinityToPrompt(affinity);
      if (affinityMsg) dynamicBlocks.push(affinityMsg);
    }

    // 5. 角色视角的用户画像
    const portraitRows = db.prepare(`
      SELECT trait_type, content FROM user_portraits
      WHERE character_id = ?
      ORDER BY trait_type, confidence DESC
    `).all(characterId);
    if (portraitRows.length > 0) {
      const grouped = {};
      for (const row of portraitRows) { (grouped[row.trait_type] = grouped[row.trait_type] || []).push(row.content); }
      const portraitStrs = [];
      if (grouped.appearance) portraitStrs.push('外貌特征：' + grouped.appearance.join('、'));
      if (grouped.personality) portraitStrs.push('性格特征：' + grouped.personality.join('、'));
      if (grouped.preference) portraitStrs.push('偏好习惯：' + grouped.preference.join('、'));
      dynamicBlocks.push(`<user_portrait>${chatUserName}在你眼中的印象：\n${portraitStrs.join('\n')}</user_portrait>`);
    }

    // 6. 回复长度提示（随好感度变化）
    const sentenceHint = (() => {
      if (explicitImageIntent) return '15个汉字以内';
      if (affinity == null || affinity < 60) return '10~30个汉字';
      if (affinity < 80) return '10~40个汉字';
      return '10~60个汉字';
    })();
    dynamicBlocks.push(`<dialogue_rules>\n- **回复控制在${sentenceHint}，保持口语化轻快节奏**\n</dialogue_rules>`);

    // 7. VAD 三维情绪描述
    if (config.features.emotion && emotionPrompt) {
      dynamicBlocks.push(emotionPrompt);
    }

    // 8. 活跃聊天历史（滑动窗口 0~10 轮）
    if (activeChatText) {
      dynamicBlocks.push(activeChatText);
    }

    // 8.5 临时表达风格：小概率注入，紧跟历史聊天之后，只影响本轮回复
    //     誓约状态时偏向更亲近的风格（俏皮/撒娇），一般时用基础池
    if (Math.random() < 0.12) {
      const pool = (userRel && userRel.is_oath) ? TEMP_STYLE_POOL_OATH : TEMP_STYLE_POOL;
      const style = pool[Math.floor(Math.random() * pool.length)];
      dynamicBlocks.push(`<style_override>\n${style}。只影响这次回复，不要改变你的性格底色。\n</style_override>`);
    }

    // 9. 日程上下文（当前在做什么 / 睡醒等）
    const scheduleCtx = (config.features.schedule !== false) ? formatScheduleContext(characterId) : null;
    if (scheduleCtx) {
      dynamicBlocks.push(`<schedule_context>\n${scheduleCtx}\n</schedule_context>`);
    }

    // 10. 活跃奇遇（仅首轮强调时出现）
    if (activeEvent) {
      const isFirstEmphasis = !activeEvent.emphasis_delivered;
      if (isFirstEmphasis) {
        const parsedHistory = JSON.parse(activeEvent.choice_history || '[]');
        const latestStep = parsedHistory.length > 1 ? parsedHistory[parsedHistory.length - 1] : null;
        const latestStepLine = latestStep
          ? `\n最新情况（「${latestStep.choice_label}」）：${latestStep.summary}`
          : '';
        dynamicBlocks.push(`<current_event priority="active">\n现在，${character.display_name}正在经历一个突发事件：\n标题：${activeEvent.title}\n当前处境：${activeEvent.description}${latestStepLine}\n（这是一件正在进行的事。你的情绪、行为和注意力都会受到这件事的影响，请自然地流露在回复中。但如果对方不主动提起，也不需要刻意围绕它展开对话。）\n</current_event>`);
      }
    }

    // 11. RAG 三路召回记忆
    if (config.features.memory) {
      try {
        const groupConversationIds = db.prepare(`
          SELECT 'group_' || group_id AS conversation_id
          FROM group_members WHERE character_id = ? ORDER BY group_id
        `).pluck().all(characterId);
        const { results: memoryResults, timedOut: ragTimedOut } = await recallChatMemories(message, {
          conversationIds: [conversationId, ...groupConversationIds],
        });
        if (ragTimedOut) {
          console.warn(`[chat] memory search exceeded ${CHAT_RAG_TIMEOUT_MS}ms; continuing without RAG memories`);
        }
        // 临时排除事件/奇遇/未互动事件类记忆，避免它们通过主聊天流的 <rag_memories> 重复注入。
        const chatMemoryResults = memoryResults.filter(m => {
          const judgment = String(m.judgment ?? '');
          return !judgment.includes('【事件')
            && !judgment.includes('【奇遇')
            && !judgment.includes('未互动事件');
        });
        if (chatMemoryResults.length > 0) {
          const memoryLines = chatMemoryResults.map((m, i) => `${i + 1}. [${m.memory_type}] ${m.judgment}`).join('\n');
          memorySnapshot.push(...chatMemoryResults.map(m => ({
            id: m.memory_id,
            memoryType: m.memory_type,
            judgment: m.judgment,
            tags: m.tags ?? [],
            sources: m.sources ?? [],
          })));
          dynamicBlocks.push(`<rag_memories>\n${memoryLines}\n</rag_memories>`);
        }
      } catch (err) { console.error('[chat] memory search failed:', err.message); }
    }

    // 12. 重逢提示（streak ≥ 2 时注入）
    const streak = getUnansweredStreak(characterId);
    if (streak >= 2) {
      dynamicBlocks.push(`【⚠️ 重逢提示 — 仅本次生成可见，不存入对话记录】${character.display_name} 之前连续发了 ${streak} 条主动消息 ${chatUserName} 都没回——现在 ${chatUserName} 终于回复了。${character.display_name} 应在接下来的回复中自然地流露一点"终于等到你"的情绪——不质问、不委屈、不阴阳怪气。嘴硬的用别扭的方式，温柔的用直接的方式，搞怪的用段子。让 ${chatUserName} 感觉到：ta 回来聊天这件事，对 ${character.display_name} 来说很重要。`);
    }
    if (streak > 0) {
      resetUnansweredStreak(characterId);
    }

    // 13. 交叉角色 short_prompt 注入
    if (crossChars.length > 0) {
      const crossLines = crossChars.map(c =>
        `角色「${c.display_name}」: ${c.short_prompt || (c.base_prompt || '').slice(0, 200)}`
      ).join('\n\n');
      dynamicBlocks.push(`<cross_reference>\n当前对话中涉及以下其他角色，你应当了解他们的基本信息，在对话中自然互动时保持其人格的一致性：\n\n${crossLines}\n</cross_reference>`);
    }

    // 14. 时间上下文（当前时间 + 距上次聊天间隔）
    const now = new Date();
    const timeTag = getTimeTag(now);
    const timeBlocks = [timeTag];
    // 上次对话时间：取倒数第二条 user 消息的 created_at
    const prevUserMsg = db.prepare(`
      SELECT created_at FROM raw_messages
      WHERE conversation_id = ? AND role = 'user'
      ORDER BY id DESC LIMIT 1 OFFSET 1
    `).get(conversationId);
    if (prevUserMsg?.created_at) {
      const prevDate = new Date(prevUserMsg.created_at + 'Z');
      const gapMinutes = (now - prevDate) / 60000;
      if (gapMinutes > 10) {
        const prevWeekDay = ['周日','周一','周二','周三','周四','周五','周六'][prevDate.getDay()];
        const prevDateStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;
        timeBlocks.push(`[上次对话 ${prevDateStr} ${prevWeekDay} ${String(prevDate.getHours()).padStart(2, '0')}:${String(prevDate.getMinutes()).padStart(2, '0')}]`);
      }
    }
    dynamicBlocks.push(`<time_context>\n${timeBlocks.join('\n')}\n</time_context>`);

    // 生图仍由原有路径 A/B/C/D/E 决策；固定格式规则已在稳定前缀中，不额外改变主回复行为。
    // ── 通过 buildChatContext 组装最终请求 ──
    const { messages: msgs, metadata } = buildChatContext({
      stableBlocks,
      summaryBlock,
      history: checkpointHistory,
      dynamicBlocks,
    });

    // ── 副作用：首轮强调标记（event 已在 dynamicBlocks 中注入） ──
    if (activeEvent && !activeEvent.emphasis_delivered) {
      db.prepare(`UPDATE character_events SET emphasis_delivered = 1 WHERE id = ?`).run(activeEvent.id);
    }

    // 6. 流式生成（温度 0.72）
    // SentenceSplitter 内置 <pr 闸门 + 20 字分句，字符先过闸门再过标点规则
    const splitter = new SentenceSplitter();
    const collectedSegments = [];
    let fullContent = '';

    const streamOpts = {
      temperature: 0.72,
      label: '主聊天流',
    };

    send('response_start', {});
    for await (const chunk of chatStream(msgs, streamOpts)) {
      const cleanChunk = chunk.replace(/<br\s*\/?>/gi, '').replace(/\n{2,}/g, '\n');
      fullContent += cleanChunk;

      const { segments, stopped } = splitter.feed(cleanChunk);

      for (const segText of segments) {
        send('token', { content: segText });
        collectedSegments.push(segText);
        send('bubble_break', {});
        await sleep(typingDelay(segText));
      }
      // stopped=true 后 feed() 不再产出 segment，但 fullContent 继续累积
    }

    // 释放缓冲剩余 + flush 分句队列
    const { segments: lastSegs, stopped: wasStopped } = splitter.flushAll();
    if (lastSegs.length > 0) {
      for (const segText of lastSegs) {
        send('token', { content: segText });
        collectedSegments.push(segText);
        send('bubble_break', {});
      }
    }

    // 补救：LLM 偶尔把 {"prompt":"..."} 放在正文前面（而非末尾），
    // 闸门在流开头就检测到 {" → stopped=true，导致后续正文全部丢失。
    // 此时从 fullContent 中剥离 prompt JSON，把剩余正文重新过分句器。
    if (wasStopped && collectedSegments.length === 0) {
      const textOnly = stripTags(fullContent).trim();
      if (textOnly) {
        const lateSplitter = new SentenceSplitter();
        const { segments: lateSegs1 } = lateSplitter.feed(textOnly);
        const { segments: lateSegs2 } = lateSplitter.flushAll();
        const lateSegments = [...lateSegs1, ...lateSegs2]
          .map(s => stripBracketActions(s).trim())
          .filter(Boolean);
        for (const segText of lateSegments) {
          send('token', { content: segText });
          collectedSegments.push(segText);
          send('bubble_break', {});
        }
      }
    }

    fullContent = stripBracketActions(fullContent);
    send('response_end', {});

    // 7. 后处理：gate 尝试阻止 {"prompt"... JSON 内容进入 collectedSegments，
    //    stripTags 兜底清洗；如有 prompt 标签则在 fullContent 上提取
    const tags = extractImageTags(fullContent);
    const hasNeedImageTag = !tags.prompt && hasNeedImage(fullContent);
    const segments = collectedSegments
      .map(s => stripTags(stripBracketActions(s)).trim())
      .filter(Boolean);
    const displayContent = segments.join('\n\n');

    // gate 命中或模型有生图标签时，前端气泡可能不完整，用清洗结果覆盖
    if (wasStopped || tags.prompt || hasNeedImageTag) {
      send('context_update', { content: displayContent });
    }
    // 8.5 保存 raw_messages（完整原文，保留 {"prompt" JSON 标签以便 LLM 理解上下文）
    const rawContent = fullContent
      .replace(/<needImage>/gi, '')
      .trim();
    const rawResult = db.prepare(`INSERT INTO raw_messages (conversation_id, role, content, prompt) VALUES (?, 'assistant', ?, ?)`)
      .run(conversationId, rawContent, tags.prompt || null);
    const rawMsgId = rawResult.lastInsertRowid;

    const savedIds = [];
    for (let i = 0; i < segments.length; i++) {
      const r = db.prepare(`INSERT INTO messages (conversation_id, raw_id, role, content, seq) VALUES (?, ?, 'assistant', ?, ?)`)
        .run(conversationId, rawMsgId, segments[i], i);
      savedIds.push(r.lastInsertRowid);
      send('msg_saved', { id: r.lastInsertRowid, role: 'assistant', created_at: new Date().toISOString() });
    }
    if (segments.length === 0) {
      // 兜底：AI 没有返回有效文本
      const rawEmpty = db.prepare(`INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, 'assistant', ?)`)
        .run(conversationId, '...');
      const r = db.prepare(`INSERT INTO messages (conversation_id, raw_id, role, content, seq) VALUES (?, ?, 'assistant', ?, 0)`)
        .run(conversationId, rawEmpty.lastInsertRowid, '...');
      savedIds.push(r.lastInsertRowid);
      send('msg_saved', { id: r.lastInsertRowid, role: 'assistant', created_at: new Date().toISOString() });
    }
    const lastInsertRowid = savedIds[savedIds.length - 1];

    // 8.8 回复猜想 ← 启动（不 await，与情绪评估并行发起 LLM 调用）
    //      每次用户消息到达时重置冷却 → 每轮对话最多触发一次 → 写入 20s 冷却
    let guessPromise = null;
    let guessCooldownStart = 0;
    if (config.features.replyGuesses && displayContent && segments.length > 0) {
      const now = Date.now();
      const cooldownUntil = guessCooldowns.get(conversationId);
      if (!cooldownUntil || now >= cooldownUntil) {
        guessPromise = generateReplyGuesses(conversationId, character);
        guessCooldownStart = now;
      } else {
        console.log(`[chat] guess skipped: cooldown active (${Math.round((cooldownUntil - now) / 1000)}s remaining)`);
      }
    }

    // 9. 启动情绪评估 promise（不 await — 与回复猜想 + 生图三路并行）
    let emotionPromise = null;
    let emotionCleanup = null;  // { emotionState, emotionBaseline, currentAffinity }
    if (config.features.emotion) {
      const emotionBaseline = character
        ? JSON.parse(character.emotion_baseline || '{"valence":0.5,"arousal":0.5,"dominance":0.5}')
        : { valence: 0.5, arousal: 0.5, dominance: 0.5 };
      const emotionState = loadEmotionState(conversationId, emotionBaseline);
      const currentAffinity = loadAffinity(characterId);
      // 上一轮对话（供 LLM 参考上下文，只取最近一组 user+assistant）
      const prevRound = db.prepare(`
        SELECT role, content FROM raw_messages
        WHERE conversation_id = ? AND id < (SELECT MAX(id) FROM raw_messages WHERE conversation_id = ?)
        ORDER BY id DESC LIMIT 2
      `).all(conversationId, conversationId).reverse();
      const prevUser = prevRound.find(r => r.role === 'user')?.content || '';
      const prevAssistant = prevRound.find(r => r.role === 'assistant')?.content || '';

      // 对话历史摘要
      const summaryRow = db.prepare(`
        SELECT summary FROM rolling_summaries
        WHERE conversation_id = ?
        ORDER BY id DESC LIMIT 1
      `).get(conversationId);

      const evalContext = {
        conversationId,
        characterId: parseInt(characterId, 10) || null,
        characterPersonality: character?.short_prompt || '',
        emotionBaseline,
        currentVad: getCompositeEmotion(emotionState),
        currentAffinity,
        relationship: db.prepare(
          'SELECT relationship_text, is_oath FROM user_relationships WHERE character_id = ?'
        ).get(characterId)?.relationship_text || '',
        relationshipOath: db.prepare(
          'SELECT is_oath FROM user_relationships WHERE character_id = ?'
        ).pluck().get(characterId) || 0,
        prevUser,
        prevAssistant,
        summary: summaryRow?.summary || '',
        userName: chatUserName,
        characterName: character?.display_name || '角色',
      };
      emotionPromise = evaluateStimulus(message, fullContent, evalContext);
      emotionCleanup = { emotionState, emotionBaseline, currentAffinity };

      // 挂载 .then()：算完立刻推送 SSE + 写 DB，不等生图
      emotionPromise.then(r => {
        if (!r) return;
        const { delta, dominantEmotion, affinityDelta, reason, source } = r;
        const evolved = evolveEmotion(emotionCleanup.emotionState, delta, emotionCleanup.emotionBaseline);
        const newAffinity = evolveAffinity(emotionCleanup.currentAffinity, affinityDelta ?? 0);
        saveEmotionSnapshot(conversationId, lastInsertRowid, evolved, dominantEmotion, newAffinity, affinityDelta, reason);
        saveAffinity(characterId, newAffinity);
        if (config.features.realtimeAffinityDisplay) {
          send('affinity_update', { affinity: newAffinity, affinityDelta: affinityDelta ?? 0, lastReason: reason || '' });
        }
        console.log(`[emotion]\n${emotionDashboard(evolved, dominantEmotion, newAffinity, affinityDelta, source, reason)}`);
      }).catch(err => {
        console.error('[chat] emotion evaluation error:', err.message);
      });
    }

    // 10. 生图判断 ← 同步决策 + 异步发射（与预测、情绪三路并行发射 LLM 调用）
    let imageGenPromise = null;
    if (tags.prompt) {
      // 路径 A: 模型直接输出了 {"prompt":"..."}（正则强匹配 → 或模型自主决定）
      const db2 = getDb();
      const taskResult = db2.prepare(`INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status) VALUES (?, ?, ?, 'running')`)
        .run(conversationId, tags.prompt, tags.prompt);
      const genTaskId = taskResult.lastInsertRowid;
      send('generate_start', { taskId: genTaskId, prompt: tags.prompt });
      imageGenPromise = triggerImageGeneration(conversationId, tags.prompt, lastInsertRowid, genTaskId, send, allRefIds);
    } else if (hasNeedImageTag) {
      // 路径 B: 模型追加了 <needImage>，需要二次请求获取 prompt
      // 提前创建 task + 发送 generate_start，前端立即显示遮罩层
      const preTaskId = createPreparingTask(conversationId);
      send('generate_start', { taskId: preTaskId });
      imageGenPromise = handleNeedImageFlow(conversationId, character, send, preTaskId);
    } else if (force_image_gen) {
      // 路径 D: 强制生图 — 用户主动勾选，跳过智能判断
      console.log('[chat] force image gen: user requested, triggering needImage flow');
      const preTaskId = createPreparingTask(conversationId);
      send('generate_start', { taskId: preTaskId });
      imageGenPromise = handleNeedImageFlow(conversationId, character, send, preTaskId);
    } else if (explicitImageIntent) {
      // 正则强匹配命中 → 跳过判断助手，直接走 handleNeedImageFlow
      console.log('[chat] regex intent hit: skipping judge, triggering needImage flow');
      const preTaskId = createPreparingTask(conversationId);
      send('generate_start', { taskId: preTaskId });
      imageGenPromise = handleNeedImageFlow(conversationId, character, send, preTaskId);
    } else if ((imageJudgeCounters.get(conversationId) ?? 3) <= 0) {
      // 路径 E: 计数器归零 → 强制生图
      console.log('[chat] counter forced: skipping judge, triggering needImage flow');
      const preTaskId = createPreparingTask(conversationId);
      send('generate_start', { taskId: preTaskId });
      imageGenPromise = handleNeedImageFlow(conversationId, character, send, preTaskId);
    } else {
      // 路径 C: 静默判断（系统强制开启）
      imageGenPromise = (async () => {
        try {
          const needImage = await judgeImageNeed(conversationId);
          if (needImage) {
            console.log('[chat] auto judge: image needed, triggering needImage flow');
            // ★ judge 返回 YES 瞬间 → 立即创建 task + send generate_start，前端立刻显示遮罩层
            const preTaskId = createPreparingTask(conversationId);
            send('generate_start', { taskId: preTaskId });
            const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
            await handleNeedImageFlow(conversationId, char, send, preTaskId);
          }
        } catch (err) {
          console.error('[chat] auto judge error:', err.message);
        }
      })();
    }

    // 结算回复猜想（三路已同时发射，此时大概率已完成；失败静默不阻塞后续）
    if (guessPromise) {
      try {
        const guesses = await guessPromise;
        if (guesses) {
          send('guesses', guesses);
          guessCooldowns.set(conversationId, guessCooldownStart + 20_000);
        }
      } catch (err) {
        console.error('[chat] guess generation error:', err.message);
      }
    }

    // 结算生图
    if (imageGenPromise) {
      try {
        await imageGenPromise;
      } catch (err) {
        console.error('[chat] image generation error:', err.message);
      }
    }

    // 兜底等待情绪评估（三路中最后一条保底，3s 超时）
    if (emotionPromise) {
      try {
        await Promise.race([
          emotionPromise,
          new Promise(resolve => setTimeout(() => resolve(null), 3000)),
        ]);
      } catch (err) {
        console.error('[chat] emotion evaluation error:', err.message);
      }
    }

    // 12. 后处理（异步，不依赖 SSE 连接）
    setImmediate(async () => {
      try {
        // 12.0 重置主动聊天计时器：用户刚聊完，防止立即触发主动消息
        if (config.features.proactiveChat) {
          try {
            const currentAffinity = loadAffinity(characterId);
            const baseline = JSON.parse(character.emotion_baseline || '{"valence":0.5,"arousal":0.5,"dominance":0.5}');
            const currentEmotion = loadEmotionState(conversationId, baseline);
            const compositeVad = getCompositeEmotion(currentEmotion);
            // hoursSince=0: 刚聊完，timeScore 极低 → 整体 score 偏低 → 间隔较长
            const score = computeProactiveScore(0, currentAffinity, compositeVad);
            updateNextProactiveAt(characterId, score);
          } catch (err) {
            console.error('[chat] Failed to reset next_proactive_at:', err.message);
          }

        }

        if (config.features.memory) {
          await curateChatMemories({
            conversationId,
            throughRawMsgId: rawMsgId,
            characterPrompt: character.base_prompt,
            characterName: character.display_name,
            userName: chatUserName,
          });
        }
        // 用户画像提取（每 10 条用户消息触发，无 feature flag 始终开启）
        await maybeExtractPortrait(conversationId, characterId);
        await maybeSummarize(conversationId, {
          characterName: character?.display_name,
          userName: chatUserName,
        });
      } catch (err) {
        console.error('[chat] post-processing error:', err.message);
      }
    });

  } catch (err) {
    console.error('Chat error:', err);
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

// ── helpers ──

function extractImageTags(content) {
  // 先尝试原始 ASCII 引号匹配
  const re = /\{"prompt"\s*:\s*"((?:[^"\\]|\\.)*)"\}/i;
  const jsonMatch = content.match(re);
  if (jsonMatch) return { prompt: jsonMatch[1].replace(/\\"/g, '"').trim() };

  // 兜底：将智能弯引号规范化为 ASCII 引号后重试
  // LLM 偶尔会输出 " (U+201C) / " (U+201D) 等弯引号替代 "
  const normalized = content
    .replace(/[“”„‟＂]/g, '"')
    .replace(/[‘’‚‛＇]/g, "'");
  const retryMatch = normalized.match(re);
  if (retryMatch) return { prompt: retryMatch[1].replace(/\\"/g, '"').trim() };

  return { prompt: null };
}

function hasNeedImage(content) {
  return /<needImage>/i.test(content);
}


function stripTags(content) {
  return content
    // 完整 JSON prompt 标签：处理 {"prompt":"..."} 和 {“prompt“:"..."} 等变体
    .replace(/\{[“”"]?prompt[“”"]?\s*:\s*[“”"](?:[^“”"]|\\[“”"])*[“”"]\}/gi, '')
    // 兜底：闸门漏过的未闭合或格式异常的 prompt 标签（从 {prompt": 开始清到行尾）
    .replace(/\{[“”"]?prompt[“”"]?\s*:\s*[“”"].*$/gm, '')
    .replace(/<generate>[\s\S]*?<\/generate>/gi, '')
    .replace(/<needImage>/gi, '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * 清洗括号动作描写（形如 "（兴奋地跳起来）"、"（语气温柔地）" 等舞台指示格式）
 * 正则说明：匹配中文全角括号内包含动词/形容词/神态/语气描述的内容
 */
function stripBracketActions(text) {
  if (!text) return text;
  // 匹配（...）内含动作/表情/语气/神态描写的括号块
  // 关键词: 地/着/一/眼/音/气/情/笑/脸/手/头/身/过/到/说/道/想/觉/动/跳/摇/点/看/回/转/愣/露/叹/拍/挥/伸/退/走/跑/坐/站/低/抬/转/指/瞪/闭/睁/留
  // 包含这些词且括号内字符数 ≥ 3 的视为动作描写
  const actionKeywords = /地|着|了|一下|起来|变得|露出|低头|抬头|眼睛|语气|声音|表情|笑容|身子|突然|轻轻|微微|有些|略带|伸手|脚步|转身|手指|目光|一眼|看了|说道|想到|觉得|动作|跳了|摇了|点了|看了|回了|转了|愣了|露了|叹了口气|拍了拍|挥了|指了指|伸了|退了|走了|跑了|坐了|站了|低了抬头|转了身|指了指|瞪了|闭了|睁了|留了/;
  return text.replace(/（[^）]{3,60}?）/g, (match) => {
    // 检查括号内容是否含动���/表情关键词
    const inner = match.slice(1, -1); // 去掉括号
    if (actionKeywords.test(inner)) {
      return ''; // 移除
    }
    return match; // 保留非动作括号（如补充说明）
  }).replace(/\n{3,}/g, '\n\n').trim();
}


function getDefaultPrompt() {
  return `你是一个创意图像生成助手。用户会和你聊天，描述他们想生成的图像。
你可以帮助优化图像描述，使其更适合 AI 图像生成。
请用中文回复，语气友好而专业。`;
}

/**
 * 创建 pending 状态的 image_tasks 行，用于提前发送 generate_start
 * 让前端在 judge / needImage 二次 LLM 调用期间就显示遮罩层
 */
function createPreparingTask(conversationId) {
  const db = getDb();
  const result = db.prepare(`INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status) VALUES (?, '', '', 'pending')`)
    .run(conversationId);
  return result.lastInsertRowid;
}

function failPreparingTask(taskId, errorMessage) {
  if (taskId == null) return;
  getDb().prepare(`
    UPDATE image_tasks
    SET status = 'failed', error_message = ?, finished_at = datetime('now')
    WHERE id = ? AND status IN ('pending', 'running')
  `).run(errorMessage, taskId);
}

/**
 * 静默判断：给定最近对话，是否需要配一张图片增强表达
 * 极轻量 DeepSeek 调用（只需"是/否"），延迟通常 < 300ms
 */
async function judgeImageNeed(conversationId) {
  const db = getDb();
  // 直接从 raw_messages 取最后一条用户/Agent 完整消息，无需合并
  const lastUser = db.prepare(`
    SELECT content FROM raw_messages
    WHERE conversation_id = ? AND role = 'user'
    ORDER BY id DESC LIMIT 1
  `).get(conversationId);

  const lastAssistant = db.prepare(`
    SELECT content FROM raw_messages
    WHERE conversation_id = ? AND role = 'assistant'
    ORDER BY id DESC LIMIT 1
  `).get(conversationId);

  if (!lastUser && !lastAssistant) return false;

  const parts = [];
  if (lastUser) parts.push(`用户: ${lastUser.content.slice(0, 400)}`);
  if (lastAssistant) parts.push(`Agent: ${lastAssistant.content.slice(0, 600)}`);
  const ctx = parts.join('\n');

  try {
    const result = await chatSync([
      { role: 'system', content: JUDGE_PROMPT },
      { role: 'user', content: ctx },
    ], { temperature: 0, max_tokens: 5, label: '判断需要图片' });

    const verdict = result.trim().startsWith('是');
    console.log(`[chat] judgeImageNeed: ${verdict ? 'YES' : 'no'} (response: "${result.trim().slice(0, 20)}")`);
    return verdict;
  } catch (err) {
    console.error('[chat] judgeImageNeed error:', err.message);
    return false; // 失败时默认不生图（安全侧）
  }
}

async function triggerImageGeneration(conversationId, prompt, assistantMsgId, taskId, send, crossRefCharIds = []) {
  const db = getDb();

  // 查找角色 lora 设置
  let loraOpts = {};
  try {
    const charId = parseInt(String(conversationId).replace(/^char_/, ''), 10);
    if (!Number.isNaN(charId)) {
      const char = db.prepare('SELECT custom_workflow, loras, artist_override FROM characters WHERE id = ?').get(charId);
      if (char) {
        const loras = _parseLoras(char);
        if (loras.length > 0 || char.custom_workflow || charArtistOverride(char) !== null) {
          const opts = {};
          if (char.custom_workflow) opts.customWorkflow = char.custom_workflow;
          if (loras.length > 0) opts.loras = loras;
          const charArtist = charArtistOverride(char);
          if (charArtist !== null) opts.artist = charArtist;
          loraOpts = opts;
          console.log(`[chat] Lora enabled for char ${charId}:${opts.customWorkflow ? ' custom=' + opts.customWorkflow : ''}${opts.loras ? ` ${opts.loras.length} lora(s) — ${opts.loras.map(l => l.path).join(', ')}` : ''}`);
        }
      }
    }
  } catch (e) {
    console.log('[chat] Failed to load lora settings:', e.message);
  }

  // 合并交叉引用角色 LoRA（去重，主角色优先）
  if (crossRefCharIds.length > 0) {
    const crossChars = crossRefCharIds.map(id => db.prepare('SELECT loras, artist_override FROM characters WHERE id = ?').get(id)).filter(Boolean);
    const crossLoras = crossChars.flatMap(c => _parseLoras(c));
    if (crossLoras.length > 0) {
      const allLoras = [...(loraOpts.loras || []), ...crossLoras];
      const seen = new Set();
      loraOpts.loras = allLoras.filter(l => {
        if (seen.has(l.path)) return false;
        seen.add(l.path);
        return true;
      });
      console.log(`[chat] Cross-ref loras merged: +${crossLoras.length} from chars [${crossRefCharIds.join(',')}], total ${loraOpts.loras.length}`);
    }
    // 主角色未设置单独画师串时，回退到第一个设置了画师串的交叉引用角色
    if (loraOpts.artist === undefined) {
      const fallbackChar = crossChars.find(c => charArtistOverride(c) !== null);
      if (fallbackChar) loraOpts.artist = charArtistOverride(fallbackChar);
    }
  }

  try {
    const result = await generateImage(prompt, {
      scene: 'chat',
      ragTimeoutMs: RAG_TIMEOUT_FAST_MS,
      onProgress: (p) => {
        if (p.stage === 'retrying') {
          send('generate_retrying', { taskId, attempt: p.attempt, maxRetries: p.maxRetries });
        } else {
          send('generate_progress', { taskId, ...p });
        }
      },
      ...loraOpts,
    });
    if (result.success && result.images.length > 0) {
      const urls = [];
      for (const img of result.images) {
        const ts = Date.now();
        const filename = `${ts}_${img.filename || 'comfy.png'}`;
        const url = saveBase64Image('chat', filename, img.base64);
        urls.push(url);
        img.url = url;
      }

      // 使相册缓存失效
      invalidateGalleryCache();

      // 更新消息：挂上图片 URL
      const updateResult = db.prepare(`UPDATE messages SET images = ? WHERE id = ?`)
        .run(JSON.stringify(urls), assistantMsgId);
      console.log(`[chat] images saved to message id=${assistantMsgId}, rows updated=${updateResult.changes}`);

      db.prepare(`UPDATE image_tasks SET status='done', prompt_refined=?, output_paths=?, workflow_template=?, finished_at=datetime('now') WHERE id=?`)
        .run(result.promptRefined || prompt, JSON.stringify(urls), result.wfMode, taskId);

      send('generate_done', { taskId, images: result.images, source: result.source });

      // 生图成功 → 智能配图计数器重置为 3
      imageJudgeCounters.set(conversationId, 3);
      console.log(`[chat] imageJudgeCounter[${conversationId}] reset to 3 (image generated successfully)`);
    } else {
      throw new Error(result.error || 'No images generated');
    }
  } catch (err) {
    console.error('[chat] generate failed:', err.message);
    db.prepare(`UPDATE image_tasks SET status='failed', error_message=?, workflow_template=?, finished_at=datetime('now') WHERE id=?`)
      .run(err.message, getLastWorkflowMode(), taskId);
    send('generate_error', { taskId, error: err.message });
  }
}

/**
 * needImage 二次触发流程:
 *   模型自主判断用户想要图片 → 追加了 <needImage> →
 *   后端再请求一次模型，让它补上 {"prompt":"..."} →
 *   然后走正常生图流程
 */
async function handleNeedImageFlow(conversationId, character, send, preExistingTaskId = null) {
  const db = getDb();
  console.log('[chat] needImage detected, requesting prompt from model (compact)...');

  // 1. 构建二次请求的消息列表（破限词+生图指令置顶，人格在后）
  const globalRules = getSystemRules({ roleplay: false });
  let personalityPrompt = character?.base_prompt || getDefaultPrompt();
  const imagePromptRule = getGlobalRule('image_prompt');

  // 2. 加载最近 3 轮历史（生图任务只需锚点上下文，取太多稀释注意力）
  const history = db.prepare(`
    SELECT role, content FROM raw_messages
    WHERE conversation_id = ? ORDER BY id DESC LIMIT 6
  `).all(conversationId).reverse();

  // 2.5 扫描历史消息中的交叉角色引用（用于生图 LoRA 合并 + LLM 上下文注入）
  const extractRealContent = (text) => {
    const idx = text.lastIndexOf('</dynamic_context>');
    return idx >= 0 ? text.slice(idx + '</dynamic_context>'.length).trim() : text;
  };
  const historyText = history.map(m => extractRealContent(m.content)).join('\n');
  const latestUser = extractRealContent(history.filter(m => m.role === 'user').pop()?.content || '');
  const scanText = historyText + '\n' + latestUser;
  const crossMatches = matchAll(scanText, character.id);
  let crossRefCharIdsForImage = [];
  let crossRefImageMsgs = [];
  if (crossMatches.length > 0) {
    const crossChars = crossMatches.slice(0, 3).map(m =>
      db.prepare('SELECT id, display_name, short_prompt, base_prompt, loras FROM characters WHERE id = ?').get(m.id)
    ).filter(Boolean);

    const crossBlocks = crossChars.map(c => {
      const info = extractImageCrossRefInfo(c);
      return `[${c.display_name}]\n${info}`;
    }).join('\n\n');

    crossRefImageMsgs.push({
      role: 'system',
      content: `【画面交叉参考】以下角色的身份与外观信息必须体现在生成的画面中：\n\n${crossBlocks}`
    });

    crossRefCharIdsForImage = crossChars.map(c => c.id);
  }

  const formatGuide = imagePromptRule?.rule_content || '';

  // 用户关系描述（供生图参考，体现角色与 user 的关系）
  let userRelationContent = '';
  const userRel = db.prepare(
    'SELECT relationship_text, is_oath FROM user_relationships WHERE character_id = ?'
  ).get(character.id);
  if (userRel && userRel.relationship_text) {
    userRelationContent = `\n\n【你和user的关系】你是user的${userRel.relationship_text}。在生成包含你和user的合照或互动场景时，请通过人物姿态、表情、距离等方式体现这层关系。`;
  }
  if (userRel && userRel.is_oath) {
    const ringUserName = config.user.nickname || 'user';
    personalityPrompt = appendOathRing(personalityPrompt, character.id, ringUserName, { isFirstPerson: true });
  }

  // ── 环境参考（Environment reference，置于 schedule 之前）──
  const weatherHint = (() => {
    try {
      const note = getLightNoteWithWeather();
      return note ? `Environment reference：${note}。` : '';
    } catch { return ''; }
  })();

  // ── 日程/状态上下文（不含天气光线，避免与 Environment reference 重复）──
  const scheduleCtx = (() => {
    try {
      const activity = getCurrentActivity(character.id);
      const tempWoken = isTempWoken(character.id);

      if (tempWoken) {
        const db = getDb();
        const wakeMode = db.prepare('SELECT wake_mode FROM characters WHERE id = ?').get(character.id)?.wake_mode;
        const userName = config.user.nickname || '用户';
        let wakeDesc;
        if (wakeMode === 'phone') {
          wakeDesc = `你被${userName}的电话吵醒了，脑袋昏沉沉的。半睁着眼，睡眼惺忪，手机屏幕亮着，正在打哈欠，靠在床上看着手机。`;
        } else if (wakeMode === 'door' || wakeMode === 'shake') {
          const userAppearance = config.user.appearance ? `（${config.user.appearance}）` : '';
          wakeDesc = `${userName}${userAppearance}紧急冲到你家把你叫醒了，你迷迷糊糊地睁开眼。${userName}用各种方式把你吵醒/摇醒了，你半坐在床上，穿着睡衣。**画面富有动感，动作激烈**`;
        } else {
          wakeDesc = `你刚被叫醒，脑袋还昏沉沉的。`;
        }
        const locStr = activity?.location ? `，正在【${activity.location}】附近` : '';
        return '【当前状态】' + wakeDesc + locStr;
      }

      if (!activity || !activity.activity || activity.activity === '自由时间') return '';
      return '【当前日程】你正在【' + activity.location + '】' + activity.activity + '。' + (activity.description ? activity.description + '。' : '');
    } catch { return ''; }
  })();

  // ── 画面规则 + 环境参考 + 日程上下文（去重：天气仅由 Environment reference 提供）──
  const formatGuideWithWeather = formatGuide
    ? formatGuide + (weatherHint ? '\n\n' + weatherHint : '') + (scheduleCtx ? '\n\n' + scheduleCtx : '')
    : (weatherHint || scheduleCtx ? (weatherHint || '') + (scheduleCtx ? '\n\n' + scheduleCtx : '') : '');

  const userName = config.user.nickname || '用户';
  const lastTurnDialogue = (() => {
    const lastAssistantMsg = [...history].reverse().find(m => m.role === 'assistant');
    const lastUserMsg = [...history].reverse().find(m => m.role === 'user');
    const lines = [];
    if (lastUserMsg) lines.push(`${userName}: ${extractRealContent(lastUserMsg.content)}`);
    if (lastAssistantMsg) lines.push(`${character?.display_name || '角色'}: ${extractRealContent(lastAssistantMsg.content)}`);
    return lines.join('\n');
  })();
  const msgs = [
    // ── 首因效应：生图输出格式要求，最先一条 system 消息 ──
    { role: 'system', content: (globalRules ? globalRules + '\n\n' : '') + `【当前画面生成规则·最高优先级】
【最后一轮对话】是当前配图的唯一任务来源，必须先独立判断它实际要求描述变化完成后的最终状态。
【上一次画面环境描述】仅是可选的连续性参考，不是当前画面的默认模板，也不代表其中任何环境、构图或人物状态需要继续保留。
先根据最后一轮对话完整确定当前画面，再检查上一次画面；只有与当前意图明确相关、没有冲突且确有连续性价值的细节才可保留。无法确定是否需要保留时，一律不保留。
最后一轮对话直接或间接产生任何变化时，必须采用变化完成后的最终状态，彻底舍弃被替换的旧状态；禁止把新旧画面折中、叠加或并列描述。` },
    // ── 用户形象（建立 user↔用户名的映射，紧随最高指令之后让 LLM 明确画面对象）──
    ...(() => {
      const hasUserInfo = config.user.nickname || config.user.gender || config.user.appearance || config.user.persona;
      if (!hasUserInfo) return [];
      const u = config.user;
      const userName = u.nickname || '用户';
      const parts = [];
      parts.push(`对话中另一个人是"${userName}"`);
      if (u.gender) parts.push(`**性别：${u.gender}**（这是不可变更的事实，不受角色关系或场景影响）`);
      if (u.appearance) parts.push(`外观特征：${u.appearance}`);
      if (u.persona) parts.push(`其他说明：${u.persona}`);
      return [{
        role: 'system',
        content: `【对话对象】${parts.join('。')}。当你生成关于${userName}的图片（例如合照，互动的场景）的时候，需要严格遵循以上${userName}的特征，尤其是性别和外观。${userRelationContent}`
      }];
    })(),
    // ── 画面规则 + 环境参考（天气/光线/日程已整合到规则提示词中）──
    ...(formatGuideWithWeather ? [{ role: 'system', content: formatGuideWithWeather }] : []),
    // ── 人格（让 prompt 内容贴合角色）──
    { role: 'system', content: personalityPrompt },
    // ── 交叉角色生图上下文（在历史上下文之前，确保最后一个 system 聚焦对话）──
    ...crossRefImageMsgs,
    // ── 对话上下文（仅历史背景；最后一轮对话放入最终 user 消息）──
    // 同时剥离历史 prompt JSON 避免 token 浪费，并提取最近一轮 prompt 作为【上一次画面描述】
    ...(() => {
	    // 移除消息中任意位置的 {"prompt":"..."} JSON 块（支持弯引号变体，不锚定 $）
	    const stripPrompt = (content) => {
	      return content.replace(/\s*\{["'“”「」]?prompt["'“”「」]?\s*:\s*"[^]*?"\s*\}/g, '').trim();
	    };
      const extractPrompt = (content) => {
        // 提取完整的 {"prompt":"..."} JSON 块（保留格式头，用于【上一次画面描述】）
        const allMatches = [...content.matchAll(/\{["'“”「」]?prompt["'“”「」]?\s*:\s*"([^]*?)"\s*\}/g)];
        if (allMatches.length === 0) return null;
        return allMatches[allMatches.length - 1][0].trim();
      };

      const lastAssistantMsg = [...history].reverse().find(m => m.role === 'assistant');
      const lastUserMsg = [...history].reverse().find(m => m.role === 'user');
      const excludeSet = new Set([lastAssistantMsg, lastUserMsg].filter(Boolean));
      const filteredHistory = history.filter(m => !excludeSet.has(m));

      // 从历史 assistant 消息中提取最近一轮的 prompt，同时剥离所有 prompt JSON
      let lastScenePrompt = null;
      const cleanedHistory = filteredHistory.map(m => {
        const cleaned = stripPrompt(m.content);
        if (m.role === 'assistant') {
          const extracted = extractPrompt(m.content);
          if (extracted) lastScenePrompt = extracted;  // 持续覆盖，最终保留最新一轮
        }
        return { ...m, content: cleaned };
      });

      if (cleanedHistory.length === 0) return [];

      const contextBlock = {
        role: 'system',
        content: '【对话上下文】\n' + cleanedHistory.map(m => {
          const userName = config.user.nickname || '用户';
          const label = m.role === 'user' ? userName : (character?.display_name || '角色');
          return `${label}: ${m.content}`;
        }).join('\n\n')
        };

      // 如果存在上一轮画面，将它与历史对话合并为同一条 system 消息。
      if (lastScenePrompt) {
        contextBlock.content = `【上一次画面环境描述·仅供参考环境】：
下面是上一张图片的描述，不是本轮必须继承的状态。不要复述或照搬它。只有当【最后一轮对话】明确延续同一画面时，才选择性保留未被改变的必要细节；如果最后一轮能够独立构成新画面，或没有明确要求延续，则忽略下面的全部内容：
${lastScenePrompt}

${contextBlock.content}`;
      }
      return [contextBlock];
    })(),
    { role: 'user', content: `${lastTurnDialogue ? `【最后一轮对话】\n${lastTurnDialogue}\n\n` : ''}【当前任务】\n直接输出英文画面描述来描述【最后一轮对话】对应的配图。仅当最后一轮对话对应的画面需要出现${userName}时，才描述并使用${userName}的外观；否则不要让${userName}出现在画面中，也不要描述其特征。不要任何格式包装或额外文字。` },
  ];

  // 3. 静默请求模型生成 prompt（不流式，避免前端气泡混乱）
  let fullContent = '';
  try {
    fullContent = await requestNonEmptyImagePrompt(
      () => chatSync(msgs, { temperature: 0.7, max_tokens: 1024, label: '生图' }),
      {
        emptyRetries: 1,
        onEmpty: () => console.warn('[chat] needImage follow-up returned empty content, retrying once...'),
      }
    );
    console.log(`[chat] needImage follow-up response: ${fullContent.slice(0, 80)}...`);
  } catch (err) {
    console.error('[chat] needImage follow-up error:', err.message);
    failPreparingTask(preExistingTaskId, `生图请求失败: ${err.message}`);
    send('generate_error', { taskId: preExistingTaskId, error: '生图请求失败' });
    return;
  }

  // 4. 先验证 prompt，再写入 raw_messages/messages，避免空 assistant 消息。
  const prompt = extractImagePromptResponse(fullContent);
  if (!prompt) {
    console.warn('[chat] needImage: failed to extract prompt, raw:', fullContent.slice(0, 120));
    failPreparingTask(preExistingTaskId, '模型未返回图像描述');
    send('generate_error', { taskId: preExistingTaskId, error: '模型未返回图像描述' });
    return;
  }
  const tags = { prompt };

  let displayContent = stripTags(fullContent);
  // 独立生图调用的输出全是 prompt 文本，不展示为对话气泡
  if (tags.prompt) displayContent = '';

  let assistantRawId;
  let assistantMsgId;
  let merged = false;  // 是否拼回上一条（不新建 message）

  if (!displayContent && tags.prompt) {
    // 模型只输出纯 JSON，无正文 → 优先拼回上一条 raw_messages
    const prevRaw = db.prepare(`SELECT id, prompt FROM raw_messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1`)
      .get(conversationId);
    const prevMsg = db.prepare(`SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1`)
      .get(conversationId);

    if (prevRaw && !prevRaw.prompt) {
      // 上一条无 prompt → UPDATE raw.prompt + content 拼入 JSON，图片挂到上一条 message
      const promptJson = JSON.stringify({ prompt: tags.prompt });
      db.prepare(`UPDATE raw_messages SET prompt = ?, content = content || ? WHERE id = ?`).run(tags.prompt, promptJson, prevRaw.id);
      assistantRawId = prevRaw.id;
      assistantMsgId = prevMsg?.id;
      merged = true;
      console.log(`[chat] needImage: merged prompt into raw=${prevRaw.id}, msg=${assistantMsgId}`);
    } else {
      // 上一条已有 prompt → 兜底：新写 raw，后端组装 {"prompt":"..."} 格式
      const promptJson = JSON.stringify({ prompt: tags.prompt });
      const rawContent = `(图片) ${promptJson}`;
      const rawResult = db.prepare(`INSERT INTO raw_messages (conversation_id, role, content, prompt) VALUES (?, 'assistant', ?, ?)`)
        .run(conversationId, rawContent, tags.prompt);
      assistantRawId = rawResult.lastInsertRowid;
      console.log(`[chat] needImage: prev raw already has prompt, saved as new raw id=${assistantRawId}`);
    }
  } else {
    // 正常：有正文（无论有无 prompt）→ 经 SentenceSplitter 分句
    if (displayContent) {
      const splitter = new SentenceSplitter();
      const { segments: feedSegs } = splitter.feed(displayContent);
      const { segments: flushSegs } = splitter.flushAll();
      const allSegments = [...feedSegs, ...flushSegs]
        .map(s => stripBracketActions(s).trim())
        .filter(Boolean);

      for (const segText of allSegments) {
        send('token', { content: segText });
        send('bubble_break', {});
        await sleep(typingDelay(segText));
      }
      // 更新 displayContent 为清洗后的分段文本，供下方 messages 表写入
      displayContent = allSegments.join('\n\n');
    }
    const promptJson = tags.prompt ? JSON.stringify({ prompt: tags.prompt }) : '';
    const rawContent = tags.prompt
      ? `(图片) ${promptJson}`
      : fullContent.replace(/<needImage>/gi, '').trim();
    const rawResult = db.prepare(`INSERT INTO raw_messages (conversation_id, role, content, prompt) VALUES (?, 'assistant', ?, ?)`)
      .run(conversationId, rawContent, tags.prompt || null);
    assistantRawId = rawResult.lastInsertRowid;
  }

  // 保存 messages（展示用）—— merge 路径不新建 message
  if (!merged) {
    // 按句子分段保存（与主流程一致）
    const segments = (displayContent || '').split('\n\n').filter(Boolean);
    if (segments.length > 0) {
      for (let i = 0; i < segments.length; i++) {
        const msgResult = db.prepare(`INSERT INTO messages (conversation_id, raw_id, role, content, seq) VALUES (?, ?, 'assistant', ?, ?)`)
          .run(conversationId, assistantRawId, segments[i], i);
        if (i === segments.length - 1) {
          assistantMsgId = msgResult.lastInsertRowid;
        }
        send('msg_saved', { id: msgResult.lastInsertRowid, role: 'assistant', created_at: new Date().toISOString() });
      }
    } else {
      const msgResult = db.prepare(`INSERT INTO messages (conversation_id, raw_id, role, content, seq) VALUES (?, ?, 'assistant', ?, 0)`)
        .run(conversationId, assistantRawId, displayContent || '');
      assistantMsgId = msgResult.lastInsertRowid;
      send('msg_saved', { id: assistantMsgId, role: 'assistant', created_at: new Date().toISOString() });
    }
  }
  console.log(`[chat] needImage: msgId=${assistantMsgId}, rawId=${assistantRawId}, merged=${merged}, hasPrompt=${!!tags.prompt}`);

  // 5. 触发生图
  if (tags.prompt) {
    let genTaskId;
    if (preExistingTaskId) {
      // 使用预先创建的 task，更新 prompt 和状态
      db.prepare(`UPDATE image_tasks SET prompt_original=?, prompt_refined=?, status='running' WHERE id=?`)
        .run(tags.prompt, tags.prompt, preExistingTaskId);
      genTaskId = preExistingTaskId;
      // generate_start 已经在 judge/needImage 判定时发送，不再重复
    } else {
      const taskResult = db.prepare(`INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status) VALUES (?, ?, ?, 'running')`)
        .run(conversationId, tags.prompt, tags.prompt);
      genTaskId = taskResult.lastInsertRowid;
      send('generate_start', { taskId: genTaskId, prompt: tags.prompt });
    }
    await triggerImageGeneration(conversationId, tags.prompt, assistantMsgId, genTaskId, send, crossRefCharIdsForImage);
  } else {
    console.log('[chat] needImage follow-up: no prompt tags found, falling back');
    send('generate_error', { taskId: preExistingTaskId, error: '模型未返回图像描述' });
  }
}

/**
 * 回复猜想：根据最近对话预测用户接下来最可能回复的两句话
 * 独立轻量 LLM 调用（~200 tokens），不影响主回复质量
 */
async function generateReplyGuesses(conversationId, character) {
  const db = getDb();

  // 取最近 1 轮（2 条 raw_messages）作为上下文
  const history = db.prepare(`
    SELECT role, content FROM raw_messages
    WHERE conversation_id = ?
    ORDER BY id DESC LIMIT 2
  `).all(conversationId).reverse();

  if (history.length === 0) return null;

  // 角色人设（short_prompt 已裁剪并替换过 "你"→"assistant"）
  const personalityBrief = character?.short_prompt || '';

  // msgs[0] — 舞台：破限词 + 世界观（不含 roleplay，避免预测助手站错角色）
  const jailbreak = getSystemRules({ roleplay: false });
  let worldSetting = getWorldSetting();
  if (worldSetting && worldSetting.length > 500) {
    worldSetting = worldSetting.slice(0, 500);
  }
  const stageContent = [jailbreak, worldSetting].filter(Boolean).join('\n\n');

  // msgs[1] — 任务：预测指令（先定义任务） + 角色背景（后补充上下文）
  const taskParts = [];
  taskParts.push(`你是一个对话预测助手。你的任务是预测**用户（user）**接下来最可能回复的两句话。

⚠️ 重要：你要预测的是 user 的回复，**绝对不要**预测 assistant 会说什么。对话最后一条是 assistant 说的，你预测的必须是 user 对这句话的回应——不要把 assistant 的话接下去。

规则：
1. A 和 B 必须是不同方向的回复——不能是同一个意思的两种说法。例如：A 延续当前话题深入，B 切换视角或融入世界观表达不同态度
2. 每条 5~25 个汉字，像网友聊天一样自然口语化，思维跳脱但又合理，不要过于书面化或公式化
3. 直接输出 JSON，不要任何解释

输出格式：
{"a":"<猜想A>","b":"<猜想B>"}

示例：
对话中assistant说"走吧，我们出门吃晚饭？"
输出：{"a":"好耶，我想吃火锅！","b":"不了吧，我们点外卖吃吃就好"}`);

  if (personalityBrief) {
    taskParts.push(`【仅供了解对话背景，你要预测的是用户（user）会怎么回应这个角色，不要模仿这个角色的语气说话】\n对话中assistant的角色设定：${personalityBrief}`);
  }

  // 过滤掉 assistant 消息中的生图 prompt JSON（可能在开头/中间/末尾），避免干扰预测
  const cleanedHistory = history.map(msg => {
    if (msg.role === 'assistant') {
      return {
        ...msg,
        content: msg.content.replace(/\s*\{["']prompt["']:\s*"(?:[^"\\]|\\.)*"\s*\}/gs, '')
      };
    }
    return msg;
  });

  const msgs = [];
  if (stageContent) msgs.push({ role: 'system', content: stageContent });
  msgs.push({ role: 'system', content: taskParts.join('\n\n') });
  msgs.push(...cleanedHistory);

  msgs.push({ role: 'user', content: '请根据以上对话，预测user接下来最可能回复的两句话。只输出 JSON：' });

  try {
    const result = await chatSync(msgs, { temperature: 0.7, max_tokens: 128, response_format: { type: 'json_object' }, label: '预测' });
    console.log(`[chat] generateReplyGuesses raw response: ${result.slice(0, 120)}`);

    // 尝试提取 JSON 对象
    const jsonMatch = result.match(/\{\s*"a"\s*:\s*"([^"]*)"\s*,\s*"b"\s*:\s*"([^"]*)"\s*\}/);
    if (jsonMatch) {
      return { a: jsonMatch[1], b: jsonMatch[2] };
    }
    // 回退：尝试直接 parse
    try {
      const parsed = JSON.parse(result.trim());
      if (parsed.a && parsed.b) return { a: parsed.a, b: parsed.b };
    } catch {}
    return null;
  } catch (err) {
    console.error('[chat] generateReplyGuesses error:', err.message);
    return null;
  }
}

// ── 供 characters.js 调用的清理函数 ──
export function clearImageJudgeCounter(charId) {
  imageJudgeCounters.delete(`char_${charId}`);
}

/**
 * 使用 LLM 生成睡眠场景的生图 prompt
 * 复用日程瞄一眼的 prompt 工程模式：人格 + 时间光线 + 睡眠约束 + image_prompt 规则
 */
async function generateSleepPrompt(character) {
  const charName = character.display_name;

  // 命中缓存
  const cached = sleepPromptCache.get(character.id);
  if (cached) {
    console.log(`[chat] sleep prompt cache hit for ${charName}`);
    return cached;
  }

  const timeLightInline = getTimeLightInline();
  const sleepNote = '【极其重要】角色正在睡觉，双眼必须紧闭，**房间里没有灯光，睡觉时候不开灯**，不能睁眼。表情安详放松，呈现深度睡眠的自然状态，盖被子。睡姿、床、被子、**睡衣（睡觉时候绝对不会穿本来的衣服）**等细节贴合角色性格。';

  const imageRulesText = getGlobalRule('image_prompt')?.rule_content || '';
  let personaText = character.base_prompt
    ? character.base_prompt.replace(/你/g, charName)
    : `角色名：${charName}`;

  // 誓约角色：银白细戒指外观细节
  const oathRingUserName = config.user.nickname || 'user';
  personaText = appendOathRing(personaText, character.id, oathRingUserName, { isFirstPerson: false, charName });

  const msgs = [
    { role: 'system', content: `你是一个专业的人像摄影师，现在需要给「${charName}」拍一张睡颜照。照片里的角色正在睡觉。${timeLightInline}。${sleepNote}` },
    { role: 'system', content: personaText },
    { role: 'system', content: `直接输出英文画面描述，不要任何格式包装或额外文字。${imageRulesText ? '\n\n输出要求：\n' + imageRulesText : ''}` },
    { role: 'user', content: `请为「${charName}」拍一张正在睡觉的照片。` },
  ];

  let prompt = '';

  try {
    const rawResult = await chatSync(msgs, {
      temperature: 0.7,
      max_tokens: 512,
      label: '睡眠瞄一眼prompt生成',
    });

    prompt = rawResult.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    if (prompt.length < 5) {
      const promptMatch = rawResult.match(/"prompt"\s*:\s*"([^"]+)"/);
      prompt = promptMatch ? promptMatch[1] : '';
    }

    if (!prompt || prompt.length < 5) {
      prompt = `${charName} sleeping peacefully in bed, eyes closed, covered with blanket, dark room, night time, soft moonlight through window, anime style`;
    }
  } catch (err) {
    console.error(`[chat] generateSleepPrompt failed for ${charName}:`, err.message);
    prompt = `${charName} sleeping peacefully in bed, eyes closed, covered with blanket, dark room, night time, anime style`;
  }

  // 写入缓存
  if (prompt) {
    sleepPromptCache.set(character.id, prompt);
    console.log(`[chat] sleep prompt cached for ${charName}: "${prompt.slice(0, 80)}..."`);
  }

  return prompt;
}

/**
 * 睡眠模式响应：建立 SSE 流，推送 Zzz 消息 + 瞄一眼睡眠图片
 * 不写入 raw_messages（完整消息库），仅作用于 messages（分句展示库）
 */
async function handleSleepMode(res, characterId, conversationId, userMsgId, character, sleepUntil) {
  const db = getDb();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.socket) res.socket.setTimeout(0);
  res.setTimeout(0);
  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  let zzzMsgId = null;
  let genTaskId = null;

  try {
    // 通知前端日程系统角色已进入睡眠
    broadcast('schedule_state_change', {
      character_id: characterId,
      is_sleeping: true,
      sleep_until: sleepUntil,
      temporary_wake_until: null,
      wake_mode: null,
    });

    // 1. 发送用户消息保存确认（不发送 bubble_break，让 Zzz 直接填充 initAttemptState 占位泡，避免空行）
    send('msg_saved', { id: userMsgId, role: 'user', created_at: new Date().toISOString() });

    // 2. 在 messages 表中写入 Zzz 消息（不写入 raw_messages，raw_id = NULL）
    const zzzResult = db.prepare(
      'INSERT INTO messages (conversation_id, raw_id, role, content, seq) VALUES (?, NULL, ?, ?, 0)'
    ).run(conversationId, 'assistant', '(Zzz...)');
    zzzMsgId = zzzResult.lastInsertRowid;

    // 3. 通过 SSE 发送 Zzz 文字气泡
    send('token', { content: '(Zzz...)' });
    send('bubble_break', {});

    // 4. 创建生图任务并发送 generate_start
    const taskResult = db.prepare(
      'INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status) VALUES (?, ?, ?, ?)'
    ).run(conversationId, '', '', 'running');
    genTaskId = taskResult.lastInsertRowid;

    send('generate_start', { taskId: genTaskId });

    // 5. LLM 生成睡眠画面 prompt
    const generatedPrompt = await generateSleepPrompt(character);
    db.prepare('UPDATE image_tasks SET prompt_original = ?, prompt_refined = ? WHERE id = ?')
      .run(generatedPrompt, generatedPrompt, genTaskId);

    // 6. 提交 ComfyUI 生图
    const loras = _parseLoras(character);
    const loraOpts = {};
    if (character.custom_workflow) loraOpts.customWorkflow = character.custom_workflow;
    if (loras.length > 0) loraOpts.loras = loras;
    const charArtist = charArtistOverride(character);
    if (charArtist !== null) loraOpts.artist = charArtist;

    const result = await generateImage(generatedPrompt, {
      scene: 'chat',
      ragTimeoutMs: RAG_TIMEOUT_FAST_MS,
      onProgress: (p) => {
        if (p.stage === 'retrying') {
          send('generate_retrying', { taskId: genTaskId, attempt: p.attempt, maxRetries: p.maxRetries });
        }
        if (p.progress != null) {
          send('generate_progress', { taskId: genTaskId, progress: p.progress, totalSteps: p.totalSteps });
        }
      },
      ...loraOpts,
    });

    // 7. 保存图片并更新 messages 表
    if (result.success && result.images?.length > 0) {
      const urls = [];
      for (const img of result.images) {
        const ts = Date.now();
        const filename = `${ts}_${img.filename || 'comfy.png'}`;
        const url = saveBase64Image('chat', filename, img.base64);
        if (url) {
          urls.push(url);
          img.url = url;
        }
      }

      if (urls.length > 0) {
        db.prepare('UPDATE messages SET images = ? WHERE id = ?')
          .run(JSON.stringify(urls), zzzMsgId);
      }

      db.prepare(`UPDATE image_tasks SET status = 'done', prompt_refined = ?, output_paths = ?, workflow_template = ?, finished_at = datetime('now') WHERE id = ?`)
        .run(result.promptRefined || generatedPrompt, JSON.stringify(urls), result.wfMode || null, genTaskId);

      invalidateGalleryCache();

      send('generate_done', { taskId: genTaskId, images: result.images, source: result.source });
    } else {
      throw new Error(result.error || 'No images generated');
    }
  } catch (err) {
    console.error('[chat] sleep peek error:', err.message);
    if (genTaskId) {
      try {
        db.prepare(`UPDATE image_tasks SET status = 'failed', error_message = ?, finished_at = datetime('now') WHERE id = ?`)
          .run(err.message, genTaskId);
      } catch {}
      send('generate_error', { taskId: genTaskId, error: err.message });
    }
  } finally {
    send('done', {});
    try { res.end(); } catch {}
  }
}

function _parseLoras(char) {
  if (!char.loras) return [];
  try {
    const parsed = typeof char.loras === 'string' ? JSON.parse(char.loras) : char.loras;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(l => l.path && typeof l.path === 'string').map(l => ({
      path: l.path,
      weight: typeof l.weight === 'number' ? l.weight : 0.6,
      triggerWord: l.triggerWord || '',
    }));
  } catch {
    return [];
  }
}

function formatRelativeDay(days) {
  if (days == null) return '之前';
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days === 2) return '前天';
  return `${days}天前`;
}

function extractImageCrossRefInfo(char) {
  const parts = [];
  const short = char.short_prompt || '';
  if (short) {
    let found = false;
    let start = 0;
    for (let i = 0; i < short.length; i++) {
      if (short[i] === '，' || short[i] === '。' || short[i] === '\n') {
        const seg = short.slice(start, i).trim();
        if (seg && seg.includes('来自')) {
          parts.push(short.slice(0, i));
          found = true;
          break;
        }
        start = i + 1;
      }
    }
    if (!found) {
      parts.push(short);
    }
  }
  const base = char.base_prompt || '';
  const m = base.match(/##\s*你的外观/);
  if (m) {
    const name = char.display_name || '';
    parts.push(base.slice(m.index).replace(/你/g, name));
  }
  return parts.join('\n');
}

export default router;
