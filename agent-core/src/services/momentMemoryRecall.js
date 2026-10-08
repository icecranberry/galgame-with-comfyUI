import { config } from '../config.js';
import { rrfFusion } from './memorySearch.js';
import { activeMemorySearch } from './memory/activeSearch.js';
import { rerankMemories } from './memory/memoryProviders.js';

// 朋友圈回评的 RAG 检索限时：超时即放弃注入，不阻塞回评主流程。
export const MOMENT_RAG_TIMEOUT_MS = 1200;
// 每路先找候选，统一融合、重排后最多注入三条。
export const MOMENT_RAG_TOPK = 5;
export const MOMENT_RAG_LIMIT = 3;

// 事件 / 奇遇 / 未互动事件类记忆由主聊天流、群聊的 <rag_memories> 注入，朋友圈回评不重复注入。
function isInjectableMemory(memory) {
  const judgment = String(memory?.judgment ?? '');
  return !(
    judgment.includes('【事件】')
    && judgment.includes('【奇遇】')
    && judgment.includes('未互动事件')
  );
}

function normalizeQuery(text) {
  return String(text ?? '').trim();
}

// 给单路检索加超时兜底：超时按“无结果”处理，绝不把异常抛给回评主流程。
function withTimeout(promise, timeoutMs) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** 正文、当前回复、楼层上下文与配图分别召回；范围始终为说话者的记忆。 */
export async function recallMomentMemories(conversationIds, { postText, commentText, threadText, imageText } = {}, deps = {}) {
  if (!config.features.memory) return [];
  const scope = [...new Set((Array.isArray(conversationIds) ? conversationIds : [conversationIds]).filter(Boolean))];
  if (!scope.length) return [];
  const normalize = value => normalizeQuery(Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
  // 当前回复在重排查询中优先；检索词只含原文，不混入生成指令。
  const queries = [...new Set([commentText, threadText, postText, imageText].map(normalize).filter(Boolean))];
  if (!queries.length) return [];
  const timeoutMs = Number.isFinite(deps.timeoutMs) ? deps.timeoutMs : MOMENT_RAG_TIMEOUT_MS;
  const search = deps.activeMemorySearch || (deps.hybridSearch
    ? async (query, options) => ({ results: await deps.hybridSearch(query, options) })
    : activeMemorySearch);
  const batches = await Promise.all(queries.map(async query => {
    try {
      const found = await withTimeout(Promise.resolve().then(() => search(query, {
        conversationIds: scope, topK: MOMENT_RAG_TOPK, timeoutMs,
      })), timeoutMs);
      const hits = found?.results;
      return Array.isArray(hits) ? hits.filter(memory => memory?.memory_id != null && isInjectableMemory(memory)) : [];
    } catch (error) {
      console.error('[momentComment] 记忆检索失败：', error?.message || error);
      return [];
    }
  }));
  // 不直接比较不同查询的相似度分数，先用排名融合，再对同一上下文统一重排。
  const candidates = rrfFusion(batches, MOMENT_RAG_TOPK * queries.length);
  if (!candidates.length) return [];
  let ranked = candidates;
  try {
    const result = await withTimeout(Promise.resolve().then(() =>
      (deps.rerankMemories || rerankMemories)(queries.join('\n'), candidates)), timeoutMs);
    if (Array.isArray(result) && result.length) ranked = result;
  } catch (error) {
    console.error('[momentComment] 记忆重排失败，使用融合排名：', error?.message || error);
  }
  return ranked.slice(0, MOMENT_RAG_LIMIT);
}

/**
 * 把检索到的记忆渲染成注入块：标明这些是说话者记得的相关信息，历史条目保留过时标记。
 * @param {Array<object>} memories 说话者的记忆条目
 * @param {string} authorName 说话者名字
 * @returns {string} <rag_memories> 文本块
 */
export function formatMomentMemories(memories, authorName) {
  const who = String(authorName ?? '').trim() || 'TA';
  const lines = (memories || [])
    .map((memory, index) => `${index + 1}. [${memory.memory_type}] ${memory.isHistorical ? '[历史·过时] ' : ''}${memory.injectionText || memory.semantic_note || memory.judgment}`)
    .join('\n');
  return `<rag_memories>\n${who}记得的相关信息（只在相关时自然提及，不要把他人的经历说成自己的）：\n${lines}\n</rag_memories>`;
}
