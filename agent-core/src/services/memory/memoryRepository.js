import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { getDb } from '../../db/index.js';
import { getMemorySettings, MEMORY_MODE } from './memoryConfig.js';
import { embedMemoryText, getPreferredMemoryEmbeddingProfile } from './memoryProviders.js';
import { upsertVector, deleteVector, deleteByConversation } from '../vectorClient.js';
import { createMemoryIndexWorker } from './memoryIndexWorker.js';

const MEMORY_TYPES = new Set(['knowledge', 'skill', 'emotion', 'event']);
const SUBJECTS = new Set(['user', 'character', 'relationship', 'assistant']);
const INDEX_CONCURRENCY = 2;
// Memory v3 阶段二：三元组向量语料（query-to-triple 联想扩展，docs/memory-upgrade-plan.md §5.3）
export const MEMORY_TRIPLES_CORPUS = 'memory_triples_v1';
// 三元组语料随嵌入 profile 分流（方案 A）：语料维度必须与查询向量同源，否则本地 768 维兜底那天
// 查询向量与语料维度不一致，联想直接报错被 catch 吞掉（activeSearch 只留一行 warn）。
export const MEMORY_TRIPLES_PREFIX = 'memory_triples_';

// profile → 三元组语料：远端/用户嵌入各占 memory_triples_<指纹>，本地兜底占 memory_triples_local_builtin
// （与前面 768 维的 memory_fragments 同维，但独立 collection 免与远端 1024 维混库）。
// 指纹为空 = 分流前的存量行，向量躺在共享语料 memory_triples_v1 里，删旧向量时按它兜底。
export function tripleCorpusFor(profile) {
  const fingerprint = typeof profile === 'string' ? profile : profile?.fingerprint;
  if (!fingerprint) return MEMORY_TRIPLES_CORPUS;
  return `${MEMORY_TRIPLES_PREFIX}${fingerprint}`;
}
// 三元组向量 id 前缀：与记忆碎片 id 共用 memory_index_jobs 表，前缀隔离避免任务去重/互斥互相干扰
export const TRIPLE_JOB_PREFIX = 'trip_';
// 记忆整理嵌入走用户自定义 → 系统内置 API（120s）→ 本地 ONNX 的优先级，
// 独立失败计数 embedding_index，当日失败满 5 次才降级本地。
const INDEX_EMBED_TIMEOUT_MS = 120000;
const INDEX_JOB_DELAY_MS = 100;
const PRIORITY_LIVE = 0;
const PRIORITY_RETRY = 5;
const PRIORITY_HISTORY = 10;
// 索引任务失败自动重试上限（与整理 daemon 的 MAX_ATTEMPTS 同口径）：
// 到上限才落 failed，否则回 pending，由 worker 在 100ms 重泵时自然重试。
export const MAX_INDEX_ATTEMPTS = 3;

/**
 * 索引任务失败后应落的状态（纯函数，便于单测）。
 * 向量服务没起来、内置嵌入服务临时 5xx、远端限流这类都是可恢复的，值得自动重试；
 * 此前一次失败就永久 failed，只能人工点「重试失败任务」。
 */
export function nextIndexJobStatus(attempts) {
  return (Number(attempts) || 0) + 1 >= MAX_INDEX_ATTEMPTS ? 'failed' : 'pending';
}

const memoryIndexWorker = createMemoryIndexWorker({
  concurrency: INDEX_CONCURRENCY,
  delayMs: INDEX_JOB_DELAY_MS,
  claimJob: claimNextIndexJob,
  runJob: processIndexJob,
  onError: (error, job) => console.error(`[memory-index] worker failed for job ${job?.id}:`, error.message),
});
let memoryIndexWorkerStarted = false;

