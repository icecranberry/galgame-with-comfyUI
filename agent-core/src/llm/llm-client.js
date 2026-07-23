import OpenAI from 'openai';
import { config } from '../config.js';
import { acquireSlot, releaseSlot } from '../services/llmConcurrency.js';
import { recordLlmCall } from '../services/llmTelemetry.js';
import { applyOptionalLlmParams } from './llmRequestOptions.js';

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
    _client = new OpenAI(opts);
  }
  return _client;
}

export function resetClient() {
  _client = null;
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

/**
 * 非流式聊天（用于摘要、实体抽取、情绪评估等任务）
 * @param {number} opts.retries - 最大重试次数（默认 2，共 3 次尝试）
 * @param {number} opts.retryDelay - 初始重试延迟 ms（默认 1000，指数退避 ×2）
 */
export async function chatSync(messages, { model = config.llm.model || 'deepseek-v4-flash', max_tokens = 2048, temperature = 0.7, response_format, thinking = { type: "disabled" }, label = 'sync', requestKind = 'sync', conversationId = null, characterId = null, promptRevision = null, requestHash = null, retries = 2, retryDelay = 1000 } = {}) {
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
  // thinking 仅 DeepSeek 官方 API 支持，第三方渠道发送此参数可能被拒绝
  if (thinking !== null && isDeepseek()) {
    params.thinking = thinking;
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
  const startedAt = Date.now();
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
      console.log((content || '').slice(0, 2000));
      console.log('═══════════════════════════════════════════════\n');

      recordLlmCall({
        requestKind, label, provider: providerLabel(), model, conversationId, characterId,
        promptRevision, requestHash, usage: res.usage, durationMs: Date.now() - startedAt,
      });
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
      console.log('═══════════════════════════════════════════════\n');
      recordLlmCall({
        requestKind, label, provider: providerLabel(), model, conversationId, characterId,
        promptRevision, requestHash, durationMs: Date.now() - startedAt,
        success: false, errorMessage: msg,
      });
      throw err;
    }
  }
  throw lastError;
  } finally {
    if (_limitEnabled()) releaseSlot();
  }
}

/**
 * 流式聊天（用于对话）
 * 不改变 yield 协议（始终 yield 字符串），telemetry 在流结束后内部记录。
 *
 * @param {object}  opts.requestKind     telemetry 分类（如 'chat', 'summary'）
 * @param {string}  opts.conversationId
 * @param {number}  opts.characterId
 * @param {string}  opts.promptRevision
 * @param {string}  opts.requestHash
 * @param {string}  [opts.cacheKey]      仅当配置启用时才发送；默认不发送
 * @returns {AsyncGenerator<string>}
 */
export async function* chatStream(messages, {
  model = config.llm.model || 'deepseek-v4-flash',
  max_tokens = 4096,
  temperature = 0.7,
  thinking = { type: 'disabled' },
  label = 'stream',
  requestKind = 'chat',
  conversationId = null,
  characterId = null,
  promptRevision = null,
  requestHash = null,
  cacheKey = null,
} = {}) {
  if (config.features.mergeMessages) messages = mergeConsecutiveRoles(messages);
  if (_limitEnabled()) await acquireSlot();
  const startedAt = Date.now();
  let total = '';
  let finalUsage = null;
  let errorMessage = null;

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

    // thinking 仅 DeepSeek 官方 API 支持，第三方渠道发送此参数可能被拒绝
    if (thinking !== null && isDeepseek()) {
      params.thinking = thinking;
    }

    applyOptionalLlmParams(params, {
      streamUsage: config.features.streamUsage,
      promptCache: config.features.promptCache,
      cacheKey,
    });
    if (cacheKey && !config.features.promptCache) {
      console.log(`[llm-client] cacheKey candidate (not sent): ${cacheKey}`);
    }

    // 合并自定义请求体参数（extraBody 可覆盖上述默认值以适配自定义 API）
    const extraBody = config.llm.extraBody;
    if (extraBody && Object.keys(extraBody).length > 0) {
      Object.assign(params, extraBody);
    }

    const stream = await getClient().chat.completions.create(params);

    console.log(`[${providerLabel()} ← ${label} start]`);

    for await (const chunk of stream) {
      // 部分供应商在末尾 chunk（usage-only，无 choices）中返回 usage
      if (chunk.usage) {
        finalUsage = chunk.usage;
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        total += delta;
        yield delta;
      }
    }

    console.log(`[${providerLabel()} ← ${label} end]`);
    console.log((total || '(empty)').slice(0, 2000));
    if (total.length > 2000) console.log(`... (${total.length} chars total, truncated)`);
    if (finalUsage) {
      console.log(`[${providerLabel()} usage] input=${finalUsage.prompt_tokens ?? finalUsage.input_tokens ?? '?'} output=${finalUsage.completion_tokens ?? finalUsage.output_tokens ?? '?'} cached=${finalUsage.cached_tokens ?? finalUsage.cache_read_input_tokens ?? '?'}`);
    }
    console.log('═══════════════════════════════════════════════\n');
  } catch (err) {
    errorMessage = err.message;
    console.error(`[${providerLabel()} ← ${label}] stream error:`, err.message);
    throw err;
  } finally {
    // 无论成功或异常都记录 telemetry
    try {
      recordLlmCall({
        requestKind, label, provider: providerLabel(), model, conversationId, characterId,
        promptRevision, requestHash, usage: finalUsage,
        durationMs: Date.now() - startedAt,
        success: !errorMessage,
        errorMessage,
      });
    } catch (telemetryErr) {
      console.error('[llm-client] telemetry record failed:', telemetryErr.message);
    }
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
