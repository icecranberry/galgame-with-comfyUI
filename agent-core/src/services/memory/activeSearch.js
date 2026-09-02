// Memory v3 阶段二：主动回想（@memory 文本协议）服务端检索层
// 设计基准：docs/memory-upgrade-plan.md §5.3
// 1. 时态模式检测：时间性疑问放宽双时态过滤并标注历史徽标
// 2. 三元组联想扩展（HippoRAG 2 query-to-triple）：query 嵌入 → 三元组向量库 → 关联记忆
// 3. 实体 1 跳扩展：已命中记忆的共享实体反查关联记忆
// 4. RRF 融合 → [{ injectionText, isHistorical, ... }]，注入 <memory_recall_result> 二次续写
import { getDb } from '../../db/index.js';
import { hybridSearch, rrfFusion, formatRow } from '../memorySearch.js';
import { vectorSearch } from '../vectorClient.js';
import { embedMemoryText } from './memoryProviders.js';
import { getMemorySettings, isMemoryV3Enabled } from './memoryConfig.js';
import { MEMORY_TRIPLES_CORPUS } from './memoryRepository.js';

const DEFAULT_TOP_K = 8;
const TRIPLE_TOP_K = 5;
const TRIPLE_RESULT_LIMIT = 5;
const ENTITY_HOP_SEEDS = 3;
const ENTITY_HOP_LIMIT = 3;

// 时态模式：命中即进入历史模式（放宽 valid_to/superseded 过滤，结果带过时徽标）
const TEMPORAL_PATTERN = /(以前|曾经|第一次|上次|之前|那时候|后来|当年|当初|去年|前年|过去|小时候)/;

export function detectTemporalPattern(query) {
  return TEMPORAL_PATTERN.test(String(query || ''));
}

// @memory 行协议解析：返回查询文本（未命中返回 null）。
// 仅认首行；非首行的 @memory 视为普通文本（防呆：同一轮只认第一次触发）。
export function parseRecallInstruction(fullContent) {
  const firstLine = String(fullContent || '').split(/\r?\n/, 1)[0] || '';
  const matched = firstLine.match(/^@memory\s*(\S.*)$/);
  return matched ? matched[1].trim().slice(0, 200) : null;
}