export function parseTags(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

const ENTITY_ROLES = new Set(['subject', 'object', 'mention']);
const MEMORY_NOTE_LIMIT = 400;

function clampText(value, maxLength) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

// v3 可选实体列表：字符串条目视为 mention，畸形条目静默丢弃（宁可少存不要报错）
export function normalizeMemoryEntities(input) {
  const list = Array.isArray(input) ? input : parseTags(input);
  const seen = new Set();
  const entities = [];
  for (const entry of list) {
    const item = typeof entry === 'string' ? { name: entry, role: 'mention' } : (entry && typeof entry === 'object' ? entry : null);
    if (!item) continue;
    const name = clampText(item.name, 64);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    entities.push({ name, role: ENTITY_ROLES.has(item.role) ? item.role : 'mention' });
    if (entities.length >= 6) break;
  }
  return entities;
}

// v3 可选三元组：主谓宾任一缺失即整体丢弃（阶段二 query-to-triple 匹配用）
function normalizeTriple(triple) {
  if (!triple || typeof triple !== 'object' || Array.isArray(triple)) return null;
  const subject = clampText(triple.subject, 64);
  const predicate = clampText(triple.predicate, 32);
  const object = clampText(triple.object, 64);
  if (!subject || !predicate || !object) return null;
  return { subject, predicate, object };
}

export function normalizeMemory(memory = {}) {
  const memoryType = String(memory.memoryType || memory.memory_type || 'knowledge').toLowerCase();
  if (!MEMORY_TYPES.has(memoryType)) throw new Error(`无效 memoryType: ${memoryType}`);
  const subject = String(memory.subject || 'user').toLowerCase();
  if (!SUBJECTS.has(subject)) throw new Error(`无效 subject: ${subject}`);
  const judgment = String(memory.judgment || '').replace(/\s+/g, ' ').trim();
  if (!judgment) throw new Error('judgment 不能为空');
  const reasoning = String(memory.reasoning || '').replace(/\s+/g, ' ').trim();
  // v3 多重表示（MMS）：检索单元（keywords/perspectives/episodicNote）+ 注入单元（semanticNote）。
  // 全部允许缺失，缺失时保持 v2 兼容形态。
  const keywords = [...new Set(parseTags(memory.keywords).map(k => String(k).trim()).filter(Boolean))].slice(0, 8);
  const perspectives = [...new Set(parseTags(memory.perspectives).map(p => String(p).trim()).filter(Boolean))].slice(0, 5);
  const episodicNote = clampText(memory.episodicNote ?? memory.episodic_note, MEMORY_NOTE_LIMIT);
  const semanticNote = clampText(memory.semanticNote ?? memory.semantic_note, MEMORY_NOTE_LIMIT);
  const importance = clampInt(memory.importance, 3, 1, 5);
  const entities = normalizeMemoryEntities(memory.entities);
  const triple = normalizeTriple(memory.triple);
  if (containsSensitiveSecret(`${judgment}\n${reasoning}\n${episodicNote}\n${semanticNote}`)) {
    throw new Error('记忆疑似包含密码、密钥或敏感凭据，已拒绝保存');
  }
  const tags = [...new Set(parseTags(memory.tags).map(tag => String(tag).trim()).filter(Boolean))].slice(0, 12);
  if (tags.length === 0) throw new Error('tags 至少需要一个检索锚点');
  return { memoryType, subject, judgment, reasoning, tags, keywords, perspectives, episodicNote, semanticNote, importance, entities, triple };
}

export function validateMemoryAction(input = {}) {
  const action = String(input.action || '').toLowerCase();
  if (!['create', 'update', 'merge'].includes(action)) throw new Error(`无效记忆动作: ${action}`);
  const sourceMemoryIds = [...new Set((input.sourceMemoryIds || []).map(String).filter(Boolean))];
  if (action === 'create' && sourceMemoryIds.length !== 0) throw new Error('create 不能引用旧记忆');
  if (action === 'update' && sourceMemoryIds.length !== 1) throw new Error('update 必须引用一条旧记忆');
  if (action === 'merge' && sourceMemoryIds.length < 2) throw new Error('merge 必须引用至少两条旧记忆');
  return { action, sourceMemoryIds, memory: normalizeMemory(input.memory) };
}

export function applyMemoryActions({ conversationId, sourceRawStartId, sourceRawEndId, sourceMessageId = null, actions, eventTime = null, dedupeKey = null }) {
  if (dedupeKey !== null && (typeof dedupeKey !== 'string' || !dedupeKey.length || dedupeKey.length > 256)) {
    throw new Error('无效的记忆来源标识');
  }
  const db = getDb();
  const normalized = actions.map(validateMemoryAction);
  const profile = getPreferredMemoryEmbeddingProfile();
  const created = [];
  const transaction = db.transaction(() => {
    for (const item of normalized) {
      const sources = item.sourceMemoryIds.length
        ? db.prepare(`SELECT * FROM memory_fragments WHERE conversation_id = ? AND memory_id IN (${item.sourceMemoryIds.map(() => '?').join(',')}) AND status = 'active'`).all(conversationId, ...item.sourceMemoryIds)
        : [];
      if (sources.length !== item.sourceMemoryIds.length) throw new Error('引用的旧记忆不存在、已失效或不属于当前会话');
      const contentHash = crypto.createHash('sha256').update(`${conversationId}\n${item.memory.memoryType}\n${item.memory.judgment}${dedupeKey === null ? '' : `\nsource:${dedupeKey}`}`).digest('hex');
      const duplicate = db.prepare(`SELECT memory_id FROM memory_fragments WHERE conversation_id = ? AND content_hash = ? AND status = 'active'`).get(conversationId, contentHash);
      if (duplicate) continue;
      const memoryId = `mem_${randomUUID()}`;
      const legacyType = item.memory.memoryType === 'emotion' ? 'emotion' : 'fact';
      db.prepare(`
        INSERT INTO memory_fragments(
          conversation_id, source_msg_id, fragment_type, content, entities, chroma_id,
          memory_id, memory_type, subject, judgment, reasoning, tags, content_hash, status,
          source_raw_start_id, source_raw_end_id, embedding_profile, embedding_state, updated_at,
          keywords, perspectives, episodic_note, semantic_note,
          event_time, valid_from, valid_to, importance, strength, retrieval_count
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, CURRENT_TIMESTAMP,
                  ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, ?, 1.0, 0)
      `).run(
        conversationId, sourceMessageId, legacyType, item.memory.judgment, JSON.stringify(item.memory.tags),
        memoryId, item.memory.memoryType, item.memory.subject, item.memory.judgment, item.memory.reasoning,
        JSON.stringify(item.memory.tags), contentHash, sourceRawStartId, sourceRawEndId,
        profile?.fingerprint || null, profile ? 'pending' : 'disabled',
        JSON.stringify(item.memory.keywords), JSON.stringify(item.memory.perspectives),
        item.memory.episodicNote, item.memory.semanticNote,
        eventTime, item.memory.importance
      );
      for (const entity of item.memory.entities) {
        const entityId = upsertMemoryEntity(db, entity.name);
        if (entityId) {
          db.prepare(`INSERT OR IGNORE INTO memory_entity_links(memory_id, entity_id, role) VALUES (?, ?, ?)`).run(memoryId, entityId, entity.role);
        }
      }
      if (item.memory.triple) {
        const tripleId = insertMemoryTriple(db, { memoryId, triple: item.memory.triple, eventTime });
        enqueueTripleIndexJob(db, 'triple_upsert', tripleId, PRIORITY_LIVE);
      }
      for (const source of sources) {
        // v3 双时态演化：置失效（valid_to）而非仅 supersede，历史仍可检索（查询侧用 valid_to 过滤可见性）
        db.prepare(`UPDATE memory_fragments SET status = 'superseded', valid_to = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE memory_id = ?`).run(source.memory_id);
        db.prepare(`INSERT INTO memory_relations(from_memory_id, to_memory_id, action) VALUES (?, ?, ?)`).run(source.memory_id, memoryId, item.action);
        invalidateMemoryTriples(db, source.memory_id);
        enqueueIndexJob(db, 'delete', source.memory_id, source.embedding_profile, PRIORITY_LIVE);
      }
      enqueueIndexJob(db, 'upsert', memoryId, profile?.fingerprint || null, PRIORITY_LIVE);
      created.push(memoryId);
    }
  });
  transaction();
  wakeMemoryIndexWorker();
  return created.map(memoryId => getMemoryById(memoryId));
}

// ── 阶段三 T2：派生记忆插入（泛化升华专用）──
// 与 applyMemoryActions 的 update/merge 不同：原记忆保留不失效，只降 importance，
// 血缘写 memory_relations(action=relationAction, relation_meta=relationMeta)。
export function insertGeneralizedMemory({ conversationId, memory, sourceMemoryIds, relationAction = 'merge', relationMeta = null, db = getDb(), profile = getPreferredMemoryEmbeddingProfile(), wake = wakeMemoryIndexWorker }) {
  const normalized = normalizeMemory(memory);
  const sources = db.prepare(`
    SELECT * FROM memory_fragments
    WHERE conversation_id = ? AND memory_id IN (${sourceMemoryIds.map(() => '?').join(',')}) AND status = 'active'
  `).all(conversationId, ...sourceMemoryIds);
  if (sources.length !== sourceMemoryIds.length) throw new Error('泛化引用的旧记忆不存在、已失效或不属于当前会话');
  const contentHash = crypto.createHash('sha256').update(`${conversationId}\n${normalized.memoryType}\n${normalized.judgment}`).digest('hex');
  const duplicate = db.prepare(`SELECT memory_id FROM memory_fragments WHERE conversation_id = ? AND content_hash = ? AND status = 'active'`).get(conversationId, contentHash);
  if (duplicate) return null;
  const memoryId = `mem_${randomUUID()}`;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO memory_fragments(
        conversation_id, source_msg_id, fragment_type, content, entities, chroma_id,
        memory_id, memory_type, subject, judgment, reasoning, tags, content_hash, status,
        source_raw_start_id, source_raw_end_id, embedding_profile, embedding_state, updated_at,
        keywords, perspectives, episodic_note, semantic_note,
        event_time, valid_from, valid_to, importance, strength, retrieval_count
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, CURRENT_TIMESTAMP,
                ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, NULL, ?, 1.0, 0)
    `).run(
      conversationId, null, 'fact', normalized.judgment, JSON.stringify(normalized.tags),
      memoryId, normalized.memoryType, normalized.subject, normalized.judgment, normalized.reasoning,
      JSON.stringify(normalized.tags), contentHash,
      Math.min(...sources.map(row => row.source_raw_start_id ?? 0)) || null,
      Math.max(...sources.map(row => row.source_raw_end_id ?? 0)) || null,
      profile?.fingerprint || null, profile ? 'pending' : 'disabled',
      JSON.stringify(normalized.keywords), JSON.stringify(normalized.perspectives),
      normalized.episodicNote, normalized.semanticNote,
      normalized.importance
    );
    for (const entity of normalized.entities) {
      const entityId = upsertMemoryEntity(db, entity.name);
      if (entityId) {
        db.prepare(`INSERT OR IGNORE INTO memory_entity_links(memory_id, entity_id, role) VALUES (?, ?, ?)`).run(memoryId, entityId, entity.role);
      }
    }
    if (normalized.triple) {
      const tripleId = insertMemoryTriple(db, { memoryId, triple: normalized.triple, eventTime: null });
      enqueueTripleIndexJob(db, 'triple_upsert', tripleId, PRIORITY_LIVE);
    }
    for (const source of sources) {
      // 原记忆保留：仅降 importance（遗忘曲线输入），血缘记录泛化关系
      db.prepare(`UPDATE memory_fragments SET importance = MAX(1, importance - 1), updated_at = CURRENT_TIMESTAMP WHERE memory_id = ?`).run(source.memory_id);
      db.prepare(`INSERT INTO memory_relations(from_memory_id, to_memory_id, action, relation_meta) VALUES (?, ?, ?, ?)`)
        .run(source.memory_id, memoryId, relationAction, relationMeta ? JSON.stringify(relationMeta) : null);
    }
    enqueueIndexJob(db, 'upsert', memoryId, profile?.fingerprint || null, PRIORITY_LIVE);
  });
  tx();
  wake();
  return memoryId;
}

// 实体 upsert（Mem0 平行实体集合）：命中则计数，未命中则新建；过短名字（代词类）直接拒绝
export function upsertMemoryEntity(db, name) {
  const trimmed = clampText(name, 64);
  if (trimmed.length < 2) return null;
  const existing = db.prepare(`SELECT id FROM memory_entities WHERE name = ?`).get(trimmed);
  if (existing) {
    db.prepare(`UPDATE memory_entities SET mention_count = mention_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(existing.id);
    return existing.id;
  }
  const info = db.prepare(`INSERT INTO memory_entities(name, mention_count) VALUES (?, 1)`).run(trimmed);
  return Number(info.lastInsertRowid);
}

