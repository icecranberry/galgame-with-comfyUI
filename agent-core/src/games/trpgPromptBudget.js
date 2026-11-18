import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { isValidMaxTokens, normalizeModelCapabilities } from '../llm/modelCapabilities.js';
import { listVertexModels } from '../llm/vertex-client.js';
import { estimateTokens } from '../services/lorebook/engine.js';
import { bad } from './gamePaths.js';

const MAX_INPUT_TOKENS = 500_000;
const FALLBACK_WINDOW = 32_768;
let metadata;

function connectionKey(llm) {
  return createHash('sha256').update(JSON.stringify([llm.connectionType, llm.baseURL, llm.apiKey, llm.headers,
    llm.vertexRegion, llm.vertexServiceAccount])).digest('hex');
}

async function listCapabilities(llm) {
  if (llm.connectionType === 'vertexai') return (await listVertexModels(llm)).capabilities;
  const response = await fetch(`${llm.baseURL.replace(/\/+$/, '')}/models`, {
    headers: { Accept: 'application/json', ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}), ...llm.headers },
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return normalizeModelCapabilities([payload.data, payload.models, payload].find(Array.isArray) || []);
}

function configuredWindow(model) {
  try {
    const windows = JSON.parse(process.env.TRPG_MODEL_CONTEXT_WINDOWS || '{}');
    const value = Object.hasOwn(windows, model) ? windows[model] : null;
    return isValidMaxTokens(value) ? value : undefined;
  } catch { return undefined; }
}

export function textTokens(text) {
  // A margin for routing aliases, where one exact tokenizer cannot describe every route.
  return Math.ceil(estimateTokens(text) * 1.15);
}

export function promptTokens(messages, tools = []) {
  return 8 + (tools.length ? textTokens(JSON.stringify(tools)) + 16 : 0) +
    messages.reduce((total, { role, content, ...other }) => total + 6 +
      (content ? textTokens(typeof content === 'string' ? content : JSON.stringify(content)) : 0) +
      (Object.keys(other).length ? textTokens(JSON.stringify(other)) : 0), 0);
}

export async function trpgPromptBudget() {
  const llm = { ...config.llm };
  const key = connectionKey(llm);
  const model = llm.extraBody?.model || llm.model;
  if (metadata?.key !== key || metadata.until <= Date.now()) {
    const entry = { key, until: Date.now() + 30 * 60_000 };
    entry.result = listCapabilities(llm).catch(() => {
      entry.until = Date.now() + 30_000;
      return {};
    });
    metadata = entry;
  }
  const capabilities = (await metadata.result)[String(model).replace(/^models\//, '')] || {};
  const override = configuredWindow(model);
  const reported = capabilities.contextWindow || capabilities.inputLimit;
  const contextWindow = reported || override || FALLBACK_WINDOW;
  const source = reported ? 'models' : override ? 'config' : 'fallback';
  const maxOutputTokens = Math.min(llm.maxTokens, capabilities.maxTokens || Infinity, source === 'fallback' ? 8192 : Infinity);
  const inputLimit = Math.min(MAX_INPUT_TOKENS, contextWindow - maxOutputTokens, capabilities.inputLimit || Infinity);
  if (inputLimit <= 0) throw bad('跑团模型窗口没有剩余输入空间，请调低 MAX_tokens', 409);
  const validate = (params, messages) => {
    if (connectionKey(config.llm) !== key || params.model !== model || config.llm.maxTokens !== llm.maxTokens) {
      throw bad('模型配置已切换，请重试本轮', 409);
    }
    if (params.messages !== messages) throw bad('跑团模型的自定义请求体不能覆盖 messages', 409);
    assertPromptFits(messages, params.tools, inputLimit);
  };
  return { model, source, contextWindow, inputLimit, maxOutputTokens, validate };
}

export function assertPromptFits(messages, tools, inputLimit) {
  if (promptTokens(messages, tools) > inputLimit) {
    throw bad(`跑团上下文整理后仍超过 ${inputLimit} tokens 输入预算，请调低 MAX_tokens 或切换更大窗口的模型`, 409);
  }
}
