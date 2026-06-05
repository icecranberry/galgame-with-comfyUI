import { Router } from 'express';
import { getDb } from '../db/index.js';
import { generateImage } from '../services/imageSkill.js';
import { config } from '../config.js';

const router = Router();

// GET /api/images/tasks — 获取生图任务列表
router.get('/tasks', (req, res) => {
  const db = getDb();
  const { conversation_id, status, limit = '20' } = req.query;

  let sql = `SELECT * FROM image_tasks WHERE 1=1`;
  const params = [];

  if (conversation_id) {
    sql += ` AND conversation_id = ?`;
    params.push(conversation_id);
  }
  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(parseInt(limit, 10));

  const tasks = db.prepare(sql).all(...params);
  res.json({ tasks });
});

// GET /api/images/tasks/:id — 获取单个任务状态
router.get('/tasks/:id', (req, res) => {
  const db = getDb();
  const task = db.prepare(`SELECT * FROM image_tasks WHERE id = ?`).get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json({ task });
});

// POST /api/images/generate — 直接调用生图（独立于聊天之外的触发方式）
router.post('/generate', async (req, res) => {
  const { conversation_id, prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const db = getDb();

  const taskResult = db.prepare(`
    INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status)
    VALUES (?, ?, ?, 'running')
  `).run(conversation_id, prompt, prompt);

  const taskId = taskResult.lastInsertRowid;

  // 异步执行，立即返回 taskId
  generateImage(prompt)
    .then(result => {
      if (result.success) {
        db.prepare(`
          UPDATE image_tasks SET status = 'done', output_paths = ?, finished_at = datetime('now')
          WHERE id = ?
        `).run(JSON.stringify(result.images.map(i => i.filename)), taskId);
      } else {
        db.prepare(`
          UPDATE image_tasks SET status = 'failed', error_message = ?, finished_at = datetime('now')
          WHERE id = ?
        `).run(result.error || 'No images', taskId);
      }
    })
    .catch(err => {
      db.prepare(`
        UPDATE image_tasks SET status = 'failed', error_message = ?, finished_at = datetime('now')
        WHERE id = ?
      `).run(err.message, taskId);
    });

  res.status(202).json({ task_id: taskId, status: 'running' });
});

// GET /api/images/tasks/:id/status — 轮询任务状态
router.get('/tasks/:id/status', (req, res) => {
  const db = getDb();
  const task = db.prepare(`
    SELECT id, status, output_paths, error_message, created_at, finished_at
    FROM image_tasks WHERE id = ?
  `).get(req.params.id);

  if (!task) return res.status(404).json({ error: 'Task not found' });

  res.json({
    id: task.id,
    status: task.status,
    output_paths: task.output_paths ? JSON.parse(task.output_paths) : [],
    error: task.error_message,
    created_at: task.created_at,
    finished_at: task.finished_at,
  });
});

// GET /api/images/comfyui-health — ComfyUI 连接检查
router.get('/comfyui-health', async (req, res) => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const cres = await fetch(`${config.comfyui.url}/system_stats`, { signal: controller.signal });
    clearTimeout(timer);

    if (cres.ok) {
      const stats = await cres.json().catch(() => ({}));
      res.json({
        connected: true,
        url: config.comfyui.url,
        device: stats.devices?.[0]?.name || stats.system?.device || 'unknown',
        vram_total: stats.devices?.[0]?.vram_total || 0,
      });
    } else {
      res.json({ connected: false, url: config.comfyui.url });
    }
  } catch {
    res.json({ connected: false, url: config.comfyui.url });
  }
});

export default router;
