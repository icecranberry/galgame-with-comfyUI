import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  computeStrength, pickAnchorTime, HALF_LIFE_DAYS, ARCHIVE_THRESHOLD,
  aggregateRetrievalAudits, decayAndArchiveMemories, scanVectorTombstones,
  findConflictClusters, findGeneralizationGroups, findPortraitSuggestionConversations,
  findBackfillCandidates,
  runConflictResolutionTask, runGeneralizationTask, runPortraitSuggestionTask, runBackfillTask,
  runDecayTask, runTombstoneTask,
} from '../src/services/memory/memoryConsolidation.js';
import { insertGeneralizedMemory } from '../src/services/memory/memoryRepository.js';

// ── 测试库：阶段三涉及的最小表集合 ──

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_fragments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT UNIQUE NOT NULL,
      conversation_id TEXT,
      source_msg_id INTEGER,
      fragment_type TEXT NOT NULL DEFAULT 'fact',
      content TEXT,
      entities TEXT,
      content_hash TEXT,
      memory_type TEXT NOT NULL DEFAULT 'knowledge',
      subject TEXT NOT NULL DEFAULT 'user',
      judgment TEXT NOT NULL,
      reasoning TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      keywords TEXT,
      perspectives TEXT,
      episodic_note TEXT,
      semantic_note TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      event_time DATETIME,
      valid_from DATETIME,
      valid_to DATETIME,
      importance INTEGER NOT NULL DEFAULT 3,
      strength REAL NOT NULL DEFAULT 1.0,
      retrieval_count INTEGER NOT NULL DEFAULT 0,
      last_reinforced_at DATETIME,
      embedding_state TEXT NOT NULL DEFAULT 'disabled',
      embedding_profile TEXT,
      embedding_error TEXT,
      chroma_id TEXT,
      source_raw_start_id INTEGER,
      source_raw_end_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memory_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      aliases TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memory_entity_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'mention'
    );
    CREATE TABLE memory_triples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      subject_text TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object_text TEXT NOT NULL,
      valid_to DATETIME,
      embedding_state TEXT NOT NULL DEFAULT 'disabled',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memory_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_memory_id TEXT,
      to_memory_id TEXT,
      action TEXT,
      relation_meta TEXT
    );
    CREATE TABLE memory_index_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      memory_id TEXT,
      profile TEXT,
      priority INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memory_retrieval_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT,
      query TEXT NOT NULL,
      mode TEXT NOT NULL,
      candidate_sources TEXT NOT NULL DEFAULT '{}',
      memory_ids TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memory_consolidation_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE portrait_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER,
      field TEXT NOT NULL,
      current_value TEXT,
      suggestion TEXT NOT NULL,
      source_memory_ids TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE user_portraits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER,
      trait_type TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(character_id, trait_type, content)
    );
  `);
  return db;
}

function insertFragment(db, { memoryId, type = 'knowledge', importance = 3, judgment = '测试记忆', eventTime = null, lastReinforcedAt = null, retrievalCount = 0, chromaId = null, embeddingState = 'disabled', conversationId = 'char_1', createdAt = null, keywords = null }) {
  db.prepare(`
    INSERT INTO memory_fragments(memory_id, conversation_id, memory_type, subject, judgment, tags, status, event_time, last_reinforced_at, retrieval_count, chroma_id, embedding_state, keywords, importance, created_at, updated_at)
    VALUES (?, ?, ?, 'user', ?, '["测试"]', 'active', ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
  `).run(memoryId, conversationId, type, judgment, eventTime, lastReinforcedAt, retrievalCount, chromaId, embeddingState, keywords, importance, createdAt);
}

function linkEntity(db, memoryId, entityName) {
  const existing = db.prepare(`SELECT id FROM memory_entities WHERE name = ?`).get(entityName);
  const entityId = existing?.id ?? db.prepare(`INSERT INTO memory_entities(name) VALUES (?)`).run(entityName).lastInsertRowid;
  db.prepare(`INSERT INTO memory_entity_links(memory_id, entity_id, role) VALUES (?, ?, 'subject')`).run(memoryId, entityId);
  return entityId;
}

// ── 遗忘曲线纯函数 ──

test('computeStrength：时间越久越弱、召回越多越强、半衰期按类型区分', () => {
  const fresh = computeStrength({ importance: 5, daysSinceAnchor: 0, halfLifeDays: 180 });
  const old = computeStrength({ importance: 5, daysSinceAnchor: 360, halfLifeDays: 180 });
  assert.ok(fresh > old);
  // 召回加成：同参数下有召回的强度更高（对数项）
  const recalled = computeStrength({ importance: 3, daysSinceAnchor: 30, halfLifeDays: 60, retrievalCount: 9 });
  const notRecalled = computeStrength({ importance: 3, daysSinceAnchor: 30, halfLifeDays: 60 });
  assert.ok(recalled > notRecalled);
  // 半衰期差异：event(14d) 衰减远快于 knowledge(180d)
  const eventOld = computeStrength({ importance: 5, daysSinceAnchor: 60, halfLifeDays: HALF_LIFE_DAYS.event });
  const knowledgeOld = computeStrength({ importance: 5, daysSinceAnchor: 60, halfLifeDays: HALF_LIFE_DAYS.knowledge });
  assert.ok(eventOld < knowledgeOld);
  assert.equal(HALF_LIFE_DAYS.event, 14);
  assert.equal(ARCHIVE_THRESHOLD, 0.15);
});

test('pickAnchorTime：取最新时间戳并兼容空格/T 两种分隔', () => {
  const anchor = pickAnchorTime({
    last_reinforced_at: daysAgo(3),
    event_time: daysAgo(40),
    created_at: daysAgo(50),
    updated_at: daysAgo(0.001),  // 刻意排除：非内容写入不应重置衰减锚点
  });
  assert.ok(Math.abs((Date.now() - anchor.getTime()) / 86400000 - 3) < 1);
  assert.equal(pickAnchorTime({}), null);
});

// ── T3 审计聚合 ──

test('aggregateRetrievalAudits：JSON 数组展开统计命中数与最近召回时间', () => {
  const db = createDb();
  insertFragment(db, { memoryId: 'mem_a' });
  insertFragment(db, { memoryId: 'mem_b' });
  db.prepare(`INSERT INTO memory_retrieval_audits(query, mode, memory_ids, created_at) VALUES ('q', 'passive', '["mem_a","mem_b"]', ?)`).run(daysAgo(1));
  db.prepare(`INSERT INTO memory_retrieval_audits(query, mode, memory_ids, created_at) VALUES ('q2', 'passive', '["mem_a"]', ?)`).run(daysAgo(2));
  const count = aggregateRetrievalAudits(db, { sinceDays: 90 });
  assert.equal(count, 2);
  const a = db.prepare(`SELECT retrieval_count, last_reinforced_at FROM memory_fragments WHERE memory_id = 'mem_a'`).get();
  assert.equal(a.retrieval_count, 2);
  assert.ok(a.last_reinforced_at);
  const b = db.prepare(`SELECT retrieval_count FROM memory_fragments WHERE memory_id = 'mem_b'`).get();
  assert.equal(b.retrieval_count, 1);
  db.close();
});

// ── T3 衰减归档 ──

test('decayAndArchiveMemories：新鲜记忆保留、久远低重要度记忆归档且三元组连带失效', () => {
  const db = createDb();
  insertFragment(db, { memoryId: 'mem_fresh', importance: 5, lastReinforcedAt: daysAgo(1), createdAt: daysAgo(1) });
  insertFragment(db, { memoryId: 'mem_old', type: 'event', importance: 2, eventTime: daysAgo(60), chromaId: 'chroma_1', embeddingState: 'indexed', createdAt: daysAgo(60) });
  db.prepare(`INSERT INTO memory_triples(memory_id, subject_text, predicate, object_text, embedding_state) VALUES ('mem_old', '她', '养', '狗', 'indexed')`).run();
  const deleted = [];
  const tripleDeleted = [];
  const result = decayAndArchiveMemories(db, {
    enqueueDelete: (id) => deleted.push(id),
    enqueueTripleDelete: (id) => tripleDeleted.push(id),
  });
  assert.equal(result.scanned, 2);
  assert.deepEqual(result.archived.map(item => item.memoryId), ['mem_old']);
  // 归档明细可解释：含强度构成
  assert.ok(result.archived[0].reason.includes('半衰期 14 天'));
  // 强度写回
  const freshRow = db.prepare(`SELECT strength, status FROM memory_fragments WHERE memory_id = 'mem_fresh'`).get();
  assert.equal(freshRow.status, 'active');
  assert.ok(freshRow.strength > 0.15);
  // 归档记忆出检索通道 + 向量墓碑 + 三元组失效
  const oldRow = db.prepare(`SELECT status FROM memory_fragments WHERE memory_id = 'mem_old'`).get();
  assert.equal(oldRow.status, 'archived');
  assert.deepEqual(deleted, ['mem_old']);
  assert.equal(tripleDeleted.length, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM memory_triples WHERE memory_id = 'mem_old' AND valid_to IS NULL`).get().c, 0);
  db.close();
});

