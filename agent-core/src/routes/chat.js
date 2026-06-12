import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, getActiveGlobalRules, getGlobalRule } from '../db/index.js';
import { chatStream, chatSync } from '../llm/deepseek.js';
import { config } from '../config.js';
import { hybridSearch } from '../services/memorySearch.js';
import { extractMemoryFragments } from '../services/memoryExtractor.js';
import { maybeSummarize, getRecentSummaries } from '../services/summarizer.js';
import {
  loadEmotionState, evolveEmotion, evaluateStimulus,
  emotionToPrompt, saveEmotionSnapshot, emotionDashboard,
} from '../services/emotionEngine.js';
import { generateImage } from '../services/imageSkill.js';

const router = Router();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 统一缓冲分句器 ──
//   字符先进 3 字闸门检测 <pr，安全的再逐字进入分句逻辑。
//   分句规则:
//     1. 队列 > 20 字: 遇到 ！？～~… 保留符号后断句; 遇到 ，。 断句并去掉标点
//     2. 队列 ≤ 20 字: 遇到 ！？… 且前后不是 ！？… 时，强制断句（保留符号）
//     3. 。逗号无论队列长度都触发分句，去掉句号本身，重置 20 字计数器
//     4. flushAll() 时去掉末尾句号
//   返回值: { segments: string[], stopped: boolean }
class SentenceSplitter {
  constructor() {
    this.gate = '';          // {" 检测窗口（最多 3 字）
    this.buffer = '';        // 分句累积队列
    this.pendingSplit = -1;  // 规则 2 的延迟断句位置
    this.stopped = false;
  }

