import OpenAI from 'openai';
import { config, updateFreeEggEnabled, FREE_EGG_MODELS } from '../config.js';
import { acquireSlot, releaseSlot } from '../services/llmConcurrency.js';
import { recordLlmCall } from '../services/llmTelemetry.js';

const _limitEnabled = () => config.features.serializeBackgroundLLM;

function isDeepseek() {
  return (config.llm.baseURL || '').includes('deepseek.com');
}

function providerLabel() {
  const url = config.llm.baseURL || '';
  try {
    return new URL(url).hostname;
  } catch {
    return url || 'LLM';
  }
}

function configuredThinking() {
  if (config.llm.thinkingMode === 'omit') return null;
  return { type: config.llm.thinkingMode === 'enabled' ? 'enabled' : 'disabled' };
}

// 复用单个 OpenAI 客户端实例，避免每次调用都创建新的 HTTP Agent
// 频繁创建 client 会实例化底层 undici 连接池，在高并发场景下浪费 FD 和内存
let _client = null;
function getClient() {
  if (!_client) {
    const opts = {
      baseURL: config.llm.baseURL,
      apiKey: config.llm.apiKey,
    };
    const headers = config.llm.headers;
    if (headers && Object.keys(headers).length > 0) {
      opts.defaultHeaders = headers;
    }
    // 每日免费鸡蛋：端点免 Key。SDK 构造时要求 apiKey 非 undefined（用占位符绕过），
    // 且值为 null 的请求头会被 SDK 从请求中删除 → 真正不发送 Authorization
    if (config.llm.freeEgg) {
      opts.apiKey = 'free-egg';
      opts.defaultHeaders = { Authorization: null, ...(opts.defaultHeaders || {}) };
    }
    _client = new OpenAI(opts);
  }
  return _client;
}

export function resetClient() {
  _client = null;
}

// ── 免费鸡蛋模型轮换：按 deepseek → MiMo → Hy3 依次请求，每个模型只请求一次；
//    本轮（本次开启期间）失败过的模型记在内存里，后续请求直接跳过。
//    全部模型都失败后关闭鸡蛋，并用恢复后的自有配置立即重发当前请求 ──
let _freeEggFailedModels = new Set();

/** 手动开关鸡蛋时清空本轮失败模型记录，下次开启重新从 deepseek 开始 */
export function resetFreeEggFailureCount() {
  _freeEggFailedModels.clear();
}

function freeEggCandidates() {
  return FREE_EGG_MODELS.filter(model => !_freeEggFailedModels.has(model));
}

/**
 * 记录本轮免费鸡蛋中失败的模型；全部模型都失败时关闭鸡蛋并重置客户端。
 * @returns {boolean} true 表示本轮可用模型已全部失败，调用方应改用自有配置重发
 */
function recordFreeEggFailure(model, err) {
  if (!config.llm.freeEgg) return false;
  _freeEggFailedModels.add(model);
  const msg = err?.message || String(err || '');
  console.warn(`[free-egg] 模型 ${model} 失败，本轮免费鸡蛋不再使用：${msg}`);
  if (_freeEggFailedModels.size >= FREE_EGG_MODELS.length) {
    updateFreeEggEnabled(false);
    resetClient();
    _freeEggFailedModels.clear();
    console.warn(`[free-egg] 本轮可用免费模型已全部失败，已自动关闭每日免费鸡蛋，改用自有 LLM 配置（最后错误：${msg}）`);
    return true;
  }
  return false;
}

/**
 * 判断是否可重试的错误
 * 中转站 API 偶尔出现 401/500 但仍有输出，以及网络瞬断都属于可恢复错误
 */
