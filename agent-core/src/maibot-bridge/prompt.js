/**
 * maibot-bridge/prompt.js
 * 从上下文与 MaiBot 回复中提取生图 prompt（复用主聊天流 needImage 二次请求的思路）。
 */
import { chatSync } from '../llm/llm-client.js';
import { IMAGE_PROMPT_RULE } from '../builtinRules.js';
import { getTimeLightInline } from '../services/timeLight.js';
import { buildChatLines } from './textCleaner.js';

function buildCharacterAppearance(character) {
  const shortPrompt = String(character?.short_prompt || '').trim();
  const basePrompt = String(character?.base_prompt || '');
  const appMatch = basePrompt.match(/##\s*你的外观/);
  const appSection = appMatch ? basePrompt.slice(appMatch.index).trim() : '';
  return [shortPrompt, appSection].filter(Boolean).join('\n');
}

function cleanDirectPrompt(raw) {
  // 只做最外层清洗，不再解析 JSON
  return String(raw || '')
    .trim()
    .replace(/^```(?:json|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * 当前时间/季节/天气/光线参考，与主聊天流的生图助手一致。
 * 数据缺失时返回空串，不阻塞生图。
 */
export function buildEnvironmentReference() {
  try {
    const note = getTimeLightInline();
    return note ? `Environment reference：${note}。` : '';
  } catch {
    return '';
  }
}

/**
 * 构造生图 prompt 请求：环境参考并入 system，末尾只保留一条 user 消息。
 */
export function buildImagePromptMessages({ character, user_message, reply_text, context, user_name = '' }) {
  const personality = buildCharacterAppearance(character) || character?.base_prompt || '';
  const systemParts = [];
  systemParts.push(`你是角色「${character?.display_name || '默认角色'}」的生图描述器。请结合对话上下文，将画面需求改写成一张配图的画面描述。`);
  systemParts.push(`角色设定：\n${personality.slice(0, 2000)}`);

  const environmentRef = buildEnvironmentReference();
  const rulePart = `画面描述规则：\n${IMAGE_PROMPT_RULE.rule_content}`;
  systemParts.push(environmentRef ? `${rulePart}\n\n${environmentRef}` : rulePart);
  systemParts.push('直接输出英文画面描述本身，不要输出 JSON、不要代码块、不要引号，也不要输出任何其他内容。');

  const contextLines = buildChatLines({ user_message: '', reply_text: '', context, user_name, maxLines: 4 }).join('\n');
  const userParts = [];
  if (contextLines) userParts.push(`【历史聊天记录】\n${contextLines}`);
  const requirementText = String(user_message || '').trim();
  if (requirementText) userParts.push(`【现在需要的图片需求】\n${requirementText}`);
  const ctxText = userParts.join('\n\n');
  return [
    { role: 'system', content: systemParts.join('\n\n') },
    { role: 'user', content: ctxText },
  ];
}

export async function extractImagePrompt({ character, user_message, reply_text, context, user_name = '' }) {
  const msgs = buildImagePromptMessages({ character, user_message, reply_text, context, user_name });
  const result = await chatSync(
    msgs,
    { temperature: 0.7, max_tokens: 1024, label: 'maibot-image-prompt' }
  );
  const prompt = cleanDirectPrompt(result);
  if (!prompt) {
    console.warn('[maibot-bridge] extractImagePrompt: 未能从模型输出取得 prompt, raw:', String(result).slice(0, 120));
  }
  return prompt;
}
