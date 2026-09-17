/**
 * 索引任务的失败自动重试：向量服务没起来、内置嵌入服务临时 5xx、远端限流这类都是可恢复的，
 * 此前 memory_index_jobs 连 attempts 列都没有，一次失败就永久 failed，只能人工点「重试失败任务」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { MAX_INDEX_ATTEMPTS, nextIndexJobStatus } from '../src/services/memory/memoryRepository.js';
import { migrateChatMemoryV2Schema } from '../src/db/index.js';

test('nextIndexJobStatus：未到上限回 pending 自动重试，到上限才落 failed', () => {
  assert.equal(MAX_INDEX_ATTEMPTS, 3);
  assert.equal(nextIndexJobStatus(0), 'pending');
  assert.equal(nextIndexJobStatus(1), 'pending');
  assert.equal(nextIndexJobStatus(2), 'failed');
  // 越界/脏数据不应导致任务卡在 pending 无限重试
  assert.equal(nextIndexJobStatus(3), 'failed');
  assert.equal(nextIndexJobStatus(99), 'failed');
  // attempts 为空（存量行 ALTER 补列后为 0，但 job 对象可能没带上这个字段）
  assert.equal(nextIndexJobStatus(undefined), 'pending');
  assert.equal(nextIndexJobStatus(null), 'pending');
  assert.equal(nextIndexJobStatus('0'), 'pending');
  assert.equal(nextIndexJobStatus('2'), 'failed');
});

test('迁移：memory_index_jobs 补齐 attempts 列（存量库走 ALTER，全新库走 CREATE）', () => {
  // V1 终态的最小库形态：memory_fragments + system_settings 即可让 V2 迁移跑起来
  const createV1Db = (withAttempts) => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE system_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE memory_fragments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT,
        source_msg_id INTEGER,
        fragment_type TEXT NOT NULL DEFAULT 'fact',
        content TEXT NOT NULL,
        entities TEXT DEFAULT '[]',
        chroma_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // 模拟存量库：已有 memory_index_jobs，但没有 attempts 列
    db.exec(`CREATE TABLE memory_index_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      memory_id TEXT,
      profile TEXT,
      priority INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.prepare(`INSERT INTO memory_index_jobs(job_type, memory_id, status) VALUES ('upsert', 'mem_old', 'failed')`).run();
    assert.equal(withAttempts, false);
    return db;
  };

  const db = createV1Db(false);
  try {
    migrateChatMemoryV2Schema(db);
    const columns = db.prepare(`PRAGMA table_info(memory_index_jobs)`).all().map(row => row.name);
    assert.ok(columns.includes('attempts'), 'ALTER 后应有 attempts 列');
    // 存量行的默认值必须是 0，否则老库里的任务一启动就"用光"重试次数
    assert.equal(db.prepare(`SELECT attempts FROM memory_index_jobs WHERE memory_id = 'mem_old'`).get().attempts, 0);
    // 幂等：再跑一次不应报错
    migrateChatMemoryV2Schema(db);
  } finally {
    db.close();
  }
});
