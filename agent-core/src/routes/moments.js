import { Router } from 'express';
import { saveBase64Image } from '../services/imagePaths.js';
import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting, getGlobalRule } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';
import { generateImageRaw } from '../services/imageSkill.js';
import { charArtistOverrideWithFallback } from '../services/characterImageOpts.js';
import { recordCompletedImageTask } from '../services/imageTaskRecorder.js';
import { broadcast as broadcastToUnified } from '../services/unifiedStreamBus.js';
import { loadEmotionState, stateToPrompt, loadAffinity, affinityToPrompt } from '../services/emotionEngine.js';
import { getTimeTag, getLightNoteWithWeather } from '../services/timeLight.js';
import { getCurrentActivity } from '../services/scheduleManager.js';
import { triggerFriendComments } from '../services/momentInteractionService.js';
import { getCoreDialogueRules, getWorldIntegrationRule } from '../builtinRules.js';

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
  const TOPICS = [
    { name: '自拍', desc: '配图是你自己的照片，自拍视角，selfie pose，arm stretched towards viewer，imagePrompt 要包含你的外观' },
    { name: '美食', desc: '分享今天吃到的美食（配图是食物特写）' },
    { name: '风景/天空', desc: '分享今天看到的风景、云、日落或天际线（配图是户外景色）' },
    { name: '穿搭/今日装扮', desc: '分享今天的穿搭或新买的衣服（配图是全身或半身穿搭展示）' },
    { name: '宠物/动物', desc: '晒猫晒狗或偶遇的小动物（配图是动物特写或互动瞬间）' },
    { name: '植物/花草', desc: '养的植物开花了、新叶子展开了、路边好看的花草（配图是植物特写）' },
    { name: '游戏', desc: '晒战绩、吐槽队友、沉迷新游（配图是游戏画面或电竞氛围）' },
    { name: '工作学习桌面', desc: '打工/刷题/赶稿的一天（配图是书桌、电脑屏幕或咖啡杯 mood shot）' },
    { name: '购物/开箱', desc: '新买的东西到了，兴奋开箱分享（配图是物品特写）' },
    { name: '运动/健身', desc: '跑步、撸铁、瑜伽后的感受（配图是运动场景或器材）' },
    { name: '房间一角', desc: '卧室角落、灯光氛围、床上或沙发上的放松时刻（配图是室内 mood shot）' },
    { name: '创作/手工', desc: '自己做的东西——画、手作、烘焙成果、模型涂装（配图是创作过程或成品）' },
    { name: '身体/身材', desc: '健身成果或身材展示（配图是全身或局部特写）' },
    { name: '便利店/超市', desc: '逛便利店的发现——奇怪的零食、打折便当、深夜货架（配图是货架或购物篮视角）' },
    { name: '公共交通', desc: '地铁、公交上的见闻——拥挤的早高峰、空荡的末班车（配图是车厢场景）' },
    { name: '窗外', desc: '从窗户看出去的画面——对面楼的灯火、下雨的窗、秋天的树（配图是窗景）' },
    { name: '聊天截图/meme', desc: '搞笑对话截图或表情包风格(配图可以夸张、meme 风格）' },
    { name: '节日/装饰', desc: '过节、生日、纪念日或某个特殊日子的氛围（配图是庆祝或节日装饰）' },
    { name: '聚会/多人', desc: '和朋友在一起的场景（配图是群体互动或聚会氛围）' },
    { name: '才艺/表演', desc: '展示自己的技能——唱歌、跳舞、弹琴、演出（配图是舞台或练习场景）' },
    { name: '办公/会议', desc: '办公场景、开会、加班日常（配图是工位或会议室 mood shot）' },
    { name: '雨/雪/雷', desc: '极端天气——暴雨、大雪、打雷闪电（配图是天气景象或窗外的雨/雪）' },
        // === 小物件 / 生活细节 ===
    { name: '桌面', desc: '自己的桌面状态——电脑、文具、零食、杂物（配图是桌面俯拍或生活场景）' },
    { name: '包包/随身物', desc: '分享每天带在身边的小东西（配图是包内物品或随身物件展示）' },
    { name: '钥匙/门口', desc: '回家、出门时看到的门口细节（配图是钥匙、门、玄关等生活画面）' },
    { name: '新发现的小物', desc: '发现一个很喜欢的小东西，不一定贵但很有趣（配图是物品特写）' },
    { name: '收藏/小爱好', desc: '展示自己收藏的小东西——徽章、卡片、模型、周边等（配图是收藏展示）' },
    { name: '整理收拾', desc: '整理房间、收纳、清理旧东西后的变化（配图是整理前后或收纳成果）' },
    { name: '洗衣/家务', desc: '普通家务中的小瞬间，晾衣服、整理房间、打扫后的满足感（配图是生活场景）' },
        // === 身体感受 / 状态 ===
    { name: '困倦/睡醒', desc: '刚睡醒、犯困、赖床、午睡后的状态（配图是床铺、窗边或慵懒氛围）' },
    { name: '洗澡/泡澡后', desc: '洗澡、泡澡、护肤后的放松时间（配图是浴室外或舒适生活氛围）' },
    { name: '换季', desc: '换衣服、整理季节用品、感受到季节变化（配图是衣物或环境变化）' },
        // === 兴趣与角色个性 ===
    { name: '收藏展示', desc: '展示自己珍藏的东西——模型、卡片、周边、纪念品（配图是收藏物特写）' },
    { name: '练习过程', desc: '学习某项技能的练习过程，不一定完成，只记录努力中的状态（配图是练习场景）' },
    { name: '灵感瞬间', desc: '突然想到一个点子、创意、想法（配图是笔记、草稿或相关氛围）' },
    { name: '角色习惯', desc: '角色独有的小习惯、小仪式、小动作（配图是体现个性的生活场景）' },
    { name: '最近常用', desc: '最近频繁使用的东西（配图是日常用品展示）' },
    { name: '今日小目标', desc: '完成或尝试完成一个很小的目标（配图是过程或成果）' },
    { name: '自己做饭', desc: '自己下厨做的一顿饭，不论成功还是翻车（配图是料理过程或成品）' },
    { name: '甜品', desc: '蛋糕、冰淇淋、布丁等让人心情变好的甜食（配图是甜品特写）' },

    // === 出门 ===
    { name: '散步', desc: '漫无目的走了一会儿，路上的风景、街道、小发现（配图是街景）' },
    { name: '骑车', desc: '骑自行车或摩托出门，沿途风景或停下来拍的瞬间（配图是骑行场景）' },
    { name: '开车', desc: '路上的风景、堵车、停车后的随手拍（配图是驾驶视角或车窗外）' },

    // === 店铺 ===
    { name: '咖啡店', desc: '在咖啡店待了一会儿（配图是店内环境或桌面）' },
    { name: '商场', desc: '逛商场时随手拍下的一幕（配图是商场空间或橱窗）' },

    // === 兴趣 ===
    { name: '画画', desc: '画了一点东西，不一定完成，（配图是画纸、数位板或过程）' },
    { name: '写字', desc: '练字、写日记、写下一句话，（配图是纸张和笔迹）' },
    { name: '摄影', desc: '最近拍到很满意的一张照片（配图就是作品本身）' },

    // === 数码 ===
    { name: '电脑', desc: '折腾电脑、装机、换壁纸、新设备（配图是电脑桌面或硬件）' },
    { name: '手机', desc: '换手机、换壳、发现新功能，（配图是手机本体或屏幕）' },
    { name: '耳机/音乐', desc: '戴着耳机听歌的一刻，（配图是耳机和环境氛围）' },
    // === 情绪 ===
    { name: '今天很开心', desc: '因为一件小事开心了一整天（配图体现轻松愉快氛围）' },
    { name: '今天有点累', desc: '普通的一天结束后的疲惫，（配图是生活化场景）' },
    { name: '今天运气不错', desc: '遇到一点幸运的小事，（配图是相关场景）' },
    { name: '今天倒霉', desc: '遇到一些哭笑不得的小倒霉，（配图是事件现场）' },

    // === 收藏生活 ===
    { name: '今天买花', desc: '给自己买了一束花，（配图是鲜花）' },
    { name: '香薰/蜡烛', desc: '点了一支香薰蜡烛，让房间变得舒服，（配图是生活氛围）' },
    { name: '文具', desc: '新买的笔、本子等文具，（配图是桌面摆放）' },

    // === 居家 ===
    { name: '冰箱', desc: '打开冰箱时发现有趣的一幕，（配图是冰箱内部）' },
    { name: '厨房', desc: '厨房里的生活片段，（配图是灶台或料理过程）' },
    { name: '床', desc: '窝在床上的休息时间，（配图是床铺和柔软氛围）' },

    { name: '让大家帮忙看看', desc: '希望大家看看自己的成果或选择（配图根据内容决定）' },
    { name: '问大家一个问题', desc: '突然想到一个问题想听听别人意见，（配图辅助表达问题）' },
    { name: '分享最近在做的事', desc: '介绍最近一直在忙什么，（配图是过程）' },
    { name: '最近的新爱好', desc: '最近开始喜欢的新东西，（配图体现兴趣）' },
    { name: '最近的变化', desc: '生活发生了一点变化，（配图体现变化后的状态）' },
    // === 生活秩序 ===
    { name: '补货', desc: '家里的东西用完了，重新补齐，（配图是购物成果）' },
    { name: '重新开始', desc: '重新整理、重新出发，（配图体现新的开始）' },
    { name: '终于修好了', desc: '坏掉的东西终于恢复正常，（配图是修好的物品）' },
    { name: '这一幕像电影', desc: '现实中突然很有电影感的一刻，（配图强调镜头感）' },
    // === 景区 / 游玩 ===
    { name: '景区打卡', desc: '来到一个景点、古镇、地标或名胜，（配图是地标建筑或风景）' },
    { name: '博物馆', desc: '逛博物馆、美术馆、展览馆，（配图是展厅或展品氛围）' },
    { name: '动物园/水族馆', desc: '看到可爱的动物或海洋生物，（配图是动物互动或展馆场景）' },
    { name: '游乐园', desc: '游乐园里开心的一刻，（配图是设施、园区或夜晚灯光）' },
    { name: '展览/艺术展', desc: '参观展览、艺术装置或摄影展，（配图是展品或展厅空间）' },
    { name: '音乐节/活动', desc: '参加现场活动、音乐节、市集等，（配图是现场氛围）' },
    { name: '演唱会', desc: '去看演唱会或Live现场，（配图是舞台、灯光或观众席）' },
    { name: '电影院', desc: '今天去看了一场电影，（配图是电影票、影院或银幕前氛围）' },
    // === 自然 ===
    { name: '爬山', desc: '登山途中或山顶风景，（配图是山路或远景）' },
    { name: '露营', desc: '露营生活、帐篷、篝火，（配图是户外营地）' },
    { name: '野餐', desc: '和朋友或独自野餐，（配图是草地和食物）' },
    { name: '湖边', desc: '湖边散步或发呆，（配图是湖面和倒影）' },
    { name: '森林', desc: '树林、林间小路，（配图是自然景色）' },
    { name: '海边日落', desc: '在海边等待日落，（配图是海岸和夕阳）' },

    // === 店铺体验 ===
    { name: '探店', desc: '发现一家值得分享的小店，（配图是店内环境或特色商品）' },
    { name: '甜品店', desc: '去一家氛围不错的甜品店，（配图是甜品和环境）' },
    { name: '书店下午', desc: '在书店待了一下午，（配图是阅读空间）' },
    { name: '咖啡店办公', desc: '换个地方工作或学习，（配图是电脑和咖啡）' },

    // === 体验 ===
    { name: '体验新事物', desc: '第一次尝试一件以前没做过的事情，（配图体现体验过程）' },
    { name: '课程/体验课', desc: '参加体验课程或兴趣班，（配图是课堂或作品）' },
    { name: 'DIY体验', desc: '亲手制作东西，（配图是制作过程或成品）' },
    { name: '运动体验', desc: '尝试新的运动项目，（配图是运动现场）' },

    // === 节庆 ===
    { name: '烟花', desc: '看到烟花或庆典表演，（配图是夜空中的烟花）' },
    { name: '灯会', desc: '灯会、花灯、夜间装饰，（配图是灯光场景）' },
    { name: '樱花季', desc: '赏花、花海，（配图是花树或花瓣）' },
    { name: '节日装饰', desc: '节日装饰很漂亮，（配图是装饰和灯光）' },

  ];

  const SPECIAL_MODES = [
    { name: '做梦/幻想', desc: '分享昨晚的怪梦或白日梦——内容完全自由，不受现实逻辑约束。可以描述梦境场景、超现实体验、天马行空的脑洞。配图是超现实或梦幻风格' },
  ];

