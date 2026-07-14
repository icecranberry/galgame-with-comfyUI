import OpenAI from 'openai';
import { config } from '../config.js';

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
 * 非流式聊天（用于摘要、实体抽取、情绪评估等任务）
 * @param {number} opts.retries - 最大重试次数（默认 2，共 3 次尝试）
 * @param {number} opts.retryDelay - 初始重试延迟 ms（默认 1000，指数退避 ×2）
 */
export async function chatSync(messages, { model = config.llm.model || 'deepseek-v4-flash', max_tokens = 2048, temperature = 0.7, response_format, thinking = { type: "disabled" }, label = 'sync', retries = 2, retryDelay = 1000 } = {}) {
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
      throw err;
    }
  }
  throw lastError;
}

/**
 * 流式聊天（用于对话）
 * @returns {AsyncGenerator<string>}
 */
export async function* chatStream(messages, { model = config.llm.model || 'deepseek-v4-flash', max_tokens = 4096, temperature = 0.7, thinking = { type: "disabled" }, label = 'stream' } = {}) {
  console.log(`\n══════════ [${providerLabel()} → ${label}] ══════════`);
  console.log(JSON.stringify(messages, null, 2));
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
  // 合并自定义请求体参数（extraBody 可覆盖上述默认值以适配自定义 API）
  const extraBody = config.llm.extraBody;
  if (extraBody && Object.keys(extraBody).length > 0) {
    Object.assign(params, extraBody);
  }

  const stream = await getClient().chat.completions.create(params);

  console.log(`[${providerLabel()} ← ${label} start]`);
  let total = '';

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      total += delta;
      yield delta;
    }
  }

  console.log(`[${providerLabel()} ← ${label} end]`);
  console.log((total || '(empty)').slice(0, 2000));
  if (total.length > 2000) console.log(`... (${total.length} chars total, truncated)`);
  console.log('═══════════════════════════════════════════════\n');
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
