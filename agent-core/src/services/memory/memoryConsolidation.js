/**
 * Memory v3 阶段三：记忆整理任务集（docs/memory-upgrade-plan.md §6.2）
 *
 * 六个整理任务，按"记忆的睡眠期"设计——只在用户不聊天时由 daemon 调用：
 *   T1 冲突消解   runConflictResolutionTask      LLM   矛盾旧记忆 → applyMemoryActions('update') 双时态失效
 *   T2 泛化升华   runGeneralizationTask          LLM   同实体情景簇 → 归纳 knowledge 语义记忆（原记忆保留，importance-1）
 *   T3 强度衰减   runDecayTask                   SQL   遗忘曲线 → strength < 阈值 → archived + 向量墓碑
 *   T4 核心升华   runPortraitSuggestionTask      LLM   importance≥4 knowledge → portrait_suggestions 待人工确认
 *   T5 表示回填   runBackfillTask                LLM   缺 v3 检索字段的旧记忆批量补齐 → stale 触发重嵌入
 *   T6 墓碑扫描   runTombstoneTask               SQL   已失效但仍带向量的记忆补发 delete 任务（幂等）
 *
 * 职责边界：本文件只实现"一个任务怎么跑"；调度/空闲判定/LLM 预算/任务队列在
 * consolidationScheduler.js。所有函数依赖可注入（db/llm/落库动作），单测用 :memory: 库。
 */

import { applyMemoryActions, insertGeneralizedMemory } from './memoryRepository.js';
import { isMemoryV3Enabled } from './memoryConfig.js';

// ── 遗忘曲线参数（方案 §6.2 T3）──

export const HALF_LIFE_DAYS = Object.freeze({ event: 14, emotion: 60, knowledge: 180, skill: 180 });
export const ARCHIVE_THRESHOLD = 0.15;

// LLM 任务类型集合（调度器据此做预算闸门）
export const LLM_JOB_TYPES = new Set(['conflict', 'generalize', 'portrait_suggest', 'backfill']);

// ── 整理记账（防止同一批候选被反复送进 LLM）──
//
// 候选发现只按时间窗/状态筛选，模型判定"无关 / 归纳不出结论 / 补不出字段"时不产生任何内容写入。
// 若不做记账，同一批候选会在每轮扫描（默认 5 分钟，用户离开后空闲判定恒为真）里被无限重复送进 LLM。
// 记账键按任务类型区分：
//   conflict        → memory_id
//   generalize      → conversation_id|entity_id|subject（组级：成员会随新记忆变化）
//   portrait_suggest→ conversation_id
//   backfill        → memory_id
// TTL 到期后同一条记忆/组可以被重新整理（内容可能已变化）。
export const RECONSOLIDATE_AFTER_DAYS = Object.freeze({
  conflict: 7,
  generalize: 30,
  portrait_suggest: 14,
  backfill: 30,
});

// 记账行保留期：远超所有 TTL，过期行由 T3 维护清理删除
export const MARK_RETENTION_DAYS = 180;

// 统一时间形态（与 memory_fragments.created_at 一致：UTC 'YYYY-MM-DD HH:MM:SS' 字符串可比）
function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function markCutoff(jobType, now = new Date()) {
  return sqliteTime(new Date(now.getTime() - (RECONSOLIDATE_AFTER_DAYS[jobType] ?? 30) * 86400000));
}

/** 泛化组的记账键（必须与 findGeneralizationGroups 里的 SQL 拼接表达式逐字一致）。 */
export function generalizationMarkKey({ conversation_id: conversationId, entity_id: entityId, subject }) {
  return `${conversationId ?? ''}|${entityId}|${subject ?? ''}`;
}

/**
 * 记账：标记"这批候选已经问过模型了"（无论模型给出什么结论）。
 * 只应在 LLM 成功返回后调用——调用抛错时不记账，下一轮自然重试。
 */
export function markConsolidated(db, jobType, keys, { now = new Date() } = {}) {
  const list = [...new Set((keys || []).map(key => String(key ?? '')).filter(Boolean))];
  if (!db || list.length === 0) return 0;
  const at = sqliteTime(now);
  const stmt = db.prepare(`
    INSERT INTO memory_consolidation_marks(job_type, mark_key, marked_at) VALUES (?, ?, ?)
    ON CONFLICT(job_type, mark_key) DO UPDATE SET marked_at = excluded.marked_at
  `);
  const tx = db.transaction(() => { for (const key of list) stmt.run(jobType, key, at); });
  tx();
  return list.length;
}

/** 尚未过期（仍在 TTL 内）的记账键，供测试与排查使用。 */
export function listActiveMarks(db, jobType, { now = new Date() } = {}) {
  if (!db) return [];
  return db.prepare(`
    SELECT mark_key FROM memory_consolidation_marks WHERE job_type = ? AND marked_at >= ?
  `).all(jobType, markCutoff(jobType, now)).map(row => row.mark_key);
}

