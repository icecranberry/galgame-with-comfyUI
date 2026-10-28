import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LOCAL_TTS_MODELS, localTtsModel } from './localTtsModels.js';
import { getSpeechSettings, setSpeechSettings } from './speechService.js';
import { restartSpeechService } from './speechServiceProcess.js';

const root = fileURLToPath(new URL('../../../tts-service/', import.meta.url));
const execute = promisify(execFile);
export async function inspectLocalModels() {
  let python;
  try {
    const runtime = JSON.parse(readFileSync(path.join(root, 'runtime/runtime.json'), 'utf8'));
    const base = path.resolve(root, 'runtime', runtime.python_home);
    if (!base.startsWith(path.join(root, 'runtime') + path.sep)) throw new Error('Invalid Python path');
    python = path.join(base, 'python.exe');
  } catch { /* A fresh install has no bundled Python yet. */ }
  const runtimeFiles = ['runtime/runtime.json', 'runtime/tools/ffmpeg/bin/ffmpeg.exe', 'runtime/tools/ffmpeg/bin/ffprobe.exe'];
  if (!python || !existsSync(python) || runtimeFiles.some(file => !existsSync(path.join(root, file)))) {
    return Object.values(LOCAL_TTS_MODELS).map(({ id, label }) => ({ id, label, installed: false, error: '尚未安装完整的本地语音运行环境' }));
  }
  try {
    const { stdout } = await execute(python, ['-X', 'utf8', path.join(root, 'deployment.py'), 'inspect'], {
      windowsHide: true, timeout: 20000, env: { ...process.env, PYTHONUTF8: '1', PYTHONNOUSERSITE: '1' }, maxBuffer: 256 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    return Object.values(LOCAL_TTS_MODELS).map(({ id, label }) => ({ id, label, installed: false, error: `无法检查本地安装：${String(error.stderr || error.message).trim().slice(0, 800)}` }));
  }
}

export function createLocalSpeechModelManager({ inspect = inspectLocalModels, launch = spawn,
  restart = restartSpeechService, settings = getSpeechSettings, configure = setSpeechSettings,
  platform = process.platform, env = process.env } = {}) {
  let installation = { status: 'idle', model: null, log: '', error: '' }, using = null;
  const status = async () => ({ selected: settings().local_model || '2.0', models: await inspect(), installation: { ...installation }, using });
  function install(model) {
    localTtsModel(model);
    if (platform !== 'win32') throw new Error('一键安装目前支持 Windows，请运行对应的部署脚本');
    if (using || (installation.status === 'running' && installation.model !== model)) throw new Error('另一项本地语音操作正在进行');
    if (installation.status === 'running') return { ...installation };
    installation = { status: 'running', model, log: '正在准备安装…', error: '' };
    const active = installation;
    try {
      const child = launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'setup.ps1'), '-ModelVersion', model],
        { windowsHide: true, cwd: root, env: { ...env, TTS_LOCAL_MODEL: model }, stdio: ['ignore', 'pipe', 'pipe'] });
      const append = chunk => { if (installation === active) installation.log = (installation.log + String(chunk)).slice(-12000); };
      child.stdout?.on('data', append); child.stderr?.on('data', append);
      child.once('error', error => { if (installation === active) { installation.status = 'failed'; installation.error = `安装启动失败：${error.message}`; } });
      child.once('close', async code => {
        if (installation !== active || installation.status !== 'running') return;
        try {
          const models = code === 0 ? await inspect() : [];
          if (installation !== active) return;
          const installed = models.find(m => m.id === model)?.installed;
          installation.status = installed ? 'completed' : 'failed';
          installation.error = installed ? '' : models.find(m => m.id === model)?.error || `安装未完成（退出码 ${code}），可重试，已下载文件会保留`;
        } catch (error) { installation.status = 'failed'; installation.error = error.message; }
      });
    } catch (error) { installation.status = 'failed'; installation.error = error.message; }
    return { ...installation };
  }
  async function use(model) {
    const desired = localTtsModel(model);
    if (using || installation.status === 'running') throw new Error('请等待当前本地语音操作结束');
    if (settings().mode !== 'local') throw new Error('请先切换到全局本地语音模式');
    using = model;
    const previous = settings().local_model || '2.0';
    let changed = false;
    try {
      const installed = (await inspect()).find(m => m.id === model);
      if (!installed?.installed) throw new Error(`请先安装 ${desired.label}`);
      configure({ local_model: model }); changed = true;
      const health = await restart();
      if (!health.online || !health.ready || health.model_version !== desired.version) throw new Error(health.error || '声音服务未运行所选模型');
      return { settings: settings(), health };
    } catch (error) {
      if (changed) {
        configure({ local_model: previous });
        try { await restart(); } catch { /* Preserve the original startup failure. */ }
      }
      throw error;
    } finally { using = null; }
  }
  return { status, install, use };
}
export const localSpeechModels = createLocalSpeechModelManager();
