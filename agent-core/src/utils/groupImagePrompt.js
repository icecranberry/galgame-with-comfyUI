/**
 * 群聊生图 prompt 行协议。
 *
 * 新格式为 {description}，旧 JSON 格式仅用于历史兼容。该模块同时供群聊
 * transcript 构建和摘要/后处理使用，避免 prompt 规则更新后各端失同步。
 */
export const LEGACY_IMG_LINE_RE = /\{["'“”]?prompt["'“”]?\s*:\s*["“]((?:[^"”\\]|\\.)*)["”]\s*\}/i;
export const DIRECT_IMG_LINE_RE = /^\{([\s\S]+)\}$/;

/** 提取群聊发图画面描述；不是 prompt 行时返回 null。 */
export function extractGroupImagePrompt(body) {
  const text = String(body || '').trim();
  const legacy = text.match(LEGACY_IMG_LINE_RE);
  if (legacy) return legacy[1].replace(/\\"/g, '"').trim() || null;

  const direct = text.match(DIRECT_IMG_LINE_RE);
  if (!direct) return null;
  const prompt = direct[1].trim();
  return prompt && !/^["'“”]?prompt["'“”]?\s*:/i.test(prompt) ? prompt : null;
}

/**
 * 去掉整条生图 prompt 行（含 [名字]: 前缀），保留普通对话行。
 * 纯函数：同一 raw 输出稳定，不破坏 transcript 的 append-only 前缀缓存。
 */
export function stripImagePromptLines(content) {
  if (!content.includes('{')) return content;
  return content.split('\n').map(line => {
    const separator = line.match(/^\[?[^:：\[\]]{1,20}\]?\s*[:：]\s*(.*)$/);
    const body = separator ? separator[1].trim() : line.trim();
    if (!extractGroupImagePrompt(body)) return line;
    return null;
  }).filter(Boolean).join('\n');
}

/** 移除消息中嵌入的旧版 {"prompt":"..."} JSON 块，保留同一行里的对话文本。 */
export function stripLegacyPromptJson(content) {
  return String(content || '').replace(new RegExp(LEGACY_IMG_LINE_RE.source, 'gi'), '');
}

// 成对花括号块：群聊协议把花括号保留给生图，私聊旧格式为 {"prompt":"..."}。
// 与 groupChatEngine 的兜底提取同口径，只吃成对块，不碰未闭合的孤立 `{`。
const BRACE_BLOCK_RE = /\{[^{}]*\}/g;

/**
 * 去掉文本里被 {...} 包裹的生图 prompt：整行都是 prompt 的行整行删除，
 * 粘在台词里的内联块只删块本身、保留同行真实发言（含旧版 {"prompt":"..."} JSON）。
 *
 * 专供"要把聊天记录上传给模型"的非生图链路（记忆整理、用户画像提取等）：
 * 这些链路只要真实发言，prompt 是噪声，还可能被模型抄进记忆或画像。
 * 生图链路（配图判断、prompt 提取、群聊 transcript）不要用这个函数。
 */
export function stripBracePromptBlocks(content) {
  const source = String(content ?? '');
  if (!source.includes('{')) return source;
  return stripLegacyPromptJson(source)
    .split('\n')
    .map(line => line
      .replace(BRACE_BLOCK_RE, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([，。！？、；：,.!?;:])/g, '$1')
      .trim())
    .filter(line => line !== '')
    .join('\n');
}
