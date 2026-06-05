import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';
import { chatStream } from '../llm/deepseek.js';
import { hybridSearch } from '../services/memorySearch.js';
import { extractMemoryFragments } from '../services/memoryExtractor.js';
import { maybeSummarize, getRecentSummaries } from '../services/summarizer.js';
import {
  loadEmotionState,
  evolveEmotion,
  evaluateStimulus,
  emotionToPrompt,
  saveEmotionSnapshot,
  emotionDashboard,
} from '../services/emotionEngine.js';
import { generateImage } from '../services/imageSkill.js';

const router = Router();

// GET /api/conversations — 列出所有会话
router.get('/', (req, res) => {
  const db = getDb();
  const conversations = db.prepare(`
    SELECT
      c.conversation_id,
      COUNT(m.id) AS message_count,
      MAX(m.created_at) AS last_message_at,
      (SELECT m2.content FROM messages m2
       WHERE m2.conversation_id = c.conversation_id AND m2.role = 'user'
       ORDER BY m2.created_at DESC LIMIT 1
      ) AS last_user_message
    FROM (SELECT DISTINCT conversation_id FROM messages) c
    LEFT JOIN messages m ON m.conversation_id = c.conversation_id
    GROUP BY c.conversation_id
    ORDER BY last_message_at DESC
  `).all();
  res.json({ conversations });
});

// GET /api/conversations/:id/messages — 获取会话消息
router.get('/:id/messages', (req, res) => {
  const db = getDb();
  const { limit = '50', before } = req.query;

  let sql = `SELECT id, conversation_id, role, content, token_count, created_at
             FROM messages
             WHERE conversation_id = ? AND is_deleted = 0`;
  const params = [req.params.id];

  if (before) {
    sql += ` AND id < ?`;
    params.push(parseInt(before, 10));
  }

  sql += ` ORDER BY id ASC LIMIT ?`;
  params.push(parseInt(limit, 10));

  const messages = db.prepare(sql).all(...params);
  const hasMore = messages.length === parseInt(limit, 10);

  res.json({ messages, hasMore });
});

// GET /api/conversations/:id/emotion — 获取当前会话的情绪状态
router.get('/:id/emotion', (req, res) => {
  const db = getDb();
  const conversationId = req.params.id;
  const characterId = req.query.character_id;

  const baseline = getCharacterBaseline(characterId);
  const state = loadEmotionState(conversationId, baseline);

  res.json({
    conversation_id: conversationId,
    instant: state.instant,
    mood: state.mood,
    baseline,
  });
});

