import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, getActiveGlobalRules } from '../db/index.js';
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

// ── character_id → conversation_id 映射 ──
function convId(charId) { return `char_${charId}`; }

// DELETE /api/characters/:id/messages — 清空角色对话记录（软删除）
router.delete('/characters/:id/messages', (req, res) => {
  const db = getDb();
  const conversationId = convId(req.params.id);
  const result = db.prepare(`UPDATE messages SET is_deleted = 1 WHERE conversation_id = ?`)
    .run(conversationId);
  // 重建 FTS5 索引
  db.exec(`DELETE FROM messages_fts WHERE rowid NOT IN (SELECT id FROM messages WHERE is_deleted = 0)`);
  res.json({ ok: true, deleted: result.changes });
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
      SELECT id, conversation_id, role, content, images, token_count, created_at
      FROM messages
      WHERE conversation_id = ? AND is_deleted = 0 AND created_at < ?
      ORDER BY id DESC LIMIT ?
    ) ORDER BY id ASC`;
    params.push(before, limitNum);
  } else {
    // 默认：加载最近 7 天的最新消息
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    sql = `SELECT * FROM (
      SELECT id, conversation_id, role, content, images, token_count, created_at
      FROM messages
      WHERE conversation_id = ? AND is_deleted = 0 AND created_at >= ?
      ORDER BY id DESC LIMIT ?
    ) ORDER BY id ASC`;
    params.push(weekAgo, limitNum);
  }

  const messages = db.prepare(sql).all(...params);

  // 是否还有更早的消息
  let hasMore = false;
  if (messages.length > 0) {
    const oldest = messages[0].created_at;
    const older = db.prepare(`SELECT COUNT(*) as c FROM messages WHERE conversation_id = ? AND is_deleted = 0 AND created_at < ?`)
      .get(conversationId, oldest);
    hasMore = older.c > 0;
  }

  res.json({ messages, hasMore });
});

// POST /api/characters/:id/chat — 流式对话
router.post('/characters/:id/chat', async (req, res) => {
  const { message } = req.body;
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
    // 1. 保存用户消息
    const userMsg = db.prepare(`INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)`)
      .run(conversationId, message);
    send('msg_saved', { id: userMsg.lastInsertRowid, role: 'user', created_at: new Date().toISOString() });

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
      systemPrompt += '\n\n【强制要求】用户要求生成图片。立即用 <prompt> 和 <context> 标签回复，不要问任何问题。';
    }

    // 5. 历史消息（清洗旧回复中的括号动作描写，防止错误格式在上下文中自我强化）
    const rawHistory = db.prepare(`
      SELECT role, content FROM messages
      WHERE conversation_id = ? AND is_deleted = 0 ORDER BY id DESC LIMIT 40
    `).all(conversationId).reverse();
    const history = rawHistory.map(m => ({
      role: m.role,
      content: m.role === 'assistant' ? stripBracketActions(m.content) : m.content,
    }));

    const charDisplayName = character?.display_name || '助手';
    const msgs = [
      { role: 'system', content: systemPrompt },
      ...history,
    ];
    if (explicitImageIntent) {
      msgs.push({ role: 'user', content: '请立即用 <prompt> 和 <context> 标签回复，不要额外说明。' });
    }
    // 格式锚定：在用户消息前插入 few-shot 正确格式对话范例
    // （DeepSeek/LLM 对上下文中的示例遵循度远超规则文本，这是最有效的格式矫正手段）
    // 生图意图时跳过 — 此时需要的是结构化标签输出，而非对话格式范例
    if (!explicitImageIntent) {
      msgs.splice(msgs.length - 1, 0, buildFormatAnchor(charDisplayName));
    }

    // 6. 流式生成（温度 0.65）
    // 气泡分割: 每个 chunk 内按 <br> 或连续空行切分，分隔符触发 bubble_break
    // <br> 跨越 chunk 边界的概率极低且无害（前端会 strip 残留 <br>）
    let fullContent = '';
    send('response_start', {});
    for await (const chunk of chatStream(msgs, { temperature: 0.65 })) {
      // 按分隔符切分 chunk，parts 交替: [文本, 分隔符, 文本, 分隔符, ...]
      const parts = chunk.split(/(<br\s*\/?>|\n{2,})/i);
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
          // 文本段
          if (parts[i]) {
            fullContent += parts[i];
            send('token', { content: parts[i] });
          }
        } else {
          // 分隔符
          fullContent += parts[i];
          send('bubble_break', {});
        }
      }
    }
    // 安全网：清洗输出中残留的括号动作描写
    fullContent = stripBracketActions(fullContent);
    send('response_end', {});

    // 7. 解析标签
    const tags = extractImageTags(fullContent);
    const hasNeedImageTag = !tags.prompt && hasNeedImage(fullContent);
    // context 文本也按气泡分割
    let displayContent = tags.context || stripTags(fullContent);
    displayContent = stripNeedImage(displayContent);
    if (tags.prompt || tags.context) send('context_update', { content: displayContent });

    // 8. 在 displayContent（已剥离 XML 标签的干净文本）上按气泡分割符拆分保存
    const segments = displayContent.split(/(?:<br\s*\/?>|\n{2,})/i)
      .map(s => stripBracketActions(s).trim())
      .filter(s => s.length > 0);
    const savedIds = [];
    for (const seg of segments) {
      const r = db.prepare(`INSERT INTO messages (conversation_id, role, content, token_count) VALUES (?, 'assistant', ?, ?)`)
        .run(conversationId, seg, Math.ceil(seg.length / 2));
      savedIds.push(r.lastInsertRowid);
      send('msg_saved', { id: r.lastInsertRowid, role: 'assistant', created_at: new Date().toISOString() });
    }
    if (segments.length === 0) {
      // 兜底：AI 没有返回有效文本
      const r = db.prepare(`INSERT INTO messages (conversation_id, role, content, token_count) VALUES (?, 'assistant', ?, ?)`)
        .run(conversationId, '(无回复)', 3);
      savedIds.push(r.lastInsertRowid);
      send('msg_saved', { id: r.lastInsertRowid, role: 'assistant', created_at: new Date().toISOString() });
    }
    const lastInsertRowid = savedIds[savedIds.length - 1];

    // 9. 生图（三种触发路径）
    if (tags.prompt) {
      // 路径 A: 模型直接输出了 <prompt>（正则强匹配 → 或模型自主决定）
      const db2 = getDb();
      const taskResult = db2.prepare(`INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status) VALUES (?, ?, ?, 'running')`)
        .run(conversationId, tags.prompt, tags.prompt);
      const genTaskId = taskResult.lastInsertRowid;
      send('generate_start', { taskId: genTaskId, prompt: tags.prompt });
      await triggerImageGeneration(conversationId, tags.prompt, lastInsertRowid, genTaskId, send);
    } else if (hasNeedImageTag) {
      // 路径 B: 模型追加了 <needImage>，需要二次请求获取 prompt+context
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
  const promptMatch = content.match(/<prompt>([\s\S]*?)<\/prompt>/i);
  const contextMatch = content.match(/<context>([\s\S]*?)<\/context>/i);
  return { prompt: promptMatch?.[1]?.trim() || null, context: contextMatch?.[1]?.trim() || null };
}

function hasNeedImage(content) {
  return /<needImage>/i.test(content);
}

function stripNeedImage(content) {
  return content.replace(/<needImage>/gi, '').trim();
}

function stripTags(content) {
  return content
    .replace(/<prompt>[\s\S]*?<\/prompt>/gi, '')
    .replace(/<context>[\s\S]*?<\/context>/gi, '')
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

/**
 * 构建格式锚定消息 — 用 few-shot 正确对话范例告诉模型"应该这样写回复"
 * 这是纠正括号动作描写最有效的手段，因为模型对上下文示例的遵循度远超规则文本
 */
function buildFormatAnchor(_displayName) {
  return {
    role: 'user',
    content: `[系统提示：以下示例与当前对话无关，仅供格式参考。不要照抄内容，但必须遵循格式规范。]

