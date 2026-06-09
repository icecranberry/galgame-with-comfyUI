/**
 * 图像生成 Skill
 *
 * 流程:
 *   1. 接收 <prompt> 中的中文画面描述
 *   2. 用提示词生成助手.txt 规则，调 DeepSeek 优化为英文 prompt
 *   3. 加载 workflow，替换节点 93 的 "请参考文本"
 *   4. 提交 ComfyUI → 轮询 → 下载 base64
 *   5. 兜底: 本地 output/bot/ 文件夹
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chatSync } from '../llm/deepseek.js';
import { submitWorkflow, findLatestImageInFolder } from './comfyClient.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, '..', '..', '..', 'workflow', 'skill外置AI智能体使用的单图工作流.json');
const RULES_PATH = path.join(__dirname, '..', '..', '..', 'workflow', '提示词生成助手.txt');

const PROMPT_PLACEHOLDER = '请参考文本';
const OUTPUT_DIR = config.comfyui.outputDir || 'D:/AI/ComfyUI-aki-v3/ComfyUI/output';
const OUTPUT_SUBFOLDER = 'bot';

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
    ], { temperature: 0.3, max_tokens: 1024 });

    const cleaned = result.trim();
    console.log(`[imageSkill] Prompt optimized: "${rawPrompt.slice(0, 40)}..." → "${cleaned.slice(0, 60)}..."`);
    return cleaned || rawPrompt;
  } catch (err) {
    console.error('[imageSkill] Prompt optimization failed:', err.message);
    return rawPrompt;
  }
}

/**
 * 执行图像生成
 */
export async function generateImage(rawPrompt, { onProgress } = {}) {
  // 1. 优化 prompt
  if (onProgress) onProgress({ stage: 'optimizing' });
  const optimizedPrompt = await optimizePrompt(rawPrompt);

  // 2. 加载 workflow
  if (!fs.existsSync(WORKFLOW_PATH)) {
    throw new Error(`Workflow not found: ${WORKFLOW_PATH}`);
  }

  const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
  const wf = JSON.parse(JSON.stringify(workflow));

  // 3. 注入优化后的 prompt + 画师串 + 宽高
  const nodeUpdates = {
    96: { value: config.comfyui.artist, label: 'artist' },          // 画师串
    97: { value: config.comfyui.width, label: 'width' },            // 宽度
    98: { value: config.comfyui.height, label: 'height' },          // 高度
    93: { value: optimizedPrompt, label: 'prompt' },                // 提示词（取最后一个匹配）
  };

  for (const node of wf.nodes || []) {
    if (!Array.isArray(node.widgets_values)) continue;

    if (node.id === 93) {
      // Prompt 节点: 先检查占位符再检查更新映射
      const idx = node.widgets_values.findIndex(
        v => typeof v === 'string' && v.includes(PROMPT_PLACEHOLDER)
      );
      if (idx >= 0) {
        node.widgets_values[idx] = optimizedPrompt;
        console.log(`[imageSkill] Node ${node.id} prompt injected`);
        continue;
      }
    }

    const update = nodeUpdates[node.id];
    if (update && node.widgets_values.length > 0) {
      node.widgets_values[0] = update.value;
      console.log(`[imageSkill] Node ${node.id} ${update.label} = ${update.value}`);
    }
  }

  // 4. 提交 ComfyUI
  if (onProgress) onProgress({ stage: 'submitting' });

  try {
    const result = await submitWorkflow(wf, (p) => {
      if (onProgress) onProgress({ stage: 'generating', ...p });
    });
    if (result.images.length > 0) {
      return { success: true, images: result.images, source: 'api', promptId: result.promptId };
    }
  } catch (err) {
    console.error('[imageSkill] ComfyUI error:', err.message);
  }

  // 尝试 fallback：从 ComfyUI output 文件夹直接读最新图片
  console.log('[imageSkill] Trying fallback from ComfyUI output folder...');
  const fallback = fallbackFromFolder();
  if (fallback.success) console.log('[imageSkill] Fallback succeeded:', fallback.images[0]?.filename);
  else console.warn('[imageSkill] Fallback also failed:', fallback.error);
  return fallback;
}

function fallbackFromFolder() {
  // 先搜 bot/ 子文件夹，再搜 output 根目录
  for (const subfolder of [OUTPUT_SUBFOLDER, '.']) {
    const latest = findLatestImageInFolder(OUTPUT_DIR, subfolder);
    if (!latest) continue;
    try {
      const buffer = fs.readFileSync(latest.path);
      const ext = path.extname(latest.name).slice(1) || 'png';
      const base64 = `data:image/${ext};base64,${buffer.toString('base64')}`;
      console.log(`[imageSkill] Found in ${subfolder}/: ${latest.name}`);
      return { success: true, images: [{ base64, filename: latest.name }], source: 'folder' };
    } catch (err) {
      console.warn(`[imageSkill] Read failed for ${latest.path}:`, err.message);
    }
  }
  return { success: false, images: [], source: null, error: 'No image found' };
}
