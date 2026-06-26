import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { config } from '../config.js';

const BASE = config.comfyui.url;
const WS_BASE = BASE.replace(/^http/, 'ws');

// ── 节点定义缓存（从 ComfyUI /object_info 获取）──

let objectInfoCache = null;   // 原始 response
let widgetSlotMap = null;     // Map<nodeType, [{name, slot}]>  所有 widget 输入的位置
let pollingTimer = null;

/**
 * 从 ComfyUI 获取所有已注册节点的完整 input schema。
 * 用于解析紧凑格式 workflow（如 aki-v2）中省略的 widget 输入。
 */
async function fetchObjectInfo() {
  const res = await fetch(`${BASE}/object_info`);
  if (!res.ok) throw new Error(`object_info returned ${res.status}`);
  return res.json();
}

/** 判断 object_info 中的类型是否为连接类型（非 widget）*/
function isConnectionType(typeInfo) {
  if (!Array.isArray(typeInfo) || typeInfo.length === 0) return false;
  // ["MODEL"] — 单元素字符串 → 连接类型
  // ["FLOAT", {...}] — 字符串+配置 → widget
  // [["opt1","opt2"]] — 嵌套数组 → COMBO widget
  return typeInfo.length === 1 && typeof typeInfo[0] === 'string';
}

/** 从 object_info 构建每个节点类型的 widget 插槽列表 */
function buildWidgetSlotMap(objectInfo) {
  const map = new Map();
  for (const [nodeType, info] of Object.entries(objectInfo)) {
    const inputDef = info.input || {};
    const required = inputDef.required || {};
    const optional = inputDef.optional || {};

    const slots = [];
    let slotIdx = 0;

    for (const entries of [required, optional]) {
      // 兼容数组格式 [[name, typeInfo], ...] 和对象格式 {name: typeInfo, ...}
      const list = Array.isArray(entries)
        ? entries
        : Object.entries(entries);
      for (const [name, typeInfo] of list) {
        if (!isConnectionType(typeInfo)) {
          slots.push({ name, slot: slotIdx });
        }
        slotIdx++;
      }
    }

    if (slots.length > 0) {
      map.set(nodeType, slots);
    }
  }
  return map;
}

/** 启动后台轮询，直到成功获取 object_info */
function startObjectInfoPolling() {
  if (pollingTimer) return;

  const poll = async () => {
    try {
      console.log('[comfyClient] Fetching ComfyUI /object_info...');
      const info = await fetchObjectInfo();
      objectInfoCache = info;
      widgetSlotMap = buildWidgetSlotMap(info);
      console.log(`[comfyClient] object_info cached: ${Object.keys(info).length} node types, ${widgetSlotMap.size} have widgets`);
      // 成功后清除定时器
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }
    } catch (err) {
      console.log(`[comfyClient] object_info unavailable (${err.message}), retrying in 30s...`);
    }
  };

  poll(); // 立即尝试一次
  pollingTimer = setInterval(poll, 30_000);
}

// 模块加载时启动轮询
startObjectInfoPolling();

// ── 紧凑格式硬编码兜底（object_info 不可用时的最后防线）──

