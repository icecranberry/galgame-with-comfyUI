import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { seedDefaultWorldSetting } from '../src/db/index.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE world_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    is_active INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  return db;
}

test('空表时补一套默认激活世界观', () => {
  const db = createDb();
  seedDefaultWorldSetting(db);
  const row = db.prepare(`SELECT name, content, is_active FROM world_settings`).get();
  assert.equal(row.name, '默认世界观');
  assert.equal(row.content, '');
  assert.equal(row.is_active, 1);
});

test('已有世界观时不重复插入（idempotent）', () => {
  const db = createDb();
  db.prepare(`INSERT INTO world_settings (name, content, is_active, sort_order) VALUES ('我的世界', '内容', 1, 0)`).run();
  seedDefaultWorldSetting(db);
  const rows = db.prepare(`SELECT id, name FROM world_settings`).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '我的世界');
});