  // 喂入 chunk，返回已完成的安全段落
  feed(text) {
    const segments = [];
    const emit = (s) => { if (s) segments.push(s); };

    for (const ch of text) {
      if (this.stopped) break;

      // ── 闸门：2~3 字滑动窗口检测 {" ──
      this.gate += ch;
      if (this.gate.length >= 2 && this.gate.slice(-2) === '{"') {
        this.stopped = true;
        break;
      }
      if (this.gate.length < 3) continue;  // 缓冲未满，不出字
      const safe = this.gate[0];            // 确认安全，释放一字
      this.gate = this.gate.slice(1);

      // ── 规则 3: 。始终触发分句，去掉句号，重置计数器 ──
      if (safe === '。') {
        emit(this.buffer);
        this.buffer = '';
        this.pendingSplit = -1;
        continue;
      }

      // ── 分句逻辑 ──
      this.buffer += safe;
      const n = this.buffer.length;

      if (n > 20) {
        // ── 规则 1 ──
        if (this.pendingSplit >= 0) {
          emit(this.buffer.slice(0, this.pendingSplit));
          this.buffer = this.buffer.slice(this.pendingSplit);
          this.pendingSplit = -1;
          if (/[！？～~…]/.test(safe) || (safe === '.' && this.buffer.endsWith('...'))) {
            emit(this.buffer);
            this.buffer = '';
          } else if (/[，]/.test(safe)) {
            emit(this.buffer.slice(0, -1));
            this.buffer = '';
          }
        } else if (/[！？～~…]/.test(safe) || (safe === '.' && this.buffer.endsWith('...'))) {
          emit(this.buffer);
          this.buffer = '';
        } else if (/[，]/.test(safe)) {
          emit(this.buffer.slice(0, -1));
          this.buffer = '';
        }
      } else {
        // ── 规则 2 ──
        if (/[！？…]/.test(safe) || (safe === '.' && this.buffer.endsWith('...'))) {
          const prevCh = n > 1 ? this.buffer[n - 2] : null;
          if (prevCh && /[！？…]/.test(prevCh)) {
            this.pendingSplit = -1;
          } else {
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
      // 闸门中 <pr 之前仍有安全字（如 "。<pr" 中的 "。"），释放后再清空
      const pending = this.gate.slice(0, -3);
      for (const safe of pending) {
        if (safe === '。') {
          if (this.buffer) {
            const seg = this.buffer.replace(/。$/, '');
            if (seg) this.buffer = seg;
            else this.buffer = '';
          }
          continue;
        }
        this.buffer += safe;
      }
      let text = this.buffer;
      this.gate = '';
      this.buffer = '';
      this.pendingSplit = -1;
      text = text.replace(/。$/, '');
      return { segments: text ? [text] : [], stopped: true };
    }
    // 闸门中剩下的字全放（已确认不含 <pr），。仍触发分句
    for (const safe of this.gate) {
      if (safe === '。') {
        // 压出当前 buffer 为一个 segment，丢弃句号
        if (this.buffer) {
          const seg = this.buffer.replace(/。$/, '');
          if (seg) this.buffer = seg;  // will be flushed below
          else this.buffer = '';
        }
        continue;
      }
      this.buffer += safe;
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

// 反向: 将 ISO 8601 转为 SQLite 可比较的时间格式 "YYYY-MM-DD HH:MM:SS"
function normalizeForSQLite(dt) {
  if (!dt) return dt;
  return dt.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

// DELETE /api/characters/:id/messages — 清空角色对话记录（软删除）
router.delete('/characters/:id/messages', (req, res) => {
  const db = getDb();
  const conversationId = convId(req.params.id);
  db.prepare(`UPDATE messages SET is_deleted = 1 WHERE conversation_id = ?`).run(conversationId);
  db.prepare(`UPDATE raw_messages SET is_deleted = 1 WHERE conversation_id = ?`).run(conversationId);
  // 重建 FTS5 索引
  db.exec(`DELETE FROM messages_fts WHERE rowid NOT IN (SELECT id FROM messages WHERE is_deleted = 0)`);
  res.json({ ok: true });
});

// GET /api/characters/:id/messages — 获取角色对话消息
//   ?limit=50            每次最多条数
//   ?before=ISO_DATE     加载该日期之前的旧消息（不传则默认最近 7 天）
router.get('/characters/:id/messages', (req, res) => {
  const db = getDb();
  const conversationId = convId(req.params.id);
  const { limit = '50', before } = req.query;
  const limitNum = parseInt(limit, 10);
  const params = [conversationId];

  let sql;
  if (before) {
    // 向上翻：加载 before 日期之前的旧消息（从新到旧取 limit 条，再反转顺序）
    sql = `SELECT * FROM (
      SELECT id, conversation_id, role, content, images, created_at
      FROM messages
      WHERE conversation_id = ? AND is_deleted = 0 AND created_at < ?
      ORDER BY id DESC LIMIT ?
    ) ORDER BY id ASC`;
    params.push(normalizeForSQLite(before), limitNum);
  } else {
    // 默认：加载最近 7 天的最新消息
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    sql = `SELECT * FROM (
      SELECT id, conversation_id, role, content, images, created_at
      FROM messages
      WHERE conversation_id = ? AND is_deleted = 0 AND created_at >= ?
      ORDER BY id DESC LIMIT ?
    ) ORDER BY id ASC`;
    params.push(normalizeForSQLite(weekAgo), limitNum);
  }

  const messages = db.prepare(sql).all(...params).map(m => ({
    ...m,
    created_at: toISODate(m.created_at),
  }));

  // 是否还有更早的消息
  let hasMore = false;
  if (messages.length > 0) {
    const oldest = messages[0].created_at;
    const older = db.prepare(`SELECT COUNT(*) as c FROM messages WHERE conversation_id = ? AND is_deleted = 0 AND created_at < ?`)
      .get(conversationId, normalizeForSQLite(oldest));
    hasMore = older.c > 0;
  }

  res.json({ messages, hasMore });
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

    // 2. 加载角色
    const character = db.prepare('SELECT * FROM characters WHERE id = ? AND is_active = 1').get(characterId);

    // 3. system prompt（全局规则前置 → 人格在后）
    // 规则优先保证格式约束获得最高注意力（首因效应），人格紧随确保角色感不丢失
    const globalRules = getActiveGlobalRules();
    let systemPrompt = globalRules ? globalRules + '\n\n' : '';
    systemPrompt += character?.base_prompt || getDefaultPrompt();

    // 4. 生图意图（正则强匹配 → 强制生成）
    const explicitImageIntent = detectImageIntent(message);
    if (explicitImageIntent) {
      systemPrompt += '\n\n【强制要求】用户要求生成图片。对白正文 20 字以内简要回复，然后在末尾加上 {"prompt":"..."} 标签，标签内的画面描述不限制长度可尽情详写。';
    }

    // 内置对话规则（不依赖 DB seed，代码层面兜底）
    systemPrompt += '\n\n<dialogue_rules>\n- **一次对话长度在' + (explicitImageIntent ? '20' : '30至60') + '字之内**\n</dialogue_rules>';

    // 5. 历史消息（从 raw_messages 取完整消息，每条即一整轮对话，无需合并）
    const history = db.prepare(`
      SELECT role, content FROM raw_messages
      WHERE conversation_id = ? AND is_deleted = 0 ORDER BY id DESC LIMIT 40
    `).all(conversationId).reverse();

    const msgs = [
      { role: 'system', content: systemPrompt },
      ...history,
    ];
    if (explicitImageIntent) {
      const imagePromptRule = getGlobalRule('image_prompt');
      const imagePromptContent = imagePromptRule?.rule_content || '请立即回复正文并在末尾加上 {"prompt":"..."} 标签。';
      msgs.push({ role: 'user', content: imagePromptContent + '请立即回复正文并在末尾加上 {"prompt":"..."} 标签。' });
    }

    // 6. 流式生成（温度 0.65）
    // SentenceSplitter 内置 <pr 闸门 + 20 字分句，字符先过闸门再过标点规则
    const splitter = new SentenceSplitter();
    const collectedSegments = [];
    let fullContent = '';

    send('response_start', {});
    for await (const chunk of chatStream(msgs, { temperature: 0.65 })) {
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
    fullContent = stripBracketActions(fullContent);
    send('response_end', {});

    // 7. 后处理：gate 已阻止 {"prompt"... JSON 内容进入 collectedSegments，
    //    segments 直接可用；如有 prompt 标签则在 fullContent 上提取
    const tags = extractImageTags(fullContent);
    const hasNeedImageTag = !tags.prompt && hasNeedImage(fullContent);
    const segments = collectedSegments
      .map(s => stripBracketActions(s).trim())
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
        .run(conversationId, '(无回复)');
      const r = db.prepare(`INSERT INTO messages (conversation_id, raw_id, role, content, seq) VALUES (?, ?, 'assistant', ?, 0)`)
        .run(conversationId, rawEmpty.lastInsertRowid, '(无回复)');
      savedIds.push(r.lastInsertRowid);
      send('msg_saved', { id: r.lastInsertRowid, role: 'assistant', created_at: new Date().toISOString() });
    }
    const lastInsertRowid = savedIds[savedIds.length - 1];

    // 9. 生图（四种触发路径）
    if (tags.prompt) {
      // 路径 A: 模型直接输出了 {"prompt":"..."}（正则强匹配 → 或模型自主决定）
      const db2 = getDb();
      const taskResult = db2.prepare(`INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status) VALUES (?, ?, ?, 'running')`)
        .run(conversationId, tags.prompt, tags.prompt);
      const genTaskId = taskResult.lastInsertRowid;
      send('generate_start', { taskId: genTaskId, prompt: tags.prompt });
      await triggerImageGeneration(conversationId, tags.prompt, lastInsertRowid, genTaskId, send);
    } else if (hasNeedImageTag) {
      // 路径 B: 模型追加了 <needImage>，需要二次请求获取 prompt
      await handleNeedImageFlow(conversationId, character, send);
    } else if (force_image_gen) {
      // 路径 D: 强制生图 — 用户主动勾选，跳过智能判断
      console.log('[chat] force image gen: user requested, triggering needImage flow');
      await handleNeedImageFlow(conversationId, character, send);
    } else if (config.features.autoImageJudge) {
      // 路径 C: 静默判断 — 延迟约 300ms，SSE 保持打开以支持后续生图进度推送
      try {
        const needImage = await judgeImageNeed(conversationId);
        if (needImage) {
          console.log('[chat] auto judge: image needed, triggering needImage flow');
          const char = db.prepare('SELECT * FROM characters WHERE id = ? AND is_active = 1').get(characterId);
          await handleNeedImageFlow(conversationId, char, send);
        }
      } catch (err) {
        console.error('[chat] auto judge error:', err.message);
      }
    }

    // 10. 后处理（按开关决定）
    setImmediate(async () => {
      try {
        if (config.features.emotion) {
          const emotionBaseline = character
            ? JSON.parse(character.emotion_baseline || '{"valence":0.5,"arousal":0.5,"dominance":0.5}')
            : { valence: 0.5, arousal: 0.5, dominance: 0.5 };
          const emotionState = loadEmotionState(conversationId, emotionBaseline);
          const { delta, dominantEmotion } = await evaluateStimulus(message, fullContent);
          const evolved = evolveEmotion(emotionState, delta, emotionBaseline);
          saveEmotionSnapshot(conversationId, lastInsertRowid, evolved, dominantEmotion);
          console.log(`[emotion] ${emotionDashboard(evolved, dominantEmotion)}`);
        }
        if (config.features.memoryExtract) {
          await extractMemoryFragments(conversationId, userMsg.lastInsertRowid, lastInsertRowid);
        }
        await maybeSummarize(conversationId);
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
  // 匹配 {"prompt":"..."} JSON 格式（支持引号转义）
  const jsonMatch = content.match(/\{"prompt"\s*:\s*"((?:[^"\\]|\\.)*)"\}/);
  if (jsonMatch) return { prompt: jsonMatch[1].replace(/\\"/g, '"').trim() };
  return { prompt: null };
}

function hasNeedImage(content) {
  return /<needImage>/i.test(content);
}


function stripTags(content) {
  return content
    .replace(/\{"prompt"\s*:\s*"[^"]*"\}/gi, '')
    .replace(/<generate>[\s\S]*?<\/generate>/gi, '')
    .replace(/<needImage>/gi, '')
    .replace(/<br\s*\/?>/gi, '')     // 气泡分割标记不展示
    .replace(/\n{2,}/g, '\n')       // 连续空行压缩为单换行
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
 * 静默判断：给定最近对话，是否需要配一张图片增强表达
 * 极轻量 DeepSeek 调用（只需"是/否"），延迟通常 < 300ms
 */
async function judgeImageNeed(conversationId) {
  const db = getDb();
  // 直接从 raw_messages 取最后一条用户/Agent 完整消息，无需合并
  const lastUser = db.prepare(`
    SELECT content FROM raw_messages
    WHERE conversation_id = ? AND is_deleted = 0 AND role = 'user'
    ORDER BY id DESC LIMIT 1
  `).get(conversationId);

  const lastAssistant = db.prepare(`
    SELECT content FROM raw_messages
    WHERE conversation_id = ? AND is_deleted = 0 AND role = 'assistant'
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
    ], { temperature: 0, max_tokens: 5 });

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
    const result = await generateImage(prompt, { onProgress: (p) => send('generate_progress', { taskId, ...p }) });
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
      db.prepare(`UPDATE messages SET images = ? WHERE id = ?`)
        .run(JSON.stringify(urls), assistantMsgId);

      db.prepare(`UPDATE image_tasks SET status='done', output_paths=?, finished_at=datetime('now') WHERE id=?`)
        .run(JSON.stringify(urls), taskId);

      send('generate_done', { taskId, images: result.images, source: result.source });
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
async function handleNeedImageFlow(conversationId, character, send) {
  const db = getDb();
  console.log('[chat] needImage detected, requesting prompt from model (compact)...');

  // 1. 构建二次请求的消息列表（首因效应：生图指令置顶，人格在后）
  const globalRules = getActiveGlobalRules();
  let personalityPrompt = globalRules ? globalRules + '\n\n' : '';
  personalityPrompt += character?.base_prompt || getDefaultPrompt();
  const imagePromptRule = getGlobalRule('image_prompt');

  // 2. 加载历史（从 raw_messages 取完整消息，无需合并）
  const history = db.prepare(`
    SELECT role, content FROM raw_messages
    WHERE conversation_id = ? AND is_deleted = 0 ORDER BY id DESC LIMIT 40
  `).all(conversationId).reverse();

  const formatGuide = imagePromptRule?.rule_content || '';

  const msgs = [
    // ── 首因效应：生图输出格式要求，最先一条 system 消息 ──
    { role: 'system', content: '【最高优先级指令，覆盖所有其他规则】基于对话中你（assistant）的最后一句话，自然地接一句 20 字内的补充对白，然后紧接着输出 {"prompt":"..."}。\n\n规则：\n- 对白正文：20 字以内，简要自然地接话\n- {"prompt":"..."} 内的画面描述：不限制长度，尽情详细描述场景、角色、表情、动作、穿着、环境\n\n示例：\n"嗯，我也这么想。{"prompt":"午后阳光透过百叶窗洒进教室，白色长发的少女托腮望着窗外，微风轻拂她的发梢和领巾"}"\n\n注意：正文 + {"prompt":"..."} 缺一不可，其中正文20字以内，prompt 内容不限长。' },
    // ── 人格和规则 ──
    { role: 'system', content: personalityPrompt },
    // ── prompt 格式说明单独一条，不混杂指令 ──
    ...(formatGuide ? [{ role: 'system', content: formatGuide }] : []),
    ...history,
    { role: 'system', content: '接上面对话中你最后一句，补充 20 字内接话 + {"prompt":"..."}。现在输出：' },
  ];

  // 3. 静默请求模型生成 prompt（不流式，避免前端气泡混乱）
  let fullContent = '';
  try {
    fullContent = await chatSync(msgs, { temperature: 0.6, max_tokens: 1024 });
    console.log(`[chat] needImage follow-up response: ${fullContent.slice(0, 80)}...`);
  } catch (err) {
    console.error('[chat] needImage follow-up error:', err.message);
    send('generate_error', { error: '生图请求失败' });
    return;
  }

  // 4. 解析标签
  const tags = extractImageTags(fullContent);
  const displayContent = stripTags(fullContent);

  // 4.5 推送 follow-up 文字到前端（填入现有 trailing empty 气泡，再 freeze）
  if (displayContent) {
    send('token', { content: displayContent });
    send('bubble_break', {});
  }

  // 5. 保存第二轮回复（双表：raw_messages 完整原文 + messages 展示文本，保留 {"prompt" JSON 标签）
  const rawContent = fullContent
    .replace(/<needImage>/gi, '')
    .trim();
  const rawResult = db.prepare(`INSERT INTO raw_messages (conversation_id, role, content, prompt) VALUES (?, 'assistant', ?, ?)`)
    .run(conversationId, rawContent, tags.prompt || null);
  const lastInsertRowid = db.prepare(`INSERT INTO messages (conversation_id, raw_id, role, content, seq) VALUES (?, ?, 'assistant', ?, 0)`)
    .run(conversationId, rawResult.lastInsertRowid, displayContent).lastInsertRowid;
  send('msg_saved', { id: lastInsertRowid, role: 'assistant', created_at: new Date().toISOString() });

  // 6. 触发生图（不发 context_update，首条回复保持不变）
  if (tags.prompt) {
    const taskResult = db.prepare(`INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status) VALUES (?, ?, ?, 'running')`)
      .run(conversationId, tags.prompt, tags.prompt);
    const genTaskId = taskResult.lastInsertRowid;
    send('generate_start', { taskId: genTaskId, prompt: tags.prompt });
    await triggerImageGeneration(conversationId, tags.prompt, lastInsertRowid, genTaskId, send);
  } else {
    console.log('[chat] needImage follow-up: no prompt tags found, falling back');
    send('generate_error', { error: '模型未返回图像描述' });
  }
}

export default router;
