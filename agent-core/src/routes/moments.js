import { Router } from 'express';
import { saveBase64Image } from '../services/imagePaths.js';
import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting, getGlobalRule } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';
import { generateImageRaw } from '../services/imageSkill.js';
import { charArtistOverrideWithFallback } from '../services/characterImageOpts.js';
import { buildCharacterPersona } from '../services/characterPersona.js';
import { createCharacterTownLifeContext } from '../services/characterTownLifeContext.js';
import { createTownActorRegistry } from '../services/town/townActorRegistry.js';
import { recordCompletedImageTask } from '../services/imageTaskRecorder.js';
import { broadcast as broadcastToUnified } from '../services/unifiedStreamBus.js';
import { getTimeTag, getLightNoteWithWeather } from '../services/timeLight.js';
import { getCurrentActivity } from '../services/scheduleManager.js';
import { triggerFriendComments } from '../services/momentInteractionService.js';
import { publishUserMoment } from '../services/momentUserPostService.js';
import { handleUserComment } from '../services/momentCommentService.js';
import { getWorldIntegrationRule } from '../builtinRules.js';
import { DEFAULT_MOMENT_IMAGE_PROMPT, parseMomentResponse, sanitizeMomentContent } from '../services/momentResponseParser.js';
import { MOMENT_FORMS, weightedPick, pickMomentImageCount, MOMENT_SINGLE_FOCUS_RULE, MOMENT_TONE_RULES, MOMENT_IMAGE_RULES, buildMomentOutputFormat, buildMomentMotiveDirective, buildMomentScheduleContext, buildMomentMultiImageRule, MOMENT_RECORD_BACKDROP_RULE } from '../services/momentForms.js';

const router = Router();

/**
 * 把落库的 prompt 拆回逐张提示词（多图用 `---` 分隔线拼接）
 * 空 prompt 回退默认风景提示词，保证补图总有可用提示词
 * @returns {string[]}
 */
export function splitMomentImagePrompts(prompt) {
  const prompts = String(prompt || '')
    .split(/\n?\s*---\s*\n?/)
    .map(s => s.trim())
    .filter(Boolean);
  return prompts.length > 0 ? prompts : [DEFAULT_MOMENT_IMAGE_PROMPT];
}

/**
 * 解析落库的 `WxH` 分辨率，缺失或非法时回退当前配置的出图尺寸
 * @returns {{ width: number, height: number }}
 */
export function parseMomentResolution(resolution) {
  const match = /^(\d+)x(\d+)$/.exec(String(resolution || '').trim());
  if (!match) {
    return { width: config.comfyui.momentsWidth, height: config.comfyui.momentsHeight };
  }
  return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
}

// Helper: SQLite datetime → ISO (UTC)
function toISO(dt) {
  if (!dt) return dt;
  return dt.replace(' ', 'T') + '.000Z';
}