function isRetryableError(err) {
  const status = err?.status || err?.response?.status;
  const message = (err?.message || '') + (err?.error?.message || '');
  const code = err?.code || err?.error?.code || '';
  // 中转站：401 可能是认证中间件抖动，500/502/503 是后端瞬断
  if (status === 401 || status === 429 || (status >= 500 && status < 600)) return true;
  // 网络层错误
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') return true;
  if (message.includes('fetch failed') || message.includes('timeout') || message.includes('abort')) return true;
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 打印 token 用量与前缀缓存命中率。
 * DeepSeek 官方返回 prompt_cache_hit_tokens；OpenAI 风格渠道返回 prompt_tokens_details.cached_tokens。
 * 两者都没有时只打印用量，不打印命中率。
 */
function logUsage(label, usage) {
  if (!usage) return;
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  const hit = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens;
  if (hit != null && prompt > 0) {
    const pct = ((hit / prompt) * 100).toFixed(0);
    console.log(`[cache] ${label}: 命中 ${hit}/${prompt} prompt tokens (${pct}%) | 输出 ${completion}`);
  } else {
    console.log(`[usage] ${label}: prompt ${prompt} | 输出 ${completion}`);
  }
}

/**
 * 合并连续同角色（非 system）消息，适配 LM Studio 等严格 Jinja 模板
 * 仅处理 user/assistant 的连续同角色，不合并 system 消息（system 分层是有意设计）
 */
function mergeConsecutiveRoles(messages) {
  const merged = messages.map(message => ({ ...message }));
  for (let i = merged.length - 1; i > 0; i--) {
    if (merged[i].role !== 'system' && merged[i].role === merged[i - 1].role) {
      merged[i - 1].content += '\n\n' + merged[i].content;
      merged.splice(i, 1);
    }
  }
  return merged;
}

/** 免费鸡蛋同步请求：依次尝试本轮尚未失败过的免费模型，每个模型只请求一次 */
async function _chatSyncFreeEgg(messages, opts) {
  const candidates = freeEggCandidates();
  if (candidates.length === 0) {
    const err = new Error('free egg: all models already failed in this session');
    err.__freeEggFailover = true;
    throw err;
  }
  let lastError = null;
  for (const model of candidates) {
    if (!config.llm.freeEgg) {
      lastError = lastError || new Error('free egg disabled');
      lastError.__freeEggFailover = true;
      throw lastError;
    }
    try {
      return await _chatSyncInner(messages, { ...opts, model, retries: 0 });
    } catch (err) {
      lastError = err;
      if (recordFreeEggFailure(model, err)) {
        err.__freeEggFailover = true;
        throw err;
      }
    }
  }
  if (config.llm.freeEgg) {
    updateFreeEggEnabled(false);
    resetClient();
    _freeEggFailedModels.clear();
  }
  lastError.__freeEggFailover = true;
  throw lastError;
}

/**
 * 非流式聊天（用于摘要、实体抽取、情绪评估等任务）
 * 外层包装：免费鸡蛋全部模型失败触发时（错误带 __freeEggFailover 标记），
 * 立即用恢复后的自有配置把本次请求重发一遍（model/thinking 等默认值重新求值）
 * @param {number} opts.retries - 最大重试次数（默认 2，共 3 次尝试）
 * @param {number} opts.retryDelay - 初始重试延迟 ms（默认 1000，指数退避 ×2）
 */
export async function chatSync(messages, opts = {}) {
  try {
    if (config.llm.freeEgg) return await _chatSyncFreeEgg(messages, opts);
    return await _chatSyncInner(messages, opts);
  } catch (err) {
    if (err && err.__freeEggFailover) {
      console.warn(`[free-egg] ▸ 立即改用自有配置重发本次请求 (${opts.label || 'sync'})`);
      return await _chatSyncInner(messages, opts);
    }
    throw err;
  }
}

async function _chatSyncInner(messages, { model = config.llm.model || 'deepseek-v4-flash', max_tokens = 2048, temperature = 0.7, response_format, thinking, label = 'sync', retries = 2, retryDelay = 1000 } = {}) {
  if (config.features.mergeMessages) messages = mergeConsecutiveRoles(messages);
  if (_limitEnabled()) await acquireSlot();
  try {
  const params = {
    model,
    messages,
    max_tokens,
  };
  // temperature 为 null 时不发送（deepseek-reasoner 不支持此参数）
  if (temperature != null) {
    params.temperature = temperature;
  }
  if (response_format) {
    params.response_format = response_format;
  }
  // 全局三态配置默认注入 disabled；选择“不传”时完全省略。
  // 调用方显式传入 thinking/null 时仍可覆盖全局设置。
  const effectiveThinking = thinking === undefined ? configuredThinking() : thinking;
  if (effectiveThinking !== null) {
    params.thinking = effectiveThinking;
  }
  // 合并自定义请求体参数（extraBody 可覆盖上述默认值以适配自定义 API）
  const extraBody = config.llm.extraBody;
  if (extraBody && Object.keys(extraBody).length > 0) {
    Object.assign(params, extraBody);
  }

  // 日志打印时压缩 ANIMA3 模板内容，避免刷屏
  const logMsgs = messages.map(m => {
    if (m.content && m.content.includes('ANIMA3 提示词生成模板')) {
      return { ...m, content: '# ANIMA3 提示词生成模板 v3.0（已省略，共 ' + m.content.length + ' 字符）' };
    }
    return m;
  });
  // 先缓存请求日志，等响应返回后一起输出，避免并行调用时控制台输出串行
  const requestLog =
    `\n══════════ [${providerLabel()} → ${label}] ══════════\n` +
    JSON.stringify(logMsgs, null, 2) + '\n' +
    '───────────────────────────────────────────────';

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // 重试前等待（指数退避）
      if (attempt > 0) {
        const delay = retryDelay * Math.pow(2, attempt - 1);
        console.warn(`[${providerLabel()}] ▸ 第 ${attempt}/${retries} 次重试 (${delay}ms 后退避)...`);
        await sleep(delay);
      }

      const res = await getClient().chat.completions.create(params);
      const content = res.choices[0].message.content;

      // 请求+响应一起输出，保证每次调用的日志是完整的原子块
      console.log(requestLog);
      console.log(`[${providerLabel()} ← ${label}]`);
      const outputLimit = label.startsWith('schedule-gen:') ? 300 : 2000;
      console.log((content || '').slice(0, outputLimit));
      logUsage(label, res.usage);
      recordLlmCall(label, res.usage);
      console.log('═════════════════════════════════════════════\n');

      return content;
    } catch (err) {
      lastError = err;
      const status = err?.status || err?.response?.status;
      const code = err?.code || err?.error?.code || '';
      const msg = err?.message || '';


      if (attempt < retries && isRetryableError(err)) {
        console.warn(
          `[${providerLabel()} ← ${label}] 失败 (status=${status}, code=${code}, msg=${msg}), ` +
          `准备重试 (${attempt + 1}/${retries})`
        );
        continue;
      }
      // 不可重试或已耗尽重试次数 → 抛出
      console.log(requestLog);
      console.log(`[${providerLabel()} ← ${label}] ❌ 最终失败: status=${status}, code=${code}, msg=${msg}`);
      recordLlmCall(label, null, { failed: true });
      console.log('═════════════════════════════════════════════\n');
      throw err;
    }
  }
  throw lastError;
  } finally {
    if (_limitEnabled()) releaseSlot();
  }
}

