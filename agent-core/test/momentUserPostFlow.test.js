import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };

const { config } = await import('../src/config.js');
// 测试确定性：关闭日程/情绪子系统（睡眠检查与情绪注入不参与断言）
config.features.schedule = false;
config.features.emotion = false;
config.user.nickname = '测试员';
// 路由层测试必须拦下真实 LLM 请求（OpenAI SDK 不走 globalThis.fetch）：
// 指向本机必然拒绝连接的端口并重建客户端，chatSync 快速抛错 → 回复为空不阻塞
config.llm.baseURL = 'http://127.0.0.1:9';
const { resetClient } = await import('../src/llm/llm-client.js');
resetClient();

const { getDb, closeDb } = await import('../src/db/index.js');
const router = (await import('../src/routes/moments.js')).default;
const {
  parseMentionedCharacters,
  handleUserComment,
} = await import('../src/services/momentCommentService.js');
const {
  publishUserMoment,
  triggerUserPostReplies,
  selectUserPostRepliers,
  listRecentlyChattedCharacters,
  generateUserPostComment,
  describeUserMomentImages,
  userNickname,
} = await import('../src/services/momentUserPostService.js');
const { firstMomentImagePrompt, buildMomentImagePromptNote } = await import('../src/services/momentForms.js');

// ──────────────── 工具 ────────────────

function seedCharacter(db, { name, display_name, base_prompt = '旅客', avatar_path = null }) {
  const r = db.prepare(
    `INSERT INTO characters (name, display_name, base_prompt, avatar_path) VALUES (?, ?, ?, ?)`
  ).run(name, display_name, base_prompt, avatar_path);
  return Number(r.lastInsertRowid);
}

function seedCharPost(db, charId, { content = '今天的动态', prompt = '' } = {}) {
  const r = db.prepare(
    `INSERT INTO moment_posts (character_id, content, prompt, status) VALUES (?, ?, ?, 'done')`
  ).run(charId, content, prompt);
  return Number(r.lastInsertRowid);
}

function seedChatMessage(db, charId) {
  const raw = db.prepare(
    `INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, 'user', '你好')`
  ).run(`char_${charId}`);
  db.prepare(
    `INSERT INTO messages (conversation_id, raw_id, role, content, seq, created_at)
     VALUES (?, ?, 'user', '你好', 1, datetime('now', '-' || ? || ' minutes'))`
  ).run(`char_${charId}`, Number(raw.lastInsertRowid), Math.floor(Math.random() * 1000));
}

function loadPostRow(db, postId) {
  return db.prepare(
    `SELECT mp.*, c.display_name, c.base_prompt
     FROM moment_posts mp LEFT JOIN characters c ON c.id = mp.character_id
     WHERE mp.id = ?`
  ).get(postId);
}

/** 用真实 express app 托管 router 发请求（:id 路由需要 express 解析 params） */
async function makeApp() {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/moments', router);
  return app;
}

function request(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request({
        host: '127.0.0.1',
        port,
        method,
        path: url,
        headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          server.close();
          try { resolve({ status: res.statusCode, payload: data ? JSON.parse(data) : null }); }
          catch (e) { reject(e); }
        });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// ──────────────── momentForms：首图 prompt 工具 ────────────────

test('firstMomentImagePrompt 多图取第一张，空 prompt 返回空串', () => {
  assert.equal(firstMomentImagePrompt('a cat\n---\na dog'), 'a cat');
  assert.equal(firstMomentImagePrompt('  solo  '), 'solo');
  assert.equal(firstMomentImagePrompt(''), '');
  assert.equal(firstMomentImagePrompt(null), '');
  assert.equal(firstMomentImagePrompt('\n---\n---'), '');
});

test('buildMomentImagePromptNote 有 prompt 注入说明段，无 prompt 不注入', () => {
  assert.ok(buildMomentImagePromptNote('a rainy street').includes('a rainy street'));
  assert.equal(buildMomentImagePromptNote(''), '');
  assert.equal(buildMomentImagePromptNote(null), '');
});

// ──────────────── DB 迁移 ────────────────

test('迁移后 moment_posts 允许用户作者（双 NULL），角色/镇民互斥仍生效', async t => {
  t.after(() => closeDb());
  const db = getDb();

  const userPost = db.prepare(
    `INSERT INTO moment_posts (character_id, npc_id, content, status) VALUES (NULL, NULL, '我的帖子', 'done')`
  ).run();
  assert.ok(userPost.lastInsertRowid);

  // 恰好一个作者的旧口径仍然合法
  const cid = seedCharacter(db, { name: 'mig', display_name: '密格' });
  db.prepare(`INSERT INTO moment_posts (character_id, content, status) VALUES (?, 'x', 'done')`).run(cid);

  // 双作者仍被 CHECK 拒绝
  assert.throws(() => {
    db.prepare(`INSERT INTO moment_posts (character_id, npc_id, content, status) VALUES (?, 1, 'x', 'done')`).run(cid);
  });
});

test('迁移后 moment_comments 带 reply_to_comment_id 列', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const cols = db.prepare('PRAGMA table_info(moment_comments)').all();
  assert.ok(cols.find(c => c.name === 'reply_to_comment_id'), 'reply_to_comment_id should exist');
});