export function insertMemoryTriple(db, { memoryId, triple, eventTime = null }) {
  const subjectEntityId = findEntityIdByName(db, triple.subject);
  const objectEntityId = findEntityIdByName(db, triple.object);
  const info = db.prepare(`
    INSERT INTO memory_triples(memory_id, subject_entity_id, subject_text, predicate, object_entity_id, object_text, event_time, valid_from, embedding_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending')
  `).run(memoryId, subjectEntityId, triple.subject, triple.predicate, objectEntityId, triple.object, eventTime);
  return Number(info.lastInsertRowid);
}

function findEntityIdByName(db, name) {
  return db.prepare(`SELECT id FROM memory_entities WHERE name = ?`).get(clampText(name, 64))?.id ?? null;
}

// 三元组向量索引任务：以 trip_ 前缀隔离 memory_id 键，processIndexJob 按 job_type 分支处理
// profile 只对 triple_delete 有意义（删除要先知道语料，行可能已被回滚/清空事务删掉），
// triple_upsert 在 indexMemoryTriple 里按嵌入结果重新取 profile。
function enqueueTripleIndexJob(db, jobType, tripleId, priority = PRIORITY_HISTORY, profile = null) {
  return enqueueIndexJob(db, jobType, `${TRIPLE_JOB_PREFIX}${tripleId}`, profile, priority);
}

function parseTripleIdFromJobKey(memoryId) {
  const match = String(memoryId || '').match(/^trip_(\d+)$/);
  return match ? Number(match[1]) : null;
}

// 三元组嵌入文本（query-to-triple 匹配形态）：主语 + 谓词 + 宾语拼接
export function tripleEmbeddingText(row) {
  return [row.subject_text, row.predicate, row.object_text].filter(Boolean).join(' ');
}

