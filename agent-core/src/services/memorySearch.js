import { getDb } from '../db/index.js';
import { vectorSearch } from './vectorClient.js';
import { getMemorySettings } from './memory/memoryConfig.js';
import { embedMemoryText, rerankMemories } from './memory/memoryProviders.js';
import { parseTags } from './memory/memoryRepository.js';

const RRF_K = 60;

export async function hybridSearch(query, options = {}) {
  const timeoutMs = options.timeoutMs;
  const run = (async () => {
  const startedAt = Date.now();
  const settings = getMemorySettings({ includeSecrets: true });
  const conversationIds = normalizeConversationIds(options.conversationId, options.conversationIds);
  const topK = clamp(options.topK ?? settings.topK, 1, 20);
  const textLimit = clamp(options.textCandidates ?? settings.textCandidates, topK, 100);
  const vectorLimit = clamp(options.vectorCandidates ?? settings.vectorCandidates, topK, 100);
  const textResults = textSearch(query, conversationIds, textLimit);
  let profile = null;
  let embeddingSource = 'unknown';
  let embeddingElapsedMs = null;
  let rerankerSource = 'skipped';
  let rerankerElapsedMs = null;
  let vectorResults = [];
  let fallbackReason = null;

  try {
    const embeddingResult = await embedMemoryText(query, settings);
    profile = embeddingResult.profile;
    embeddingSource = embeddingResult.source;
    embeddingElapsedMs = embeddingResult.elapsedMs;
    const vectorConversationScope = conversationIds.length === 0
      ? null
      : (conversationIds.length === 1 ? conversationIds[0] : conversationIds);
    const raw = await vectorSearch(query, {
      embedding: embeddingResult.embedding,
      topK: vectorLimit,
      conversationId: vectorConversationScope,
      corpus: profile.corpus,
    });
    vectorResults = hydrateVectorResults(raw, conversationIds);
    if (embeddingResult.source === 'local') fallbackReason = 'embedding: using local built-in model';
  } catch (error) {
    fallbackReason = `embedding: ${error.message}`;
  }

  let candidates = profile ? rrfFusion([textResults, vectorResults], Math.max(topK, settings.reranker.topN || topK)) : textResults;
  if (candidates.length > 1) {
    try {
      candidates = await rerankMemories(query, candidates, settings);
      rerankerSource = candidates[0]?.rerank_source || 'skipped';
      rerankerElapsedMs = candidates[0]?.rerank_elapsed_ms ?? null;
    } catch (error) {
      rerankerSource = 'failed';
      fallbackReason = [fallbackReason, `reranker: ${error.message}`].filter(Boolean).join('; ');
    }
  }
  const final = candidates.slice(0, topK);
  const mode = profile ? 'hybrid' : 'text';
  writeAudit({ conversationIds, query, mode, textCount: textResults.length, vectorCount: vectorResults.length, memoryIds: final.map(item => item.memory_id), fallbackReason });
  logRagResult({
    query,
    conversationIds,
    mode,
    embeddingSource,
    embeddingElapsedMs,
    rerankerSource,
    rerankerElapsedMs,
    elapsedMs: Date.now() - startedAt,
    results: final,
    fallbackReason,
  });
  return final;
  })();
  if (timeoutMs) {
    return Promise.race([
      run,
      new Promise(resolve => setTimeout(() => resolve([]), timeoutMs)),
    ]);
  }
  return run;
}

export function textSearch(query, conversationScope = null, limit = 20) {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const conversationIds = normalizeConversationIds(null, conversationScope);
  const ftsResults = ftsSearch(tokens, conversationIds, limit);
  const ngramResults = ngramSearch(tokens, conversationIds, limit);
  return rrfFusion([ftsResults, ngramResults], limit);
}

function ftsSearch(tokens, conversationIds, limit) {
  const db = getDb();
  const matchQuery = tokens.map(token => `"${token.replace(/"/g, '""')}"*`).join(' OR ');
  const params = [matchQuery];
  let sql = `
    SELECT mf.*, bm25(memory_fragments_fts, 5.0, 1.0, 3.0) AS bm25_score
    FROM memory_fragments_fts
    JOIN memory_fragments mf ON mf.id = memory_fragments_fts.rowid
    WHERE memory_fragments_fts MATCH ? AND mf.status = 'active'
  `;
  sql = appendConversationFilter(sql, params, conversationIds);
  sql += ` ORDER BY bm25_score ASC, COALESCE(mf.updated_at, mf.created_at) DESC LIMIT ?`;
  params.push(limit);
  try {
    return db.prepare(sql).all(...params).map((row, index) => formatRow(row, 'fts', 1 / (index + 1)));
  } catch (error) {
    console.warn('[memorySearch] FTS fallback:', error.message);
    return [];
  }
}

