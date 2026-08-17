/**
 * 图片编辑任务（重新生成 / HiresFix 细化）后台任务管理器
 *
 * 流程:
 *   1. 提交任务 → 立刻返回 task_id
 *   2. 后台运行 regenerate / refine，结果写入 data/images/.pending/ 暂存
 *   3. SSE 推送 start / progress / done / error
 *   4. 前端确认后 apply（原子覆盖原图）或 discard / rerun
 */

import fs from 'fs';
import path from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { getPendingDir } from './imagePaths.js';
import { broadcast } from './unifiedStreamBus.js';

const tasks = new Map();

const STALE_MS = 24 * 60 * 60 * 1000;

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeProgress(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    progress: typeof p.progress === 'number' ? p.progress : (p.phase === 'done' ? 1 : null),
    totalSteps: p.totalSteps ?? null,
    stage: p.stage ?? null,
    phase: p.phase ?? null,
  };
}

function serializeTask(task) {
  return {
    id: task.id,
    action: task.action,
    url: task.url,
    status: task.status,
    previewUrl: task.previewUrl || null,
    token: task.token,
    progress: task.progress,
    error: task.error || null,
    createdAt: task.createdAt,
  };
}

function cleanupStageFiles(stageBase) {
  const dir = getPendingDir();
  if (!fs.existsSync(dir)) return;
  const prefix = path.basename(stageBase) + '.';
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(prefix)) {
      try { fs.unlinkSync(path.join(dir, name)); } catch {}
    }
  }
}

/**
 * 提交一个后台图片编辑任务。
 *
 * @param {object} spec
 * @param {'regenerate'|'upscale'} spec.action
 * @param {string} spec.url          - 原图 URL（不带 query）
 * @param {string} spec.targetPath   - 原图绝对路径（确认覆盖时写入）
 * @param {Function} spec.run        - async ({ stageBase, onProgress }) => { filename }
 *                                     必须把生成结果写到 `${stageBase}.${ext}` 并返回文件名
 * @returns {object} 任务记录
 */
export function startEditTask({ action, url, targetPath, run }) {
  const id = randomUUID();
  const token = randomBytes(12).toString('hex');
  const stageBase = path.join(getPendingDir(), `${id}-${token}`);
  fs.mkdirSync(path.dirname(stageBase), { recursive: true });

  const task = {
    id, action, url, targetPath, token, stageBase,
    status: 'running', progress: null, previewUrl: null, error: null, createdAt: Date.now(),
  };
  tasks.set(id, task);
  broadcast('image_edit_task_start', serializeTask(task));

  Promise.resolve()
    .then(() => run({
      stageBase,
      onProgress: (p) => {
        task.progress = normalizeProgress(p);
        broadcast('image_edit_task_progress', serializeTask(task));
      },
    }))
    .then(({ filename }) => {
      if (!filename) throw new Error('task produced no staged file');
      task.pendingPath = path.join(getPendingDir(), filename);
      task.previewUrl = `/images/.pending/${filename}`;
      task.status = 'pending_confirm';
      task.progress = null;
      broadcast('image_edit_task_done', serializeTask(task));
    })
    .catch((err) => {
      cleanupStageFiles(task.stageBase);
      task.status = 'failed';
      task.error = err?.message || String(err);
      broadcast('image_edit_task_error', serializeTask(task));
    });

  return task;
}

export function listEditTasks() {
  return [...tasks.values()]
    .filter(t => t.status === 'running' || t.status === 'pending_confirm' || t.status === 'failed')
    .map(serializeTask);
}

export function getEditTask(id) {
  return tasks.get(id) || null;
}

export async function applyEditTask(id, token) {
  const task = tasks.get(id);
  if (!task) throw httpError('图片编辑任务不存在', 404);
  if (task.status !== 'pending_confirm') throw httpError('任务尚未完成，无法确认覆盖', 409);
  if (task.token !== token) throw httpError('任务凭证无效', 403);
  if (!task.pendingPath || !fs.existsSync(task.pendingPath)) throw httpError('暂存文件不存在', 404);

  fs.mkdirSync(path.dirname(task.targetPath), { recursive: true });
  fs.renameSync(task.pendingPath, task.targetPath);
  task.status = 'applied';
  tasks.delete(id);

  try {
    const { invalidateGalleryCache } = await import('../routes/images.js');
    invalidateGalleryCache();
  } catch {}

  return task;
}

export function discardEditTask(id, token) {
  const task = tasks.get(id);
  if (!task) throw httpError('图片编辑任务不存在', 404);
  if (task.status === 'running') throw httpError('任务运行中，暂不能取消', 409);
  if (task.token !== token) throw httpError('任务凭证无效', 403);

  cleanupStageFiles(task.stageBase);
  if (task.pendingPath && fs.existsSync(task.pendingPath)) {
    try { fs.unlinkSync(task.pendingPath); } catch {}
  }
  task.status = 'discarded';
  tasks.delete(id);
}

/**
 * 重新按原动作跑一遍：先丢弃当前暂存，再用同一张原图创建新任务。
 */
export function rerunEditTask(id, token, startAgain) {
  const task = tasks.get(id);
  if (!task) throw httpError('图片编辑任务不存在', 404);
  if (task.status === 'running') throw httpError('任务仍在运行，请等待完成', 409);
  if (task.token !== token) throw httpError('任务凭证无效', 403);

  const { action, url } = task;
  discardEditTask(id, token);
  return startAgain({ action, url });
}

/** 清理超时未确认的暂存任务与孤儿文件 */
export function pruneEditTasks(maxAgeMs = STALE_MS) {
  const now = Date.now();
  const dir = getPendingDir();

  for (const [id, task] of tasks) {
    const inactive = task.status === 'pending_confirm' || task.status === 'failed';
    if (inactive && now - task.createdAt > maxAgeMs) {
      cleanupStageFiles(task.stageBase);
      tasks.delete(id);
    }
  }

  if (!fs.existsSync(dir)) return;
  const referenced = new Set();
  for (const task of tasks.values()) {
    if (task.pendingPath) referenced.add(path.basename(task.pendingPath));
    else referenced.add(path.basename(task.stageBase) + '.');
  }

  for (const name of fs.readdirSync(dir)) {
    if ([...referenced].some(ref => name.startsWith(ref))) continue;
    const filePath = path.join(dir, name);
    try {
      const s = fs.statSync(filePath);
      if (now - s.mtimeMs > maxAgeMs) fs.unlinkSync(filePath);
    } catch {}
  }
}

// 启动后周期性清理，不阻塞进程退出
const pruneTimer = setInterval(() => pruneEditTasks(), 6 * 60 * 60 * 1000);
pruneTimer.unref();
