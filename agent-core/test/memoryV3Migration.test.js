import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateChatMemoryV3Schema } from '../src/db/index.js';

// 复刻 migrateChatMemoryV2Schema 完成后的库形态（v2 终态），用于验证 v3 迁移的升级路径
function createV2Db() {
  const db = new Database(':memory:');
  db.prepare(`CREATE TABLE memory_fragments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    source_msg_id INTEGER,
    source_raw_start_id INTEGER,
    source_raw_end_id INTEGER,
    fragment_type TEXT NOT NULL CHECK(fragment_type IN ('fact','preference','emotion')),
    content TEXT NOT NULL,
    entities TEXT DEFAULT '[]',
    chroma_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    memory_id TEXT,
    memory_type TEXT NOT NULL DEFAULT 'knowledge',
    subject TEXT NOT NULL DEFAULT 'user',
    judgment TEXT NOT NULL DEFAULT '',
    reasoning TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    content_hash TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    embedding_profile TEXT,
    embedding_state TEXT NOT NULL DEFAULT 'disabled',
    embedding_error TEXT,
    updated_at DATETIME
  )`).run();
  db.prepare(`CREATE TABLE memory_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_memory_id TEXT NOT NULL,
    to_memory_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('update','merge','rollback')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();
  db.prepare(`CREATE VIRTUAL TABLE memory_fragments_fts USING fts5(
    judgment, reasoning, tags,
    content='memory_fragments', content_rowid='id'
  )`).run();
  db.prepare(`CREATE TRIGGER memory_fragments_fts_ai AFTER INSERT ON memory_fragments BEGIN
    INSERT INTO memory_fragments_fts(rowid, judgment, reasoning, tags)
    VALUES (new.id, new.judgment, new.reasoning, new.tags);
  END`).run();
  db.prepare(`CREATE TRIGGER memory_fragments_fts_ad AFTER DELETE ON memory_fragments BEGIN
    INSERT INTO memory_fragments_fts(memory_fragments_fts, rowid, judgment, reasoning, tags)
    VALUES ('delete', old.id, old.judgment, old.reasoning, old.tags);
  END`).run();
  db.prepare(`CREATE TRIGGER memory_fragments_fts_au AFTER UPDATE OF judgment, reasoning, tags ON memory_fragments BEGIN
    INSERT INTO memory_fragments_fts(memory_fragments_fts, rowid, judgment, reasoning, tags)
    VALUES ('delete', old.id, old.judgment, old.reasoning, old.tags);
    INSERT INTO memory_fragments_fts(rowid, judgment, reasoning, tags)
    VALUES (new.id, new.judgment, new.reasoning, new.tags);
  END`).run();
  return db;
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
}

test('v3 迁移：扩列、回填 valid_from、建实体/三元组表、FTS 六列重建', () => {
  const db = createV2Db();
  try {
    db.prepare(`INSERT INTO memory_fragments(conversation_id, content, fragment_type, memory_id, judgment, tags, status, updated_at)
      VALUES ('conv_1', '她不吃香菜', 'fact', 'mem_legacy_1', '她不吃香菜', '["饮食"]', 'active', '2026-07-01 10:00:00')`).run();

    migrateChatMemoryV3Schema(db);

    const columns = tableColumns(db, 'memory_fragments');
    for (const name of ['keywords', 'perspectives', 'episodic_note', 'semantic_note', 'event_time', 'valid_from', 'valid_to', 'importance', 'strength', 'last_reinforced_at', 'retrieval_count']) {
      assert.ok(columns.has(name), `缺少新列 ${name}`);
    }
    assert.ok(tableColumns(db, 'memory_relations').has('relation_meta'));
    for (const table of ['memory_entities', 'memory_entity_links', 'memory_triples', 'memory_consolidation_jobs', 'portrait_suggestions']) {
      assert.ok(tableColumns(db, table).size > 0, `缺少新表 ${table}`);
    }

    // 存量行 valid_from 回填为 updated_at
    const legacy = db.prepare(`SELECT valid_from, valid_to, importance, strength FROM memory_fragments WHERE memory_id = 'mem_legacy_1'`).get();
    assert.equal(legacy.valid_from, '2026-07-01 10:00:00');
    assert.equal(legacy.valid_to, null);
    assert.equal(legacy.importance, 3);

    // FTS 升为六列且 rebuild 后行数一致，旧内容仍可检索
    //（unicode61 把整段中文作为单 token，需按完整 token 匹配）
    const ftsSql = db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'memory_fragments_fts'`).get().sql;
    assert.match(ftsSql, /keywords/i);
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM memory_fragments_fts`).get().count,
      db.prepare(`SELECT COUNT(*) AS count FROM memory_fragments`).get().count,
    );
    const hit = db.prepare(`SELECT rowid FROM memory_fragments_fts WHERE memory_fragments_fts MATCH '她不吃香菜'`).all();
    assert.equal(hit.length, 1);

    // 新触发器覆盖 v3 列：新插入行带 keywords，可被关键词检索命中
    db.prepare(`INSERT INTO memory_fragments(conversation_id, content, fragment_type, memory_id, judgment, tags, status, keywords, perspectives, episodic_note)
      VALUES ('conv_1', '她讨厌吃胡萝卜', 'fact', 'mem_new_1', '她讨厌吃胡萝卜', '["饮食"]', 'active', '["胡萝卜"]', '["饮食习惯"]', '上周聊天提到')`).run();
    const keywordHit = db.prepare(`SELECT rowid FROM memory_fragments_fts WHERE memory_fragments_fts MATCH '胡萝卜'`).all();
    assert.equal(keywordHit.length, 1);

    // 幂等：重复执行不报错、不重复生效
    migrateChatMemoryV3Schema(db);
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM memory_fragments_fts`).get().count,
      db.prepare(`SELECT COUNT(*) AS count FROM memory_fragments`).get().count,
    );
  } finally {
    db.close();
  }
});

test('v3 迁移：全新库 FTS 表缺失时安全跳过重建', () => {
  const db = new Database(':memory:');
  try {
    db.prepare(`CREATE TABLE memory_fragments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      judgment TEXT NOT NULL DEFAULT '',
      reasoning TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      updated_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
    db.prepare(`CREATE TABLE memory_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_memory_id TEXT NOT NULL,
      to_memory_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
    migrateChatMemoryV3Schema(db);
    assert.equal(db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'memory_fragments_fts'`).get(), undefined);
  } finally {
    db.close();
  }
});
