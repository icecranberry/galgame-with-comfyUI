/**
 * 图像生成 Skill
 *
 * 流程:
 *   1. 接收 {"prompt":"..."} 中的中文画面描述
 *   2. 用Anima提示词优化助手.txt 规则，调 DeepSeek 优化为英文 prompt
 *   3. 按条件注入参数（画师串/质量提示词/画面描述/宽/高/lora）
 *   4. 提交 ComfyUI → 轮询 → 下载 base64
 *   5. 兜底: 本地 output/bot/ 文件夹
 *
 * Lora 加载方式:
 *   不再使用 Lora Loader (LoraManager) 节点 + <lora:xxx:1> 标签
 *   改为动态注入 ComfyUI 官方 LoraLoaderModelOnly 节点
 *   多个 lora 通过堆叠多个 LoraLoaderModelOnly 节点实现
 *   链路: UNETLoader → Lora1 → Lora2 → ... → KSampler
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chatSync } from '../llm/llm-client.js';
import { submitWorkflow } from './comfyClient.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');
const BASE_WORKFLOW = '制图工作流.json';
const BASE_WORKFLOW_PATH = path.join(WORKFLOW_DIR, BASE_WORKFLOW);
const RULES_PATH = path.join(__dirname, '..', '..', '..', 'workflow', 'Anima提示词优化助手.txt');

const PROMPT_PLACEHOLDER = '请输入画面描述';

// 按节点 title 注入参数（而非硬编码节点 ID）
const NODE_TITLES = {
  artist: '画师串',
  width:  '图片的宽',
  height: '图片的长',
  prompt: '画面描述',
  loraTrigger: 'lora触发词',
};

// 缓存规则文本
let _rulesCache = '';

function loadRules() {
  if (_rulesCache) return _rulesCache;
  if (!fs.existsSync(RULES_PATH)) {
    console.warn('[imageSkill] Anima提示词优化助手.txt not found, using raw prompt');
    return '';
  }
  _rulesCache = fs.readFileSync(RULES_PATH, 'utf8');
  console.log(`[imageSkill] Prompt rules loaded (${_rulesCache.length} chars)`);
  return _rulesCache;
}

/**
 * 用 DeepSeek + 提示词规则优化 prompt
 */
async function optimizePrompt(rawPrompt) {
  const rules = loadRules();
  if (!rules) return rawPrompt;

  const systemMsg = `${rules}

---

【用户输入】
用户会给你一段中文画面描述。你的任务：严格按照上述模板规则，将其转写为一条英文 prompt。

重要：
- 只输出最终的英文 prompt 文本（一行，无换行）
- 不要输出任何解释、markdown、引导语
- 不要输出质量词（masterpiece/best quality 等）和画师名
- 不要输出光线/光影/色调标签`;

  try {
    const result = await chatSync([
      { role: 'system', content: systemMsg },
      { role: 'user', content: rawPrompt },
    ], { temperature: 0.3, max_tokens: 1024, label: 'Anima 润色助手' });

    const cleaned = result.trim();
    console.log(`[imageSkill] Prompt optimized: "${rawPrompt.slice(0, 40)}..." → "${cleaned.slice(0, 60)}..."`);
    return cleaned || rawPrompt;
  } catch (err) {
    console.error('[imageSkill] Prompt optimization failed:', err.message);
    return rawPrompt;
  }
}

/**
 * 构建注入参数后的 workflow 副本
 *
 * @param {string}   promptText  - 优化后的画面描述
 * @param {object}   [overrides]
 * @param {string}   [overrides.artist]
 * @param {number}   [overrides.width]
 * @param {number}   [overrides.height]
 * @param {Array}    [overrides.loras]  - [{path, weight, triggerWord}]
 * @param {string}   [overrides.customWorkflow] - 自定义工作流文件名（单人时替代基础工作流）
 */