test('runDecayTask 组合：审计聚合 + 衰减一次完成', () => {
  const db = createDb();
  insertFragment(db, { memoryId: 'mem_x', importance: 1, type: 'event', eventTime: daysAgo(90), createdAt: daysAgo(90) });
  const result = runDecayTask({ db, enqueueDelete: () => {}, enqueueTripleDelete: () => {} });
  assert.equal(result.scanned, 1);
  assert.equal(result.archived.length, 1);
  db.close();
});

// ── T6 墓碑扫描 ──

test('scanVectorTombstones：残留向量补发 delete，幂等不重复入队', () => {
  const db = createDb();
  // 已被 update 替代的记忆：chroma_id 还在，且没有任何 delete 任务 → 应补发
  db.prepare(`
    INSERT INTO memory_fragments(memory_id, conversation_id, judgment, tags, status, chroma_id, embedding_state, updated_at)
    VALUES ('mem_sup', 'c1', '旧记忆', '[]', 'superseded', 'chroma_x', 'indexed', CURRENT_TIMESTAMP)
  `).run();
  // 三元组已失效但仍 indexed → 应补发并置 disabled
  db.prepare(`INSERT INTO memory_triples(memory_id, subject_text, predicate, object_text, valid_to, embedding_state) VALUES ('mem_sup', '她', '在', '城南', CURRENT_TIMESTAMP, 'indexed')`).run();
  const deleted = [];
  const tripleDeleted = [];
  const first = scanVectorTombstones(db, { enqueueDelete: id => deleted.push(id), enqueueTripleDelete: id => tripleDeleted.push(id) });
  assert.equal(first.fragments, 1);
  assert.equal(first.triples, 1);
  assert.deepEqual(deleted, ['mem_sup']);
  // 幂等：补一个晚于状态变更的 completed delete 任务后不再入队
  db.prepare(`
    INSERT INTO memory_index_jobs(job_type, memory_id, status, updated_at)
    VALUES ('delete', 'mem_sup', 'completed', CURRENT_TIMESTAMP)
  `).run();
  const second = scanVectorTombstones(db, { enqueueDelete: id => deleted.push(id), enqueueTripleDelete: id => tripleDeleted.push(id) });
  assert.equal(second.fragments, 0);
  assert.equal(deleted.length, 1);
  // 三元组入队后 embedding_state 变 disabled，第二遍不再命中
  assert.equal(second.triples, 0);
  db.close();
});

