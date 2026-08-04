import { getDb } from '../db/index.js';
import { containsExplicitAdultContent } from '../db/imagePromptKnowledgePolicy.js';
import { vectorSearch, upsertVectors, deleteVector, getImageKnowledgeCount } from './vectorClient.js';
import { isUserQuiet } from './imageSkill.js';

export const IMAGE_PROMPT_CORPUS = 'image_prompt_knowledge';
const RRF_K = 60;
const VECTOR_THRESHOLD = 0.22;
const MAX_PER_CATEGORY = 2;
const FRAMEWORK_KEYWORD_BOOST = 15;
const VECTOR_SYNC_BATCH_SIZE = 12;
export const RAG_TIMEOUT_DEFAULT_MS = 8000;
export const RAG_TIMEOUT_FAST_MS = 2500;
const VECTOR_FAILURE_LIMIT = 5;
const VECTOR_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
let vectorFailureCount = 0;
let vectorDisabledUntil = 0;
const SYNC_VERSION_SETTING_KEY = 'image_prompt_knowledge_synced_version';
const SYNC_CURSOR_SETTING_KEY = 'image_prompt_knowledge_sync_cursor';
const SYNC_BATCH_DELAY_MS = 50;
let persistedVersionLoaded = false;
let syncedVersion = null;
let syncCursor = null;
let syncPromise = null;

function parseScenes(value) {
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

function parseExecutableTags(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item => ({
        tag: String(item?.tag || '').trim(),
        label: String(item?.label || '').trim(),
        group: String(item?.group || '').trim(),
      }))
      .filter(item => item.tag);
  } catch {
    return [];
  }
}

function tokenize(text) {
  const normalized = String(text || '').toLowerCase();
  const latin = normalized.match(/[a-z0-9_()-]{2,}/g) || [];
  const han = normalized.match(/[\u3400-\u9fff]{1,4}/g) || [];
  return [...new Set([...latin, ...han])];
}

function rowToItem(row) {
  return {
    id: row.knowledge_id,
    category: row.category,
    title: row.title,
    content: row.content,
    executableTags: parseExecutableTags(row.executable_tags),
    searchTerms: row.search_terms || '',
    scenes: parseScenes(row.scenes),
    isDefault: Boolean(row.is_default),
    priority: row.priority,
    version: row.version,
  };
}

function sceneMatches(row, scene) {
  const scenes = parseScenes(row.scenes);
  return !scene || scenes.length === 0 || scenes.includes(scene);
}

function queryAllowsCategory(query, category) {
  return !String(category || '').startsWith('adult_') || containsExplicitAdultContent(query);
}

