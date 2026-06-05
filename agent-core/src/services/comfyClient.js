import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const BASE = config.comfyui.url;

/**
 * GUI workflow → API prompt 转换
 *
 * 严格模拟 ComfyUI 原生 Web UI 的提交流程：
 *   - widget 输入如有 link，link 优先
 *   - Reroute 节点递归解析
 *   - KSampler/OpenAI seed 后跳过 control_after_generate
 */
function guiToApi(workflow) {
  const nodeIds = new Set(workflow.nodes.map(n => String(n.id)));
  const rerouteIds = new Set(workflow.nodes.filter(n => n.type === 'Reroute').map(n => String(n.id)));

  // 索引 links: targetNode_targetSlot → link
  const linkByTarget = new Map();
  for (const link of workflow.links || []) {
    if (!nodeIds.has(String(link[3]))) continue; // 幽灵链接跳过
    const key = `${link[3]}_${link[4]}`;
    linkByTarget.set(key, link);
  }

  // 索引 links: targetNode → [{ slot, link }] (找连接到某个 node 任意 slot 的 link)
  const linksToNode = new Map();
  for (const link of workflow.links || []) {
    if (!nodeIds.has(String(link[3]))) continue;
    const target = String(link[3]);
    if (!linksToNode.has(target)) linksToNode.set(target, []);
    linksToNode.get(target).push({ slot: link[4], link });
  }

  // 递归解析 Reroute 链: sourceNode → Reroute → ... → final
  function resolveReroute(srcId, srcSlot, visited = new Set()) {
    if (rerouteIds.has(String(srcId)) && !visited.has(String(srcId))) {
      visited.add(String(srcId));
      // Reroute 节点的 input 0 连到上游
      const upLink = linkByTarget.get(`${srcId}_0`);
      if (upLink) {
        return resolveReroute(String(upLink[1]), upLink[2], visited);
      }
    }
    return [String(srcId), srcSlot];
  }

  const api = {};
  for (const node of workflow.nodes || []) {
    if (node.type === 'Reroute') continue;

    const apiNode = { inputs: {}, class_type: node.type, _meta: { title: getTitle(node) } };
    const wvs = node.widgets_values || [];
    let wvIdx = 0;

    for (let i = 0; i < (node.inputs || []).length; i++) {
      const inp = node.inputs[i];
      const hasLink = linkByTarget.has(`${node.id}_${i}`);

      if (hasLink) {
        // link 优先 — 无论是否有 widget
        const link = linkByTarget.get(`${node.id}_${i}`);
        const resolved = resolveReroute(String(link[1]), link[2]);
        apiNode.inputs[inp.name] = resolved;

        // 如果这个 input 同时有 widget，要消耗对应的 widget_values
        if (inp.widget) {
          wvIdx++;
          // KSampler seed + control_after_generate
          if ((node.type === 'KSampler' || node.type === 'OpenAICompatibleLoader') && inp.name === 'seed') {
            wvIdx++;
          }
        }
      } else if (inp.widget) {
        // 纯 widget，无 link
        if (node.type === 'KSampler' && inp.name === 'seed') {
          apiNode.inputs[inp.name] = wvs[wvIdx]; // seed 值
          wvIdx += 2; // 跳过 seed + control_after_generate（"increment"）
        } else if (node.type === 'OpenAICompatibleLoader' && inp.name === 'seed') {
          apiNode.inputs[inp.name] = wvs[wvIdx];
          wvIdx += 2;
        } else {
          apiNode.inputs[inp.name] = wvs[wvIdx] ?? '';
          wvIdx++;
        }
      }
    }

    api[String(node.id)] = apiNode;
  }

  return api;
}

function getTitle(node) {
  const map = {
    VAELoader: 'VAE加载', UNETLoader: 'UNet加载', CLIPLoader: 'CLIP加载',
    CLIPTextEncode: 'CLIP文本编码', KSampler: 'K采样器', VAEDecode: 'VAE解码',
    SaveImage: '保存图像', PreviewImage: '预览图像', EmptyLatentImage: '空Latent',
    INTConstant: 'INT常数', JoinStringMulti: '合并字符串', JjkText: '文本',
  };
  return node.title || map[node.type] || node.type;
}

// ── 公开 API ──

export async function submitWorkflow(guiWorkflow, onProgress) {
  const clientId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const apiPrompt = guiToApi(guiWorkflow);

  // 关键节点日志
  const n28 = apiPrompt['28'];
  const n93 = apiPrompt['93'];
  const n106 = apiPrompt['106'];
  const n63 = apiPrompt['63'];
  console.log(`[comfyClient] API nodes: ${Object.keys(apiPrompt).length}`);
  console.log(`[comfyClient] 28 (latent): w=${JSON.stringify(n28?.inputs?.width)} h=${JSON.stringify(n28?.inputs?.height)}`);
  console.log(`[comfyClient] 93 (prompt): "${(n93?.inputs?.text || '').slice(0, 60)}"`);
  console.log(`[comfyClient] 106 (text): ${JSON.stringify(n106?.inputs?.text)?.slice(0, 30)}`);
  console.log(`[comfyClient] 63 (KSampler): steps=${n63?.inputs?.steps} cfg=${n63?.inputs?.cfg}`);

  const body = {
    client_id: clientId,
    prompt: apiPrompt,
    extra_data: { extra_pnginfo: { workflow: guiWorkflow } },
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
  console.log(`[comfyClient] Submitted, promptId: ${promptId}`);
  if (onProgress) onProgress({ step: 0, max: 1, node: 'submitted', promptId });

  return pollAndDownload(promptId, onProgress);
}

async function pollAndDownload(promptId, onProgress, maxRetries = 600, interval = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(`${BASE}/history/${promptId}`);
    const data = await res.json();

    if (data[promptId]) {
      const entry = data[promptId];
      const status = entry.status || {};

      if (status.completed === false) {
        if (onProgress && i % 10 === 0) {
          onProgress({ step: i, max: maxRetries, node: 'running', promptId });
        }
        await sleep(interval);
        continue;
      }

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

    if (onProgress && i % 5 === 0) {
      onProgress({ step: i, max: maxRetries, node: 'waiting', promptId });
    }
    await sleep(interval);
  }

  throw new Error(`ComfyUI timeout (${maxRetries}s) for prompt ${promptId}`);
}

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

export function findLatestImageInFolder(folderPath, subfolder = 'bot') {
  const dir = path.join(folderPath, subfolder);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .map(f => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length > 0 ? files[0] : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
