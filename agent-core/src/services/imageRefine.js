/**
 * 放大细化（HiresFix）服务
 *
 * 流程:
 *   1. 读取原图文件 → 上传到 ComfyUI input 目录
 *   2. 加载 workflow/放大细化工作流.json（仅 ComfyUI 官方节点，像素放大而非 latent 放大）:
 *      LoadImage → ImageScaleToMaxDimension(按长边像素放大，默认 lanczos/长边2400，不固定倍数)
 *      → VAEEncode → KSampler(图生图低重绘, 默认 40步/cfg3.0/denoise0.35) → VAEDecode → PreviewImage
 *   3. 继承原图的模型加载器(UNET/CLIP/VAE)、负面提示词、提示词链(画面描述/质量提示词/画师串/lora触发词)，
 *      以及与原图一致的 LoRA 链（全局画风 LoRA 按场景过滤 + 角色 LoRA），
 *      再追加 HiresFix 细化专用 LoRA（设置页单独配置）到链尾
 *   4. 提交 ComfyUI → 下载结果 → 原子覆盖原文件
 *
 * KSampler 采样参数（步数/cfg/denoise/采样器）与放大长边均以细化工作流文件中的设定为准，
 * 可直接在 ComfyUI 中编辑该文件调整；不从原图工作流继承（原图 denoise=1 全重绘，步数/cfg
 * 也按细化调优而非沿用生图值）。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { submitWorkflow, uploadImage, apiToGui } from './comfyClient.js';
import { config } from '../config.js';
import {
  HIRES_WORKFLOW, ACTIVE_WORKFLOW, PRO_WORKFLOW, autoRestoreMissing,
} from './workflowTemplates.js';
import { injectLoraNodes, NODE_TITLES } from './imageSkill.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');

const PROMPT_PLACEHOLDER = '请输入画面描述';

function hiresPath() { return path.join(WORKFLOW_DIR, HIRES_WORKFLOW); }

/** 与 imageSkill.resolveWorkflowPath 一致的模式兜底：无记录时按全局模式 + 场景映射 */
function fallbackModeForScene(scene) {
  const mode = config.workflow?.mode || 'turbo';
  if (mode === 'turbo' || mode === 'base') return mode;
  const scenePref = config.workflow?.scene?.[scene] || 'turbo';
  return scenePref === 'base' ? 'base' : 'turbo';
}

/** 加载生成原图时使用的源工作流模板（自定义 > 显式模式 > 按场景兜底），用于继承参数 */
function loadSourceWorkflow({ sourceMode, customWorkflow, scene } = {}) {
  let p = null;
  let resolvedMode = null;
  if (customWorkflow && fs.existsSync(path.join(WORKFLOW_DIR, customWorkflow))) {
    p = path.join(WORKFLOW_DIR, customWorkflow);
  } else {
    resolvedMode = (sourceMode === 'base' || sourceMode === 'turbo')
      ? sourceMode
      : fallbackModeForScene(scene);
    p = resolvedMode === 'base' ? path.join(WORKFLOW_DIR, PRO_WORKFLOW) : path.join(WORKFLOW_DIR, ACTIVE_WORKFLOW);
  }
  if (!fs.existsSync(p)) return { wf: null, resolvedMode };
  try {
    const wf = apiToGui(JSON.parse(fs.readFileSync(p, 'utf8')));
    return { wf: Array.isArray(wf?.nodes) ? wf : null, resolvedMode };
  } catch {
    return { wf: null, resolvedMode };
  }
}

/** 顺着 link 找到 KSampler negative 输入源头的 CLIPTextEncode 节点（跳过 Reroute） */
function findNegativeEncodeNode(wf) {
  const sampler = wf.nodes.find(n => n.type === 'KSampler' || n.type === 'KSamplerAdvanced');
  if (!sampler) return null;
  const negInp = (sampler.inputs || []).find(i => i.name === 'negative');
  let linkId = negInp?.link;
  for (let hop = 0; linkId != null && hop < 10; hop++) {
    const link = (wf.links || []).find(l => l[0] === linkId);
    if (!link) return null;
    const src = wf.nodes.find(n => n.id === link[1]);
    if (!src) return null;
    if (src.type === 'Reroute') { linkId = src.inputs?.[0]?.link; continue; }
    return src.type === 'CLIPTextEncode' ? src : null;
  }
  return null;
}

