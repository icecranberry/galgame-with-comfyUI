export function extractImagePromptResponse(content) {
  const text = typeof content === 'string'
    ? content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    : '';

  if (!text) return null;

  const jsonMatch = text.match(/\{[“”"]?prompt[“”"]?\s*:\s*[“”"]([^]*?)[“”"]?\s*\}/i);
  if (jsonMatch?.[1]?.trim()) return jsonMatch[1].trim();

  return text.length >= 5 ? text : null;
}

export async function requestNonEmptyImagePrompt(request, { emptyRetries = 1, onEmpty } = {}) {
  for (let attempt = 0; attempt <= emptyRetries; attempt++) {
    const response = await request(attempt);
    const content = typeof response === 'string' ? response : '';
    if (content.trim()) return content;
    if (attempt < emptyRetries) onEmpty?.(attempt + 1, emptyRetries);
  }
  return '';
}
