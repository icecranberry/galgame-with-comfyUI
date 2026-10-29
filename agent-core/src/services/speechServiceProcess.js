import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ttsHealth } from './indexTtsClient.js';
import { restartSpeechGpu } from './speechGpu.js';
import { selectedLocalTtsModel } from './localTtsModels.js';
import { broadcast } from './unifiedStreamBus.js';

// Windows descendants can retain the launcher's pipe handles after PowerShell
// exits. execFile's callback waits for those handles forever; observe the
// launcher's exit instead and let the health probe confirm adapter readiness.
export function executeSpeechLauncher(file, args, options, launch = spawn) {
  return new Promise((resolve, reject) => {
    const child = launch(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout?.resume();
    child.stderr?.on('data', data => { stderr = (stderr + data.toString()).slice(-4000); });
    const cleanup = () => { child.stdout?.destroy(); child.stderr?.destroy(); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', (code, signal) => {
      cleanup();
      if (code === 0) resolve();
      else reject(Object.assign(new Error(signal ? '声音服务启动命令超时或被终止' : `启动命令退出码 ${code}`), { stderr }));
    });
  });
}
const serviceDir = fileURLToPath(new URL('../../../tts-service/', import.meta.url));

// Share one restart across windows/clients; keep it in the image/speech FIFO.
export function createSpeechServiceRestarter({ run = executeSpeechLauncher, health = ttsHealth,
  exclusive = restartSpeechGpu, env = process.env, platform = process.platform,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), model = () => '2.0', onlyIfOffline = false,
  onStarting = () => {} } = {}) {
  let pending = null;
  return function restart() {
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      if (onlyIfOffline) {
        const status = await health(2000);
        if (status.online) return status;
      }
      if (platform !== 'win32') throw new Error('一键重启目前支持 Windows，请在服务所在主机手动重启声音服务');
      const url = new URL(env.TTS_SERVICE_URL || 'http://127.0.0.1:7861');
      if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)
        || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
        throw new Error('一键重启仅支持本机声音服务，请在远程服务所在主机重启');
      }
      return exclusive(async () => {
        onStarting();
        try {
          await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', path.join(serviceDir, 'restart.ps1'),
            '-ModelVersion', model(), '-Port', url.port || '80', ...(onlyIfOffline ? ['-StartOnly'] : [])], { windowsHide: true, timeout: 45000, env });
        } catch (error) {
          throw new Error(`声音服务启动失败：${String(error.stderr || error.message).trim().slice(0, 1200)}`);
        }
        for (let attempt = 0; attempt < 20; attempt++) {
          const status = await health(2000);
          if (status.online) return onlyIfOffline ? { ...status, started: true } : status;
          await sleep(500);
        }
        throw new Error('声音服务启动后仍无法连接，请检查 tts-service/logs/tts-stderr.log');
      });
    }).finally(() => { pending = null; });
    return pending;
  };
}

const onStarting = () => broadcast('speech_preparing', { phase: 'service_start' });
export const restartSpeechService = createSpeechServiceRestarter({ model: () => selectedLocalTtsModel().id, onStarting });

// Called INSIDE the GPU FIFO. Re-entering restartSpeechGpu here would deadlock.
export const ensureSpeechService = createSpeechServiceRestarter({
  model: () => selectedLocalTtsModel().id, onlyIfOffline: true, exclusive: work => work(), onStarting,
});
