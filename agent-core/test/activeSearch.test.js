import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { detectTemporalPattern, parseRecallInstruction, formatMemoryRecallBlock, activeMemorySearch } from '../src/services/memory/activeSearch.js';
import { normalizeMemorySettings } from '../src/services/memory/memoryConfig.js';
import { tripleEmbeddingText } from '../src/services/memory/memoryRepository.js';

// ── 纯函数：@memory 行协议解析 ──

test('parseRecallInstruction 认首行 @memory 指令', () => {
  assert.equal(parseRecallInstruction('@memory 她小时候最喜欢吃什么'), '她小时候最喜欢吃什么');
  assert.equal(parseRecallInstruction('@memory   多余空格  '), '多余空格');
  assert.equal(parseRecallInstruction('@memory\n'), null);
  assert.equal(parseRecallInstruction('@memory'), null);
  assert.equal(parseRecallInstruction('今晚吃什么\n@memory 她的口味'), null); // 非首行视为普通文本
  assert.equal(parseRecallInstruction(''), null);
  assert.equal(parseRecallInstruction(null), null);
});

test('parseRecallInstruction 截断超长查询到 200 字', () => {
  const query = parseRecallInstruction(`@memory ${'啊'.repeat(300)}`);
  assert.equal(query.length, 200);
});

test('detectTemporalPattern 命中时态词进入历史模式', () => {
  assert.equal(detectTemporalPattern('你们第一次见面是什么时候？'), true);
  assert.equal(detectTemporalPattern('她以前住在哪里？'), true);
  assert.equal(detectTemporalPattern('她小时候养过猫吗'), true);
  assert.equal(detectTemporalPattern('今天天气怎么样'), false);
  assert.equal(detectTemporalPattern(''), false);
  assert.equal(detectTemporalPattern(null), false);
});

// ── 纯函数：<memory_recall_result> 注入块 ──

test('formatMemoryRecallBlock 失败/空结果/现行/历史四种形态', () => {
  const failed = formatMemoryRecallBlock('她爱吃啥', [], { failed: true });
  assert.ok(failed.startsWith('<memory_recall_result>'));
  assert.ok(failed.includes('出了点问题'));

  const empty = formatMemoryRecallBlock('她爱吃啥', []);
  assert.ok(empty.includes('没有想起任何相关记忆'));

  const current = formatMemoryRecallBlock('她爱吃啥', [
    { injectionText: '她不吃香菜', isHistorical: false },
  ]);
  assert.ok(current.includes('[现行] 她不吃香菜'));

  const historical = formatMemoryRecallBlock('她住哪', [
    { injectionText: '她住在城南', isHistorical: true, valid_to: '2026-08-01 10:30:00', successor: { text: '她搬到城北了' } },
  ]);
  assert.ok(historical.includes('[历史·已于 2026-08-01 10:30 过时] 她住在城南'));
  assert.ok(historical.includes('（后来更新为：她搬到城北了）'));

  for (const block of [failed, empty, current, historical]) {
    assert.ok(block.includes('不要编造'));
    assert.ok(block.includes('不要再输出 @memory'));
    assert.ok(block.endsWith('</memory_recall_result>'));
  }
});

// ── 纯函数：三元组嵌入文本 ──

test('tripleEmbeddingText 拼接主谓宾并过滤缺失部分', () => {
  assert.equal(tripleEmbeddingText({ subject_text: '她', predicate: '讨厌', object_text: '香菜' }), '她 讨厌 香菜');
  assert.equal(tripleEmbeddingText({ subject_text: '', predicate: '讨厌', object_text: '香菜' }), '讨厌 香菜');
  assert.equal(tripleEmbeddingText({}), '');
});

// ── 配置归一化 ──

test('normalizeMemorySettings 归一化 activeSearch 并钳制 timeoutMs', () => {
  const defaults = normalizeMemorySettings({});
  assert.deepEqual(defaults.activeSearch, { enabled: false, timeoutMs: 4000 });

  const clamped = normalizeMemorySettings({ activeSearch: { enabled: 1, timeoutMs: 5 } });
  assert.equal(clamped.activeSearch.enabled, true);
  assert.equal(clamped.activeSearch.timeoutMs, 1000);

  const upper = normalizeMemorySettings({ activeSearch: { timeoutMs: 99999 } });
  assert.equal(upper.activeSearch.timeoutMs, 30000);
});

// ── activeMemorySearch 全链路（依赖注入，不触真实 DB/向量服务） ──

function createSearchDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_triples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      subject_text TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object_text TEXT NOT NULL,
      valid_to DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memory_fragments (
      memory_id TEXT PRIMARY KEY,
      conversation_id TEXT,
      memory_type TEXT,
      judgment TEXT,
      content TEXT,
      semantic_note TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      event_time DATETIME,
      valid_from DATETIME,
      valid_to DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memory_entity_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'mention'
    );
    CREATE TABLE memory_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_memory_id TEXT,
      to_memory_id TEXT
    );
  `);
  db.prepare(`INSERT INTO memory_triples (id, memory_id, subject_text, predicate, object_text) VALUES (1, 'mem_a', '她', '讨厌', '香菜')`).run();
  const frag = db.prepare(`INSERT INTO memory_fragments (memory_id, conversation_id, memory_type, judgment, semantic_note) VALUES (?, ?, ?, ?, ?)`);
  frag.run('mem_a', 'c1', 'knowledge', '她讨厌香菜', '她不吃香菜，源于童年经历');
  frag.run('mem_b', 'c1', 'emotion', '她怕黑', '她怕黑');
  frag.run('mem_c', 'c1', 'event', '她晚上开灯睡觉', '她晚上开灯睡觉');
  const link = db.prepare(`INSERT INTO memory_entity_links (memory_id, entity_id, role) VALUES (?, ?, ?)`);
  link.run('mem_b', 7, 'subject');
  link.run('mem_c', 7, 'mention');
  return db;
}

test('activeMemorySearch 主检索 + 三元组联想 + 实体 1 跳 + RRF 融合', async () => {
  const db = createSearchDb();
  const audits = [];
  const primaryRow = {
    memory_id: 'mem_b', memory_type: 'emotion', judgment: '她怕黑', semantic_note: '她怕黑',
    status: 'active', valid_to: null, event_time: null, sources: ['text'], score: 1,
  };
  const vectorCalls = [];
  const result = await activeMemorySearch('她讨厌香菜吗', { conversationId: 'c1' }, {
    hybridSearch: async () => [primaryRow],
    isMemoryV3Enabled: () => true,
    getMemorySettings: () => ({ v3: { enabled: true } }),
    getDb: () => db,
    embed: async () => ({ embedding: [0.1, 0.2] }),
    vectorSearch: async (query, opts) => {
      vectorCalls.push(opts);
      return [{ id: 'trip_1', score: 0.9 }];
    },
    writeAudit: (audit) => audits.push(audit),
  });

  assert.equal(result.timedOut, false);
  const byId = new Map(result.results.map(item => [item.memory_id, item]));
  // 三元组命中 → 关联记忆 mem_a，注入文本优先 semantic_note
  assert.ok(byId.has('mem_a'));
  assert.equal(byId.get('mem_a').injectionText, '她不吃香菜，源于童年经历');
  assert.equal(byId.get('mem_a').isHistorical, false);
  assert.ok(byId.get('mem_a').sources.includes('triple'));
  // 实体 1 跳 → 共享实体的 mem_c
  assert.ok(byId.has('mem_c'));
  assert.ok(byId.get('mem_c').sources.includes('entity_hop'));
  // 主检索命中原样保留
  assert.ok(byId.has('mem_b'));
  assert.ok(byId.get('mem_b').sources.includes('text'));
  // 三元组向量检索走 memory_triples_v1 语料、会话范围限定 c1
  assert.equal(vectorCalls.length, 1);
  assert.equal(vectorCalls[0].corpus, 'memory_triples_v1');
  assert.equal(vectorCalls[0].conversationId, 'c1');
  // 审计记录三元组/实体跳扩展命中
  assert.equal(audits.length, 1);
  assert.equal(audits[0].tripleResults.length, 1);
  assert.equal(audits[0].entityHopResults.length, 1);
  assert.equal(audits[0].results.length, result.results.length);
  db.close();
});

test('activeMemorySearch v3 关闭或三元组空库时自然降级', async () => {
  const db = createSearchDb();
  db.prepare(`DELETE FROM memory_triples`).run();
  const result = await activeMemorySearch('她怕黑吗', { conversationId: 'c1' }, {
    hybridSearch: async () => [],
    isMemoryV3Enabled: () => true,
    getMemorySettings: () => ({ v3: { enabled: true } }),
    getDb: () => db,
    embed: async () => ({ embedding: [1] }),
    vectorSearch: async () => { throw new Error('should not be called'); },
    writeAudit: () => {},
  });
  assert.deepEqual(result, { results: [], timedOut: false });
  db.close();
});

test('activeMemorySearch 历史模式：注入 getMemorySettings 透传 includeHistorical', async () => {
  const db = createSearchDb();
  const searchCalls = [];
  await activeMemorySearch('她以前住在哪里', {}, {
    hybridSearch: async (query, opts) => {
      searchCalls.push(opts);
      return [];
    },
    isMemoryV3Enabled: () => false,
    getMemorySettings: () => ({ v3: { enabled: false } }),
    getDb: () => db,
    writeAudit: () => {},
  });
  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].includeHistorical, true);
  db.close();
});

test('activeMemorySearch 超时返回空结果并标记 timedOut', async () => {
  const startedAt = Date.now();
  const result = await activeMemorySearch('什么', { timeoutMs: 60 }, {
    hybridSearch: () => new Promise(() => {}),
    isMemoryV3Enabled: () => false,
  });
  const elapsedMs = Date.now() - startedAt;
  assert.deepEqual(result, { results: [], timedOut: true });
  assert.ok(elapsedMs >= 50, `resolved too early: ${elapsedMs}ms`);
  assert.ok(elapsedMs < 2000, `resolved too late: ${elapsedMs}ms`);
});

test('normalizeMemorySettings 兼容旧键 dailyMaxLlmCalls → llmCallsPerRun', () => {
  // 旧配置文件只有 dailyMaxLlmCalls：读入新键并保留值
  const legacy = normalizeMemorySettings({ consolidation: { dailyMaxLlmCalls: 9 } });
  assert.equal(legacy.consolidation.llmCallsPerRun, 9);
  // 新旧键并存时新键优先；输出不再包含旧键（下次保存后彻底迁移）
  const both = normalizeMemorySettings({ consolidation: { dailyMaxLlmCalls: 2, llmCallsPerRun: 4 } });
  assert.equal(both.consolidation.llmCallsPerRun, 4);
  assert.equal(both.consolidation.dailyMaxLlmCalls, undefined);
  // 无任何键时取默认 6
  const fresh = normalizeMemorySettings({});
  assert.equal(fresh.consolidation.llmCallsPerRun, 6);
});

test('activeMemorySearch 历史模式：已失效三元组与其 superseded 记忆参与联想并标历史徽标', async () => {
  const db = createSearchDb();
  // 三元组 1 已随记忆演化置失效，关联记忆 mem_a 已被 update 置 superseded
  db.prepare(`UPDATE memory_triples SET valid_to = '2026-08-30 10:00:00' WHERE id = 1`).run();
  db.prepare(`UPDATE memory_fragments SET status = 'superseded', valid_to = '2026-08-30 10:00:00' WHERE memory_id = 'mem_a'`).run();
  const result = await activeMemorySearch('她以前讨厌香菜吗', { conversationId: 'c1' }, {
    hybridSearch: async () => [],
    isMemoryV3Enabled: () => true,
    getMemorySettings: () => ({ v3: { enabled: true } }),
    getDb: () => db,
    embed: async () => ({ embedding: [0.1, 0.2] }),
    vectorSearch: async () => [{ id: 'trip_1', score: 0.9 }],
    writeAudit: () => {},
  });
  const historical = result.results.find(item => item.memory_id === 'mem_a');
  // 历史模式放宽后三元组联想命中已失效记忆并标注历史徽标
  assert.ok(historical, '历史模式应通过失效三元组联想召回 superseded 记忆');
  assert.equal(historical.isHistorical, true);
  db.close();
});

test('activeMemorySearch 现行模式：失效三元组不参与联想', async () => {
  const db = createSearchDb();
  db.prepare(`UPDATE memory_triples SET valid_to = '2026-08-30 10:00:00' WHERE id = 1`).run();
  db.prepare(`UPDATE memory_fragments SET status = 'superseded', valid_to = '2026-08-30 10:00:00' WHERE memory_id = 'mem_a'`).run();
  const result = await activeMemorySearch('她讨厌香菜吗', { conversationId: 'c1' }, {
    hybridSearch: async () => [],
    isMemoryV3Enabled: () => true,
    getMemorySettings: () => ({ v3: { enabled: true } }),
    getDb: () => db,
    embed: async () => ({ embedding: [0.1, 0.2] }),
    vectorSearch: async () => [{ id: 'trip_1', score: 0.9 }],
    writeAudit: () => {},
  });
  assert.equal(result.results.length, 0);
  db.close();
});
