import { Router } from 'express';
import { saveBase64Image } from '../services/imagePaths.js';
import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting, getGlobalRule } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';
import { generateImageRaw } from '../services/imageSkill.js';
import { charArtistOverrideWithFallback } from '../services/characterImageOpts.js';
import { buildCharacterPersona } from '../services/characterPersona.js';
import { recordCompletedImageTask } from '../services/imageTaskRecorder.js';
import { broadcast as broadcastToUnified } from '../services/unifiedStreamBus.js';
import { loadEmotionState, stateToPrompt, loadAffinity, affinityToPrompt } from '../services/emotionEngine.js';
import { getTimeTag, getLightNoteWithWeather } from '../services/timeLight.js';
import { getCurrentActivity } from '../services/scheduleManager.js';
import { triggerFriendComments } from '../services/momentInteractionService.js';
import { getCoreDialogueRules, getWorldIntegrationRule } from '../builtinRules.js';
import { DEFAULT_MOMENT_IMAGE_PROMPT, parseMomentResponse, sanitizeMomentContent } from '../services/momentResponseParser.js';

const router = Router();

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

  const posts = db.prepare(`
    SELECT mp.*, c.display_name, c.avatar_path,
      (SELECT COUNT(*) FROM moment_comments WHERE post_id = mp.id) AS comment_count,
      (SELECT COUNT(*) FROM moment_likes WHERE post_id = mp.id) AS like_count,
      (SELECT id FROM moment_likes WHERE post_id = mp.id) IS NOT NULL AS liked
    FROM moment_posts mp
    JOIN characters c ON c.id = mp.character_id
    WHERE mp.status = 'done'
    ORDER BY mp.id DESC
  `).all().map(p => ({
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
  const post = db.prepare(`
    SELECT mp.*, c.display_name, c.avatar_path
    FROM moment_posts mp
    JOIN characters c ON c.id = mp.character_id
    WHERE mp.id = ?
  `).get(req.params.id);

  if (!post) return res.status(404).json({ error: 'Post not found' });

  const comments = db.prepare(`
    SELECT mc.*,
      CASE WHEN mc.author_type = 'character' THEN c.display_name ELSE NULL END AS char_display_name,
      CASE WHEN mc.author_type = 'character' THEN c.avatar_path ELSE NULL END AS char_avatar_path,
      CASE WHEN mc.auto_trigger = 1 THEN
        (SELECT CASE WHEN prev.author_type = 'character' THEN pc.display_name ELSE '用户' END
         FROM moment_comments prev
         LEFT JOIN characters pc ON pc.id = prev.author_id
         WHERE prev.post_id = mc.post_id
           AND prev.thread_root_id = mc.thread_root_id
           AND prev.id < mc.id
         ORDER BY prev.id DESC LIMIT 1)
      ELSE NULL END AS reply_to_name
    FROM moment_comments mc
    LEFT JOIN characters c ON c.id = mc.author_id AND mc.author_type = 'character'
    WHERE mc.post_id = ?
    ORDER BY mc.created_at ASC
  `).all(req.params.id);

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

// POST /api/moments/:id/comments — 发评论 + 角色自动回复
router.post('/:id/comments', async (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'content is required' });
  }

  const db = getDb();
  const post = db.prepare(`
    SELECT mp.*, c.display_name, c.base_prompt, c.avatar_path, c.emotion_baseline
    FROM moment_posts mp
    JOIN characters c ON c.id = mp.character_id
    WHERE mp.id = ?
  `).get(req.params.id);

  if (!post) return res.status(404).json({ error: 'Post not found' });

  // 1. 写入用户评论
  const userComment = db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, content) VALUES (?, 'user', ?)`
  ).run(post.id, content.trim());

  const userCommentData = {
    id: userComment.lastInsertRowid,
    post_id: post.id,
    author_type: 'user',
    content: content.trim(),
    created_at: new Date().toISOString(),
  };

  // 2. 加载该帖子的历史评论（含用户评论），构建对话上下文
  const historyComments = db.prepare(`
    SELECT mc.author_type, mc.content,
      CASE WHEN mc.author_type = 'character' THEN c.display_name ELSE ? END AS display_name
    FROM moment_comments mc
    LEFT JOIN characters c ON c.id = mc.author_id AND mc.author_type = 'character'
    WHERE mc.post_id = ?
    ORDER BY mc.created_at ASC
  `).all(userNickname(), post.id);


  // 3. 调用 LLM 生成角色回复
  let replyData = null;
  try {
    const reply = await generateCharacterReply(post, historyComments);
    if (reply) {
      const replyResult = db.prepare(
        `INSERT INTO moment_comments (post_id, author_type, author_id, content) VALUES (?, 'character', ?, ?)`
      ).run(post.id, post.character_id, reply);

      replyData = {
        id: replyResult.lastInsertRowid,
        post_id: post.id,
        author_type: 'character',
        author_id: post.character_id,
        content: reply,
        char_display_name: post.display_name,
        char_avatar_path: post.avatar_path,
        
        created_at: new Date().toISOString(),
      };
    }
  } catch (err) {
    console.error('[moments] auto-reply error:', err.message);
    // 评论已写入，回复失败不阻塞
  }

  res.json({ comment: userCommentData, reply: replyData });
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

// ──────────────── 内部函数 ────────────────

/**
 * 生成一条朋友圈帖子（文案 + 配图）
 * 单次 LLM 调用输出 { text, imagePrompt }，确保图文一致
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
    { name: '做梦/幻想', desc: '分享昨晚的怪梦或白日梦——内容完全自由，不受现实逻辑约束。可以描述梦境场景、超现实体验、天马行空的脑洞。配图是超现实或梦幻风格' },
  ];

// 发布形态池：决定"怎么发"，与"发什么"(Topic)正交。
// weight 基础权重；nightBoost=true 的形态在深夜(22-5点)权重 ×1.8，让发圈时刻更有状态感。
const MOMENT_FORMS = [
  { name: '短句流', desc: '一句话说清楚，极简不解释', len: '5-20字', weight: 0.8, nightBoost: false },
  { name: '碎碎念', desc: '两三行短句，想到哪说到哪，像随手记', len: '20-60字', weight: 1.2, nightBoost: false },
  { name: '纯图党', desc: '文字只用 0-3 个 emoji 加上极短一句，主要靠图说话', len: '0-10字', weight: 0.6, nightBoost: true },
  { name: '括号吐槽', desc: '正文加一句括号里的内心OS或吐槽', len: '30-80字', weight: 1.0, nightBoost: false },
  { name: '认真长文', desc: '认真记录一件事，可以展开细节（带格式）', len: '80-200字', weight: 0.8, nightBoost: false },
  { name: '自言自语', desc: '像没写完的心里话，带点欲言又止', len: '10-40字', weight: 1.0, nightBoost: true },
  { name: '冷幽默', desc: '一句或几句自嘲冷幽默，结尾抖个小包袱', len: '15-50字', weight: 0.7, nightBoost: false },
  { name: '清单体', desc: '用列表逐条列出来，像在写一张清单，条目感强', len: '30-100字', weight: 0.7, nightBoost: false },
  { name: '发疯文学', desc: '语气夸张、情绪上头的无厘头输出，标点和语气词拉满', len: '20-80字', weight: 0.6, nightBoost: false },
];

  function weightedPick(arr, weightMap = {}) {
    const items = arr.map(item => ({
      item,
      weight: weightMap[item.name] || 1.0,
    }));
    const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const { item, weight } of items) {
      rand -= weight;
      if (rand <= 0) return item;
    }
    return items[items.length - 1].item;
  }

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

  // 1.5 发布形态抽取：做梦/幻想 → 叙事长文（讲故事需要空间）；自由模式 → 不设形态；
  //     主路径 → 按时段加权抽取（深夜偏爱纯图党/自言自语，模拟真人深夜状态）
  let pickedForm = null;
  if (isSpecialMode) {
    pickedForm = { name: '叙事长文', desc: '像在讲一个故事或一场梦，可以自由展开', len: '80-200字' };
  } else if (!isFreeMode) {
    const _hour = new Date().getHours();
    const _isNight = _hour >= 22 || _hour < 5;
    const formWeights = {};
    for (const f of MOMENT_FORMS) formWeights[f.name] = f.weight * (_isNight && f.nightBoost ? 1.8 : 1.0);
    const picked = weightedPick(MOMENT_FORMS, formWeights);
    pickedForm = { name: picked.name, desc: picked.desc, len: picked.len };
  }

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
- **多人画面**：imagePrompt 中必须包含你和${multiPersons.map(p => p.otherName).join('、')}共${multiPersons.length + 1}人。描述各自外观、互动方式、肢体距离和表情，贴合你们的关系。用句号分隔每人描述` : '';

  const postingTaskIntro = worldSetting
    ? '你正在发朋友圈。你的人设生存在<world_setting>中，融入世界观，把世界观当做常识，生成一条自然的朋友圈动态。'
    : '你正在发朋友圈。请根据你的人设，生成一条自然的朋友圈动态。';

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

  // 不完美注入：5% 概率允许 1 处轻微口语瑕疵，打破"标准小作文"感
  const imperfectionNote = Math.random() < 0.05
    ? '\n- 这条朋友圈可以有 1 处轻微的口语瑕疵：比如打错一个字不修、句尾多个语气词、写了一半改用别的说法。最多 1 处，不要刻意。'
    : '';

  // 10% 概率弱呼应最近一条朋友圈（自由模式不注入）
  const continuationNote = Math.random() < 0.10 && prevMomentText && !isFreeMode
    ? `\n- 你最近一条朋友圈是：「${prevMomentText.slice(0, 60)}...」。可以自然地呼应它（比如"上次说的事有后续了"），但不要硬蹭。`
    : '';

  const postingTask = (() => {
    const jsonFmt = `输出格式（严格 JSON）：
{"text":"朋友圈文案（自然口语化）","imagePrompt":"${imagePromptGuide}${weatherHint}${multiPersonImageNote}${oathImageNote}"}`;

    const rules = `规则：
- 只输出 JSON，不要解释
${worldSetting ? '- **世界观驱动**：你的朋友圈发生在<world_setting>中，不是在真空或现实世界中。你分享的日常、你的语气、你描述的场景和互动方式，都应该是这个世界里一个普通人发的朋友圈——这个世界的"日常"就是你的日常，不需要刻意解释。' : ''}
- text用中文（${pickedForm ? pickedForm.len : '50-200字'}），imagePrompt 用英文
- **图文强一致**：imagePrompt 必须准确可视化 text 正在记录或表达的同一场景，以正文中的主体、人物、动作、地点、物品和情绪为准；可以补充正文未明说但由上下文确定的天气、光线、构图和环境细节，不得改换场景、添加与正文冲突的情节，或生成与正文无关的泛化画面。
${pickedForm ? `- **发布形态**：${pickedForm.desc}。text严格按这个形态写，不要写成标准小作文。` : ''}
${imperfectionNote}
- text里禁止输出'#下午茶的仪式感'类似这种tag标签
${isOath ? '- 已缔结誓约：银白细戒指只能出现在 imagePrompt 的画面描述中，text 禁止提及戒指、誓约及其象征意义。' : ''}
- text中做的事情要符合当前时间和天气但禁止直接提及时间和天气。imagePrompt一定会体现天气。除非极度需要说明时间和天气text才会提及。
${continuationNote}`;

    return `${postingTaskIntro}

${jsonFmt}

${rules}`;
  })();

  const timeTag = getTimeTag(now, false);

  // 日程注入：告知 LLM 角色此刻在做什么，朋友圈内容应反映此时段状态
  let scheduleContext = '';
  try {
    if (!isFreeMode && config.features.schedule !== false) {
      const activity = getCurrentActivity(character.id);
      if (activity && activity.activity !== '自由时间') {
        const descPart = activity.description ? `（${activity.description}）` : '';
        scheduleContext = `\n【日程状态】${character.display_name}此刻正在${activity.location}${activity.activity}${descPart}。朋友圈的内容应当反映这个时段角色的状态和见闻。`;
      }
    }
  } catch { /* schedule not available, skip */ }

  const styleDirective = isFreeMode
    ? ''
    : isSpecialMode
      ? `\n**本次必须使用「${pickedSpecialMode.name}」风格：${pickedSpecialMode.desc}**`
      : `\n**本次发朋友圈你是正在做或者想到：【${pickedTopic.desc}】**`;

  const userMsg = multiPersons.length > 0
    ? `${timeTag}${scheduleContext}${styleDirective} ${multiPersons.map(p => p.relDesc).join('，')}——和${multiPersons.map(p => p.otherName).join('、')}在一起，发一条朋友圈。只输出 {"text":"...","imagePrompt":"..."} JSON。`
    : `${timeTag}${scheduleContext}${styleDirective} 发一条朋友圈。只输出 {"text":"...","imagePrompt":"..."} JSON。`;

  // msgs[0] 舞台 → [世界观] → msgs[1] 任务 → msgs[2] 角色 → msgs[3] 交互(多人) → user
  const msgs = [{ role: 'system', content: permissionPrompt }];
  if (worldIntegrationNote) msgs.push({ role: 'system', content: worldIntegrationNote });
  msgs.push({ role: 'system', content: postingTask });
  // 整卡人格（统一入口，含生效外观注入；输出含 imagePrompt，配图需体现当前外观）
  msgs.push({ role: 'system', content: buildCharacterPersona(character, { variant: 'full' }) });
  if (multiPersons.length > 0) {
    for (const mp of multiPersons) {
      msgs.push({
        role: 'system',
        content: `**【最高优先级——你与${mp.otherName}的真实关系】**\n${mp.relDesc}。\n\n这是你们私下相处的真实状态。你的公开人设是你对外展示的一面，但在${mp.otherName}面前，你们有只属于彼此的相处方式——你们的肢体接触、距离、语气、眼神，都是这个关系里才会有的。不要退回普通朋友的距离，不要用营业微笑面对这个人。\n\n朋友圈记录的是你们独处的真实瞬间，不是给粉丝看的舞台。\n\n${mp.otherName}的公开信息供参考：\n---\n${mp.otherPersona}\n---`
      });
    }
  }
  const worldRulePrefix = worldSetting
    ? '请遵循<world_setting>来发朋友圈，角色人设如果和<world_setting>有冲突，则以<world_setting>最高优先级，人设会因为<world_setting>改变。\n\n'
    : '';
  msgs.push({ role: 'user', content: worldRulePrefix + userMsg });

  let text = '', imagePrompt = '', imageUrls = [];
  try {
  const result = await chatSync(msgs, { temperature: 0.7, max_tokens: 2048, response_format: { type: 'json_object' }, label: '发朋友圈助手' });

  // 解析 LLM 输出；失败时只回收正文，避免把 JSON 原文写进 content
  const parsed = parseMomentResponse(result);
  text = parsed.text;
  imagePrompt = parsed.imagePrompt;

  if (!text) {
    text = '今天天气真好～';
  }
  if (!imagePrompt) {
    imagePrompt = DEFAULT_MOMENT_IMAGE_PROMPT;
  }

  console.log(`[moments] Generated post for ${character.display_name}: "${text.slice(0, 40)}..."`);

  // 3. 生成配图
  try {
    // 构建 lora 参数：合并自身 + 对方们的 lora
    let loraOpts = {};
    const selfLoras = _parseCharLoras(character.loras);
    const otherChars = multiPersons.map(mp => db.prepare('SELECT loras, artist_override FROM characters WHERE id = ?').get(mp.otherId)).filter(Boolean);
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
        customWorkflow: multiPersons.length > 0 ? null : (character.custom_workflow || null),
        loras: uniqueLoras,
      };
      console.log(`[moments] Lora: self=${selfLoras.length} others=${otherLoras.length} total=${uniqueLoras.length}`);
    }

    const originalImagePrompt = imagePrompt;
    const charArtist = charArtistOverrideWithFallback(character, otherChars);
    const genResult = await generateImageRaw(imagePrompt, {
      ragQuery: text,
      artist: charArtist !== null ? charArtist : config.comfyui.momentsArtist,
      width: config.comfyui.momentsWidth,
      height: config.comfyui.momentsHeight,
      scene: 'moments',
      priority: opts.manual ? 'high' : 'low',
      ...loraOpts,
    });

    if (genResult.success && genResult.images.length > 0) {
      imagePrompt = genResult.promptRefined || imagePrompt;
      for (const img of genResult.images) {
        const ts = Date.now();
        const filename = `moment_${ts}_${img.filename || 'comfy.png'}`;
        const url = saveBase64Image('moments', filename, img.base64);
        imageUrls.push(url);
      }
      recordCompletedImageTask({
        conversationId: `char_${character.id}_moments`,
        promptOriginal: originalImagePrompt,
        promptRefined: imagePrompt,
        outputPaths: imageUrls,
        style: charArtist !== null ? charArtist : config.comfyui.momentsArtist,
        resolution: `${config.comfyui.momentsWidth}x${config.comfyui.momentsHeight}`,
        workflowTemplate: genResult.wfMode,
        db,
      });
    }
  } catch (err) {
    console.error(`[moments] Image generation failed for post ${postId}:`, err.message);
    // 生图失败不阻塞发帖——无图但有文案
    imageUrls = [];
  }

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
  const postRecord = { id: postId, content: text, images: imageUrls };
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
 * 角色自动回复评论
 */
