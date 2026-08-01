import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { getDb } from '../../db/index.js';
import { getMemorySettings } from './memoryConfig.js';
import { embedMemoryText, getPreferredMemoryEmbeddingProfile } from './memoryProviders.js';
import { upsertVector, deleteVector, deleteByConversation } from '../vectorClient.js';

const MEMORY_TYPES = new Set(['knowledge', 'skill', 'emotion', 'event']);
const SUBJECTS = new Set(['user', 'character', 'relationship', 'assistant']);

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
  const superseded = [];
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
        enqueueIndexJob(db, 'delete', source.memory_id, source.embedding_profile);
        superseded.push(source);
      }
      enqueueIndexJob(db, 'upsert', memoryId, profile?.fingerprint || null);
      created.push(memoryId);
    }
  });
  transaction();
  for (const row of superseded) void removeMemoryVector(row);
  for (const memoryId of created) void indexMemory(memoryId);
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
  enqueueIndexJob(db, 'delete', row.memory_id, row.embedding_profile);
  void removeMemoryVector(row);
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
  const restored = new Set();
  const transaction = db.transaction(() => {
    for (const row of affected) {
      db.prepare(`UPDATE memory_fragments SET status = 'deleted', source_msg_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
      const predecessors = db.prepare(`SELECT from_memory_id FROM memory_relations WHERE to_memory_id = ?`).all(row.memory_id);
      for (const predecessor of predecessors) {
        if (affectedIds.has(predecessor.from_memory_id)) continue;
        db.prepare(`UPDATE memory_fragments SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE memory_id = ? AND status = 'superseded'`).run(predecessor.from_memory_id);
        enqueueIndexJob(db, 'upsert', predecessor.from_memory_id, null);
        restored.add(predecessor.from_memory_id);
      }
      enqueueIndexJob(db, 'delete', row.memory_id, row.embedding_profile);
    }
    db.prepare(`
      INSERT INTO memory_extraction_checkpoints(conversation_id, last_raw_msg_id, status, last_error, updated_at)
      VALUES (?, ?, 'idle', NULL, CURRENT_TIMESTAMP)
      ON CONFLICT(conversation_id) DO UPDATE SET last_raw_msg_id = excluded.last_raw_msg_id, status = 'idle', last_error = NULL, updated_at = CURRENT_TIMESTAMP
    `).run(conversationId, rollbackBoundary);
  });
  transaction();
  for (const row of affected) void removeMemoryVector(row);
  for (const memoryId of restored) void indexMemory(memoryId);
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
    let localReady = false;
    try {
      await upsertVector(memoryId, text, metadata);
      localReady = true;
    } catch (error) {
      console.warn('[memory-index] local backup failed:', error.message);
    }

    const { embedding, profile } = await embedMemoryText(text, settings);
    if (profile.corpus !== 'memory_fragments') {
      await upsertVector(memoryId, text, metadata, null, profile.corpus, embedding);
    } else if (!localReady) {
      await upsertVector(memoryId, text, metadata);
    }
    getDb().prepare(`UPDATE memory_fragments SET chroma_id = ?, embedding_profile = ?, embedding_state = 'indexed', embedding_error = NULL WHERE memory_id = ?`).run(memoryId, profile.fingerprint, memoryId);
    finishIndexJobs(memoryId, 'upsert', 'completed');
    return true;
  } catch (error) {
    getDb().prepare(`UPDATE memory_fragments SET embedding_state = 'failed', embedding_error = ? WHERE memory_id = ?`).run(String(error.message).slice(0, 500), memoryId);
    finishIndexJobs(memoryId, 'upsert', 'failed', error.message);
    return false;
  }
}

export async function reindexAllMemories() {
  const rows = getDb().prepare(`SELECT memory_id FROM memory_fragments WHERE status = 'active'`).all();
  const jobIds = [];
  for (const row of rows) {
    enqueueIndexJob(getDb(), 'upsert', row.memory_id, getPreferredMemoryEmbeddingProfile().fingerprint);
    jobIds.push(row.memory_id);
  }
  const results = [];
  for (const memoryId of jobIds) results.push(await indexMemory(memoryId));
  return { total: results.length, indexed: results.filter(Boolean).length };
}

export async function ensureDefaultMemoryIndexes() {
  const db = getDb();
  const settingKey = 'memory_default_models_indexed_v1';
  const existing = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(settingKey);
  if (existing?.setting_value === '1') return { skipped: true };

  db.prepare(`UPDATE memory_fragments SET embedding_state = 'stale', embedding_error = NULL WHERE status = 'active' AND embedding_state = 'disabled'`).run();

  const rows = db.prepare(`
    SELECT memory_id FROM memory_fragments
    WHERE status = 'active' AND embedding_state IN ('failed', 'pending', 'stale', 'disabled')
  `).all();
  const results = [];
  for (const row of rows) {
    enqueueIndexJob(db, 'upsert', row.memory_id, getPreferredMemoryEmbeddingProfile().fingerprint);
    results.push(await indexMemory(row.memory_id));
  }

  const result = { total: results.length, indexed: results.filter(Boolean).length };
  db.prepare(`
    INSERT INTO system_settings(setting_key, setting_value, updated_at)
    VALUES (?, '1', CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = '1', updated_at = CURRENT_TIMESTAMP
  `).run(settingKey);
  console.log(`[memory] default index initialization complete: total=${result.total}, indexed=${result.indexed}, failed=${result.total - result.indexed}`);
  return result;
}

export async function retryFailedIndexJobs() {
  const db = getDb();
  const upserts = db.prepare(`
    SELECT memory_id FROM memory_fragments
    WHERE status = 'active' AND embedding_state IN ('failed', 'pending', 'stale')
  `).all();
  for (const row of upserts) {
    const pending = db.prepare(`SELECT 1 FROM memory_index_jobs WHERE memory_id = ? AND job_type = 'upsert' AND status = 'pending' LIMIT 1`).get(row.memory_id);
    if (!pending) enqueueIndexJob(db, 'upsert', row.memory_id, getPreferredMemoryEmbeddingProfile().fingerprint);
  }
  const upsertResults = [];
  for (const row of upserts) upsertResults.push(await indexMemory(row.memory_id));

  const deletes = db.prepare(`
    SELECT DISTINCT mf.* FROM memory_index_jobs mij
    JOIN memory_fragments mf ON mf.memory_id = mij.memory_id
    WHERE mij.job_type = 'delete' AND mij.status = 'failed'
  `).all();
  for (const row of deletes) {
    db.prepare(`UPDATE memory_index_jobs SET status = 'pending', error = NULL, updated_at = CURRENT_TIMESTAMP WHERE memory_id = ? AND job_type = 'delete' AND status = 'failed'`).run(row.memory_id);
  }
  const deleteResults = await Promise.all(deletes.map(removeMemoryVector));
  return {
    total: upserts.length,
    indexed: upsertResults.filter(Boolean).length,
    deleteTotal: deletes.length,
    deleted: deleteResults.filter(Boolean).length,
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

function enqueueIndexJob(db, jobType, memoryId, profile) {
  db.prepare(`INSERT INTO memory_index_jobs(job_type, memory_id, profile, status) VALUES (?, ?, ?, 'pending')`).run(jobType, memoryId, profile);
}

function finishIndexJobs(memoryId, jobType, status, error = null) {
  getDb().prepare(`UPDATE memory_index_jobs SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE memory_id = ? AND job_type = ? AND status = 'pending'`).run(status, error, memoryId, jobType);
}

async function removeMemoryVector(row) {
  try {
    const corpora = ['memory_fragments'];
    if (row.embedding_profile && row.embedding_profile !== 'local_builtin') corpora.push(`memory_v2_${row.embedding_profile}`);
    const results = await Promise.allSettled(corpora.map(corpus => deleteVector(row.memory_id || row.chroma_id, corpus)));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    finishIndexJobs(row.memory_id, 'delete', 'completed');
    return true;
  } catch (error) {
    finishIndexJobs(row.memory_id, 'delete', 'failed', error.message);
    return false;
  }
}

function memoryText(row) {
  const tags = parseTags(row.tags).join(' ');
  return [row.judgment, row.reasoning, tags].filter(Boolean).join('\n');
}

function formatMemory(row) {
  return { ...row, tags: parseTags(row.tags), entities: parseTags(row.entities), content: row.judgment || row.content, fragment_type: row.memory_type || row.fragment_type };
}