function buildWorkflow(promptText, overrides = {}) {
  let wfPath = BASE_WORKFLOW_PATH;
  const loras = overrides.loras || [];
  const hasLoras = loras.length > 0;

  if (overrides.customWorkflow) {
    const customPath = path.join(WORKFLOW_DIR, overrides.customWorkflow);
    if (fs.existsSync(customPath)) {
      wfPath = customPath;
      console.log(`[imageSkill] Using custom workflow: ${overrides.customWorkflow}`);
    } else {
      console.warn(`[imageSkill] Custom workflow not found: ${overrides.customWorkflow}, using base workflow`);
    }
  }

  if (!fs.existsSync(wfPath)) {
    throw new Error(`Workflow not found: ${wfPath}`);
  }

  const workflow = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
  const wf = JSON.parse(JSON.stringify(workflow));

  const defaults = {
    [NODE_TITLES.artist]: overrides.artist ?? config.comfyui.artist,
    [NODE_TITLES.width]:  overrides.width  ?? config.comfyui.width,
    [NODE_TITLES.height]: overrides.height ?? config.comfyui.height,
  };

  for (const node of wf.nodes || []) {
    if (!Array.isArray(node.widgets_values)) continue;

    // KSampler seed 随机化
    if (node.type === 'KSampler' && node.widgets_values.length > 1 && node.widgets_values[1] === 'randomize') {
      node.widgets_values[0] = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    }

    // lora触发词节点：注入所有 lora 的 triggerWord 拼接
    if (node.title === NODE_TITLES.loraTrigger && hasLoras) {
      const triggerWords = loras.map(l => l.triggerWord || '').filter(Boolean).join(', ');
      if (triggerWords) {
        node.widgets_values[0] = triggerWords;
        console.log(`[imageSkill] lora trigger words injected: "${triggerWords}"`);
      }
      continue;
    }

    // 画面描述节点：替换占位符，无占位符则写入第一个 widget
    if (node.title === NODE_TITLES.prompt) {
      const idx = node.widgets_values.findIndex(
        v => typeof v === 'string' && v.includes(PROMPT_PLACEHOLDER)
      );
      if (idx >= 0) {
        node.widgets_values[idx] = promptText;
      } else if (node.widgets_values.length > 0) {
        node.widgets_values[0] = promptText;
      }
      console.log(`[imageSkill] Node "${node.title}" prompt injected`);
      continue;
    }

    // 画师串 / 宽 / 高：替换第一个 widget
    const val = defaults[node.title];
    if (val !== undefined && node.widgets_values.length > 0) {
      node.widgets_values[0] = val;
      console.log(`[imageSkill] Node "${node.title}" injected: ${val}`);
    }
  }

  // 动态注入 LoraLoaderModelOnly 节点链
  if (hasLoras) {
    injectLoraNodes(wf, loras);
  }

  console.log(`[imageSkill] Workflow built: ${path.basename(wfPath)}${hasLoras ? ` (${loras.length} lora(s))` : ''}`);
  return wf;
}

/**
 * 在工作流中动态插入 LoraLoaderModelOnly 节点
 * 链路: UNETLoader → Lora1 → Lora2 → ... → 原始下游节点
 * 自动适配：无论 UNETLoader 直连 KSampler 还是中间有用户插入的节点，都正确链入。
 */
