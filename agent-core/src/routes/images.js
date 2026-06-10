import { Router } from 'express';
import { getDb } from '../db/index.js';
import { generateImage, generateImageRaw } from '../services/imageSkill.js';
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

// POST /api/images/test-style — 测试画风（固定提示词，不写DB，仅返回展示用图）
router.post('/test-style', async (req, res) => {
  const { artist, width, height } = req.body;

  const FIXED_PROMPT = `1girl, solo, kiana kaslana, honkai impact 3rd, herrscher of finality, voluminous white hair, gradient hair, blue eyes with purple cross-shaped pupils, side ahoge, ponytail, floating hair, white cat ears, cat tail, soft breasts, hair ornament, sailor uniform, one hand on hip, other hand making peace sign near face, classroom, open window, cherry blossoms, cherry blossom petals drifting indoors, direct eye contact, facing viewer, kiana kaslana (honkai impact 3rd) as the herrscher of finality, with voluminous, glossy white hair and blue eyes featuring purple cross-shaped pupils like a starry sky, side ahoge, gradient hair, nekomusume, white cat ears, cat tail, ponytail, floating hair, soft breasts, hair ornament, background is a classroom with an open window, cherry blossom tree outside, petals drifting into the classroom, kiana standing with one hand on her hip and the other making a peace sign near her face, wearing a sailor uniform`;

  console.log(`[test-style] artist="${artist}" ${width}x${height}`);

  try {
    const result = await generateImageRaw(FIXED_PROMPT, {
      artist: artist || config.comfyui.artist,
      width: width || config.comfyui.width,
      height: height || config.comfyui.height,
    });

    if (result.success) {
      res.json({ success: true, images: result.images, promptId: result.promptId });
    } else {
      res.json({ success: false, error: result.error || 'No image generated' });
    }
  } catch (err) {
    console.error('[test-style] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
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
