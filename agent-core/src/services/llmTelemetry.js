import { getDb } from '../db/index.js';

function usageValue(usage, ...keys) {
  for (const key of keys) {
    const value = usage?.[key];
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function normalizeUsage(usage) {
  const details = usage?.prompt_tokens_details || usage?.input_tokens_details || {};
  return {
    inputTokens: usageValue(usage, 'input_tokens', 'prompt_tokens'),
    outputTokens: usageValue(usage, 'output_tokens', 'completion_tokens'),
    cachedInputTokens: usageValue(usage, 'cached_tokens', 'prompt_cache_hit_tokens', 'cache_read_input_tokens', 'cache_read_tokens')
      ?? usageValue(details, 'cached_tokens', 'prompt_cache_hit_tokens', 'cache_read_input_tokens', 'cache_read_tokens'),
    cacheCreationTokens: usageValue(usage, 'cache_creation_input_tokens', 'cache_creation_tokens', 'prompt_cache_miss_tokens')
      ?? usageValue(details, 'cache_creation_input_tokens', 'cache_creation_tokens', 'prompt_cache_miss_tokens'),
  };
}

export function cacheHitRate(usage) {
  const normalized = normalizeUsage(usage);
  if (!normalized.inputTokens || normalized.cachedInputTokens == null) return null;
  return normalized.cachedInputTokens / normalized.inputTokens;
}

export function classifyRequestKind(requestKind, label = '') {
  if (requestKind && !['sync', 'unknown'].includes(requestKind)) return requestKind;
  if (/摘要/.test(label)) return 'summary';
  if (/记忆|RAG/.test(label)) return 'memory_extract';
  if (/情绪/.test(label)) return 'emotion_evaluate';
  if (/画像/.test(label)) return 'portrait_extract';
  if (/生图|图片|画面|prompt/i.test(label)) return 'image';
  if (/预测|猜想/.test(label)) return 'reply_guesses';
  return requestKind || 'unknown';
}

export function recordLlmCall({
  requestKind = 'unknown', label = 'unknown', provider = null, model = null,
  conversationId = null, characterId = null, promptRevision = null, requestHash = null,
  usage = null, durationMs = null, success = true, errorMessage = null,
} = {}) {
  const normalized = normalizeUsage(usage);
  const classifiedKind = classifyRequestKind(requestKind, label);
  try {
    getDb().prepare(`
      INSERT INTO llm_call_logs (
        request_kind, label, provider, model, conversation_id, character_id,
        prompt_revision, request_hash, input_tokens, output_tokens,
        cached_input_tokens, cache_creation_tokens, duration_ms, success, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      classifiedKind, label, provider, model, conversationId, characterId,
      promptRevision, requestHash, normalized.inputTokens, normalized.outputTokens,
      normalized.cachedInputTokens, normalized.cacheCreationTokens, durationMs,
      success ? 1 : 0, errorMessage,
    );
  } catch (err) {
    console.error('[llm-telemetry] persist failed:', err.message);
  }
  return { ...normalized, hitRate: cacheHitRate(usage) };
}
