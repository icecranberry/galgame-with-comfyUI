/**
 * maibot-bridge/judge.js
 * 判断 MaiBot 的这轮回复是否需要配图（复用主聊天流的判断逻辑）。
 */
import { chatSync } from '../llm/llm-client.js';
import { buildChatLines } from './textCleaner.js';
import { JUDGE_PROMPT, detectImageIntent } from '../builtinRules.js';

export async function judgeImageNeed({ user_message = '', reply_text = '', context = [], user_name = '' }) {
  // 规则快速通道：消息里明确要求发图
  if (detectImageIntent(user_message)) return true;

  const lines = buildChatLines({ user_message, reply_text, context, user_name, assistantLabel: 'Agent' });
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
