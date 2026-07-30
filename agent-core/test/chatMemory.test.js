import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { getDb, closeDb } from '../src/db/index.js';
import { normalizeMemorySettings, getEmbeddingProfile } from '../src/services/memory/memoryConfig.js';
import { validateMemoryAction, applyMemoryActions, rollbackMemoriesFromRawId } from '../src/services/memory/memoryRepository.js';
import { textSearch } from '../src/services/memorySearch.js';
import { parseMemoryActions } from '../src/services/memoryExtractor.js';

config.dbPath = ':memory:';

function createAction(judgment, tags, extra = {}) {
  return {
    action: 'create', sourceMemoryIds: [],
    memory: { memoryType: 'knowledge', subject: 'user', judgment, reasoning: '用户在对话中明确表达', tags, ...extra },
  };
}

test('memory settings support text-only mode and stable embedding profile fingerprint', () => {
  const textOnly = normalizeMemorySettings({ embedding: { enabled: false } });
  assert.equal(getEmbeddingProfile(textOnly), null);
  const hybrid = normalizeMemorySettings({ embedding: { enabled: true, provider: 'openai', baseURL: 'https://example.com/v1/', model: 'embed-v1', dimensions: 768 } });
  assert.equal(hybrid.embedding.provider, 'openai');
  assert.match(getEmbeddingProfile(hybrid).corpus, /^memory_v2_[a-f0-9]{16}$/);
  assert.equal(hybrid.embedding.baseURL, 'https://example.com/v1');
  const rerankerOnlyUpdate = normalizeMemorySettings({ reranker: { enabled: true, provider: 'cohere', baseURL: 'https://example.com/v1', model: 'rerank-v1' } }, hybrid);
  assert.equal(rerankerOnlyUpdate.reranker.provider, 'cohere');
  assert.equal(rerankerOnlyUpdate.embedding.dimensions, 768);
  assert.equal(getEmbeddingProfile(rerankerOnlyUpdate).fingerprint, getEmbeddingProfile(hybrid).fingerprint);
});

test('PAI-style actions enforce create/update/merge source cardinality', () => {
  assert.doesNotThrow(() => validateMemoryAction(createAction('用户喜欢草莓甜点', ['草莓', '甜点'])));
  assert.throws(() => validateMemoryAction({ ...createAction('x', ['x']), action: 'update', sourceMemoryIds: [] }), /一条旧记忆/);
  assert.throws(() => validateMemoryAction({ ...createAction('x', ['x']), action: 'merge', sourceMemoryIds: ['one'] }), /至少两条/);
  assert.throws(() => validateMemoryAction({ ...createAction('x', []), memory: { memoryType: 'knowledge', judgment: 'x', tags: [] } }), /至少需要一个/);
  assert.throws(() => validateMemoryAction(createAction('用户的 API key: sk-abcdefghijklmnop', ['凭据'])), /敏感凭据/);
});

test('curation response parser accepts empty actions and strips JSON fences', () => {
  assert.deepEqual(parseMemoryActions('```json\n{"memoryActions":[]}\n```'), []);
  assert.throws(() => parseMemoryActions('{"memoryActions":{}}'), /必须是数组/);
});

test('SQLite remains authoritative: text recall, immutable update, and rollback work without embeddings', () => {
  const db = getDb();
  db.prepare(`INSERT INTO raw_messages(id, conversation_id, role, content) VALUES (1, 'char_test', 'user', '我喜欢草莓甜点')`).run();
  db.prepare(`INSERT INTO raw_messages(id, conversation_id, role, content) VALUES (2, 'char_test', 'assistant', '记住了')`).run();
  const [created] = applyMemoryActions({ conversationId: 'char_test', sourceRawStartId: 1, sourceRawEndId: 2, actions: [createAction('用户喜欢草莓口味的甜点', ['草莓', '甜点'])] });
  assert.ok(created.memory_id);
  const recalled = textSearch('草莓甜点', 'char_test', 5);
  assert.equal(recalled[0].memory_id, created.memory_id);
  assert.ok(recalled[0].sources.includes('fts') || recalled[0].sources.includes('ngram'));

  db.prepare(`INSERT INTO raw_messages(id, conversation_id, role, content) VALUES (3, 'char_test', 'user', '现在更喜欢抹茶')`).run();
  db.prepare(`INSERT INTO raw_messages(id, conversation_id, role, content) VALUES (4, 'char_test', 'assistant', '更新了')`).run();
  const [updated] = applyMemoryActions({
    conversationId: 'char_test', sourceRawStartId: 3, sourceRawEndId: 4,
    actions: [{ action: 'update', sourceMemoryIds: [created.memory_id], memory: { memoryType: 'knowledge', subject: 'user', judgment: '用户现在更喜欢抹茶口味的甜点', reasoning: '用户明确修正偏好', tags: ['抹茶', '甜点'] } }],
  });
  assert.equal(db.prepare(`SELECT status FROM memory_fragments WHERE memory_id = ?`).pluck().get(created.memory_id), 'superseded');
  assert.equal(db.prepare(`SELECT status FROM memory_fragments WHERE memory_id = ?`).pluck().get(updated.memory_id), 'active');
  assert.equal(db.prepare(`SELECT COUNT(*) FROM memory_index_jobs WHERE job_type = 'delete' AND status = 'pending'`).pluck().get(), 0);

  rollbackMemoriesFromRawId('char_test', 3);
  assert.equal(db.prepare(`SELECT status FROM memory_fragments WHERE memory_id = ?`).pluck().get(created.memory_id), 'active');
  assert.equal(db.prepare(`SELECT status FROM memory_fragments WHERE memory_id = ?`).pluck().get(updated.memory_id), 'deleted');
  closeDb();
});
