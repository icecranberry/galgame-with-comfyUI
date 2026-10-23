import { config } from '../config.js';
import { randomUUID } from 'node:crypto';
import { withGpu } from './gpuQueue.js';
import { unloadTts, ttsHealth } from './indexTtsClient.js';

let speechUsed = false;
let leaseToken = null;
let idleTimer = null;
let releaseError = false;
async function guard(route, body) {
  const res = await fetch(`${config.comfyui.url.replace(/\/+$/, '')}/linshe/gpu/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 409) return false;
  if (!res.ok) throw new Error('同机显存保护未就绪：请安装 tts-service/comfy_guard 并重启 ComfyUI');
  return res.json();
}
export function withImageGpu(work) {
  return withGpu(async () => {
    // Never allow an image submission after an uncertain speech-worker exit.
    if (speechUsed) await releaseSpeech();
    return work();
  });
}
async function releaseSpeech() {
  clearTimeout(idleTimer);
  idleTimer = null;
  try {
    await unloadTts();
    if (leaseToken) {
      if (!await guard('release', { token: leaseToken })) throw new Error('显存锁状态已变化，请恢复显存调度');
    }
    leaseToken = null;
    speechUsed = false;
    releaseError = false;
  } catch (e) { releaseError = true; throw e; }
}
function scheduleRelease() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    withGpu(releaseSpeech).catch(e => console.warn('[TTS] 空闲卸载失败，请恢复显存调度:', e.message));
  }, 10 * 60 * 1000);
  idleTimer.unref?.();
}
export function withSpeechGpu(work, isCancelled = () => false) {
  return withGpu(async () => {
    if (isCancelled()) throw new Error('任务已取消');
    if (releaseError) throw new Error('上次语音资源释放未确认，请在音色管理的服务维护中恢复显存调度');
    const health = await ttsHealth();
    if (!health.online || !health.compatible || !health.ready) throw new Error(health.error || 'TTS 模型尚未安装或版本不匹配');
    clearTimeout(idleTimer);
    if (!leaseToken) {
      const token = randomUUID();
      const deadline = Date.now() + 120000;
      while (!await guard('acquire', { token })) {
        if (isCancelled()) throw new Error('任务已取消');
        if (Date.now() > deadline) throw new Error('等待生图释放显存超时，请稍后重试');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      leaseToken = token;
    }
    speechUsed = true;
    try {
      const result = await work();
      scheduleRelease();
      return result;
    } catch (error) {
      // The guard remains locked if termination is unconfirmed; restarting the
      // worker/service and using the documented recovery endpoint resolves it.
      await releaseSpeech();
      throw error;
    }
  });
}

export function recoverSpeechGpu() {
  return withGpu(async () => {
    clearTimeout(idleTimer);
    await unloadTts();
    const result = await guard('recover', { worker_unloaded: true });
    leaseToken = null;
    speechUsed = false;
    releaseError = false;
    return result;
  });
}

export function restartSpeechGpu(restart) {
  return withGpu(async () => {
    clearTimeout(idleTimer);
    idleTimer = null;
    const status = await restart();
    // The new adapter has no model loaded. Release any lease held by this Node.
    if (speechUsed || leaseToken || releaseError) await releaseSpeech();
    return status;
  });
}
