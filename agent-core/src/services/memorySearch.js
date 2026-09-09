import { getDb } from '../db/index.js';
import { vectorSearch } from './vectorClient.js';
import { getMemorySettings, isMemoryV3Enabled } from './memory/memoryConfig.js';
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
  const textResults = textSearch(query, conversationIds, textLimit, { includeHistorical: options.includeHistorical });
  // v3 实体通道（Mem0 平行实体集合思路）：查询词命中实体名/别名 → 反查关联记忆，作为独立信号参与 RRF
  const entityResults = isMemoryV3Enabled() ? entitySearch(query, conversationIds, textLimit, { includeHistorical: options.includeHistorical }) : [];
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
    vectorResults = hydrateVectorResults(raw, conversationIds, { includeHistorical: options.includeHistorical });
    if (embeddingResult.source === 'local') fallbackReason = 'embedding: using local built-in model';
  } catch (error) {
    fallbackReason = `embedding: ${error.message}`;
  }

  const candidateSets = [textResults];
  if (profile) candidateSets.push(vectorResults);
  if (entityResults.length) candidateSets.push(entityResults);
  let candidates = candidateSets.length > 1
    ? rrfFusion(candidateSets, Math.max(topK, settings.reranker.topN || topK))
    : textResults;
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
  writeAudit({ conversationIds, query, mode, textCount: textResults.length, vectorCount: vectorResults.length, entityCount: entityResults.length, memoryIds: final.map(item => item.memory_id), fallbackReason });
  logRagResult({
    query,
    conversationIds,
    mode,
    embeddingSource,
    embeddingElapsedMs,
    rerankerSource,
    rerankerElapsedMs,
    entityCount: entityResults.length,
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

export function textSearch(query, conversationScope = null, limit = 20, { includeHistorical = false } = {}) {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const conversationIds = normalizeConversationIds(null, conversationScope);
  const ftsResults = ftsSearch(tokens, conversationIds, limit, { includeHistorical });
  const ngramResults = ngramSearch(tokens, conversationIds, limit, { includeHistorical });
  return rrfFusion([ftsResults, ngramResults], limit);
}

// 现行可见性过滤：默认只看 active 且未失效（双时态现行）；历史模式（@memory 时态查询）
// 放宽到 superseded 也可见，结果由调用方标注 [历史·过时] 徽标（docs/memory-upgrade-plan.md §5.3）
function visibilityFilter(includeHistorical, column = 'mf') {
  const c = column ? `${column}.` : '';
  return includeHistorical
    ? `${c}status IN ('active', 'superseded')`
    : `${c}status = 'active' AND ${c}valid_to IS NULL`;
}

function ftsSearch(tokens, conversationIds, limit, { includeHistorical = false } = {}) {
  const db = getDb();
  const matchQuery = tokens.map(token => `"${token.replace(/"/g, '""')}"*`).join(' OR ');
  const params = [matchQuery];
  // 六列权重：judgment/reasoning/tags 为 v2 列，keywords/perspectives/episodic_note 为 v3 检索单元列
  //（semantic_note 刻意不进 FTS，见 docs/memory-upgrade-plan.md §2）
  let sql = `
    SELECT mf.*, bm25(memory_fragments_fts, 5.0, 1.0, 3.0, 4.0, 2.5, 1.5) AS bm25_score
    FROM memory_fragments_fts
    JOIN memory_fragments mf ON mf.id = memory_fragments_fts.rowid
    WHERE memory_fragments_fts MATCH ? AND ${visibilityFilter(includeHistorical)}
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

// ngram 通道的匹配列与权重。v3 扩展了 keywords/perspectives/episodic_note（MMS 检索单元）；
// semantic_note 刻意不进任何检索通道（注入单元专用）。存量行这些列是 '[]'/''，LIKE 永不命中，行为不变。
const NGRAM_COLUMNS = [
  ['judgment', 4],
  ['tags', 3],
  ['keywords', 4],
  ['perspectives', 2],
  ['episodic_note', 2],
  ['reasoning', 1],
];

function ngramSearch(tokens, conversationIds, limit, { includeHistorical = false } = {}) {
  const db = getDb();
  const conditions = tokens.map(() => `(${NGRAM_COLUMNS.map(([column]) => `mf.${column} LIKE ?`).join(' OR ')})`).join(' OR ');
  const scoreParts = tokens.map(() => `(${NGRAM_COLUMNS.map(([column, weight]) => `CASE WHEN mf.${column} LIKE ? THEN ${weight} ELSE 0 END`).join(' + ')})`).join(' + ');
  // SELECT(scoreParts) 在 SQL 文本中先于 WHERE(conditions) 出现，两组占位符的参数序列完全一致
  // （每个 token 每列一个 %token%），按同一顺序重复两遍绑定即可（沿用原实现的等价绑定方式）
  const tokenLikeParams = [];
  for (const token of tokens) {
    for (let i = 0; i < NGRAM_COLUMNS.length; i++) tokenLikeParams.push(`%${token}%`);
  }
  const params = [...tokenLikeParams, ...tokenLikeParams];
  let sql = `
    SELECT mf.*, (${scoreParts}) AS text_score
    FROM memory_fragments mf
    WHERE ${visibilityFilter(includeHistorical)} AND (${conditions})
  `;
  sql = appendConversationFilter(sql, params, conversationIds);
  sql += ` ORDER BY text_score DESC, COALESCE(mf.updated_at, mf.created_at) DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params).map(row => formatRow(row, 'ngram', Number(row.text_score || 0)));
}

// 实体通道：查询 token 命中实体（名字相等 > 互相包含 > 别名）→ 反查关联记忆，
// 按实体命中分 × 链接角色权重（subject 3 / object 2 / mention 1）排序。
function entitySearch(query, conversationIds, limit, { includeHistorical = false } = {}) {
  const db = getDb();
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const matched = matchEntities(db, tokens);
  if (matched.length === 0) return [];
  const entityScoreCase = matched.map(entity => `WHEN ${Number(entity.id)} THEN ${Number(entity.score)}`).join(' ');
  const params = matched.map(entity => entity.id);
  let sql = `
    SELECT mf.*, SUM(CASE mel.entity_id ${entityScoreCase} ELSE 0 END * CASE mel.role WHEN 'subject' THEN 3 WHEN 'object' THEN 2 ELSE 1 END) AS entity_score
    FROM memory_entity_links mel
    JOIN memory_fragments mf ON mf.memory_id = mel.memory_id
    WHERE mel.entity_id IN (${matched.map(() => '?').join(',')}) AND ${visibilityFilter(includeHistorical)}
  `;
  sql = appendConversationFilter(sql, params, conversationIds);
  sql += ` GROUP BY mf.memory_id ORDER BY entity_score DESC, COALESCE(mf.updated_at, mf.created_at) DESC LIMIT ?`;
  params.push(limit);
  try {
    return db.prepare(sql).all(...params).map(row => formatRow(row, 'entity', Number(row.entity_score || 0)));
  } catch (error) {
    console.warn('[memorySearch] entity search failed:', error.message);
    return [];
  }
}

function matchEntities(db, tokens) {
  const conditions = [];
  const params = [];
  for (const token of tokens) {
    conditions.push(`(name = ? OR name LIKE ? OR aliases LIKE ? OR ? LIKE '%' || name || '%')`);
    params.push(token, `%${token}%`, `%${token}%`, token);
  }
  try {
    const rows = db.prepare(`SELECT id, name, aliases FROM memory_entities WHERE ${conditions.join(' OR ')} LIMIT 48`).all(...params);
    return rows
      .map(row => {
        const aliases = parseTags(row.aliases);
        let score = 1;
        for (const token of tokens) {
          if (row.name === token) score = Math.max(score, 5);
          else if (row.name.includes(token) || token.includes(row.name)) score = Math.max(score, 3);
          else if (aliases.some(alias => alias.includes(token) || token.includes(alias))) score = Math.max(score, 2);
        }
        return { id: row.id, name: row.name, score };
      })
      .filter(entity => entity.score > 1);
  } catch (error) {
    console.warn('[memorySearch] entity match failed:', error.message);
    return [];
  }
}

function hydrateVectorResults(results, conversationIds, { includeHistorical = false } = {}) {
  const db = getDb();
  const hydrated = [];
  for (const result of results) {
    const memoryId = result.metadata?.memory_id || result.id;
    const params = [memoryId];
    let sql = `SELECT * FROM memory_fragments WHERE memory_id = ? AND ${visibilityFilter(includeHistorical, '')}`;
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

// RRF 融合（K=60）：供 hybridSearch 内部与阶段二 activeSearch 共用
export function rrfFusion(resultSets, limit) {
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

// 导出给 activeSearch（阶段二主动回想）复用统一的结果形态
export function formatRow(row, source, score) {
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
    status: row.status || 'active',
    content: row.judgment || row.content,
    fragment_type: row.memory_type || row.fragment_type,
    entities: tags,
    // v3 多重表示：注入侧读 semantic_note（MMS 注入单元），检索侧不再单独消费这些字段
    keywords: parseTags(row.keywords),
    perspectives: parseTags(row.perspectives),
    semantic_note: row.semantic_note || '',
    episodic_note: row.episodic_note || '',
    event_time: row.event_time || null,
    valid_from: row.valid_from || null,
    valid_to: row.valid_to || null,
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

function writeAudit({ conversationIds, query, mode, textCount, vectorCount, entityCount = 0, memoryIds, fallbackReason }) {
  try {
    const conversationScope = conversationIds.length <= 1 ? (conversationIds[0] || null) : JSON.stringify(conversationIds);
    getDb().prepare(`
      INSERT INTO memory_retrieval_audits(conversation_id, query, mode, candidate_sources, memory_ids, fallback_reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversationScope, String(query).slice(0, 1000), mode, JSON.stringify({ text: textCount, vector: vectorCount, entity: entityCount }), JSON.stringify(memoryIds), fallbackReason);
  } catch (error) {
    console.error('[memorySearch] audit failed:', error.message);
  }
}

function logRagResult({ query, conversationIds, mode, embeddingSource, embeddingElapsedMs, rerankerSource, rerankerElapsedMs, entityCount = 0, elapsedMs, results, fallbackReason }) {
  const scope = conversationIds.length ? conversationIds.join(',') : 'all';
  const summary = results.length
    ? results.map((item, index) => `${index + 1}:${singleLine(item.judgment || item.content, 36)}`).join(' | ')
    : '-';
  const fallback = fallbackReason ? ` fallback="${singleLine(fallbackReason, 80)}"` : '';
  console.log(`[RAG] q="${singleLine(query, 60)}" scope=${singleLine(scope, 120)} retrieval=${mode === 'hybrid' ? '混合检索(hybrid)' : '文字检索(text)'} embedding=${sourceWithElapsed(embeddingSource, embeddingElapsedMs)} entity=${entityCount} rerank=${sourceWithElapsed(rerankerSource, rerankerElapsedMs)} cost=${elapsedMs}ms hits=${results.length}${fallback} results=${summary}`);
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