// Helper: ISO → SQLite comparable datetime
function toSQLite(dt) {
  if (!dt) return dt;
  return dt.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

// Helper: 获取用户昵称
function userNickname() {
  return config.user.nickname || '我';
}

// ──────────────── SSE 推送 ────────────────

const sseClients = new Set();

/** 向所有连接的 SSE 客户端广播新帖事件 */
function broadcastNewPost(postInfo) {
  const data = JSON.stringify(postInfo);
  const payload = `event: new_post\ndata: ${data}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
  broadcastToUnified('new_post', postInfo);
}

/** 向所有连接的 SSE 客户端广播新评论事件（关系网互动） */
function broadcastNewComment(commentData) {
  const data = JSON.stringify(commentData);
  const payload = `event: new_comment\ndata: ${data}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
  broadcastToUnified('new_comment', commentData);
}

// GET /api/moments/stream — SSE 推送端点（新帖实时通知）
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write('event: connected\ndata: {}\n\n');
  sseClients.add(res);

  // 心跳：每 30s 发送 keepalive，防止代理断连
  const heartbeat = setInterval(() => {
    try { res.write(':keepalive\n\n'); } catch { clearInterval(heartbeat); sseClients.delete(res); }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// GET /api/moments/unread-count — 获取未读计数（基于 last_moments_seen_at 时序）
router.get('/unread-count', (req, res) => {
  const db = getDb();
  const lastSeen = db.prepare(
    `SELECT setting_value FROM system_settings WHERE setting_key = 'last_moments_seen_at'`
  ).pluck().get() || '1970-01-01T00:00:00.000Z';

  // 转换为 SQLite datetime 格式（ISO → "YYYY-MM-DD HH:MM:SS"）
  const lastSeenSQLite = toSQLite(lastSeen);

  const row = db.prepare(
    `SELECT COUNT(*) AS count FROM moment_posts WHERE status = 'done' AND created_at > ?`
  ).get(lastSeenSQLite);

  res.json({ count: row ? row.count : 0 });
});

// POST /api/moments/mark-read — 更新 last_moments_seen_at（进入朋友圈页面时调用）
router.post('/mark-read', (req, res) => {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES ('last_moments_seen_at', ?, CURRENT_TIMESTAMP)`
  ).run(now);
  res.json({ ok: true, lastSeenAt: now });
});

// ──────────────── 朋友圈帖子 ────────────────

// GET /api/moments — 全量返回所有帖子（本地 SQLite，数据量可控，无需分页）
router.get('/', (req, res) => {
  const db = getDb();
  const nickname = userNickname();

  const posts = db.prepare(`
    SELECT mp.*,
      COALESCE(c.display_name, n.display_name, ?) AS display_name,
      CASE WHEN mp.npc_id IS NOT NULL
        THEN (SELECT image_path FROM town_assets WHERE key = 'npc_' || mp.npc_id || '_portrait' AND status = 'ready')
        ELSE c.avatar_path END AS avatar_path,
      CASE WHEN mp.npc_id IS NOT NULL THEN 'npc'
           WHEN mp.character_id IS NOT NULL THEN 'character'
           ELSE 'user' END AS author_type,
      (SELECT COUNT(*) FROM moment_comments WHERE post_id = mp.id) AS comment_count,
      (SELECT COUNT(*) FROM moment_likes WHERE post_id = mp.id) AS like_count,
      (SELECT id FROM moment_likes WHERE post_id = mp.id) IS NOT NULL AS liked
    FROM moment_posts mp
    LEFT JOIN characters c ON c.id = mp.character_id
    LEFT JOIN town_npcs n ON n.id = mp.npc_id
    WHERE mp.status = 'done'
    ORDER BY mp.id DESC
  `).all(nickname).map(p => ({
    ...p,
    content: sanitizeMomentContent(p.content),
    liked: !!p.liked,
    images: JSON.parse(p.images || '[]'),
    created_at: toISO(p.created_at),
  }));

  res.json({ posts });
});

// GET /api/moments/:id — 单个帖子详情（含评论）
router.get('/:id', (req, res) => {
  const db = getDb();
  const nickname = userNickname();

  const post = db.prepare(`
    SELECT mp.*,
      COALESCE(c.display_name, n.display_name, ?) AS display_name,
      CASE WHEN mp.npc_id IS NOT NULL
        THEN (SELECT image_path FROM town_assets WHERE key = 'npc_' || mp.npc_id || '_portrait' AND status = 'ready')
        ELSE c.avatar_path END AS avatar_path,
      CASE WHEN mp.npc_id IS NOT NULL THEN 'npc'
           WHEN mp.character_id IS NOT NULL THEN 'character'
           ELSE 'user' END AS author_type
    FROM moment_posts mp
    LEFT JOIN characters c ON c.id = mp.character_id
    LEFT JOIN town_npcs n ON n.id = mp.npc_id
    WHERE mp.id = ?
  `).get(nickname, req.params.id);

  if (!post) return res.status(404).json({ error: 'Post not found' });

  // 回复对象优先取显式 reply_to_comment_id（用户楼中楼 / @ 回评），
  // 关系网自动评论（无显式指向）回退到线程内前一条评论的旧口径
  const comments = db.prepare(`
    SELECT mc.*,
      CASE WHEN mc.author_type = 'character' THEN c.display_name ELSE NULL END AS char_display_name,
      CASE WHEN mc.author_type = 'character' THEN c.avatar_path ELSE NULL END AS char_avatar_path,
      CASE WHEN rt.id IS NOT NULL
        THEN CASE WHEN rt.author_type = 'character' THEN rc.display_name ELSE ? END
        ELSE NULL END AS reply_to_name,
      CASE WHEN rt.id IS NOT NULL AND rt.author_type = 'character'
        THEN rc.avatar_path ELSE NULL END AS reply_to_avatar_path,
      CASE WHEN rt.id IS NOT NULL
        THEN rt.author_type ELSE NULL END AS reply_to_author_type
    FROM moment_comments mc
    LEFT JOIN characters c ON c.id = mc.author_id AND mc.author_type = 'character'
    LEFT JOIN moment_comments prev ON prev.id = (
      SELECT p2.id FROM moment_comments p2
      WHERE p2.post_id = mc.post_id
        AND p2.thread_root_id = mc.thread_root_id
        AND p2.id < mc.id
      ORDER BY p2.id DESC LIMIT 1
    )
    LEFT JOIN moment_comments rt ON rt.id = COALESCE(mc.reply_to_comment_id, CASE WHEN mc.auto_trigger = 1 THEN prev.id END)
    LEFT JOIN characters rc ON rc.id = rt.author_id AND rt.author_type = 'character'
    WHERE mc.post_id = ?
    ORDER BY mc.id ASC
  `).all(nickname, req.params.id);

  const liked = !!db.prepare('SELECT id FROM moment_likes WHERE post_id = ?').get(post.id);

  res.json({
    ...post,
    content: sanitizeMomentContent(post.content),
    images: JSON.parse(post.images || '[]'),
    created_at: toISO(post.created_at),
    comments: comments.map(c => ({ ...c, created_at: toISO(c.created_at) })),
    liked,
  });
});

// POST /api/moments/generate — 手动触发某角色发帖
router.post('/generate', async (req, res) => {
  const { character_id } = req.body;
  if (!character_id) return res.status(400).json({ error: 'character_id is required' });

  const db = getDb();
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(character_id);
  if (!character) return res.status(404).json({ error: 'Character not found' });

  try {
    const result = await generateMomentPost(character, { manual: true });
    res.json(result);
  } catch (err) {
    console.error('[moments] generate error:', err.message);
    if (err.message === 'ALREADY_GENERATING') {
      return res.status(409).json({ error: '该角色正在生成朋友圈中，请稍后再试' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/moments/:id — 编辑帖子文字（原 content 直接覆盖，读取时统一走 sanitizeMomentContent）
router.put('/:id', (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' });
  }
  const db = getDb();
  const post = db.prepare('SELECT id FROM moment_posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  db.prepare('UPDATE moment_posts SET content = ? WHERE id = ?').run(content.trim(), req.params.id);
  res.json({ ok: true, content: content.trim() });
});

// DELETE /api/moments/:id — 删除帖子及关联的评论和点赞
router.delete('/:id', (req, res) => {
  const db = getDb();
  // 显式清理评论和点赞（兼容旧 DB 无 CASCADE）
  db.prepare('DELETE FROM moment_likes WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM moment_comments WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM moment_posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ──────────────── 评论 ────────────────

// POST /api/moments/user-post — 用户自己发朋友圈（文字 + 可选本地图片），角色随后陆续来评论
router.post('/user-post', async (req, res) => {
  try {
    const post = await publishUserMoment(
      { content: req.body?.content, images: req.body?.images },
      { broadcastPost: broadcastNewPost }
    );
    res.json(post);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[moments] user post error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// POST /api/moments/:id/comments — 发评论 + 角色自动回复
// body: { content, reply_to_comment_id? }
//   - 普通评论：帖主（角色帖）回评（原有行为）
//   - content 里 @ 了角色：被点名的角色回评
//   - reply_to_comment_id：楼中楼，被回复评论的作者回评
router.post('/:id/comments', async (req, res) => {
  const { content, reply_to_comment_id } = req.body;
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'content is required' });
  }

  const db = getDb();
  const post = db.prepare(`
    SELECT mp.*, c.display_name, c.base_prompt, c.avatar_path, c.emotion_baseline
    FROM moment_posts mp
    LEFT JOIN characters c ON c.id = mp.character_id
    WHERE mp.id = ?
  `).get(req.params.id);

  if (!post) return res.status(404).json({ error: 'Post not found' });

  try {
    const result = await handleUserComment({
      post,
      content,
      replyToCommentId: reply_to_comment_id != null ? Number(reply_to_comment_id) : null,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[moments] comment error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/moments/:id/comments/:commentId
router.delete('/:id/comments/:commentId', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM moment_comments WHERE id = ? AND post_id = ?')
    .run(req.params.commentId, req.params.id);
  res.json({ ok: true });
});

// ──────────────── 点赞 ────────────────

// POST /api/moments/:id/like — 切换点赞状态（toggle）
router.post('/:id/like', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM moment_likes WHERE post_id = ?').get(req.params.id);
  if (existing) {
    db.prepare('DELETE FROM moment_likes WHERE post_id = ?').run(req.params.id);
    res.json({ liked: false });
  } else {
    db.prepare('INSERT INTO moment_likes (post_id) VALUES (?)').run(req.params.id);
    res.json({ liked: true });
  }
});

// POST /api/moments/:id/regenerate-image — 按帖子原本的提示词重新出图（补上没生成出来的配图）
router.post('/:id/regenerate-image', async (req, res) => {
  const db = getDb();
  const post = db.prepare(
    'SELECT id, character_id, npc_id, content, prompt, resolution FROM moment_posts WHERE id = ?'
  ).get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  // 作者可能是角色（character_id）或镇民（npc_id，character_id 为 NULL），两者都支持补图
  const isNpcPost = post.character_id == null;
  const author = isNpcPost
    ? (post.npc_id != null ? db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(post.npc_id) : null)
    : db.prepare('SELECT * FROM characters WHERE id = ?').get(post.character_id);
  if (!author) {
    return res.status(404).json({ error: isNpcPost ? 'NPC not found' : 'Character not found' });
  }

  // 落库的 prompt 多图时用分隔线拼接，按同一分隔线拆回逐张提示词
  const imagePrompts = splitMomentImagePrompts(post.prompt);
  // 宽高沿用发帖时记录的尺寸，解析失败再退回当前配置
  const { width, height } = parseMomentResolution(post.resolution);

  try {
    const { imageUrls, usedPrompts } = await (isNpcPost
      ? generateTownNpcMomentImages(author, imagePrompts, {
          text: post.content || '',
          width,
          height,
          postId: post.id,
        })
      : generateMomentImages(author, imagePrompts, {
          text: post.content || '',
          manual: true,
          otherChars: [],
          width,
          height,
          postId: post.id,
        }));
    if (imageUrls.length === 0) {
      return res.status(502).json({ error: '图片生成失败，请稍后重试' });
    }
    const prompt = usedPrompts.length > 0 ? usedPrompts.join('\n---\n') : post.prompt;
    db.prepare(`
      UPDATE moment_posts
      SET images = ?, prompt = ?, status = 'done', error_message = NULL
      WHERE id = ?
    `).run(JSON.stringify(imageUrls), prompt, post.id);
    res.json({ ok: true, images: imageUrls });
  } catch (err) {
    console.error(`[moments] Regenerate image failed for post ${post.id}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────── 内部函数 ────────────────

// 配图张数分布：70% 一张 / 20% 两张 / 10% 三张
// 多于一张时 LLM 一并给出对应数量的 prompt，之后串行出图
// 形态池/配图工具与镇民发帖共用，见 services/momentForms.js

/**
 * 朋友圈配图生成（发帖与补图共用）
 * 串行出图，单张失败只丢那一张、不影响其余张；不抛异常，全军覆没时返回空 imageUrls
 * @returns {Promise<{ imageUrls: string[], usedPrompts: string[] }>}
 */
async function generateMomentImages(character, imagePrompts, opts = {}) {
  const db = getDb();
  const {
    text = '',
    manual = false,
    otherChars = [],
    width = config.comfyui.momentsWidth,
    height = config.comfyui.momentsHeight,
    postId = null,
  } = opts;

  const imageUrls = [];
  const usedPrompts = [];
  try {
    // 构建 lora 参数：合并自身 + 对方们的 lora
    let loraOpts = {};
    const selfLoras = _parseCharLoras(character.loras);
    const otherLoras = otherChars.flatMap(c => _parseCharLoras(c.loras));
    const allLoras = [...selfLoras, ...otherLoras];
    const seen = new Set();
    const uniqueLoras = allLoras.filter(l => {
      if (seen.has(l.path)) return false;
      seen.add(l.path);
      return true;
    });

    if (uniqueLoras.length > 0) {
      loraOpts = {
        customWorkflow: otherChars.length > 0 ? null : (character.custom_workflow || null),
        loras: uniqueLoras,
      };
      console.log(`[moments] Lora: self=${selfLoras.length} others=${otherLoras.length} total=${uniqueLoras.length}`);
    }

    const charArtist = charArtistOverrideWithFallback(character, otherChars);
    // 多图模式串行出图：单张失败只丢那一张，不影响其他张和发帖
    for (let i = 0; i < imagePrompts.length; i++) {
      try {
        const genResult = await generateImageRaw(imagePrompts[i], {
          ragQuery: text,
          artist: charArtist !== null ? charArtist : config.comfyui.momentsArtist,
          width,
          height,
          scene: 'moments',
          priority: manual ? 'high' : 'low',
          ...loraOpts,
        });

        if (!genResult.success || genResult.images.length === 0) continue;

        const usedPrompt = genResult.promptRefined || imagePrompts[i];
        usedPrompts.push(usedPrompt);

        const batchUrls = [];
        for (const img of genResult.images) {
          const ts = Date.now();
          const filename = `moment_${ts}_${i + 1}_${img.filename || 'comfy.png'}`;
          const url = saveBase64Image('moments', filename, img.base64);
          batchUrls.push(url);
          imageUrls.push(url);
        }
        recordCompletedImageTask({
          conversationId: `char_${character.id}_moments`,
          promptOriginal: imagePrompts[i],
          promptRefined: usedPrompt,
          outputPaths: batchUrls,
          style: charArtist !== null ? charArtist : config.comfyui.momentsArtist,
          resolution: `${width}x${height}`,
          workflowTemplate: genResult.wfMode,
          db,
        });
      } catch (err) {
        console.error(`[moments] Image ${i + 1}/${imagePrompts.length} failed for post ${postId}:`, err.message);
      }
    }
  } catch (err) {
    console.error(`[moments] Image generation failed for post ${postId}:`, err.message);
    return { imageUrls: [], usedPrompts: [] };
  }

  return { imageUrls, usedPrompts };
}

/**
 * 镇民朋友圈配图生成（镇民发帖与补图共用）
 * 镇民无 LoRA，走朋友圈画师出图；不抛异常，全失败时返回空 imageUrls
 * @returns {Promise<{ imageUrls: string[], usedPrompts: string[] }>}
 */
async function generateTownNpcMomentImages(npc, imagePrompts, opts = {}) {
  const db = getDb();
  const {
    text = '',
    width = config.comfyui.momentsWidth,
    height = config.comfyui.momentsHeight,
    postId = null,
  } = opts;

  const imageUrls = [];
  const usedPrompts = [];
  try {
    for (let i = 0; i < imagePrompts.length; i++) {
      try {
        const genResult = await generateImageRaw(imagePrompts[i], {
          ragQuery: text,
          artist: config.comfyui.momentsArtist,
          width,
          height,
          scene: 'moments',
          priority: 'high',
        });
        if (!genResult.success || genResult.images.length === 0) continue;

        const usedPrompt = genResult.promptRefined || imagePrompts[i];
        usedPrompts.push(usedPrompt);

        const batchUrls = [];
        for (const img of genResult.images) {
          const filename = `moment_npc_${npc.id}_${Date.now()}_${img.filename || 'comfy.png'}`;
          const url = saveBase64Image('moments', filename, img.base64);
          batchUrls.push(url);
          imageUrls.push(url);
        }
        recordCompletedImageTask({
          conversationId: `town_npc_${npc.id}_moments`,
          promptOriginal: imagePrompts[i],
          promptRefined: usedPrompt,
          outputPaths: batchUrls,
          style: config.comfyui.momentsArtist,
          resolution: `${width}x${height}`,
          workflowTemplate: genResult.wfMode,
          db,
        });
      } catch (err) {
        console.error(`[moments] NPC image ${i + 1}/${imagePrompts.length} failed for post ${postId}:`, err.message);
      }
    }
  } catch (err) {
    console.error(`[moments] NPC image generation failed for post ${postId}:`, err.message);
    return { imageUrls: [], usedPrompts: [] };
  }

  return { imageUrls, usedPrompts };
}

/**
 * 生成一条朋友圈帖子（文案 + 配图）
 * 单次 LLM 调用输出 { text, imagePrompt[, imagePrompt2[, imagePrompt3]] }，确保图文一致
 */
async function generateMomentPost(character, opts = {}) {
  const db = getDb();

  // 0. 并发保护：检查该角色是否已有正在生成中的帖子
  const staleThresholdSeconds = 600; // 10 分钟：超过此时间视为卡住的僵尸帖子
  const existingGenerating = db.prepare(
    `SELECT id, created_at FROM moment_posts WHERE character_id = ? AND status = 'generating' LIMIT 1`
  ).get(character.id);
  if (existingGenerating) {
    // 判断是否已超时（卡住的僵尸帖）
    const ageSeconds = (Date.now() - new Date(existingGenerating.created_at + 'Z').getTime()) / 1000;
    if (ageSeconds > staleThresholdSeconds) {
      // 僵尸帖：标记为 failed，继续本次生成
      console.log(`[moments] ${character.display_name} has a stuck generating post (id=${existingGenerating.id}, ${Math.round(ageSeconds)}s old), marking as failed`);
      db.prepare(`UPDATE moment_posts SET status = 'failed' WHERE id = ?`).run(existingGenerating.id);
    } else {
      // 近期帖：真正的并发调用，拒绝
      console.log(`[moments] ${character.display_name} already has a generating post (id=${existingGenerating.id}, ${Math.round(ageSeconds)}s old), skip`);
      throw new Error('ALREADY_GENERATING');
    }
  }

  // 0.5 悲观锁：立即把 next_moment_at 推到未来，防止调度器/手动 API 并发触发同一角色
  // 成功后再修正为正确的下次时间，失败则设短重试时间
  const lockNextAt = new Date(Date.now() + 3600_000).toISOString(); // 1 小时后（锁）
  db.prepare('UPDATE characters SET next_moment_at = ? WHERE id = ?')
    .run(toSQLite(lockNextAt), character.id);

  // 1. 一维/二维组合选取，代码侧硬随机避免 LLM 偏见

  const SPECIAL_MODES = [
    { name: '做梦/幻想', desc: '分享怪梦或白日梦——内容完全自由，不受现实逻辑约束。可以描述梦境场景、超现实体验、天马行空的脑洞。配图是超现实或梦幻风格' },
  ];

  // 5% 特殊叙事模式 / 10% 完全自由发挥 / 85% Topic 模式
  let pickedSpecialMode = null;
  let pickedTopic = null;
  let combinedStyle = '';
  let isSpecialMode = false;
  let isFreeMode = false;

  const modeRoll = Math.random();
  if (modeRoll < 0.05) {
    pickedSpecialMode = SPECIAL_MODES[Math.floor(Math.random() * SPECIAL_MODES.length)];
    combinedStyle = pickedSpecialMode.name;
    isSpecialMode = true;
  } else if (modeRoll < 0.15) {
    isFreeMode = true;
  } else {
    // 话题库存于 moment_topics 表（用户可在「朋友圈话题库」弹窗中管理），代码侧硬随机避免 LLM 偏见
    const topics = db.prepare(`SELECT name, desc FROM moment_topics WHERE is_active = 1`).all();
    if (topics.length === 0) {
      isFreeMode = true; // 库被清空时兜底自由发挥
    } else {
      pickedTopic = topics[Math.floor(Math.random() * topics.length)];
      combinedStyle = pickedTopic.name;
    }
  }

  // 1.5 发布形态抽取：做梦/幻想 → 叙事长文（讲故事需要空间）；
  //     其余（自由模式与主路径）→ 按时段加权抽取（深夜偏爱纯图党/自言自语，模拟真人深夜状态）
  let pickedForm = null;
  if (isSpecialMode) {
    pickedForm = { name: '叙事长文', desc: '像在讲一个故事或一场梦，可以自由展开', len: '80-200字' };
  } else {
    const _hour = new Date().getHours();
    const _isNight = _hour >= 22 || _hour < 5;
    const formWeights = {};
    for (const f of MOMENT_FORMS) formWeights[f.name] = f.weight * (_isNight && f.nightBoost ? 1.8 : 1.0);
    const picked = weightedPick(MOMENT_FORMS, formWeights);
    pickedForm = { name: picked.name, desc: picked.desc, len: picked.len };
  }

  // 1.6 配图掷骰：70% 一张 / 20% 两张 / 10% 三张，prompt 由下面的 LLM 调用一并给出
  const imageCount = pickMomentImageCount();
  if (imageCount > 1) console.log(`[moments] ${character.display_name} posts ${imageCount} images this time`);

  // 2. 创建 pending 记录
  const postResult = db.prepare(
    `INSERT INTO moment_posts (character_id, content, prompt, style, resolution, status)
     VALUES (?, '', '', ?, ?, 'generating')`
  ).run(
    character.id,
    combinedStyle,
    `${config.comfyui.momentsWidth}x${config.comfyui.momentsHeight}`
  );
  const postId = postResult.lastInsertRowid;

  // 2.5 Sigmoid 模型：根据角色关系网数量决定多人概率
  // P(多人) = P_min + (P_max - P_min) / (1 + e^(-k × (R - R_mid)))
  const MULTI_P_MIN = 0.50;  // 最低多人概率
  const MULTI_P_MAX = 0.80;  // 最高多人概率（社交达人，永远留 20% 单人空间）
  const MULTI_K = 1.0;       // 陡峭度：越大曲线越陡，1.0 时 R≈4~6 为快速拉升区
  const MULTI_R_MID = 5;     // 拐点：R=5 时概率正好 = (P_min+P_max)/2 = 55%

  let multiPersons = [];
  const relCount = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.from_character_id = ? AND cr.relationship_text != ''
  `).get(character.id)?.cnt || 0;

  // R=0 时没有关系网对象，强制单人
  if (relCount > 0) {
    const multiProb = MULTI_P_MIN + (MULTI_P_MAX - MULTI_P_MIN) / (1 + Math.exp(-MULTI_K * (relCount - MULTI_R_MID)));
    console.log(`[moments] ${character.display_name} relCount=${relCount}, multiProb=${(multiProb * 100).toFixed(0)}%`);

    if (Math.random() < multiProb) {
      const allRels = db.prepare(`
        SELECT cr.relationship_text,
               c.id AS other_id, c.display_name AS other_name, c.base_prompt AS other_prompt, c.short_prompt AS other_short
        FROM character_relationships cr
        JOIN characters c ON c.id = cr.to_character_id
        WHERE cr.from_character_id = ? AND cr.relationship_text != ''
      `).all(character.id);

      // 洗牌后依次抽取，最多 3 个额外角色（总上限 4 人含主角色）
      const shuffled = [...allRels].sort(() => Math.random() - 0.5);
      for (const rel of shuffled) {
        if (multiPersons.length >= 3) break;
        const otherPersona = buildCharacterPersona(
          { id: rel.other_id, short_prompt: rel.other_short, base_prompt: rel.other_prompt },
          { variant: 'short', person: rel.other_name }
        );

        multiPersons.push({
          otherId: rel.other_id,
          otherName: rel.other_name,
          otherPersona,
          relDesc: `${rel.other_name}是你的${rel.relationship_text}`,
        });

        // 第一个人已加，后续每人 30% 概率继续
        if (Math.random() > 0.3) break;
      }
      if (multiPersons.length > 0) {
        console.log(`[moments] Multi-person mode: ${character.display_name} + ${multiPersons.map(p => p.otherName).join(', ')} (${multiPersons.length} others)`);
      }
    }
  }

  // 3. LLM 生成文案 + 配图提示词
  const worldSetting = getWorldSetting();
  const permissionPrompt = worldSetting
    ? getSystemRulesWithWorld()
    : getSystemRules();
  const worldIntegrationNote = worldSetting
    ? getWorldIntegrationRule('moments')
    : null;

  const multiPersonImageNote = multiPersons.length > 0 ? `
- **多人画面**：包含你和${multiPersons.map(p => p.otherName).join('、')}，另指定同框的用户也计入人数；每人独立描述，参与同一活动。` : '';

  const postingTaskIntro = worldSetting
    ? '你正在发朋友圈。你的人设生存在<world_setting>中，融入世界观，把世界观当做常识，像刷手机时随手发一条那样发出一条真实的朋友圈动态——不是写作品。'
    : '你正在发朋友圈。请根据你的人设，像刷手机时随手发一条那样发出一条真实的朋友圈动态——不是写作品。';

  const imagePromptRule = getGlobalRule('image_prompt');
  const imagePromptGuide = imagePromptRule?.rule_content || '';

  // 誓约只作为配图中的视觉信息，不影响朋友圈正文。
  const isOath = Boolean(db.prepare(
    'SELECT is_oath FROM user_relationships WHERE character_id = ?'
  ).pluck().get(character.id));
  const oathImageNote = isOath
    ? '\n- **誓约画面特征**：imagePrompt 必须明确描述角色左手无名指戴着一枚清晰可见的银白细戒指；只在画面中体现，text 不提及戒指。'
    : '';

  const now = new Date();
  const weatherNote = getLightNoteWithWeather(now);
  const weatherHint = weatherNote ? `Environment reference：${weatherNote}。` : '';

  // 续集感：取最近一条已完成朋友圈，供"回应/后续"动机写续集，或自然呼应
  let prevMomentText = '';
  try {
    prevMomentText = db.prepare(
      `SELECT content FROM moment_posts WHERE character_id = ? AND status = 'done' AND content != '' ORDER BY created_at DESC LIMIT 1`
    ).get(character.id)?.content || '';
  } catch { /* ignore */ }

  // 5% 概率保留自然的口语停顿，不靠故意错字制造生活感
  const imperfectionNote = Math.random() < 0.05
    ? '\n- 可留一处自然重复或停顿，不故意打错字。'
    : '';

  // 10% 概率弱呼应最近一条朋友圈（自由模式不注入）
  const continuationNote = Math.random() < 0.10 && prevMomentText && !isFreeMode
    ? `\n- 如果这条朋友圈与最近一条“${prevMomentText.slice(0, 60)}...”是同一件事的自然延续，可以顺带呼应；否则忽略它。不要为了呼应而把旧内容单独写成第二段。`
    : '';

  const postingTask = (() => {
    const textShape = isSpecialMode
      ? '中文口语，第一人称，讲完一场梦或幻想'
      : '中文口语，只围绕一个具体中心，留下角色的反应';
    const jsonFmt = buildMomentOutputFormat({ imageCount, textRequirement: textShape });

    const multiImageRule = buildMomentMultiImageRule(imageCount);

    // 缓存约束：通用规则放在按张数变化的 jsonFmt 之前；天气、同行者等放 dynamicRules。
    const staticRules = `通用规则：
- 只输出 JSON，不要解释
${MOMENT_SINGLE_FOCUS_RULE}
${MOMENT_TONE_RULES}
${MOMENT_IMAGE_RULES}
${worldSetting ? '- **世界观驱动**：你的朋友圈发生在<world_setting>中，不是在真空或现实世界中。你分享的日常、你的语气、你描述的场景和互动方式，都应该是这个世界里一个普通人发的朋友圈——这个世界的"日常"就是你的日常，不需要刻意解释。' : ''}
- text 中的事符合当前时间和天气，但不用报时或报天气；只有它直接触发了这次反应才自然提及。`;

    const dynamicRules = `- text用中文（参考 ${pickedForm ? pickedForm.len : '30-80字'}，不凑字数），imagePrompt 用英文
${multiImageRule}
${pickedForm ? `- **发布形态**：${pickedForm.desc}。` : ''}
${isSpecialMode ? '- **梦境例外**：可展开长文；日程与天气只约束现实，不必另叙现实活动。正文分清梦与现实，配图只取梦内同一场景。' : ''}
${imperfectionNote}
${isOath ? '- 已缔结誓约：银白细戒指只能出现在 imagePrompt 的画面描述中，text 禁止提及戒指、誓约及其象征意义。' : ''}
${continuationNote}

生图格式（每个 imagePrompt 均适用）：
${imagePromptGuide || '一段完整的自然英文，描述具体画面，避免标签堆砌。'}
${weatherHint}
${multiPersonImageNote}
${oathImageNote}`;

    return `${postingTaskIntro}

${staticRules}

${jsonFmt}

本次要求（随本次情况变化，与上方通用规则同时生效）：
${dynamicRules}`;
  })();

  const timeTag = getTimeTag(now, false);

  // 日程注入：当前正在做什么；与发圈动因共同合成一条主线
  let scheduleContext = '';
  let scheduleWithUser = false; // 日程提到了用户（如聊天约定改写的日程）→ 本条朋友圈带上用户
  try {
    if (!isFreeMode && config.features.schedule !== false) {
      const activity = getCurrentActivity(character.id);
      if (activity && activity.activity !== '自由时间') {
        scheduleContext = buildMomentScheduleContext(character.display_name, activity);
        const nickname = (config.user.nickname || '').trim();
        const haystack = `${activity.activity || ''}${activity.description || ''}${activity.location || ''}`;
        scheduleWithUser = (nickname.length >= 2 && haystack.includes(nickname)) || haystack.includes('用户');
      }
    }
  } catch { /* schedule not available, skip */ }

  const styleDirective = isFreeMode
    ? ''
    : buildMomentMotiveDirective(
        isSpecialMode
          ? `${pickedSpecialMode.name}：${pickedSpecialMode.desc}`
          : pickedTopic.desc
      );

  const userMsg = multiPersons.length > 0
    ? `${timeTag}${scheduleContext}${styleDirective} ${multiPersons.map(p => p.relDesc).join('，')}——和${multiPersons.map(p => p.otherName).join('、')}在一起。同行者只作为同一场景里的互动对象，不要另写人物介绍或关系感想。发一条朋友圈。`
    : `${timeTag}${scheduleContext}${styleDirective} 发一条朋友圈。`;

  // msgs[0] 舞台 → [世界观] → msgs[1] 任务 → msgs[2] 角色 → msgs[3] 交互(多人) → user
  const msgs = [{ role: 'system', content: permissionPrompt }];
  if (worldIntegrationNote) msgs.push({ role: 'system', content: worldIntegrationNote });
  msgs.push({ role: 'system', content: postingTask });
  // 整卡人格（统一入口，含生效外观注入；输出含 imagePrompt，配图需体现当前外观）
  msgs.push({ role: 'system', content: buildCharacterPersona(character, { variant: 'full' }) });
  // 日程里提到了用户（如聊天约定改写的日程）→ 用户同框：注入用户信息与关系
  if (scheduleWithUser) {
    const relRow = db.prepare(
      'SELECT relationship_text FROM user_relationships WHERE character_id = ?'
    ).get(character.id);
    const userName = userNickname();
    const userDesc = [config.user.gender, config.user.appearance, config.user.persona]
      .filter(Boolean).join('；');
    msgs.push({
      role: 'system',
      content: `**【此刻与你同在的人：${userName}】**
你们的关系：${relRow?.relationship_text || '朋友'}。
${userName}的信息：${userDesc || '信息未知，按普通人处理'}

你现在正和${userName}一起做【此刻正在做】里的事，这条朋友圈必须带上${userName}：
- text 可用昵称、你或我们带出互动；极短形态只在照片体现同行即可。
- imagePrompt 包含你、${userName}及其他指定同行者，人数准确，外观按资料。`,
    });
    console.log(`[moments] Schedule mentions user → user co-presence mode for ${character.display_name}`);
  }
  if (multiPersons.length > 0) {
    for (const mp of multiPersons) {
      msgs.push({
        role: 'system',
        content: `**【你与${mp.otherName}的真实关系】**\n${mp.relDesc}。\n用称呼、距离或小动作自然体现，不擅改关系、不另开话题。\n\n${mp.otherName}的公开信息：\n---\n${mp.otherPersona}\n---`
      });
    }
  }
  const worldRulePrefix = worldSetting
    ? '请遵循<world_setting>来发朋友圈，角色人设如果和<world_setting>有冲突，则以<world_setting>最高优先级，人设会因为<world_setting>改变。\n\n'
    : '';
  msgs.push({ role: 'user', content: worldRulePrefix + userMsg });

  let text = '', imagePrompt = '', imageUrls = [];
  let imagePrompts = [];
  try {
  // 小镇生活上下文（读模型分发时的最新记录，不跨排队缓存）
  // Dream/fantasy and free expression retain their original narrative freedom.
  if (config.features.town === true && !isFreeMode && !isSpecialMode) {
    try {
      const lifeContext = createCharacterTownLifeContext({ db, clock: { now: Date.now },
        registry: createTownActorRegistry(db), timeZone: config.town.timeZone })(character.id);
      if (lifeContext) msgs.splice(msgs.length - 1, 0, { role: 'system', content: `${MOMENT_RECORD_BACKDROP_RULE}\n\n${lifeContext}` });
    } catch (err) { console.warn('[moments] town life records unavailable:', err?.message); }
  }
  // 每多一张配图就多一段画面描述，max_tokens 相应放宽（一张 2048 / 两张 3072 / 三张 4096）
  const maxTokens = 2048 + (imageCount - 1) * 1024;
  const result = await chatSync(msgs, { temperature: 0.8, max_tokens: maxTokens, response_format: { type: 'json_object' }, label: '发朋友圈助手' });

  // 解析 LLM 输出；失败时只回收正文，避免把 JSON 原文写进 content
  const parsed = parseMomentResponse(result);
  text = parsed.text;
  imagePrompts = [parsed.imagePrompt, parsed.imagePrompt2, parsed.imagePrompt3].slice(0, imageCount).filter(Boolean);
  imagePrompt = imagePrompts[0] || '';

  if (!text) {
    text = '今天天气真好～';
  }
  if (!imagePrompt) {
    imagePrompt = DEFAULT_MOMENT_IMAGE_PROMPT;
    imagePrompts = [imagePrompt];
  }

  console.log(`[moments] Generated post for ${character.display_name}: "${text.slice(0, 40)}..."`);

  // 3. 生成配图
  const otherChars = multiPersons
    .map(mp => db.prepare('SELECT loras, artist_override FROM characters WHERE id = ?').get(mp.otherId))
    .filter(Boolean);
  const { imageUrls: genImageUrls, usedPrompts } = await generateMomentImages(character, imagePrompts, {
    text,
    manual: opts.manual,
    otherChars,
    postId,
  });
  // 生图失败不阻塞发帖——无图但有文案
  imageUrls = genImageUrls;
  // 落库用实际生效的 prompt；多图用分隔线拼起来，供图片反查 / 重绘参考
  if (usedPrompts.length > 0) imagePrompt = usedPrompts.join('\n---\n');

  // 4. 更新帖子
  db.prepare(`
    UPDATE moment_posts
    SET content = ?, prompt = ?, images = ?, status = 'done'
    WHERE id = ?
  `).run(text, imagePrompt, JSON.stringify(imageUrls), postId);

  // 5. 设置下次发帖时间（2~8 小时后）
  const nextDelay = 2 * 3600_000 + Math.random() * 6 * 3600_000;
  const nextAt = new Date(Date.now() + nextDelay).toISOString();
  db.prepare('UPDATE characters SET next_moment_at = ? WHERE id = ?')
    .run(toSQLite(nextAt), character.id);

  console.log(`[moments] Post ${postId} done for ${character.display_name}, next at ${nextAt}`);

  // SSE 广播：通知所有连接的前端有新帖
  broadcastNewPost({
    id: postId,
    character_id: character.id,
    content: text,
    images: imageUrls,
    display_name: character.display_name,
    avatar_path: character.avatar_path,
    
    status: 'done',
    created_at: new Date().toISOString(),
  });

  // 异步触发关系网朋友互动（5 秒后启动，不阻塞，完全独立于用户）
  const postRecord = { id: postId, content: text, prompt: imagePrompt, images: imageUrls };
  setTimeout(() => {
    triggerFriendComments(postRecord, character).catch(err =>
      console.error('[moments] friend interaction error:', err.message)
    );
  }, 5000);

  return {
    id: postId,
    character_id: character.id,
    content: text,
    images: imageUrls,
    display_name: character.display_name,
    avatar_path: character.avatar_path,
    
    status: 'done',
    created_at: new Date().toISOString(),
  };

  } catch (err) {
    console.error(`[moments] Failed for ${character.display_name} post ${postId}:`, err.message);
    db.prepare('UPDATE moment_posts SET status = ?, error_message = ? WHERE id = ?')
      .run('failed', err.message, postId);
    const retryAt = new Date(Date.now() + 5 * 60_000).toISOString();
    db.prepare('UPDATE characters SET next_moment_at = ? WHERE id = ?')
      .run(toSQLite(retryAt), character.id);
    throw err;
  }
}

/**
 * 角色自动回复评论 → 已迁移到 services/momentCommentService.js
 * （帖主回评 / @ 点名回复 / 楼中楼回评共用 generateCharacterCommentReply，
 * prompt 结构与原实现保持一致，另带上首图画面描述）
 */

function _parseCharLoras(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return [];
}

/**
 * 特殊日程朋友圈（不走动机库）
 *
 * 被手动编辑 / 聊天约定改写的日程条目（edited 标记）到点后由 scheduleSpecialMoment
 * 队列调用：只突出这个约定日程本身，画面里带上「我」的外观设定。
 * 成功返回后由调用方把条目标记为 sent；抛出异常则回退 pending 等下轮重试。
 */
async function generateSpecialScheduleMoment({ characterId, activity }) {
  const db = getDb();
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!character) throw new Error('character not found');

  // 睡眠条目不产生朋友圈（手动把睡眠块改了时间也会走到这里，静默跳过）
  if (activity.replyDelay === -1) {
    console.log(`[moments] Special schedule moment skipped (sleep block) for ${character.display_name}`);
    return;
  }

  // 并发保护：该角色已有生成中的帖子时放弃本轮（队列会回退 pending 重试）
  const existingGenerating = db.prepare(
    `SELECT id FROM moment_posts WHERE character_id = ? AND status = 'generating' LIMIT 1`
  ).get(character.id);
  if (existingGenerating) throw new Error('ALREADY_GENERATING');

  const userName = userNickname();
  const worldSetting = getWorldSetting();
  const permissionPrompt = worldSetting
    ? getSystemRulesWithWorld()
    : getSystemRules();
  const worldIntegrationNote = worldSetting
    ? getWorldIntegrationRule('moments')
    : null;

  const imagePromptRule = getGlobalRule('image_prompt');
  const imagePromptGuide = imagePromptRule?.rule_content || '';

  const now = new Date();
  const weatherNote = getLightNoteWithWeather(now);
  const weatherHint = weatherNote ? `Environment reference：${weatherNote}。` : '';

  const isOath = Boolean(db.prepare(
    'SELECT is_oath FROM user_relationships WHERE character_id = ?'
  ).pluck().get(character.id));
  const oathImageNote = isOath
    ? '誓约画面特征：imagePrompt 中角色左手无名指戴一枚清晰可见的银白细戒指。'
    : '';

  const userDesc = [config.user.gender, config.user.appearance || config.user.persona]
    .filter(Boolean).join('；');

  const postingTask = `你正在发朋友圈。像刷手机时随手发一条那样发出一条真实的朋友圈动态——不是写作品。

通用规则：
- 只输出 JSON，不要解释
${MOMENT_SINGLE_FOCUS_RULE}
${MOMENT_TONE_RULES}
${MOMENT_IMAGE_RULES}
${worldSetting ? '- **世界观驱动**：你的朋友圈发生在<world_setting>中，不是在真空或现实世界中。' : ''}
- text 中的事符合当前时间，不用特意报时。

${buildMomentOutputFormat({ textRequirement: `中文口语，第一人称，写你和${userName}赴约时的一个细节或互动` })}

本次要求（随本次情况变化，与上方通用规则同时生效）：
- **这条朋友圈是履约现场**：只突出你们约好的这件事本身，不要扯别的话题。
- **画面必须同框**：imagePrompt 中必须同时出现你和${userName}两个人，分别描述各自外观、动作与互动，贴合你们的关系，用句号分隔两人描述。${oathImageNote}

生图格式：
${imagePromptGuide || '一段完整的自然英文，描述具体画面，避免标签堆砌。'}
${weatherHint}`;

  const timeTag = getTimeTag(now, false);
  const doing = `${activity.location || ''}${activity.activity || ''}`;
  const descPart = activity.description ? `（${activity.description}）` : '';
  const userMsg = `${timeTag}
**【此刻正在做】${character.display_name}此刻正在${doing}${descPart}**
**【本次发圈动因】这是你与${userName}约好的事情——就是上面【此刻正在做】的内容，只围绕它发一条朋友圈。**`;

  const msgs = [{ role: 'system', content: permissionPrompt }];
  if (worldIntegrationNote) msgs.push({ role: 'system', content: worldIntegrationNote });
  msgs.push({ role: 'system', content: postingTask });
  msgs.push({ role: 'system', content: buildCharacterPersona(character, { variant: 'full' }) });
  // 约定对象「我」的外观设定：画面必须带上这个人
  msgs.push({
    role: 'system',
    content: `**【与你同行的人：${userName}】**
${userDesc || '信息未知，按普通人处理。'}

imagePrompt 中${userName}的外观以上述描述为准。`,
  });

  const worldRulePrefix = worldSetting
    ? '请遵循<world_setting>来发朋友圈，角色人设如果和<world_setting>有冲突，则以<world_setting>最高优先级。\n\n'
    : '';
  msgs.push({ role: 'user', content: worldRulePrefix + userMsg });

  // 创建 generating 记录（style 标记为日程赴约，与普通帖区分）
  const postResult = db.prepare(
    `INSERT INTO moment_posts (character_id, content, prompt, style, resolution, status)
     VALUES (?, '', '', '日程赴约', ?, 'generating')`
  ).run(character.id, `${config.comfyui.momentsWidth}x${config.comfyui.momentsHeight}`);
  const postId = postResult.lastInsertRowid;

  try {
    const result = await chatSync(msgs, {
      temperature: 0.8,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      label: '日程赴约朋友圈',
    });
    const parsed = parseMomentResponse(result);
    let text = parsed.text || '出门赴约啦～';
    let imagePrompts = [parsed.imagePrompt].filter(Boolean);
    if (imagePrompts.length === 0) {
      imagePrompts = [DEFAULT_MOMENT_IMAGE_PROMPT];
    }

    const { imageUrls, usedPrompts } = await generateMomentImages(character, imagePrompts, {
      text,
      manual: true,
      postId,
    });
    const imagePrompt = usedPrompts.length > 0 ? usedPrompts.join('\n---\n') : imagePrompts[0];

    db.prepare(`
      UPDATE moment_posts
      SET content = ?, prompt = ?, images = ?, status = 'done'
      WHERE id = ?
    `).run(text, imagePrompt, JSON.stringify(imageUrls), postId);

    console.log(`[moments] Special schedule post ${postId} done for ${character.display_name}: "${text.slice(0, 40)}"`);

    broadcastNewPost({
      id: postId,
      character_id: character.id,
      content: text,
      images: imageUrls,
      display_name: character.display_name,
      avatar_path: character.avatar_path,
      status: 'done',
      created_at: new Date().toISOString(),
    });

    const postRecord = { id: postId, content: text, prompt: imagePrompt, images: imageUrls };
    setTimeout(() => {
      triggerFriendComments(postRecord, character).catch(err =>
        console.error('[moments] friend interaction error:', err.message)
      );
    }, 5000);
  } catch (err) {
    console.error(`[moments] Special schedule post failed for ${character.display_name}:`, err.message);
    db.prepare('UPDATE moment_posts SET status = ?, error_message = ? WHERE id = ?')
      .run('failed', err.message, postId);
    throw err;
  }
}

export default router;
export { generateMomentPost };

// 装配：把生成函数注入调度器（解除 momentScheduler → routes 的反向依赖）
import { setMomentPostGenerator, setTownNpcPostGenerator } from '../services/momentScheduler.js';
import { setSpecialScheduleMomentGenerator } from '../services/scheduleSpecialMoment.js';
import { generateTownNpcMoment } from '../services/town/townNpcMomentGenerator.js';
setMomentPostGenerator(generateMomentPost);
setTownNpcPostGenerator(npc => generateTownNpcMoment(npc, { broadcastPost: broadcastNewPost }));
setSpecialScheduleMomentGenerator(generateSpecialScheduleMoment);
