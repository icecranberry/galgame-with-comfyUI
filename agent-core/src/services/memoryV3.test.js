import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { buildMemoryCurationPrompt } from './memoryExtractor.js';
import { normalizeMemory, normalizeMemoryEntities, retrievalText, upsertMemoryEntity, insertMemoryTriple } from './memory/memoryRepository.js';

test('normalizeMemory 解析 v3 可选字段并钳制范围', () => {
  const memory = normalizeMemory({
    memoryType: 'knowledge',
    subject: 'user',
    judgment: '她不吃香菜',
    reasoning: '聊天中多次提到',
    tags: ['饮食'],
    keywords: ['香菜', '挑食', ' 香菜 ', '香菜'],
    perspectives: ['饮食习惯', '童年', '饮食习惯'],
    episodicNote: '2026-08 聊天时提到小时候被逼吃香菜',
    semanticNote: '她不吃香菜，源于童年经历',
    importance: 9,
    entities: [{ name: '香菜', role: 'object' }, '公司', { name: '', role: 'subject' }],
    triple: { subject: '她', predicate: '讨厌', object: '香菜' },
  });
  assert.deepEqual(memory.keywords, ['香菜', '挑食']);
  assert.deepEqual(memory.perspectives, ['饮食习惯', '童年']);
  assert.equal(memory.importance, 5);
  assert.deepEqual(memory.entities, [{ name: '香菜', role: 'object' }, { name: '公司', role: 'mention' }]);
  assert.deepEqual(memory.triple, { subject: '她', predicate: '讨厌', object: '香菜' });
});

test('normalizeMemory 缺失 v3 字段时降级为 v2 形态', () => {
  const memory = normalizeMemory({ memoryType: 'knowledge', subject: 'user', judgment: '她不吃香菜', tags: ['饮食'] });
  assert.deepEqual(memory.keywords, []);
  assert.deepEqual(memory.perspectives, []);
  assert.deepEqual(memory.entities, []);
  assert.equal(memory.triple, null);
  assert.equal(memory.importance, 3);
  assert.equal(memory.semanticNote, '');
  assert.equal(memory.episodicNote, '');
});

test('normalizeMemory 拒绝畸形三元组与未知实体角色', () => {
  const memory = normalizeMemory({
    judgment: '她不吃香菜',
    tags: ['饮食'],
    triple: { subject: '她' },
    entities: [{ name: '香菜', role: 'boss' }],
  });
  assert.equal(memory.triple, null);
  assert.deepEqual(memory.entities, [{ name: '香菜', role: 'mention' }]);
});

test('normalizeMemory 对新增字段执行敏感信息扫描', () => {
  assert.throws(() => normalizeMemory({
    judgment: '她的账号信息',
    tags: ['账号'],
    semanticNote: '密码： abc123456',
  }), /敏感凭据/);
});

test('normalizeMemoryEntities 兼容字符串数组与畸形条目', () => {
  assert.deepEqual(normalizeMemoryEntities(['香菜', { name: '公司', role: 'subject' }, null, 42]), [
    { name: '香菜', role: 'mention' },
    { name: '公司', role: 'subject' },
  ]);
});

test('retrievalText 对存量记忆回退 v2 文本', () => {
  const legacy = { judgment: '她不吃香菜', reasoning: '对话依据', tags: '["饮食"]', keywords: '[]', perspectives: '[]', episodic_note: '' };
  assert.equal(retrievalText(legacy), '她不吃香菜\n对话依据\n饮食');
});

test('retrievalText 组合 MMS 检索单元字段且排除 reasoning/semantic_note', () => {
  const row = {
    judgment: '她不吃香菜',
    reasoning: '对话依据',
    tags: '["饮食"]',
    keywords: '["香菜","挑食"]',
    perspectives: '["饮食习惯"]',
    episodic_note: '小时候被逼吃',
    semantic_note: '她不吃香菜',
  };
  assert.equal(retrievalText(row), '她不吃香菜\n香菜 挑食\n饮食习惯\n小时候被逼吃');
});

function createEntityDb() {
  const db = new Database(':memory:');
  db.prepare(`CREATE TABLE memory_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    aliases TEXT NOT NULL DEFAULT '[]',
    mention_count INTEGER NOT NULL DEFAULT 0,
    embedding_state TEXT NOT NULL DEFAULT 'disabled',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();
  db.prepare(`CREATE TABLE memory_entity_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'mention',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(memory_id, entity_id, role)
  )`).run();
  db.prepare(`CREATE TABLE memory_triples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    subject_entity_id INTEGER,
    subject_text TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object_entity_id INTEGER,
    object_text TEXT NOT NULL,
    event_time DATETIME,
    valid_from DATETIME,
    valid_to DATETIME,
    embedding_state TEXT NOT NULL DEFAULT 'disabled',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();
  return db;
}

test('upsertMemoryEntity 幂等计数并拒绝过短名字', () => {
  const db = createEntityDb();
  try {
    const first = upsertMemoryEntity(db, '香菜');
    const second = upsertMemoryEntity(db, ' 香菜 ');
    assert.equal(first, second);
    assert.equal(db.prepare(`SELECT mention_count AS count FROM memory_entities WHERE name = '香菜'`).get().count, 2);
    assert.equal(upsertMemoryEntity(db, '猫'), null);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM memory_entities`).get().count, 1);
  } finally {
    db.close();
  }
});

test('insertMemoryTriple 关联已存在实体并记录事件时间', () => {
  const db = createEntityDb();
  try {
    const entityId = upsertMemoryEntity(db, '香菜');
    insertMemoryTriple(db, {
      memoryId: 'mem_test_1',
      triple: { subject: '她', predicate: '讨厌', object: '香菜' },
      eventTime: '2026-08-15 10:00:00',
    });
    const triple = db.prepare(`SELECT * FROM memory_triples WHERE memory_id = 'mem_test_1'`).get();
    assert.equal(triple.subject_text, '她');
    assert.equal(triple.subject_entity_id, null);
    assert.equal(triple.object_entity_id, entityId);
    assert.equal(triple.event_time, '2026-08-15 10:00:00');
    assert.ok(triple.valid_from);
    assert.equal(triple.valid_to, null);
  } finally {
    db.close();
  }
});

test('curation prompt v3 含扩展字段说明与时间窗口', () => {
  const prompt = buildMemoryCurationPrompt({ transcript: '她说她不吃香菜', related: [], timeRange: '2026-08-01 ~ 2026-08-15', v3: true });
  assert.ok(prompt.includes('keywords'));
  assert.ok(prompt.includes('semanticNote'));
  assert.ok(prompt.includes('episodicNote'));
  assert.ok(prompt.includes('triple'));
  assert.ok(prompt.includes('<window_time>'));
  assert.ok(prompt.includes('2026-08-01 ~ 2026-08-15'));
  assert.ok(!prompt.includes('不输出 importance'));
});

test('curation prompt v2 回滚分支保持原约束', () => {
  const prompt = buildMemoryCurationPrompt({ transcript: '她说她不吃香菜', related: [], v3: false });
  assert.ok(prompt.includes('不输出 importance'));
  assert.ok(!prompt.includes('semanticNote'));
  assert.ok(!prompt.includes('<window_time>'));
});
