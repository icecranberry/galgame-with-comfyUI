import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { getCheckpointHistory } from '../src/services/contextAssembler.js';

/**
 * 创建临时内存 DB 并初始化 rolling_summaries 和 raw_messages 表
 */
function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS rolling_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      start_msg_id INTEGER NOT NULL,
      end_msg_id INTEGER NOT NULL,
      summary TEXT NOT NULL,
      checkpoint_version INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS raw_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_summaries_conv ON rolling_summaries(conversation_id, end_msg_id);
    CREATE INDEX IF NOT EXISTS idx_raw_messages_conv ON raw_messages(conversation_id, created_at);
  `);
  return db;
}

describe('checkpoint boundary', () => {
  const convId = 'char_42';

  describe('getCheckpointHistory', () => {
    it('无摘要时应返回所有 history', () => {
      const db = createTestDb();
      for (let i = 0; i < 5; i++) {
        db.prepare(`INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, ?, ?)`)
          .run(convId, i % 2 === 0 ? 'user' : 'assistant', `msg${i}`);
      }
      const { checkpoint, history } = getCheckpointHistory(db, convId);
      assert.equal(checkpoint, undefined);
      assert.equal(history.length, 5);
    });

    it('有摘要时应返回之后的消息', () => {
      const db = createTestDb();
      for (let i = 0; i < 25; i++) {
        db.prepare(`INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, ?, ?)`)
          .run(convId, i % 2 === 0 ? 'user' : 'assistant', `msg${i}`);
      }
      // 摘要覆盖前 20 条（end_msg_id=20）
      db.prepare(`INSERT INTO rolling_summaries (conversation_id, start_msg_id, end_msg_id, summary) VALUES (?, 1, 20, ?)`)
        .run(convId, '涵盖前20条的摘要');

      const { checkpoint, history } = getCheckpointHistory(db, convId);
      assert.ok(checkpoint);
      assert.equal(checkpoint.end_msg_id, 20);
      // 应返回 21..25 共 5 条（id > 20）
      assert.equal(history.length, 5);
      // history 内容应是 msg20..msg24（id 21-25）
      assert.ok(history[0].content.includes('msg20') || history[0].content.includes('msg20'));
    });

    it('多个摘要时应取 end_msg_id 最大的', () => {
      const db = createTestDb();
      for (let i = 0; i < 45; i++) {
        db.prepare(`INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, ?, ?)`)
          .run(convId, i % 2 === 0 ? 'user' : 'assistant', `msg${i}`);
      }
      db.prepare(`INSERT INTO rolling_summaries (conversation_id, start_msg_id, end_msg_id, summary) VALUES (?, 1, 20, ?)`)
        .run(convId, '摘要1');
      db.prepare(`INSERT INTO rolling_summaries (conversation_id, start_msg_id, end_msg_id, summary) VALUES (?, 21, 40, ?)`)
        .run(convId, '摘要2');

      const { checkpoint, history } = getCheckpointHistory(db, convId);
      assert.equal(checkpoint.end_msg_id, 40);
      // id > 40 的消息：41-45 共 5 条
      assert.equal(history.length, 5);
    });

    it('end_msg_id=0 的摘要应被忽略', () => {
      const db = createTestDb();
      for (let i = 0; i < 5; i++) {
        db.prepare(`INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, ?, ?)`)
          .run(convId, i % 2 === 0 ? 'user' : 'assistant', `msg${i}`);
      }
      // 插入 end_msg_id=0 的摘要（异常情况）
      db.prepare(`INSERT INTO rolling_summaries (conversation_id, start_msg_id, end_msg_id, summary) VALUES (?, 0, 0, ?)`)
        .run(convId, '异常摘要');

      const { checkpoint, history } = getCheckpointHistory(db, convId);
      // end_msg_id=0 应被忽略，返回全部 5 条
      assert.equal(checkpoint, undefined);
      assert.equal(history.length, 5);
    });

    it('旧版不精确摘要不得作为 checkpoint 截断历史', () => {
      const db = createTestDb();
      for (let i = 0; i < 21; i++) {
        db.prepare(`INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, ?, ?)`)
          .run(convId, i % 2 === 0 ? 'user' : 'assistant', `msg${i}`);
      }
      // 旧算法可能只摘要前 20 条，却把 end_msg_id 错记为 21。
      db.prepare(`
        INSERT INTO rolling_summaries (
          conversation_id, start_msg_id, end_msg_id, summary, checkpoint_version
        ) VALUES (?, 1, 21, ?, 0)
      `).run(convId, '旧版边界不可信的摘要');

      const { checkpoint, history } = getCheckpointHistory(db, convId);
      assert.equal(checkpoint, undefined);
      assert.equal(history.length, 21);
      assert.equal(history[20].content, 'msg20');
    });

    it('摘要后不足 20 条时正确返回所有剩余', () => {
      const db = createTestDb();
      for (let i = 0; i < 22; i++) {
        db.prepare(`INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, ?, ?)`)
          .run(convId, i % 2 === 0 ? 'user' : 'assistant', `msg${i}`);
      }
      db.prepare(`INSERT INTO rolling_summaries (conversation_id, start_msg_id, end_msg_id, summary) VALUES (?, 1, 20, ?)`)
        .run(convId, '摘要');

      const { history } = getCheckpointHistory(db, convId);
      // 摘要后有 msg21, msg22（共 2 条）
      assert.equal(history.length, 2);
    });

    it('摘要连续失败时只保留最近 80 条，避免上下文无限增长', () => {
      const db = createTestDb();
      for (let i = 0; i < 100; i++) {
        db.prepare(`INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, ?, ?)`)
          .run(convId, i % 2 === 0 ? 'user' : 'assistant', `msg${i}`);
      }
      const { history } = getCheckpointHistory(db, convId);
      assert.equal(history.length, 80);
      assert.equal(history[0].content, 'msg20');
      assert.equal(history[79].content, 'msg99');
    });

    it('不同 conversation 不应互相干扰', () => {
      const db = createTestDb();
      for (let i = 0; i < 10; i++) {
        db.prepare(`INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, ?, ?)`)
          .run('char_1', i % 2 === 0 ? 'user' : 'assistant', `conv1_msg${i}`);
      }
      for (let i = 0; i < 5; i++) {
        db.prepare(`INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, ?, ?)`)
          .run('char_2', i % 2 === 0 ? 'user' : 'assistant', `conv2_msg${i}`);
      }
      db.prepare(`INSERT INTO rolling_summaries (conversation_id, start_msg_id, end_msg_id, summary) VALUES (?, 1, 8, ?)`)
        .run('char_1', 'conv1摘要');

      const { checkpoint: c1 } = getCheckpointHistory(db, 'char_1');
      const { checkpoint: c2 } = getCheckpointHistory(db, 'char_2');

      assert.ok(c1);
      assert.equal(c2, undefined);
    });
  });
});