/** 免费鸡蛋流式请求：依次尝试本轮尚未失败过的免费模型，每个模型只请求一次 */
async function* _chatStreamFreeEgg(messages, opts) {
  const candidates = freeEggCandidates();
  if (candidates.length === 0) {
    const err = new Error('free egg: all models already failed in this session');
    err.__freeEggFailover = true;
    throw err;
  }
  let lastError = null;
  for (const model of candidates) {
    if (!config.llm.freeEgg) {
      lastError = lastError || new Error('free egg disabled');
      lastError.__freeEggFailover = true;
      throw lastError;
    }
    try {
      let attemptYielded = false;
      for await (const delta of _chatStreamInner(messages, { ...opts, model })) {
        attemptYielded = true;
        yield delta;
      }
      return;
    } catch (err) {
      lastError = err;
      if (recordFreeEggFailure(model, err)) {
        err.__freeEggFailover = true;
        throw err;
      }
      // 已输出过内容时不再换模型，避免同一回复拼接两段不同模型的输出
      if (attemptYielded) throw err;
    }
  }
  if (config.llm.freeEgg) {
    updateFreeEggEnabled(false);
    resetClient();
    _freeEggFailedModels.clear();
  }
  lastError.__freeEggFailover = true;
  throw lastError;
}

/**
 * 流式聊天（用于对话）
 * 外层包装：免费鸡蛋全部模型失败且尚未输出任何内容时，立即用恢复后的自有配置重发一遍；
 * 已输出过内容则不重发（避免重复输出），直接抛错
 * @returns {AsyncGenerator<string>}
 */