// POST /api/conversations/:id/chat — 流式对话（完整管线）
router.post('/:id/chat', async (req, res) => {
  const { message, character_id } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  const db = getDb();
  const conversationId = req.params.id;

  // 设置 SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // ── 1. 保存用户消息 ──
    const userMsg = db.prepare(`
      INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)
    `).run(conversationId, message);

    send('msg_saved', { id: userMsg.lastInsertRowid, role: 'user' });

    // ── 2. 加载角色 & 情绪 ──
    const character = loadCharacter(character_id);
    const emotionBaseline = character
      ? JSON.parse(character.emotion_baseline || '{"valence":0.5,"arousal":0.5,"dominance":0.5}')
      : { valence: 0.5, arousal: 0.5, dominance: 0.5 };
    const emotionState = loadEmotionState(conversationId, emotionBaseline);

    // ── 3. 检测用户生图意图 ──
    const forceGenerate = detectImageIntent(message);

    // ── 4. 构建 system prompt ──
    send('status', { stage: 'building_prompt' });
    let systemPrompt = await buildSystemPrompt(
      conversationId, character, message, emotionState
    );

    // 如果检测到生图意图，强制追加生成指令
    if (forceGenerate) {
      systemPrompt += '\n\n【强制要求】用户刚才的发言明确要求生成图片。你必须立即使用 <prompt> 和 <context> 标签回复。不要问任何问题，直接生成。';
    }

    // ── 5. 获取最近消息历史 ──
    const history = db.prepare(`
      SELECT role, content FROM messages
      WHERE conversation_id = ? AND is_deleted = 0
      ORDER BY id DESC LIMIT 40
    `).all(conversationId).reverse();

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
    ];

    // 如果生图意图，再追加一条 user 消息强化指令
    if (forceGenerate) {
      messages.push({ role: 'user', content: '请立即用 <prompt> 和 <context> 标签回复，不要额外说明。' });
    }

    // ── 7. 流式生成 ──
    let fullContent = '';
    send('response_start', {});

    for await (const chunk of chatStream(messages)) {
      fullContent += chunk;
      send('token', { content: chunk });
    }

    send('response_end', {});

    // ── 8. 解析标签：<prompt> + <context> ──
    const tags = extractImageTags(fullContent);
    const displayContent = tags.context || stripTags(fullContent);

    if (tags.prompt || tags.context) {
      send('context_update', { content: displayContent });
    }

    // ── 9. 保存 AI 回复 ──
    const aiMsg = db.prepare(`
      INSERT INTO messages (conversation_id, role, content, token_count)
      VALUES (?, 'assistant', ?, ?)
    `).run(conversationId, displayContent, Math.ceil(displayContent.length / 2));

    send('msg_saved', { id: aiMsg.lastInsertRowid, role: 'assistant' });

    // ── 10. 生图 ──
    if (tags.prompt) {
      send('generate_start', { prompt: tags.prompt });
      await triggerImageGeneration(conversationId, tags.prompt, send);
    }

    // ── 11. 后处理 ──
    setImmediate(async () => {
      try {
        const { delta, dominantEmotion } = await evaluateStimulus(message, fullContent);
        const evolved = evolveEmotion(emotionState, delta, emotionBaseline);
        saveEmotionSnapshot(conversationId, aiMsg.lastInsertRowid, evolved, dominantEmotion);
        console.log(`[emotion] ${emotionDashboard(evolved, dominantEmotion)}`);
        await extractMemoryFragments(conversationId, userMsg.lastInsertRowid, aiMsg.lastInsertRowid);
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

// POST /api/conversations — 新建会话
router.post('/', (req, res) => {
  const conversationId = uuidv4();
  res.status(201).json({ conversation_id: conversationId });
});

// DELETE /api/conversations/:id — 软删除会话消息
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE messages SET is_deleted = 1 WHERE conversation_id = ?`)
    .run(req.params.id);
  res.json({ ok: true });
});

// ── 内部函数 ──

/**
 * 检测用户消息是否包含生图意图
 */
function detectImageIntent(message) {
  const patterns = [
    /画[一个张幅]/,
    /生成[一个张幅]?图/,
    /给我[看看瞧瞧]/,
    /展示[一下]/,
    /来[一个张幅]/,
    /帮我画/,
    /帮我生成/,
    /做[一个张幅]图/,
    /画出来/,
    /生成出来/,
    /我想要[一个张幅]?图/,
    /能[不能]?画/,
    /能不能画/,
    /出[一个张幅]图/,
    /创建[一个张幅]?图/,
    /制作[一个张幅]?图/,
    /整[一个张幅]/,
    /来[张个幅]图/,
    /要[一个张幅]图/,
    /搞[一个张幅]/,
    /设计[一个张幅]?图/,
  ];
  return patterns.some(p => p.test(message));
}

// ── 内部函数 ──

/**
 * 加载角色配置
 */
function loadCharacter(characterId) {
  if (!characterId) return null;
  return getDb().prepare('SELECT * FROM characters WHERE id = ? AND is_active = 1').get(characterId);
}

/**
 * 获取角色情绪基线
 */
function getCharacterBaseline(characterId) {
  const character = loadCharacter(characterId);
  if (character) {
    return JSON.parse(character.emotion_baseline || '{"valence":0.5,"arousal":0.5,"dominance":0.5}');
  }
  return { valence: 0.5, arousal: 0.5, dominance: 0.5 };
}

/**
 * 构建 system prompt — 四层叠加:
 *
 *   第零层: 固定人格（完整传入）
 *   第一层: 动态记忆（RAG 召回，三路 + RRF）
 *   第二层: 滚动摘要（历史上下文）
 *   第三层: 动态情绪（VAD 状态 → 自然语言）
 */
async function buildSystemPrompt(conversationId, character, userMessage, emotionState) {
  const promptParts = [];

  // ── 第零层: 固定人格 ──
  const basePrompt = character?.base_prompt || getDefaultPrompt();
  promptParts.push(basePrompt);

  // ── 第一层: RAG 动态记忆 ──
  try {
    const memories = await Promise.race([
      hybridSearch(userMessage, { conversationId, topK: 8 }),
      new Promise(r => setTimeout(() => r([]), 3000)),
    ]);

    if (memories.length > 0) {
      const facts = memories.filter(m => m.fragment_type === 'fact');
      const prefs = memories.filter(m => m.fragment_type === 'preference');
      const emotions = memories.filter(m => m.fragment_type === 'emotion');

      const memoryLines = ['\n[相关记忆]'];

      if (facts.length > 0) {
        memoryLines.push('已知信息:');
        facts.forEach(f => memoryLines.push(`- ${f.content}`));
      }
      if (prefs.length > 0) {
        memoryLines.push('用户偏好:');
        prefs.forEach(p => memoryLines.push(`- ${p.content}`));
      }
      if (emotions.length > 0) {
        memoryLines.push('近期情绪:');
        emotions.forEach(e => memoryLines.push(`- ${e.content}`));
      }

      promptParts.push(memoryLines.join('\n'));
    }
  } catch (err) {
    console.error('[systemPrompt] memory recall failed:', err.message);
  }

  // ── 第二层: 滚动摘要 ──
  try {
    const summaries = getRecentSummaries(conversationId, 2);
    if (summaries.length > 0) {
      promptParts.push(
        `\n[对话历史摘要]\n${summaries.map(s => s.summary).join('\n\n')}`
      );
    }
  } catch (err) {
    console.error('[systemPrompt] summary recall failed:', err.message);
  }

  // ── 第三层: 动态情绪 ──
  try {
    const emotionFragment = emotionToPrompt(emotionState);
    if (emotionFragment) {
      promptParts.push(emotionFragment);
    }
  } catch (err) {
    console.error('[systemPrompt] emotion injection failed:', err.message);
  }

  return promptParts.join('\n');
}

function getDefaultPrompt() {
  return `你是一个创意图像生成助手。用户会和你聊天，描述他们想生成的图像。
你可以帮助优化图像描述，使其更适合 AI 图像生成。
请用中文回复，语气友好而专业。

【重要】当用户想要生成图片时，你的回复必须包含两个标签：

<prompt>
[这里是需要画的内容，详细描述画面，用中文]
- 如果是IP角色，注明：角色名（作品名），例如"芙宁娜（原神）"
- 描述场景在哪、什么镜头角度、角色表情、衣服、动作
- 多角色时必须区分：什么发色的谁在做什么动作
- 举例：白色头发的芙宁娜（原神）正在大笑着双腿分开双手举高吃蛋糕，旁边黑色头发的钟离（原神）正在哭着双手叉腰高抬腿。
</prompt>

<context>
[这里是你带着图片回复用户的话，自然口语化，带感情]
- 假设图片已经生成好了，你正在带着这张图跟用户说话
- 不要描述图片内容！而是基于图片内容做自然的联想和互动
- 例如："看，我就说有这件事吧"、"狗狗确实很可爱吧~"、"我也有冰激凌吃！"
</context>

注意：<context>标签内的文字会显示给用户，<prompt>标签内的文字会用于生成图片。两个标签缺一不可。`;
}

// ── 生图集成 ──

/**
 * 从 AI 回复中提取 <prompt> 和 <context> 标签
 */
function extractImageTags(content) {
  const promptMatch = content.match(/<prompt>([\s\S]*?)<\/prompt>/i);
  const contextMatch = content.match(/<context>([\s\S]*?)<\/context>/i);

  return {
    prompt: promptMatch ? promptMatch[1].trim() : null,
    context: contextMatch ? contextMatch[1].trim() : null,
  };
}

/**
 * 去掉所有标签，只保留显示文本
 */
function stripTags(content) {
  return content
    .replace(/<prompt>[\s\S]*?<\/prompt>/gi, '')
    .replace(/<context>[\s\S]*?<\/context>/gi, '')
    .replace(/<generate>[\s\S]*?<\/generate>/gi, '')
    .trim();
}

/**
 * 触发 ComfyUI 生图并通过 SSE 发送进度和结果
 */
async function triggerImageGeneration(conversationId, prompt, send) {
  const db = getDb();

  const taskResult = db.prepare(`
    INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status)
    VALUES (?, ?, ?, 'running')
  `).run(conversationId, prompt, prompt);

  const taskId = taskResult.lastInsertRowid;

  try {
    const result = await generateImage(prompt, {
      onProgress: (p) => {
        send('generate_progress', { taskId, ...p });
      },
    });

    if (result.success && result.images.length > 0) {
      db.prepare(`
        UPDATE image_tasks SET status = 'done', output_paths = ?, finished_at = datetime('now')
        WHERE id = ?
      `).run(JSON.stringify(result.images.map(i => i.filename)), taskId);

      send('generate_done', { taskId, images: result.images, source: result.source });
    } else {
      throw new Error(result.error || 'No images generated');
    }
  } catch (err) {
    console.error('[chat] generate failed:', err.message);

    db.prepare(`
      UPDATE image_tasks SET status = 'failed', error_message = ?, finished_at = datetime('now')
      WHERE id = ?
    `).run(err.message, taskId);

    send('generate_error', { taskId, error: err.message });
  }
}

export default router;
