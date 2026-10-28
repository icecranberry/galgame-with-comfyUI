import { createHash } from 'node:crypto';

export const TEXT_VERSION = 'dialogue-v1';
// Invalidate older audio when stop-token checks or the server sampling profile change.
export const SYNTHESIS_VERSION = 'checked-eos-p90-v3';
export const MODEL_VERSION = 'IndexTTS-2.0:740dcaff396282ffb241903d150ac011cd4b1ede:d9e41aac89fd00b3d71497fddb287b7f24613712';
export const GENERATION_DEFAULTS = Object.freeze({ temperature: 0.8, top_k: 30, top_p: 0.9, num_beams: 3 });
export function speechGenerationParams(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('高级参数必须是对象');
  const bounds = { temperature: [0.1, 1.5], top_k: [0, 100], top_p: [0.1, 1], num_beams: [1, 5] };
  const result = {};
  for (const [key, fallback] of Object.entries(GENERATION_DEFAULTS)) {
    const value = input[key] === undefined ? fallback : input[key];
    const [min, max] = bounds[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max ||
        (['top_k', 'num_beams'].includes(key) && !Number.isInteger(value))) throw new Error(`${key} 必须在 ${min}～${max} 之间${['top_k', 'num_beams'].includes(key) ? '，且为整数' : ''}`);
    result[key] = value;
  }
  for (const key of Object.keys(input)) if (!Object.hasOwn(GENERATION_DEFAULTS, key)) throw new Error(`不支持的高级参数：${key}`);
  return result;
}
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
  const generation = typeof input.generation_params === 'string' ? JSON.parse(input.generation_params) : input.generation_params;
  return { language, speed, duration_factor: 1 / speed, generation_params: speechGenerationParams(generation) };
}
export function speechCacheKey(text, hash, params, modelVersion = MODEL_VERSION) {
  return createHash('sha256').update(JSON.stringify({ text, hash, modelVersion, textVersion: TEXT_VERSION, synthesisVersion: SYNTHESIS_VERSION,
    language: params.language, speed: params.speed, duration_factor: params.duration_factor,
    generation_params: speechGenerationParams(params.generation_params) })).digest('hex');
}