function injectLoraNodes(wf, loras) {
  const unetNode = wf.nodes.find(n => n.type === 'UNETLoader');
  const samplerNode = wf.nodes.find(n => n.type === 'KSampler');

  if (!unetNode || !samplerNode) {
    console.warn('[imageSkill] Cannot inject lora nodes: UNETLoader or KSampler not found in workflow');
    return;
  }

  // 查找 UNETLoader MODEL 输出当前连到的节点
  const unetModelOutput = unetNode.outputs.find(o => o.name === 'MODEL');
  const oldLinkId = unetModelOutput?.links?.[0];

  if (!oldLinkId) {
    console.warn('[imageSkill] Cannot inject lora nodes: no MODEL link from UNETLoader');
    return;
  }

  // 从 links 中定位完整的 link 条目，获取原始下游节点
  const oldLink = wf.links.find(l => l[0] === oldLinkId);
  const downstreamNodeId = oldLink ? oldLink[3] : null;
  const downstreamNode = downstreamNodeId ? wf.nodes.find(n => n.id === downstreamNodeId) : null;

  if (!downstreamNode) {
    console.warn('[imageSkill] Cannot inject lora nodes: downstream node not found for link #' + oldLinkId);
    return;
  }

  const isDirectToSampler = downstreamNodeId === samplerNode.id;
  console.log(`[imageSkill] UNETLoader MODEL → ${downstreamNode.type}#${downstreamNodeId}${isDirectToSampler ? ' (直连KSampler)' : ' (有中间节点，将保留)'}`);

  // 删除 UNETLoader → 下游节点的旧 link
  wf.links = wf.links.filter(l => l[0] !== oldLinkId);

  // 清除下游节点的 model 输入 link
  const downstreamModelInput = downstreamNode.inputs.find(inp => inp.name === 'model');
  if (downstreamModelInput) downstreamModelInput.link = null;
  console.log(`[imageSkill] Removed UNET→${downstreamNode.type}#${downstreamNodeId} link #${oldLinkId}`);

  // 生成新 ID（确保不冲突）
  let maxNodeId = Math.max(wf.last_node_id || 0, ...wf.nodes.map(n => n.id));
  let maxLinkId = Math.max(wf.last_link_id || 0, ...wf.links.map(l => l[0]));

  const loraNodeIds = [];
  const outputLinkIds = [];

  for (let i = 0; i < loras.length; i++) {
    const lora = loras[i];
    const nodeId = ++maxNodeId;
    loraNodeIds.push(nodeId);

    const inputLinkId = ++maxLinkId;
    const outputLinkId = ++maxLinkId;
    outputLinkIds.push(outputLinkId);

    const loraNode = {
      id: nodeId,
      type: 'LoraLoaderModelOnly',
      pos: [-2680 + (i * 360), -960],
      size: [280, 100],
      flags: {},
      order: 14 + i,
      mode: 0,
      inputs: [
        { localized_name: '模型', name: 'model', type: 'MODEL', link: inputLinkId },
        { localized_name: 'LoRA名称', name: 'lora_name', type: 'COMBO', widget: { name: 'lora_name' }, link: null },
        { localized_name: '模型强度', name: 'strength_model', type: 'FLOAT', widget: { name: 'strength_model' }, link: null },
      ],
      outputs: [
        { localized_name: '模型', name: 'MODEL', type: 'MODEL', links: [outputLinkId] },
      ],
      title: `lora${i + 1}`,
      properties: {
        cnr_id: 'comfy-core',
        ver: '0.24.0',
        'Node name for S&R': 'LoraLoaderModelOnly',
      },
      widgets_values: [lora.path, lora.weight ?? 1],
    };

    wf.nodes.push(loraNode);
    console.log(`[imageSkill] LoraLoaderModelOnly node added: id=${nodeId}, title="lora${i + 1}", path="${lora.path}", weight=${lora.weight ?? 1}`);

    // 上游来源：UNETLoader(第一个lora) 或 上一个 lora 节点
    const sourceNodeId = i === 0 ? unetNode.id : loraNodeIds[i - 1];
    wf.links.push([inputLinkId, sourceNodeId, 0, nodeId, 0, 'MODEL']);
  }

  // 最后一个 lora → 原始下游节点（保留用户中间链路）
  const finalLinkId = outputLinkIds[outputLinkIds.length - 1];
  const finalLoraNodeId = loraNodeIds[loras.length - 1];
  const targetSlot = downstreamNode.inputs.findIndex(inp => inp.name === 'model');

  if (targetSlot >= 0) {
    downstreamNode.inputs[targetSlot].link = finalLinkId;
  }
  wf.links.push([finalLinkId, finalLoraNodeId, 0, downstreamNode.id, targetSlot >= 0 ? targetSlot : 0, 'MODEL']);

  // 更新 workflow 元数据
  wf.last_node_id = maxNodeId;
  wf.last_link_id = maxLinkId;
}

/**
 * 最终阀门：统计 prompt 中所有 "数字+单词" 样式标签，汇总后拼到最前面
 */
