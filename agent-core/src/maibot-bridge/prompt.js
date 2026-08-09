/**
 * maibot-bridge/prompt.js
 * 从上下文与 MaiBot 回复中提取生图 prompt（复用主聊天流 needImage 二次请求的思路）。
 */
import { chatSync } from '../llm/llm-client.js';
import { IMAGE_PROMPT_RULE } from '../builtinRules.js';
import { cleanChatText } from './textCleaner.js';

function buildContextText({ user_message, reply_text, context }) {
  const lines = [];
  for (const item of context || []) {
    if (item == null) continue;
    if (typeof item === 'string') {
      const text = cleanChatText(item).slice(0, 400);
      if (text) lines.push(`用户: ${text}`);
    } else if (typeof item === 'object') {
      const role = item.role === 'assistant' ? 'Agent' : '用户';
      const content = cleanChatText(item.content ?? item.text ?? '').slice(0, 400);
      if (content) lines.push(`${role}: ${content}`);
    }
  }
  const userText = cleanChatText(user_message).slice(0, 400);
  if (userText) lines.push(`用户: ${userText}`);
  const replyText = cleanChatText(reply_text).slice(0, 600);
  if (replyText) lines.push(`Agent: ${replyText}`);
  return lines.join('\n');
}

function extractImagePromptJson(text) {
  // 兼容 {"prompt":"..."} / {“prompt”:"..."} 等变体
  const normalized = String(text || '').replace(/[“”]/g, '"');
  const re = /\{"?prompt"?\s*:\s*"((?:[^"\\]|\\.)*)"/i;
  const m = normalized.match(re);
  if (m) return m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
  return null;
}

export async function extractImagePrompt({ character, user_message, reply_text, context }) {
  const personality = character?.base_prompt || '';
  const systemParts = [];
  systemParts.push(`你是角色「${character?.display_name || '默认角色'}」的生图描述器。请结合对话内容，为最近这轮回复设计一张配图的画面描述。`);
  systemParts.push(`角色设定：\n${personality.slice(0, 2000)}`);
  systemParts.push(`画面描述规则：\n${IMAGE_PROMPT_RULE.rule_content}`);
  systemParts.push('只输出 JSON：{"prompt": "英文画面描述"}，不要输出其他内容。');

  const ctxText = buildContextText({ user_message, reply_text, context });
  const result = await chatSync(
    [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user', content: ctxText },
    ],
    { temperature: 0.7, max_tokens: 1024, label: 'maibot-image-prompt' }
  );
  const prompt = extractImagePromptJson(result);
  if (!prompt) {
    console.warn('[maibot-bridge] extractImagePrompt: 未能从模型输出解析 prompt, raw:', String(result).slice(0, 120));
  }
  return prompt;
}
