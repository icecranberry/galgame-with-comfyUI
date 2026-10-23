import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ttsHealth } from './indexTtsClient.js';
import { restartSpeechGpu } from './speechGpu.js';

const execute = promisify(execFile);
const serviceDir = fileURLToPath(new URL('../../../tts-service/', import.meta.url));

// Share one restart across windows/clients; keep it in the image/speech FIFO.
export function createSpeechServiceRestarter({ run = execute, health = ttsHealth,
  exclusive = restartSpeechGpu, env = process.env, platform = process.platform,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let pending = null;
  return function restart() {
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      if (platform !== 'win32') throw new Error('一键重启目前支持 Windows，请在服务所在主机手动重启声音服务');
      const url = new URL(env.TTS_SERVICE_URL || 'http://127.0.0.1:7861');
      if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)
        || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
        throw new Error('一键重启仅支持本机声音服务，请在远程服务所在主机重启');
      }
      const runtimeDir = path.resolve(env.TTS_RUNTIME_DIR || path.join(serviceDir, 'runtime'));
      return exclusive(async () => {
        try {
          await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', path.join(serviceDir, 'restart.ps1'), '-RuntimeDir', runtimeDir,
            '-Port', url.port || '80'], { windowsHide: true, timeout: 45000, env });
        } catch (error) {
          throw new Error(`声音服务启动失败：${String(error.stderr || error.message).trim().slice(0, 1200)}`);
        }
        for (let attempt = 0; attempt < 20; attempt++) {
          const status = await health(2000);
          if (status.online) return status;
          await sleep(500);
        }
        throw new Error('声音服务启动后仍无法连接，请检查运行环境及 runtime 中的 tts-stderr.log');
      });
    }).finally(() => { pending = null; });
    return pending;
  };
}

export const restartSpeechService = createSpeechServiceRestarter();
