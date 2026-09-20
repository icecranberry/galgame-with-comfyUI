import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { getDb, closeDb } = await import('../src/db/index.js');
const { buildGroupUserMomentContext } = await import('../src/services/privateMomentContext.js');

test('群聊用户朋友圈按群成员评论和一天窗口注入，且不包含评论区', async t => {
  t.after(() => closeDb());
  const db = getDb();

  const memberA = Number(db.prepare(
    `INSERT INTO characters (name, display_name, base_prompt) VALUES ('memberA', '群员一', '旅客一')`
  ).run().lastInsertRowid);
  const memberB = Number(db.prepare(
    `INSERT INTO characters (name, display_name, base_prompt) VALUES ('memberB', '群员二', '旅客二')`
  ).run().lastInsertRowid);
  const outsider = Number(db.prepare(
    `INSERT INTO characters (name, display_name, base_prompt) VALUES ('outsider', '路人', '旅客三')`
  ).run().lastInsertRowid);

  const eligible = db.prepare(`
    INSERT INTO moment_posts (character_id, npc_id, content, status, created_at)
    VALUES (NULL, NULL, '群聊里的新鲜动态', 'done', datetime('now', '-2 hours'))
  `).run();
  db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, author_id, content) VALUES (?, 'character', ?, '群员评论')`
  ).run(Number(eligible.lastInsertRowid), memberA);

  const stale = db.prepare(`
    INSERT INTO moment_posts (character_id, npc_id, content, status, created_at)
    VALUES (NULL, NULL, '超过一天的动态', 'done', datetime('now', '-25 hours'))
  `).run();
  db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, author_id, content) VALUES (?, 'character', ?, '旧评论')`
  ).run(Number(stale.lastInsertRowid), memberB);

  const outsiderOnly = db.prepare(`
    INSERT INTO moment_posts (character_id, npc_id, content, status, created_at)
    VALUES (NULL, NULL, '只有群外角色评论的动态', 'done', datetime('now', '-1 hour'))
  `).run();
  db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, author_id, content) VALUES (?, 'character', ?, '路人评论')`
  ).run(Number(outsiderOnly.lastInsertRowid), outsider);

  const context = buildGroupUserMomentContext(db, {
    memberIds: [memberA, memberB],
    userName: '测试员',
  });

  assert.equal(context.posts.length, 1);
  assert.equal(context.posts[0].content, '群聊里的新鲜动态');
  assert.deepEqual(context.lines, ['「测试员」发了朋友圈：「群聊里的新鲜动态」']);
  assert.ok(!context.lines.join('\n').includes('群员评论'));
  assert.ok(!context.lines.join('\n').includes('超过一天的动态'));
  assert.ok(!context.lines.join('\n').includes('只有群外角色评论的动态'));

  assert.deepEqual(
    buildGroupUserMomentContext(db, { memberIds: [], userName: '测试员' }).posts,
    []
  );
});
