/**
 * maibot-bridge/generate.js
 * 生图任务：复用主聊天流的 generateImage + saveBase64Image，落 image_tasks 表供插件轮询。
 */
import { getDb } from '../db/index.js';
import { generateImage, getLastWorkflowMode } from '../services/imageSkill.js';
import { charArtistOverride } from '../services/characterImageOpts.js';
import { saveBase64Image } from '../services/imagePaths.js';
import { RAG_TIMEOUT_FAST_MS } from '../services/imagePromptKnowledge.js';

export function parseLoras(char) {
  if (!char?.loras) return [];
  try {
    const parsed = typeof char.loras === 'string' ? JSON.parse(char.loras) : char.loras;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(l => l.path && typeof l.path === 'string')
      .map(l => ({
        path: l.path,
        weight: typeof l.weight === 'number' ? l.weight : 0.6,
        triggerWord: l.triggerWord || '',
      }));
  } catch {
    return [];
  }
}

export function startImageTask({ character, conversationId, prompt, assistantMsgId = null }) {
  const db = getDb();
  const taskResult = db.prepare(
    `INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status)
     VALUES (?, ?, ?, 'running')`
  ).run(conversationId, prompt, prompt);
  const taskId = taskResult.lastInsertRowid;

  const loraOpts = {};
  const loras = parseLoras(character);
  if (character?.custom_workflow) loraOpts.customWorkflow = character.custom_workflow;
  if (loras.length > 0) loraOpts.loras = loras;
  const charArtist = charArtistOverride(character);
  if (charArtist !== null) loraOpts.artist = charArtist;

  generateImage(prompt, { scene: 'chat', ragTimeoutMs: RAG_TIMEOUT_FAST_MS, ...loraOpts })
    .then((result) => {
      if (result.success && result.images.length > 0) {
        const urls = [];
        for (const img of result.images) {
          const ts = Date.now();
          const filename = `${ts}_${img.filename || 'comfy.png'}`;
          const url = saveBase64Image('chat', filename, img.base64);
          urls.push(url);
          img.url = url;
        }
        db.prepare(
          `UPDATE image_tasks SET status='done', prompt_refined=?, output_paths=?, workflow_template=?, finished_at=datetime('now') WHERE id=?`
        ).run(result.promptRefined || prompt, JSON.stringify(urls), result.wfMode, taskId);
        if (assistantMsgId) {
          db.prepare(`UPDATE messages SET images=? WHERE id=?`).run(JSON.stringify(urls), assistantMsgId);
        }
        console.log(`[maibot-bridge] task ${taskId} done: ${urls.length} image(s)`);
      } else {
        db.prepare(
          `UPDATE image_tasks SET status='failed', error_message=?, workflow_template=?, finished_at=datetime('now') WHERE id=?`
        ).run(result.error || 'No images generated', getLastWorkflowMode(), taskId);
        console.error(`[maibot-bridge] task ${taskId} failed: ${result.error}`);
      }
    })
    .catch((err) => {
      db.prepare(
        `UPDATE image_tasks SET status='failed', error_message=?, workflow_template=?, finished_at=datetime('now') WHERE id=?`
      ).run(err.message, getLastWorkflowMode(), taskId);
      console.error(`[maibot-bridge] task ${taskId} error:`, err.message);
    });

  return taskId;
}

export function getTask(taskId) {
  const db = getDb();
  const task = db.prepare(
    `SELECT id, status, output_paths, error_message FROM image_tasks WHERE id = ?`
  ).get(Number(taskId));
  if (!task) return null;
  const paths = task.output_paths ? JSON.parse(task.output_paths) : [];
  return {
    id: task.id,
    status: task.status,
    image: paths.length > 0 ? { url: paths[0] } : null,
    error: task.error_message || null,
  };
}
