// Parses the { text, imagePrompt, imagePrompt2, imagePrompt3 } object returned by
// the moments LLM call. imagePrompt2 / imagePrompt3 只在本次要发多张配图时才出现
// （配图张数分布：70% 一张 / 20% 两张 / 10% 三张）。
// The parser is intentionally strict about not leaking raw JSON syntax into
// the stored post content when the model response is truncated or malformed.

export const DEFAULT_MOMENT_IMAGE_PROMPT = 'scenic view, beautiful lighting, detailed';

function emptyMoment(text = '') {
  return { text, imagePrompt: '', imagePrompt2: '', imagePrompt3: '' };
}

function stripCodeFence(raw) {
  return raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function repairInvalidEscapes(text) {
  return text.replace(/\\([^"\\\/bfnrtu])/g, '$1');
}

function extractFirstJson(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function endsInsideString(text) {
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') inString = !inString;
  }
  return inString;
}

function unescapeJsonString(value) {
  return value.replace(/\\"/g, '"').replace(/\\n/g, '\n');
}

function tryParseJson(text) {
  try {
    const parsed = JSON.parse(repairInvalidEscapes(text));
    const textValue = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
    if (!textValue) return null;
    return {
      text: textValue,
      imagePrompt: typeof parsed?.imagePrompt === 'string' ? parsed.imagePrompt.trim() : '',
      imagePrompt2: typeof parsed?.imagePrompt2 === 'string' ? parsed.imagePrompt2.trim() : '',
      imagePrompt3: typeof parsed?.imagePrompt3 === 'string' ? parsed.imagePrompt3.trim() : '',
    };
  } catch {
    return null;
  }
}

// 截断发生在字符串内部时，用来判断某个字段是否已经写完（引号闭合）。
// 只保留写完的 prompt，避免把半截画面描述送去生图。
function hasClosedStringField(text, name) {
  return new RegExp(`"${name}"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"`).test(text);
}

export function parseMomentResponse(raw) {
  const cleaned = stripCodeFence(typeof raw === 'string' ? raw : '');
  if (!cleaned) return emptyMoment();

  const start = cleaned.indexOf('{');
  const jsonish = start === -1 ? cleaned : cleaned.slice(start);

  const completeJson = extractFirstJson(jsonish);
  if (completeJson) {
    const parsed = tryParseJson(completeJson);
    if (parsed) return parsed;
  }

  // A truncated response usually ends inside the imagePrompt string (missing a
  // closing quote) or right after the closing quote (missing only the brace).
  const truncatedInsideString = endsInsideString(jsonish);
  const suffixes = truncatedInsideString ? ['"}', '}'] : ['}', '"}'];
  for (const suffix of suffixes) {
    const parsed = tryParseJson(jsonish + suffix);
    if (parsed) {
      if (truncatedInsideString) {
        return {
          text: parsed.text,
          imagePrompt: hasClosedStringField(jsonish, 'imagePrompt') ? parsed.imagePrompt : '',
          imagePrompt2: hasClosedStringField(jsonish, 'imagePrompt2') ? parsed.imagePrompt2 : '',
          imagePrompt3: hasClosedStringField(jsonish, 'imagePrompt3') ? parsed.imagePrompt3 : '',
        };
      }
      return parsed;
    }
  }

  // Last-chance salvage: keep only the text field, never raw JSON in content.
  const textMatch = jsonish.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/is);
  if (textMatch?.[1]) {
    return emptyMoment(unescapeJsonString(textMatch[1]));
  }

  if (jsonish.startsWith('{')) return emptyMoment();
  return emptyMoment(cleaned.slice(0, 200));
}

/**
 * Read-side fallback for legacy rows that already stored raw LLM JSON in content.
 */
export function sanitizeMomentContent(content) {
  if (typeof content !== 'string' || !content.trim().startsWith('{')) return content;
  const parsed = parseMomentResponse(content);
  return parsed.text || content;
}