async function indexMemoryTriple(tripleId) {
  const row = getDb().prepare(`SELECT * FROM memory_triples WHERE id = ?`).get(tripleId);
  if (!row || row.valid_to != null) return false;
  const settings = getMemorySettings({ includeSecrets: true });
  const vectorId = `${TRIPLE_JOB_PREFIX}${tripleId}`;
  try {
    const text = tripleEmbeddingText(row);
    const fragment = getDb().prepare(`SELECT conversation_id FROM memory_fragments WHERE memory_id = ?`).get(row.memory_id);
    const metadata = {
      memory_id: row.memory_id,
      conversation_id: fragment?.conversation_id || null,
      predicate: row.predicate,
    };
    const { embedding, profile } = await embedMemoryText(text, settings, { timeoutMs: INDEX_EMBED_TIMEOUT_MS, failureKind: 'embedding_index', slowThresholdMs: null });
    const current = getDb().prepare(`SELECT valid_to FROM memory_triples WHERE id = ?`).get(tripleId);
    if (!current || current.valid_to != null) return false;
    await upsertVector(vectorId, text, metadata, null, tripleCorpusFor(profile), embedding);
    getDb().prepare(`UPDATE memory_triples SET embedding_state = 'indexed', embedding_profile = ? WHERE id = ?`)
      .run(profile?.fingerprint || null, tripleId);
    return true;
  } catch (error) {
    getDb().prepare(`UPDATE memory_triples SET embedding_state = 'failed' WHERE id = ?`).run(tripleId);
    throw error;
  }
}

async function removeMemoryTripleVector(tripleId, profile = null) {
  // 任务带的 profile 优先（回滚/清空事务会先把行删掉，读不到列），其次读列，都没有按存量共享语料兜底
  const stored = profile ?? getDb().prepare(`SELECT embedding_profile FROM memory_triples WHERE id = ?`).get(tripleId)?.embedding_profile ?? null;
  await deleteVector(`${TRIPLE_JOB_PREFIX}${tripleId}`, tripleCorpusFor(stored));
}

function invalidateMemoryTriples(db, memoryId) {
  const rows = db.prepare(`SELECT id, embedding_profile FROM memory_triples WHERE memory_id = ? AND valid_to IS NULL`).all(memoryId);
  if (rows.length === 0) return;
  db.prepare(`UPDATE memory_triples SET valid_to = CURRENT_TIMESTAMP WHERE memory_id = ? AND valid_to IS NULL`).run(memoryId);
  // 双时态失效的三元组同步出向量库（阶段二联想扩展只用现行三元组）
  for (const row of rows) enqueueTripleIndexJob(db, 'triple_delete', row.id, PRIORITY_LIVE, row.embedding_profile);
}

export function getMemoryById(memoryId) {
  const row = getDb().prepare(`SELECT * FROM memory_fragments WHERE memory_id = ?`).get(memoryId);
  return row ? formatMemory(row) : null;
}