const MOTIVATIONS = [
  // === 记录 ===
  { name: '记录', desc: '觉得这一刻值得留下来。' },
  { name: '纪念', desc: '今天有值得纪念的事情。' },
  { name: '第一次', desc: '第一次经历这样的事，想留作纪念。' },
  { name: '更新近况', desc: '想告诉大家最近发生了什么。' },

  // === 分享 ===
  { name: '分享', desc: '觉得这件事值得和别人分享。' },
  { name: '推荐', desc: '发现了好东西，想推荐给别人。' },
  { name: '开心', desc: '心情很好，想把快乐分享出去。' },
  { name: '惊喜', desc: '发生了意料之外的好事。' },

  // === 表达 ===
  { name: '吐槽', desc: '有点想吐槽，不说出来难受。' },
  { name: '感慨', desc: '看到什么，让自己有了一点感触。' },
  { name: '怀念', desc: '忽然想起了过去的人或事。' },
  { name: '感谢', desc: '想感谢某个人或某件事。' },
  { name: '庆祝', desc: '完成了一件值得高兴的小事。' },

  // === 求助 / 互动 ===
  { name: '求助', desc: '希望有人能给自己一点帮助。' },
  { name: '求建议', desc: '遇到了选择，希望听听大家意见。' },
  { name: '寻找共鸣', desc: '想知道有没有人也和自己一样。' },

  // === 情绪 ===
  { name: '放松', desc: '只是想随手发一点日常。' },
  { name: '治愈', desc: '这一刻让自己的心情轻松了不少。' },
  { name: '疲惫', desc: '今天有点累，想发出来缓一缓。' },
  { name: '惊讶', desc: '看到或遇到了一件意想不到的事情。' },

  // === 后续 ===
  { name: '后续', desc: '之前提过的事情，有了新的进展。' },
  { name: '回应', desc: '回应别人之前关心或提到的话题。' },

  // === 随性 ===
  { name: '突然想发', desc: '没有特别的原因，只是这一刻想记录一下。' },
  { name: '冒个泡', desc: '很久没发了，简单更新一下。' },
];