test('runTombstoneTask 组合返回统计', () => {
  const db = createDb();
  const result = runTombstoneTask({ db, enqueueDelete: () => {}, enqueueTripleDelete: () => {} });
  assert.equal(result.fragments, 0);
  assert.equal(result.done, true);
  db.close();
});

// ── T1/T2 候选发现 ──

test('findConflictClusters：共享实体且更新的记忆组成候选簇', () => {
  const db = createDb();
  insertFragment(db, { memoryId: 'mem_old1', judgment: '她讨厌狗', createdAt: daysAgo(30) });
  insertFragment(db, { memoryId: 'mem_new1', judgment: '她收养了一只流浪狗', createdAt: daysAgo(1) });
  insertFragment(db, { memoryId: 'mem_other', judgment: '无关记忆', createdAt: daysAgo(0.5) });
  linkEntity(db, 'mem_old1', '狗');
  linkEntity(db, 'mem_new1', '狗');
  linkEntity(db, 'mem_other', '天气');
  const clusters = findConflictClusters(db, { sinceDays: 7 });
  assert.equal(clusters.length, 1);
  const ids = clusters[0].memories.map(m => m.memory_id);
  assert.ok(ids.includes('mem_new1'));
  assert.ok(ids.includes('mem_old1'));
  assert.ok(!ids.includes('mem_other'));
  db.close();
});

