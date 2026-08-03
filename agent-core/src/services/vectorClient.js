import { config } from '../config.js';

/**
 * 向量服务 HTTP 客户端
 */
const BASE = config.vectorService.url;
// 主聊天流的 RAG 已由 chatMemoryRecall 用 2.5s race 限时；
// 这里统一使用宽松默认超时，避免后台记忆索引（upsert/delete）等被误杀。
const DEFAULT_TIMEOUT = config.vectorService.defaultTimeoutMs;
const HEALTH_TIMEOUT = 2500;
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function embedText(text) {
  const res = await fetchWithTimeout(`${BASE}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Embed error: ${err.detail || res.status}`);
  }
  const data = await res.json();
  // 单文本返回第一个向量
  return data.embeddings?.[0] ?? data.embedding;
}

export async function embedBatch(texts) {
  const res = await fetchWithTimeout(`${BASE}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Embed error: ${err.detail || res.status}`);
  }
  const data = await res.json();
  return data.embeddings;
}

export async function vectorSearch(text, { topK = 20, filterType = null, conversationId = null, corpus = 'memory_fragments', embedding = null } = {}) {
  const res = await fetchWithTimeout(`${BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, embedding, top_k: topK, filter_type: filterType, conversation_id: conversationId, corpus }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Search error: ${err.detail || res.status}`);
  }
  const data = await res.json();
  return data.results;
}

export async function upsertVector(chromaId, text, metadata = {}, fragmentType = null, corpus = 'memory_fragments', embedding = null) {
  const res = await fetchWithTimeout(`${BASE}/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chroma_id: chromaId,
      text,
      embedding,
      metadata,
      fragment_type: fragmentType,
      corpus,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Upsert error: ${err.detail || res.status}`);
  }
  const data = await res.json();
  return data.chroma_id;
}

export async function upsertVectors(items, corpus = 'memory_fragments') {
  const res = await fetchWithTimeout(`${BASE}/upsert-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, corpus }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Batch upsert error: ${err.detail || res.status}`);
  }
  const data = await res.json();
  return data.count;
}

export async function deleteVector(chromaId, corpus = 'memory_fragments') {
  const res = await fetchWithTimeout(`${BASE}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chroma_id: chromaId, corpus }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Delete error: ${err.detail || res.status}`);
  }
  return true;
}

export async function deleteByConversation(conversationId, corpus = 'memory_fragments') {
  const res = await fetchWithTimeout(`${BASE}/delete-by-conversation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: conversationId, corpus }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`DeleteByConversation error: ${err.detail || res.status}`);
  }
  const data = await res.json();
  return data.deleted;
}

export async function healthCheck() {
  try {
    const res = await fetchWithTimeout(`${BASE}/health`, {}, HEALTH_TIMEOUT);
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}
