/**
 * maibot-bridge/judge.js
 * 判断 MaiBot 的这轮回复是否需要配图（复用主聊天流的判断逻辑）。
 */
import { chatSync } from '../llm/llm-client.js';
import { cleanChatText } from './textCleaner.js';
import { JUDGE_PROMPT, detectImageIntent } from '../builtinRules.js';

function toContextLines(context) {
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
  return lines;
}


export async function judgeImageNeed({ user_message = '', reply_text = '', context = [] }) {
  // 规则快速通道：消息里明确要求发图
  if (detectImageIntent(user_message)) return true;

  const lines = toContextLines(context);
  if (user_message) lines.push(`用户: ${String(user_message).slice(0, 400)}`);
  if (reply_text) lines.push(`Agent: ${String(reply_text).slice(0, 600)}`);
  if (lines.length === 0) return false;
  const ctxText = lines.join('\n');

  try {
    const result = await chatSync(
      [
        { role: 'system', content: JUDGE_PROMPT },
        { role: 'user', content: ctxText },
      ],
      { temperature: 0, max_tokens: 5, label: 'maibot-judge-image' }
    );
    const verdict = String(result || '').trim().startsWith('是');
    console.log(`[maibot-bridge] judgeImageNeed: ${verdict ? 'YES' : 'no'} (response: "${String(result).trim().slice(0, 20)}")`);
    return verdict;
  } catch (err) {
    console.error('[maibot-bridge] judgeImageNeed error:', err.message);
    return false; // 失败时默认不发图（安全侧）
  }
}