function ngramSearch(tokens, conversationIds, limit) {
  const db = getDb();
  const conditions = tokens.map(() => `(mf.judgment LIKE ? OR mf.reasoning LIKE ? OR mf.tags LIKE ?)`).join(' OR ');
  const scoreParts = tokens.map(() => `(CASE WHEN mf.judgment LIKE ? THEN 4 ELSE 0 END + CASE WHEN mf.tags LIKE ? THEN 3 ELSE 0 END + CASE WHEN mf.reasoning LIKE ? THEN 1 ELSE 0 END)`).join(' + ');
  const params = [];
  for (const token of tokens) params.push(`%${token}%`, `%${token}%`, `%${token}%`);
  for (const token of tokens) params.push(`%${token}%`, `%${token}%`, `%${token}%`);
  let sql = `
    SELECT mf.*, (${scoreParts}) AS text_score
    FROM memory_fragments mf
    WHERE mf.status = 'active' AND (${conditions})
  `;
  sql = appendConversationFilter(sql, params, conversationIds);
  sql += ` ORDER BY text_score DESC, COALESCE(mf.updated_at, mf.created_at) DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params).map(row => formatRow(row, 'ngram', Number(row.text_score || 0)));
}

function hydrateVectorResults(results, conversationIds) {
  const db = getDb();
  const hydrated = [];
  for (const result of results) {
    const memoryId = result.metadata?.memory_id || result.id;
    const params = [memoryId];
    let sql = `SELECT * FROM memory_fragments WHERE memory_id = ? AND status = 'active'`;
    sql = appendConversationFilter(sql, params, conversationIds, 'conversation_id');
    const row = db.prepare(sql).get(...params);
    if (row) hydrated.push(formatRow(row, 'vector', Number(result.score || 0)));
  }
  return hydrated;
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

function rrfFusion(resultSets, limit) {
  const map = new Map();
  for (const results of resultSets) {
    for (let index = 0; index < results.length; index++) {
      const item = results[index];
      const key = item.memory_id;
      const score = 1 / (RRF_K + index + 1);
      if (!map.has(key)) map.set(key, { ...item, score: 0, sources: [] });
      const target = map.get(key);
      target.score += score;
      for (const source of item.sources || []) {
        if (!target.sources.includes(source)) target.sources.push(source);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

function formatRow(row, source, score) {
  const tags = parseTags(row.tags);
  return {
    id: row.memory_id,
    memory_id: row.memory_id,
    conversation_id: row.conversation_id,
    memory_type: row.memory_type || (row.fragment_type === 'emotion' ? 'emotion' : 'knowledge'),
    subject: row.subject || 'user',
    judgment: row.judgment || row.content,
    reasoning: row.reasoning || '',
    tags,
    content: row.judgment || row.content,
    fragment_type: row.memory_type || row.fragment_type,
    entities: tags,
    score,
    sources: [source],
  };
}

function queryTokens(query) {
  const raw = String(query || '').toLowerCase().match(/[\p{Script=Han}]{2,}|[a-z0-9_+-]{2,}/gu) || [];
  const tokens = new Set();
  for (const token of raw) {
    tokens.add(token);
    if (/^[\p{Script=Han}]+$/u.test(token) && token.length > 2) {
      for (let i = 0; i < token.length - 1; i++) tokens.add(token.slice(i, i + 2));
    }
  }
  return [...tokens].slice(0, 24);
}

function writeAudit({ conversationIds, query, mode, textCount, vectorCount, memoryIds, fallbackReason }) {
  try {
    const conversationScope = conversationIds.length <= 1 ? (conversationIds[0] || null) : JSON.stringify(conversationIds);
    getDb().prepare(`
      INSERT INTO memory_retrieval_audits(conversation_id, query, mode, candidate_sources, memory_ids, fallback_reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversationScope, String(query).slice(0, 1000), mode, JSON.stringify({ text: textCount, vector: vectorCount }), JSON.stringify(memoryIds), fallbackReason);
  } catch (error) {
    console.error('[memorySearch] audit failed:', error.message);
  }
}

function logRagResult({ query, conversationIds, mode, embeddingSource, embeddingElapsedMs, rerankerSource, rerankerElapsedMs, elapsedMs, results, fallbackReason }) {
  const scope = conversationIds.length ? conversationIds.join(',') : 'all';
  const summary = results.length
    ? results.map((item, index) => `${index + 1}:${singleLine(item.judgment || item.content, 36)}`).join(' | ')
    : '-';
  const fallback = fallbackReason ? ` fallback="${singleLine(fallbackReason, 80)}"` : '';
  console.log(`[RAG] q="${singleLine(query, 60)}" scope=${singleLine(scope, 120)} retrieval=${mode === 'hybrid' ? '混合检索(hybrid)' : '文字检索(text)'} embedding=${sourceWithElapsed(embeddingSource, embeddingElapsedMs)} rerank=${sourceWithElapsed(rerankerSource, rerankerElapsedMs)} cost=${elapsedMs}ms hits=${results.length}${fallback} results=${summary}`);
}

function sourceLabel(source) {
  return ({ user: '自定义', builtin: '系统内置', local: '本地', skipped: '未执行', failed: '失败', unknown: '未知' })[source] || source || '未知';
}

function sourceWithElapsed(source, elapsedMs) {
  const elapsed = Number.isFinite(elapsedMs) ? `(${elapsedMs}ms)` : '';
  return `${sourceLabel(source)}${elapsed}`;
}

function singleLine(value, maxLength) {
  const text = String(value || '').replace(/[\r\n\t|]+/g, ' ').replace(/"/g, "'").replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function clamp(value, min, max) {
  const number = Number.parseInt(value, 10);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : min));
}