function finalizeCountTags(prompt) {
  const tagRe = /\b(\d+)\s*([a-z]{3,})s?\b/gi;
  const counts = new Map();

  let m;
  while ((m = tagRe.exec(prompt)) !== null) {
    const num = parseInt(m[1], 10) || 1;
    const word = m[2].toLowerCase();
    const stem = word.endsWith('s') && word.length > 3 ? word.slice(0, -1) : word;
    counts.set(stem, (counts.get(stem) || 0) + num);
  }

  if (counts.size === 0) return prompt;

  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([stem, count]) => count === 1 ? `1${stem}` : `${count}${stem}s`);

  let cleaned = prompt.replace(/\b\d+\s*[a-z]{3,}s?\b\s*,?\s*/gi, '');
  cleaned = cleaned.replace(/^,\s*/, '').replace(/,\s*$/, '').trim();

  return parts.join(', ') + (cleaned ? ', ' + cleaned : '');
}

// ComfyUI 提交最大重试次数
const MAX_SUBMIT_RETRIES = 2;

/**
 * 提交 ComfyUI 生图（含 prompt 优化、workflow 构建、重试循环）
 *
 * @param {string}   rawPrompt               - 原始画面描述
 * @param {object}   [opts]
 * @param {Array}    [opts.loras]              - [{path, weight, triggerWord}]
 * @param {string}   [opts.customWorkflow]       - 自定义工作流文件名（单人兼容）
 * @param {string}   [opts.artist]
 * @param {number}   [opts.width]
 * @param {number}   [opts.height]
 * @param {function} [opts.onProgress]
 * @param {number}   [opts.submitRetries=2]
 * @param {boolean}  [opts.skipOptimization=false]
 * @returns {Promise<{success, images, source, promptId}>}
 */
async function submitWithRetry(rawPrompt, {
  artist, width, height, onProgress, submitRetries = MAX_SUBMIT_RETRIES,
  skipOptimization = false,
  loras, customWorkflow,
} = {}) {
  // 1. 优化 prompt
  const shouldOptimize = !skipOptimization && config.features.promptOptimize !== false;
  let finalPrompt = rawPrompt;
  if (shouldOptimize) {
    if (onProgress) onProgress({ stage: 'optimizing' });
    finalPrompt = await optimizePrompt(rawPrompt);
  } else if (!skipOptimization) {
    console.log(`[imageSkill] Prompt optimization disabled, using raw prompt directly`);
  }

  // 2. 最终阀门
  finalPrompt = finalizeCountTags(finalPrompt);
  console.log(`[imageSkill] Final prompt: ${finalPrompt}`);

  // 3. 构建 workflow
  const wf = buildWorkflow(finalPrompt, { artist, width, height, loras, customWorkflow });
  if (onProgress) onProgress({ stage: 'submitting' });

  // 4. 提交 ComfyUI，带重试循环
  let lastResult = null;

  for (let attempt = 0; attempt <= submitRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[imageSkill] ComfyUI submit retry ${attempt}/${submitRetries} — re-randomizing seed`);
      for (const node of wf.nodes || []) {
        if (node.type === 'KSampler' && node.widgets_values.length > 1 && node.widgets_values[1] === 'randomize') {
          node.widgets_values[0] = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
        }
      }
      if (onProgress) onProgress({ stage: 'retrying', attempt, maxRetries: submitRetries });
    }

    try {
      const result = await submitWorkflow(wf, (p) => {
        if (onProgress) onProgress({ stage: 'generating', ...p });
      });
      if (result.images.length > 0) {
        return { success: true, images: result.images, source: 'api', promptId: result.promptId };
      }
      lastResult = result;
    } catch (err) {
      console.error(`[imageSkill] ComfyUI attempt ${attempt + 1} failed:`, err.message);
      lastResult = { success: false, images: [], source: null, error: err.message };
    }

    if (attempt < submitRetries) {
      const waitMs = 2000 + attempt * 1000;
      console.log(`[imageSkill] Waiting ${waitMs}ms before retry...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  console.log('[imageSkill] All ComfyUI submit attempts exhausted, generation failed');
  return { success: false, images: [], source: null, error: lastResult?.error || 'All ComfyUI attempts exhausted' };
}

export async function generateImage(rawPrompt, opts = {}) {
  return submitWithRetry(rawPrompt, opts);
}

export async function generateImageRaw(rawPrompt, opts = {}) {
  return submitWithRetry(rawPrompt, opts);
}
