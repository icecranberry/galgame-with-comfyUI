import OpenAI from 'openai';
import { config } from '../config.js';

const client = new OpenAI({
  baseURL: config.deepseek.baseURL,
  apiKey: config.deepseek.apiKey,
});

const DEFAULT_MODEL = 'deepseek-chat';

/**
 * 非流式聊天（用于摘要、实体抽取、情绪评估等任务）
 */
export async function chatSync(messages, { model = DEFAULT_MODEL, max_tokens = 2048, temperature = 0.7, response_format } = {}) {
  const params = {
    model,
    messages,
    max_tokens,
    temperature,
  };
  if (response_format) {
    params.response_format = response_format;
  }

  // 日志打印时压缩 ANIMA3 模板内容，避免刷屏
  const logMsgs = messages.map(m => {
    if (m.content && m.content.includes('ANIMA3 提示词生成模板')) {
      return { ...m, content: '# ANIMA3 提示词生成模板 v3.0（已省略，共 ' + m.content.length + ' 字符）' };
    }
    return m;
  });
  console.log('\n══════════ [DeepSeek → sync request] ══════════');
  console.log(JSON.stringify(logMsgs, null, 2));
  console.log('───────────────────────────────────────────────');

  const res = await client.chat.completions.create(params);
  const content = res.choices[0].message.content;

  console.log('[DeepSeek ← sync response]');
  console.log((content || '').slice(0, 2000));
  console.log('═══════════════════════════════════════════════\n');

  return content;
}

/**
 * 流式聊天（用于对话）
 * @returns {AsyncGenerator<string>}
 */
export async function* chatStream(messages, { model = DEFAULT_MODEL, max_tokens = 4096, temperature = 0.8 } = {}) {
  console.log('\n══════════ [DeepSeek → stream request] ══════════');
  console.log(JSON.stringify(messages, null, 2));
  console.log('────────────────────────────────────────────────');

  const stream = await client.chat.completions.create({
    model,
    messages,
    max_tokens,
    temperature,
    stream: true,
  });

  console.log('[DeepSeek ← stream response start]');
  let total = '';

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      total += delta;
      yield delta;
    }
  }

  console.log('[DeepSeek ← stream response end]');
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