// ──────────────── @ 点名解析 ────────────────

test('parseMentionedCharacters 按 display_name / name 命中，长名优先', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const a = seedCharacter(db, { name: 'xiaomei', display_name: '小美' });
  const b = seedCharacter(db, { name: 'xiaomeimei', display_name: '小美美' });
  const chars = db.prepare('SELECT * FROM characters').all();

  const hit = parseMentionedCharacters('@小美美 你觉得呢', chars);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].id, b, '「@小美美」不应被「小美」抢匹配');

  const hitBoth = parseMentionedCharacters('@小美 和 @小美美 都来', chars);
  assert.deepEqual(hitBoth.map(c => c.id).sort(), [a, b].sort());

  assert.deepEqual(parseMentionedCharacters('没有点名', chars), []);
  assert.deepEqual(parseMentionedCharacters('@不存在的角色', chars), []);
});

// ──────────────── 用户发帖：选人 ────────────────

test('selectUserPostRepliers 最近聊过的 10 个里挑 3 个 + 其余角色里挑 1~3 个', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const chattedIds = [];
  for (let i = 0; i < 10; i++) {
    const id = seedCharacter(db, { name: `c${i}`, display_name: `角色${i}` });
    chattedIds.push(id);
    seedChatMessage(db, id);
  }
  const quietIds = [];
  for (let i = 0; i < 2; i++) {
    quietIds.push(seedCharacter(db, { name: `q${i}`, display_name: `安静${i}` }));
  }

  const recent = listRecentlyChattedCharacters(db);
  assert.equal(recent.length, 10, '取最近 10 个聊过的角色');

  const picked = selectUserPostRepliers(db);
  const recentPicked = picked.filter(c => chattedIds.includes(c.id));
  const othersPicked = picked.filter(c => quietIds.includes(c.id));

  assert.equal(recentPicked.length, 3, '最近 10 个里随机挑 3 个');
  assert.ok(othersPicked.length >= 1 && othersPicked.length <= 3, '其余角色里挑 1~3 个');
  assert.equal(recentPicked.length + othersPicked.length, picked.length);
});

// ──────────────── 用户发帖：服务层主流程 ────────────────

test('publishUserMoment 落库用户帖并广播 user 作者帖', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const broadcasts = [];
  const savedImages = [];
  const scheduled = [];

  const post = await publishUserMoment(
    { content: '周末去海边啦', images: ['data:image/png;base64,AAAA'] },
    {
      saveImage: (category, filename, dataUri) => { savedImages.push({ category, filename, dataUri }); return `/images/${category}/${filename}`; },
      broadcastPost: (p) => broadcasts.push(p),
      schedule: (fn) => scheduled.push(fn),
      compressImage: async dataUri => ({ dataUri, ext: '.png' }),
    }
  );

  const row = db.prepare('SELECT * FROM moment_posts WHERE id = ?').get(post.id);
  assert.equal(row.character_id, null);
  assert.equal(row.npc_id, null);
  assert.equal(row.content, '周末去海边啦');
  assert.equal(row.status, 'done');

  assert.equal(savedImages[0].category, 'moments');
  assert.deepEqual(JSON.parse(row.images), [`/images/moments/${savedImages[0].filename}`]);

  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].author_type, 'user');
  assert.equal(scheduled.length, 1, '评论流程进入异步排队');
});