/**
 * 构建注入参数后的放大细化工作流
 *
 * @param {string} promptText - 原图的最终提示词（prompt_refined）
 * @param {object} [overrides]
 * @param {string} [overrides.uploadFilename] - 已上传到 ComfyUI input 的原图文件名
 * @param {string} [overrides.artist]         - 画师串
 * @param {Array}  [overrides.loras]          - 角色 LoRA [{path, weight, triggerWord}]
 * @param {string} [overrides.customWorkflow] - 原图使用的自定义工作流文件名
 * @param {string} [overrides.sourceMode]     - 原图工作流模式 'turbo' | 'base'（image_tasks.workflow_template）
 * @param {string} [overrides.scene]          - 全局 LoRA 场景过滤 + 无模式记录时的工作流兜底
 * @returns {{wf: object, wfPath: string}}
 */
export function buildHiresWorkflow(promptText, overrides = {}) {
  if (!fs.existsSync(hiresPath())) autoRestoreMissing();
  const wf = JSON.parse(fs.readFileSync(hiresPath(), 'utf8'));
  const srcResult = loadSourceWorkflow(overrides);
  const src = srcResult.wf;

  const srcLoader = (type) => {
    if (!src) return null;
    const node = src.nodes.find(n => n.type === type);
    return Array.isArray(node?.widgets_values) ? node.widgets_values : null;
  };
  const srcNegative = (() => {
    if (!src) return null;
    const node = findNegativeEncodeNode(src);
    const text = Array.isArray(node?.widgets_values) ? node.widgets_values[0] : null;
    return typeof text === 'string' ? text : null;
  })();

  // LoRA 链合并（与原图生成时一致的全量继承 + 细化专用追加）：
  //   全局画风 LoRA(按场景过滤) → 角色 LoRA → HiresFix细化LoRA(追加在链尾)
  //   同 path 后者覆盖前者（细化配置的权重优先，并移至链尾位置）
  const currentScene = overrides.scene;
  const globalLoras = (config.comfyui.globalLora || []).filter(l => {
    if (!l.path || typeof l.path !== 'string') return false;
    if (l.enabled === false) return false;
    if (!currentScene) return true;
    if (!Array.isArray(l.scenes) || l.scenes.length === 0) return true;
    return l.scenes.includes(currentScene);
  });
  const charLoras = (overrides.loras || []).filter(l => l.path && typeof l.path === 'string');
  const hiresLoras = (config.comfyui.hiresLora || []).filter(
    l => l.path && typeof l.path === 'string' && l.enabled !== false
  );
  const loraChain = new Map();
  for (const l of [...globalLoras, ...charLoras, ...hiresLoras]) {
    loraChain.delete(l.path);
    loraChain.set(l.path, l);
  }
  const loras = [...loraChain.values()];
  const hasLoras = loras.length > 0;
  if (globalLoras.length || charLoras.length || hiresLoras.length) {
    console.log(`[imageRefine] LoRA chain: ${globalLoras.length} global + ${charLoras.length} char + ${hiresLoras.length} hires → ${loras.length} after dedup`);
  }
  const artist = overrides.artist ?? config.comfyui.artist;

  const loaderCopies = {
    UNETLoader: srcLoader('UNETLoader'),
    CLIPLoader: srcLoader('CLIPLoader'),
    VAELoader: srcLoader('VAELoader'),
  };

  for (const node of wf.nodes || []) {
    if (!Array.isArray(node.widgets_values)) continue;

    // 原图文件名注入 LoadImage
    if (node.type === 'LoadImage' && overrides.uploadFilename) {
      node.widgets_values[0] = overrides.uploadFilename;
      continue;
    }

    // KSampler: 种子随机；步数/cfg/denoise 等采样参数以细化工作流文件设定为准（不继承原图）
    if (node.type === 'KSampler') {
      if (node.widgets_values[1] === 'randomize') {
        node.widgets_values[0] = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
      }
      continue;
    }

    // 模型加载器整体继承（模型名/数据类型与原图完全一致）
    const copied = loaderCopies[node.type];
    if (copied && copied.length > 0) {
      node.widgets_values = [...copied];
      continue;
    }

    // 负面提示词继承
    if (node.type === 'CLIPTextEncode' && srcNegative !== null && node === findNegativeEncodeNode(wf)) {
      node.widgets_values[0] = srcNegative;
      continue;
    }

    // lora触发词节点：注入所有 lora 的 triggerWord 拼接
    if (node.title === NODE_TITLES.loraTrigger && hasLoras) {
      const triggerWords = loras.map(l => l.triggerWord || '').filter(Boolean).join(', ');
      if (triggerWords) node.widgets_values[0] = triggerWords;
      continue;
    }

    // 画面描述节点：替换占位符，无占位符则写入第一个 widget
    if (node.title === NODE_TITLES.prompt) {
      const idx = node.widgets_values.findIndex(v => typeof v === 'string' && v.includes(PROMPT_PLACEHOLDER));
      if (idx >= 0) node.widgets_values[idx] = promptText;
      else if (node.widgets_values.length > 0) node.widgets_values[0] = promptText;
      continue;
    }

    // 画师串：替换第一个 widget
    if (node.title === NODE_TITLES.artist && node.widgets_values.length > 0) {
      node.widgets_values[0] = artist;
    }
  }

  // 与原图一致的 LoRA 链: UNETLoader → Lora1 → ... → KSampler
  if (hasLoras) injectLoraNodes(wf, loras);

  const srcLabel = overrides.customWorkflow
    || (srcResult.resolvedMode === 'base' ? PRO_WORKFLOW : ACTIVE_WORKFLOW);
  console.log(`[imageRefine] Hires workflow built: ${HIRES_WORKFLOW}${src ? ` (params inherited from ${srcLabel})` : ' (source workflow unavailable, template defaults)'}`);
  return { wf, wfPath: hiresPath() };
}

