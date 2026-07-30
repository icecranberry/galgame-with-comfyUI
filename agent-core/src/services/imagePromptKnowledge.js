import { getDb } from '../db/index.js';
import { containsExplicitAdultContent } from '../db/imagePromptKnowledgePolicy.js';
import { vectorSearch, upsertVectors, deleteVector } from './vectorClient.js';

export const IMAGE_PROMPT_CORPUS = 'image_prompt_knowledge';
const RRF_K = 60;
const VECTOR_THRESHOLD = 0.22;
const MAX_PER_CATEGORY = 2;
const FRAMEWORK_KEYWORD_BOOST = 15;
const VECTOR_SYNC_BATCH_SIZE = 32;
let syncedVersion = null;
let syncPromise = null;

function parseScenes(value) {
  try { return JSON.parse(value || '[]'); } catch { return []; }
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

async function syncKnowledgeVectors(db = getDb()) {
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
  if (syncedVersion === version) return;
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
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
    for (let offset = 0; offset < vectorItems.length; offset += VECTOR_SYNC_BATCH_SIZE) {
      await upsertVectors(vectorItems.slice(offset, offset + VECTOR_SYNC_BATCH_SIZE), IMAGE_PROMPT_CORPUS);
    }
    syncedVersion = version;
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

export async function retrieveImagePromptKnowledge(query, { scene = 'chat', limit = 9, db = getDb() } = {}) {
  const rows = db.prepare(`SELECT * FROM image_prompt_knowledge WHERE is_active = 1`).all();
  const sceneRows = rows.filter(row => sceneMatches(row, scene) && queryAllowsCategory(query, row.category));
  const rowsById = new Map(sceneRows.map(row => [row.knowledge_id, rowToItem(row)]));
  const keywordItems = keywordSearchImagePromptKnowledge(query, { scene, limit: limit * 3, db });
  let vectorItems = [];
  let mode = 'keyword';

  try {
    await syncKnowledgeVectors(db);
    const results = await vectorSearch(query, { topK: limit * 3, corpus: IMAGE_PROMPT_CORPUS });
    vectorItems = results
      .filter(result => result.score >= VECTOR_THRESHOLD && rowsById.has(result.id))
      .map(result => ({ ...rowsById.get(result.id), score: result.score }));
    mode = 'hybrid';
  } catch (error) {
    console.warn(`[imagePromptKnowledge] vector fallback: ${error.message}`);
  }

  const fused = fuseRrf(keywordItems, vectorItems, rowsById);
  const defaults = sceneRows.filter(row => row.is_default).map(rowToItem);
  const items = applyCategoryQuota(fused, defaults, limit);
  return {
    mode,
    scene,
    query,
    items,
    knowledgeIds: items.map(item => item.id),
    knowledgeVersion: [...new Set(items.map(item => item.version))].join(','),
  };
}
