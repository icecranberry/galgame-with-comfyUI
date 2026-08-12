/**
 * maibot-bridge/style.js
 * 根据角色 base_prompt 提炼 MaiBot 需要的行为风格与表达风格。
 */
import { chatSync } from '../llm/llm-client.js';

const REPLY_STYLE_LENGTH_LIMIT = "**回复限制在30字内**";
const REPLY_STYLE_NO_EMOJI_LIMIT = "**禁止发送Unicode文本类型的emoji**";

const STYLE_EXTRACTION_PROMPT = `你是角色设定分析师。根据下面给出的人物设定（base_prompt），提炼两段用于 AI 聊天机器人的配置文本：

1. behavior_style（行为风格）：以第二人称“你”的视角描述该角色参与群聊/私聊时的行动准则，例如你何时回复、如何观察局面、何时保持安静，不超过 100 字。
2. reply_style（表达风格）：以第二人称“你”的视角描述该角色的说话风格，例如你说话简短/温和/吐槽/正式、习惯的语气与句式，不超过 100 字。

要求：两段文本都以第二人称“你”作为主语来描述该角色自己的行为与说话风格（例如“你习惯在人多时保持安静”“你说话简短直接”），不要用“我”或“TA”作为主语，也不要写成给角色下达的指令。

只输出 JSON，格式：{"behavior_style": "...", "reply_style": "..."}，不要输出其他内容。`;

function extractJson(text) {
  const start = String(text || '').indexOf('{');
  const end = String(text || '').lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(String(text).slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function deriveStyles(basePrompt) {
  const result = await chatSync(
    [
      { role: 'system', content: STYLE_EXTRACTION_PROMPT },
      { role: 'user', content: String(basePrompt || '').slice(0, 4000) },
    ],
    { temperature: 0.3, max_tokens: 500, label: 'maibot-derive-style' }
  );
  const parsed = extractJson(result) || {};
  const styles = {
    behavior_style: String(parsed.behavior_style || '').trim(),
    reply_style: String(parsed.reply_style || '').trim(),
  };
  if (styles.reply_style) {
    const lines = styles.reply_style.split('\n');
    for (const limitLine of [REPLY_STYLE_LENGTH_LIMIT, REPLY_STYLE_NO_EMOJI_LIMIT]) {
      if (!lines.includes(limitLine)) lines.push(limitLine);
    }
    styles.reply_style = lines.join('\n');
  }
  console.log(`[maibot-bridge] derive-style done (behavior=${styles.behavior_style.length}ch, reply=${styles.reply_style.length}ch)`);
  return styles;
}