test('triggerUserPostReplies 按选人结果逐个评论，落库 + 广播（fake LLM）', async t => {
  t.after(() => closeDb());
  const db = getDb();
  // 4 个角色：3 个有聊天记录（最近池取 3）+ 1 个没聊过（其余池取 1）
  for (let i = 0; i < 3; i++) {
    const id = seedCharacter(db, { name: `f${i}`, display_name: `朋友${i}`, base_prompt: `朋友${i}的人设` });
    seedChatMessage(db, id);
  }
  seedCharacter(db, { name: 'fq', display_name: '安静的朋友', base_prompt: '安静朋友的人设' });
  const post = publishUserPostRow(db);

  const seenMsgs = [];
  const commentBroadcasts = [];
  await triggerUserPostReplies({ id: post.id, content: '周末去海边啦', prompt: '', images: [] }, {
    chatSync: async (msgs) => { seenMsgs.push(msgs); return '好美！羡慕了'; },
    broadcastComment: (d) => commentBroadcasts.push(d),
    delay: async () => {},
  });

  // 4 个角色（3 个最近聊天 + 其余 1 个）都来了评论
  const comments = db.prepare(
    'SELECT * FROM moment_comments WHERE post_id = ? ORDER BY id'
  ).all(post.id);
  assert.equal(comments.length, 4);
  for (const c of comments) {
    assert.equal(c.author_type, 'character');
    assert.equal(c.auto_trigger, 1);
    assert.equal(c.thread_root_id, c.id, '线程根评论自指');
  }

  assert.equal(commentBroadcasts.length, 4);
  assert.ok(commentBroadcasts.every(b => b.comment.char_display_name && b.comment.post_id === post.id));

  // prompt 结构：包含帖子正文与评论区规则（对齐现有朋友圈评论口径）
  const flat = seenMsgs.map(m => m.map(x => x.content).join('\n')).join('\n');
  assert.ok(flat.includes('周末去海边啦'), '评论 prompt 应包含帖子正文');
  assert.ok(flat.includes('3~25 字'), '评论 prompt 应带上评论风格规则');
  // 用户帖没有 prompt → 不注入配图说明
  assert.ok(!flat.includes('配图的画面描述'));
});

test('triggerUserPostReplies 原图识别一次，稳定注入全部评论提示词并落库', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const id = seedCharacter(db, { name: 'img1', display_name: '看图人', base_prompt: '看图人的人设' });
  seedChatMessage(db, id);
  const post = publishUserPostRow(db);

  const recognitionMsgs = [];
  const seenMsgs = [];
  const dataUri = 'data:image/png;base64,' + Buffer.from('test-image').toString('base64');
  await triggerUserPostReplies({
    id: post.id,
    content: '这是刚拍的照片',
    prompt: '',
    images: ['/images/moments/test.png'],
    imageDataUris: [dataUri],
  }, {
    describeImages: async (images, deps) => {
      recognitionMsgs.push({ images, deps });
      return '第1张：餐桌上有两杯咖啡和一块蛋糕';
    },
    chatSync: async (msgs) => {
      seenMsgs.push(msgs);
      return '看起来很好吃';
    },
    broadcastComment: () => {},
    delay: async () => {},
  });

  // 描述存档仍会被调用一次，结果写入 post.prompt 供私聊/群聊消费
  assert.equal(recognitionMsgs.length, 1);
  assert.deepEqual(recognitionMsgs[0].images, [dataUri]);
  assert.equal(db.prepare('SELECT prompt FROM moment_posts WHERE id = ?').get(post.id).prompt, '第1张：餐桌上有两杯咖啡和一块蛋糕');

  // 评论改用描述助手的文字，不再传原图
  assert.equal(seenMsgs.length, 1);
  assert.ok(seenMsgs[0].every(m => typeof m.content === 'string'), '所有消息应为纯文本');
  const flat = seenMsgs.flat().map(m => m.content).join('\n');
  assert.ok(flat.includes('餐桌上有两杯咖啡和一块蛋糕'), '描述助手结果应注入评论 prompt');
  assert.ok(flat.includes('请以你的身份（看图人）'));
});

