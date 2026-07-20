import { Router } from 'express';
import { saveBase64Image } from '../services/imagePaths.js';
import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting, getGlobalRule } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';
import { generateImageRaw } from '../services/imageSkill.js';
import { broadcast as broadcastToUnified } from '../services/unifiedStreamBus.js';
import { loadEmotionState, stateToPrompt, loadAffinity, affinityToPrompt } from '../services/emotionEngine.js';
import { getTimeLightTag, getTimeLight } from '../services/timeLight.js';
import { getCurrentActivity } from '../services/scheduleManager.js';
import { triggerFriendComments } from '../services/momentInteractionService.js';
import { getCoreDialogueRules } from '../builtinRules.js';

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
    { name: '美食', desc: '分享今天吃到的美食，配图是食物特写' },
    { name: '风景/天空', desc: '分享今天看到的风景、云、日落或天际线，配图是户外景色' },
    { name: '穿搭/今日装扮', desc: '分享今天的穿搭或新买的衣服，配图是全身或半身穿搭展示' },
    { name: '宠物/动物', desc: '晒猫晒狗或偶遇的小动物，配图是动物特写或互动瞬间' },
    { name: '植物/花草', desc: '养的植物开花了、新叶子展开了、路边好看的花草，配图是植物特写' },
    { name: '游戏', desc: '晒战绩、吐槽队友、沉迷新游，配图是游戏画面或电竞氛围' },
    { name: '工作学习桌面', desc: '打工/刷题/赶稿的一天，配图是书桌、电脑屏幕或咖啡杯 mood shot' },
    { name: '购物/开箱', desc: '新买的东西到了，兴奋开箱分享，配图是物品特写' },
    { name: '运动/健身', desc: '跑步、撸铁、瑜伽后的感受，配图是运动场景或器材' },
    { name: '房间一角', desc: '卧室角落、灯光氛围、床上或沙发上的放松时刻，配图是室内 mood shot' },
    { name: '创作/手工', desc: '自己做的东西——画、手作、烘焙成果、模型涂装，配图是创作过程或成品' },
    { name: '身体/身材', desc: '健身成果或身材展示，配图是全身或局部特写' },
    { name: '便利店/超市', desc: '逛便利店的发现——奇怪的零食、打折便当、深夜货架，配图是货架或购物篮视角' },
    { name: '公共交通', desc: '地铁、公交上的见闻——拥挤的早高峰、空荡的末班车，配图是车厢场景' },
    { name: '窗外', desc: '从窗户看出去的画面——对面楼的灯火、下雨的窗、秋天的树，配图是窗景' },
    { name: '聊天截图/meme', desc: '搞笑对话截图或表情包风格，配图可以夸张、meme 风格' },
    { name: '节日/装饰', desc: '过节、生日、纪念日或某个特殊日子的氛围，配图是庆祝或节日装饰' },
    { name: '聚会/多人', desc: '和朋友在一起的场景，配图是群体互动或聚会氛围' },
    { name: '做梦/脑洞', desc: '分享昨晚的怪梦或天马行空的脑洞故事，配图是超现实或梦幻风格' },
    { name: '才艺/表演', desc: '展示自己的技能——唱歌、跳舞、弹琴、演出，配图是舞台或练习场景' },
    { name: '办公/会议', desc: '办公场景、开会、加班日常，配图是工位或会议室 mood shot' },
    { name: '雨/雪/雷', desc: '极端天气——暴雨、大雪、打雷闪电，配图是天气景象或窗外的雨/雪' },
        // === 小物件 / 生活细节 ===
    { name: '桌面', desc: '自己的桌面状态——电脑、文具、零食、杂物，配图是桌面俯拍或生活场景' },
    { name: '包包/随身物', desc: '分享每天带在身边的小东西，配图是包内物品或随身物件展示' },
    { name: '钥匙/门口', desc: '回家、出门时看到的门口细节，配图是钥匙、门、玄关等生活画面' },
    { name: '新发现的小物', desc: '发现一个很喜欢的小东西，不一定贵但很有趣，配图是物品特写' },
    { name: '收藏/小爱好', desc: '展示自己收藏的小东西——徽章、卡片、模型、周边等，配图是收藏展示' },
    { name: '整理收拾', desc: '整理房间、收纳、清理旧东西后的变化，配图是整理前后或收纳成果' },
    { name: '洗衣/家务', desc: '普通家务中的小瞬间，晾衣服、整理房间、打扫后的满足感，配图是生活场景' },
        // === 身体感受 / 状态 ===
    { name: '困倦/睡醒', desc: '刚睡醒、犯困、赖床、午睡后的状态，配图是床铺、窗边或慵懒氛围' },
    { name: '早晨', desc: '一天开始时的小记录，早餐、阳光、准备出门，配图是清晨氛围' },
    { name: '深夜', desc: '深夜独处时的状态，夜灯、房间、窗外景色，配图是安静夜晚氛围' },
    { name: '洗澡/泡澡后', desc: '洗澡、泡澡、护肤后的放松时间，配图是浴室外或舒适生活氛围' },
    { name: '换季', desc: '换衣服、整理季节用品、感受到季节变化，配图是衣物或环境变化' },
        // === 兴趣与角色个性 ===
    { name: '收藏展示', desc: '展示自己珍藏的东西——模型、卡片、周边、纪念品，配图是收藏物特写' },
    { name: '练习过程', desc: '学习某项技能的练习过程，不一定完成，只记录努力中的状态，配图是练习场景' },
    { name: '灵感瞬间', desc: '突然想到一个点子、创意、想法，配图是笔记、草稿或相关氛围' },
    { name: '角色习惯', desc: '角色独有的小习惯、小仪式、小动作，配图是体现个性的生活场景' },
    { name: '最近常用', desc: '最近频繁使用的东西，配图是日常用品展示' },
    { name: '今日小目标', desc: '完成或尝试完成一个很小的目标，配图是过程或成果' },
    { name: '自己做饭', desc: '自己下厨做的一顿饭，不论成功还是翻车，配图是料理过程或成品' },
    { name: '甜品', desc: '蛋糕、冰淇淋、布丁等让人心情变好的甜食，配图是甜品特写' },
    { name: '夜宵', desc: '深夜突然想吃点东西，配图是夜宵和夜晚氛围' },

    // === 出门 ===
    { name: '散步', desc: '漫无目的走了一会儿，路上的风景、街道、小发现，配图是街景' },
    { name: '骑车', desc: '骑自行车或摩托出门，沿途风景或停下来拍的瞬间，配图是骑行场景' },
    { name: '开车', desc: '路上的风景、堵车、停车后的随手拍，配图是驾驶视角或车窗外' },

    // === 店铺 ===
    { name: '咖啡店', desc: '在咖啡店待了一会儿，配图是店内环境或桌面' },
    { name: '商场', desc: '逛商场时随手拍下的一幕，配图是商场空间或橱窗' },

    // === 兴趣 ===
    { name: '画画', desc: '画了一点东西，不一定完成，配图是画纸、数位板或过程' },
    { name: '写字', desc: '练字、写日记、写下一句话，配图是纸张和笔迹' },
    { name: '摄影', desc: '最近拍到很满意的一张照片，配图就是作品本身' },

    // === 数码 ===
    { name: '电脑', desc: '折腾电脑、装机、换壁纸、新设备，配图是电脑桌面或硬件' },
    { name: '手机', desc: '换手机、换壳、发现新功能，配图是手机本体或屏幕' },
    { name: '耳机/音乐', desc: '戴着耳机听歌的一刻，配图是耳机和环境氛围' },
    // === 情绪 ===
    { name: '今天很开心', desc: '因为一件小事开心了一整天，配图体现轻松愉快氛围' },
    { name: '今天有点累', desc: '普通的一天结束后的疲惫，配图是生活化场景' },
    { name: '今天运气不错', desc: '遇到一点幸运的小事，配图是相关场景' },
    { name: '今天倒霉', desc: '遇到一些哭笑不得的小倒霉，配图是事件现场' },

    // === 收藏生活 ===
    { name: '今天买花', desc: '给自己买了一束花，配图是鲜花' },
    { name: '香薰/蜡烛', desc: '点了一支香薰蜡烛，让房间变得舒服，配图是生活氛围' },
    { name: '文具', desc: '新买的笔、本子等文具，配图是桌面摆放' },

    // === 居家 ===
    { name: '冰箱', desc: '打开冰箱时发现有趣的一幕，配图是冰箱内部' },
    { name: '厨房', desc: '厨房里的生活片段，配图是灶台或料理过程' },
    { name: '床', desc: '窝在床上的休息时间，配图是床铺和柔软氛围' },

    { name: '让大家帮忙看看', desc: '希望大家看看自己的成果或选择，配图根据内容决定' },
    { name: '问大家一个问题', desc: '突然想到一个问题想听听别人意见，配图辅助表达问题' },
    { name: '分享最近在做的事', desc: '介绍最近一直在忙什么，配图是过程' },
    { name: '最近的新爱好', desc: '最近开始喜欢的新东西，配图体现兴趣' },
    { name: '最近的变化', desc: '生活发生了一点变化，配图体现变化后的状态' },

    // === 生活秩序 ===
    { name: '补货', desc: '家里的东西用完了，重新补齐，配图是购物成果' },
    { name: '重新开始', desc: '重新整理、重新出发，配图体现新的开始' },
    { name: '终于修好了', desc: '坏掉的东西终于恢复正常，配图是修好的物品' },
    { name: '这一幕像电影', desc: '现实中突然很有电影感的一刻，配图强调镜头感' },
    // === 景区 / 游玩 ===
    { name: '景区打卡', desc: '来到一个景点、古镇、地标或名胜，配图是地标建筑或风景' },
    { name: '博物馆', desc: '逛博物馆、美术馆、展览馆，配图是展厅或展品氛围' },
    { name: '动物园/水族馆', desc: '看到可爱的动物或海洋生物，配图是动物互动或展馆场景' },
    { name: '游乐园', desc: '游乐园里开心的一刻，配图是设施、园区或夜晚灯光' },
    { name: '展览/艺术展', desc: '参观展览、艺术装置或摄影展，配图是展品或展厅空间' },
    { name: '音乐节/活动', desc: '参加现场活动、音乐节、市集等，配图是现场氛围' },
    { name: '演唱会', desc: '去看演唱会或Live现场，配图是舞台、灯光或观众席' },
    { name: '电影院', desc: '今天去看了一场电影，配图是电影票、影院或银幕前氛围' },

    // === 自然 ===
    { name: '爬山', desc: '登山途中或山顶风景，配图是山路或远景' },
    { name: '露营', desc: '露营生活、帐篷、篝火，配图是户外营地' },
    { name: '野餐', desc: '和朋友或独自野餐，配图是草地和食物' },
    { name: '湖边', desc: '湖边散步或发呆，配图是湖面和倒影' },
    { name: '森林', desc: '树林、林间小路，配图是自然景色' },
    { name: '海边日落', desc: '在海边等待日落，配图是海岸和夕阳' },

    // === 店铺体验 ===
    { name: '探店', desc: '发现一家值得分享的小店，配图是店内环境或特色商品' },
    { name: '甜品店', desc: '去一家氛围不错的甜品店，配图是甜品和环境' },
    { name: '书店下午', desc: '在书店待了一下午，配图是阅读空间' },
    { name: '咖啡店办公', desc: '换个地方工作或学习，配图是电脑和咖啡' },

    // === 体验 ===
    { name: '体验新事物', desc: '第一次尝试一件以前没做过的事情，配图体现体验过程' },
    { name: '课程/体验课', desc: '参加体验课程或兴趣班，配图是课堂或作品' },
    { name: 'DIY体验', desc: '亲手制作东西，配图是制作过程或成品' },
    { name: '运动体验', desc: '尝试新的运动项目，配图是运动现场' },

    // === 节庆 ===
    { name: '烟花', desc: '看到烟花或庆典表演，配图是夜空中的烟花' },
    { name: '灯会', desc: '灯会、花灯、夜间装饰，配图是灯光场景' },
    { name: '樱花季', desc: '赏花、花海，配图是花树或花瓣' },
    { name: '圣诞装饰', desc: '节日装饰很漂亮，配图是装饰和灯光' },

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

  // ~5% 特殊叙事模式 / ~95% 二维 Topic × Motivation
  let pickedSpecialMode = null;
  let pickedTopic = null;
  let pickedMotivation = null;
  let combinedStyle = '';
  let isSpecialMode = false;

  if (Math.random() < 0.04) {
    pickedSpecialMode = SPECIAL_MODES[Math.floor(Math.random() * SPECIAL_MODES.length)];
    combinedStyle = pickedSpecialMode.name;
    isSpecialMode = true;
  } else {
    pickedTopic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    pickedMotivation = weightedPick(MOTIVATIONS, MOTIVATION_WEIGHTS);
    combinedStyle = `${pickedTopic.name}|${pickedMotivation.name}`;
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
  const MULTI_P_MIN = 0.40;  // 最低多人概率
  const MULTI_P_MAX = 0.80;  // 最高多人概率（社交达人，永远留 20% 单人空间）
  const MULTI_K = 1.0;       // 陡峭度：越大曲线越陡，1.0 时 R≈4~6 为快速拉升区
  const MULTI_R_MID = 5;     // 拐点：R=5 时概率正好 = (P_min+P_max)/2 = 55%

  let multiPerson = null;
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
               c.id AS other_id, c.display_name AS other_name, c.base_prompt AS other_prompt
        FROM character_relationships cr
        JOIN characters c ON c.id = cr.to_character_id
        WHERE cr.from_character_id = ? AND cr.relationship_text != ''
      `).all(character.id);

      const picked = allRels[Math.floor(Math.random() * allRels.length)];
      // 将对方人格中的「你」替换为角色名（注意：你的/你们的/你自己 等复合形式）
      const otherPersona = picked.other_prompt
        .replace(/你自己/g, picked.other_name + '自己')
        .replace(/你们的/g, picked.other_name + '的')
        .replace(/你的/g, picked.other_name + '的')
        .replace(/你/g, picked.other_name);

      const relDesc = `${picked.other_name}是你的${picked.relationship_text}`;

      multiPerson = {
        otherId: picked.other_id,
        otherName: picked.other_name,
        otherPersona,
        relDesc,
      };
      console.log(`[moments] Multi-person mode: ${character.display_name} + ${picked.other_name} (${relDesc})`);
    }
  }

  // 3. LLM 生成文案 + 配图提示词
  const worldSetting = getWorldSetting();
  const permissionPrompt = worldSetting
    ? getSystemRulesWithWorld()
    : getSystemRules();
  const worldIntegrationNote = worldSetting
    ? `<world_integration priority="highest">
上述世界观设定不是可有可无的背景说明——它是这个虚构世界的基本法则，定义了这个世界里什么是正常的、人与人之间如何互动、社会如何运转。以下所有创作必须在这个世界观的框架内展开：

1. 朋友圈的内容必须反映世界观下的真实生活。角色分享的日常、感悟、见闻、吐槽，都应该自然地带出这个世界特有的元素——无论是街头景象、社交方式、人际关系，还是这个世界的"理所当然"。
2. 角色的行为模式和互动方式的"正常"与"异常"，由世界观定义。在这个世界里理所当然的事情，在现实世界可能不可思议——朋友圈的语气和内容应该自信地反映这种理所当然，不需要向读者解释。
3. 朋友圈的配图（imagePrompt）也要渗透世界观的视觉细节。场景、氛围、人物的互动方式、身体语言，都要符合这个世界的视觉规则。画面中的每一个元素都应该一致地属于这个世界。
4. 不要把世界观当成一段可以忽略的"前置说明"。它必须穿透到朋友圈的每一个字和每一帧画面中。世界观不是背景，是地基。
</world_integration>`
    : null;

  const multiPersonImageNote = multiPerson ? `
- **多人画面**：imagePrompt 中必须包含你和${multiPerson.otherName}两个人。你们的互动方式、肢体距离、表情和氛围都要贴合你们的关系（例如亲密的伴侣会有更近的距离和更私密的场景）。描述清楚各自的外观、位置、互动动作` : '';

  const postingTaskIntro = worldSetting
    ? '你正在发朋友圈。你的人设生存在上述世界观中，融入世界观，把世界观当做常识，生成一条自然的朋友圈动态。'
    : '你正在发朋友圈。请根据你的人设，生成一条自然的朋友圈动态。';

  const imagePromptRule = getGlobalRule('image_prompt');
  const imagePromptGuide = imagePromptRule?.rule_content || '';

  const postingTask = (() => {
    const jsonFmt = `输出格式（严格 JSON）：
{"text":"朋友圈文案（像角色本人随手发布的一条朋友圈，保持自然口语和角色个性）","imagePrompt":"${imagePromptGuide}${multiPersonImageNote}"}`;

    const rules = `规则：
- 只输出 JSON，不要解释
${worldSetting ? '- **世界观驱动**：你的朋友圈发生在上述世界观中，不是在真空或现实世界中。你分享的日常、你的语气、你描述的场景和互动方式，都应该是这个世界里一个普通人发的朋友圈——这个世界的"日常"就是你的日常，不需要刻意解释。' : ''}
- 文案和配图 prompt 必须语义一致
- text 用中文（80-200字），imagePrompt 用英文
- text里禁止输出'#下午茶的仪式感'类似这种tag标签
- 做的事情要符合当前时间，不需要提及现在的时间。除非极度需要说明时间才提及。`;

    if (isSpecialMode) {
      return `${postingTaskIntro}

${jsonFmt}

**本次必须使用「${pickedSpecialMode.name}」风格：${pickedSpecialMode.desc}**

${rules}`;
    }

    return `${postingTaskIntro}

${jsonFmt}

**本次发朋友圈 — 风格：${pickedTopic.desc}，动机：${pickedMotivation.desc}**

${rules}`;
  })();

  const now = new Date();
  const timeTag = getTimeLightTag(now);
  const { lightNote } = getTimeLight(now);

  // 日程注入：告知 LLM 角色此刻在做什么，朋友圈内容应反映此时段状态
  let scheduleContext = '';
  try {
    if (config.features.schedule !== false) {
      const activity = getCurrentActivity(character.id);
      if (activity && activity.activity !== '自由时间') {
        scheduleContext = `\n【日程状态】${character.display_name}此刻正在${activity.location}${activity.activity}。朋友圈内容应当反映这个时段角色的状态和见闻。`;
      }
    }
  } catch { /* schedule not available, skip */ }

  const lightHint = `\n【画面光线参考】${lightNote}（仅供参考，室内以人工光源为主）`;
  const userMsg = multiPerson
    ? `${timeTag}${scheduleContext} ${multiPerson.relDesc}——和${multiPerson.otherName}在一起，发一条朋友圈。只输出 {"text":"...","imagePrompt":"..."} JSON：${lightHint}`
    : `${timeTag}${scheduleContext} 发一条朋友圈，只输出 {"text":"...","imagePrompt":"..."} JSON：${lightHint}`;

  // msgs[0] 舞台 → [世界观] → msgs[1] 角色 → msgs[2] 交互(多人) → msgs[3] 任务 → user
  const msgs = [{ role: 'system', content: permissionPrompt }];
  if (worldIntegrationNote) msgs.push({ role: 'system', content: worldIntegrationNote });
  msgs.push({ role: 'system', content: character.base_prompt });
  if (multiPerson) {
    msgs.push({
      role: 'system',
      content: `**【最高优先级——你与${multiPerson.otherName}的真实关系】**\n${multiPerson.relDesc}。\n\n这是你们私下相处的真实状态。你的公开人设是你对外展示的一面，但在${multiPerson.otherName}面前，你们有只属于彼此的相处方式——你们的肢体接触、距离、语气、眼神，都是这个关系里才会有的。不要退回普通朋友的距离，不要用营业微笑面对这个人。\n\n朋友圈记录的是你们独处的真实瞬间，不是给粉丝看的舞台。\n\n${multiPerson.otherName}的公开信息供参考：\n---\n${multiPerson.otherPersona}\n---`
    });
  }
  msgs.push({ role: 'system', content: postingTask });
  msgs.push({ role: 'user', content: userMsg });

  const result = await chatSync(msgs, { temperature: 0.82, max_tokens: 1024, response_format: { type: 'json_object' }, label: '发朋友圈助手' });

  // 解析 LLM 输出
  let text = '', imagePrompt = '';
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
  let imageUrls = [];
  try {
    // 构建 lora 参数：合并自身 + 对方（如有）的 lora
    let loraOpts = {};
    const selfLoras = _parseCharLoras(character.loras);
    let otherLoras = [];
    if (multiPerson) {
      const otherChar = db.prepare('SELECT loras FROM characters WHERE id = ?').get(multiPerson.otherId);
      if (otherChar) otherLoras = _parseCharLoras(otherChar.loras);
    }

    const allLoras = [...selfLoras, ...otherLoras];

    if (allLoras.length > 0) {
      loraOpts = {
        customWorkflow: multiPerson ? null : (character.custom_workflow || null),
        loras: allLoras,
      };
      console.log(`[moments] Lora: self=${selfLoras.length} other=${otherLoras.length} total=${allLoras.length}`);
    }

    const genResult = await generateImageRaw(imagePrompt, {
      artist: config.comfyui.momentsArtist,
      width: config.comfyui.momentsWidth,
      height: config.comfyui.momentsHeight,
      scene: 'moments',
      priority: opts.manual ? 'high' : 'low',
      ...loraOpts,
    });

    if (genResult.success && genResult.images.length > 0) {
      for (const img of genResult.images) {
        const ts = Date.now();
        const filename = `moment_${ts}_${img.filename || 'comfy.png'}`;
        const url = saveBase64Image('moments', filename, img.base64);
        imageUrls.push(url);
      }
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
    'SELECT relationship_text FROM user_relationships WHERE character_id = ?'
  ).get(post.character_id);
  if (userRel && userRel.relationship_text) {
    userRelMsg = `**【你与user的关系】\n你对于user而言的身份是${userRel.relationship_text}。**这个关系为最高优先级，请在回复中自然体现。`;
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
    ? `<world_integration priority="highest">
上述世界观设定不是可有可无的背景说明——它是这个虚构世界的基本法则，定义了这个世界里什么是正常的、人与人之间如何互动、社会如何运转。以下所有创作必须在这个世界观的框架内展开：

1. 角色回复评论时的语言风格、互动方式、情感表达，都必须以世界观为基准线。角色觉得什么理所当然、什么值得惊讶、什么不可接受，都由世界观决定。
2. 评论中涉及的日常细节、社交礼仪、场景描述，都应该自然地反映这个世界的规则——不需要刻意解释，自信地呈现这个世界里的"日常"即可。
3. 不要把世界观当成一段可以忽略的"前置说明"。它必须穿透到回复的每一个字中。世界观不是背景，是地基。
</world_integration>`
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
