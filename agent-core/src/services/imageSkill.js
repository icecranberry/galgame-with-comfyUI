/**
 * 图像生成 Skill
 *
 * 流程:
 *   1. 接收 {"prompt":"..."} 中的中文画面描述
 *   2. 用提示词生成助手.txt 规则，调 DeepSeek 优化为英文 prompt
 *   3. 加载 workflow，按节点 title 注入参数（画师串/质量提示词/画面描述/宽/高）
 *   4. 提交 ComfyUI → 轮询 → 下载 base64
 *   5. 兜底: 本地 output/bot/ 文件夹
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chatSync } from '../llm/deepseek.js';
import { submitWorkflow } from './comfyClient.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, '..', '..', '..', 'workflow', 'skill外置AI智能体使用的单图工作流.json');
const RULES_PATH = path.join(__dirname, '..', '..', '..', 'workflow', '提示词生成助手.txt');

const PROMPT_PLACEHOLDER = '请输入画面描述';

// ComfyUI 提交最大重试次数（首次 + 2 次重试 = 共 3 次）
const MAX_SUBMIT_RETRIES = 2;

// 按节点 title 注入参数（而非硬编码节点 ID），工作流节点 ID 变化时不会断裂
const NODE_TITLES = {
  artist: '画师串',
  width:  '图片的宽',
  height: '图片的长',
  prompt: '画面描述',
};

// 缓存规则文本
let _rulesCache = '';

function loadRules() {
  if (_rulesCache) return _rulesCache;
  if (!fs.existsSync(RULES_PATH)) {
    console.warn('[imageSkill] 提示词生成助手.txt not found, using raw prompt');
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
    ], { temperature: 0.5, max_tokens: 1024 });

    const cleaned = result.trim();
    console.log(`[imageSkill] Prompt optimized: "${rawPrompt.slice(0, 40)}..." → "${cleaned.slice(0, 60)}..."`);
    return cleaned || rawPrompt;
  } catch (err) {
    console.error('[imageSkill] Prompt optimization failed:', err.message);
    return rawPrompt;
  }
}

/**
 * 直接使用已优化好的 prompt 生成图像（跳过 DeepSeek 优化步骤）
 *
 * 用于测试画风等场景：prompt 已经是最终英文形式，直接注入 workflow。
 * 不写数据库，仅返回 base64 图片数据。
 */
export async function generateImageRaw(rawPrompt, { artist, width, height, onProgress } = {}) {
  // 构建 workflow（跳过 DeepSeek 优化，直接注入原始 prompt）
  const wf = buildWorkflow(rawPrompt, { artist, width, height });
  if (onProgress) onProgress({ stage: 'submitting' });

  return submitWithRetry(wf, { onProgress });
}

/**
 * 构建注入参数后的 workflow 副本（种子每次随机）
 */
function buildWorkflow(promptText, overrides = {}) {
  if (!fs.existsSync(WORKFLOW_PATH)) {
    throw new Error(`Workflow not found: ${WORKFLOW_PATH}`);
  }

  const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
  const wf = JSON.parse(JSON.stringify(workflow));

  const defaults = {
    [NODE_TITLES.artist]: overrides.artist ?? config.comfyui.artist,
    [NODE_TITLES.width]:  overrides.width  ?? config.comfyui.width,
    [NODE_TITLES.height]: overrides.height ?? config.comfyui.height,
  };

  for (const node of wf.nodes || []) {
    if (!Array.isArray(node.widgets_values)) continue;

    // KSampler seed 随机化："randomize" 是 GUI 概念，API 只看数字
    if (node.type === 'KSampler' && node.widgets_values.length > 1 && node.widgets_values[1] === 'randomize') {
      node.widgets_values[0] = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    }

    // 画面描述节点：替换占位符
    if (node.title === NODE_TITLES.prompt) {
      const idx = node.widgets_values.findIndex(
        v => typeof v === 'string' && v.includes(PROMPT_PLACEHOLDER)
      );
      if (idx >= 0) {
        node.widgets_values[idx] = promptText;
        console.log(`[imageSkill] Node "${node.title}" (id=${node.id}) prompt injected`);
        continue;
      }
    }

    // 画师串 / 宽 / 高：替换第一个 widget
    const val = defaults[node.title];
    if (val !== undefined && node.widgets_values.length > 0) {
      node.widgets_values[0] = val;
      console.log(`[imageSkill] Node "${node.title}" (id=${node.id}) = ${val}`);
    }
  }

  return wf;
}

/**
 * 提交 workflow 到 ComfyUI，带重试循环
 *
 * 最多 submitRetries 次尝试（默认 3 次 = 首次 + 2 次重试）。
 * 重试条件：WebSocket 通道断开/卡死（comfyClient 内 30s 无活动判定）。
 * 每次重试重新随机种子、重新提交。
 *
 * @param {object} wf — 已注入参数的工作流
 * @param {object} opts
 * @param {function} opts.onProgress — 进度回调，重试时 stage='retrying'
 * @param {number} opts.submitRetries — 最大提交次数
 * @returns {Promise<{success, images, source, promptId}>}
 */
async function submitWithRetry(wf, { onProgress, submitRetries = MAX_SUBMIT_RETRIES } = {}) {
  let lastResult = null;

  for (let attempt = 0; attempt <= submitRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[imageSkill] ComfyUI submit retry ${attempt}/${submitRetries} — re-randomizing seed`);
      // 重试时重新随机种子
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

    // 如果还有重试次数，短暂等待后再试
    if (attempt < submitRetries) {
      const waitMs = 2000 + attempt * 1000; // 递增等待：2s → 3s
      console.log(`[imageSkill] Waiting ${waitMs}ms before retry...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  // 全部尝试耗尽，返回失败
  console.log('[imageSkill] All ComfyUI submit attempts exhausted, generation failed');
  return { success: false, images: [], source: null, error: lastResult?.error || 'All ComfyUI attempts exhausted' };
}

/**
 * 执行图像生成
 */
export async function generateImage(rawPrompt, { onProgress } = {}) {
  // 1. 优化 prompt（只做一次，重试时复用；可通过功能开关跳过）
  const shouldOptimize = config.features.promptOptimize !== false;
  let finalPrompt = rawPrompt;
  if (shouldOptimize) {
    if (onProgress) onProgress({ stage: 'optimizing' });
    finalPrompt = await optimizePrompt(rawPrompt);
  } else {
    console.log(`[imageSkill] Prompt optimization disabled, using raw prompt directly`);
  }

  // 2. 构建 workflow + 带重试提交 ComfyUI
  const wf = buildWorkflow(finalPrompt);
  if (onProgress) onProgress({ stage: 'submitting' });

  return submitWithRetry(wf, { onProgress });
}