# 格式规范（铁律）
- 情绪通过对话文字本身传达（语气词、用词选择、语速），严禁用（括号描述动作表情）
- 每条消息之间必须用 <br> 分隔（字面字符串 <br>，独占一行）

# 正确格式
✅ 嘿嘿，是吧是吧！那家店的汤底真的超棒的，我每次路过都会去！
<br>
✅ 啊...下次...要不要一起去？我知道你也会喜欢的。
<br>
✅ 哼！才不是呢！我很厉害的好吧！只不过平时懒得出手而已啦~
<br>
✅ 等一下哦——我看看，这个好像要这样弄...

# 错误格式（禁止）
❌ （笑了笑，伸手拍拍你的肩膀）走吧，我们出发。
❌ （眼神忽然变得认真，语气低沉）这件事没那么简单。
❌ 嘿嘿，是吧是吧！\n\n啊...下次要不要一起去？（用换行而非 <br>）

记住：用字面 <br> 分隔每条消息，不要用换行代替，不要括号描写。`,
  };
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
  // 取最后一条用户消息 + 最后一条助手消息作为判断上下文
  // 不直接 LIMIT 2 是因为助手回复会被气泡分割拆成多条 DB 记录
  const lastUser = db.prepare(`
    SELECT content FROM messages
    WHERE conversation_id = ? AND is_deleted = 0 AND role = 'user'
    ORDER BY id DESC LIMIT 1
  `).get(conversationId);

  const lastAssistant = db.prepare(`
    SELECT content FROM messages
    WHERE conversation_id = ? AND is_deleted = 0 AND role = 'assistant'
    ORDER BY id DESC LIMIT 1
  `).get(conversationId);

  if (!lastUser && !lastAssistant) return false;

  // 构建极简判断 prompt — 用户一条 + 助手一条
  const parts = [];
  if (lastUser) parts.push(`用户: ${lastUser.content.slice(0, 400)}`);
  if (lastAssistant) parts.push(`助手: ${lastAssistant.content.slice(0, 400)}`);
  const ctx = parts.join('\n');

  const judgePrompt = `判断：以上对话是否需要配一张图片来增强表达效果？只回答"是"或"否"。`;

  try {
    const result = await chatSync([
      { role: 'system', content: '你是一个简洁的判断助手。你的唯一任务是：阅读对话，判断是否配一张图会让表达更好。只回复"是"或"否"，不要解释。' },
      { role: 'user', content: ctx + '\n\n' + judgePrompt },
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
 *   后端再请求一次模型，让它补上 <prompt> + <context> →
 *   然后走正常生图流程
 */
async function handleNeedImageFlow(conversationId, character, send) {
  const db = getDb();
  console.log('[chat] needImage detected, requesting prompt from model...');

  // 1. 构建二次请求的 system prompt（规则前置 + 人格在后 + 强制生图指令）
  const globalRules = getActiveGlobalRules();
  let systemPrompt = globalRules ? globalRules + '\n\n' : '';
  systemPrompt += character?.base_prompt || getDefaultPrompt();
  systemPrompt += '\n\n【强制要求】你刚才判断用户想要一张图片。现在请立即用 <prompt> 和 <context> 标签描述一张合适的画面。不要额外解释，不要确认，直接输出两个标签。';

  // 2. 加载历史（清洗括号，防止错误格式污染二次请求上下文）
  const rawHistory = db.prepare(`
    SELECT role, content FROM messages
    WHERE conversation_id = ? AND is_deleted = 0 ORDER BY id DESC LIMIT 40
  `).all(conversationId).reverse();
  const history = rawHistory.map(m => ({
    role: m.role,
    content: m.role === 'assistant' ? stripBracketActions(m.content) : m.content,
  }));

  const msgs = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: '请立即用 <prompt> 和 <context> 标签回复，不要额外说明。' },
  ];

  // 3. 静默请求模型生成 prompt + context（不流式，避免前端气泡混乱）
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
  const displayContent = tags.context || stripTags(fullContent);

  // 5. 保存第二轮回复（context 文本，用户下次进入对话可见）
  const lastInsertRowid = db.prepare(`INSERT INTO messages (conversation_id, role, content, token_count) VALUES (?, 'assistant', ?, ?)`)
    .run(conversationId, displayContent, Math.ceil(displayContent.length / 2)).lastInsertRowid;

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