async function generateCharacterReply(post, historyComments) {
  const db = getDb();

  // 睡眠检查：角色在睡觉时不自动回复评论
  try {
    if (config.features.schedule !== false) {
      const { isSleeping } = await import('../services/scheduleManager.js');
      const sleepStatus = isSleeping(post.character_id);
      if (sleepStatus.sleeping) {
        console.log(`[moments] ${post.display_name} is sleeping, skipping comment reply`);
        return null;
      }
    }
  } catch { /* schedule not available */ }

  const userName = config.user.nickname || '用户';
  const u = config.user;
  let userPersona = u.appearance || u.persona || '你最重要的朋友';
  if (u.gender) userPersona = `[性别：${u.gender}] ${userPersona}`;

  // 构建评论区对话历史
  const commentHistory = historyComments.map(c => {
    const name = c.author_type === 'character' ? (c.display_name || post.display_name) : userName;
    return `${name}：${c.content}`;
  }).join('\n');

  // 用户→角色关系
  let userRelMsg = '';
  const userRel = db.prepare(
    'SELECT relationship_text, is_oath FROM user_relationships WHERE character_id = ?'
  ).get(post.character_id);
  if (userRel && userRel.relationship_text) {
    userRelMsg = `**【你与user的关系】\n你对于user而言的身份是${userRel.relationship_text}。**这个关系为最高优先级，请在回复中自然体现。`;
  }
  if (userRel?.is_oath) {
    userRelMsg += `\n\n**【特殊羁绊】**\n你和user之间有一个比普通关系更深一层的约定——user曾经郑重地送过你一枚戒指。这代表了独一无二的羁绊和承诺。在回复时，你的行为和情感会自然地带有"你是我最重要的人"的底色。`;
  }

  // 角色间关系（双向）
  let charRelMsg = '';
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
  `).all(post.character_id, post.character_id);

  if (charRels.length > 0) {
    const relLines = charRels.map(r => {
      if (r.direction === 'from') {
        return `- ${r.display_name}是你的${r.relationship_text}`;
      } else {
        return `- ${r.display_name}认为你是她的${r.relationship_text}`;
      }
    }).join('\n');
    charRelMsg = `**【你与其他角色的关系】**\n${relLines}\n\n请在回复中自然体现这些关系，不必刻意说明。你的人设可能会有其他的性格，但是在私下里，你的关系网就是这样的，在回复里不用完全保持公开人设，以私下关系为最高优先级。`;
  }

  // 权限层
  const worldSettingReply = getWorldSetting();
  const permissionPrompt = worldSettingReply
    ? getSystemRulesWithWorld()
    : getSystemRules();
  const worldIntegrationNoteReply = worldSettingReply
    ? getWorldIntegrationRule('momentReply')
    : null;

  // 加载情绪状态 + 好感度（提前，用于 msgs[1] 和 msgs[2]）
  let emotionPrompt = '';
  let affPrompt = '';
  if (config.features.emotion) {
    const convId = `char_${post.character_id}`;
    const emotionBaseline = post.emotion_baseline
      ? JSON.parse(post.emotion_baseline)
      : { valence: 0.5, arousal: 0.5, dominance: 0.5 };
    const emotionState = loadEmotionState(convId, emotionBaseline);
    emotionPrompt = stateToPrompt(emotionState) || '';

    const affinity = loadAffinity(post.character_id);
    affPrompt = affinityToPrompt(affinity) || '';
  }

  // 朋友圈上下文 + 回复规则（user 特征和评论区交互放到最后的 user 消息中）
  const momentRules = getCoreDialogueRules({ userName, identityAnchor: false });
  const contextTask = `你在朋友圈发了：
---
${post.content}
---

请以角色的身份自然回复评论区的最新评论。规则：
- 15~50 字，自然口语化，像熟人聊天一样随意
- **不要反复叫对方名字**——熟人之间连续对话不需要每句都称呼，只在特别强调时用
- 可以参考评论区的上下文，但不要重复自己已经说过的话
${momentRules}`;

  // msgs[0] 舞台 → [世界观] → msgs[1] 角色+情绪 → msgs[2] 交互上下文 → msgs[3] 任务 → user
  const msgs = [{ role: 'system', content: permissionPrompt }];
  if (worldIntegrationNoteReply) msgs.push({ role: 'system', content: worldIntegrationNoteReply });

  // msgs[1] — 角色：人格 + 情绪
  const charContent = [post.base_prompt, emotionPrompt].filter(Boolean).join('\n\n');
  msgs.push({ role: 'system', content: charContent });

  // msgs[2] — 交互：用户关系 + 角色间关系 + 好感度
  const relContext = [userRelMsg, charRelMsg, affPrompt].filter(Boolean).join('\n\n');
  if (relContext) msgs.push({ role: 'system', content: relContext });

  // msgs[3] — 任务：朋友圈内容 + 规则
  msgs.push({ role: 'system', content: contextTask });

  // user 消息 — user 特征 + 评论区交互（独立于系统人设，避免人称混淆，不含光线时间）
  const userMsg = `关于${userName}：
${userPersona}

评论区目前的对话：
---
${commentHistory}
---

回复这条评论：`;
  msgs.push({ role: 'user', content: userMsg });

  const result = await chatSync(msgs, { temperature: 0.7, max_tokens: 128, label: '回评' });

  return result.trim().replace(/^["']|["']$/g, '').slice(0, 200);
}

function _parseCharLoras(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return [];
}

export default router;
export { generateMomentPost };

// 装配：把生成函数注入调度器（解除 momentScheduler → routes 的反向依赖）
import { setMomentPostGenerator } from '../services/momentScheduler.js';
setMomentPostGenerator(generateMomentPost);
