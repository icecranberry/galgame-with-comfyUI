/**
 * 图像生成 Skill
 *
 * 流程:
 *   1. 加载 GUI workflow（AI智能体使用的单图工作流.json）
 *   2. 找到节点 93 (JjkText)，替换 widgets_values[0] 中的 "请参考文本"
 *   3. 通过 extra_data.extra_pnginfo.workflow 提交到 ComfyUI /api/prompt
 *   4. 轮询 /history 获取图片 base64
 *   5. 兜底: 扫描本地 output/bot/ 文件夹
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { submitWorkflow, findLatestImageInFolder } from './comfyClient.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, '..', '..', '..', 'workflow', 'AI智能体使用的单图工作流.json');

const PROMPT_PLACEHOLDER = '请参考文本';
const OUTPUT_DIR = config.comfyui.outputDir || 'D:/AI/ComfyUI-aki-v3/ComfyUI/output';
const OUTPUT_SUBFOLDER = 'bot';

export async function generateImage(prompt, { onProgress } = {}) {
  if (!fs.existsSync(WORKFLOW_PATH)) {
    throw new Error(`Workflow not found: ${WORKFLOW_PATH}`);
  }

  const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
  const wf = JSON.parse(JSON.stringify(workflow));

  // 替换节点 93 的 widgets_values[0]
  let found = false;
  for (const node of wf.nodes || []) {
    if (!Array.isArray(node.widgets_values)) continue;
    const idx = node.widgets_values.findIndex(
      v => typeof v === 'string' && v.includes(PROMPT_PLACEHOLDER)
    );
    if (idx >= 0) {
      node.widgets_values[idx] = prompt;
      found = true;
      console.log(`[imageSkill] Prompt injected into node ${node.id}: "${prompt.slice(0, 60)}..."`);
      break;
    }
  }
  if (!found) throw new Error(`Placeholder "${PROMPT_PLACEHOLDER}" not found in workflow`);

  // 提交
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

  return fallbackFromFolder();
}

function fallbackFromFolder() {
  const latest = findLatestImageInFolder(OUTPUT_DIR, OUTPUT_SUBFOLDER);
  if (!latest) return { success: false, images: [], source: null, error: 'No image found' };
  try {
    const buffer = fs.readFileSync(latest.path);
    const ext = path.extname(latest.name).slice(1) || 'png';
    const base64 = `data:image/${ext};base64,${buffer.toString('base64')}`;
    return { success: true, images: [{ base64, filename: latest.name }], source: 'folder' };
  } catch (err) {
    return { success: false, images: [], source: null, error: err.message };
  }
}
