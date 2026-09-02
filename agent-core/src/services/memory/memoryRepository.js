import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { getDb } from '../../db/index.js';
import { getMemorySettings } from './memoryConfig.js';
import { embedMemoryText, getPreferredMemoryEmbeddingProfile } from './memoryProviders.js';
import { upsertVector, deleteVector, deleteByConversation } from '../vectorClient.js';
import { createMemoryIndexWorker } from './memoryIndexWorker.js';

const MEMORY_TYPES = new Set(['knowledge', 'skill', 'emotion', 'event']);
const SUBJECTS = new Set(['user', 'character', 'relationship', 'assistant']);
const INDEX_CONCURRENCY = 2;
// Memory v3 阶段二：三元组向量语料（query-to-triple 联想扩展，docs/memory-upgrade-plan.md §5.3）
export const MEMORY_TRIPLES_CORPUS = 'memory_triples_v1';
// 三元组向量 id 前缀：与记忆碎片 id 共用 memory_index_jobs 表，前缀隔离避免任务去重/互斥互相干扰
export const TRIPLE_JOB_PREFIX = 'trip_';
// 记忆整理嵌入走用户自定义 → 系统内置 API（120s）→ 本地 ONNX 的优先级，
// 独立失败计数 embedding_index，当日失败满 5 次才降级本地。
const INDEX_EMBED_TIMEOUT_MS = 120000;
const INDEX_JOB_DELAY_MS = 100;
const PRIORITY_LIVE = 0;
const PRIORITY_RETRY = 5;
const PRIORITY_HISTORY = 10;

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

export function applyMemoryActions({ conversationId, sourceRawStartId, sourceRawEndId, sourceMessageId = null, actions, eventTime = null }) {
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
      const contentHash = crypto.createHash('sha256').update(`${conversationId}\n${item.memory.memoryType}\n${item.memory.judgment}`).digest('hex');
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
function enqueueTripleIndexJob(db, jobType, tripleId, priority = PRIORITY_HISTORY) {
  return enqueueIndexJob(db, jobType, `${TRIPLE_JOB_PREFIX}${tripleId}`, null, priority);
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
    const { embedding } = await embedMemoryText(text, settings, { timeoutMs: INDEX_EMBED_TIMEOUT_MS, failureKind: 'embedding_index', slowThresholdMs: null });
    const current = getDb().prepare(`SELECT valid_to FROM memory_triples WHERE id = ?`).get(tripleId);
    if (!current || current.valid_to != null) return false;
    await upsertVector(vectorId, text, metadata, null, MEMORY_TRIPLES_CORPUS, embedding);
    getDb().prepare(`UPDATE memory_triples SET embedding_state = 'indexed' WHERE id = ?`).run(tripleId);
    return true;
  } catch (error) {
    getDb().prepare(`UPDATE memory_triples SET embedding_state = 'failed' WHERE id = ?`).run(tripleId);
    throw error;
  }
}

async function removeMemoryTripleVector(tripleId) {
  await deleteVector(`${TRIPLE_JOB_PREFIX}${tripleId}`, MEMORY_TRIPLES_CORPUS);
}

function invalidateMemoryTriples(db, memoryId) {
  const rows = db.prepare(`SELECT id FROM memory_triples WHERE memory_id = ? AND valid_to IS NULL`).all(memoryId);
  if (rows.length === 0) return;
  db.prepare(`UPDATE memory_triples SET valid_to = CURRENT_TIMESTAMP WHERE memory_id = ? AND valid_to IS NULL`).run(memoryId);
  // 双时态失效的三元组同步出向量库（阶段二联想扩展只用现行三元组）
  for (const row of rows) enqueueTripleIndexJob(db, 'triple_delete', row.id, PRIORITY_LIVE);
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
      const tripleRows = db.prepare(`SELECT id FROM memory_triples WHERE memory_id = ?`).all(row.memory_id);
      db.prepare(`DELETE FROM memory_triples WHERE memory_id = ?`).run(row.memory_id);
      for (const tripleRow of tripleRows) enqueueTripleIndexJob(db, 'triple_delete', tripleRow.id, PRIORITY_LIVE);
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
  // 先收出现行三元组 id：清空后需补发 triple_delete 任务出向量库
  const ids = rows.map(row => row.memory_id).filter(Boolean);
  const tripleIds = ids.length
    ? db.prepare(`SELECT id FROM memory_triples WHERE memory_id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(row => row.id)
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
  for (const tripleId of tripleIds) enqueueTripleIndexJob(db, 'triple_delete', tripleId, PRIORITY_LIVE);
  wakeMemoryIndexWorker();
  const corpora = [...new Set(rows.map(row => row.embedding_profile).filter(profile => profile && profile !== 'local_builtin').map(profile => `memory_v2_${profile}`))];
  void deleteByConversation(conversationId).catch(() => {});
  void deleteByConversation(conversationId, MEMORY_TRIPLES_CORPUS).catch(() => {});
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
  enqueueFollowUpsForProcessingUpserts(db, PRIORITY_RETRY);
  wakeMemoryIndexWorker();
  return { total, queued: total };
}

export async function ensureDefaultMemoryIndexes() {
  const db = getDb();
  const settingKey = 'memory_default_models_indexed_v1';
  startMemoryIndexWorker();
  const existing = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(settingKey);
  if (existing?.setting_value === '1') {
    wakeMemoryIndexWorker();
    return { skipped: true, pending: pendingIndexJobCount(db) };
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
  return { total, queued: total };
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

  const deletes = db.prepare(`SELECT DISTINCT memory_id, profile FROM memory_index_jobs WHERE job_type = 'delete' AND status = 'failed'`).all();
  for (const row of deletes) {
    retryOrEnqueueIndexJob(db, 'delete', row.memory_id, row.profile, PRIORITY_RETRY);
  }
  wakeMemoryIndexWorker();
  return {
    total: upsertCount,
    queued: upsertCount,
    deleteTotal: deletes.length,
    deleteQueued: deletes.length,
  };
}

export function memoryStats() {
  const db = getDb();
  const counts = db.prepare(`SELECT status, embedding_state, COUNT(*) AS count FROM memory_fragments GROUP BY status, embedding_state`).all();
  const settings = getMemorySettings();
  const entities = db.prepare(`SELECT COUNT(*) AS count FROM memory_entities`).get().count;
  const triples = db.prepare(`SELECT COUNT(*) AS count FROM memory_triples WHERE valid_to IS NULL`).get().count;
  return { mode: settings.mode, profile: settings.profile, rows: counts, entities, activeTriples: triples };
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
        error = NULL, updated_at = CURRENT_TIMESTAMP
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
      if (tripleId) await removeMemoryTripleVector(tripleId);
    } else {
      throw new Error(`unsupported memory index job type: ${job.job_type}`);
    }
    finishIndexJob(job.id, 'completed');
  } catch (error) {
    finishIndexJob(job.id, 'failed', error.message);
    throw error;
  }
}

function finishIndexJob(jobId, status, error = null) {
  getDb().prepare(`UPDATE memory_index_jobs SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
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