test('generateUserPostComment 用户画像和动态先于角色人设，且不带评论区历史', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const id = seedCharacter(db, { name: 'cache1', display_name: '缓存朋友', base_prompt: '缓存朋友的人设' });
  db.prepare("UPDATE world_settings SET content = '<world_setting>测试世界观</world_setting>', is_active = 1").run();
  db.prepare('INSERT INTO user_relationships (character_id, relationship_text) VALUES (?, ?)')
    .run(id, '互相看不顺眼的同事');

  const msgs = [];
  await generateUserPostComment(
    db.prepare('SELECT * FROM characters WHERE id = ?').get(id),
    { content: '中午吃了个便当', prompt: 'a bento box on a desk' },
    [{ author_type: 'character', display_name: '别人', content: '这条历史评论不应传给模型' }],
    { chatSync: async (m) => { msgs.push(m); return '好'; } }
  );

  const flatMsgs = msgs.flat();
  const userIndex = flatMsgs.findIndex(m => m.role === 'system' && m.content.startsWith(`关于${userNickname()}：`));
  const postIndex = flatMsgs.findIndex(m => m.role === 'system' && m.content.includes('中午吃了个便当'));
  const charIndex = flatMsgs.findIndex(m => m.role === 'system' && m.content === '缓存朋友的人设');
  const rulesIndex = flatMsgs.findIndex(m => m.role === 'system' && m.content.startsWith('<user_moment_comment_rules>'));
  const relationIndex = flatMsgs.findIndex(m => m.role === 'system' && m.content.includes('<user_relation>你对于'));
  assert.ok(userIndex >= 0 && postIndex >= 0 && charIndex >= 0);
  assert.equal(userIndex, postIndex, '用户画像和动态应合并为同一 system');
  assert.ok(rulesIndex >= 0 && rulesIndex < userIndex, '评论规则应作为独立 system 先于动态');
  assert.ok(rulesIndex < charIndex, '评论规则应先于角色人设');
  assert.ok(relationIndex > charIndex, '关系应按私聊口径放在角色人设后');
  const userMessages = flatMsgs.filter(m => m.role === 'user');
  assert.equal(userMessages.length, 1);
  assert.ok(userMessages[0].content.startsWith('请遵循当前<world_setting>来评论朋友圈'));
  assert.ok(userMessages[0].content.includes(`请以你的身份（缓存朋友）`));
  assert.ok(!flatMsgs.some(m => m.role === 'system' && m.content.startsWith(`请以你的身份（缓存朋友）`)));
  assert.ok(userIndex < charIndex, '用户画像应先于角色人设');
  assert.ok(postIndex < charIndex, '用户动态应先于角色人设');
  assert.ok(flatMsgs.some(m => m.content?.includes('a bento box on a desk')));
  assert.ok(!flatMsgs.some(m => m.content?.includes('这条历史评论不应传给模型')));
});

test('describeUserMomentImages 把上传原图放进多模态请求', async t => {
  const dataUri = 'data:image/jpeg;base64,' + Buffer.from('jpeg-image').toString('base64');
  const msgs = [];
  const result = await describeUserMomentImages([dataUri], {
    chatSync: async (m) => { msgs.push(m); return '第1张：海边日落'; },
  });

  assert.equal(result, '第1张：海边日落');
  const multimodal = msgs.flat().find(m => Array.isArray(m.content));
  assert.ok(multimodal);
  assert.deepEqual(multimodal.content.find(part => part.type === 'image_url')?.image_url, { url: dataUri });
  const first = msgs.flat()[0];
  assert.equal(first.role, 'system');
  assert.ok(first.content.includes('<Supplementary_Rule>'), '图片识别应先注入破限词');
  const observer = msgs.flat().find(m => m.role === 'system' && m.content.includes('朋友圈图片观察助手'));
  assert.ok(observer.content.includes('「角色名（作品名）」'), '已知名角色应要求点名');
});

test('triggerUserPostReplies 识图失败时广播更换模型提示', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const id = seedCharacter(db, { name: 'vision', display_name: '识图人', base_prompt: '识图人的人设' });
  seedChatMessage(db, id);
  const post = publishUserPostRow(db);

  const broadcasts = [];
  await triggerUserPostReplies({
    id: post.id,
    content: '看图',
    prompt: '',
    images: ['/images/moments/test.png'],
  }, {
    describeImages: async () => {
      throw Object.assign(new Error('image input is not supported'), { status: 400 });
    },
    chatSync: async () => '好',
    broadcastComment: () => {},
    broadcastVisionError: data => broadcasts.push(data),
    delay: async () => {},
  });

  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].vision_unsupported, true);
  assert.equal(broadcasts[0].message, '当前模型不能识图');
  assert.equal(broadcasts[0].description, '请更换支持图片输入的模型');
  assert.equal(db.prepare('SELECT prompt FROM moment_posts WHERE id = ?').get(post.id).prompt, null);
});