const NODE_WIDGET_FALLBACK = {
  PrimitiveInt:    [{ name: 'value', slot: 0 }],
  PrimitiveString: [{ name: 'value', slot: 0 }],
  PrimitiveFloat:  [{ name: 'value', slot: 0 }],
  LoraLoader: [
    { name: 'lora_name', slot: 2 },
    { name: 'strength_model', slot: 3 },
    { name: 'strength_clip', slot: 4 },
  ],
  LoraLoaderModelOnly: [
    { name: 'lora_name', slot: 1 },
    { name: 'strength_model', slot: 2 },
  ],
};

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

  // 递归解析 Reroute 链: sourceNode → Reroute → ... → final
  function resolveReroute(srcId, srcSlot, visited = new Set()) {
    if (rerouteIds.has(String(srcId)) && !visited.has(String(srcId))) {
      visited.add(String(srcId));
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
        const link = linkByTarget.get(`${node.id}_${i}`);
        const resolved = resolveReroute(String(link[1]), link[2]);
        apiNode.inputs[inp.name] = resolved;

        if (inp.widget) {
          wvIdx++;
          if ((node.type === 'KSampler' || node.type === 'OpenAICompatibleLoader') && inp.name === 'seed') {
            wvIdx++;
          }
        }
      } else if (inp.widget) {
        if (node.type === 'KSampler' && inp.name === 'seed') {
          apiNode.inputs[inp.name] = wvs[wvIdx];
          wvIdx += 2;
        } else if (node.type === 'OpenAICompatibleLoader' && inp.name === 'seed') {
          apiNode.inputs[inp.name] = wvs[wvIdx];
          wvIdx += 2;
        } else {
          apiNode.inputs[inp.name] = wvs[wvIdx] ?? '';
          wvIdx++;
        }
      }
    }

    // 孤儿 widget 补全：紧凑格式（如 aki-v2）下 widget-only inputs 从 inputs 数组省略
    // 优先用 ComfyUI /object_info 的节点定义，不可用时回退到硬编码 NODE_WIDGET_FALLBACK
    if (wvIdx < wvs.length) {
      // 优先：object_info 推导的 widget 插槽
      const objSlots = widgetSlotMap?.get(node.type);
      if (objSlots) {
        // consumedCount 个 widget 已被主循环消费，剩余从 objSlots[consumedCount] 开始
        let consumedCount = 0;
        // 计算主循环实际消费了多少个 widget（从 inputs 中匹配的 widget 数）
        for (const inp of (node.inputs || [])) {
          if (inp.widget) consumedCount++;
        }
        // consumedCount 与 wvIdx 应该一致，但以防万一用 consumedCount
        const remainingSlots = objSlots.slice(wvIdx)
          .filter(s => !(s.name in apiNode.inputs));
        for (let j = 0; j < remainingSlots.length && wvIdx + j < wvs.length; j++) {
          apiNode.inputs[remainingSlots[j].name] = wvs[wvIdx + j] ?? '';
        }
        if (remainingSlots.length > 0) {
          console.log(`[comfyClient] ${node.type}(id=${node.id}) object_info fallback:`,
            remainingSlots.map((s, j) => `${s.name}=${JSON.stringify(wvs[wvIdx + j])}`).join(', '));
        }
      } else {
        // 兜底：硬编码 NODE_WIDGET_FALLBACK
        const fallbackDefs = NODE_WIDGET_FALLBACK[node.type];
        if (fallbackDefs) {
          const missingSlots = fallbackDefs.filter(f => !(f.name in apiNode.inputs));
          for (let j = 0; j < missingSlots.length && wvIdx + j < wvs.length; j++) {
            apiNode.inputs[missingSlots[j].name] = wvs[wvIdx + j] ?? '';
          }
          console.log(`[comfyClient] ${node.type}(id=${node.id}) hardcoded fallback:`,
            missingSlots.map((f, j) => `${f.name}=${JSON.stringify(wvs[wvIdx + j])}`).join(', '));
        }
      }
    }

    // 诊断日志：模型加载器节点输出完整的 widgets_values 和 inputs 对照
    if (['CLIPLoader', 'UNETLoader', 'VAELoader'].includes(node.type)) {
      console.log(`[comfyClient] ${node.type}(id=${node.id}) guiToApi result:`,
        JSON.stringify(apiNode.inputs));
      console.log(`[comfyClient] ${node.type}(id=${node.id}) raw widgets_values:`,
        JSON.stringify(wvs), `| inputs count: ${(node.inputs || []).length}`);
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
  const logNode = (id, label, key) => {
    if (!apiPrompt[id]) return;
    const v = apiPrompt[id]?.inputs?.[key];
    if (v !== undefined) console.log(`[comfyClient] ${id} (${label}): ${typeof v === 'string' ? `"${v.slice(0, 60)}"` : JSON.stringify(v)}`);
  };
  logNode('28', 'latent', 'width');
  logNode('28', 'latent', 'height');
  logNode('93', 'prompt', 'text');
  logNode('106', 'text', 'text');
  logNode('63', 'KSampler', 'steps');
  logNode('63', 'KSampler', 'cfg');

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
  if (onProgress) onProgress({ phase: 'submitted', promptId });

  // 优先走 WebSocket 实时进度，失败则回退到轮询
  try {
    return await wsProgressAndDownload(clientId, promptId, onProgress);
  } catch (err) {
    console.warn(`[comfyClient] WebSocket failed (${err.message}), falling back to polling`);
    return await pollAndDownload(promptId, onProgress);
  }
}

