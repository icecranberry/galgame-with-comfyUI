/**
 * services/imageLabScene.js
 * 图片实验室「自由画面描述」链路：分层 LLM 把中文画面描述完善为生图 prompt，
 * 描述中提到的角色/用户自动注入外观（角色附带其 LoRA）。
 * 路由层（/api/images/test-style）与 Cortico 桥（/api/cortico/draw）共用。
 */
import { getDb, getSystemRulesWithWorld, getWorldSetting } from '../db/index.js';
import { generateImageRaw, getLastWorkflowMode } from './imageSkill.js';
import { saveBase64Image } from './imagePaths.js';
import { RAG_TIMEOUT_FAST_MS } from './imagePromptKnowledge.js';
import { chatSync } from './lorebook/runtime.js';
import { IMAGE_PROMPT_RULE, getWorldIntegrationRule } from '../builtinRules.js';
import { matchAll } from './characterSearch.js';
import { getUserName, matchUser } from './userSearch.js';
import { parseLoras } from '../maibot-bridge/generate.js';
import { extractImagePromptResponse } from './imagePromptResponse.js';
import { buildImageCrossRefInfo, buildUserImageCrossRefInfo } from './characterPersona.js';
import { config } from '../config.js';

/**
 * 自由画面描述 → 分层 system LLM 生成生图 prompt（对齐私聊生图链路）：
 *   system0 = 破甲 + 世界观 / system1 = 世界观强化 / system2 = 生图规则
 *   system3 = 画面描述中匹配到的角色（注入外观描述，返回值附带其 loras）
 *             以及画面描述中提到的用户本人（只注入其自述资料，不参与 loras）
 */
export async function generateScenePrompt(desc) {
  const msgs = [{ role: 'system', content: getSystemRulesWithWorld() || '你是一个角色扮演 AI。' }];
  try {
    if (getWorldSetting()) msgs.push({ role: 'system', content: getWorldIntegrationRule('photo') });
  } catch { /* 规则缺失非致命 */ }
  msgs.push({ role: 'system', content: `【生图规则】\n${IMAGE_PROMPT_RULE.rule_content}` });

  const loras = [];
  const crossBlocks = [];
  const matched = matchAll(desc);
  if (matched.length > 0) {
    const db = getDb();
    const chars = matched.map(m =>
      db.prepare('SELECT id, display_name, base_prompt, loras FROM characters WHERE id = ?').get(m.id)
    ).filter(Boolean);
    crossBlocks.push(...chars.map(c => `[${c.display_name}]\n${buildImageCrossRefInfo(c)}`));
    loras.push(...chars.flatMap(c => parseLoras(c)));
  }
  // 画面描述里提到用户本人时同样注入其资料（用户不是角色：没有 id、没有 LoRA）
  if (matchUser(desc)) {
    crossBlocks.push(`[${getUserName()}]\n${buildUserImageCrossRefInfo()}`);
  }
  if (crossBlocks.length > 0) {
    msgs.push({
      role: 'system',
      content: `【画面交叉参考】以下角色/用户的身份与外观信息必须体现在生成的画面中：\n\n${crossBlocks.join('\n\n')}`,
    });
  }

  msgs.push({
    role: 'user',
    content: `【画面描述】\n${desc}\n\n【当前任务】\n根据上面的画面描述，直接输出对应的英文生图 prompt（严格遵循【生图规则】）。不要任何格式包装或额外文字。`,
  });

  const raw = await chatSync(msgs, { temperature: 0.7, label: '画风测试' });
  const prompt = extractImagePromptResponse(raw);
  if (!prompt) throw new Error('模型未返回有效的提示词');
  return { prompt, loras };
}

/**
 * 泛用画图任务：落 image_tasks 表供调用方轮询（与 maibot 桥 startImageTask 同骨架），
 * prompt 生成走 generateScenePrompt，生图参数沿用实验室 chat 模式默认配置。
 */
export function startLabImageTask({ conversationId, desc }) {
  const db = getDb();
  const taskResult = db.prepare(
    `INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status)
     VALUES (?, ?, ?, 'running')`
  ).run(conversationId, desc, desc);
  const taskId = taskResult.lastInsertRowid;

  (async () => {
    const { prompt, loras } = await generateScenePrompt(desc);
    const result = await generateImageRaw(prompt, {
      ragQuery: desc,
      ragTimeoutMs: RAG_TIMEOUT_FAST_MS,
      alreadyPrepared: false,
      artist: config.comfyui.artist,
      width: config.comfyui.width,
      height: config.comfyui.height,
      scene: 'chat',
      persistPreparation: false,
      ...(loras.length > 0 ? { loras } : {}),
    });
    if (result.success && result.images.length > 0) {
      const urls = [];
      for (const img of result.images) {
        const filename = `${Date.now()}_${img.filename || 'comfy.png'}`;
        const url = saveBase64Image('chat', filename, img.base64);
        urls.push(url);
        img.url = url;
      }
      db.prepare(
        `UPDATE image_tasks SET status='done', prompt_refined=?, output_paths=?, workflow_template=?, finished_at=datetime('now') WHERE id=?`
      ).run(result.promptRefined || prompt, JSON.stringify(urls), result.wfMode, taskId);
      console.log(`[image-lab] task ${taskId} done: ${urls.length} image(s)`);
    } else {
      db.prepare(
        `UPDATE image_tasks SET status='failed', error_message=?, workflow_template=?, finished_at=datetime('now') WHERE id=?`
      ).run(result.error || 'No images generated', getLastWorkflowMode(), taskId);
      console.error(`[image-lab] task ${taskId} failed: ${result.error}`);
    }
  })().catch((err) => {
    db.prepare(
      `UPDATE image_tasks SET status='failed', error_message=?, workflow_template=?, finished_at=datetime('now') WHERE id=?`
    ).run(err.message, getLastWorkflowMode(), taskId);
    console.error(`[image-lab] task ${taskId} error:`, err.message);
  });

  return taskId;
}