function publishUserPostRow(db) {
  const r = db.prepare(
    `INSERT INTO moment_posts (character_id, npc_id, content, status) VALUES (NULL, NULL, '周末去海边啦', 'done')`
  ).run();
  return { id: Number(r.lastInsertRowid) };
}

test('generateUserPostComment 帖子带 prompt 时注入首图画面描述', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const id = seedCharacter(db, { name: 'g1', display_name: '阿海', base_prompt: '阿海人设' });

  const msgs = [];
  await generateUserPostComment(
    db.prepare('SELECT * FROM characters WHERE id = ?').get(id),
    { content: '夜市真热闹', prompt: 'a lively night market\n---\nsecond photo' },
    [],
    { chatSync: async (m) => { msgs.push(m); return '哈哈'; } }
  );

  const flat = msgs.map(m => m.map(x => x.content).join('\n')).join('\n');
  assert.ok(flat.includes('a lively night market'), '注入第一张的画面描述');
  assert.ok(!flat.includes('second photo'), '只带第一张，不带后面的');
});

test('generateUserPostComment 传 imageDataUris 也用描述文本，不再多模态附图', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const id = seedCharacter(db, { name: 'mm1', display_name: '多模态', base_prompt: '多模态人设' });
  const dataUri = 'data:image/png;base64,' + Buffer.from('photo-data').toString('base64');

  const msgs = [];
  await generateUserPostComment(
    db.prepare('SELECT * FROM characters WHERE id = ?').get(id),
    { content: '今天天空真美', prompt: '第1张：蓝天白云', imageDataUris: [dataUri] },
    [],
    { chatSync: async (m) => { msgs.push(m); return '好看'; } }
  );

  assert.ok(msgs.flat().every(m => typeof m.content === 'string'), '所有消息应为纯文本');
  const allText = msgs.flat().map(m => m.content).join('\n');
  assert.ok(allText.includes('蓝天白云'), '描述文本应注入');
});

test('generateUserPostComment 不把评论区历史塞进用户帖首评提示词', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const id = seedCharacter(db, { name: 'g2', display_name: '阿海', base_prompt: '阿海人设' });

  const msgs = [];
  await generateUserPostComment(
    db.prepare('SELECT * FROM characters WHERE id = ?').get(id),
    { content: '夜市真热闹', prompt: null },
    [{ author_type: 'character', display_name: null, content: '路过' }],
    { chatSync: async (m) => { msgs.push(m); return '好'; } }
  );

  const flat = msgs.map(m => Array.isArray(m.content)
    ? m.content.map(part => part.text || '').join('\n')
    : m.content).join('\n');
  assert.ok(!flat.includes('某位朋友：路过'), '不再传其他角色评论');
  assert.ok(!flat.includes(`${userNickname()}：路过`), '不再传用户历史评论');
  assert.ok(!flat.includes('阿海：路过'), '不再传当前角色历史评论');
});

// ──────────────── 评论流程：帖主回评 / @ 点名 / 楼中楼 ────────────────

test('handleUserComment 普通评论：帖主回评 + reply_to_comment_id 指向用户评论', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const cid = seedCharacter(db, { name: 'lin', display_name: '林小姐', base_prompt: '林小姐人设' });
  const postId = seedCharPost(db, cid, { content: '新买的杯子', prompt: 'a new cup on the desk' });

  const seen = [];
  const result = await handleUserComment({
    post: loadPostRow(db, postId),
    content: '杯子真好看',
    deps: { chatSync: async (msgs) => { seen.push(msgs); return '谢谢夸奖'; } },
  });

  assert.equal(result.replies.length, 1);
  assert.equal(result.reply.author_id, cid, '帖主回评');
  assert.equal(result.reply.reply_to_comment_id, result.comment.id);
  assert.equal(result.reply.reply_to_name, userNickname());
  assert.equal(result.reply.reply_to_author_type, 'user');

  // 顶层普通评论没有回复对象：写接口不得凭空长出「回复 X」前缀
  assert.equal(result.comment.reply_to_name, null);
  assert.equal(result.comment.reply_to_author_type, null);
  assert.equal(result.comment.reply_to_avatar_path, null);
  assert.equal(result.comment.reply_to_comment_id, null);

  // 帖主回评 prompt 带上首图画面描述（需求：评论额外带图片 prompt）
  const flat = seen.map(m => m.map(x => x.content).join('\n')).join('\n');
  assert.ok(flat.includes('a new cup on the desk'), '帖主回评 prompt 注入配图画面描述');
  assert.ok(flat.includes('新买的杯子'));
  assert.ok(flat.includes('3~25 字'));
});

