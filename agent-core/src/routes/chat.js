import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, getGlobalRule, getSystemRules, getWorldSetting, repairFtsIndex } from '../db/index.js';
import { chatStream, chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';
import { hybridSearch } from '../services/memorySearch.js';
import { extractMemoryFragments } from '../services/memoryExtractor.js';
import { deleteByConversation } from '../services/vectorClient.js';
import { maybeSummarize, getRecentSummaries } from '../services/summarizer.js';
import { maybeExtractPortrait } from '../services/portraitExtractor.js';
import {
  loadEmotionState, evolveEmotion, evaluateStimulus,
  stateToPrompt, affinityToPrompt, saveEmotionSnapshot, emotionDashboard,
  loadAffinity, saveAffinity, evolveAffinity, getCompositeEmotion,
} from '../services/emotionEngine.js';
import { generateImage } from '../services/imageSkill.js';
import { getEventVadModifier } from '../services/eventGenerator.js';
import { computeProactiveScore, updateNextProactiveAt, resetUnansweredStreak, getUnansweredStreak } from '../services/proactiveChatScheduler.js';

const router = Router();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 回复猜想冷却：每个 conversation 生成一次后进入 20s 冷却，用户新消息到达时重置 ──
const guessCooldowns = new Map();  // conversationId -> timestamp(ms)

// ── 智能配图计数器（per-conversation）：每轮用户发言 -1，生图成功后重置为 3，归零时跳过 LLM 判断直接生图 ──
const imageJudgeCounters = new Map();  // conversationId -> count

// ── 统一缓冲分句器 ──
//   字符先进 3 字闸门检测 {" 和 {p（兜底），安全的再逐字进入分句逻辑。
//   分句规则:
//     1. 队列 > 20 字: 遇到 ！？～~ 保留符号后断句; 遇到 ，。 断句并去掉标点
//     2. 队列 ≤ 20 字: 遇到 ！？… 且前后不是 ！？… 时，强制断句（保留符号）
//     3. 。逗号无论队列长度都触发分句，去掉句号本身，重置 20 字计数器
//     4. flushAll() 时去掉末尾句号
//     5. 成对符号保护: 《》【】「」（ ）"" '' 等，遇到开符号后直到闭符号才允许分句
//   返回值: { segments: string[], stopped: boolean }
class SentenceSplitter {
  // ── 成对符号定义 ──
  static OPEN_TO_CLOSE = {
    '《': '》', '【': '】', '「': '」', '（': '）',
    '“': '”',   // " →
    '‘': '’',   // ' →
  };
  static CLOSE_TO_OPEN = {
    '》': '《', '】': '【', '」': '「', '）': '（',
    '”': '“',   // " →
    '’': '‘',   // ' →
  };
  static TOGGLE_PAIRS = new Set(['"', '\'']);  // ASCII 引号，开=闭，遇同类切换

  constructor() {
    this.gate = '';          // {" 检测窗口（最多 3 字）
    this.buffer = '';        // 分句累积队列
    this.pendingSplit = -1;  // 规则 2 的延迟断句位置
    this.stopped = false;
    this.pairStack = [];     // 成对符号栈（未闭合的开符号）
  }

  _canSplit() { return this.pairStack.length === 0; }

  _trackPair(ch) {
    if (SentenceSplitter.OPEN_TO_CLOSE[ch]) {
      this.pairStack.push(ch);
    } else if (SentenceSplitter.CLOSE_TO_OPEN[ch]) {
      const expected = SentenceSplitter.CLOSE_TO_OPEN[ch];
      for (let i = this.pairStack.length - 1; i >= 0; i--) {
        if (this.pairStack[i] === expected) { this.pairStack.splice(i, 1); break; }
      }
    } else if (SentenceSplitter.TOGGLE_PAIRS.has(ch)) {
      if (this.pairStack.length > 0 && this.pairStack[this.pairStack.length - 1] === ch) {
        this.pairStack.pop();
      } else {
        this.pairStack.push(ch);
      }
    }
  }

  // 喂入 chunk，返回已完成的安全段落
  feed(text) {
    const segments = [];
    const emit = (s) => { if (s) segments.push(s); };

    for (const ch of text) {
      if (this.stopped) break;

      // ── 闸门：2~3 字滑动窗口检测 {" 和 {p（兜底），含 Unicode 引号变体 ──
      this.gate += ch;
      if (this.gate.length >= 2) {
        const last2 = this.gate.slice(-2);
        if (last2[0] === '{' && (last2[1] === '"' || last2[1] === '“' || last2[1] === '”' || last2[1] === 'p')) {
          this.stopped = true;
          break;
        }
      }
      if (this.gate.length < 3) continue;  // 缓冲未满，不出字
      const safe = this.gate[0];            // 确认安全，释放一字
      this.gate = this.gate.slice(1);

      // ── 规则 3: 。始终触发分句，去掉句号，重置计数器 ──
      if (safe === '。') {
        if (this._canSplit()) {
          emit(this.buffer);
          this.buffer = '';
          this.pendingSplit = -1;
        } else {
          this.buffer += safe;
        }
        continue;
      }

      // ── 分句逻辑 ──
      this.buffer += safe;
      this._trackPair(safe);
      const n = this.buffer.length;

      if (n > 20) {
        // ── 规则 1 ──
        if (this.pendingSplit >= 0) {
          if (this._canSplit()) {
            // 如果 pendingSplit 由 … 触发且当前字也是 …，取消延迟分句，改为将 …… 作为整体发出
            const splitTriggerChar = this.buffer[this.pendingSplit - 1];
            if (splitTriggerChar === '…' && safe === '…') {
              this.pendingSplit = -1;
              emit(this.buffer);
              this.buffer = '';
            } else {
              emit(this.buffer.slice(0, this.pendingSplit));
              this.buffer = this.buffer.slice(this.pendingSplit);
              this.pendingSplit = -1;
              if (safe === '…') {
                // 分句后当前字是 …，继续延迟等待（可能后面还有 …）
                if (this.buffer.length > 0) {
                  this.pendingSplit = this.buffer.length;
                }
              } else if (/[！？～~]/.test(safe) || (safe === '.' && this.buffer.endsWith('...'))) {
                emit(this.buffer);
                this.buffer = '';
              } else if (/[，]/.test(safe)) {
                emit(this.buffer.slice(0, -1));
                this.buffer = '';
              }
            }
          }
        } else if (/[！？～~]/.test(safe) || (safe === '.' && this.buffer.endsWith('...'))) {
          if (this._canSplit()) {
            emit(this.buffer);
            this.buffer = '';
          }
        } else if (safe === '…') {
          // … 延迟分句，等待下一个字确认是否为 ……
          if (this._canSplit()) {
            this.pendingSplit = n;
          }
        } else if (/[，]/.test(safe)) {
          if (this._canSplit()) {
            emit(this.buffer.slice(0, -1));
            this.buffer = '';
          }
        }
      } else {
        // ── 规则 2 ──
        if (/[！？…]/.test(safe) || (safe === '.' && this.buffer.endsWith('...'))) {
          const prevCh = n > 1 ? this.buffer[n - 2] : null;
          if (prevCh && /[！？…]/.test(prevCh)) {
            this.pendingSplit = -1;
          } else if (this._canSplit()) {
            this.pendingSplit = n;
          }
        }
      }
    }
    return { segments, stopped: this.stopped };
  }

  // 流结束，释放闸门剩余安全字 + flush 分句队列
  flushAll() {
    if (this.stopped) {
      // 闸门中 {" 或 {p 之前仍有安全字（如 "。{" 中的 "。"），释放后再清空
      const pending = this.gate.slice(0, -2);
      for (const safe of pending) {
        if (safe === '。') {
          if (this._canSplit()) {
            if (this.buffer) {
              const seg = this.buffer.replace(/。$/, '');
              if (seg) this.buffer = seg;
              else this.buffer = '';
            }
          } else {
            this.buffer += safe;
          }
          continue;
        }
        this.buffer += safe;
        this._trackPair(safe);
      }
      let text = this.buffer;
      this.gate = '';
      this.buffer = '';
      this.pendingSplit = -1;
      this.pairStack.length = 0;
      text = text.replace(/。$/, '');
      return { segments: text ? [text] : [], stopped: true };
    }
    // 闸门中剩下的字全放（已确认不含 <pr），。仍触发分句
    for (const safe of this.gate) {
      if (safe === '。') {
        if (this._canSplit()) {
          // 压出当前 buffer 为一个 segment，丢弃句号
          if (this.buffer) {
            const seg = this.buffer.replace(/。$/, '');
            if (seg) this.buffer = seg;  // will be flushed below
            else this.buffer = '';
          }
        } else {
          this.buffer += safe;
        }
        continue;
      }
      this.buffer += safe;
      this._trackPair(safe);
      const n = this.buffer.length;
      if (n > 20) {
        if (/[，。]/.test(safe)) {
          this.buffer = this.buffer.slice(0, -1);
        }
      }
    }
    this.gate = '';
    // flush 分句队列
    let text = this.buffer;
    this.buffer = '';
    this.pendingSplit = -1;
    this.pairStack.length = 0;
    text = text.replace(/。$/, '');  // 规则 4: 去末尾句号
    return { segments: text ? [text] : [], stopped: false };
  }
}

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
    // 先删子表（有 FK 指向 messages.id），再删主表
    db.prepare(`DELETE FROM memory_fragments WHERE conversation_id = ?`).run(conversationId);
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
      db.pragma('foreign_keys = OFF');
      try {
        db.prepare(`DELETE FROM messages WHERE raw_id = ?`).run(lastRawId);
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

    // 3. 临时关闭外键检查，仅删两张表（其他表如 memory_fragments 的 FK 引用不做处理）
    db.pragma('foreign_keys = OFF');
    try {
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
    SELECT id, conversation_id, raw_id, role, content, images, created_at
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
    if (client_msg_id) {
      const existing = db.prepare('SELECT id FROM raw_messages WHERE client_msg_id = ?').get(client_msg_id);
      if (existing) {
        // 重试请求：用户消息已写入，直接复用（避免 DB 重复记录）
        console.log(`[chat] idempotent: skipping duplicate user message (client_msg_id=${client_msg_id})`);
        userMsgId = existing.id;
        send('msg_saved', { id: userMsgId, role: 'user', created_at: new Date().toISOString() });
      }
    }
    if (!userMsgId) {
      const userRaw = db.prepare(`INSERT INTO raw_messages (conversation_id, role, content, client_msg_id) VALUES (?, 'user', ?, ?)`)
        .run(conversationId, message, client_msg_id || null);
      const userMsg = db.prepare(`INSERT INTO messages (conversation_id, raw_id, role, content, seq) VALUES (?, ?, 'user', ?, 0)`)
        .run(conversationId, userRaw.lastInsertRowid, message);
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

    // 3. 生图意图（正则强匹配 → 提前检测，用于 msgs[2] 格式消息）
    const explicitImageIntent = detectImageIntent(message);

    // 4.5b 活跃奇遇检测（提前查询，供情绪引擎 + 人格层锚点 + 上下文注入三处使用）
    const activeEvent = db.prepare(`
      SELECT title, description, current_branch, choice_history, status, engaged, event_type_key
      FROM character_events
      WHERE character_id = ? AND status IN ('open','engaged')
      ORDER BY id DESC LIMIT 1
    `).get(characterId);

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

    // 5. 历史消息（从 raw_messages 取完整消息，每条即一整轮对话，无需合并）
    const history = db.prepare(`
      SELECT role, content, created_at FROM raw_messages
      WHERE conversation_id = ? ORDER BY id DESC LIMIT 20
    `).all(conversationId).reverse();

    const msgs = [];

    // ═══════════════════════════════════════════
    // msgs[0] — 舞台：破限词 + 世界观
    // ═══════════════════════════════════════════
    const jailbreak = getSystemRules();
    const worldSetting = getWorldSetting();
    const stageContent = [jailbreak, worldSetting].filter(Boolean).join('\n\n');
    if (stageContent) msgs.push({ role: 'system', content: stageContent });

    // ═══════════════════════════════════════════
    // msgs[1] — 角色：人格 + 情绪 + 当前奇遇锚点（我是谁）
    // ═══════════════════════════════════════════
    const charParts = [];
    charParts.push(character?.base_prompt || getDefaultPrompt());
    if (emotionPrompt) charParts.push(emotionPrompt);
    if (activeEvent) {
      charParts.push(`【当前状态】你正在经历一个突发事件：「${activeEvent.title}」。你的情绪、行为和注意力都受此事影响。请在回复中自然地体现这一点。`);
    }
    msgs.push({ role: 'system', content: charParts.join('\n\n') });

    // ═══════════════════════════════════════════
    // msgs[2] — 交互：用户上下文 + 关系 + 好感度（我在跟谁说话）
    // ═══════════════════════════════════════════
    const relParts = [];

    // 用户→角色关系
    const userRel = db.prepare(
      'SELECT relationship_text FROM user_relationships WHERE character_id = ?'
    ).get(characterId);
    if (userRel && userRel.relationship_text) {
      relParts.push(`<user_relation>你对于user而言的身份是${userRel.relationship_text}。这个身份为最高优先级，即使你在外有其他身份，但是在user面前就是这样的。请在对话中自然体现这层身份，不必刻意说明，行为举止应符合这层身份。</user_relation>`);
    }

    // 用户信息
    const chatUserName = config.user.nickname || '用户';
    const hasUserInfo = config.user.nickname || config.user.gender || config.user.appearance || config.user.persona;
    if (hasUserInfo) {
      const infoParts = [];
      infoParts.push(`消息中标记为"user"的人是"${chatUserName}"`);
      if (config.user.gender) infoParts.push(`性别：${config.user.gender}`);
      if (config.user.appearance) infoParts.push(`外观特征：${config.user.appearance}`);
      if (config.user.persona) infoParts.push(`其他说明：${config.user.persona}`);
      relParts.push(`<user_info>${infoParts.join('。')}</user_info>`);
    }

    // 角色视角的用户画像
    const portraitRows = db.prepare(`
      SELECT trait_type, content FROM user_portraits
      WHERE character_id = ?
      ORDER BY trait_type, confidence DESC
    `).all(characterId);
    if (portraitRows.length > 0) {
      const grouped = {};
      for (const row of portraitRows) {
        (grouped[row.trait_type] = grouped[row.trait_type] || []).push(row.content);
      }
      const portraitParts = [];
      if (grouped.appearance) portraitParts.push('外貌特征：' + grouped.appearance.join('、'));
      if (grouped.personality) portraitParts.push('性格特征：' + grouped.personality.join('、'));
      if (grouped.preference) portraitParts.push('偏好习惯：' + grouped.preference.join('、'));
      relParts.push(`<user_portrait>${chatUserName}在你眼中的印象：\n${portraitParts.join('\n')}</user_portrait>`);
    }

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
    if (charRels.length > 0) {
      const relLines = charRels.map(r => {
        if (r.direction === 'from') {
          return `- ${r.display_name}是你的${r.relationship_text}`;
        } else {
          return `- ${r.display_name}认为你是她的${r.relationship_text}`;
        }
      }).join('\n');
      relParts.push(`<character_relations>你与其他角色的关系：\n${relLines}\n\n请在对话中自然体现这些关系，不必刻意说明，但当提到或遇到这些角色时，行为举止应符合你们的关系。</character_relations>`);
    }

    // 好感度指令
    if (config.features.emotion && affinity != null) {
      const affinityMsg = affinityToPrompt(affinity);
      if (affinityMsg) relParts.push(affinityMsg);
    }

    if (relParts.length > 0) {
      msgs.push({ role: 'system', content: relParts.join('\n\n') });
    }

    // ═══════════════════════════════════════════
    // msgs[3] — 格式：对话规则（DB + 硬编码） + 生图意图
    // ═══════════════════════════════════════════
    const formatParts = [];
    const dialogueRule = getGlobalRule('dialogue_rules');
    if (dialogueRule?.rule_content && dialogueRule.is_active) {
      formatParts.push(dialogueRule.rule_content);
    }
    formatParts.push('<dialogue_rules>\n- **回复控制在' + (explicitImageIntent ? '1句话以内' : '2~3句话') + '，保持口语化轻快节奏**\n</dialogue_rules>');
    msgs.push({ role: 'system', content: formatParts.join('\n\n') });

    // ═══════════════════════════════════════════
    // msgs[4] — 素材：摘要 + RAG记忆 + 朋友圈（合并为一条）
    // ═══════════════════════════════════════════
    const materialParts = [];

    // 滚动摘要
    const summaries = getRecentSummaries(conversationId, 1);
    if (summaries.length > 0) {
      const summaryText = summaries.map(s => s.summary).join('\n---\n');
      materialParts.push('[对话历史摘要 — 以下是你和用户之前对话的摘要，已按时间顺序排列]\n' + summaryText);
    }

    // 记忆三路召回
    if (config.features.memory) {
      try {
        const excludeEntities = [character.display_name, chatUserName, 'user'];
        const rawResults = await hybridSearch(message, { conversationId, topK: 10, excludeEntities });
        const hasKeywordOrEntityHit = rawResults.some(
          r => r.sources && (r.sources.includes('keyword') || r.sources.includes('entity'))
        );
        if (!hasKeywordOrEntityHit) {
          console.log('[chat] RAG skipped: no keyword/entity hits for query');
        } else {
          const memoryResults = rawResults.filter(m => {
            if (!m.entities || m.entities.length === 0) return false;
            return true;
          });
          if (memoryResults.length >= 1) {
            const memoryLines = memoryResults.map((m, i) =>
              `${i + 1}. [${m.fragment_type}] ${m.content}`
            ).join('\n');
            materialParts.push('[相关记忆 — 以下是与当前对话相关的记忆碎片，可在回复中自然引用]\n' + memoryLines);
          }
        }
      } catch (err) {
        console.error('[chat] memory search failed:', err.message);
      }
    }

    // 最近朋友圈
    const recentMoments = db.prepare(`
      SELECT id, content, created_at FROM moment_posts
      WHERE character_id = ? AND status = 'done'
      ORDER BY created_at DESC LIMIT 2
    `).all(characterId);
    if (recentMoments.length > 0) {
      const momentLines = recentMoments.map((m, i) => {
        let line = `${i + 1}. [${m.created_at}] ${m.content}`;

        // 如果 user 评论过这条朋友圈，把评论区内容也注入
        const hasUserComment = db.prepare(`
          SELECT COUNT(*) AS cnt FROM moment_comments
          WHERE post_id = ? AND author_type = 'user'
        `).get(m.id);
        if (hasUserComment && hasUserComment.cnt > 0) {
          const comments = db.prepare(`
            SELECT mc.author_type, mc.content,
              CASE WHEN mc.author_type = 'character' THEN c.display_name ELSE ? END AS display_name
            FROM moment_comments mc
            LEFT JOIN characters c ON c.id = mc.author_id AND mc.author_type = 'character'
            WHERE mc.post_id = ?
            ORDER BY mc.created_at ASC
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
      materialParts.push(`「${character.display_name}最近发了朋友圈：\n${momentLines}\n你可以把这些当做聊天话题，自然地在对话中提到。」`);
    }

    // 最近奇遇总结（和朋友圈一样主动注入）—— 2条参与过的 + 1条未参与的
    // 能出现在 event_history 中的都是已结束的奇遇，区别仅在于用户是否参与过
    const engagedEvents = db.prepare(`
      SELECT title, summary, ended_at
      FROM event_history
      WHERE character_id = ? AND engaged = 1
      ORDER BY ended_at DESC LIMIT 2
    `).all(characterId);
    const unengagedEvent = db.prepare(`
      SELECT title, summary, ended_at
      FROM event_history
      WHERE character_id = ? AND engaged = 0
      ORDER BY ended_at DESC LIMIT 1
    `).get(characterId);

    const eventItems = [...engagedEvents];
    if (unengagedEvent) eventItems.push(unengagedEvent);

    if (eventItems.length > 0) {
      const eventLines = eventItems.map((e, i) =>
        `${i + 1}. ${e.title}：${e.summary || ''}`
      ).join('\n');
      materialParts.push(`「${character.display_name}最近经历了一些事：\n${eventLines}\n你可以在对话中自然地提起或询问这些经历。」`);
    }

    if (materialParts.length > 0) {
      msgs.push({ role: 'system', content: materialParts.join('\n\n') });
    }

    msgs.push(...history);

    // 正在进行的奇遇（作为独立 system 消息注入到 user 消息之前，指令前置 + XML 结构化）
    // 和朋友圈不同——奇遇是"此刻正在发生"的事，优先级更高，需要紧贴对话
    // 注：activeEvent 已在 msgs[1] 构建前查询，此处复用
    if (activeEvent) {
      const parsedHistory = JSON.parse(activeEvent.choice_history || '[]');
      const latestStep = parsedHistory.length > 1 ? parsedHistory[parsedHistory.length - 1] : null;

      const eventParts = [];
      eventParts.push(`<current_event priority="high">`);
      eventParts.push(``);
      eventParts.push(`【最高优先级行为指令】`);
      eventParts.push(`1. 你正在经历一个实时事件，你的情绪、身体感受和注意力都受此事牵动`);
      eventParts.push(`2. 你必须在回复中自然地体现此事件对你的影响——不要脱离事件去聊无关话题`);
      eventParts.push(`3. 当下任何语句，必须从当前事件的角度回应`);
      eventParts.push(``);
      eventParts.push(`【事件信息】`);
      eventParts.push(`标题：${activeEvent.title}`);
      eventParts.push(`当前处境：${activeEvent.description}`);
      if (latestStep) {
        eventParts.push(`最新进展（「${latestStep.choice_label}」）：${latestStep.summary}`);
      }
      eventParts.push(`</current_event>`);
      const eventContext = eventParts.join('\n');

      // 5.4 奇遇上下文 — 拼入最后一句 user 消息最前面（不入库，仅传给 LLM）
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') {
          msgs[i].content = `${eventContext}\n\n${msgs[i].content}`;
          break;
        }
      }
    }

    // 5.5 重逢上下文 + streak 重置
    const streak = getUnansweredStreak(characterId);
    if (streak >= 2) {
      let insertAt = msgs.length;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') { insertAt = i; break; }
      }
      msgs.splice(insertAt, 0, {
        role: 'system',
        content: `【⚠️ 重逢提示 — 仅本次生成可见，不存入对话记录】assistant 之前连续发了 ${streak} 条主动消息 user 都没回——现在 user 终于回复了。assistant 应在接下来的回复中自然地流露一点"终于等到你"的情绪——不质问、不委屈、不阴阳怪气。嘴硬的用别扭的方式，温柔的用直接的方式，搞怪的用段子。让 user 感觉到：ta 回来聊天这件事，对 assistant 来说很重要。`,
      });
    }
    if (streak > 0) {
      resetUnansweredStreak(characterId);
    }

    // 5.6 在最近的 user 消息前加时间戳
    //     倒数第一句 → [当前时间]（用现在的时间）
    //     倒数第二句 → [上次对话时间]（用该消息在 DB 中的 created_at）
    const now = new Date();
    const weekDay = ['周日','周一','周二','周三','周四','周五','周六'][now.getDay()];
    const timeTag = `[当前时间 ${weekDay} ${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]`;
    let foundCount = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        foundCount++;
        if (foundCount === 1) {
          // 倒数第一句 user 消息 → 当前时间
          msgs[i].content = `${timeTag} ${msgs[i].content}`;
        } else if (foundCount === 2) {
          // 倒数第二句 user 消息 → 该消息的 DB 时间
          // 如果间隔 ≤ 10 分钟则视为同一轮会话，不标记
          const msgCreatedAt = msgs[i].created_at;
          if (msgCreatedAt) {
            const prevDate = new Date(msgCreatedAt + 'Z'); // SQLite UTC → JS Date
            const gapMinutes = (now - prevDate) / 60000;
            if (gapMinutes > 10) {
              const prevWeekDay = ['周日','周一','周二','周三','周四','周五','周六'][prevDate.getDay()];
              const prevTag = `[上次对话时间 ${prevWeekDay} ${String(prevDate.getMonth() + 1).padStart(2, '0')}/${String(prevDate.getDate()).padStart(2, '0')} ${String(prevDate.getHours()).padStart(2, '0')}:${String(prevDate.getMinutes()).padStart(2, '0')}]`;
              msgs[i].content = `${prevTag} ${msgs[i].content}`;
            }
          }
          break;
        }
      }
    }

    // 5.6 清理 created_at：仅用于时间标签计算，不应送入 LLM
    for (const msg of msgs) {
      delete msg.created_at;
    }

    // 6. 流式生成（温度 0.65）
    // SentenceSplitter 内置 <pr 闸门 + 20 字分句，字符先过闸门再过标点规则
    const splitter = new SentenceSplitter();
    const collectedSegments = [];
    let fullContent = '';

    send('response_start', {});
    for await (const chunk of chatStream(msgs, { temperature: 0.72, label: '主聊天流' })) {
      const cleanChunk = chunk.replace(/<br\s*\/?>/gi, '').replace(/\n/g, '');
      fullContent += cleanChunk;

      const { segments, stopped } = splitter.feed(cleanChunk);

      for (const segText of segments) {
        send('token', { content: segText });
        collectedSegments.push(segText);
        send('bubble_break', {});
        await sleep(500);
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
        characterPersonality: character?.short_prompt || '',
        emotionBaseline,
        currentVad: getCompositeEmotion(emotionState),
        currentAffinity,
        relationship: db.prepare(
          'SELECT relationship_text FROM user_relationships WHERE character_id = ?'
        ).get(characterId)?.relationship_text || '',
        prevUser,
        prevAssistant,
        summary: summaryRow?.summary || '',
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
      imageGenPromise = triggerImageGeneration(conversationId, tags.prompt, lastInsertRowid, genTaskId, send);
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
          const userMsgCount = db.prepare(`
            SELECT COUNT(*) as count FROM raw_messages
            WHERE conversation_id = ? AND role = 'user'
          `).get(conversationId).count;
          if (userMsgCount % 10 === 0) {
            console.log('[chat] memory extract triggered at user message #' + userMsgCount);
            await extractMemoryFragments(conversationId, userMsgId, lastInsertRowid, {
              characterPrompt: character.base_prompt,
              participantNames: [character.display_name, chatUserName, 'user'],
              characterName: character.display_name,
              userName: chatUserName,
            });
          }
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

function detectImageIntent(message) {
  return [
    // ── 画/生成/做/创建/制作/设计 + 量词 ──
    /画[一个张幅]/, /生成[一个张幅]?图/, /做[一个张幅]图/, /创建[一个张幅]?图/, /制作[一个张幅]?图/, /设计[一个张幅]?图/,
    /出[一个张幅]图/,
    // ── 给我/展示/来/要/搞/整 + 量词 ──
    /给我[看看瞧瞧]/, /展示[一下]/, /来[一个张幅]/, /来[张个幅]图/, /要[一个张幅]图/, /搞[一个张幅]/, /整[一个张幅]/,
    // ── 帮我 + 动作 ──
    /帮我画/, /帮我生成/,
    // ── 动词 + 出来 ──
    /画出来/, /生成出来/,
    // ── 我想/我能 + 动作 ──
    /我想要[一个张幅]?图/, /能[不能]?画/, /能不能画/,
    // ── 发图系 ──
    /发[一二三四五六七八九十]?[张个幅]/,   // 发张、发一张、发个、发幅
    /发图/,                                   // 发图（简写）
    /发出来/,                                 // 发出来看看
    /上图/,                                   // 上图（社群常用）
    /来[张个幅]/,                             // 来张、来一张
    /给[张个幅]图/,                           // 给张图
    // ── 想看系 ──
    /想看/,                                   // 想看xxx
    /好想看/,                                 // 好想看
    /想看看/,                                 // 想看看xxx
    /让我[看看瞧瞧]/,                         // 让我看看/瞧瞧
    /给我[看看瞧瞧]/,                         // 给我看看
    /瞧瞧/,                                   // 瞧瞧
    // ── 看看 + 任何名词（不只是图/照片）──
    /看看.{1,10}/,                            // 看看乌冬面、看看效果
    // ── 外观询问系 ──
    /长什么样/, /是什么样[子子]/, /长啥样/, /什么样子/, /是怎样[的的]/,
    // ── 未看到/索要重发系 ──
    /没看到/, /看不到/, /没见到/, /看不见/,
    /图呢/, /照片呢/, /[图图片照]呢/,
    /再发[一]?[次下张个遍]/,                 // 再发一次、再发下、再发张
    /重发/,                                   // 重发
    /没发出来/,                               // 没发出来
    /怎么没有[图图片照]/,                     // 怎么没有图
    // ── 找/搜图系 ──
    /找[一二三四五六七八九十]?[张个幅]/,     // 找张、找一张、找个
    /搜[一二三四五六七八九十]?[张个幅]/,     // 搜张、搜一张
    // ── 隐喻/口语系 ──
    /整[一个张幅]图/,                         // 整张图
    /搞[张个幅]/,                             // 搞张、搞一张
    /来点.*图/,                               // 来点...图
    /有没有.*[图图片照]/,                     // 有没有...图/照片
  ].some(p => p.test(message));
}

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

  const db2 = getDb();
  const judgeRule = db2.prepare(`SELECT rule_content FROM global_rules WHERE rule_key = 'judge_prompt' AND is_active = 1`).get();
  const judgeSystemPrompt = judgeRule?.rule_content ||
    '你是一个简洁的判断助手。你的唯一任务是：阅读对话，判断任意一方是否需要发送/索取一张图片。只回复"是"或"否"，不要解释。';

  try {
    const result = await chatSync([
      { role: 'system', content: judgeSystemPrompt },
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

async function triggerImageGeneration(conversationId, prompt, assistantMsgId, taskId, send) {
  const db = getDb();

  // 计算 data/images 的绝对路径（agent-core/data/images/，不会被 vite build 清空）
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.dirname(path.dirname(path.dirname(__filename))); // agent-core/
  const imagesDir = path.join(projectRoot, 'data', 'images');

  try {
    const result = await generateImage(prompt, {
      onProgress: (p) => {
        if (p.stage === 'retrying') {
          send('generate_retrying', { taskId, attempt: p.attempt, maxRetries: p.maxRetries });
        } else {
          send('generate_progress', { taskId, ...p });
        }
      }
    });
    if (result.success && result.images.length > 0) {
      // 落盘 base64 图片到 data/images/，构建 URL 数组
      fs.mkdirSync(imagesDir, { recursive: true });
      const urls = [];
      for (const img of result.images) {
        const ts = Date.now();
        const filename = `${ts}_${img.filename || 'comfy.png'}`;
        const filePath = path.join(imagesDir, filename);
        // 解码 base64 data URI → 写入文件
        const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        urls.push(`/images/${filename}`);
        // 给前端用的 URL 也挂到 img 对象上
        img.url = `/images/${filename}`;
      }

      // 更新消息：挂上图片 URL
      const updateResult = db.prepare(`UPDATE messages SET images = ? WHERE id = ?`)
        .run(JSON.stringify(urls), assistantMsgId);
      console.log(`[chat] images saved to message id=${assistantMsgId}, rows updated=${updateResult.changes}`);

      db.prepare(`UPDATE image_tasks SET status='done', output_paths=?, finished_at=datetime('now') WHERE id=?`)
        .run(JSON.stringify(urls), taskId);

      send('generate_done', { taskId, images: result.images, source: result.source });

      // 生图成功 → 智能配图计数器重置为 3
      imageJudgeCounters.set(conversationId, 3);
      console.log(`[chat] imageJudgeCounter[${conversationId}] reset to 3 (image generated successfully)`);
    } else {
      throw new Error(result.error || 'No images generated');
    }
  } catch (err) {
    console.error('[chat] generate failed:', err.message);
    db.prepare(`UPDATE image_tasks SET status='failed', error_message=?, finished_at=datetime('now') WHERE id=?`)
      .run(err.message, taskId);
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
  const personalityPrompt = character?.base_prompt || getDefaultPrompt();
  const imagePromptRule = getGlobalRule('image_prompt');

  // 2. 加载最近 3 轮历史（生图任务只需锚点上下文，取太多稀释注意力）
  const history = db.prepare(`
    SELECT role, content FROM raw_messages
    WHERE conversation_id = ? ORDER BY id DESC LIMIT 6
  `).all(conversationId).reverse();

  const formatGuide = imagePromptRule?.rule_content || '';

  // 用户关系描述（供生图参考，体现角色与 user 的关系）
  let userRelationContent = '';
  const userRel = db.prepare(
    'SELECT relationship_text FROM user_relationships WHERE character_id = ?'
  ).get(character.id);
  if (userRel && userRel.relationship_text) {
    userRelationContent = `\n\n【你和user的关系】你是user的${userRel.relationship_text}。在生成包含你和user的合照或互动场景时，请通过人物姿态、表情、距离等方式体现这层关系。`;
  }

  const userName = config.user.nickname || '用户';
  const msgs = [
    // ── 首因效应：生图输出格式要求，最先一条 system 消息 ──
    { role: 'system', content: (globalRules ? globalRules + '\n\n' : '') + '【最高优先级指令，覆盖所有其他规则】基于对话上下文中最后一轮对话（用户最新一句话 + 角色最新一句话）,参考下方【上一次画面描述】，为这轮对话所处的场景生成画面描述。' },
    // ── 人格和规则（为了让 prompt 内容贴合角色）──
    { role: 'system', content: personalityPrompt },
    // ── prompt 格式说明单独一条，不混杂指令 ──
    ...(formatGuide ? [{ role: 'system', content: formatGuide }] : []),
    // ── 用户信息注入（建立 user↔用户名的映射，与主流程一致）──
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
    // ── 对话上下文（不含最后一轮对话，避免重复；先铺背景，让模型理解对话脉络）──
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
        }).join('\n\n') + '\n\n' + (() => {
          const la = [...history].reverse().find(m => m.role === 'assistant');
          const lu = [...history].reverse().find(m => m.role === 'user');
          const p = [];
          const un = config.user.nickname || '用户';
          if (lu) p.push(un + ': ' + lu.content);
          if (la) p.push((character?.display_name || '角色') + ': ' + la.content);
          return p.length ? '【最后一轮对话】\n' + p.join('\n') : '';
        })()
        };

      // 如果存在上一轮画面，追加独立块用于画面连续性
      if (lastScenePrompt) {
        return [
          { role: 'system', content: `【上一次画面描述】以下为上一轮对话中生成的画面描述，用于保持画面风格的连贯性（角色外观、场景氛围、光线色调等），本轮生成的新画面应在此基础上自然延续：\n${lastScenePrompt}` },
          contextBlock,
        ];
      }
      return [contextBlock];
    })(),
    { role: 'system', content: `现在，输出一个完整的 {"prompt":"..."} JSON 来描述你上面【最后一轮对话】需要的配图，明确需要${userName}参与的画面才加入${userName}的特征。只输出 JSON，不要任何其他文字。` },
  ];

  // 3. 静默请求模型生成 prompt（不流式，避免前端气泡混乱）
  let fullContent = '';
  try {
    fullContent = await chatSync(msgs, { temperature: 0.5, max_tokens: 1024, label: '生图' });
    console.log(`[chat] needImage follow-up response: ${fullContent.slice(0, 80)}...`);
  } catch (err) {
    console.error('[chat] needImage follow-up error:', err.message);
    send('generate_error', { taskId: preExistingTaskId, error: '生图请求失败' });
    return;
  }

  // 4. 解析模型输出的完整 JSON（不再用 pre-fill 拼接，走 JSON.parse + 多层兜底）
  let prompt = null;
  try {
    // 清洗 markdown 代码块外壳 → JSON.parse
    const clean = fullContent.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    prompt = JSON.parse(clean).prompt;
  } catch {
    // 兜底1：规范化弯引号后重试 JSON.parse
    try {
      const normalized = fullContent
        .replace(/[“”„‟＂]/g, '"')
        .replace(/[‘’‚‛＇]/g, "'");
      const clean = normalized.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      prompt = JSON.parse(clean).prompt;
    } catch {
      // 兜底2：从文本中尽力提取 prompt 值（匹配 {"prompt":"..."} 的各种变体，要求有 }）
      const lenientMatch = fullContent.match(/\{[“”"]?prompt[“”"]?\s*:\s*[“”"]([^]*?)[“”"]?\s*\}/i);
      if (lenientMatch) {
        prompt = lenientMatch[1].trim();
      }
      // 兜底3：连 } 都没有（token 截断等）→ 从 prompt 前缀截取到末尾
      if (!prompt) {
        const prefixMatch = fullContent.match(/\{[“”"]?prompt[“”"]?\s*:\s*[“”"]([^]*)/i);
        if (prefixMatch) {
          prompt = prefixMatch[1].replace(/[\s"“”'』」\}\]]*$/g, '').trim();
        }
      }
      if (prompt && prompt.length >= 5) {
        console.log(`[chat] needImage: prompt recovered via lenient fallback (${prompt.length} chars)`);
      } else {
        prompt = null;
      }
      if (!prompt) {
        console.warn('[chat] needImage: all prompt extraction methods failed, raw:', fullContent.slice(0, 120));
      }
    }
  }
  const tags = { prompt };

  let displayContent = stripTags(fullContent);

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
      // 上一条已有 prompt → 兜底：新写 raw（raw 内容含占位，messages 存空不在前端显示杂讯）
      const rawContent = `(图片) ${fullContent.replace(/<needImage>/gi, '').trim()}`;
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
        await sleep(500);
      }
      // 更新 displayContent 为清洗后的分段文本，供下方 messages 表写入
      displayContent = allSegments.join('\n\n');
    }
    const rawContent = fullContent
      .replace(/<needImage>/gi, '')
      .trim();
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
    await triggerImageGeneration(conversationId, tags.prompt, assistantMsgId, genTaskId, send);
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
  const worldSetting = getWorldSetting();
  const stageContent = [jailbreak, worldSetting].filter(Boolean).join('\n\n');

  // msgs[1] — 任务：预测指令（先定义任务） + 角色背景（后补充上下文）
  const taskParts = [];
  taskParts.push(`你是一个对话预测助手。你的任务是预测**用户（user）**接下来最可能回复的两句话。

⚠️ 重要：你要预测的是 user 的回复，**绝对不要**预测 assistant 会说什么。对话最后一条是 assistant 说的，你预测的必须是 user 对这句话的回应——不要把 assistant 的话接下去。

规则：
1. A 和 B 必须是不同方向的回复——不能是同一个意思的两种说法。例如：A 延续当前话题深入，B 切换视角或表达不同态度
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

  // 过滤掉 assistant 消息中的生图 prompt JSON，避免干扰预测
  const cleanedHistory = history.map(msg => {
    if (msg.role === 'assistant') {
      return {
        ...msg,
        content: msg.content.replace(/\s*\{[^{}]*"prompt"\s*:\s*"(?:[^"\\]|\\.)*"[^{}]*\}$/, '')
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
    const result = await chatSync(msgs, { temperature: 0.7, max_tokens: 128, label: '预测' });
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

export default router;
