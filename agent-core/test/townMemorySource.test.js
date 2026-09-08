import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => {
  if (String(url).endsWith('/object_info')) return { ok: true, json: async () => ({}) };
  throw new Error('Network forbidden in delivery fixture');
};
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const { applyMemoryActions } = await import('../src/services/memory/memoryRepository.js');

test('正式记忆仓库：小镇来源去重不污染正文，旧内容去重保持兼容', t => {
  const db = getDb(); t.after(closeDb);
  const common = { conversationId: 'char_1', sourceRawStartId: null, sourceRawEndId: null,
    sourceMessageId: null, actions: [{ action: 'create', memory: { memoryType: 'event', subject: 'relationship',
      judgment: '今天一起完成了工坊制作。', reasoning: '已结算的共同经历', tags: ['小镇', '工坊'] } }] };
  assert.equal(applyMemoryActions({ ...common, dedupeKey: 'event-a' }).length, 1);
  assert.equal(applyMemoryActions({ ...common, dedupeKey: 'event-a' }).length, 0);
  assert.equal(applyMemoryActions({ ...common, dedupeKey: 'event-b' }).length, 1);
  assert.equal(applyMemoryActions(common).length, 1);
  assert.equal(applyMemoryActions(common).length, 0);
  const rows = db.prepare('SELECT judgment, content_hash, source_msg_id FROM memory_fragments').all();
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(row => row.content_hash)).size, 3);
  assert.ok(rows.every(row => row.judgment === common.actions[0].memory.judgment && row.source_msg_id === null));
  assert.throws(() => applyMemoryActions({ ...common, dedupeKey: 12 }), /来源标识/);
  assert.equal(db.prepare('SELECT count(*) n FROM messages').get().n, 0);
});
