import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/index.js';
import { chatStream } from '../llm/deepseek.js';
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

// GET /api/characters/:id/messages — 获取角色对话消息
router.get('/characters/:id/messages', (req, res) => {
  const db = getDb();
  const conversationId = convId(req.params.id);
  const { limit = '50', before } = req.query;

  let sql = `SELECT id, conversation_id, role, content, images, token_count, created_at
             FROM messages WHERE conversation_id = ? AND is_deleted = 0`;
  const params = [conversationId];
  if (before) { sql += ` AND id < ?`; params.push(parseInt(before, 10)); }
  sql += ` ORDER BY id ASC LIMIT ?`;
  params.push(parseInt(limit, 10));

  const messages = db.prepare(sql).all(...params);
  res.json({ messages, hasMore: messages.length === parseInt(limit, 10) });
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

    // 3. system prompt（固定人格，不叠加记忆和情绪）
    let systemPrompt = character?.base_prompt || getDefaultPrompt();

    // 4. 生图意图
    if (detectImageIntent(message)) {
      systemPrompt += '\n\n【强制要求】用户要求生成图片。立即用 <prompt> 和 <context> 标签回复，不要问任何问题。';
    }

    // 5. 历史消息
    const history = db.prepare(`
      SELECT role, content FROM messages
      WHERE conversation_id = ? AND is_deleted = 0 ORDER BY id DESC LIMIT 40
    `).all(conversationId).reverse();

    const msgs = [
      { role: 'system', content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
    ];
    if (detectImageIntent(message)) {
      msgs.push({ role: 'user', content: '请立即用 <prompt> 和 <context> 标签回复，不要额外说明。' });
    }

    // 6. 流式生成
    let fullContent = '';
    send('response_start', {});
    for await (const chunk of chatStream(msgs)) {
      fullContent += chunk;
      send('token', { content: chunk });
    }
    send('response_end', {});

    // 7. 解析标签
    const tags = extractImageTags(fullContent);
    const displayContent = tags.context || stripTags(fullContent);
    if (tags.prompt || tags.context) send('context_update', { content: displayContent });

    // 8. 保存回复
    const aiMsg = db.prepare(`INSERT INTO messages (conversation_id, role, content, token_count) VALUES (?, 'assistant', ?, ?)`)
      .run(conversationId, displayContent, Math.ceil(displayContent.length / 2));
    send('msg_saved', { id: aiMsg.lastInsertRowid, role: 'assistant', created_at: new Date().toISOString() });

    // 9. 生图
    if (tags.prompt) {
      send('generate_start', { prompt: tags.prompt });
      await triggerImageGeneration(conversationId, tags.prompt, aiMsg.lastInsertRowid, send);
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
          saveEmotionSnapshot(conversationId, aiMsg.lastInsertRowid, evolved, dominantEmotion);
          console.log(`[emotion] ${emotionDashboard(evolved, dominantEmotion)}`);
        }
        if (config.features.memoryExtract) {
          await extractMemoryFragments(conversationId, userMsg.lastInsertRowid, aiMsg.lastInsertRowid);
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
  return [/画[一个张幅]/, /生成[一个张幅]?图/, /给我[看看瞧瞧]/, /展示[一下]/, /来[一个张幅]/, /帮我画/, /帮我生成/,
    /做[一个张幅]图/, /画出来/, /生成出来/, /我想要[一个张幅]?图/, /能[不能]?画/, /能不能画/, /出[一个张幅]图/,
    /创建[一个张幅]?图/, /制作[一个张幅]?图/, /整[一个张幅]/, /来[张个幅]图/, /要[一个张幅]图/, /搞[一个张幅]/, /设计[一个张幅]?图/,
  ].some(p => p.test(message));
}

function extractImageTags(content) {
  const promptMatch = content.match(/<prompt>([\s\S]*?)<\/prompt>/i);
  const contextMatch = content.match(/<context>([\s\S]*?)<\/context>/i);
  return { prompt: promptMatch?.[1]?.trim() || null, context: contextMatch?.[1]?.trim() || null };
}

function stripTags(content) {
  return content.replace(/<prompt>[\s\S]*?<\/prompt>/gi, '').replace(/<context>[\s\S]*?<\/context>/gi, '').replace(/<generate>[\s\S]*?<\/generate>/gi, '').trim();
}

function getDefaultPrompt() {
  return `你是一个创意图像生成助手。用户会和你聊天，描述他们想生成的图像。
你可以帮助优化图像描述，使其更适合 AI 图像生成。请用中文回复，语气友好而专业。

当用户想要生成图片时，你的回复必须包含两个标签：

<prompt>描述需要画的内容，用中文。需要详细：IP角色注明角色名（作品名）；描述场景、镜头、表情、衣服、动作；多角色时区分发色和动作。</prompt>
<context>假设图片已生成，带着图跟用户说话。不要描述图片内容，自然联想互动。</context>`;
}

async function triggerImageGeneration(conversationId, prompt, assistantMsgId, send) {
  const db = getDb();
  const taskResult = db.prepare(`INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status) VALUES (?, ?, ?, 'running')`)
    .run(conversationId, prompt, prompt);
  const taskId = taskResult.lastInsertRowid;

  // 计算 public/images 的绝对路径（app.js 所在目录/public/images）
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.dirname(path.dirname(path.dirname(__filename))); // agent-core/
  const imagesDir = path.join(projectRoot, 'public', 'images');

  try {
    const result = await generateImage(prompt, { onProgress: (p) => send('generate_progress', { taskId, ...p }) });
    if (result.success && result.images.length > 0) {
      // 落盘 base64 图片到 public/images/，构建 URL 数组
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

export default router;
