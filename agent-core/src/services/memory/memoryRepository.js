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

export function normalizeMemory(memory = {}) {
  const memoryType = String(memory.memoryType || memory.memory_type || 'knowledge').toLowerCase();
  if (!MEMORY_TYPES.has(memoryType)) throw new Error(`无效 memoryType: ${memoryType}`);
  const subject = String(memory.subject || 'user').toLowerCase();
  if (!SUBJECTS.has(subject)) throw new Error(`无效 subject: ${subject}`);
  const judgment = String(memory.judgment || '').replace(/\s+/g, ' ').trim();
  if (!judgment) throw new Error('judgment 不能为空');
  const reasoning = String(memory.reasoning || '').replace(/\s+/g, ' ').trim();
  if (containsSensitiveSecret(`${judgment}\n${reasoning}`)) throw new Error('记忆疑似包含密码、密钥或敏感凭据，已拒绝保存');
  const tags = [...new Set(parseTags(memory.tags).map(tag => String(tag).trim()).filter(Boolean))].slice(0, 12);
  if (tags.length === 0) throw new Error('tags 至少需要一个检索锚点');
  return { memoryType, subject, judgment, reasoning, tags };
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

export function applyMemoryActions({ conversationId, sourceRawStartId, sourceRawEndId, sourceMessageId = null, actions }) {
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
          source_raw_start_id, source_raw_end_id, embedding_profile, embedding_state, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        conversationId, sourceMessageId, legacyType, item.memory.judgment, JSON.stringify(item.memory.tags),
        memoryId, item.memory.memoryType, item.memory.subject, item.memory.judgment, item.memory.reasoning,
        JSON.stringify(item.memory.tags), contentHash, sourceRawStartId, sourceRawEndId,
        profile?.fingerprint || null, profile ? 'pending' : 'disabled'
      );
      for (const source of sources) {
        db.prepare(`UPDATE memory_fragments SET status = 'superseded', updated_at = CURRENT_TIMESTAMP WHERE memory_id = ?`).run(source.memory_id);
        db.prepare(`INSERT INTO memory_relations(from_memory_id, to_memory_id, action) VALUES (?, ?, ?)`).run(source.memory_id, memoryId, item.action);
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
      const predecessors = db.prepare(`SELECT from_memory_id FROM memory_relations WHERE to_memory_id = ?`).all(row.memory_id);
      for (const predecessor of predecessors) {
        if (affectedIds.has(predecessor.from_memory_id)) continue;
        db.prepare(`UPDATE memory_fragments SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE memory_id = ? AND status = 'superseded'`).run(predecessor.from_memory_id);
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
  const transaction = db.transaction(() => {
    const ids = rows.map(row => row.memory_id).filter(Boolean);
    if (ids.length) {
      db.prepare(`DELETE FROM memory_relations WHERE from_memory_id IN (${ids.map(() => '?').join(',')}) OR to_memory_id IN (${ids.map(() => '?').join(',')})`).run(...ids, ...ids);
      db.prepare(`DELETE FROM memory_index_jobs WHERE memory_id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    }
    db.prepare(`DELETE FROM memory_fragments WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`DELETE FROM memory_extraction_checkpoints WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`DELETE FROM memory_retrieval_audits WHERE conversation_id = ?`).run(conversationId);
  });
  transaction();
  const corpora = [...new Set(rows.map(row => row.embedding_profile).filter(profile => profile && profile !== 'local_builtin').map(profile => `memory_v2_${profile}`))];
  void deleteByConversation(conversationId).catch(() => {});
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
    const text = memoryText(row);
    const metadata = {
      memory_id: memoryId,
      conversation_id: row.conversation_id,
      memory_type: row.memory_type,
      tags: JSON.stringify(parseTags(row.tags)),
    };
    const { embedding, profile } = await embedMemoryText(text, settings);
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
  return { mode: settings.mode, profile: settings.profile, rows: counts };
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
  const profile = getPreferredMemoryEmbeddingProfile().fingerprint;
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
          getPreferredMemoryEmbeddingProfile().fingerprint,
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

function formatMemory(row) {
  return { ...row, tags: parseTags(row.tags), entities: parseTags(row.entities), content: row.judgment || row.content, fragment_type: row.memory_type || row.fragment_type };
}
