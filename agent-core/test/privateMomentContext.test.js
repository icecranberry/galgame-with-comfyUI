import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { getDb, closeDb } = await import('../src/db/index.js');
const { buildPrivateMomentContext } = await import('../src/services/privateMomentContext.js');
const { listRecentMailboxLetters } = await import('../src/services/privateMailboxContext.js');

test('私聊朋友圈与信件语料按双方参与和时间窗口注入', async t => {
  t.after(() => closeDb());
  const db = getDb();

  const char1 = Number(db.prepare(
    `INSERT INTO characters (name, display_name, base_prompt) VALUES ('char1', '林一', '旅客一')`
  ).run().lastInsertRowid);
  const char2 = Number(db.prepare(
    `INSERT INTO characters (name, display_name, base_prompt) VALUES ('char2', '林二', '旅客二')`
  ).run().lastInsertRowid);

  db.prepare(
    `INSERT INTO moment_posts (character_id, content, status) VALUES (?, '角色的新帖', 'done')`
  ).run(char1);
  db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, content) VALUES (?, 'user', '用户评论')`
  ).run(1);

  const eligibleUserPost = db.prepare(`
    INSERT INTO moment_posts (character_id, npc_id, content, prompt, status, created_at)
    VALUES (NULL, NULL, '昨天去了海边', 'A quiet beach at sunset.', 'done', datetime('now', '-1 hour'))
  `).run();
  db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, author_id, content) VALUES (?, 'character', ?, '海好美')`
  ).run(Number(eligibleUserPost.lastInsertRowid), char1);
  db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, content) VALUES (?, 'user', '真的很治愈')`
  ).run(Number(eligibleUserPost.lastInsertRowid));
  db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, author_id, content) VALUES (?, 'character', ?, '二次评论')`
  ).run(Number(eligibleUserPost.lastInsertRowid), char1);
  db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, content) VALUES (?, 'user', '下次一起去')`
  ).run(Number(eligibleUserPost.lastInsertRowid));
  db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, author_id, content) VALUES (?, 'character', ?, '海水真蓝')`
  ).run(Number(eligibleUserPost.lastInsertRowid), char2);

  const oldUserPost = db.prepare(`
    INSERT INTO moment_posts (character_id, npc_id, content, status, created_at)
    VALUES (NULL, NULL, '三天前的旧帖', 'done', datetime('now', '-3 days'))
  `).run();
  db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, author_id, content) VALUES (?, 'character', ?, '旧帖评论')`
  ).run(Number(oldUserPost.lastInsertRowid), char1);

  const otherUserPost = db.prepare(`
    INSERT INTO moment_posts (character_id, npc_id, content, status, created_at)
    VALUES (NULL, NULL, '只有林二评论的帖子', 'done', datetime('now', '-2 hours'))
  `).run();
  db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, author_id, content) VALUES (?, 'character', ?, '路过')`
  ).run(Number(otherUserPost.lastInsertRowid), char2);

  const char1Block = buildPrivateMomentContext(db, {
    characterId: char1,
    characterName: '林一',
    userName: '测试员',
  });

  assert.ok(char1Block.includes('林一最近发了朋友圈：'));
  assert.ok(char1Block.includes('角色的新帖'));
  assert.ok(char1Block.includes('用户评论'));
  assert.ok(char1Block.indexOf('林一最近发了朋友圈：') < char1Block.indexOf('测试员最近发的朋友圈（你评论过）：'));
  assert.ok(char1Block.includes('昨天去了海边（配图：A quiet beach at sunset.）'));
  assert.ok(char1Block.includes('双方回复：'));
  assert.ok(char1Block.includes('林一：海好美'));
  assert.ok(char1Block.includes('测试员：真的很治愈'));
  assert.ok(char1Block.includes('测试员：下次一起去'));
  assert.ok(!char1Block.includes('林二：海水真蓝'));
  assert.ok(!char1Block.includes('三天前的旧帖'));
  assert.ok(!char1Block.includes('只有林二评论的帖子'));
  assert.equal((char1Block.match(/昨天去了海边/g) || []).length, 1);

  const char2Block = buildPrivateMomentContext(db, {
    characterId: char2,
    characterName: '林二',
    userName: '测试员',
  });
  assert.ok(char2Block.includes('只有林二评论的帖子'));

  const char3 = Number(db.prepare(
    `INSERT INTO characters (name, display_name, base_prompt) VALUES ('char3', '林三', '旅客三')`
  ).run().lastInsertRowid);
  assert.equal(buildPrivateMomentContext(db, {
    characterId: char3,
    characterName: '林三',
    userName: '测试员',
  }), null);

  db.prepare(`
    INSERT INTO mailbox_letters
      (character_id, direction, content, content_short, reply_content, status, created_at, replied_at)
    VALUES
      (?, 'char_to_user', '十五天前的来信', '短摘要', '十五天前的回信', 'completed', datetime('now', '-15 days'), datetime('now', '-15 days')),
      (?, 'char_to_user', '一个多月前的来信', '旧摘要', '一个多月前的回信', 'completed', datetime('now', '-35 days'), datetime('now', '-35 days'))
  `).run(char1, char1);
  const recentLetters = listRecentMailboxLetters(db, { characterId: char1 });
  assert.equal(recentLetters.length, 1);
  assert.ok(recentLetters[0].content.includes('十五天前'));
});
