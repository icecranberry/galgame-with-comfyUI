import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { migratePinSchema } = await import('../src/db/index.js');

// 老库形态：characters 表没有 pinned 列（置顶功能合入前的存档）
function legacyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      display_name TEXT,
      avatar_path TEXT,
      handwriting_font TEXT DEFAULT ''
    );
  `);
  db.prepare(`INSERT INTO characters (name, display_name) VALUES (?, ?)`).run('ali', '阿离');
  db.prepare(`INSERT INTO characters (name, display_name) VALUES (?, ?)`).run('bozi', '波子');
  return db;
}

test('老库补出 characters.pinned 列，默认 0，既有行不丢', () => {
  const db = legacyDb();

  migratePinSchema(db);

  const cols = db.prepare(`PRAGMA table_info(characters)`).all();
  assert.equal(cols.filter(c => c.name === 'pinned').length, 1);
  const rows = db.prepare(`SELECT id, name, display_name, pinned FROM characters ORDER BY id`).all();
  assert.equal(rows.length, 2, '加列不该动行数');
  assert.deepEqual(rows.map(r => [r.name, r.display_name]), [['ali', '阿离'], ['bozi', '波子']]);
  assert.deepEqual(rows.map(r => r.pinned), [0, 0], '新列默认未置顶');

  db.close();
});

test('重复迁移幂等：不报错、不再 ALTER、已置顶状态保留', () => {
  const db = legacyDb();

  migratePinSchema(db);
  db.prepare(`UPDATE characters SET pinned = 1 WHERE name = 'bozi'`).run();
  migratePinSchema(db);
  migratePinSchema(db);

  const cols = db.prepare(`PRAGMA table_info(characters)`).all();
  assert.equal(cols.filter(c => c.name === 'pinned').length, 1);
  assert.deepEqual(
    db.prepare(`SELECT name, pinned FROM characters ORDER BY id`).all().map(r => [r.name, r.pinned]),
    [['ali', 0], ['bozi', 1]]
  );

  db.close();
});

test('表不存在时不抛错（迁移链里其它步骤先失败的兜底）', () => {
  const db = new Database(':memory:');
  assert.doesNotThrow(() => migratePinSchema(db));
  db.close();
});