// ── WebSocket 实时进度 + 结果监听 ──

function wsProgressAndDownload(clientId, promptId, onProgress) {
  const wsUrl = `${WS_BASE}/ws?clientId=${encodeURIComponent(clientId)}`;
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve, reject) => {
    const timeoutMs = 600_000; // 10 分钟
    let settled = false;
    let done = false;
    let started = false;
    let lastActivity = Date.now();

    function settle(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (result.error) reject(new Error(result.error));
      else resolve(result.value);
    }

    const timeout = setTimeout(() => {
      settle({ error: `ComfyUI execution timeout (${timeoutMs / 1000}s) for prompt ${promptId}` });
    }, timeoutMs);

    // 活动心跳检测：120s 无任何消息 → 认为 WS 通道断开，触发上层重试
    //     大图采样可能长时间不发 progress，放宽到 120s 避免误判
    const heartbeat = setInterval(() => {
      if (Date.now() - lastActivity > 120_000 && !done) {
        settle({ error: `ComfyUI progress stalled (${Math.round((Date.now() - lastActivity) / 1000)}s no update)` });
      }
    }, 10_000);

    // ── 收到 node:null → 立即结算（不等 WebSocket close）──
    async function onExecutionComplete() {
      done = true;
      // 通知调用方 ComfyUI 执行完毕（此时还没下载图片）
      if (onProgress) {
        onProgress({ phase: 'executed', promptId });
      }
      // 等 100ms 让 ComfyUI 更新 history（downloadImagesFromHistory 自带重试兜底慢写盘）
      await new Promise(r => setTimeout(r, 100));
      try {
        const images = await downloadImagesFromHistory(promptId, /* retries */ 3);
        if (onProgress) {
          onProgress({ phase: 'done', promptId, imageCount: images.length, progress: 1 });
        }
        settle({ value: { images, promptId } });
      } catch (err) {
        settle({ error: err.message });
      }
    }

    ws.on('open', () => {
      console.log(`[comfyClient] WS connected, listening for progress on ${promptId}`);
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        lastActivity = Date.now();

        if (msg.type === 'progress') {
          const { value, max } = msg.data;
          const pct = max > 0 ? value / max : 0;
          if (onProgress) {
            onProgress({
              phase: 'sampling',
              progress: pct,
              step: value,
              totalSteps: max,
              promptId,
            });
          }
          // progress sent to frontend via onProgress callback, no console spam needed
        } else if (msg.type === 'executing') {
          const node = msg.data?.node;
          if (node != null) {
            if (!started) {
              started = true;
              // 首次收到 executing → ComfyUI 开始处理本 prompt，用于计时细分
              if (onProgress) onProgress({ phase: 'started', promptId });
            }
            if (onProgress) onProgress({ phase: 'executing', node, promptId });
            console.log(`[comfyClient] ⚙️ executing node: ${node}`);
          } else if (!done) {
            // node === null → 全部执行完毕，立即结算
            console.log(`[comfyClient] ✅ execution complete`);
            onExecutionComplete();
          }
        } else if (msg.type === 'execution_error') {
          const errMsg = msg.data?.exception_message || msg.data?.traceback || 'Unknown execution error';
          settle({ error: `ComfyUI execution error: ${errMsg}` });
        }
      } catch {
        // 忽略未知消息格式
      }
    });

    ws.on('close', () => {
      if (!settled && !done) {
        // WebSocket 在收到完成信号前异常关闭 → 走兜底
        console.warn(`[comfyClient] WS closed before completion, checking history as fallback`);
        (async () => {
          try {
            const images = await downloadImagesFromHistory(promptId, 5);
            if (images.length > 0) {
              if (onProgress) onProgress({ phase: 'done', promptId, imageCount: images.length, progress: 1 });
              settle({ value: { images, promptId } });
            } else {
              settle({ error: 'WebSocket closed before execution — no images in history' });
            }
          } catch (err) {
            settle({ error: err.message });
          }
        })();
      }
      // done=true → onExecutionComplete 已在处理中，close 无事可做
    });

    ws.on('error', (err) => {
      if (!settled && !done) {
        settle({ error: `WebSocket error: ${err.message}` });
      }
    });
  });
}

