export function applyOptionalLlmParams(params, {
  streamUsage = false,
  promptCache = false,
  cacheKey = null,
} = {}) {
  if (streamUsage) {
    params.stream_options = { include_usage: true };
  }
  if (promptCache && cacheKey) {
    params.prompt_cache_key = cacheKey;
  }
  return params;
}