export function listActiveMemories({ conversationId = null, status = 'active', memoryType = null, limit = 50, offset = 0 } = {}) {
  let sql = `SELECT * FROM memory_fragments WHERE 1=1`;
  const params = [];
  if (conversationId) { sql += ` AND conversation_id = ?`; params.push(conversationId); }
  if (status) { sql += ` AND status = ?`; params.push(status); }
  if (memoryType) { sql += ` AND memory_type = ?`; params.push(memoryType); }
  sql += ` ORDER BY COALESCE(updated_at, created_at) DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return getDb().prepare(sql).all(...params).map(formatMemory);
}

export function softDeleteMemory(idOrMemoryId) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM memory_fragments WHERE memory_id = ? OR id = ?`).get(String(idOrMemoryId), Number(idOrMemoryId) || -1);
  if (!row) return false;
  db.prepare(`UPDATE memory_fragments SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
  enqueueIndexJob(db, 'delete', row.memory_id, row.embedding_profile, PRIORITY_LIVE);
  wakeMemoryIndexWorker();
  return true;
}

// ── 阶段四：archived 记忆恢复（管理界面可查可恢复；恢复即重新嵌入）──
export function restoreArchivedMemory(idOrMemoryId) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM memory_fragments WHERE memory_id = ? OR id = ?`).get(String(idOrMemoryId), Number(idOrMemoryId) || -1);
  if (!row || row.status !== 'archived') return false;
  // 撤销归档时排队的向量 delete 任务：虽然 stale 兜底（PRIORITY_HISTORY）保证排在
  // pending delete（PRIORITY_LIVE）之后、不会丢向量，但留着会白跑一趟"删了再嵌"。
  const canceled = db.prepare(`
    DELETE FROM memory_index_jobs
    WHERE memory_id = ? AND job_type = 'delete' AND status = 'pending'
  `).run(row.memory_id).changes;
  db.prepare(`UPDATE memory_fragments SET status = 'active', embedding_state = 'stale', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
  // stale 状态由 index worker 的兑底扫描自动重嵌入，无需额外入队
  wakeMemoryIndexWorker();
  if (canceled > 0) console.log(`[memory] restore ${row.memory_id}: canceled ${canceled} pending delete job(s)`);
  return true;
}

// ── 阶段三：向量墓碑入队辅助（daemon T3/T6 使用，调度器传入回调）──
export function enqueueMemoryDeleteJob(memoryId, row = null) {
  const db = getDb();
  const profile = row?.embedding_profile ?? db.prepare(`SELECT embedding_profile FROM memory_fragments WHERE memory_id = ?`).get(memoryId)?.embedding_profile ?? null;
  enqueueIndexJob(db, 'delete', memoryId, profile, PRIORITY_LIVE);
  wakeMemoryIndexWorker();
}

export function enqueueTripleDeleteJob(tripleId, row = null) {
  const db = getDb();
  // 语料随 profile 分流：删除前把行的 profile 记进任务（墓碑扫描挑的是已失效三元组，行还在）
  const profile = row?.embedding_profile ?? db.prepare(`SELECT embedding_profile FROM memory_triples WHERE id = ?`).get(tripleId)?.embedding_profile ?? null;
  enqueueTripleIndexJob(db, 'triple_delete', tripleId, PRIORITY_LIVE, profile);
  wakeMemoryIndexWorker();
}

export function rollbackMemoriesFromRawId(conversationId, rawStartId) {
  const db = getDb();
  const currentCheckpoint = db.prepare(`
    SELECT COALESCE(last_raw_msg_id, 0) AS last_raw_msg_id
    FROM memory_extraction_checkpoints WHERE conversation_id = ?
  `).get(conversationId)?.last_raw_msg_id || 0;
  const affected = db.prepare(`SELECT * FROM memory_fragments WHERE conversation_id = ? AND source_raw_end_id >= ? AND status != 'deleted'`).all(conversationId, rawStartId);
  const affectedStarts = affected.map(row => row.source_raw_start_id).filter(Number.isInteger);
  const firstAffectedRawId = affectedStarts.length > 0 ? Math.min(...affectedStarts) : rawStartId;
  const rollbackBoundary = Math.min(currentCheckpoint, Math.max(0, firstAffectedRawId - 1));
  const affectedIds = new Set(affected.map(row => row.memory_id));
  const transaction = db.transaction(() => {
    for (const row of affected) {
      db.prepare(`UPDATE memory_fragments SET status = 'deleted', source_msg_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
      db.prepare(`DELETE FROM memory_entity_links WHERE memory_id = ?`).run(row.memory_id);
      // 回滚删除的三元组同步出向量库（trip_ 前缀任务不受本事务中碎片任务清理影响）
      const tripleRows = db.prepare(`SELECT id, embedding_profile FROM memory_triples WHERE memory_id = ?`).all(row.memory_id);
      db.prepare(`DELETE FROM memory_triples WHERE memory_id = ?`).run(row.memory_id);
      for (const tripleRow of tripleRows) enqueueTripleIndexJob(db, 'triple_delete', tripleRow.id, PRIORITY_LIVE, tripleRow.embedding_profile);
      const predecessors = db.prepare(`SELECT from_memory_id FROM memory_relations WHERE to_memory_id = ?`).all(row.memory_id);
      for (const predecessor of predecessors) {
        if (affectedIds.has(predecessor.from_memory_id)) continue;
        // 回滚恢复前驱记忆：连带清除 v3 双时态失效标记与三元组失效标记
        db.prepare(`UPDATE memory_fragments SET status = 'active', valid_to = NULL, updated_at = CURRENT_TIMESTAMP WHERE memory_id = ? AND status = 'superseded'`).run(predecessor.from_memory_id);
        db.prepare(`UPDATE memory_triples SET valid_to = NULL WHERE memory_id = ? AND valid_to IS NOT NULL`).run(predecessor.from_memory_id);
        enqueueIndexJob(db, 'upsert', predecessor.from_memory_id, null, PRIORITY_LIVE);
      }
      enqueueIndexJob(db, 'delete', row.memory_id, row.embedding_profile, PRIORITY_LIVE);
    }
    db.prepare(`
      INSERT INTO memory_extraction_checkpoints(conversation_id, last_raw_msg_id, status, last_error, updated_at)
      VALUES (?, ?, 'idle', NULL, CURRENT_TIMESTAMP)
      ON CONFLICT(conversation_id) DO UPDATE SET last_raw_msg_id = excluded.last_raw_msg_id, status = 'idle', last_error = NULL, updated_at = CURRENT_TIMESTAMP
    `).run(conversationId, rollbackBoundary);
  });
  transaction();
  wakeMemoryIndexWorker();
  return affected.length;
}

