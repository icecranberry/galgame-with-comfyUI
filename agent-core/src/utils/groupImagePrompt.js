/**
 * 群聊生图 prompt 行协议。
 *
 * 新格式为 {description}，旧 JSON 格式仅用于历史兼容。该模块同时供群聊
 * transcript 构建和摘要/后处理使用，避免 prompt 规则更新后各端失同步。
 */
export const LEGACY_IMG_LINE_RE = /\{["'“”]?prompt["'“”]?\s*:\s*["“]((?:[^"”\\]|\\.)*)["”]\s*\}/i;
export const DIRECT_IMG_LINE_RE = /^\{([\s\S]+)\}$/;

/**
 * 生图规范原文（<image_prompt_rules>）的特征片段。
 * 模型偶尔把规范当成 {} 里要填的内容原样输出，甚至输出到一半被截断（花括号未闭合），
 * 这种行既不是画面描述也不是聊天内容，一律丢弃。
 */
const IMAGE_RULE_ECHO_MARKERS = [
  'describe the image as a flowing',
  'follow this progression',
  'scene-appropriate clothing',
  'hard rules:',
];

// 规范全文约 40 行，上限取双倍余量：只在「块首花括号被模型吞掉」时兜底放行。
const MAX_RULE_ECHO_LINES = 80;

const braceDelta = (text) => (text.match(/\{/g) || []).length - (text.match(/\}/g) || []).length;

export function isImageRuleEcho(text) {
  const value = String(text ?? '').toLowerCase();
  if (!value) return false;
  return IMAGE_RULE_ECHO_MARKERS.some(marker => value.includes(marker));
}

/**
 * 规范原文出现在行首——模型把整条规范当成一条消息输出（常见半截、花括号未闭合）。
 * 允许前面有 {、[、" 等包裹符，但前面已经有正常台词的行不算：
 * 那些行只丢花括号里的内容、保留台词。
 */
export function isImageRuleEchoStart(text) {
  const value = String(text ?? '').trim().replace(/^[{\["“”'\s]+/, '').toLowerCase();
  if (!value) return false;
  return IMAGE_RULE_ECHO_MARKERS.some(marker => value.startsWith(marker));
}

// 格式模板本身被当成答案输出：占位词、省略号、"待填写"这类写法都不是画面描述。
const PLACEHOLDER_PROMPT_RE = /^(?:prompt|prompts|描述|画面描述|画面|占位符|placeholder|待填写|待补全|xxx*|\.{2,}|…+|<[^>]*>|\[[^\]]*\])$/i;

/**
 * 花括号里填的不是画面描述（占位词、中文、纯符号）。
 * 群聊协议要求 {} 内是全英文画面描述，命中说明模型在复读模板，直接丢弃该发图行。
 */
export function isPlaceholderImagePrompt(prompt) {
  const value = String(prompt ?? '').trim();
  if (!value) return true;
  if (PLACEHOLDER_PROMPT_RE.test(value)) return true;
  return !/[A-Za-z]/.test(value);
}

/** 多行块的第一行去掉「[名字]:」前缀后的正文，用于判定整块性质。 */
const blockBody = (lines) => {
  const whole = lines.join('\n');
  const separator = whole.match(/^\[?[^:：\[\]]{1,20}\]?\s*[:：]\s*([\s\S]*)$/);
  return (separator ? separator[1] : whole).trim();
};

/** 整块都是模型复读的生图规范原文。 */
const isRuleEchoBlock = (lines) => isImageRuleEchoStart(blockBody(lines));

/**
 * 按花括号把内容拼回多行块（与流式解析同口径：花括号没闭合就继续攒），
 * 由 shouldDropBlock 决定整块留不留，返回保留的原始行。
 */
function partitionBlocks(content, shouldDropBlock) {
  const kept = [];
  let block = [];
  const flush = () => {
    if (block.length === 0) return;
    if (!shouldDropBlock(block)) kept.push(...block);
    block = [];
  };
  for (const line of String(content ?? '').split('\n')) {
    block.push(line);
    // 超过上限说明花括号被模型吞了，不再继续攒，交给整块判定兜底
    if (braceDelta(block.join('\n')) > 0 && block.length < MAX_RULE_ECHO_LINES) continue;
    flush();
  }
  flush();
  return kept;
}

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
 * 与流式解析同口径：先按花括号把多行内容拼回一个 candidate，再整块判定——
 * 多行画面描述、以及被模型当成模板整篇复读的规范原文，都不会进 transcript
 * （前者是噪声，后者留在聊天记录里会让模型下一轮继续复读）。
 * 纯函数：同一 raw 输出稳定，不破坏 transcript 的 append-only 前缀缓存。
 */
export function stripImagePromptLines(content) {
  if (!content.includes('{') && !isImageRuleEcho(content)) return content;
  return partitionBlocks(content, (lines) => {
    const whole = lines.join('\n');
    const body = blockBody(lines);
    if (isImageRuleEchoStart(body)) return true;          // 复读的规范原文
    if (extractGroupImagePrompt(body)) return true;       // 完整发图行
    return body.startsWith('{') && braceDelta(whole) > 0; // 被截断的未闭合发图行
  }).join('\n');
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
  if (!source.includes('{') && !isImageRuleEcho(source)) return source;
  return partitionBlocks(stripLegacyPromptJson(source), isRuleEchoBlock)
    .map(line => line
      .replace(BRACE_BLOCK_RE, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([，。！？、；：,.!?;:])/g, '$1')
      .trim())
    .filter(line => line !== '')
    .join('\n');
}
