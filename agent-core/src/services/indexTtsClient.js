import { selectedLocalTtsModel } from './localTtsModels.js';

const base = () => (process.env.TTS_SERVICE_URL || 'http://127.0.0.1:7861').replace(/\/+$/, '');
export async function ttsRequest(route, body, timeout = 10000) {
  let response;
  try {
    response = await fetch(`${base()}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-TTS-Token': process.env.TTS_SERVICE_TOKEN || '' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
    });
  } catch (cause) {
    const timedOut = cause.name === 'TimeoutError' || cause.name === 'AbortError';
    throw new Error(timedOut
      ? '本地语音服务响应超时，请稍后重试'
      : '无法连接本地语音服务，请启动服务后重试', { cause });
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `TTS 服务错误 (${response.status})`);
  return data;
}
export async function ttsHealth(timeout = 10000) {
  try {
    const status = await ttsRequest('/health', undefined, timeout);
    return { ...status, online: true, compatible: status.model_version === selectedLocalTtsModel().version };
  } catch (e) { return { online: false, compatible: false, error: e.message }; }
}
export const unloadTts = (options = {}) => ttsRequest('/unload', options, 30000);