export async function* chatStream(messages, opts = {}) {
  let anyYielded = false;
  try {
    if (config.llm.freeEgg) {
      for await (const delta of _chatStreamFreeEgg(messages, opts)) {
        anyYielded = true;
        yield delta;
      }
    } else {
      for await (const delta of _chatStreamInner(messages, opts)) {
        anyYielded = true;
        yield delta;
      }
    }
  } catch (err) {
    if (!(err && err.__freeEggFailover && !anyYielded)) throw err;
    console.warn(`[free-egg] ▸ 立即改用自有配置重发本次请求 (${opts.label || 'stream'})`);
    for await (const delta of _chatStreamInner(messages, opts)) {
      yield delta;
    }
  }
}

async function* _chatStreamInner(messages, {
  model = config.llm.model || 'deepseek-v4-flash',
  max_tokens = 4096,
  temperature = 0.7,
  thinking,
  label = 'stream',
} = {}) {
  if (config.features.mergeMessages) messages = mergeConsecutiveRoles(messages);
  if (_limitEnabled()) await acquireSlot();
  let total = '';

  try {
    console.log(`\n══════════ [${providerLabel()} → ${label}] ══════════`);
    // 压缩 ANIMA3 等超长模板的日志输出
    const logMsgs = messages.map(m => {
      if (m.content && m.content.includes('ANIMA3 提示词生成模板')) {
        return { ...m, content: '# ANIMA3 提示词生成模板 v3.0（已省略，共 ' + m.content.length + ' 字符）' };
      }
      return m;
    });
    console.log(JSON.stringify(logMsgs, null, 2));
    console.log('────────────────────────────────────────────────');

    const params = {
      model,
      messages,
      max_tokens,
      temperature,
      stream: true,
    };

    const effectiveThinking = thinking === undefined ? configuredThinking() : thinking;
    if (effectiveThinking !== null) {
      params.thinking = effectiveThinking;
    }

    // 流式 usage（缓存命中率）：末尾 chunk 携带。仅对官方 API 发送，
    // 第三方渠道可能不认识 stream_options 直接报错。
    if (isDeepseek()) {
      params.stream_options = { include_usage: true };
    }

    // 合并自定义请求体参数（extraBody 可覆盖上述默认值以适配自定义 API）
    const extraBody = config.llm.extraBody;
    if (extraBody && Object.keys(extraBody).length > 0) {
      Object.assign(params, extraBody);
    }

    const stream = await getClient().chat.completions.create(params);

    console.log(`[${providerLabel()} ← ${label} start]`);

    let usage = null;
    for await (const chunk of stream) {
      if (chunk.usage) usage = chunk.usage;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        total += delta;
        yield delta;
      }
    }

    console.log(`[${providerLabel()} ← ${label} end]`);
    console.log((total || '(empty)').slice(0, 2000));
    if (total.length > 2000) console.log(`... (${total.length} chars total, truncated)`);
    logUsage(label, usage);
    recordLlmCall(label, usage);
    console.log('═══════════════════════════════════════════════\n');
  } catch (err) {
    console.error(`[${providerLabel()} ← ${label}] stream error:`, err.message);
    recordLlmCall(label, null, { failed: true });
    throw err;
  } finally {
    if (_limitEnabled()) releaseSlot();
  }
}

/**
 * 生成文本嵌入（通过本地向量服务，不调 DeepSeek）
 * @deprecated 嵌入用本地向量服务，此函数仅作 fallback 标注
 */
export async function embedText(text) {
  const res = await fetch(`${config.vectorService.url}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Vector service error: ${res.status}`);
  const data = await res.json();
  return data.embedding;
}