// ── 从 history 下载生成的图片（含重试，处理 ComfyUI 写盘延迟）──

async function downloadImagesFromHistory(promptId, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${BASE}/history/${promptId}`);
      const data = await res.json();

      if (data[promptId]) {
        const entry = data[promptId];
        const outputs = entry.outputs || {};
        const images = [];

        for (const [, output] of Object.entries(outputs)) {
          if (output.images) {
            for (const img of output.images) {
              try {
                const base64 = await downloadImageAsBase64(img.filename, img.subfolder || '', img.type || 'output');
                images.push({ base64, filename: img.filename });
              } catch (e) {
                console.error(`[comfyClient] download failed: ${img.filename}`, e.message);
              }
            }
          }
        }

        if (images.length > 0) {
          console.log(`[comfyClient] Downloaded ${images.length} image(s) from history`);
          return images;
        }
        // outputs 存在但没有 image 数据——可能是 ComfyUI 还在写盘
        lastErr = new Error('History entry exists but no images ready');
      } else {
        lastErr = new Error(`No history entry for ${promptId}`);
      }
    } catch (err) {
      lastErr = err;
    }

    if (attempt < retries - 1) {
      const waitMs = 1000 * (attempt + 1);
      console.log(`[comfyClient] History retry ${attempt + 1}/${retries} in ${waitMs}ms...`);
      await sleep(waitMs);
    }
  }

  throw lastErr || new Error(`Failed to download images for ${promptId}`);
}

// ── 轮询兜底（WebSocket 不可用时）──

async function pollAndDownload(promptId, onProgress, maxRetries = 600, interval = 1000) {
  console.warn('[comfyClient] Using polling fallback — progress will be rough');

  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(`${BASE}/history/${promptId}`);
    const data = await res.json();

    if (data[promptId]) {
      const entry = data[promptId];
      const status = entry.status || {};

      if (status.completed === false) {
        if (onProgress && i % 10 === 0) {
          // 轮询模式：用时间估算进度（粗糙）
          onProgress({ phase: 'sampling', progress: Math.min(0.95, i / maxRetries), step: i, max: maxRetries, promptId });
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
              const base64 = await downloadImageAsBase64(img.filename, img.subfolder || '', img.type || 'output');
              images.push({ base64, filename: img.filename });
            } catch (e) {
              console.error(`[comfyClient] download failed: ${img.filename}`, e.message);
            }
          }
        }
      }

      if (onProgress) {
        onProgress({ phase: 'done', promptId, imageCount: images.length, progress: 1 });
      }
      return { images, promptId };
    }

    if (onProgress && i % 5 === 0) {
      onProgress({ phase: 'waiting', step: i, max: maxRetries, promptId });
    }
    await sleep(interval);
  }

  throw new Error(`ComfyUI timeout (${maxRetries}s) for prompt ${promptId}`);
}

export async function downloadImageAsBase64(filename, subfolder = '', type = 'output') {
  const params = new URLSearchParams({ filename, type });
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
