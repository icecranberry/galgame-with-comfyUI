import { config } from '../config.js';
import { randomUUID } from 'node:crypto';
import { withGpu } from './gpuQueue.js';
import { unloadTts } from './indexTtsClient.js';

async function guard(route, body) {
  const res = await fetch(`${config.comfyui.url.replace(/\/+$/, '')}/linshe/gpu/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 409) return false;
  if (!res.ok) throw new Error('同机显存保护未就绪：请安装 tts-service/comfy_guard 并重启 ComfyUI');
  return res.json();
}
// One coordinator per application; injected dependencies keep lease recovery testable.
export function createSpeechGpuCoordinator({ queue = withGpu, unload = unloadTts,
  ensureService = async () => (await import('./speechServiceProcess.js')).ensureSpeechService(),
  guard: gpuGuard = guard, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const guard = gpuGuard;
  let speechUsed = false;
  let leaseToken = null;
  let idleTimer = null;
  let releaseError = false;
  let synchronized = false;
  function withImageGpu(work) {
    return queue(async () => {
      // Never allow an image submission after an uncertain speech-worker exit.
      if (speechUsed) await releaseSpeech();
      return work();
    });
  }
  async function releaseSpeech() {
    clearTimeout(idleTimer);
    idleTimer = null;
    try {
      await unload();
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
      queue(releaseSpeech).catch(e => console.warn('[TTS] 空闲卸载失败，请恢复显存调度:', e.message));
    }, 10 * 60 * 1000);
    idleTimer.unref?.();
  }
  function withSpeechGpu(work, isCancelled = () => false) {
    return queue(async () => {
      if (isCancelled()) throw new Error('任务已取消');
      const health = await ensureService();
      if (!health.online || !health.compatible || !health.ready) throw new Error(health.error || 'TTS 模型尚未安装或版本不匹配');
      if (releaseError) {
        if (health.started) await releaseSpeech();
        else throw new Error('上次语音资源释放未确认，请在音色管理的服务维护中恢复显存调度');
      }
      if (isCancelled()) throw new Error('任务已取消');
      // Node restarts lose its in-memory lease while ComfyUI and TTS survive.
      // Confirm worker exit before recovering; never expire a CUDA lock by time.
      if (!synchronized) {
        if (health.busy) throw new Error('语音服务正在处理上一任务，请稍后重试');
        const result = await unload({ idle_only: true });
        if (result?.unloaded !== true) throw new Error('无法确认语音工作进程已退出，保留显存锁');
        if (!await guard('recover', { worker_unloaded: true })) throw new Error('无法恢复语音显存锁');
        synchronized = true;
      }
      clearTimeout(idleTimer);
      if (!leaseToken) {
        const token = randomUUID();
        const deadline = now() + 120000;
        while (!await guard('acquire', { token })) {
          if (isCancelled()) throw new Error('任务已取消');
          if (now() > deadline) throw new Error('等待生图释放显存超时，请稍后重试');
          await sleep(1000);
        }
        leaseToken = token;
      }
      speechUsed = true;
      try {
        if (isCancelled()) throw new Error('任务已取消');
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

  function recoverSpeechGpu() {
    return queue(async () => {
      clearTimeout(idleTimer);
      await unload();
      const result = await guard('recover', { worker_unloaded: true });
      leaseToken = null;
      speechUsed = false;
      releaseError = false;
      synchronized = true;
      return result;
    });
  }

  function restartSpeechGpu(restart) {
    return queue(async () => {
      clearTimeout(idleTimer);
      idleTimer = null;
      const status = await restart();
      // The new adapter has no model loaded. Release any lease held by this Node.
      if (speechUsed || leaseToken || releaseError) await releaseSpeech();
      return status;
    });
  }

  return { withImageGpu, withSpeechGpu, recoverSpeechGpu, restartSpeechGpu };
}

export const { withImageGpu, withSpeechGpu, recoverSpeechGpu, restartSpeechGpu } = createSpeechGpuCoordinator();
