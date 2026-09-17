/**
 * 三元组语料分流（方案 A）的启动补嵌：分流前的存量三元组 embedding_profile 为空、向量躺在
 * 共享语料 memory_triples_v1 里；查询侧按当前嵌入指纹去找 memory_triples_<指纹>，
 * 不补嵌的话回退/换模型那天三元组联想会静默失效。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { backfillTriplesWithoutEmbeddingProfile } from '../src/services/memory/memoryRepository.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_triples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      subject_text TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object_text TEXT NOT NULL,
      valid_from DATETIME,
      valid_to DATETIME,
      embedding_profile TEXT,
      embedding_state TEXT NOT NULL DEFAULT 'disabled',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memory_index_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      memory_id TEXT,
      profile TEXT,
      priority INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const insert = db.prepare(`INSERT INTO memory_triples(memory_id, subject_text, predicate, object_text, valid_from, valid_to, embedding_profile, embedding_state) VALUES (?, ?, ?, ?, '2026-08-01 00:00:00', ?, ?, ?)`);
  insert.run('mem_1', '芽衣', '照顾', '琪亚娜', null, null, 'indexed');
  insert.run('mem_2', '琪亚娜', '讨厌', '香菜', null, 'abc123', 'indexed');
  insert.run('mem_3', '琪亚娜', '怕', '黑', '2026-08-02 00:00:00', null, 'indexed');
  return db;
}

test('启动补嵌：只把没有指纹的现行三元组放回 pending 并回队重嵌', () => {
  const db = createDb();
  try {
    const queued = backfillTriplesWithoutEmbeddingProfile(db);
    assert.equal(queued, 1);

    const rows = db.prepare(`SELECT id, embedding_profile, embedding_state FROM memory_triples ORDER BY id`).all();
    assert.equal(rows[0].embedding_state, 'pending');
    // 已失效（valid_to 非空）的存量行不补嵌：现行查询不联想不到它们
    assert.equal(rows[1].embedding_state, 'indexed');
    assert.equal(rows[1].embedding_profile, 'abc123');
    assert.equal(rows[2].embedding_state, 'indexed');

    const jobs = db.prepare(`SELECT job_type, memory_id, status FROM memory_index_jobs`).all();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].job_type, 'triple_upsert');
    assert.equal(jobs[0].memory_id, 'trip_1');
    assert.equal(jobs[0].status, 'pending');

    // 重复启动不重复入队（任务按 job_type + memory_id 去重）
    assert.equal(backfillTriplesWithoutEmbeddingProfile(db), 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM memory_index_jobs`).get().count, 1);
  } finally {
    db.close();
  }
});