// SQLite 时间统一成可比较/可解析形态（存储里 'T' 与空格两种分隔符并存）
export function normalizeSqliteTime(value) {
  if (!value) return null;
  return String(value).replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

/**
 * 遗忘曲线强度：strength = (importance/5) × exp(-Δdays/halfLife) × (1 + 0.1·ln(1+retrieval_count))
 * 纯函数，可解释性的唯一来源——日志/管理界面展示构成时直接引用这几个量。
 */
export function computeStrength({ importance, daysSinceAnchor, halfLifeDays, retrievalCount = 0 }) {
  const base = Math.min(5, Math.max(1, importance)) / 5;
  const decay = Math.exp(-Math.max(0, daysSinceAnchor) / Math.max(1, halfLifeDays));
  const reinforcement = 1 + 0.1 * Math.log(1 + Math.max(0, retrievalCount || 0));
  return base * decay * reinforcement;
}

// 强度锚点：最后被召回 > 事件时间 > 创建时间，取其中最新者（都没有 → 视为刚发生）。
// 刻意排除 updated_at——它会被强度回写/回填等非内容操作刷新，不应重置遗忘曲线。
export function pickAnchorTime(row) {
  const candidates = [row.last_reinforced_at, row.event_time, row.created_at]
    .map(normalizeSqliteTime)
    .filter(Boolean)
    .sort();
  const latest = candidates[candidates.length - 1];
  if (!latest) return null;
  const parsed = new Date(latest.replace(' ', 'T') + (latest.endsWith('Z') ? '' : 'Z'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ── T3 前置：召回审计聚合（近 N 天命中数写回检索强度字段，幂等重算）──

export function aggregateRetrievalAudits(db, { sinceDays = 90, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - sinceDays * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  // audits.memory_ids 是 JSON 数组列，用 json_each 展开成每记忆一行
  const rows = db.prepare(`
    SELECT je.value AS memory_id, COUNT(*) AS hits, MAX(a.created_at) AS last_hit
    FROM memory_retrieval_audits a, json_each(a.memory_ids) je
    WHERE a.created_at >= ?
    GROUP BY je.value
  `).all(cutoff);
  const update = db.prepare(`
    UPDATE memory_fragments SET retrieval_count = ?, last_reinforced_at = COALESCE(?, last_reinforced_at)
    WHERE memory_id = ?
  `);
  const tx = db.transaction(() => {
    for (const row of rows) update.run(row.hits, row.last_hit, row.memory_id);
  });
  tx();
  return rows.length;
}

// ── T3：强度衰减与归档（纯 SQL，零 LLM）──

/**
 * 遍历全部 active 记忆重算 strength 并写回；低于阈值的 → archived + 向量墓碑。
 * 返回归档明细（可解释：每条含强度构成），供日志与状态汇报。
 *
 * 写入约束：只在强度真的变化时才 UPDATE（`strength IS NOT ?`），
 * 否则每 6 小时一次的全表写会白白放大 WAL 写入量、与聊天写事务抢 SQLite 单写锁。
 * 语句在循环外 prepare，事务内复用。
 */
export function decayAndArchiveMemories(db, { now = new Date(), threshold = ARCHIVE_THRESHOLD, enqueueDelete, enqueueTripleDelete } = {}) {
  const rows = db.prepare(`
    SELECT memory_id, memory_type, importance, retrieval_count, embedding_state, chroma_id,
           last_reinforced_at, event_time, updated_at, created_at, strength
    FROM memory_fragments WHERE status = 'active'
  `).all();
  const archived = [];
  const updateStrength = db.prepare(`
    UPDATE memory_fragments SET strength = ? WHERE memory_id = ? AND status = 'active' AND strength IS NOT ?
  `);
  const archiveStmt = db.prepare(`
    UPDATE memory_fragments SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE memory_id = ? AND status = 'active'
  `);
  const selectTriples = db.prepare(`SELECT id FROM memory_triples WHERE memory_id = ? AND valid_to IS NULL`);
  const invalidateTriples = db.prepare(`UPDATE memory_triples SET valid_to = CURRENT_TIMESTAMP WHERE memory_id = ? AND valid_to IS NULL`);
  let strengthened = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const halfLifeDays = HALF_LIFE_DAYS[row.memory_type] ?? 180;
      const anchor = pickAnchorTime(row);
      const daysSinceAnchor = anchor ? (now.getTime() - anchor.getTime()) / 86400000 : 0;
      const strength = computeStrength({
        importance: row.importance,
        daysSinceAnchor,
        halfLifeDays,
        retrievalCount: row.retrieval_count,
      });
      const rounded = Math.round(strength * 10000) / 10000;
      if (rounded !== Number(row.strength)) {
        updateStrength.run(rounded, row.memory_id, rounded);
        strengthened++;
      }
      if (strength >= threshold) continue;
      archiveStmt.run(row.memory_id);
      // 归档即出检索通道：向量墓碑（v3 corpus）；三元组连带失效 + 墓碑
      if (row.embedding_state === 'indexed' || row.chroma_id) enqueueDelete?.(row.memory_id, row);
      const tripleIds = selectTriples.all(row.memory_id);
      if (tripleIds.length > 0) {
        invalidateTriples.run(row.memory_id);
        for (const triple of tripleIds) enqueueTripleDelete?.(triple.id);
      }
      archived.push({
        memoryId: row.memory_id,
        strength: rounded,
        importance: row.importance,
        halfLifeDays,
        daysSinceAnchor: Math.round(daysSinceAnchor * 10) / 10,
        retrievalCount: row.retrieval_count || 0,
        reason: `strength ${strength.toFixed(3)} < ${threshold}（重要度 ${row.importance}/5，半衰期 ${halfLifeDays} 天，距锚点 ${Math.round(daysSinceAnchor)} 天，近90天召回 ${row.retrieval_count || 0} 次）`,
      });
    }
  });
  tx();
  return { scanned: rows.length, strengthened, archived };
}

// ── 维护清理：为整理 daemon 产生的辅助数据设保留期（纯 SQL，随 T3 一起跑）──

/**
 * 审计/任务/记账三类辅助表的保留期清理。
 * 只删已终结的整理任务行（pending/processing 永不删，避免删掉正在跑的任务）。
 */
export function pruneConsolidationArtifacts(db, {
  now = new Date(),
  auditRetentionDays = 90,
  jobRetentionDays = 7,
  markRetentionDays = MARK_RETENTION_DAYS,
} = {}) {
  const olderThan = days => sqliteTime(new Date(now.getTime() - days * 86400000));
  return {
    audits: db.prepare(`DELETE FROM memory_retrieval_audits WHERE created_at < ?`).run(olderThan(auditRetentionDays)).changes,
    jobs: db.prepare(`DELETE FROM memory_consolidation_jobs WHERE status IN ('completed', 'failed') AND updated_at < ?`).run(olderThan(jobRetentionDays)).changes,
    marks: db.prepare(`DELETE FROM memory_consolidation_marks WHERE marked_at < ?`).run(olderThan(markRetentionDays)).changes,
  };
}

// ── T6：向量墓碑一致性扫描（幂等）──

/**
 * 找"已失效但向量仍在"的记忆/三元组补发 delete 任务。
 * 幂等依据：碎片看是否存在晚于状态变更时间的 delete 任务；三元组入队后 embedding_state 置 'disabled'。
 */
export function scanVectorTombstones(db, { limit = 200, enqueueDelete, enqueueTripleDelete } = {}) {
  const fragments = db.prepare(`
    SELECT mf.memory_id, mf.embedding_profile, mf.embedding_state FROM memory_fragments mf
    WHERE mf.status IN ('archived', 'superseded', 'deleted') AND mf.chroma_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM memory_index_jobs j
        WHERE j.job_type = 'delete' AND j.memory_id = mf.memory_id
          AND (j.status IN ('pending', 'processing') OR (j.status = 'completed' AND j.updated_at >= mf.updated_at))
      )
    LIMIT ?
  `).all(limit);
  for (const row of fragments) enqueueDelete?.(row.memory_id, row);

  const triples = db.prepare(`
    SELECT id FROM memory_triples
    WHERE valid_to IS NOT NULL AND embedding_state = 'indexed'
    LIMIT ?
  `).all(limit);
  const tx = db.transaction(() => {
    for (const triple of triples) {
      enqueueTripleDelete?.(triple.id);
      db.prepare(`UPDATE memory_triples SET embedding_state = 'disabled' WHERE id = ?`).run(triple.id);
    }
  });
  tx();
  return { fragments: fragments.length, triples: triples.length };
}

// ── T1~T5 候选发现（纯查询，供调度器决定是否入队 + runner 消费）──

// T1：近 N 天新建且有实体的记忆 → 各自找共享实体的更早 active 记忆，组成冲突候选簇。
// TTL 内已问过模型的记忆不再入选（否则模型说"无关"后同一簇每轮扫描都会重问）。
export function findConflictClusters(db, { sinceDays = 7, limit = 4, now = new Date(), maxOldPerCluster = 4 } = {}) {
  const cutoff = new Date(now.getTime() - sinceDays * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const recent = db.prepare(`
    SELECT mf.* FROM memory_fragments mf
    WHERE mf.status = 'active' AND mf.created_at >= ?
      AND EXISTS (SELECT 1 FROM memory_entity_links mel WHERE mel.memory_id = mf.memory_id)
      AND NOT EXISTS (
        SELECT 1 FROM memory_consolidation_marks mcm
        WHERE mcm.job_type = 'conflict' AND mcm.mark_key = mf.memory_id AND mcm.marked_at >= ?
      )
    ORDER BY mf.created_at DESC LIMIT 40
  `).all(cutoff, markCutoff('conflict', now));
  const clusters = [];
  const usedIds = new Set();
  for (const row of recent) {
    if (clusters.length >= limit) break;
    // 已被前面簇消费的记忆跳过继续找（不能 break——否则少收簇）
    if (usedIds.has(row.memory_id)) continue;
    const entityIds = db.prepare(`SELECT entity_id FROM memory_entity_links WHERE memory_id = ?`).all(row.memory_id).map(r => r.entity_id);
    if (entityIds.length === 0) continue;
    const placeholders = entityIds.map(() => '?').join(',');
    const olds = db.prepare(`
      SELECT DISTINCT mf.* FROM memory_fragments mf
      JOIN memory_entity_links mel ON mel.memory_id = mf.memory_id
      WHERE mf.status = 'active' AND mf.memory_id != ? AND mf.conversation_id = ?
        AND mf.created_at < ? AND mel.entity_id IN (${placeholders})
      ORDER BY mf.created_at ASC LIMIT ?
    `).all(row.memory_id, row.conversation_id, row.created_at, ...entityIds, maxOldPerCluster);
    if (olds.length === 0) continue;
    for (const old of olds) usedIds.add(old.memory_id);
    usedIds.add(row.memory_id);
    clusters.push({ conversationId: row.conversation_id, memories: [...olds, row] });
  }
  return clusters;
}

// 组内任一成员已存在存活的泛化后代（knowledge 子记忆仍 active）→ 该组已升华过，跳过。
// 没有这道去重，同一实体组会随 daemon 每轮扫描反复生成泛化记忆（content_hash 各不相同，无法靠去重兜住）。
function hasLivingGeneralization(db, memberIds) {
  const placeholders = memberIds.map(() => '?').join(',');
  return !!db.prepare(`
    SELECT 1 FROM memory_relations r
    JOIN memory_fragments mf ON mf.memory_id = r.to_memory_id
    WHERE r.from_memory_id IN (${placeholders})
      AND r.relation_meta LIKE '%"kind":"generalize"%'
      AND mf.status = 'active'
    LIMIT 1
  `).get(...memberIds);
}

// T2：同会话同实体同 subject 的 event/emotion ≥3 条且跨度 > 14 天 → 泛化候选组
// TTL 内已问过模型的组不再入选（模型明确"归纳不出结论"时同样记账，否则组永不消失）。
export function findGeneralizationGroups(db, { minCount = 3, spanDays = 14, limit = 2, now = new Date() } = {}) {
  const groups = db.prepare(`
    SELECT mf.conversation_id, mel.entity_id, me.name AS entity_name, mf.subject,
           COUNT(*) AS cnt,
           MIN(COALESCE(mf.event_time, mf.created_at)) AS oldest,
           MAX(COALESCE(mf.event_time, mf.created_at)) AS newest
    FROM memory_fragments mf
    JOIN memory_entity_links mel ON mel.memory_id = mf.memory_id
    JOIN memory_entities me ON me.id = mel.entity_id
    WHERE mf.status = 'active' AND mf.memory_type IN ('event', 'emotion')
      AND NOT EXISTS (
        SELECT 1 FROM memory_consolidation_marks mcm
        WHERE mcm.job_type = 'generalize' AND mcm.marked_at >= ?
          AND mcm.mark_key = COALESCE(mf.conversation_id, '') || '|' || mel.entity_id || '|' || COALESCE(mf.subject, '')
      )
    GROUP BY mf.conversation_id, mel.entity_id, mf.subject
    HAVING cnt >= ? AND (julianday(newest) - julianday(oldest)) >= ?
    ORDER BY cnt DESC, me.mention_count DESC LIMIT ?
  `).all(markCutoff('generalize', now), minCount, spanDays, limit);
  const result = [];
  for (const group of groups) {
    const members = db.prepare(`
      SELECT mf.* FROM memory_fragments mf
      JOIN memory_entity_links mel ON mel.memory_id = mf.memory_id
      WHERE mf.status = 'active' AND mf.conversation_id = ? AND mel.entity_id = ?
        AND mf.subject = ? AND mf.memory_type IN ('event', 'emotion')
      ORDER BY COALESCE(mf.event_time, mf.created_at) ASC LIMIT 6
    `).all(group.conversation_id, group.entity_id, group.subject);
    if (members.length < minCount) continue;
    if (hasLivingGeneralization(db, members.map(m => m.memory_id))) continue;
    result.push({ ...group, members });
  }
  return result;
}

// T4：importance≥4 的 knowledge 按会话聚合（每会话一次 LLM 调用生成画像建议）
// TTL 内已问过模型的会话不再入选（模型提不出新建议时同样记账，否则同一会话每轮都会被重问）。
export function findPortraitSuggestionConversations(db, { minImportance = 4, limit = 2, now = new Date() } = {}) {
  const rows = db.prepare(`
    SELECT mf.conversation_id, COUNT(*) AS cnt FROM memory_fragments mf
    WHERE mf.status = 'active' AND mf.memory_type = 'knowledge' AND mf.importance >= ?
      AND substr(mf.conversation_id, 1, 5) = 'char_'
      AND NOT EXISTS (
        SELECT 1 FROM memory_consolidation_marks mcm
        WHERE mcm.job_type = 'portrait_suggest' AND mcm.mark_key = mf.conversation_id AND mcm.marked_at >= ?
      )
    GROUP BY mf.conversation_id ORDER BY cnt DESC LIMIT ?
  `).all(minImportance, markCutoff('portrait_suggest', now), limit);
  return rows.map(row => ({
    conversationId: row.conversation_id,
    characterId: Number(String(row.conversation_id).match(/^char_(\d+)$/)?.[1]) || null,
    memories: db.prepare(`
      SELECT memory_id, judgment, semantic_note, importance FROM memory_fragments
      WHERE status = 'active' AND memory_type = 'knowledge' AND importance >= ? AND conversation_id = ?
      ORDER BY importance DESC, COALESCE(updated_at, created_at) DESC LIMIT 12
    `).all(minImportance, row.conversation_id),
  })).filter(item => item.characterId && item.memories.length > 0);
}

// T5：v3 检索字段（keywords/perspectives/semantic_note）全缺失的 active 旧记忆，最旧优先。
// TTL 内已补过的记忆不再入选（模型"宁可留空"时同样记账，否则同一批每轮都会被重补 + 重嵌入）。
// 额外带出待比较字段，供 runner 判断"是否真的需要写库"。
export function findBackfillCandidates(db, { limit = 10, now = new Date() } = {}) {
  return db.prepare(`
    SELECT mf.memory_id, mf.memory_type, mf.subject, mf.judgment, mf.reasoning, mf.tags, mf.created_at,
           mf.keywords, mf.perspectives, mf.semantic_note, mf.episodic_note, mf.importance
    FROM memory_fragments mf
    WHERE mf.status = 'active' AND (
      mf.keywords IS NULL OR mf.keywords IN ('', '[]')
      OR mf.perspectives IS NULL OR mf.perspectives IN ('', '[]')
      OR mf.semantic_note IS NULL OR mf.semantic_note = ''
    )
      AND NOT EXISTS (
        SELECT 1 FROM memory_consolidation_marks mcm
        WHERE mcm.job_type = 'backfill' AND mcm.mark_key = mf.memory_id AND mcm.marked_at >= ?
      )
    ORDER BY COALESCE(mf.updated_at, mf.created_at) ASC, mf.id ASC LIMIT ?
  `).all(markCutoff('backfill', now), limit);
}

// T5 是否还有存量（调度器据此决定是否续队）
export function hasBackfillCandidates(db) {
  return findBackfillCandidates(db, { limit: 1 }).length > 0;
}

// ── 通用 LLM 辅助 ──

function parseJsonObject(raw) {
  let text = String(raw || '').trim();
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text);
}

const LLM_OPTS = { temperature: 0.2, max_tokens: 1500, response_format: { type: 'json_object' }, label: '记忆整理' };

// ── T1：冲突消解 runner ──

/**
 * 每簇一次 LLM 调用。产出两种决议：
 *   conflict → 新事实替代旧事实：applyMemoryActions('update')，旧记忆双时态失效、血缘 update
 *   duplicate → 包含/重复：applyMemoryActions('merge')，多条并一条
 * 预算：llmBudgetRemaining 每次调用前扣减，耗尽即停并报告 done:false（调度器续队）。
 */
export async function runConflictResolutionTask({ clusters, llmBudgetRemaining = 0, deps = {} } = {}) {
  const chatSync = deps.chatSync;
  const db = deps.db;
  const applyActions = deps.applyMemoryActions || applyMemoryActions;
  let llmCalls = 0;
  let applied = 0;
  let skipped = 0;
  for (const cluster of clusters || []) {
    if (llmCalls >= llmBudgetRemaining) return { llmCalls, applied, skipped, done: false };
    const listing = cluster.memories.map((m, index) => {
      const note = m.semantic_note ? `（转述：${m.semantic_note}）` : '';
      return `${index + 1}. ${m.memory_id} [${m.memory_type}|主体:${m.subject}] ${m.judgment}${note}`;
    }).join('\n');
    const prompt = `你是记忆冲突调解器。下面是同一段关系里的几条既有记忆（编号即顺序，越靠后越新）。

${listing}

逐条判断它们之间是否存在矛盾或重复：
- 矛盾：后一条事实与前一条不能同时成立（如"讨厌狗"→"收养了流浪狗"），输出 type=conflict，给出替代旧记忆的新事实
- 重复/包含：几条说的其实是同一件事，输出 type=duplicate，合并成一条
- 无关（只是共享实体但各说各事）不要输出
- 新产出（updatedFact/mergedFact）尽量带上 keywords（3~8 个检索词）和 semanticNote（一句可转述的口语版），便于直接按完整形态入库

只返回严格 JSON：{"resolutions":[{"type":"conflict","outdatedMemoryId":"被替代的记忆ID","updatedFact":"一句独立清楚的新判断句","memoryType":"knowledge|event|emotion|skill","subject":"user|character|relationship|assistant","reasoning":"判断依据","tags":["标签"],"keywords":["检索词"],"semanticNote":"口语版转述"} 或 {"type":"duplicate","sourceMemoryIds":["要合并的记忆ID"],"mergedFact":"合并后的一句话","reasoning":"判断依据","tags":["标签"],"keywords":["检索词"],"semanticNote":"口语版转述"}]}`;
    llmCalls++;
    let resolutions = [];
    try {
      const raw = await chatSync([{ role: 'user', content: prompt }], LLM_OPTS);
      resolutions = parseJsonObject(raw).resolutions || [];
    } catch (error) {
      // 调用失败不记账：下一轮自然重试（与"模型判定无关"区分开）
      console.warn('[memory-consolidation] T1 LLM failed:', error.message);
      continue;
    }
    // 记账：本簇已被模型判定过（含"无关"结论）。不记账则同一簇每轮扫描都会重问，永不停止。
    markConsolidated(db, 'conflict', cluster.memories.map(m => m.memory_id));
    for (const resolution of resolutions.slice(0, 3)) {
      try {
        if (resolution.type === 'conflict' && resolution.outdatedMemoryId && resolution.updatedFact) {
          if (!cluster.memories.some(m => m.memory_id === resolution.outdatedMemoryId)) { skipped++; continue; }
          applyActions({
            conversationId: cluster.conversationId,
            sourceRawStartId: Math.min(...cluster.memories.map(m => m.source_raw_start_id ?? 0)) || null,
            sourceRawEndId: Math.max(...cluster.memories.map(m => m.source_raw_end_id ?? 0)) || null,
            actions: [{
              action: 'update',
              sourceMemoryIds: [resolution.outdatedMemoryId],
              memory: {
                memoryType: resolution.memoryType || 'knowledge',
                subject: resolution.subject || 'user',
                judgment: String(resolution.updatedFact).slice(0, 300),
                reasoning: String(resolution.reasoning || '整理 daemon 冲突消解').slice(0, 300),
                tags: Array.isArray(resolution.tags) ? resolution.tags.map(String).slice(0, 8) : ['整理'],
                // v3 检索/注入字段：决议直接带上，避免替代记忆降级为 v2 形态再等 T5 回填
                keywords: resolution.keywords,
                semanticNote: resolution.semanticNote,
              },
            }],
          });
          applied++;
        } else if (resolution.type === 'duplicate' && Array.isArray(resolution.sourceMemoryIds) && resolution.sourceMemoryIds.length >= 2) {
          const validIds = resolution.sourceMemoryIds.filter(id => cluster.memories.some(m => m.memory_id === id));
          if (validIds.length < 2) { skipped++; continue; }
          applyActions({
            conversationId: cluster.conversationId,
            sourceRawStartId: Math.min(...cluster.memories.map(m => m.source_raw_start_id ?? 0)) || null,
            sourceRawEndId: Math.max(...cluster.memories.map(m => m.source_raw_end_id ?? 0)) || null,
            actions: [{
              action: 'merge',
              sourceMemoryIds: validIds,
              memory: {
                memoryType: 'knowledge',
                subject: cluster.memories[0]?.subject || 'user',
                judgment: String(resolution.mergedFact || resolution.updatedFact || validIds.length + '条记忆合并').slice(0, 300),
                reasoning: String(resolution.reasoning || '整理 daemon 重复合并').slice(0, 300),
                tags: Array.isArray(resolution.tags) ? resolution.tags.map(String).slice(0, 8) : ['整理'],
                keywords: resolution.keywords,
                semanticNote: resolution.semanticNote,
              },
            }],
          });
          applied++;
        } else {
          skipped++;
        }
      } catch (error) {
        skipped++;
        console.warn('[memory-consolidation] T1 apply failed:', error.message);
      }
    }
  }
  return { llmCalls, applied, skipped, done: true };
}

// ── T2：泛化升华 runner ──

/**
 * 每组一次 LLM 调用归纳一条 knowledge；原记忆保留、importance 降 1，
 * 血缘 memory_relations(action='merge', relation_meta={"kind":"generalize"})。
 */
export async function runGeneralizationTask({ groups, llmBudgetRemaining = 0, deps = {} } = {}) {
  const chatSync = deps.chatSync;
  const db = deps.db;
  const insertGeneralized = deps.insertGeneralizedMemory || insertGeneralizedMemory;
  let llmCalls = 0;
  let applied = 0;
  let skipped = 0;
  for (const group of groups || []) {
    if (llmCalls >= llmBudgetRemaining) return { llmCalls, applied, skipped, done: false };
    const listing = group.members.map((m, index) => {
      const when = m.event_time || m.created_at || '';
      return `${index + 1}. [${when.slice(0, 10)}] ${m.judgment}`;
    }).join('\n');
    const prompt = `你是记忆归纳器。下面是围绕"${group.entity_name || '同一事物'}"的多条情景/情绪记忆（时间跨度超过两周）：

${listing}

请从中归纳出一条稳定的、面向未来的 knowledge 语义记忆（模式级结论，不是罗列）。
例如多条"换季感冒"记录 → "他体质偏弱，换季容易感冒"。
如果这些记录归纳不出任何稳定结论，输出 {"generalization": null}。

只返回严格 JSON：{"generalization":{"judgment":"一句独立清楚的判断句","semanticNote":"可向他人转述的口语版","reasoning":"归纳依据（引用了几条什么样的记录）","tags":["标签"],"importance":3}}`;
    llmCalls++;
    let generalization = null;
    try {
      const raw = await chatSync([{ role: 'user', content: prompt }], LLM_OPTS);
      generalization = parseJsonObject(raw).generalization;
    } catch (error) {
      console.warn('[memory-consolidation] T2 LLM failed:', error.message);
      continue;
    }
    // 记账：无论模型是否归纳出结论，本组都已被判定过。
    // 若不记账，"归纳不出结论"（prompt 明确允许 {"generalization":null}）的组会每轮重问。
    markConsolidated(db, 'generalize', [generalizationMarkKey(group)]);
    if (!generalization?.judgment) { skipped++; continue; }
    try {
      const memoryId = insertGeneralized({
        conversationId: group.conversation_id,
        memory: {
          memoryType: 'knowledge',
          subject: group.subject || 'user',
          judgment: String(generalization.judgment).slice(0, 300),
          reasoning: String(generalization.reasoning || '整理 daemon 泛化升华').slice(0, 300),
          tags: Array.isArray(generalization.tags) ? generalization.tags.map(String).slice(0, 8) : ['泛化'],
          semanticNote: String(generalization.semanticNote || '').slice(0, 400),
          importance: Math.min(5, Math.max(1, Number(generalization.importance) || 3)),
          entities: [{ name: group.entity_name || '泛化', role: 'subject' }],
        },
        sourceMemoryIds: group.members.map(m => m.memory_id),
        relationMeta: { kind: 'generalize' },
      });
      if (memoryId) applied++;
    } catch (error) {
      console.warn('[memory-consolidation] T2 insert failed:', error.message);
    }
  }
  return { llmCalls, applied, skipped, done: true };
}

// ── T4：核心记忆升华 runner（半自动：只产出建议，人工确认后才入画像）──

export async function runPortraitSuggestionTask({ conversations, llmBudgetRemaining = 0, deps = {} } = {}) {
  const chatSync = deps.chatSync;
  const db = deps.db;
  let llmCalls = 0;
  let suggestions = 0;
  for (const conversation of conversations || []) {
    if (llmCalls >= llmBudgetRemaining) return { llmCalls, suggestions, done: false };
    const existingPortraits = db.prepare(`SELECT trait_type, content FROM user_portraits WHERE character_id = ?`).all(conversation.characterId);
    const pending = db.prepare(`SELECT suggestion FROM portrait_suggestions WHERE character_id = ? AND status = 'pending'`).all(conversation.characterId);
    const listing = conversation.memories.map(m => `- ${m.judgment}${m.semantic_note ? `（转述：${m.semantic_note}）` : ''} [重要度${m.importance}]`).join('\n');
    const portraitLines = existingPortraits.map(p => `- [${p.trait_type}] ${p.content}`).join('\n') || '（暂无画像）';
    const pendingLines = pending.map(p => `- ${p.suggestion}`).join('\n') || '（无待确认建议）';
    const prompt = `你是用户画像提炼器。以下是某角色眼中关于用户的高重要度记忆：

${listing}

该角色已有的用户画像：
${portraitLines}

已在等待确认的建议（不要重复提出）：
${pendingLines}

请提炼 0~3 条值得加入画像的稳定特征（性格 personality 或偏好 preference），必须是记忆中有依据的，不要照抄已有画像。
只返回严格 JSON：{"suggestions":[{"field":"personality|preference","suggestion":"一句画像描述","sourceMemoryIds":["依据的记忆ID（如果记忆有列出）"]}]}`;
    llmCalls++;
    let items = [];
    try {
      const raw = await chatSync([{ role: 'user', content: prompt }], LLM_OPTS);
      items = parseJsonObject(raw).suggestions || [];
    } catch (error) {
      console.warn('[memory-consolidation] T4 LLM failed:', error.message);
      continue;
    }
    // 记账：本会话已被模型提炼过（含"提不出新建议"）。不记账则同一会话每轮都要重问一遍。
    markConsolidated(db, 'portrait_suggest', [conversation.conversationId]);
    for (const item of items.slice(0, 3)) {
      const field = item.field === 'preference' ? 'preference' : 'personality';
      const suggestion = String(item.suggestion || '').trim().slice(0, 200);
      if (!suggestion) continue;
      if (pending.some(p => p.suggestion === suggestion)) continue;
      if (existingPortraits.some(p => p.content === suggestion)) continue;
      const sourceIds = (Array.isArray(item.sourceMemoryIds) ? item.sourceMemoryIds : []).map(String).filter(id => conversation.memories.some(m => m.memory_id === id));
      db.prepare(`
        INSERT INTO portrait_suggestions(character_id, field, current_value, suggestion, source_memory_ids, status)
        VALUES (?, ?, NULL, ?, ?, 'pending')
      `).run(conversation.characterId, field, suggestion, JSON.stringify(sourceIds));
      suggestions++;
    }
  }
  return { llmCalls, suggestions, done: true };
}

// ── T5：存量表示回填 runner ──

/**
 * 每批 ≤10 条一次 LLM 调用，补齐 keywords/perspectives/semantic_note/importance。
 * 补完置 embedding_state='stale'——index worker 的 stale 兜底会自动重嵌入，无需额外入队。
 *
 * 两条硬约束：
 *   1. 只在字段真的变化时才写库（含 updated_at / stale）——否则模型留空时既刷新了排序用的
 *      updated_at，又让 index worker 用完全相同的文本重复付费嵌入；
 *   2. 无论模型是否补出字段都记账，否则这批候选每轮扫描都会被重补 + 重嵌入，永不前进。
 */
export async function runBackfillTask({ candidates, llmBudgetRemaining = 0, deps = {} } = {}) {
  const chatSync = deps.chatSync;
  const db = deps.db;
  let llmCalls = 0;
  let updated = 0;
  let skipped = 0;
  const batch = (candidates || []).slice(0, 10);
  if (batch.length === 0) return { llmCalls: 0, updated: 0, skipped: 0, done: true };
  if (llmBudgetRemaining <= 0) return { llmCalls: 0, updated: 0, skipped: 0, done: false };
  const listing = batch.map(m => `- ${m.memory_id} [${m.memory_type}|主体:${m.subject}] 判断：${m.judgment}｜依据：${m.reasoning || '无'}｜tags：${m.tags || '[]'}`).join('\n');
  const prompt = `你是记忆表示补全器。下面这些旧记忆缺少 v3 检索字段，请逐条补全：

${listing}

字段要求：
- keywords：3~8 个，用户将来想问起这件事时最可能打的词
- perspectives：2~5 个认知视角标签，如：饮食习惯/童年/健康/工作/关系
- episodicNote：情景信息（大约何时、在哪、发生了什么），不确定就给空字符串
- semanticNote：把 judgment 提炼成一句可直接转述的话；写不出就给空字符串
- importance：1（琐碎）~5（重大）
宁可留空不要编造。

只返回严格 JSON：{"items":[{"memoryId":"...","keywords":["..."],"perspectives":["..."],"episodicNote":"...","semanticNote":"...","importance":3}]}`;
  llmCalls++;
  let items = [];
  try {
    const raw = await chatSync([{ role: 'user', content: prompt }], LLM_OPTS);
    items = parseJsonObject(raw).items || [];
  } catch (error) {
    console.warn('[memory-consolidation] T5 LLM failed:', error.message);
    return { llmCalls, updated: 0, skipped: 0, done: false };
  }
  const byId = new Map(batch.map(m => [m.memory_id, m]));
  for (const item of items) {
    const row = byId.get(item.memoryId);
    if (!row) continue;
    const keywords = stringList(item.keywords).slice(0, 8);
    const perspectives = stringList(item.perspectives).slice(0, 5);
    const semanticNote = String(item.semanticNote || '').trim().slice(0, 400);
    const episodicNote = String(item.episodicNote || '').trim().slice(0, 400);
    const importance = Math.min(5, Math.max(1, Number(item.importance) || 3));

    // 逐字段判定"是否真的需要写"，只写变化项
    const changes = {};
    if (keywords.length && JSON.stringify(keywords) !== JSON.stringify(stringList(row.keywords))) {
      changes.keywords = JSON.stringify(keywords);
    }
    if (perspectives.length && JSON.stringify(perspectives) !== JSON.stringify(stringList(row.perspectives))) {
      changes.perspectives = JSON.stringify(perspectives);
    }
    const currentSemantic = String(row.semantic_note || '').trim();
    if (semanticNote && semanticNote !== currentSemantic) changes.semantic_note = semanticNote;
    const currentEpisodic = String(row.episodic_note || '').trim();
    if (episodicNote && episodicNote !== currentEpisodic) changes.episodic_note = episodicNote;
    if (importance !== (Number(row.importance) || 3)) changes.importance = importance;

    const columns = Object.keys(changes);
    if (columns.length === 0) { skipped++; continue; }
    db.prepare(`
      UPDATE memory_fragments
      SET ${columns.map(column => `${column} = ?`).join(', ')}, embedding_state = 'stale', updated_at = CURRENT_TIMESTAMP
      WHERE memory_id = ? AND status = 'active'
    `).run(...columns.map(column => changes[column]), row.memory_id);
    updated++;
  }
  // 记账：整批都已被模型看过（含模型留空的条数），下一轮换下一批，不再回环
  markConsolidated(db, 'backfill', batch.map(row => row.memory_id));
  return { llmCalls, updated, skipped, done: true };
}

function stringList(value) {
  if (Array.isArray(value)) return value.map(String).map(text => text.trim()).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).map(text => text.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// 便捷组合：T3 全流程（审计聚合 + 衰减归档 + 辅助表保留期清理），调度器直接调用
export function runDecayTask({ db, now = new Date(), enqueueDelete, enqueueTripleDelete } = {}) {
  const audited = aggregateRetrievalAudits(db, { now });
  const result = decayAndArchiveMemories(db, { now, enqueueDelete, enqueueTripleDelete });
  const pruned = pruneConsolidationArtifacts(db, { now });
  return { audited, ...result, pruned, done: true, llmCalls: 0 };
}

// 便捷组合：T6
export function runTombstoneTask({ db, enqueueDelete, enqueueTripleDelete } = {}) {
  const result = scanVectorTombstones(db, { enqueueDelete, enqueueTripleDelete });
  return { ...result, done: true, llmCalls: 0 };
}

// v3 开关关闭时，依赖 v3 字段的任务（T2/T4/T5）整体跳过；T1/T3/T6 只依赖基础字段照常运行
export function taskEnabledByV3(jobType) {
  if (!['generalize', 'portrait_suggest', 'backfill'].includes(jobType)) return true;
  return isMemoryV3Enabled();
}
