import { Worker } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getImageDir } from './imagePaths.js';

export async function readStudioOriginal(url) {
  if (!/^\/images\/photo_studio\/[\w-]+\.(?:png|jpe?g|webp|avif)$/i.test(url || '')) throw new Error('原片地址无效');
  const filename = path.join(getImageDir('photo_studio'), path.basename(url));
  try { return await fs.readFile(filename); }
  catch (error) {
    if (error.code !== 'ENOENT' || !/\.png$/i.test(filename)) throw error;
    return fs.readFile(filename.replace(/\.png$/i, '.avif'));
  }
}

// CPU-heavy pixel effects run off the HTTP/SSE thread, independent of any browser page.
export function renderAutomaticStudioFinish(bytes, recipe) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./photoStudioFinishWorker.js', import.meta.url), { workerData: { bytes, recipe }, execArgv: [] });
    let settled = false;
    const finish = (error, png) => {
      if (settled) return;
      settled = true; clearTimeout(timer); void worker.terminate();
      if (error) reject(error); else resolve(Buffer.from(png));
    };
    const timer = setTimeout(() => finish(new Error('自动装裱超时，原片已保留，可重试装裱')), 90000);
    worker.once('message', result => finish(result.error ? new Error(result.error) : null, result.png));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(new Error(`自动装裱进程提前结束（${code}）`)); });
  });
}
