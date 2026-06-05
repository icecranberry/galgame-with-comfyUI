/**
 * 三路召回 + RRF 融合排序
 *
 * 三路:
 *   1. FTS5 关键词召回 (SQLite, BM25)
 *   2. 向量语义召回 (ChromaDB, cosine)
 *   3. 实体聚合召回 (SQLite, 实体 JOIN — 基于已召回的实体扩展)
 *
 * 融合:
 *   RRF: score(d) = Σ 1 / (k + rank_i(d)), k=60
 */

import { getDb } from '../db/index.js';
import { vectorSearch } from './vectorClient.js';

const RRF_K = 60;
const CANDIDATES_PER_CHANNEL = 20;
const FUSION_TOP_K = 10;

/**
 * 三路召回 + RRF 融合
 *
 * @param {string} query - 用户查询文本
 * @param {object} options
 * @param {string} options.conversationId - 可选，限定会话范围
 * @param {number} options.topK - 最终返回数量
 * @returns {Promise<Array<{id, content, score, fragment_type, entities}>>}
 */
export async function hybridSearch(query, { conversationId = null, topK = FUSION_TOP_K } = {}) {
  // 三路召回并行执行
  const [keywordResults, vectorResults, entityResults] = await Promise.all([
    keywordSearch(query, conversationId, CANDIDATES_PER_CHANNEL),
    semanticSearch(query, conversationId, CANDIDATES_PER_CHANNEL),
    entitySearch(query, conversationId, CANDIDATES_PER_CHANNEL),
  ]);

  // RRF 融合
  const fused = rrfFusion(keywordResults, vectorResults, entityResults, topK);

  return fused;
}

/**
 * 通道 1: 关键词召回 (LIKE 搜索，兼容中文)
 *
 * FTS5 默认 tokenizer (unicode61) 对中文分词支持很差，
 * 这里用 LIKE 做关键词匹配，简单可靠。
 */
function keywordSearch(query, conversationId, limit) {
  const db = getDb();

  // 拆分为关键词
  const keywords = query
    .split(/[\s,，。！？、]+/)
    .filter(w => w.length > 0);

  if (keywords.length === 0) return [];

  // 构建 LIKE 条件: 同时搜索 messages 和 memory_fragments
  const likeConditions = keywords.map(() => `(m.content LIKE ? OR mf.content LIKE ?)`).join(' AND ');
  const params = [];
  for (const kw of keywords) {
    params.push(`%${kw}%`, `%${kw}%`);
  }

  try {
    let sql = `
      SELECT m.id, mf.id as frag_id, mf.fragment_type,
             COALESCE(mf.content, m.content) as content, mf.entities,
             (${keywords.map(() => `(CASE WHEN m.content LIKE ? THEN 1 ELSE 0 END + CASE WHEN mf.content LIKE ? THEN 2 ELSE 0 END)`).join(' + ')}) as match_score
      FROM messages m
      LEFT JOIN memory_fragments mf ON mf.source_msg_id = m.id
      WHERE m.is_deleted = 0 AND (${likeConditions})
    `;
    // match_score params
    for (const kw of keywords) {
      params.push(`%${kw}%`, `%${kw}%`);
    }

    if (conversationId) {
      sql += ` AND m.conversation_id = ?`;
      params.push(conversationId);
    }

    sql += ` ORDER BY match_score DESC, m.id DESC LIMIT ?`;
    params.push(limit);

    return db.prepare(sql).all(...params).map(r => ({
      id: r.id,
      frag_id: r.frag_id,
      fragment_type: r.fragment_type || 'message',
      content: r.content,
      entities: parseEntities(r.entities),
      source: 'keyword',
    }));
  } catch (err) {
    console.error('[memorySearch] keyword error:', err.message);
    return [];
  }
}

/**
 * 通道 2: 向量语义召回
 */
async function semanticSearch(query, conversationId, limit) {
  try {
    const results = await vectorSearch(query, { topK: limit });

    return results.map(r => ({
      id: r.id,
      frag_id: r.id,
      fragment_type: r.metadata?.fragment_type || 'fact',
      content: r.document || '',
      entities: r.metadata?.entities || [],
      score: r.score,
      source: 'vector',
    }));
  } catch (err) {
    console.error('[memorySearch] vector search error:', err.message);
    return [];
  }
}

/**
 * 通道 3: 实体聚合召回
 *
 * 先用 LIKE 找到包含关键词的记忆碎片，提取实体后再做二次扩展。
 */
function entitySearch(query, conversationId, limit) {
  const db = getDb();

  const keywords = query
    .split(/[\s,，。！？、]+/)
    .filter(w => w.length > 0);

  if (keywords.length === 0) return [];

  try {
    // 用 LIKE 找到匹配的记忆碎片
    const likeConditions = keywords.map(() => `mf.content LIKE ?`).join(' OR ');
    const likeParams = keywords.map(kw => `%${kw}%`);

    let sql = `SELECT mf.* FROM memory_fragments mf WHERE (${likeConditions})`;
    const params = [...likeParams];

    if (conversationId) {
      sql += ` AND mf.conversation_id = ?`;
      params.push(conversationId);
    }

    sql += ` LIMIT 5`;
    const rows = db.prepare(sql).all(...params);

    // 如果有匹配的碎片，提取它们的实体做二次扩展
    if (rows.length > 0) {
      const allEntities = [];
      for (const row of rows) {
        const entities = parseEntities(row.entities);
        allEntities.push(...entities);
      }

      // 去重实体
      const uniqueEntities = [...new Set(allEntities)];

      // 用这些实体再做一次扩展搜索
      if (uniqueEntities.length > 0) {
        const entityResults = expandByEntities(uniqueEntities, conversationId, limit);
        return [...rows.map(r => formatFragmentRow(r, 'entity')), ...entityResults].slice(0, limit);
      }
    }

    return rows.map(r => formatFragmentRow(r, 'entity'));
  } catch (err) {
    console.error('[memorySearch] entity search error:', err.message);
    return [];
  }
}

function expandByEntities(entities, conversationId, limit) {
  const db = getDb();
  const placeholders = entities.map(() => 'mf.entities LIKE ?').join(' OR ');
  const params = entities.map(e => `%${e}%`);

  let sql = `SELECT mf.* FROM memory_fragments mf WHERE (${placeholders})`;
  if (conversationId) {
    sql += ` AND mf.conversation_id = ?`;
    params.push(conversationId);
  }
  sql += ` LIMIT ?`;
  params.push(limit);

  return db.prepare(sql).all(...params).map(r => formatFragmentRow(r, 'entity'));
}

/**
 * RRF 融合排序
 */
function rrfFusion(...resultSets) {
  const scores = new Map();

  for (const results of resultSets) {
    for (let i = 0; i < results.length; i++) {
      const item = results[i];
      const key = item.frag_id || item.id;
      const rrfScore = 1 / (RRF_K + i + 1);

      if (scores.has(key)) {
        const existing = scores.get(key);
        existing.rrf += rrfScore;
        existing.sources.push(item.source);
      } else {
        scores.set(key, {
          id: key,
          content: item.content,
          fragment_type: item.fragment_type,
          entities: item.entities || [],
          rrf: rrfScore,
          sources: [item.source],
        });
      }
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, FUSION_TOP_K);
}

// ── helpers ──

function parseEntities(raw) {
  if (!raw) return [];
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
}

function formatFragmentRow(row, source) {
  return {
    id: row.id,
    frag_id: row.id,
    fragment_type: row.fragment_type,
    content: row.content,
    entities: parseEntities(row.entities),
    source,
  };
}