test('handleUserComment @ 点名：被点名的角色回复，帖主不再默认回评', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const posterId = seedCharacter(db, { name: 'poster', display_name: '楼主' });
  const meiId = seedCharacter(db, { name: 'mei', display_name: '小美', base_prompt: '小美人设' });
  const postId = seedCharPost(db, posterId, { content: '随便说说' });

  const seen = [];
  const result = await handleUserComment({
    post: loadPostRow(db, postId),
    content: `@小美 你怎么看`,
    deps: { chatSync: async (msgs) => { seen.push(msgs); return '我觉得行'; } },
  });

  assert.equal(result.replies.length, 1);
  assert.equal(result.replies[0].author_id, meiId, '被点名者回复');
  assert.notEqual(result.replies[0].author_id, posterId);

  const flat = seen.map(m => m.map(x => x.content).join('\n')).join('\n');
  assert.ok(flat.includes('@ 了你'), '@ 点名在 prompt 里有明确指令');
});

test('handleUserComment 楼中楼：被回复评论的作者回评，线程与 reply_to 落库', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const posterId = seedCharacter(db, { name: 'p2', display_name: '楼王' });
  const friendId = seedCharacter(db, {
    name: 'fr', display_name: '阿友', base_prompt: '阿友人设', avatar_path: '/avatars/avatar_3.png',
  });
  const postId = seedCharPost(db, posterId, { content: '楼王日常' });
  const nickname = userNickname();
  const seen = [];

  // 阿友先有一条自动首评（线程根，自指）
  const root = db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, author_id, content, auto_trigger, thread_root_id)
     VALUES (?, 'character', ?, '前排！', 1, NULL)`
  ).run(postId, friendId);
  const rootId = Number(root.lastInsertRowid);
  db.prepare('UPDATE moment_comments SET thread_root_id = ? WHERE id = ?').run(rootId, rootId);

  const result = await handleUserComment({
    post: loadPostRow(db, postId),
    content: '前排也得理理我',
    replyToCommentId: rootId,
    deps: { chatSync: async (msgs) => { seen.push(msgs); return '哈哈来啦'; } },
  });

  assert.equal(result.replies.length, 1);
  assert.equal(result.replies[0].author_id, friendId, '被回复的评论发起者回评');
  assert.equal(result.comment.thread_root_id, rootId, '用户评论归入线程');
  assert.equal(result.replies[0].thread_root_id, rootId);
  assert.equal(result.replies[0].reply_to_comment_id, result.comment.id);

  // 写接口返回的评论会被前端直接插进列表（列表刷新不重拉评论），
  // 必须自带「回复 X」所需的字段，否则渲染退化成普通评论
  assert.equal(result.comment.reply_to_name, '阿友');
  assert.equal(result.comment.reply_to_author_type, 'character');
  assert.equal(result.comment.reply_to_avatar_path, '/avatars/avatar_3.png');
  assert.equal(result.comment.reply_to_comment_id, rootId);
  assert.equal(result.comment.author_id, null);
  assert.equal(result.comment.char_display_name, null);
  assert.equal(result.comment.char_avatar_path, null);
  assert.equal(result.comment.auto_trigger, 0);

  const userRow = db.prepare('SELECT * FROM moment_comments WHERE id = ?').get(result.comment.id);
  const flat = seen.map(m => m.map(x => x.content).join('\n')).join('\n');
  assert.ok(flat.includes('最新要回应的评论：'));
  assert.ok(flat.includes(`${nickname} 回复 阿友：前排也得理理我`));
  assert.ok(flat.includes('被回复的原评论：'));
  assert.ok(flat.includes('阿友：前排！'));
  assert.ok(flat.includes(`请直接回应${nickname}刚刚发出的这条最新评论`));
  assert.equal(userRow.thread_root_id, rootId);
  const replyRow = db.prepare('SELECT * FROM moment_comments WHERE id = ?').get(result.replies[0].id);
  assert.equal(replyRow.reply_to_comment_id, result.comment.id);

  // 写接口对象与读接口 GET /:id 的字段口径必须逐项一致（刷新前后渲染一致）
  const app = await makeApp();
  const detail = await request(app, 'GET', `/api/moments/${postId}`);
  assert.equal(detail.status, 200);
  const readRow = detail.payload.comments.find(c => c.id === result.comment.id);
  assert.ok(readRow, '读接口能查到刚写入的用户评论');
  for (const field of ['reply_to_name', 'reply_to_author_type', 'reply_to_avatar_path', 'reply_to_comment_id']) {
    assert.equal(result.comment[field], readRow[field], `写/读接口 ${field} 口径一致`);
  }
});

test('handleUserComment 用户帖回评保留帖主和最新回复链', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const bellId = seedCharacter(db, { name: 'bell', display_name: '铃', base_prompt: '铃人设' });
  const nickname = userNickname();
  const r = db.prepare(`
    INSERT INTO moment_posts (character_id, npc_id, content, status) VALUES (NULL, NULL, '这是谁家小可爱啊~', 'done')
  `).run();
  const postId = Number(r.lastInsertRowid);
  const bellComment = db.prepare(`
    INSERT INTO moment_comments (post_id, author_type, author_id, content) VALUES (?, 'character', ?, '哇——这发色挑染绝了')
  `).run(postId, bellId);

  const seen = [];
  const result = await handleUserComment({
    post: loadPostRow(db, postId),
    content: '就在家门口呢',
    replyToCommentId: Number(bellComment.lastInsertRowid),
    deps: { chatSync: async (msgs) => { seen.push(msgs); return '哦？那我路过看看'; } },
  });

  assert.equal(result.replies.length, 1);
  assert.equal(result.replies[0].author_id, bellId);
  const flat = seen.map(m => m.map(x => x.content).join('\n')).join('\n');
  assert.ok(flat.includes('最新要回应的评论：'));
  assert.ok(flat.includes(`${nickname}的朋友圈动态：`), '用户帖不能被误标成回复角色发布的动态');
  assert.ok(flat.includes(`${nickname} 回复 铃：就在家门口呢`));
  assert.ok(flat.includes('铃：哇——这发色挑染绝了'));
});

test('handleUserComment 用户回复用户评论时回落到帖主（角色帖）', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const posterId = seedCharacter(db, { name: 'p3', display_name: '楼三' });
  const postId = seedCharPost(db, posterId, { content: '随便聊聊' });

  const other = db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, content) VALUES (?, 'user', '路人评论')`
  ).run(postId);

  const result = await handleUserComment({
    post: loadPostRow(db, postId),
    content: '同意路人',
    replyToCommentId: Number(other.lastInsertRowid),
    deps: { chatSync: async () => '哈哈' },
  });

  assert.equal(result.replies.length, 1);
  assert.equal(result.replies[0].author_id, posterId, '被回复者是用户 → 帖主兜底接话');
});

