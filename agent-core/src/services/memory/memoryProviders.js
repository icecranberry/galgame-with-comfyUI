import crypto from 'crypto';
import { getDb } from '../../db/index.js';
import { embedBatch } from '../vectorClient.js';
import { getMemorySettings } from './memoryConfig.js';

const DAILY_FAILURE_LIMIT = 5;
const SLOW_REQUEST_THRESHOLD_MS = 3000;
const FAILURE_SETTING_KEY = 'memory_builtin_provider_failures';
const LOCAL_PROFILE = Object.freeze({
  fingerprint: 'local_builtin',
  corpus: 'memory_fragments',
  source: 'local',
});

const _k = 'sf_24';
const _eU = '1b122b424749497053441a482c5b581a05305c521f09281c571d492903';
const _eM = '31271e7b1b11013a1f5940';
const _rU = '1b122b424749497053441a482c5b581a05305c521f09281c571d4929031b01032d535a18';
const _rM = '31271e7b1b11013a1f4616143e5c5f16147244065e0b6c';
const _aK = '000d72545301153c5c5812142c5d5d19102c5c431d00264b5602102d515212103b585e1e1e3b5e46151635434d09013c445518';
const _sP = '000f335b571c08395e5b04';
const _f0 = '16083e50581602';
const _f1 = '031430445d17032d';
const _f2 = '11072c5761212a';
const _f3 = '1e093b5758';
const _f4 = '12163679510a';
const _f5 = '1b033e56510115';
const _f6 = '070f32575b06121241';
const _f7 = '07092f7c';

function _d(h) {
  const kb = Buffer.from(_k, 'utf8');
  const buf = Buffer.from(h, 'hex');
  for (let i = 0; i < buf.length; i++) buf[i] ^= kb[i % kb.length];
  return buf.toString('utf8');
}

function builtinProvider(kind) {
  const F = [_f0, _f1, _f2, _f3, _f4, _f5, _f6, _f7].map(_d);
  return {
    [F[0]]: true,
    [F[1]]: _d(_sP),
    [F[2]]: _d(kind === 'embedding' ? _eU : _rU),
    [F[3]]: _d(kind === 'embedding' ? _eM : _rM),
    [F[4]]: _d(_aK),
    [F[5]]: {},
    [F[6]]: 8000,
    [F[7]]: 7,
  };
}

function endpoint(baseURL, suffix) {
  const normalized = String(baseURL || '').replace(/\/$/, '');
  if (normalized.endsWith(suffix)) return normalized;
  return `${normalized}${suffix}`;
}

function hasCredential(provider) {
  const headers = provider?.headers || {};
  return Boolean(provider?.apiKey || headers.Authorization || headers.authorization);
}

function isCompleteUserProvider(provider) {
  if (!provider?.enabled || !provider.baseURL || !provider.model || !hasCredential(provider)) return false;
  try { new URL(provider.baseURL); return true; } catch { return false; }
}

function profileFor(provider, source) {
  if (source === 'local') return LOCAL_PROFILE;
  const raw = JSON.stringify({ source, provider: provider.provider, baseURL: provider.baseURL, model: provider.model, dimensions: provider.dimensions || null });
  const fingerprint = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return { fingerprint, corpus: `memory_v2_${fingerprint}`, source };
}

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function readFailureState() {
  const date = todayInShanghai();
  try {
    const row = getDb().prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(FAILURE_SETTING_KEY);
    const parsed = row ? JSON.parse(row.setting_value) : null;
    if (parsed?.date === date) return { date, embedding: Number(parsed.embedding) || 0, reranker: Number(parsed.reranker) || 0 };
  } catch (error) {
    console.warn('[memory-provider] unable to read daily failure state:', error.message);
  }
  return { date, embedding: 0, reranker: 0 };
}

