import OpenAI from 'openai';
import { config } from '../config.js';

const DEFAULT_MODEL = config.llm.model || 'deepseek-v4-flash';

// 复用单个 OpenAI 客户端实例，避免每次调用都创建新的 HTTP Agent
// 频繁创建 client 会实例化底层 undici 连接池，在高并发场景下浪费 FD 和内存
let _client = null;
function getClient() {
  if (!_client) {
    _client = new OpenAI({
      baseURL: config.llm.baseURL,
      apiKey: config.llm.apiKey,
    });
  }
  return _client;
}

/**
 * 非流式聊天（用于摘要、实体抽取、情绪评估等任务）
 */
export async function chatSync(messages, { model = DEFAULT_MODEL, max_tokens = 2048, temperature = 0.7, response_format, thinking = { type: "disabled" }, label = 'sync' } = {}) {
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
  // thinking 默认禁用（deepseek-v4-flash 非思考模式）；传 null 则不发送此参数
  if (thinking !== null) {
    params.thinking = thinking;
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
    `\n══════════ [DeepSeek → ${label}] ══════════\n` +
    JSON.stringify(logMsgs, null, 2) + '\n' +
    '───────────────────────────────────────────────';

  const res = await getClient().chat.completions.create(params);
  const content = res.choices[0].message.content;

  // 请求+响应一起输出，保证每次调用的日志是完整的原子块
  console.log(requestLog);
  console.log(`[DeepSeek ← ${label}]`);
  console.log((content || '').slice(0, 2000));
  console.log('═══════════════════════════════════════════════\n');

  return content;
}

/**
 * 流式聊天（用于对话）
 * @returns {AsyncGenerator<string>}
 */
export async function* chatStream(messages, { model = DEFAULT_MODEL, max_tokens = 4096, temperature = 0.7, thinking = { type: "disabled" }, label = 'stream' } = {}) {
  console.log(`\n══════════ [DeepSeek → ${label}] ══════════`);
  console.log(JSON.stringify(messages, null, 2));
  console.log('────────────────────────────────────────────────');

  const params = {
    model,
    messages,
    max_tokens,
    temperature,
    stream: true,
  };
  // thinking 默认禁用（deepseek-v4-flash 非思考模式）；传 null 则不发送此参数
  if (thinking !== null) {
    params.thinking = thinking;
  }

  const stream = await getClient().chat.completions.create(params);

  console.log(`[DeepSeek ← ${label} start]`);
  let total = '';

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      total += delta;
      yield delta;
    }
  }

  console.log(`[DeepSeek ← ${label} end]`);
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
