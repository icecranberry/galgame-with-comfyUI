import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, getSystemRulesWithWorld } from '../db/index.js';
import { chatSync } from '../llm/deepseek.js';
import { config } from '../config.js';
import { generateImageRaw } from '../services/imageSkill.js';
import { loadEmotionState, stateToPrompt, loadAffinity, affinityToPrompt } from '../services/emotionEngine.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(path.dirname(path.dirname(__filename)));
const imagesDir = path.join(projectRoot, 'data', 'images');

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
      CASE WHEN mc.author_type = 'character' THEN c.avatar_path ELSE NULL END AS char_avatar_path

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
    const result = await generateMomentPost(character);
    res.json(result);
  } catch (err) {
    console.error('[moments] generate error:', err.message);
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
async function generateMomentPost(character) {
  const db = getDb();

  // 1. 创建 pending 记录
  const postResult = db.prepare(
    `INSERT INTO moment_posts (character_id, content, prompt, style, resolution, status)
     VALUES (?, '', '', ?, ?, 'generating')`
  ).run(
    character.id,
    config.comfyui.momentsArtist,
    `${config.comfyui.momentsWidth}x${config.comfyui.momentsHeight}`
  );
  const postId = postResult.lastInsertRowid;

  // 2. 随机选取风格（代码侧硬随机，避免 LLM 偏见）
  const STYLES = [
    { name: '自拍', desc: '配图是你自己的照片，自拍视角，selfie pose，arm stretched towards viewer，imagePrompt 要包含你的外观' },
    { name: '美食', desc: '分享今天吃到的美食，配图是食物特写' },
    { name: '风景', desc: '分享今天看到的风景或去的地方，配图是景色' },
    { name: '日常', desc: '分享一件小事或感悟，配图是场景 mood shot' },
    { name: '遇到的人或事', desc: '分享遇到的有趣的人或事，配图是情境画面' },
    { name: '吐槽碎碎念', desc: '发点牢骚或碎碎念，配图可以是表情包风格或随手拍 mood shot' },
    { name: '推荐安利', desc: '推荐最近喜欢的音乐/电影/书/游戏/好物，配图是推荐物品或氛围图' },
    { name: '深夜感想', desc: '深夜发的感性文字或人生感悟，配图是夜景或情绪氛围图' },
    { name: '搞怪整活', desc: '沙雕内容或搞笑段子，配图可以夸张、meme 风格' },
    { name: '怀旧', desc: '回忆过去的事或人，配图是怀旧氛围或老照片风格' },
    { name: '宠物', desc: '晒猫晒狗或偶遇的小动物，配图是动物特写或互动瞬间' },
    { name: '穿搭', desc: '分享今天的穿搭或新买的衣服，配图是全身/半身穿搭展示' },
    { name: '旅行', desc: '在路上的见闻——车站、机票、陌生城市的街角，配图是旅途中的场景' },
    { name: '工作/学习', desc: '打工/刷题/赶稿的一天，配图是书桌、电脑屏幕或咖啡杯 mood shot' },
    { name: '健身/运动', desc: '跑步、撸铁、瑜伽后的感受，配图是运动场景或器材' },
    { name: '购物/开箱', desc: '新买的东西到了，兴奋开箱分享，配图是物品特写' },
    { name: '倒霉日常', desc: '今天发生的糗事、翻车现场，配图可以是尴尬情境或夸张 reaction' },
    { name: '才艺展示', desc: '展示自己的技能——画画、弹琴、手作、烹饪成果，配图是作品展示' },
    { name: '身材展示', desc: '展示自己的身材或健身成果，配图是全身或局部特写' },
    { name: '天气/季节', desc: '对天气或季节变化的感叹（下雨、初雪、花开），配图是天气氛围' },
    { name: '求助/提问', desc: '向朋友圈求助或发起话题讨论，配图是相关情境' },
    { name: '做梦/幻想', desc: '分享昨晚的怪梦或白日梦，配图是超现实或梦幻风格' },
    { name: '节日/庆祝', desc: '过节、生日、纪念日或某个特殊日子，配图是庆祝氛围' },
    { name: '读书/观影', desc: '刚看完的书或电影的简短感想，配图是书影封面或相关氛围' },
    { name: '突发状况', desc: '意外事件——停电、迷路、偶遇，配图是事发场景' },
    { name: '手工/创作', desc: '自己做的东西——烘焙、手帐、模型涂装，配图是创作过程或成品' },
    { name: '游戏时刻', desc: '晒战绩、吐槽队友、沉迷新游，配图是游戏画面或电竞氛围' },
    { name: '追星/粉丝', desc: '为偶像打call、演唱会/漫展/新专辑，配图是应援或相关物料' },
    { name: '养生/健康', desc: '泡脚、早睡、养生茶、拉伸打卡，配图是养生场景或静谧氛围' },
    { name: '消费/剁手', desc: '分享买到的好价好物、省钱攻略或冲动消费后的反思，配图是物品或支付截图风格' },
    { name: '吃瓜/八卦', desc: '围观热点事件或身边八卦，配图是吃瓜表情包风格或围观氛围' },
    { name: '仪式感', desc: '点亮生活的仪式感瞬间——点蜡烛、泡澡、换新床单、买花，配图是精致生活氛围' },
    { name: '摄影/随手拍', desc: '分享自己拍的照片（非自拍），强调构图、光影、瞬间捕捉，配图是有摄影感的画面' },
    { name: '心情日记', desc: '记录当下某种心情——无聊、焦虑、平静、兴奋，不带事件只写感受' },
    { name: '冷知识/科普', desc: '分享一个有趣的冷知识或小科普，让人看完"原来如此"' },
    { name: '挑战/互动', desc: '发起一个挑战或话题让大家参与（猜图、接龙、选择题）' },
    { name: '梦境/脑洞', desc: '分享昨晚做的怪梦或一个天马行空的脑洞故事' },
    { name: '秘密/树洞', desc: '像树洞一样分享一个小心事或秘密，语气真诚脆弱' },
    { name: '里程碑', desc: '达成某个小目标的纪念——粉丝数、连续打卡第N天、成就解锁' },
    { name: '发呆/放空', desc: '什么事都不想做，就发呆、看云、听雨、盯着天花板' },
    { name: '穿搭改造', desc: '旧衣新穿、一衣多穿或搭配改造的思路和成果对比' },
  ];
  const pickedStyle = STYLES[Math.floor(Math.random() * STYLES.length)];

  // 2.5 Sigmoid 模型：根据角色关系网数量决定多人概率
  // P(多人) = P_min + (P_max - P_min) / (1 + e^(-k × (R - R_mid)))
  const MULTI_P_MIN = 0.30;  // 最低多人概率
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
        otherName: picked.other_name,
        otherPersona,
        relDesc,
      };
      console.log(`[moments] Multi-person mode: ${character.display_name} + ${picked.other_name} (${relDesc})`);
    }
  }

  // 3. LLM 生成文案 + 配图提示词
  const permissionPrompt = getSystemRulesWithWorld();

  const multiPersonImageNote = multiPerson ? `
- **多人画面**：imagePrompt 中必须包含你和${multiPerson.otherName}两个人。你们的互动方式、肢体距离、表情和氛围都要贴合你们的关系（例如亲密的伴侣会有更近的距离和更私密的场景）。描述清楚各自的外观、位置、互动动作` : '';

  const postingTask = `你正在发朋友圈。请根据你的人设，生成一条自然的朋友圈动态。

输出格式（严格 JSON）：
{"text":"朋友圈文案（50-200字，自然口语化，可以分享生活、食物、风景、感悟等）","imagePrompt":"描述需要画的内容。需要详细：
- **非常重要，这条一定要加：**命中 IP 时必须写 'character\(series\)' + **≥8 个外观锚点**（发型/发色/眼色/标志服饰/配饰)，如:'Furina \(Genshin Impact\)'。角色名字放在 prompt 字段内最开头
- 原创角色：直接描述外观，不写 character/series
- **不确定的角色特征不允许编造**：若本地知识库无该 IP 角色的准确信息（发色、瞳色、标志服装等），禁止凭空编造角色标签。
- 描述场景在哪、镜头角度、角色表情、衣服、动作、场景中的其他背景物品，在自然语言描述之外，可以用Danbooru格式的tag标签来重复强调动作，镜头。
- prompt开头的角色名之后，必须注明场景里面几个人，例如：'2girls'、'3girls'，'1girl'，'1boy,1girl'
- 将text中的所有角色加入画面，明确追加说明什么发色的角色在做什么，例如：'2girls，琪亚娜和芽衣，白色头发的琪亚娜抱着紫色头发的芽衣'、'1boy，1girl，凯文和梅，白色头发的凯文抱着紫色头发的梅'${multiPersonImageNote}
- **最终输出为英文，角色名也需要翻译成英文**
- 注意：不要在 prompt 值中使用未转义的双引号，如需引号请用单引号替代"}

本次必须使用「${pickedStyle.name}」风格：${pickedStyle.desc}

规则：
- 只输出 JSON，不要解释
- 文案和配图 prompt 必须语义一致
- text 用中文，imagePrompt 用英文
- text里禁止输出'#下午茶的仪式感'、'#一个人的盛宴'类似这种tag标签
- 做的事情要符合当前时间，不需要提及现在的时间。除非极度需要说明时间才提及。`;

  const now = new Date();
  const weekDay = ['周日','周一','周二','周三','周四','周五','周六'][now.getDay()];
  const timeTag = `[当前时间 ${weekDay} ${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]`;
  const userMsg = multiPerson
    ? `${timeTag} ${multiPerson.relDesc}——和${multiPerson.otherName}在一起，发一条朋友圈。只输出 {"text":"...","imagePrompt":"..."} JSON：`
    : `${timeTag} 发一条朋友圈，只输出 {"text":"...","imagePrompt":"..."} JSON：`;

  // msgs[0] 舞台 → msgs[1] 角色 → msgs[2] 交互(多人) → msgs[3] 任务 → user
  const msgs = [{ role: 'system', content: permissionPrompt }];
  msgs.push({ role: 'system', content: character.base_prompt });
  if (multiPerson) {
    msgs.push({
      role: 'system',
      content: `**【最高优先级——你与${multiPerson.otherName}的真实关系】**\n${multiPerson.relDesc}。\n\n这是你们私下相处的真实状态。你的公开人设是你对外展示的一面，但在${multiPerson.otherName}面前，你们有只属于彼此的相处方式——你们的肢体接触、距离、语气、眼神，都是这个关系里才会有的。不要退回普通朋友的距离，不要用营业微笑面对这个人。\n\n朋友圈记录的是你们独处的真实瞬间，不是给粉丝看的舞台。\n\n${multiPerson.otherName}的公开信息供参考：\n---\n${multiPerson.otherPersona}\n---`
    });
  }
  msgs.push({ role: 'system', content: postingTask });
  msgs.push({ role: 'user', content: userMsg });

  const result = await chatSync(msgs, { temperature: 0.82, max_tokens: 1024, label: '发朋友圈助手' });

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
    const genResult = await generateImageRaw(imagePrompt, {
      artist: config.comfyui.momentsArtist,
      width: config.comfyui.momentsWidth,
      height: config.comfyui.momentsHeight,
    });

    if (genResult.success && genResult.images.length > 0) {
      fs.mkdirSync(imagesDir, { recursive: true });
      for (const img of genResult.images) {
        const ts = Date.now();
        const filename = `moment_${ts}_${img.filename || 'comfy.png'}`;
        const filePath = path.join(imagesDir, filename);
        const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        imageUrls.push(`/images/${filename}`);
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
  const permissionPrompt = getSystemRulesWithWorld();

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

  // 朋友圈上下文 + 回复规则
  const contextTask = `关于${userName}：
${userPersona}

你在朋友圈发了：
---
${post.content}
---

评论区目前的对话：
---
${commentHistory}
---

请以角色的身份自然回复评论区的最新评论。规则：
- 15~50 字，自然口语化，像熟人聊天一样随意
- **不要反复叫对方名字**——熟人之间连续对话不需要每句都称呼，只在特别强调时用
- 保持角色人设和语气
- 可以参考评论区的上下文，但不要重复自己已经说过的话
- 只输出回复内容，不要任何前缀或引号`;

  // msgs[0] 舞台 → msgs[1] 角色+情绪 → msgs[2] 交互上下文 → msgs[3] 任务 → user
  const msgs = [{ role: 'system', content: permissionPrompt }];

  // msgs[1] — 角色：人格 + 情绪
  const charContent = [post.base_prompt, emotionPrompt].filter(Boolean).join('\n\n');
  msgs.push({ role: 'system', content: charContent });

  // msgs[2] — 交互：用户关系 + 角色间关系 + 好感度
  const relContext = [userRelMsg, charRelMsg, affPrompt].filter(Boolean).join('\n\n');
  if (relContext) msgs.push({ role: 'system', content: relContext });

  // msgs[3] — 任务：用户信息 + 朋友圈内容 + 评论区 + 规则
  msgs.push({ role: 'system', content: contextTask });

  const now = new Date();
  const weekDay = ['周日','周一','周二','周三','周四','周五','周六'][now.getDay()];
  const timeTag = `[当前时间 ${weekDay} ${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]`;
  msgs.push({ role: 'user', content: `${timeTag} 回复这条评论：` });

  const result = await chatSync(msgs, { temperature: 0.75, max_tokens: 128, label: '回评' });

  return result.trim().replace(/^["']|["']$/g, '').slice(0, 200);
}

export default router;
export { generateMomentPost };
