import { createHash } from 'node:crypto';

export const TEXT_VERSION = 'dialogue-v1';
export const MODEL_VERSION = 'IndexTTS-2.5:c39ce5ba981572cb187443877ff559dfb246ce63:d9e41aac89fd00b3d71497fddb287b7f24613712';
export function speechText(value, emojiKeys = []) {
  const emojis = new Set(emojiKeys);
  return String(value ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<(think|analysis|image|prompt|tool_call)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[(?:emoji|sticker|image|图片|表情|表情包)[^\]]*\]/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*[^*\n]+\*/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[\[【]([^\]】]+)[\]】]/g, (whole, key) => emojis.has(key.trim()) ? '' : whole)
    .replace(/[（(][^）)\n]*[）)]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#`*_~]/g, '').replace(/\s+/g, ' ').trim();
}
export function speechParams(input = {}) {
  const speed = Number(input.speed ?? 1);
  const language = input.language ?? 'zh';
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('语速必须在 0.5～2 倍之间');
  if (!['zh', 'en', 'ja'].includes(language)) throw new Error('不支持的语音语言');
  return { language, speed, duration_factor: 1 / speed };
}
export function speechCacheKey(text, hash, params, modelVersion = MODEL_VERSION) {
  return createHash('sha256').update(JSON.stringify({ text, hash, modelVersion, textVersion: TEXT_VERSION,
    language: params.language, speed: params.speed, duration_factor: params.duration_factor })).digest('hex');
}