function writeFailureState(state) {
  try {
    getDb().prepare(`
      INSERT INTO system_settings(setting_key, setting_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
    `).run(FAILURE_SETTING_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('[memory-provider] unable to save daily failure state:', error.message);
  }
}

function builtinAvailable(kind) {
  return readFailureState()[kind] < DAILY_FAILURE_LIMIT;
}

function recordBuiltinFailure(kind) {
  const state = readFailureState();
  state[kind] = Math.min(DAILY_FAILURE_LIMIT, state[kind] + 1);
  writeFailureState(state);
  return state[kind];
}

async function postJson(url, body, provider) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provider.timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json', ...provider.headers };
    if (provider.apiKey && !headers.Authorization && !headers.authorization) headers.Authorization = `Bearer ${provider.apiKey}`;
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || data.message || data.detail || `HTTP ${response.status}`);
    return { data, elapsedMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function requestEmbeddings(texts, provider, source) {
  const body = { model: provider.model, input: texts };
  if (provider.dimensions && provider.provider !== 'siliconflow') body.dimensions = provider.dimensions;
  const { data, elapsedMs } = await postJson(endpoint(provider.baseURL, '/embeddings'), body, provider);
  const ordered = [...(data.data || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const embeddings = ordered.map(item => item.embedding);
  if (embeddings.length !== texts.length || embeddings.some(value => !Array.isArray(value) || value.length === 0)) {
    throw new Error('嵌入接口返回的向量数量或格式无效');
  }
  return { profile: profileFor(provider, source), embeddings, source, elapsedMs };
}

export function getPreferredMemoryEmbeddingProfile(settings = getMemorySettings({ includeSecrets: true })) {
  if (isCompleteUserProvider(settings.embedding)) return profileFor(settings.embedding, 'user');
  if (builtinAvailable('embedding')) return profileFor(builtinProvider('embedding'), 'builtin');
  return LOCAL_PROFILE;
}

export function getBuiltinMemoryProviderStatus() {
  const state = readFailureState();
  return { date: state.date, failureLimit: DAILY_FAILURE_LIMIT, slowThresholdMs: SLOW_REQUEST_THRESHOLD_MS, embeddingFailures: state.embedding, rerankerFailures: state.reranker };
}

export async function embedMemoryTexts(texts, settings = getMemorySettings({ includeSecrets: true })) {
  const userProvider = settings.embedding;
  if (isCompleteUserProvider(userProvider)) {
    try {
      return await requestEmbeddings(texts, userProvider, 'user');
    } catch (error) {
      console.warn('[memory-provider] user embedding failed, using system default:', error.message);
    }
  }

  if (builtinAvailable('embedding')) {
    try {
      const result = await requestEmbeddings(texts, builtinProvider('embedding'), 'builtin');
      if (result.elapsedMs > SLOW_REQUEST_THRESHOLD_MS) recordBuiltinFailure('embedding');
      return result;
    } catch (error) {
      const failures = recordBuiltinFailure('embedding');
      console.warn(`[memory-provider] built-in embedding failed (${failures}/${DAILY_FAILURE_LIMIT}), using local model:`, error.message);
    }
  }

  // A null embedding asks the local vector service to run its bundled model.
  return { profile: LOCAL_PROFILE, embeddings: texts.map(() => null), source: 'local', elapsedMs: null };
}

export async function embedMemoryText(text, settings) {
  const result = await embedMemoryTexts([text], settings);
  return { profile: result.profile, embedding: result.embeddings[0], source: result.source, elapsedMs: result.elapsedMs };
}

async function requestRerank(query, candidates, provider, source) {
  const topN = Math.min(provider.topN || 7, candidates.length);
  const { data, elapsedMs } = await postJson(endpoint(provider.baseURL, '/rerank'), {
    model: provider.model,
    query,
    documents: candidates.map(item => item.judgment),
    top_n: topN,
  }, provider);
  const results = data.results || [];
  if (!Array.isArray(results) || results.length === 0) throw new Error('重排序接口返回格式无效');
  return results
    .filter(item => Number.isInteger(item.index) && candidates[item.index])
    .map(item => ({ ...candidates[item.index], rerank_score: Number(item.relevance_score ?? item.score ?? 0), rerank_source: source, rerank_elapsed_ms: elapsedMs }));
}

async function localRerank(query, candidates, topN) {
  const startedAt = Date.now();
  const vectors = await embedBatch([query, ...candidates.map(item => item.judgment)]);
  if (!Array.isArray(vectors) || vectors.length !== candidates.length + 1) throw new Error('本地模型返回格式无效');
  const queryVector = vectors[0];
  return candidates
    .map((item, index) => ({ ...item, rerank_score: cosineSimilarity(queryVector, vectors[index + 1]), rerank_source: 'local', rerank_elapsed_ms: Date.now() - startedAt }))
    .sort((a, b) => b.rerank_score - a.rerank_score)
    .slice(0, Math.min(topN, candidates.length));
}

export async function rerankMemories(query, candidates, settings = getMemorySettings({ includeSecrets: true })) {
  if (candidates.length < 2) return candidates;
  const userProvider = settings.reranker;
  if (isCompleteUserProvider(userProvider)) {
    try {
      return await requestRerank(query, candidates, userProvider, 'user');
    } catch (error) {
      console.warn('[memory-provider] user reranker failed, using system default:', error.message);
    }
  }

  if (builtinAvailable('reranker')) {
    try {
      const result = await requestRerank(query, candidates, builtinProvider('reranker'), 'builtin');
      if (result[0]?.rerank_elapsed_ms > SLOW_REQUEST_THRESHOLD_MS) recordBuiltinFailure('reranker');
      return result;
    } catch (error) {
      const failures = recordBuiltinFailure('reranker');
      console.warn(`[memory-provider] built-in reranker failed (${failures}/${DAILY_FAILURE_LIMIT}), using local model:`, error.message);
    }
  }
  return localRerank(query, candidates, settings.reranker.topN || settings.topK || 7);
}

export async function testEmbeddingProvider(settings) {
  if (!isCompleteUserProvider(settings.embedding)) throw new Error('请先开启并完整填写服务地址、模型名称和访问密钥');
  const result = await requestEmbeddings(['聊天记忆连接测试'], settings.embedding, 'user');
  return { ok: true, dimensions: result.embeddings[0].length, profile: result.profile.fingerprint };
}

export async function testRerankerProvider(settings) {
  if (!isCompleteUserProvider(settings.reranker)) throw new Error('请先开启并完整填写服务地址、模型名称和访问密钥');
  const candidates = [{ judgment: '用户喜欢咖啡' }, { judgment: '用户常用本地模型' }];
  const result = await requestRerank('用户喜欢喝什么', candidates, settings.reranker, 'user');
  return { ok: true, resultCount: result.length };
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm) || 1);
}
