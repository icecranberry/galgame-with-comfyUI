import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hostname, networkInterfaces } from 'node:os';
import { config } from '../config.js';

const exec = promisify(execFile);

// Cards at or above this total size are expected to hold Anima and IndexTTS at
// once; everything smaller runs one model at a time by default.
const DEFAULT_SHARED_MIN_MB = 12288;
// IndexTTS cold-start model footprint and inference headroom (MiB).
const DEFAULT_BUDGET_MB = 6144;
const DEFAULT_RESERVE_MB = 2048;

export function isLocalAddress(value) {
  let host;
  try { host = new URL(value).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { return false; }
  return ['localhost', '::1', hostname().toLowerCase()].includes(host)
    || /^127\./.test(host)
    || Object.values(networkInterfaces()).flat().some(entry => entry?.address.toLowerCase() === host);
}

export const isLocalGpuUrl = value => isLocalAddress(value);

export const speechComfyUrl = () => process.env.TTS_COMFYUI_URL || config.comfyui.url;
export const speechServiceUrl = () => process.env.TTS_SERVICE_URL || 'http://127.0.0.1:7861';

// Query physical free *and* total memory: total decides whether both models can
// share the card, free decides whether a cold model fits right now. Unknown
// devices stay sequential; never add memory from different GPUs together.
export async function readSpeechGpuInfo(env = process.env, run = exec) {
  try {
    const { stdout } = await run('nvidia-smi',
      ['--query-gpu=index,uuid,memory.free,memory.total,name', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 5000 });
    const rows = stdout.trim().split(/\r?\n/).map(line => line.split(',').map(v => v.trim()));
    const visible = env.CUDA_VISIBLE_DEVICES?.split(',')[0]?.trim();
    const row = visible ? rows.find(([index, uuid]) => visible === index || visible === uuid)
      : rows.length === 1 ? rows[0] : null;
    if (!row) return null;
    const free = Number(row[2]);
    const total = Number(row[3]);
    if (!Number.isFinite(free) || free < 0 || !Number.isFinite(total) || total <= 0) return null;
    return { free, total, name: row.slice(4).join(',').trim() || null };
  } catch { return null; }
}

export async function readSpeechGpuMemory(env = process.env, run = exec) {
  return (await readSpeechGpuInfo(env, run))?.free ?? null;
}

// `shared` runs Anima and IndexTTS at the same time; `lease` asks the ComfyUI
// guard node to hold the GPU (only meaningful when both services are local).
// A remote ComfyUI or a remote TTS worker cannot contend for this machine's GPU,
// so it must never be asked to release its model.
export async function speechGpuPolicy({ loaded = false, image = false } = {}, {
  env = process.env, memory = readSpeechGpuInfo, comfyUrl = speechComfyUrl(), serviceUrl = speechServiceUrl(),
} = {}) {
  const localImage = isLocalAddress(comfyUrl);
  const localSpeech = isLocalAddress(serviceUrl);
  const local = { local_image: localImage, local_speech: localSpeech };
  if (!localImage || !localSpeech) return { shared: true, guard: false, lease: false, ...local, info: null };

  if (env.TTS_GPU_MODE === 'shared') return { shared: true, guard: true, lease: false, ...local, info: null };

  const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  const exclusive = env.TTS_GPU_MODE === 'exclusive';
  if (!exclusive) {
    const minTotal = positive(env.TTS_GPU_SHARED_MIN_MB, DEFAULT_SHARED_MIN_MB);
    const reserve = positive(env.TTS_GPU_RESERVE_MB, DEFAULT_RESERVE_MB);
    const budget = positive(env.TTS_GPU_BUDGET_MB, DEFAULT_BUDGET_MB);
    const info = await memory(env);
    // A warm worker only needs inference headroom; a cold start also has to fit
    // the model itself before both can stay resident.
    const needed = reserve + (loaded || image ? 0 : budget);
    if (info && info.total >= minTotal && info.free >= needed) {
      return { shared: true, guard: true, lease: false, ...local, info };
    }
    return { shared: false, guard: true, lease: true, ...local, info };
  }
  return { shared: false, guard: true, lease: true, ...local, info: null };
}
