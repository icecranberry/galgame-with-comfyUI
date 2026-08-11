/**
 * maibot-bridge/textCleaner.js
 * 聊天文本清洗：去掉 MaiBot 消息元数据、工具调用块与模型指令块，只保留真实发言。
 * 供配图判断、生图 prompt 提取、记忆整理等链路共用。
 */

const TOOL_CALL_KEYS = ['tool_call_id', 'tool_name', 'args', 'result_status', 'result'];
const INSTRUCTION_START_MARKERS = [
  '当前时间：',
  '你想要回复的消息是',
  '【回复信息参考】',
  '【关键信息参考】',
  '回复指引：',
  '关键信息参考：',
  '请优先依据',
  '【表达习惯参考，请视情况自然的使用】',
  '你的说话风格可以尝试：',
];

// MaiBot 会把随回复附加的表情包描述直接拼在消息文本后面，例如 `哼～心虚,尴尬,无奈,委屈`。
// 多标签列表基本只来自表情描述；单标签只处理常见情绪词，并要求前面是句末标点/语气词，避免误伤正文。
const EMOJI_TAG_LIST_SUFFIX_RE = /([！!？?～~啊哦吧呢嘛啦]|[）)])((?:[\u4e00-\u9fff]{1,4}[,，、])+[\u4e00-\u9fff]{1,4})$/;
const EMOJI_SINGLE_TAG_SUFFIX_RE = /([！!？?～~啊哦吧呢嘛啦]|[）)])(思考|惊讶|疑惑|委屈|害羞|生气|开心|傲娇|可爱|卖萌|严肃|懵|无语|无奈|撒娇|可怜|兴奋|期待|激动|难过|伤心|疲惫|尴尬|慌张|呆滞|得意|震惊)$/;

function stripEmojiTagSuffix(text, { assistant = false } = {}) {
  if (!assistant || !text) return text;
  const normalized = text.replace(/\s+/g, '');
  const match = normalized.match(EMOJI_TAG_LIST_SUFFIX_RE) || normalized.match(EMOJI_SINGLE_TAG_SUFFIX_RE);
  if (!match) return text;
  const keepLen = match.index + match[1].length;
  let seen = 0;
  let end = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!/\s/.test(text[i])) {
      seen += 1;
      if (seen > keepLen) break;
    }
    end = i + 1;
  }
  return text.slice(0, end).trimEnd();
}

/**
 * 把 MaiBot 上下文整理成聊天行：用户按出现顺序标成 用户1/用户2，不暴露真实昵称；
 * 助手默认标成“你”，判断链路可传 assistantLabel: 'Agent'。当前消息若已在上下文末尾，不会重复追加。
 */
export function buildChatLines({ user_message = '', reply_text = '', context = [], user_name = '', assistantLabel = '你', maxLines = 2 } = {}) {
  const lines = [];
  const userNumbers = new Map();
  let lastIsUser = false;
  const labelFor = (key) => {
    if (!userNumbers.has(key)) userNumbers.set(key, userNumbers.size + 1);
    return `用户${userNumbers.get(key)}`;
  };

  for (const item of context || []) {
    if (item == null) continue;
    if (typeof item === 'string') {
      const text = cleanChatText(item).slice(0, 400);
      if (text) { lines.push(`用户1: ${text}`); lastIsUser = true; }
    } else if (typeof item === 'object') {
      const isAssistant = item.role === 'assistant';
      const content = cleanChatText(item.content ?? item.text ?? '', { assistant: isAssistant }).slice(0, 400);
      if (!content) continue;
      if (isAssistant) {
        lines.push(`${assistantLabel}: ${content}`);
        lastIsUser = false;
      } else {
        const key = item.speaker || user_name || '__default__';
        lines.push(`${labelFor(key)}: ${content}`);
        lastIsUser = true;
      }
    }
  }

  const userText = cleanChatText(user_message).slice(0, 400);
  const lastLine = lines[lines.length - 1] || '';
  let userLabel = '';
  if (user_name) {
    userLabel = labelFor(user_name);
  } else if (lastIsUser && lastLine) {
    userLabel = lastLine.split(':')[0].trim();
  } else {
    userLabel = labelFor('__default__');
  }
  if (userText && !(lastIsUser && lastLine.endsWith(`: ${userText}`))) lines.push(`${userLabel}: ${userText}`);

  const replyText = cleanChatText(reply_text, { assistant: true }).slice(0, 600);
  if (replyText && lines[lines.length - 1] !== `${assistantLabel}: ${replyText}`) lines.push(`${assistantLabel}: ${replyText}`);
  // 判断/生图只保留最后两句：当前用户消息 + 回复
  return maxLines > 0 ? lines.slice(-maxLines) : lines;
}

export function cleanChatText(text, { assistant = false } = {}) {
  // 清洗聊天文本：去掉消息元数据、工具调用块和 MaiBot 指令块，只保留真实发言
  const kept = [];
  let inToolBlock = false;
  let inInstructionBlock = false;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^<message\b/.test(line)) continue; // 消息元数据标签
    if (/^\[(?:图片|表情包|表情)/.test(line)) continue; // 媒体占位不参与判断/生图
    if (line.includes('已折叠的历史工具调用') || line.startsWith('[工具调用')) { inToolBlock = true; continue; }
    if (inToolBlock) {
      if (line.startsWith('-') || line.startsWith('·') || line.startsWith('*') || TOOL_CALL_KEYS.includes(line.split(':')[0].trim())) continue;
      inToolBlock = false;
    }
    if (INSTRUCTION_START_MARKERS.some((marker) => line.startsWith(marker))) { inInstructionBlock = true; continue; }
    if (inInstructionBlock) {
      const m = line.match(/^-\s*发言内容：(.*)$/);
      if (m) kept.push(m[1].trim());
      continue;
    }
    kept.push(line);
  }
  return stripEmojiTagSuffix(kept.join(' '), { assistant });
}