export function keywordSearchImagePromptKnowledge(query, { scene = 'chat', limit = 20, db = getDb() } = {}) {
  const terms = tokenize(query);
  const rows = db.prepare(`SELECT * FROM image_prompt_knowledge WHERE is_active = 1`).all();
  return rows
    .filter(row => sceneMatches(row, scene) && queryAllowsCategory(query, row.category))
    .map(row => {
      const title = row.title.toLowerCase();
      const searchTerms = row.search_terms.toLowerCase();
      const content = row.content.toLowerCase();
      let score = row.is_default ? 0.05 : 0;
      let matched = false;
      for (const term of terms) {
        if (searchTerms.includes(term)) { score += 3; matched = true; }
        if (title.includes(term)) { score += 2; matched = true; }
        if (content.includes(term)) { score += 1; matched = true; }
      }
      if (matched && !row.knowledge_id.startsWith('ipk.lib.')) score += FRAMEWORK_KEYWORD_BOOST;
      return { ...rowToItem(row), score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.priority - a.priority)
    .slice(0, limit);
}

function loadPersistedVersion(db) {
  persistedVersionLoaded = true;
  try {
    syncedVersion = db.prepare(
      `SELECT setting_value FROM system_settings WHERE setting_key = ?`
    ).pluck().get(SYNC_VERSION_SETTING_KEY) || null;
  } catch (error) {
    syncedVersion = null;
  }
}

function persistSyncVersion(db, version) {
  db.prepare(`
    INSERT INTO system_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = CURRENT_TIMESTAMP
  `).run(SYNC_VERSION_SETTING_KEY, version);
  syncedVersion = version;
}

function loadSyncCursor(db) {
  try {
    const raw = db.prepare(
      `SELECT setting_value FROM system_settings WHERE setting_key = ?`
    ).pluck().get(SYNC_CURSOR_SETTING_KEY);
    syncCursor = raw ? JSON.parse(raw) : null;
  } catch (error) {
    syncCursor = null;
  }
}

function persistSyncCursor(db, cursor) {
  db.prepare(`
    INSERT INTO system_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = CURRENT_TIMESTAMP
  `).run(SYNC_CURSOR_SETTING_KEY, JSON.stringify(cursor));
  syncCursor = cursor;
}

function clearSyncCursor(db) {
  try {
    db.prepare(`DELETE FROM system_settings WHERE setting_key = ?`).run(SYNC_CURSOR_SETTING_KEY);
  } catch (error) {
    console.warn('[imagePromptKnowledge] clear sync cursor failed:', error.message);
  }
  syncCursor = null;
}

const sleepSyncDelay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function computeKnowledgeVersion(db) {
  const rows = db.prepare(`SELECT * FROM image_prompt_knowledge WHERE is_active = 1 ORDER BY knowledge_id`).all();
  const staleIds = db.prepare(`
    SELECT knowledge_id FROM image_prompt_knowledge
    WHERE is_active = 0 AND knowledge_id LIKE 'ipk.lib.%'
    ORDER BY knowledge_id
  `).pluck().all();
  return [
    ...rows.map(row => `${row.knowledge_id}:${row.version}:${row.updated_at}`),
    ...staleIds.map(id => `stale:${id}`),
  ].join('|');
}

async function syncKnowledgeVectors(db = getDb(), timeoutMs = RAG_TIMEOUT_DEFAULT_MS) {
  const rows = db.prepare(`SELECT * FROM image_prompt_knowledge WHERE is_active = 1 ORDER BY knowledge_id`).all();
  const staleIds = db.prepare(`
    SELECT knowledge_id FROM image_prompt_knowledge
    WHERE is_active = 0 AND knowledge_id LIKE 'ipk.lib.%'
    ORDER BY knowledge_id
  `).pluck().all();
  const version = [
    ...rows.map(row => `${row.knowledge_id}:${row.version}:${row.updated_at}`),
    ...staleIds.map(id => `stale:${id}`),
  ].join('|');
  if (!persistedVersionLoaded) {
    loadPersistedVersion(db);
    loadSyncCursor(db);
  }
  if (syncedVersion === version) return;
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    const currentSeedVersion = db.prepare(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'image_prompt_knowledge_version'`
    ).pluck().get() || '';

    // 游标仅在“知识库内容未变、同步未完成”时有效，否则丢弃重来
    if (syncCursor && syncCursor.seedVersion !== currentSeedVersion) syncCursor = null;
    if (syncedVersion && syncedVersion !== version) {
      syncCursor = null;
      clearSyncCursor(db);
    }

    // 首次运行（无持久化版本、无游标）且向量库已有完整数据且知识库版本一致 → 直接标记已同步
    if (!syncedVersion && !syncCursor) {
      const knownCount = await getImageKnowledgeCount();
      if (Number.isInteger(knownCount) && knownCount >= rows.length) {
        persistSyncVersion(db, version);
        return;
      }
    }

    for (const id of staleIds) {
      await deleteVector(id, IMAGE_PROMPT_CORPUS);
    }

    const vectorItems = rows.map(row => ({
      chroma_id: row.knowledge_id,
      text: `${row.title}\n${row.search_terms}\n${row.content}`,
      metadata: {
        category: row.category,
        version: row.version,
        priority: row.priority,
      },
      fragment_type: null,
    }));
    const startFrom = syncCursor ? syncCursor.lastId : null;
    for (let offset = 0; offset < vectorItems.length; offset += VECTOR_SYNC_BATCH_SIZE) {
      const batch = vectorItems.slice(offset, offset + VECTOR_SYNC_BATCH_SIZE);
      const toWrite = startFrom ? batch.filter(item => item.chroma_id > startFrom) : batch;
      if (toWrite.length > 0) {
        await upsertVectors(toWrite, IMAGE_PROMPT_CORPUS, timeoutMs);
        const lastWrittenId = toWrite[toWrite.length - 1].chroma_id;
        persistSyncCursor(db, { lastId: lastWrittenId, seedVersion: currentSeedVersion });
        await sleepSyncDelay(SYNC_BATCH_DELAY_MS);
      }
    }
    clearSyncCursor(db);
    persistSyncVersion(db, version);
  })().finally(() => { syncPromise = null; });
  return syncPromise;
}

function fuseRrf(keywordItems, vectorItems, rowsById) {
  const scores = new Map();
  const add = (id, rank, weight) => scores.set(id, (scores.get(id) || 0) + weight / (RRF_K + rank + 1));
  keywordItems.forEach((item, rank) => add(item.id, rank, 1));
  vectorItems.forEach((item, rank) => add(item.id, rank, 1));

  return [...scores.entries()]
    .map(([id, score]) => {
      const item = rowsById.get(id);
      return item ? { ...item, score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.priority - a.priority);
}

function applyCategoryQuota(items, defaults, limit) {
  const selected = [];
  const ids = new Set();
  const counts = new Map();
  const add = item => {
    if (!item || ids.has(item.id) || selected.length >= limit) return;
    const count = counts.get(item.category) || 0;
    if (count >= MAX_PER_CATEGORY) return;
    selected.push(item);
    ids.add(item.id);
    counts.set(item.category, count + 1);
  };

  items.forEach(add);
  defaults.sort((a, b) => b.priority - a.priority).forEach(add);
  return selected;
}

export async function retrieveImagePromptKnowledge(query, { scene = 'chat', limit = 9, db = getDb(), timeoutMs = RAG_TIMEOUT_DEFAULT_MS } = {}) {
  const startedAt = performance.now();
  const rows = db.prepare(`SELECT * FROM image_prompt_knowledge WHERE is_active = 1`).all();
  const sceneRows = rows.filter(row => sceneMatches(row, scene) && queryAllowsCategory(query, row.category));
  const rowsById = new Map(sceneRows.map(row => [row.knowledge_id, rowToItem(row)]));
  const keywordItems = keywordSearchImagePromptKnowledge(query, { scene, limit: limit * 3, db });
  let vectorItems = [];
  let mode = 'keyword';
  let degraded = null;
  const vectorDisabled = Date.now() < vectorDisabledUntil;
  if (!persistedVersionLoaded) loadPersistedVersion(db);
  const vectorReady = syncedVersion === computeKnowledgeVersion(db);

  if (vectorDisabled) {
    degraded = 'cooldown';
  } else if (!vectorReady) {
    // 向量库尚未同步完成：不阻塞生图，直接本地 keyword 检索；同步由后台调度器在用户安静时执行
    degraded = 'pending-sync';
  } else {
    try {
      const results = await vectorSearch(query, { topK: limit * 3, corpus: IMAGE_PROMPT_CORPUS, timeoutMs });
      vectorItems = results
        .filter(result => result.score >= VECTOR_THRESHOLD && rowsById.has(result.id))
        .map(result => ({ ...rowsById.get(result.id), score: result.score }));
      mode = 'hybrid';
      if (vectorFailureCount > 0) vectorFailureCount = 0;
    } catch (error) {
      vectorFailureCount += 1;
      console.warn(`[imagePromptKnowledge] vector fallback (${vectorFailureCount}/${VECTOR_FAILURE_LIMIT}): ${error.message}`);
      if (vectorFailureCount >= VECTOR_FAILURE_LIMIT) {
        vectorFailureCount = 0;
        vectorDisabledUntil = Date.now() + VECTOR_FAILURE_COOLDOWN_MS;
        degraded = 'disabled';
        console.warn(`[imagePromptKnowledge] vector search disabled for ${VECTOR_FAILURE_COOLDOWN_MS / 1000}s`);
      } else {
        degraded = degraded || 'fallback';
      }
    }
  }

  const fused = fuseRrf(keywordItems, vectorItems, rowsById);
  const defaults = sceneRows.filter(row => row.is_default).map(rowToItem);
  const items = applyCategoryQuota(fused, defaults, limit);
  return {
    mode,
    degraded,
    durationMs: Math.round(performance.now() - startedAt),
    scene,
    query,
    items,
    knowledgeIds: items.map(item => item.id),
    knowledgeVersion: [...new Set(items.map(item => item.version))].join(','),
  };
}

let syncSchedulerTimer = null;
let syncCheckInFlight = false;
const SYNC_CHECK_INTERVAL_MS = 60 * 1000;

export function startKnowledgeSyncScheduler() {
  if (syncSchedulerTimer) return;
  console.log('[imagePromptKnowledge] sync scheduler started (runs when user is quiet)');
  setTimeout(syncTick, 15 * 1000);
  syncSchedulerTimer = setInterval(syncTick, SYNC_CHECK_INTERVAL_MS);
}

async function syncTick() {
  if (syncCheckInFlight || syncPromise) return;
  syncCheckInFlight = true;
  try {
    const db = getDb();
    if (!persistedVersionLoaded) {
      loadPersistedVersion(db);
      loadSyncCursor(db);
    }
    if (syncedVersion === computeKnowledgeVersion(db)) return;
    if (!isUserQuiet()) return;
    await syncKnowledgeVectors(db, RAG_TIMEOUT_DEFAULT_MS);
  } catch (error) {
    console.warn(`[imagePromptKnowledge] background sync failed: ${error.message}`);
  } finally {
    syncCheckInFlight = false;
  }
}
