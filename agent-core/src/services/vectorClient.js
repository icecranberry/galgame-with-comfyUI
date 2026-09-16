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

/**
 * 失败响应的可读描述：FastAPI 的校验错误是 {detail:[{loc,msg,input,...}]}，
 * 直接拼进模板串会变成 "[object Object]"，把真正的失败原因（比如语料白名单不匹配）吃掉。
 */
async function describeFailure(res) {
  const body = await res.json().catch(() => null);
  const detail = body?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (detail) return JSON.stringify(detail);
  return `HTTP ${res.status}`;
}

export async function embedText(text) {
  const res = await fetchWithTimeout(`${BASE}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Embed error: ${await describeFailure(res)}`);
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
    throw new Error(`Embed error: ${await describeFailure(res)}`);
  }
  const data = await res.json();
  return data.embeddings;
}

export async function vectorSearch(text, { topK = 20, filterType = null, conversationId = null, corpus = 'memory_fragments', embedding = null, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  const res = await fetchWithTimeout(`${BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, embedding, top_k: topK, filter_type: filterType, conversation_id: conversationId, corpus }),
  }, timeoutMs);
  if (!res.ok) {
    throw new Error(`Search error: ${await describeFailure(res)}`);
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
    throw new Error(`Upsert error: ${await describeFailure(res)}`);
  }
  const data = await res.json();
  return data.chroma_id;
}

export async function upsertVectors(items, corpus = 'memory_fragments', timeoutMs = DEFAULT_TIMEOUT) {
  const res = await fetchWithTimeout(`${BASE}/upsert-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, corpus }),
  }, timeoutMs);
  if (!res.ok) {
    throw new Error(`Batch upsert error: ${await describeFailure(res)}`);
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
    throw new Error(`Delete error: ${await describeFailure(res)}`);
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
    throw new Error(`DeleteByConversation error: ${await describeFailure(res)}`);
  }
  const data = await res.json();
  return data.deleted;
}

export async function getImageKnowledgeCount() {
  try {
    const res = await fetchWithTimeout(`${BASE}/health`, {}, HEALTH_TIMEOUT);
    if (!res.ok) return null;
    const data = await res.json();
    return Number.isInteger(data.image_prompt_knowledge_count) ? data.image_prompt_knowledge_count : null;
  } catch {
    return null;
  }
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
