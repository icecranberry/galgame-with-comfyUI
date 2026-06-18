import { config } from '../config.js';

/**
 * 向量服务 HTTP 客户端
 */
const BASE = config.vectorService.url;
const FETCH_TIMEOUT = 5000; // 5 秒超时

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
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

export async function vectorSearch(text, { topK = 20, filterType = null, conversationId = null } = {}) {
  const res = await fetchWithTimeout(`${BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, top_k: topK, filter_type: filterType, conversation_id: conversationId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Search error: ${err.detail || res.status}`);
  }
  const data = await res.json();
  return data.results;
}

export async function upsertVector(chromaId, text, metadata = {}, fragmentType = null) {
  const res = await fetchWithTimeout(`${BASE}/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chroma_id: chromaId,
      text,
      metadata,
      fragment_type: fragmentType,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Upsert error: ${err.detail || res.status}`);
  }
  const data = await res.json();
  return data.chroma_id;
}

export async function deleteVector(chromaId) {
  const res = await fetchWithTimeout(`${BASE}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chroma_id: chromaId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Delete error: ${err.detail || res.status}`);
  }
  return true;
}

export async function deleteByConversation(conversationId) {
  const res = await fetchWithTimeout(`${BASE}/delete-by-conversation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: conversationId }),
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
    const res = await fetchWithTimeout(`${BASE}/health`);
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}
