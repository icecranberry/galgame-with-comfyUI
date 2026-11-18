// Pure helpers shared by settings UI and server. No credentials, I/O or runtime config.
export const DEEPSEEK_MAX_TOKENS = 393216;
export const FALLBACK_MAX_TOKENS = 8192;

export function isValidMaxTokens(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function defaultMaxTokens(baseURL = '', model = '') {
  try {
    if (new URL(baseURL).hostname === 'api.deepseek.com') return DEEPSEEK_MAX_TOKENS;
  } catch { /* incomplete custom URL */ }
  const name = String(model).toLowerCase();
  // Known text families; image/audio variants and unknown models use the conservative fallback.
  if (/gemini-(?:2\.5|3(?:\.\d+)?)-/.test(name) && !/image|audio|tts|live/.test(name)) return 65536;
  if (/deepseek-(?:flash|v4)/.test(name)) return 32768;
  return FALLBACK_MAX_TOKENS;
}

export function normalizeModelCapabilities(rows) {
  const result = Object.create(null);
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || row.name || '').replace(/^models\//, '');
    if (!id) continue;
    // DeepSeek, Gemini native, OpenRouter and commonly used compatible endpoints.
    const maxTokens = [row.max_output_tokens, row.outputTokenLimit, row.max_completion_tokens,
      row.top_provider?.max_completion_tokens].find(isValidMaxTokens);
    const windows = [row.context_window, row.context_length, row.contextWindow, row.top_provider?.context_length].filter(isValidMaxTokens);
    const inputs = [row.max_input_tokens, row.inputTokenLimit].filter(isValidMaxTokens);
    if (maxTokens || windows.length || inputs.length) result[id] = {
      ...(maxTokens ? { maxTokens } : {}),
      ...(windows.length ? { contextWindow: Math.min(...windows) } : {}),
      ...(inputs.length ? { inputLimit: Math.min(...inputs) } : {}),
    };
  }
  return result;
}
