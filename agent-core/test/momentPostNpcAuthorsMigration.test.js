import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { migrateMomentPostNpcAuthors } = await import('../src/db/index.js');

config.dbPath = ':memory:';

test('old moment_posts (NOT NULL character_id) rebuilds in place and keeps posts, comments, likes', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // 老库形态：character_id NOT NULL，没有 npc_id
  db.exec(`
    CREATE TABLE characters (id INTEGER PRIMARY KEY AUTOINCREMENT, display_name TEXT DEFAULT '');
    CREATE TABLE town_npcs (id INTEGER PRIMARY KEY AUTOINCREMENT, display_name TEXT DEFAULT '');
    CREATE TABLE moment_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      images TEXT DEFAULT '[]',
      prompt TEXT,
      style TEXT,
      resolution TEXT DEFAULT '1600x1200',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','generating','done','failed')),
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE moment_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES moment_posts(id) ON DELETE CASCADE,
      author_type TEXT NOT NULL CHECK(author_type IN ('user','character')),
      author_id INTEGER,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE moment_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES moment_posts(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id)
    );
    INSERT INTO characters (display_name) VALUES ('林小姐');
    INSERT INTO town_npcs (display_name) VALUES ('茶娘阿圆');
    INSERT INTO moment_posts (character_id, content, status) VALUES (1, '老帖', 'done');
    INSERT INTO moment_comments (post_id, author_type, content) VALUES (1, 'user', '沙发！');
    INSERT INTO moment_likes (post_id) VALUES (1);
  `);

  migrateMomentPostNpcAuthors(db);

  // 旧帖与关联数据无损
  const post = db.prepare(`SELECT * FROM moment_posts WHERE id = 1`).get();
  assert.equal(post.character_id, 1);
  assert.equal(post.npc_id, null);
  assert.equal(post.content, '老帖');
  assert.equal(db.prepare(`SELECT count(*) n FROM moment_comments`).get().n, 1);
  assert.equal(db.prepare(`SELECT count(*) n FROM moment_likes`).get().n, 1);

  // 新形态生效：镇民作者可写、双作者互斥
  db.prepare(`INSERT INTO moment_posts (character_id, npc_id, content, status) VALUES (NULL, 1, '镇民的帖子', 'done')`).run();
  const npcPost = db.prepare(`SELECT * FROM moment_posts WHERE npc_id = 1`).get();
  assert.equal(npcPost.content, '镇民的帖子');
  assert.throws(() => {
    db.prepare(`INSERT INTO moment_posts (character_id, npc_id, content) VALUES (1, 1, 'both')`).run();
  }, 'XOR check must reject dual authors');

  // 评论/点赞的外键在重建后仍指向新表（级联删除可用）
  db.prepare(`DELETE FROM moment_posts WHERE id = 1`).run();
  assert.equal(db.prepare(`SELECT count(*) n FROM moment_comments`).get().n, 0, 'comment cascade should survive the rebuild');
  db.close();
});