/**
 * 执行放大细化并覆盖保存
 *
 * @param {object} opts
 * @param {string} opts.filePath      - 原图绝对路径（细化结果将覆盖此文件）
 * @param {string} [opts.outPath]     - 输出路径覆盖（测试用，默认 filePath）
 * @param {string} opts.promptText    - 原图最终提示词
 * @param {string} [opts.artist]
 * @param {Array}  [opts.loras]       - 角色 LoRA（全局画风 LoRA 与 HiresFix 细化 LoRA 由配置自动合并）
 * @param {string} [opts.customWorkflow]
 * @param {string} [opts.sourceMode]
 * @param {string} [opts.scene]         - 全局 LoRA 场景过滤 + 无模式记录时的场景兜底
 * @param {function} [opts.onProgress]
 * @returns {Promise<{success: boolean, wfPath: string, filename: string}>}
 */
export async function refineImage({
  filePath, outPath, promptText, artist, loras, customWorkflow, sourceMode, scene, onProgress,
}) {
  const buf = fs.readFileSync(filePath);
  const ext = (path.extname(filePath) || '.png').toLowerCase();
  const uploadFilename = await uploadImage(buf, `linshe-hires-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`);
  console.log(`[imageRefine] Uploaded source image to ComfyUI: ${uploadFilename} (${(buf.length / 1024).toFixed(0)}KB)`);

  const { wf } = buildHiresWorkflow(promptText, {
    uploadFilename, artist, loras, customWorkflow, sourceMode, scene,
  });

  if (onProgress) onProgress({ stage: 'submitting' });
  const result = await submitWorkflow(wf, onProgress);
  if (!result.images || result.images.length === 0) {
    throw new Error('ComfyUI 未返回细化结果');
  }

  const img = result.images[0];
  const base64 = img.base64.replace(/^data:image\/\w+;base64,/, '');
  const target = outPath || filePath;
  const tmpPath = target + '.refining';
  fs.writeFileSync(tmpPath, Buffer.from(base64, 'base64'));
  fs.renameSync(tmpPath, target);

  console.log(`[imageRefine] Refined image saved (overwrote): ${target}`);
  return { success: true, wfPath: hiresPath(), filename: img.filename };
}