test('findGeneralizationGroups：同实体同主体的多条情景记忆跨 14 天成组', () => {
  const db = createDb();
  for (const [id, days] of [['mem_ev0', 30], ['mem_ev1', 18], ['mem_ev2', 5]]) {
    insertFragment(db, { memoryId: id, type: 'event', judgment: `情景记录${id}`, eventTime: daysAgo(days), conversationId: 'char_1' });
    linkEntity(db, id, '感冒');
  }
  const groups = findGeneralizationGroups(db);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].entity_name, '感冒');
  assert.ok(groups[0].members.length >= 3);
  db.close();
});

test('findBackfillCandidates 与 findPortraitSuggestionConversations', () => {
  const db = createDb();
  insertFragment(db, { memoryId: 'mem_legacy', judgment: '旧格式记忆', keywords: null, createdAt: daysAgo(10) });
  // v3 字段全部填齐的记忆不是回填候选
  db.prepare(`UPDATE memory_fragments SET keywords = '["已补"]', perspectives = '["饮食"]', semantic_note = '已完整' WHERE memory_id = 'mem_legacy'`).run();
  insertFragment(db, { memoryId: 'mem_legacy2', judgment: '另一条旧记忆', keywords: null, createdAt: daysAgo(20) });
  const backfill = findBackfillCandidates(db);
  assert.deepEqual(backfill.map(row => row.memory_id), ['mem_legacy2']);
  // 高重要度 knowledge（char_ 会话）→ 画像建议候选
  insertFragment(db, { memoryId: 'mem_core', judgment: '用户对花生过敏', type: 'knowledge', importance: 5, conversationId: 'char_7' });
  const conversations = findPortraitSuggestionConversations(db, { minImportance: 4 });
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].characterId, 7);
  assert.equal(conversations[0].memories[0].memory_id, 'mem_core');
  db.close();
});

// ── LLM 任务 runner（注入 mock，不触真实 LLM）──

test('runConflictResolutionTask：矛盾决议走 update 双时态失效', async () => {
  const db = createDb();
  const cluster = {
    conversationId: 'char_1',
    memories: [
      { memory_id: 'mem_old1', memory_type: 'knowledge', subject: 'user', judgment: '她讨厌狗', semantic_note: null, source_raw_start_id: 1, source_raw_end_id: 2 },
      { memory_id: 'mem_new1', memory_type: 'event', subject: 'user', judgment: '她收养了一只流浪狗', semantic_note: null, source_raw_start_id: 3, source_raw_end_id: 4 },
    ],
  };
  const calls = [];
  const result = await runConflictResolutionTask({
    clusters: [cluster],
    llmBudgetRemaining: 2,
    deps: {
      chatSync: async () => JSON.stringify({
        resolutions: [{ type: 'conflict', outdatedMemoryId: 'mem_old1', updatedFact: '她现在很爱狗，还收养了流浪狗', memoryType: 'knowledge', subject: 'user', reasoning: '前后矛盾，以新事实为准', tags: ['狗'] }],
      }),
      applyMemoryActions: (args) => calls.push(args),
    },
  });
  assert.equal(result.llmCalls, 1);
  assert.equal(result.applied, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actions[0].action, 'update');
  assert.deepEqual(calls[0].actions[0].sourceMemoryIds, ['mem_old1']);
  db.close();
});

test('runConflictResolutionTask：预算耗尽提前停并报告未完成', async () => {
  const clusters = [{ conversationId: 'c', memories: [{ memory_id: 'a', judgment: 'x' }] }, { conversationId: 'c', memories: [{ memory_id: 'b', judgment: 'y' }] }];
  let calls = 0;
  const result = await runConflictResolutionTask({
    clusters,
    llmBudgetRemaining: 1,
    deps: { chatSync: async () => { calls++; return '{"resolutions":[]}'; }, applyMemoryActions: () => {} },
  });
  assert.equal(result.llmCalls, 1);
  assert.equal(result.done, false);
});

