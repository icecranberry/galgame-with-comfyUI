import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hostname, networkInterfaces } from 'node:os';
import { config } from '../config.js';

const exec = promisify(execFile);

export function isLocalGpuUrl(value) {
  const host = new URL(value).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return ['localhost', '::1', hostname().toLowerCase()].includes(host)
    || /^127\./.test(host)
    || Object.values(networkInterfaces()).flat().some(entry => entry?.address.toLowerCase() === host);
}

export const speechComfyUrl = () => process.env.TTS_COMFYUI_URL || config.comfyui.url;

// Query physical free memory, not PyTorch's reclaimable cache. Unknown devices
// stay exclusive; never add free memory from different GPUs together.
export async function readSpeechGpuMemory(env = process.env, run = exec) {
  try {
    const { stdout } = await run('nvidia-smi', ['--query-gpu=index,uuid,memory.free', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 5000 });
    const rows = stdout.trim().split(/\r?\n/).map(line => line.split(',').map(v => v.trim()));
    const visible = env.CUDA_VISIBLE_DEVICES?.split(',')[0]?.trim();
    const row = visible ? rows.find(([index, uuid]) => visible === index || visible === uuid)
      : rows.length === 1 ? rows[0] : null;
    const freeMiB = row && Number(row[2]);
    return Number.isFinite(freeMiB) && freeMiB >= 0 ? freeMiB : null;
  } catch { return null; }
}

export async function speechGpuPolicy({ loaded = false, image = false } = {}, {
  env = process.env, memory = readSpeechGpuMemory, comfyUrl = speechComfyUrl(),
} = {}) {
  if (env.TTS_GPU_MODE === 'exclusive') return { shared: false, guard: true };
  // A remote image server cannot free this machine's CUDA memory. An explicit
  // TTS_COMFYUI_URL identifies the local guard when image traffic uses a tunnel.
  if (!isLocalGpuUrl(comfyUrl)) return { shared: true, guard: false };
  const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  const reserve = positive(env.TTS_GPU_RESERVE_MB, 2048);
  const budget = positive(env.TTS_GPU_BUDGET_MB, 6144);
  const free = await memory(env);
  return { shared: free !== null && free >= reserve + (loaded || image ? 0 : budget), guard: true };
}
