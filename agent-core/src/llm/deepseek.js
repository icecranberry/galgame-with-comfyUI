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

  const res = await client.chat.completions.create(params);
  return res.choices[0].message.content;
}

/**
 * 流式聊天（用于对话）
 * @returns {AsyncGenerator<string>}
 */
export async function* chatStream(messages, { model = DEFAULT_MODEL, max_tokens = 4096, temperature = 0.8 } = {}) {
  const stream = await client.chat.completions.create({
    model,
    messages,
    max_tokens,
    temperature,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
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