export function clearConversationMemories(conversationId) {
  const db = getDb();
  const rows = db.prepare(`SELECT memory_id, embedding_profile FROM memory_fragments WHERE conversation_id = ?`).all(conversationId);
  // 先收出现行三元组 id + 语料 profile：清空后需补发 triple_delete 任务出向量库
  const ids = rows.map(row => row.memory_id).filter(Boolean);
  const tripleRows = ids.length
    ? db.prepare(`SELECT id, embedding_profile FROM memory_triples WHERE memory_id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  const transaction = db.transaction(() => {
    if (ids.length) {
      const placeholders = `(${ids.map(() => '?').join(',')})`;
      db.prepare(`DELETE FROM memory_relations WHERE from_memory_id IN ${placeholders} OR to_memory_id IN ${placeholders}`).run(...ids, ...ids);
      db.prepare(`DELETE FROM memory_index_jobs WHERE memory_id IN ${placeholders}`).run(...ids);
      db.prepare(`DELETE FROM memory_entity_links WHERE memory_id IN ${placeholders}`).run(...ids);
      db.prepare(`DELETE FROM memory_triples WHERE memory_id IN ${placeholders}`).run(...ids);
    }
    db.prepare(`DELETE FROM memory_fragments WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`DELETE FROM memory_extraction_checkpoints WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`DELETE FROM memory_retrieval_audits WHERE conversation_id = ?`).run(conversationId);
  });
  transaction();
  for (const tripleRow of tripleRows) {
    enqueueTripleIndexJob(db, 'triple_delete', tripleRow.id, PRIORITY_LIVE, tripleRow.embedding_profile);
  }
  wakeMemoryIndexWorker();
  const corpora = [...new Set(rows.map(row => row.embedding_profile).filter(profile => profile && profile !== 'local_builtin').map(profile => `memory_v2_${profile}`))];
  // 三元组语料按 profile 分流，逐个 profile 语料清（空 profile 的老行落在共享语料里）
  const tripleCorpora = [...new Set(tripleRows.map(row => tripleCorpusFor(row.embedding_profile)))];
  void deleteByConversation(conversationId).catch(() => {});
  for (const corpus of tripleCorpora) void deleteByConversation(conversationId, corpus).catch(() => {});
  for (const corpus of corpora) void deleteByConversation(conversationId, corpus).catch(() => {});
  return rows.length;
}

export function getCheckpoint(conversationId) {
  return getDb().prepare(`SELECT * FROM memory_extraction_checkpoints WHERE conversation_id = ?`).get(conversationId) || { conversation_id: conversationId, last_raw_msg_id: 0, status: 'idle' };
}

export function setCheckpoint(conversationId, lastRawMsgId, status = 'idle', error = null) {
  getDb().prepare(`
    INSERT INTO memory_extraction_checkpoints(conversation_id, last_raw_msg_id, status, last_error, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(conversation_id) DO UPDATE SET last_raw_msg_id = excluded.last_raw_msg_id, status = excluded.status, last_error = excluded.last_error, updated_at = CURRENT_TIMESTAMP
  `).run(conversationId, lastRawMsgId, status, error);
}

export async function indexMemory(memoryId) {
  const row = getDb().prepare(`SELECT * FROM memory_fragments WHERE memory_id = ?`).get(memoryId);
  if (!row || row.status !== 'active') return false;
  const settings = getMemorySettings({ includeSecrets: true });
  try {
    const text = settings.v3?.enabled ? retrievalText(row) : memoryText(row);
    const metadata = {
      memory_id: memoryId,
      conversation_id: row.conversation_id,
      memory_type: row.memory_type,
      tags: JSON.stringify(parseTags(row.tags)),
    };
    const { embedding, profile } = await embedMemoryText(text, settings, { timeoutMs: INDEX_EMBED_TIMEOUT_MS, failureKind: 'embedding_index', slowThresholdMs: null });
    const current = getDb().prepare(`SELECT status FROM memory_fragments WHERE memory_id = ?`).get(memoryId);
    if (current?.status !== 'active') return false;
    await upsertVector(memoryId, text, metadata, null, profile.corpus, embedding);
    const updated = getDb().prepare(`
      UPDATE memory_fragments
      SET chroma_id = ?, embedding_profile = ?, embedding_state = 'indexed', embedding_error = NULL
      WHERE memory_id = ? AND status = 'active'
    `).run(memoryId, profile.fingerprint, memoryId);
    if (updated.changes === 0) {
      await deleteVector(memoryId, profile.corpus);
      return false;
    }
    return true;
  } catch (error) {
    getDb().prepare(`UPDATE memory_fragments SET embedding_state = 'failed', embedding_error = ? WHERE memory_id = ?`).run(String(error.message).slice(0, 500), memoryId);
    throw error;
  }
}

export async function reindexAllMemories() {
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) AS count FROM memory_fragments WHERE status = 'active'`).get().count;
  db.prepare(`UPDATE memory_fragments SET embedding_state = 'stale', embedding_error = NULL WHERE status = 'active'`).run();
  // 换嵌入模型时三元组同样要重嵌：语料按 profile 分流，旧语料的向量查询时命中不了（也不该删，
  // 回切模型还能直接用），所以这里只补嵌新语料、不清理旧语料。
  db.prepare(`UPDATE memory_triples SET embedding_state = 'stale' WHERE valid_to IS NULL`).run();
  const tripleTotal = requeueTriples(db, `
    SELECT id, embedding_profile FROM memory_triples WHERE valid_to IS NULL AND embedding_state = 'stale'
  `);
  enqueueFollowUpsForProcessingUpserts(db, PRIORITY_RETRY);
  wakeMemoryIndexWorker();
  return { total, queued: total, tripleTotal, tripleQueued: tripleTotal };
}

// 三元组语料分流（方案 A）的自愈补嵌：分流前的存量三元组 embedding_profile 为空、向量躺在共享
// 语料 memory_triples_v1 里，查询侧却按当前 profile 找 memory_triples_<指纹>，会静默联想不到。
// 判据就是"还没有 profile"，嵌完自然归零，所以不需要开关位；嵌失败的行下次启动会再试。
export function backfillTriplesWithoutEmbeddingProfile(db = getDb()) {
  return requeueTriples(db, `
    SELECT id, embedding_profile FROM memory_triples
    WHERE valid_to IS NULL AND COALESCE(embedding_profile, '') = ''
  `);
}

export async function ensureDefaultMemoryIndexes() {
  const db = getDb();
  const settingKey = 'memory_default_models_indexed_v1';
  startMemoryIndexWorker();
  const existing = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(settingKey);
  const triplesBackfilled = backfillTriplesWithoutEmbeddingProfile(db);
  if (existing?.setting_value === '1') {
    wakeMemoryIndexWorker();
    return { skipped: true, pending: pendingIndexJobCount(db), triplesBackfilled };
  }

  db.prepare(`UPDATE memory_fragments SET embedding_state = 'stale', embedding_error = NULL WHERE status = 'active' AND embedding_state = 'disabled'`).run();

  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM memory_fragments
    WHERE status = 'active' AND embedding_state IN ('failed', 'pending', 'stale', 'disabled')
  `).get().count;
  db.prepare(`
    UPDATE memory_fragments SET embedding_state = 'stale', embedding_error = NULL
    WHERE status = 'active' AND embedding_state IN ('failed', 'pending', 'stale', 'disabled')
  `).run();
  enqueueFollowUpsForProcessingUpserts(db, PRIORITY_HISTORY);

  db.prepare(`
    INSERT INTO system_settings(setting_key, setting_value, updated_at)
    VALUES (?, '1', CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = '1', updated_at = CURRENT_TIMESTAMP
  `).run(settingKey);
  wakeMemoryIndexWorker();
  console.log(`[memory] default index initialization scheduled: total=${total}, concurrency=${INDEX_CONCURRENCY}`);
  return { total, queued: total, triplesBackfilled };
}

export async function retryFailedIndexJobs() {
  const db = getDb();
  const upsertCount = db.prepare(`
    SELECT COUNT(*) AS count FROM memory_fragments
    WHERE status = 'active' AND embedding_state IN ('failed', 'pending', 'stale')
  `).get().count;
  db.prepare(`
    UPDATE memory_fragments SET embedding_state = 'stale', embedding_error = NULL
    WHERE status = 'active' AND embedding_state IN ('failed', 'pending', 'stale')
  `).run();
  enqueueFollowUpsForProcessingUpserts(db, PRIORITY_RETRY);

  // 回滚与清空会话会先把三元组行删掉再发 triple_delete：任务失败后 DB 里已经没有行，
  // T3 墓碑扫描扫的是"还存在的行"，兜不住 → 向量变永久孤儿。这里把 triple_delete 一起重试
  // （碎片 delete 同理，但碎片是软删除、行还在，墓碑扫描能兜底）。
  const deletes = db.prepare(`
    SELECT DISTINCT job_type, memory_id, profile FROM memory_index_jobs
    WHERE job_type IN ('delete', 'triple_delete') AND status = 'failed'
  `).all();
  for (const row of deletes) {
    retryOrEnqueueIndexJob(db, row.job_type, row.memory_id, row.profile, PRIORITY_RETRY);
  }

  // 三元组此前没有重试入口：embedding_state 一旦卡在 failed 就再也回不来（memory_triples_v1 曾被
  // 向量服务语料白名单拒成 422，17 个三元组全卡死）。这里跟碎片一样重新入队，并把状态放回 pending。
  const tripleTotal = requeueTriples(db, `
    SELECT id, embedding_profile FROM memory_triples
    WHERE valid_to IS NULL AND embedding_state IN ('failed', 'pending', 'stale')
  `);

  wakeMemoryIndexWorker();
  return {
    total: upsertCount,
    queued: upsertCount,
    deleteTotal: deletes.length,
    deleteQueued: deletes.length,
    tripleTotal,
    tripleQueued: tripleTotal,
  };
}

export function memoryStats() {
  const db = getDb();
  const counts = db.prepare(`SELECT status, embedding_state, COUNT(*) AS count FROM memory_fragments GROUP BY status, embedding_state`).all();
  const settings = getMemorySettings({ includeSecrets: true });
  const entities = db.prepare(`SELECT COUNT(*) AS count FROM memory_entities`).get().count;
  const triples = db.prepare(`SELECT COUNT(*) AS count FROM memory_triples WHERE valid_to IS NULL`).get().count;
  // 阶段四：分层计数 + 强度概览（archived 占比供存储管理视图用）
  const layerRow = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived, SUM(CASE WHEN status = 'superseded' THEN 1 ELSE 0 END) AS superseded FROM memory_fragments`).get();
  const strengthRow = db.prepare(`SELECT AVG(strength) AS avgStrength, SUM(CASE WHEN strength < 0.15 THEN 1 ELSE 0 END) AS nearThreshold FROM memory_fragments WHERE status = 'active'`).get();
  return {
    mode: MEMORY_MODE,
    // 语料指纹只此一份：报告检索真正在用的那个（此前取 maskSecrets 里另算的一套，内置 provider 下恒为 null）
    profile: getPreferredMemoryEmbeddingProfile(settings).fingerprint || null,
    rows: counts,
    entities,
    activeTriples: triples,
    layers: {
      total: layerRow.total || 0,
      active: layerRow.active || 0,
      archived: layerRow.archived || 0,
      superseded: layerRow.superseded || 0,
      archivedRatio: layerRow.total ? Math.round(((layerRow.archived || 0) / layerRow.total) * 1000) / 1000 : 0,
    },
    avgStrength: strengthRow.avgStrength != null ? Math.round(strengthRow.avgStrength * 1000) / 1000 : null,
    nearThresholdCount: strengthRow.nearThreshold || 0,
  };
}

function containsSensitiveSecret(text) {
  return /(?:password|passwd|密码|api[_ -]?key|access[_ -]?token|secret[_ -]?key|bearer)\s*[:=：]\s*\S{6,}|\b(?:sk|ghp|glpat)-[A-Za-z0-9_-]{12,}\b|\b\d{15,19}\b/i.test(text);
}

function enqueueIndexJob(db, jobType, memoryId, profile, priority = PRIORITY_HISTORY) {
  const pending = db.prepare(`
    SELECT id, priority FROM memory_index_jobs
    WHERE job_type = ? AND memory_id = ? AND status = 'pending'
    ORDER BY id DESC LIMIT 1
  `).get(jobType, memoryId);
  if (pending) {
    db.prepare(`UPDATE memory_index_jobs SET profile = ?, priority = MIN(priority, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(profile, priority, pending.id);
    return pending.id;
  }
  // A running job has already captured its inputs. Keep one pending follow-up so
  // profile changes, rollbacks, or deletes that arrive mid-flight are not lost.
  return db.prepare(`INSERT INTO memory_index_jobs(job_type, memory_id, profile, priority, status) VALUES (?, ?, ?, ?, 'pending')`)
    .run(jobType, memoryId, profile, priority).lastInsertRowid;
}

function retryOrEnqueueIndexJob(db, jobType, memoryId, profile, priority) {
  const existing = db.prepare(`
    SELECT id FROM memory_index_jobs
    WHERE job_type = ? AND memory_id = ? AND status IN ('pending', 'processing', 'failed')
    ORDER BY CASE status WHEN 'processing' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, id DESC
    LIMIT 1
  `).get(jobType, memoryId);
  if (!existing) return enqueueIndexJob(db, jobType, memoryId, profile, priority);
  db.prepare(`
    UPDATE memory_index_jobs
    SET profile = ?, priority = ?, status = CASE WHEN status = 'processing' THEN status ELSE 'pending' END,
        attempts = 0, error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(profile, priority, existing.id);
  return existing.id;
}

function enqueueFollowUpsForProcessingUpserts(db, priority) {
  const profile = getPreferredMemoryEmbeddingProfile(undefined, 'embedding_index').fingerprint;
  const rows = db.prepare(`
    SELECT DISTINCT memory_id FROM memory_index_jobs
    WHERE job_type = 'upsert' AND status = 'processing' AND memory_id IS NOT NULL
  `).all();
  for (const row of rows) enqueueIndexJob(db, 'upsert', row.memory_id, profile, priority);
}

// 三元组重嵌回队（换嵌入模型 / 失败重试 / 分流前老行补嵌共用）。
// 语料由 indexMemoryTriple 按当时的嵌入 profile 现算，所以这里不传语料、只回队。
function requeueTriples(db, sql, priority = PRIORITY_RETRY) {
  const rows = db.prepare(sql).all();
  const markPending = db.prepare(`UPDATE memory_triples SET embedding_state = 'pending' WHERE id = ?`);
  for (const row of rows) {
    markPending.run(row.id);
    retryOrEnqueueIndexJob(db, 'triple_upsert', `${TRIPLE_JOB_PREFIX}${row.id}`, row.embedding_profile, priority);
  }
  if (rows.length > 0) wakeMemoryIndexWorker();
  return rows.length;
}

function claimNextIndexJob() {
  const db = getDb();
  return db.transaction(() => {
    let job = db.prepare(`
      SELECT queued.* FROM memory_index_jobs queued
      WHERE queued.status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM memory_index_jobs active
          WHERE active.status = 'processing' AND active.memory_id = queued.memory_id
        )
      ORDER BY queued.priority ASC, queued.id ASC
      LIMIT 1
    `).get();
    if (!job) {
      const stale = db.prepare(`
        SELECT mf.memory_id FROM memory_fragments mf
        WHERE mf.status = 'active' AND mf.embedding_state IN ('stale', 'pending')
          AND NOT EXISTS (
            SELECT 1 FROM memory_index_jobs queued
            WHERE queued.memory_id = mf.memory_id AND queued.job_type = 'upsert'
              AND queued.status IN ('pending', 'processing')
          )
        ORDER BY COALESCE(mf.updated_at, mf.created_at) ASC, mf.id ASC
        LIMIT 1
      `).get();
      if (stale) {
        const id = enqueueIndexJob(
          db,
          'upsert',
          stale.memory_id,
          getPreferredMemoryEmbeddingProfile(undefined, 'embedding_index').fingerprint,
          PRIORITY_HISTORY,
        );
        job = db.prepare(`SELECT * FROM memory_index_jobs WHERE id = ?`).get(id);
      }
    }
    if (!job) return null;
    const claimed = db.prepare(`
      UPDATE memory_index_jobs SET status = 'processing', error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(job.id);
    return claimed.changes === 1 ? { ...job, status: 'processing' } : null;
  })();
}

async function processIndexJob(job) {
  try {
    if (job.job_type === 'upsert') {
      const row = getDb().prepare(`SELECT status FROM memory_fragments WHERE memory_id = ?`).get(job.memory_id);
      if (row?.status === 'active') await indexMemory(job.memory_id);
    } else if (job.job_type === 'delete') {
      await removeMemoryVector(job.memory_id, job.profile);
    } else if (job.job_type === 'triple_upsert') {
      const tripleId = parseTripleIdFromJobKey(job.memory_id);
      if (tripleId) await indexMemoryTriple(tripleId);
    } else if (job.job_type === 'triple_delete') {
      const tripleId = parseTripleIdFromJobKey(job.memory_id);
      if (tripleId) await removeMemoryTripleVector(tripleId, job.profile);
    } else {
      throw new Error(`unsupported memory index job type: ${job.job_type}`);
    }
    finishIndexJob(job.id, 'completed');
  } catch (error) {
    const attempts = (Number(job.attempts) || 0) + 1;
    const nextStatus = nextIndexJobStatus(job.attempts);
    finishIndexJob(job.id, nextStatus, error.message);
    if (nextStatus === 'pending') {
      console.warn(`[memory-index] job ${job.job_type}#${job.id} 第 ${attempts}/${MAX_INDEX_ATTEMPTS} 次失败，稍后重试:`, error.message);
    }
    // 仍向上抛给 worker 的 onError（负责打日志），但不影响已写回的重试状态
    throw error;
  }
}

function finishIndexJob(jobId, status, error = null) {
  getDb().prepare(`UPDATE memory_index_jobs SET status = ?, error = ?, attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(status, error ? String(error).slice(0, 500) : null, jobId);
}

async function removeMemoryVector(memoryId, embeddingProfile) {
  const corpora = ['memory_fragments'];
  if (embeddingProfile && embeddingProfile !== 'local_builtin') corpora.push(`memory_v2_${embeddingProfile}`);
  const results = await Promise.allSettled(corpora.map(corpus => deleteVector(memoryId, corpus)));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

function pendingIndexJobCount(db = getDb()) {
  return db.prepare(`SELECT COUNT(*) AS count FROM memory_index_jobs WHERE status IN ('pending', 'processing')`).get().count;
}

function wakeMemoryIndexWorker() {
  memoryIndexWorker.wake();
}

// 供外部模块（consolidationScheduler 的 stale 回填）唤起 index worker
export function notifyMemoryIndexWorker() {
  wakeMemoryIndexWorker();
}

export function startMemoryIndexWorker() {
  if (memoryIndexWorkerStarted) {
    memoryIndexWorker.wake();
    return { concurrency: INDEX_CONCURRENCY, pending: pendingIndexJobCount() };
  }
  const db = getDb();
  const recovered = db.prepare(`
    UPDATE memory_index_jobs
    SET status = 'pending', error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE status = 'processing'
  `).run().changes;
  if (recovered > 0) console.log(`[memory-index] recovered ${recovered} interrupted job(s)`);
  memoryIndexWorkerStarted = true;
  memoryIndexWorker.start();
  return { concurrency: INDEX_CONCURRENCY, pending: pendingIndexJobCount(db) };
}

export function stopMemoryIndexWorker() {
  memoryIndexWorkerStarted = false;
  memoryIndexWorker.stop();
}

function memoryText(row) {
  const tags = parseTags(row.tags).join(' ');
  return [row.judgment, row.reasoning, tags].filter(Boolean).join('\n');
}

// v3 检索单元文本（MMS 检索形态）：供向量索引使用；reasoning 刻意不进（证据性文字稀释语义），
// 存量记忆缺新字段时回退 v2 文本，保证新旧记忆可共存于同一向量语料。
export function retrievalText(row) {
  const keywords = parseTags(row.keywords);
  const perspectives = parseTags(row.perspectives);
  if (!keywords.length && !perspectives.length && !row.episodic_note) return memoryText(row);
  return [
    row.judgment,
    keywords.join(' '),
    perspectives.join(' '),
    row.episodic_note || '',
  ].filter(Boolean).join('\n');
}

function formatMemory(row) {
  return {
    ...row,
    tags: parseTags(row.tags),
    entities: parseTags(row.entities),
    keywords: parseTags(row.keywords),
    perspectives: parseTags(row.perspectives),
    content: row.judgment || row.content,
    fragment_type: row.memory_type || row.fragment_type,
  };
}