export async function activeMemorySearch(query, options = {}, deps = {}) {
  const search = deps.hybridSearch || hybridSearch;
  const getSettings = deps.getMemorySettings || getMemorySettings;
  const v3Enabled = deps.isMemoryV3Enabled || isMemoryV3Enabled;
  const audit = deps.writeAudit || writeActiveAudit;
  const getDepsDb = deps.getDb || getDb;
  const timeoutMs = options.timeoutMs ?? 4000;
  const conversationIds = normalizeConversationIds(options.conversationId, options.conversationIds);
  const startedAt = Date.now();
  const run = (async () => {
    const historical = detectTemporalPattern(query);
    // 1. 主检索：现行模式同被动召回；历史模式放宽双时态过滤（topK=8，方案 §5.3）
    const primary = await search(query, {
      conversationIds,
      includeHistorical: historical,
      topK: options.topK ?? DEFAULT_TOP_K,
    });
    // 2. 三元组联想扩展（空库/嵌入失败自动跳过，存量数据自然降级）
    const tripleResults = await tripleExpansion(query, conversationIds, { v3Enabled, getDepsDb, getSettings, embed: deps.embed, searchVectors: deps.vectorSearch });
    // 3. 实体 1 跳扩展
    const entityHopResults = entityHopExpansion(primary, conversationIds, { v3Enabled, getDepsDb });

    // 4. RRF 融合
    const candidateSets = [primary];
    if (tripleResults.length) candidateSets.push(tripleResults);
    if (entityHopResults.length) candidateSets.push(entityHopResults);
    const topK = options.topK ?? DEFAULT_TOP_K;
    const merged = candidateSets.length > 1 ? rrfFusion(candidateSets, topK) : primary.slice(0, topK);

    // 5. 徽标 + 注入文本 + 后继版本
    const results = merged.map(item => annotateResult(item, { getSettings, getDepsDb }));
    audit({ conversationIds, query, primary, tripleResults, entityHopResults, results, elapsedMs: Date.now() - startedAt });
    return { results, timedOut: false };
  })();

  if (!timeoutMs) {
    const results = await run;
    return { results, timedOut: false };
  }
  let timer = null;
  try {
    return await Promise.race([
      run,
      new Promise(resolve => {
        timer = setTimeout(() => resolve({ results: [], timedOut: true }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 三元组联想扩展：query 嵌入 → memory_triples_v1 向量库 top5 → 命中三元组的关联记忆（去重、限 5 条）
async function tripleExpansion(query, conversationIds, { v3Enabled = isMemoryV3Enabled, getDepsDb = getDb, getSettings = getMemorySettings, embed = embedMemoryText, searchVectors = vectorSearch } = {}) {
  try {
    if (!v3Enabled()) return [];
    const db = getDepsDb();
    const tripleCount = db.prepare(`SELECT COUNT(*) AS count FROM memory_triples WHERE valid_to IS NULL`).get().count;
    if (tripleCount === 0) return [];
    const settings = getSettings({ includeSecrets: true });
    const { embedding } = await embed(query, settings);
    if (!embedding) return [];
    const vectorScope = conversationIds.length === 0
      ? null
      : (conversationIds.length === 1 ? conversationIds[0] : conversationIds);
    const raw = await searchVectors(query, {
      embedding,
      topK: TRIPLE_TOP_K,
      conversationId: vectorScope,
      corpus: MEMORY_TRIPLES_CORPUS,
    });
    const tripleIds = raw
      .map(item => Number(String(item?.id || '').replace(/^trip_/, '')))
      .filter(id => Number.isInteger(id) && id > 0);
    if (tripleIds.length === 0) return [];

    const params = tripleIds;
    let sql = `
      SELECT mf.*, t.id AS triple_id
      FROM memory_triples t
      JOIN memory_fragments mf ON mf.memory_id = t.memory_id
      WHERE t.id IN (${tripleIds.map(() => '?').join(',')}) AND t.valid_to IS NULL
        AND mf.status = 'active' AND mf.valid_to IS NULL
    `;
    sql = appendConversationFilter(sql, params, conversationIds);
    const rows = db.prepare(sql).all(...params);
    // 按三元组向量命中顺序排序（去重）
    const byTripleId = new Map(rows.map(row => [row.triple_id, row]));
    const ordered = tripleIds.map(id => byTripleId.get(id)).filter(Boolean);
    return ordered.slice(0, TRIPLE_RESULT_LIMIT).map((row, index) => formatRow(row, 'triple', 1 / (index + 1)));
  } catch (error) {
    console.warn('[activeSearch] triple expansion skipped:', error.message);
    return [];
  }
}

// 实体 1 跳扩展：主检索 top 命中 → 共享实体 → 其他关联记忆（限 3 条，已命中的不再重复）
function entityHopExpansion(primary, conversationIds, { v3Enabled = isMemoryV3Enabled, getDepsDb = getDb } = {}) {
  try {
    if (primary.length === 0 || !v3Enabled()) return [];
    const db = getDepsDb();
    const seedIds = primary.slice(0, ENTITY_HOP_SEEDS).map(item => item.memory_id).filter(Boolean);
    if (seedIds.length === 0) return [];
    const placeholders = seedIds.map(() => '?').join(',');
    const entityIds = db.prepare(`
      SELECT DISTINCT entity_id FROM memory_entity_links WHERE memory_id IN (${placeholders})
    `).all(...seedIds).map(row => row.entity_id);
    if (entityIds.length === 0) return [];

    const knownIds = primary.map(item => item.memory_id).filter(Boolean);
    const entityPlaceholders = entityIds.map(() => '?').join(',');
    const params = [...entityIds];
    let sql = `
      SELECT mf.*, COUNT(DISTINCT mel.entity_id) AS shared_entities
      FROM memory_entity_links mel
      JOIN memory_fragments mf ON mf.memory_id = mel.memory_id
      WHERE mel.entity_id IN (${entityPlaceholders}) AND mf.status = 'active' AND mf.valid_to IS NULL
    `;
    sql = appendConversationFilter(sql, params, conversationIds);
    if (knownIds.length) {
      sql += ` AND mf.memory_id NOT IN (${knownIds.map(() => '?').join(',')})`;
      params.push(...knownIds);
    }
    sql += ` GROUP BY mf.memory_id ORDER BY shared_entities DESC, COALESCE(mf.updated_at, mf.created_at) DESC LIMIT ?`;
    params.push(ENTITY_HOP_LIMIT);
    return db.prepare(sql).all(...params).map(row => formatRow(row, 'entity_hop', Number(row.shared_entities || 1)));
  } catch (error) {
    console.warn('[activeSearch] entity hop expansion skipped:', error.message);
    return [];
  }
}

function annotateResult(item, { getSettings = getMemorySettings, getDepsDb = getDb } = {}) {
  const isHistorical = item.status === 'superseded' || item.valid_to != null;
  const settings = getSettings();
  const useV3 = settings.v3?.enabled !== false;
  const injectionText = (useV3 && item.semantic_note) || item.judgment || item.content || '';
  let successor = null;
  if (isHistorical) {
    try {
      const successorId = getDepsDb().prepare(`
        SELECT to_memory_id FROM memory_relations WHERE from_memory_id = ? ORDER BY id DESC LIMIT 1
      `).get(item.memory_id)?.to_memory_id || null;
      if (successorId) {
        const row = getDepsDb().prepare(`SELECT semantic_note, judgment, valid_to, status FROM memory_fragments WHERE memory_id = ?`).get(successorId);
        if (row) {
          successor = {
            memory_id: successorId,
            text: (useV3 && row.semantic_note) || row.judgment || '',
            isValid: row.status === 'active' && row.valid_to == null,
          };
        }
      }
    } catch (error) {
      console.warn('[activeSearch] successor lookup failed:', error.message);
    }
  }
  return {
    memory_id: item.memory_id,
    memory_type: item.memory_type,
    judgment: item.judgment || item.content || '',
    injectionText,
    isHistorical,
    valid_to: item.valid_to || null,
    event_time: item.event_time || null,
    successor,
    sources: item.sources || [],
    score: item.score,
  };
}

// <memory_recall_result> 注入块：含现行/历史徽标、后继版本与防呆收尾语（§5.2）
export function formatMemoryRecallBlock(query, results = [], { failed = false } = {}) {
  const lines = [`（你回想了「${String(query).slice(0, 120)}」，结果是：）`];
  if (failed) {
    lines.push('（回想过程出了点问题，没有找到相关记忆。）');
  } else if (results.length === 0) {
    lines.push('（没有想起任何相关记忆。）');
  } else {
    results.forEach((item, index) => {
      if (item.isHistorical) {
        const when = String(item.valid_to || '').slice(0, 16);
        const successorText = item.successor?.text ? `（后来更新为：${item.successor.text}）` : '';
        lines.push(`${index + 1}. [历史·已于 ${when} 过时] ${item.injectionText}${successorText}`);
      } else {
        lines.push(`${index + 1}. [现行] ${item.injectionText}`);
      }
    });
  }
  lines.push('（没想起来的部分就自然地说不记得，不要编造。）');
  lines.push('（检索已完成，请基于以上内容继续正常回复，不要再输出 @memory 指令。）');
  return `<memory_recall_result>\n${lines.join('\n')}\n</memory_recall_result>`;
}

// 审计：memory_retrieval_audits 记 mode='active'（含 query/各路命中/耗时）
function writeActiveAudit({ conversationIds, query, primary, tripleResults, entityHopResults, results, elapsedMs }) {
  try {
    const counts = { text: 0, vector: 0, entity: 0, triple: tripleResults.length, entity_hop: entityHopResults.length };
    for (const item of primary) {
      for (const source of item.sources || []) {
        if (counts[source] !== undefined) counts[source]++;
      }
    }
    const conversationScope = conversationIds.length <= 1 ? (conversationIds[0] || null) : JSON.stringify(conversationIds);
    getDb().prepare(`
      INSERT INTO memory_retrieval_audits(conversation_id, query, mode, candidate_sources, memory_ids, fallback_reason)
      VALUES (?, ?, 'active', ?, ?, ?)
    `).run(
      conversationScope,
      String(query).slice(0, 1000),
      JSON.stringify(counts),
      JSON.stringify(results.map(item => item.memory_id)),
      null,
    );
    console.log(`[activeSearch] q="${singleLine(query, 60)}" historical=${detectTemporalPattern(query)} hits=${results.length} sources=${JSON.stringify(counts)} cost=${elapsedMs}ms`);
  } catch (error) {
    console.error('[activeSearch] audit failed:', error.message);
  }
}

function appendConversationFilter(sql, params, conversationIds, column = 'mf.conversation_id') {
  if (conversationIds.length === 0) return sql;
  sql += ` AND ${column} IN (${conversationIds.map(() => '?').join(',')})`;
  params.push(...conversationIds);
  return sql;
}

function normalizeConversationIds(conversationId, conversationIds) {
  const values = [conversationId, ...(Array.isArray(conversationIds) ? conversationIds : [conversationIds])];
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function singleLine(value, maxLength) {
  const text = String(value || '').replace(/[\r\n\t|]+/g, ' ').replace(/"/g, "'").replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