test('runGeneralizationTask：归纳结果经 insertGeneralizedMemory 落库，原记忆保留', async () => {
  const db = createDb();
  insertFragment(db, { memoryId: 'mem_ev0', type: 'event', judgment: '换季感冒了', eventTime: daysAgo(30) });
  insertFragment(db, { memoryId: 'mem_ev1', type: 'event', judgment: '又换季感冒', eventTime: daysAgo(15) });
  insertFragment(db, { memoryId: 'mem_ev2', type: 'event', judgment: '换季又感冒了', eventTime: daysAgo(3) });
  linkEntity(db, 'mem_ev0', '感冒');
  linkEntity(db, 'mem_ev1', '感冒');
  linkEntity(db, 'mem_ev2', '感冒');
  const groups = findGeneralizationGroups(db);
  const result = await runGeneralizationTask({
    groups,
    llmBudgetRemaining: 1,
    deps: {
      db,
      chatSync: async () => JSON.stringify({
        generalization: { judgment: '用户体质偏弱，换季容易感冒', semanticNote: '他一到换季就感冒', reasoning: '三条独立记录', tags: ['健康'], importance: 4 },
      }),
      insertGeneralizedMemory: (args) => insertGeneralizedMemory({ ...args, db, profile: null, wake: () => {} }),
    },
  });
  assert.equal(result.applied, 1);
  // 新 knowledge 记忆存在且原情景记忆保留、importance 降 1
  const derived = db.prepare(`SELECT memory_id, memory_type, judgment FROM memory_fragments WHERE memory_type = 'knowledge' AND judgment LIKE '%换季%'`).get();
  assert.ok(derived, '泛化记忆应落库');
  const source = db.prepare(`SELECT status, importance FROM memory_fragments WHERE memory_id = 'mem_ev0'`).get();
  assert.equal(source.status, 'active');
  assert.equal(source.importance, 2); // 3 - 1
  const relation = db.prepare(`SELECT action, relation_meta FROM memory_relations WHERE to_memory_id = ?`).get(derived.memory_id);
  assert.equal(relation.action, 'merge');
  assert.equal(JSON.parse(relation.relation_meta).kind, 'generalize');
  db.close();
});

test('runPortraitSuggestionTask：建议入 pending 队列且与已有画像去重', async () => {
  const db = createDb();
  db.prepare(`INSERT INTO user_portraits(character_id, trait_type, content, confidence) VALUES (7, 'personality', '用户很细心', 1.0)`).run();
  const conversations = [{ characterId: 7, conversationId: 'char_7', memories: [{ memory_id: 'mem_c1', judgment: '用户记得所有纪念日', semantic_note: null, importance: 5 }] }];
  const result = await runPortraitSuggestionTask({
    conversations,
    llmBudgetRemaining: 1,
    deps: {
      db,
      chatSync: async () => JSON.stringify({
        suggestions: [
          { field: 'personality', suggestion: '用户记得所有纪念日，非常细心', sourceMemoryIds: ['mem_c1'] },
          { field: 'personality', suggestion: '用户很细心' },  // 与已有画像重复 → 跳过
        ],
      }),
    },
  });
  assert.equal(result.suggestions, 1);
  const pending = db.prepare(`SELECT field, suggestion, source_memory_ids, status FROM portrait_suggestions WHERE character_id = 7`).all();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, 'pending');
  assert.deepEqual(JSON.parse(pending[0].source_memory_ids), ['mem_c1']);
  db.close();
});

test('runBackfillTask：补齐 v3 字段并置 stale 触发重嵌入', async () => {
  const db = createDb();
  insertFragment(db, { memoryId: 'mem_legacy', judgment: '用户不吃香菜', keywords: null });
  const candidates = findBackfillCandidates(db);
  const result = await runBackfillTask({
    candidates,
    llmBudgetRemaining: 1,
    deps: {
      db,
      chatSync: async () => JSON.stringify({
        items: [{ memoryId: 'mem_legacy', keywords: ['香菜', '饮食'], perspectives: ['饮食习惯'], semanticNote: '她对香菜过敏或不喜好', episodicNote: '', importance: 4 }],
      }),
    },
  });
  assert.equal(result.updated, 1);
  const row = db.prepare(`SELECT keywords, perspectives, semantic_note, importance, embedding_state FROM memory_fragments WHERE memory_id = 'mem_legacy'`).get();
  assert.deepEqual(JSON.parse(row.keywords), ['香菜', '饮食']);
  assert.equal(row.importance, 4);
  assert.equal(row.embedding_state, 'stale');
  db.close();
});

test('runBackfillTask：预算为 0 时直接让位', async () => {
  const result = await runBackfillTask({ candidates: [{ memory_id: 'x' }], llmBudgetRemaining: 0, deps: {} });
  assert.equal(result.done, false);
  assert.equal(result.llmCalls, 0);
});