// ──────────────── 路由层：HTTP 全链路 ────────────────

test('POST /api/moments/user-post 全链路：落库 + 返回 user 作者帖', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const app = await makeApp();

  const { status, payload } = await request(app, 'POST', '/api/moments/user-post', { content: '路由测试发帖' });
  assert.equal(status, 200);
  assert.equal(payload.author_type, 'user');
  assert.equal(payload.display_name, userNickname());

  const row = db.prepare('SELECT * FROM moment_posts WHERE id = ?').get(payload.id);
  assert.equal(row.character_id, null);
  assert.equal(row.npc_id, null);
  assert.equal(row.content, '路由测试发帖');

  // 空内容 + 无图 → 400
  const bad = await request(app, 'POST', '/api/moments/user-post', { content: '   ' });
  assert.equal(bad.status, 400);
});

test('GET /api/moments/:id 评论按写入顺序返回，不受 created_at 格式影响', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const app = await makeApp();
  const posterId = seedCharacter(db, { name: 'op', display_name: '顺序人' });
  const postId = seedCharPost(db, posterId, { content: '顺序帖' });

  // 旧数据可能同时存在 SQLite 与 JS 两种时间字符串；刷新展示必须跟实时 append 口径一致。
  db.prepare(`
    INSERT INTO moment_comments (post_id, author_type, content, created_at)
    VALUES (?, 'user', '先写入', '2030-01-01T00:00:00.000Z')
  `).run(postId);
  db.prepare(`
    INSERT INTO moment_comments (post_id, author_type, author_id, content, created_at)
    VALUES (?, 'character', ?, '后写入', '2020-01-01 00:00:00')
  `).run(postId, posterId);

  const { payload } = await request(app, 'GET', `/api/moments/${postId}`);
  assert.deepEqual(payload.comments.map(c => c.content), ['先写入', '后写入']);
});

