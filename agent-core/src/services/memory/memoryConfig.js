import crypto from 'crypto';
import { getDb } from '../../db/index.js';

export const DEFAULT_MEMORY_SETTINGS = Object.freeze({
  enabled: true,
  topK: 5,
  textCandidates: 24,
  vectorCandidates: 24,
  recordUnengagedEvents: true,
  embedding: {
    enabled: false,
    provider: 'custom',
    baseURL: '',
    apiKey: '',
    model: '',
    dimensions: null,
    headers: {},
    timeoutMs: 8000,
  },
  reranker: {
    enabled: false,
    provider: 'custom',
    baseURL: '',
    apiKey: '',
    model: '',
    topN: 7,
    headers: {},
    timeoutMs: 8000,
  },
});

export const EMBEDDING_PROVIDERS = new Set(['openai', 'siliconflow', 'jina', 'custom']);
export const RERANKER_PROVIDERS = new Set(['jina', 'cohere', 'siliconflow', 'voyage', 'custom']);

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_MEMORY_SETTINGS));
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeMemorySettings(input = {}, previous = null) {
  const base = previous || cloneDefaults();
  const embedding = objectOrEmpty(input.embedding);
  const reranker = objectOrEmpty(input.reranker);
  const merged = {
    enabled: input.enabled === undefined ? base.enabled : Boolean(input.enabled),
    topK: clampInt(input.topK, base.topK, 1, 20),
    textCandidates: clampInt(input.textCandidates, base.textCandidates, 5, 100),
    vectorCandidates: clampInt(input.vectorCandidates, base.vectorCandidates, 5, 100),
    recordUnengagedEvents: input.recordUnengagedEvents === undefined ? base.recordUnengagedEvents : Boolean(input.recordUnengagedEvents),
    embedding: {
      ...base.embedding,
      ...embedding,
      enabled: embedding.enabled === undefined ? base.embedding.enabled : Boolean(embedding.enabled),
      headers: objectOrEmpty(embedding.headers ?? base.embedding.headers),
      dimensions: embedding.dimensions === undefined
        ? base.embedding.dimensions
        : (embedding.dimensions ? clampInt(embedding.dimensions, null, 1, 65536) : null),
      timeoutMs: clampInt(embedding.timeoutMs, base.embedding.timeoutMs, 1000, 60000),
    },
    reranker: {
      ...base.reranker,
      ...reranker,
      enabled: reranker.enabled === undefined ? base.reranker.enabled : Boolean(reranker.enabled),
      headers: objectOrEmpty(reranker.headers ?? base.reranker.headers),
      topN: clampInt(reranker.topN, base.reranker.topN, 1, 50),
      timeoutMs: clampInt(reranker.timeoutMs, base.reranker.timeoutMs, 1000, 60000),
    },
  };
  merged.embedding.provider = normalizeProvider(merged.embedding.provider, EMBEDDING_PROVIDERS);
  merged.embedding.baseURL = String(merged.embedding.baseURL || '').trim().replace(/\/$/, '');
  merged.embedding.model = String(merged.embedding.model || '').trim();
  merged.embedding.apiKey = String(merged.embedding.apiKey || '');
  merged.reranker.provider = normalizeProvider(merged.reranker.provider, RERANKER_PROVIDERS);
  merged.reranker.baseURL = String(merged.reranker.baseURL || '').trim().replace(/\/$/, '');
  merged.reranker.model = String(merged.reranker.model || '').trim();
  merged.reranker.apiKey = String(merged.reranker.apiKey || '');
  return merged;
}

export function getMemorySettings({ includeSecrets = false } = {}) {
  const row = getDb().prepare(`SELECT setting_value FROM system_settings WHERE setting_key = 'memory_settings'`).get();
  let stored = {};
  try { stored = row ? JSON.parse(row.setting_value) : {}; } catch { stored = {}; }
  const settings = normalizeMemorySettings(stored);
  if (includeSecrets) return settings;
  return maskSecrets(settings);
}

export function saveMemorySettings(input) {
  const previous = getMemorySettings({ includeSecrets: true });
  const nextInput = JSON.parse(JSON.stringify(input || {}));
  for (const key of ['embedding', 'reranker']) {
    nextInput[key] ||= {};
    if (!Object.prototype.hasOwnProperty.call(nextInput[key], 'apiKey') || nextInput[key].apiKey === '') {
      nextInput[key].apiKey = previous[key].apiKey;
    }
  }
  const settings = normalizeMemorySettings(nextInput, previous);
  validateProvider(settings.embedding, '嵌入模型');
  validateProvider(settings.reranker, '重排序模型');
  getDb().prepare(`
    INSERT INTO system_settings(setting_key, setting_value, updated_at)
    VALUES ('memory_settings', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
  `).run(JSON.stringify(settings));
  return settings;
}

export function getEmbeddingProfile(settings = getMemorySettings({ includeSecrets: true })) {
  if (!settings.embedding.enabled || !settings.embedding.baseURL || !settings.embedding.model) return null;
  const raw = JSON.stringify({
    provider: settings.embedding.provider,
    baseURL: settings.embedding.baseURL,
    model: settings.embedding.model,
    dimensions: settings.embedding.dimensions || null,
  });
  const fingerprint = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return { fingerprint, corpus: `memory_v2_${fingerprint}` };
}

export function getMemoryMode(settings = getMemorySettings({ includeSecrets: true })) {
  return 'hybrid';
}

function maskSecrets(settings) {
  const copy = JSON.parse(JSON.stringify(settings));
  for (const key of ['embedding', 'reranker']) {
    const secret = copy[key].apiKey || '';
    copy[key].hasApiKey = Boolean(secret);
    copy[key].apiKeyPreview = secret ? `${secret.slice(0, 3)}***${secret.slice(-2)}` : '';
    copy[key].apiKey = '';
  }
  copy.mode = getMemoryMode(settings);
  copy.profile = getEmbeddingProfile(settings)?.fingerprint || null;
  return copy;
}

function validateProvider(provider, label) {
  if (!provider.enabled) return;
  if (!provider.baseURL || !provider.model) throw new Error(`${label}启用后必须填写地址和模型`);
  try { new URL(provider.baseURL); } catch { throw new Error(`${label}地址无效`); }
}

function normalizeProvider(value, allowed) {
  const provider = String(value || 'custom').trim().toLowerCase();
  return allowed.has(provider) ? provider : 'custom';
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
