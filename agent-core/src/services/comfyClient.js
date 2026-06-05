import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const BASE = config.comfyui.url;

/**
 * 直接提交 ComfyUI GUI 格式 workflow。
 * 模拟 ComfyUI 原生 Web UI 的提交流程：
 *   POST /api/prompt → 轮询 /history → 下载 /view
 *
 * @param {object} workflow - 完整的 GUI 格式 workflow JSON
 * @param {function} onProgress
 * @returns {Promise<{images: Array<{base64, filename}>, promptId: string}>}
 */
export async function submitWorkflow(workflow, onProgress) {
  const clientId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ComfyUI Web UI 原生格式：prompt 为空对象 + extra_data 里放完整 workflow
  const body = {
    client_id: clientId,
    prompt: {},
    extra_data: {
      extra_pnginfo: {
        workflow,
      },
    },
  };

  const res = await fetch(`${BASE}/api/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ComfyUI returned ${res.status}: ${errText}`);
  }

  const data = await res.json();
  if (data.error) {
    const msg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
    throw new Error(msg);
  }

  const promptId = data.prompt_id;
  if (onProgress) onProgress({ step: 0, max: 1, node: 'submitted', promptId });

  return pollAndDownload(promptId, onProgress);
}

/**
 * 轮询 /history/{prompt_id} + 下载图片
 */
async function pollAndDownload(promptId, onProgress, maxRetries = 360, interval = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(`${BASE}/history/${promptId}`);
    const data = await res.json();

    if (data[promptId]) {
      const entry = data[promptId];
      const status = entry.status || {};

      if (status.completed === false) {
        if (onProgress && i % 5 === 0) {
          onProgress({ step: i, max: maxRetries, node: 'running', promptId });
        }
        await sleep(interval);
        continue;
      }

      // Complete — collect all image outputs
      const outputs = entry.outputs || {};
      const images = [];

      for (const [, output] of Object.entries(outputs)) {
        if (output.images) {
          for (const img of output.images) {
            try {
              const base64 = await downloadImageAsBase64(img.filename, img.subfolder || '');
              images.push({ base64, filename: img.filename });
            } catch (e) {
              console.error(`[comfyClient] download failed: ${img.filename}`, e.message);
            }
          }
        }
      }

      if (onProgress) {
        onProgress({ step: maxRetries, max: maxRetries, node: 'done', promptId, imageCount: images.length });
      }
      return { images, promptId };
    }

    if (onProgress && i % 3 === 0) {
      onProgress({ step: i, max: maxRetries, node: 'waiting', promptId });
    }
    await sleep(interval);
  }

  throw new Error(`ComfyUI timeout (${maxRetries}s) for prompt ${promptId}`);
}

/**
 * 从 /view 下载图片 → base64
 */
export async function downloadImageAsBase64(filename, subfolder = '') {
  const params = new URLSearchParams({ filename });
  if (subfolder) params.set('subfolder', subfolder);
  const url = `${BASE}/view?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = path.extname(filename).slice(1) || 'png';
  return `data:image/${ext};base64,${buffer.toString('base64')}`;
}

/**
 * 本地 output 文件夹兜底
 */
export function findLatestImageInFolder(folderPath, subfolder = 'bot') {
  const dir = path.join(folderPath, subfolder);
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .map(f => ({
      name: f,
      path: path.join(dir, f),
      mtime: fs.statSync(path.join(dir, f)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0] : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