test('GET /api/moments/:id 评论 reply_to 通过 reply_to_comment_id 还原（用户楼中楼）', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const app = await makeApp();
  const posterId = seedCharacter(db, { name: 'gp', display_name: '盖楼人' });
  const postId = seedCharPost(db, posterId, { content: '盖楼' });

  const { payload: post } = await request(app, 'GET', `/api/moments/${postId}`);
  assert.equal(post.author_type, 'character');

  // 直接落库造楼中楼：用户评论 A + 角色回复（reply_to_comment_id → A）
  const userC = db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, content) VALUES (?, 'user', '第一条')`
  ).run(postId);
  const userCId = Number(userC.lastInsertRowid);
  db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, author_id, content, thread_root_id, reply_to_comment_id)
     VALUES (?, 'character', ?, '回你啦', NULL, ?)`
  ).run(postId, posterId, userCId);

  const { payload: detail } = await request(app, 'GET', `/api/moments/${postId}`);
  const reply = detail.comments.find(c => c.content === '回你啦');
  assert.ok(reply, '回复在详情里');
  assert.equal(reply.reply_to_name, userNickname());
  assert.equal(reply.reply_to_author_type, 'user');
});

test('GET /api/moments/:id 关系网自动评论的 reply_to 旧口径不受影响', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const app = await makeApp();
  const posterId = seedCharacter(db, { name: 'lp', display_name: '老楼' });
  const friendId = seedCharacter(db, { name: 'lf', display_name: '老友' });
  const postId = seedCharPost(db, posterId, { content: '老帖' });

  const root = db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, author_id, content, auto_trigger, thread_root_id)
     VALUES (?, 'character', ?, '首评', 1, NULL)`
  ).run(postId, friendId);
  const rootId = Number(root.lastInsertRowid);
  db.prepare('UPDATE moment_comments SET thread_root_id = ? WHERE id = ?').run(rootId, rootId);
  db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, author_id, content, auto_trigger, thread_root_id)
     VALUES (?, 'character', ?, '楼主回复', 1, ?)`
  ).run(postId, posterId, rootId);

  const { payload: detail } = await request(app, 'GET', `/api/moments/${postId}`);
  const posterReply = detail.comments.find(c => c.content === '楼主回复');
  assert.equal(posterReply.reply_to_name, '老友', '线程内前一条评论的旧口径保持');
  const rootComment = detail.comments.find(c => c.content === '首评');
  assert.equal(rootComment.reply_to_name, null, '线程根无回复前缀');
});

test('POST /api/moments/:id/comments 全链路：评论入库（LLM 不可用时回复为空不阻塞）', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const app = await makeApp();
  const posterId = seedCharacter(db, { name: 'rp', display_name: '热评人' });
  const postId = seedCharPost(db, posterId, { content: '热帖' });

  const { payload } = await request(app, 'POST', `/api/moments/${postId}/comments`, { content: '来都来了' });
  assert.ok(payload.comment.id);
  assert.equal(payload.comment.content, '来都来了');
  assert.deepEqual(payload.replies, []);

  const row = db.prepare('SELECT content FROM moment_comments WHERE id = ?').get(payload.comment.id);
  assert.equal(row.content, '来都来了');

  // 空内容 400
  const bad = await request(app, 'POST', `/api/moments/${postId}/comments`, { content: '  ' });
  assert.equal(bad.status, 400);
});
