// Matches SillyTavern's OpenAI-compatible TTS provider: full endpoint,
// Bearer authentication and binary audio, with SiliconFlow-compatible cloning.
import { createHash } from 'node:crypto';

export const API_DEFAULTS = Object.freeze({ endpoint: 'https://api.openai.com/v1/audio/speech', model: 'tts-1' });
export function apiConnection(input = {}) {
  let url;
  try { url = new URL(String(input.endpoint || '').trim()); } catch { throw new Error('请填写完整的 TTS API 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('TTS API 地址必须是无内嵌凭据的 HTTP / HTTPS 地址');
  const model = String(input.model || '').trim();
  if (!model || model.length > 200) throw new Error('请填写有效的 TTS 模型名称');
  const uploadEndpoint = String(input.upload_endpoint || '').trim();
  if (uploadEndpoint) {
    let upload;
    try { upload = new URL(uploadEndpoint); } catch { throw new Error('请填写完整的音色上传地址'); }
    if (!['http:', 'https:'].includes(upload.protocol) || upload.username || upload.password || upload.hash) throw new Error('音色上传地址必须是无内嵌凭据的 HTTP / HTTPS 地址');
  }
  return { endpoint: url.href, model, ...(uploadEndpoint ? { upload_endpoint: uploadEndpoint } : {}) };
}
export function apiVoiceParams(input = {}) {
  const voice = String(input.voice || '').trim();
  const source = input.source || 'voice';
  if (!['voice', 'references'].includes(source)) throw new Error('无效的 API 音色来源');
  if ((source === 'voice' && !voice) || voice.length > 200) throw new Error('请填写 API 音色 ID');
  const references = input.references ?? [];
  if (!Array.isArray(references) || references.length > 1) throw new Error('每个角色请选择一段参考音频');
  const refs = references.map(ref => {
    if (!ref || typeof ref.sample_id !== 'string' || !/^[a-f0-9-]{36}$/.test(ref.sample_id)) throw new Error('请选择已上传的 API 参考音频');
    const text = String(ref.text || '').trim();
    if (text.length > 4000) throw new Error('参考音频文本最多 4000 字');
    return { sample_id: ref.sample_id, text };
  });
  if (source === 'references' && !refs.length) throw new Error('请先选择 API 参考音频');
  const speed = input.speed ?? 1;
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.25 || speed > 4) throw new Error('API 语速必须在 0.25～4 倍之间');
  const instructions = String(input.instructions || '').trim();
  if (instructions.length > 4000) throw new Error('语音指令最多 4000 字');
  let extra = input.extra ?? {};
  if (typeof extra === 'string') {
    try { extra = JSON.parse(extra); } catch { throw new Error('附加参数必须是有效的 JSON 对象'); }
  }
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('附加参数必须是 JSON 对象');
  if (JSON.stringify(extra).length > 16000) throw new Error('附加参数过长');
  for (const key of ['input', 'model', 'voice', 'references', 'source', 'speed', 'instructions', 'response_format', 'stream', 'authorization', 'api_key', '__proto__', 'constructor', 'prototype']) {
    if (Object.hasOwn(extra, key)) throw new Error(`请勿在附加参数中覆盖 ${key}`);
  }
  return { voice, speed, instructions, extra, ...(input.source !== undefined || refs.length ? { source, references: refs } : {}) };
}
export function apiSpeechBody(text, connection, profile, references) {
  const p = apiVoiceParams(profile);
  if (p.source === 'references' && (!references?.length || references.length !== p.references.length)) throw new Error('API 参考音频尚未加载');
  return { ...p.extra, model: connection.model, input: text,
    ...(p.source === 'references' ? { references } : { voice: p.voice }), speed: p.speed,
    response_format: 'mp3', ...(p.instructions ? { instructions: p.instructions } : {}) };
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
export function apiSpeechCacheKey(characterId, text, connection, profile, references) {
  return createHash('sha256').update(JSON.stringify(stable({ protocol: 'openai-tts-v1', characterId,
    endpoint: connection.endpoint, body: apiSpeechBody(text, connection, profile, references) }))).digest('hex');
}
export async function fetchApiSpeech(text, connection, profile, key, signal, references) {
  const response = await fetch(connection.endpoint, { method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(apiSpeechBody(text, connection, profile, references)),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
  // Do not expose upstream bodies: providers sometimes echo request credentials.
  if (!response.ok) { await response.body?.cancel(); throw new Error(`TTS API 请求失败（HTTP ${response.status}），请检查地址、Key、模型和音色 ID`); }
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream'].includes(type)) {
    await response.body?.cancel(); throw new Error('TTS API 未返回音频，请确认使用 OpenAI 兼容的语音合成端点');
  }
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 25 * 1024 * 1024) throw new Error('TTS API 音频超过 25MB');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  const wav = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
  const mp3 = buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  if (!wav && !mp3) throw new Error('TTS API 返回的内容不是有效的 MP3 / WAV 音频');
  return { buffer, extension: wav ? 'wav' : 'mp3' };
}

export async function uploadApiVoice(connection, key, { buffer, name, text }) {
  if (!connection.upload_endpoint) throw new Error('请先在音色管理的全局 API 设置中填写音色上传地址');
  const body = new FormData();
  body.append('file', new Blob([buffer], { type: 'audio/wav' }), 'reference.wav');
  body.append('model', connection.model);
  body.append('customName', name);
  body.append('text', text);
  const response = await fetch(connection.upload_endpoint, { method: 'POST', redirect: 'error',
    headers: key ? { Authorization: `Bearer ${key}` } : {}, body, signal: AbortSignal.timeout(120000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`音色创建失败（HTTP ${response.status}），请检查上传地址、模型与参考音频`); }
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 65536) throw new Error('音色创建接口返回内容过大');
    chunks.push(chunk);
  }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new Error('音色创建接口未返回有效 JSON'); }
  if (typeof result?.uri !== 'string' || !result.uri.trim() || result.uri.length > 200 || /[\r\n]/.test(result.uri)) throw new Error('音色创建接口未返回有效 uri，请确认兼容硅基流动上传协议');
  return result.uri.trim();
}