// 发布形态池：决定"怎么发"，与"发什么"(Topic)和"为什么发"(Motivation)正交。
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

  // 加权映射：部分高辨识度动机提高 roll 到概率
  const MOTIVATION_WEIGHTS = {};

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

  // 5% 特殊叙事模式 / 10% 完全自由发挥 / 85% 二维 Topic × Motivation
  let pickedSpecialMode = null;
  let pickedTopic = null;
  let pickedMotivation = null;
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
    pickedTopic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    pickedMotivation = weightedPick(MOTIVATIONS, MOTIVATION_WEIGHTS);
    combinedStyle = `${pickedTopic.name}|${pickedMotivation.name}`;
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
        const otherShort = rel.other_short || '';
        const base = rel.other_prompt || '';
        const appMatch = base.match(/##\s*你的外观/);
        const appSection = appMatch ? base.slice(appMatch.index).replace(/你/g, rel.other_name) : '';
        const otherPersona = [otherShort, appSection].filter(Boolean).join('\n');

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
    ? '你正在发朋友圈。你的人设生存在上述世界观中，融入世界观，把世界观当做常识，生成一条自然的朋友圈动态。'
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

  // 续集注入：动机是"回应/后续"时强制续集；其他情况 10% 概率弱呼应（自由模式不注入）
  const continuationNote = (pickedMotivation && (pickedMotivation.name === '后续' || pickedMotivation.name === '回应') && prevMomentText)
    ? `\n- 你上次发过：「${prevMomentText.slice(0, 60)}...」。这次发的是这件事的后续/回应，让看到的人能想起上一条，但不要复述太多。`
    : (Math.random() < 0.10 && prevMomentText && !isFreeMode
      ? `\n- 你最近一条朋友圈是：「${prevMomentText.slice(0, 60)}...」。可以自然地呼应它（比如"上次说的事有后续了"），但不要硬蹭。`
      : '');

  const postingTask = (() => {
    const jsonFmt = `输出格式（严格 JSON）：
{"text":"朋友圈文案（自然口语化）","imagePrompt":"${imagePromptGuide}${weatherHint}${multiPersonImageNote}${oathImageNote}"}`;

    const rules = `规则：
- 只输出 JSON，不要解释
${worldSetting ? '- **世界观驱动**：你的朋友圈发生在上述世界观中，不是在真空或现实世界中。你分享的日常、你的语气、你描述的场景和互动方式，都应该是这个世界里一个普通人发的朋友圈——这个世界的"日常"就是你的日常，不需要刻意解释。' : ''}
- text用中文（${pickedForm ? pickedForm.len : '50-200字'}），imagePrompt 用英文
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
        scheduleContext = `\n【日程状态】${character.display_name}此刻正在${activity.location}${activity.activity}。朋友圈的内容应当反映这个时段角色的状态和见闻。`;
      }
    }
  } catch { /* schedule not available, skip */ }

  const styleDirective = isFreeMode
    ? ''
    : isSpecialMode
      ? `\n**本次必须使用「${pickedSpecialMode.name}」风格：${pickedSpecialMode.desc}**`
      // 二维动机表现不佳，暂时去掉二维动机
      // : `\n**本次发朋友圈是正在做或者想到：【${pickedTopic.desc}】，倾向的动机是：【${pickedMotivation.desc}】**`;
      : `\n**本次发朋友圈你是正在做或者想到：【${pickedTopic.desc}】**`;

  const userMsg = multiPersons.length > 0
    ? `${timeTag}${scheduleContext}${styleDirective} ${multiPersons.map(p => p.relDesc).join('，')}——和${multiPersons.map(p => p.otherName).join('、')}在一起，发一条朋友圈。只输出 {"text":"...","imagePrompt":"..."} JSON。`
    : `${timeTag}${scheduleContext}${styleDirective} 发一条朋友圈。只输出 {"text":"...","imagePrompt":"..."} JSON。`;

  // msgs[0] 舞台 → [世界观] → msgs[1] 任务 → msgs[2] 角色 → msgs[3] 交互(多人) → user
  const msgs = [{ role: 'system', content: permissionPrompt }];
  if (worldIntegrationNote) msgs.push({ role: 'system', content: worldIntegrationNote });
  msgs.push({ role: 'system', content: postingTask });
  msgs.push({ role: 'system', content: character.base_prompt });
  if (multiPersons.length > 0) {
    for (const mp of multiPersons) {
      msgs.push({
        role: 'system',
        content: `**【最高优先级——你与${mp.otherName}的真实关系】**\n${mp.relDesc}。\n\n这是你们私下相处的真实状态。你的公开人设是你对外展示的一面，但在${mp.otherName}面前，你们有只属于彼此的相处方式——你们的肢体接触、距离、语气、眼神，都是这个关系里才会有的。不要退回普通朋友的距离，不要用营业微笑面对这个人。\n\n朋友圈记录的是你们独处的真实瞬间，不是给粉丝看的舞台。\n\n${mp.otherName}的公开信息供参考：\n---\n${mp.otherPersona}\n---`
      });
    }
  }
  const worldRulePrefix = worldSetting
    ? '请遵循当前世界观来发朋友圈，角色人设如果和世界观有冲突，则以世界观最高优先级，将人设融入世界观。\n\n'
    : '';
  msgs.push({ role: 'user', content: worldRulePrefix + userMsg });

  let text = '', imagePrompt = '', imageUrls = [];
  try {
  const result = await chatSync(msgs, { temperature: 0.82, max_tokens: 1024, response_format: { type: 'json_object' }, label: '发朋友圈助手' });

  // 解析 LLM 输出
  try {
    const jsonMatch = result.match(/\{[^{}]*"text"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*"imagePrompt"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*\}/s);
    if (jsonMatch) {
      text = jsonMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
      imagePrompt = jsonMatch[2].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }
    if (!text || !imagePrompt) {
      const parsed = JSON.parse(result.trim());
      text = parsed.text || '';
      imagePrompt = parsed.imagePrompt || '';
    }
  } catch {
    // 修复：尝试补全可能被截断的 JSON（如末尾缺少 "}）
    try {
      const repaired = result.trim() + '"}';
      const parsed = JSON.parse(repaired);
      text = parsed.text || '';
      imagePrompt = parsed.imagePrompt || '';
      console.log('[moments] JSON completed with closing "} and parsed successfully');
    } catch {
      // fallback: 用整个回复作为文案，尝试提取 prompt
      text = result.trim().slice(0, 200);
      imagePrompt = 'scenic view, beautiful lighting, detailed';
    }
  }

  if (!text) {
    text = '今天天气真好～';
    imagePrompt = imagePrompt || 'scenic view, beautiful lighting, detailed';
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

  const result = await chatSync(msgs, { temperature: 0.75, max_tokens: 128, label: '回评' });

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
