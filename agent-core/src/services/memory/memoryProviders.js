import { getMemorySettings, getEmbeddingProfile } from './memoryConfig.js';

function endpoint(baseURL, suffix) {
  if (baseURL.endsWith(suffix)) return baseURL;
  return `${baseURL}${suffix}`;
}

async function postJson(url, body, provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provider.timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json', ...provider.headers };
    if (provider.apiKey && !headers.Authorization && !headers.authorization) {
      headers.Authorization = `Bearer ${provider.apiKey}`;
    }
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || data.message || data.detail || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function embedMemoryTexts(texts, settings = getMemorySettings({ includeSecrets: true })) {
  const profile = getEmbeddingProfile(settings);
  if (!profile) return { profile: null, embeddings: null };
  const body = { model: settings.embedding.model, input: texts };
  // 硅基流动的 BGE 接口返回固定维度，发送 dimensions 会被判为非法参数。
  if (settings.embedding.dimensions && settings.embedding.provider !== 'siliconflow') {
    body.dimensions = settings.embedding.dimensions;
  }
  const data = await postJson(endpoint(settings.embedding.baseURL, '/embeddings'), body, settings.embedding);
  const ordered = [...(data.data || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const embeddings = ordered.map(item => item.embedding);
  if (embeddings.length !== texts.length || embeddings.some(v => !Array.isArray(v) || v.length === 0)) {
    throw new Error('嵌入接口返回的向量数量或格式无效');
  }
  return { profile, embeddings };
}

export async function embedMemoryText(text, settings) {
  const result = await embedMemoryTexts([text], settings);
  return { profile: result.profile, embedding: result.embeddings?.[0] || null };
}

export async function rerankMemories(query, candidates, settings = getMemorySettings({ includeSecrets: true })) {
  const provider = settings.reranker;
  if (!provider.enabled || !provider.baseURL || !provider.model || candidates.length < 2) return candidates;
  const topN = Math.min(provider.topN, candidates.length);
  const data = await postJson(endpoint(provider.baseURL, '/rerank'), {
    model: provider.model,
    query,
    documents: candidates.map(item => item.judgment),
    top_n: topN,
  }, provider);
  const results = data.results || [];
  if (!Array.isArray(results) || results.length === 0) throw new Error('重排序接口返回格式无效');
  return results
    .filter(item => Number.isInteger(item.index) && candidates[item.index])
    .map(item => ({ ...candidates[item.index], rerank_score: Number(item.relevance_score ?? item.score ?? 0) }));
}

export async function testEmbeddingProvider(settings) {
  const result = await embedMemoryText('聊天记忆连接测试', settings);
  return { ok: true, dimensions: result.embedding.length, profile: result.profile.fingerprint };
}

export async function testRerankerProvider(settings) {
  const candidates = [{ judgment: '用户喜欢咖啡' }, { judgment: '用户常用本地模型' }];
  const result = await rerankMemories('用户喜欢喝什么', candidates, settings);
  return { ok: true, resultCount: result.length };
}
