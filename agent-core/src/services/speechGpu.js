import { randomUUID } from 'node:crypto';
import { withGpu } from './gpuQueue.js';
import { unloadTts } from './indexTtsClient.js';
import { speechComfyUrl, speechGpuPolicy } from './speechGpuPolicy.js';

async function guard(route, body) {
  const res = await fetch(`${speechComfyUrl().replace(/\/+$/, '')}/linshe/gpu/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 409) return false;
  const failure = `ComfyUI 显存守卫请求失败：POST /linshe/gpu/${route}，HTTP ${res.status}。请运行本地语音“安装／修复”，确认节点位于 ComfyUI/custom_nodes/linshe_tts_guard，并在绘图结束后重启 ComfyUI。`;
  if (res.status === 404) throw Object.assign(new Error(failure), { code: 'GUARD_MISSING' });
  if (!res.ok) throw new Error(failure);
  return res.json();
}
// One coordinator per application; injected dependencies keep lease recovery testable.
export function createSpeechGpuCoordinator({ queue = withGpu, unload = unloadTts,
  ensureService = async () => (await import('./speechServiceProcess.js')).ensureSpeechService(),
  guard: gpuGuard = guard, now = Date.now,
  policy = speechGpuPolicy,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const guard = gpuGuard;
  let speechUsed = false;
  let leaseToken = null;
  let idleTimer = null;
  let idleGeneration = 0;
  let releaseError = false;
  let synchronized = false;
  let guardSynchronized = false;
  // null = not probed yet; false = ComfyUI has no guard node (or it vanished).
  // A missing node degrades to local sequencing instead of failing the task.
  let guardAvailable = null;
  let activeSpeech = Promise.resolve();
  let activeImage = Promise.resolve();
  const isGuardMissing = error => error?.code === 'GUARD_MISSING';
  const noteGuard = error => { if (isGuardMissing(error)) guardAvailable = false; return isGuardMissing(error); };
  // Without a guard node nothing may hold a lease, so shared mode would let both
  // models pile onto one card. Treat the machine as sequential instead.
  const effective = mode => guardAvailable === false ? { ...mode, shared: false, lease: false } : mode;
  // Reserve resources in FIFO order, but let admitted shared work run outside
  // the coordinator so image and speech inference can actually overlap.
  function dispatch(work, kind) {
    return queue(async () => {
      await (kind === 'speech' ? activeSpeech : activeImage);
      let run;
      try { run = await work(); }
      catch (error) {
        if (kind === 'speech' && speechUsed && !releaseError) scheduleRelease();
        throw error;
      }
      const done = Promise.resolve().then(run);
      const settled = done.catch(() => {});
      if (kind === 'speech') activeSpeech = settled;
      else activeImage = settled;
      return { done };
    }).then(({ done }) => done);
  }
  function withImageGpu(work) {
    return dispatch(async () => {
      if (!speechUsed && !releaseError && !leaseToken) return work;
      const mode = effective(await policy({ loaded: speechUsed, image: true }));
      // Never allow an image submission after an uncertain speech-worker exit.
      if (leaseToken || releaseError || !mode.shared) {
        await activeSpeech;
        if (speechUsed || releaseError) await releaseSpeech();
      }
      return work;
    }, 'image');
  }
  async function releaseSpeech() {
    idleGeneration++;
    clearTimeout(idleTimer);
    idleTimer = null;
    try {
      const result = await unload();
      if (result?.unloaded !== true) throw new Error('无法确认语音工作进程已退出，保留显存锁');
      if (leaseToken) {
        try {
          if (!await guard('release', { token: leaseToken })) throw new Error('显存锁状态已变化，请恢复显存调度');
        } catch (error) {
          // The node was uninstalled mid-session; the worker is already gone, so
          // dropping the stale token is safe and keeps sequencing usable.
          if (!noteGuard(error)) throw error;
        }
      }
      leaseToken = null;
      speechUsed = false;
      releaseError = false;
    } catch (e) { releaseError = true; throw e; }
  }
  function scheduleRelease() {
    clearTimeout(idleTimer);
    const generation = ++idleGeneration;
    idleTimer = setTimeout(() => {
      queue(async () => {
        await activeSpeech;
        if (generation === idleGeneration) await releaseSpeech();
      })
        .catch(e => console.warn('[TTS] 空闲卸载失败，请恢复显存调度:', e.message));
    }, 10 * 60 * 1000);
    idleTimer.unref?.();
  }
  function withSpeechGpu(work, isCancelled = () => false) {
    return dispatch(async () => {
      idleGeneration++;
      clearTimeout(idleTimer);
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
        synchronized = true;
      }
      // Probe after startup cleanup so an old worker's allocation does not
      // incorrectly force exclusive mode for the newly freed GPU.
      let mode = effective(await policy({ loaded: health.loaded === true && speechUsed }));
      if (mode.guard && !guardSynchronized) {
        // Recovery is permitted only with a confirmed idle worker exit.
        if (speechUsed) await releaseSpeech();
        try {
          if (!await guard('recover', { worker_unloaded: true })) throw new Error('无法恢复语音显存锁');
          guardSynchronized = true;
          guardAvailable = true;
        } catch (error) {
          if (noteGuard(error)) {
            // No guard node: fall back to one model at a time and stop probing.
            guardSynchronized = true;
            mode = effective(mode);
          } else if (!mode.shared) throw error;
          else guardSynchronized = true;
        }
      }
      clearTimeout(idleTimer);
      if (leaseToken) mode = { ...mode, shared: false };
      if (!mode.shared && !leaseToken) {
        await activeImage;
        if (isCancelled()) throw new Error('任务已取消');
        if (mode.lease) {
          const token = randomUUID();
          const deadline = now() + 120000;
          try {
            while (!await guard('acquire', { token })) {
              if (isCancelled()) throw new Error('任务已取消');
              if (now() > deadline) throw new Error('等待生图释放显存超时，请稍后重试');
              await sleep(1000);
            }
            leaseToken = token;
            guardAvailable = true;
          } catch (error) {
            // Local sequencing still keeps the two models apart; a missing node
            // is a degraded setup, not a task failure.
            if (!noteGuard(error)) throw error;
          }
        }
      }
      speechUsed = true;
      return async () => {
        try {
          if (isCancelled()) throw new Error('任务已取消');
          const result = await work();
          scheduleRelease();
          return result;
        } catch (error) {
          // An uncertain worker exit keeps an exclusive guard locked.
          await releaseSpeech();
          throw error;
        }
      };
    }, 'speech');
  }

  function recoverSpeechGpu() {
    return queue(async () => {
      clearTimeout(idleTimer);
      await activeSpeech;
      // Recovery intentionally handles stale tokens as well as live leases.
      // Do not try token-specific release before the recovery endpoint.
      try {
        const unloaded = await unload({ idle_only: true });
        if (unloaded?.unloaded !== true) throw new Error('无法确认语音工作进程已退出，保留显存锁');
      } catch (error) { releaseError = true; throw error; }
      idleGeneration++;
      clearTimeout(idleTimer);
      const mode = await policy();
      let result = { released: true };
      if (mode.guard || leaseToken) {
        try {
          result = await guard('recover', { worker_unloaded: true });
          if (!result) throw new Error('无法恢复语音显存锁');
          guardSynchronized = true;
          guardAvailable = true;
        } catch (error) {
          // The worker has already exited; without a node there is no lease left
          // to hold, so recovery still succeeds in sequential mode.
          if (!noteGuard(error)) throw error;
          guardSynchronized = true;
        }
      }
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
      await activeSpeech;
      const status = await restart();
      // The new adapter has no model loaded. Release any lease held by this Node.
      if (speechUsed || leaseToken || releaseError) await releaseSpeech();
      return status;
    });
  }

  // Read-only summary for the voice settings panel: which side is local, how big
  // the card is, whether both models may run together and whether the guard node
  // answered. Never probes the ComfyUI host when either side is remote.
  async function speechGpuStatus() {
    const mode = effective(await policy());
    return {
      local_image: mode.local_image, local_speech: mode.local_speech,
      name: mode.info?.name ?? null,
      total_mb: mode.info?.total ?? null,
      free_mb: mode.info?.free ?? null,
      mode: mode.shared ? 'shared' : 'serial',
      guard: guardAvailable,
      sequenced_only: !mode.shared,
    };
  }

  return { withImageGpu, withSpeechGpu, recoverSpeechGpu, restartSpeechGpu, speechGpuStatus };
}

export const { withImageGpu, withSpeechGpu, recoverSpeechGpu, restartSpeechGpu, speechGpuStatus } = createSpeechGpuCoordinator();
