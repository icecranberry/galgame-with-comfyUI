import { Router } from 'express';
import { readdir, stat } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/index.js';
import { generateImage, generateImageRaw } from '../services/imageSkill.js';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = resolve(__dirname, '../../data/images');

const router = Router();

// ── 相册缓存（避免每次请求都 readdir + stat 2251 个文件阻塞事件循环）──
const galleryCache = {
  data: null,       // { images: [...], total: number }
  mtime: 0,         // 缓存创建时间
  ttl: 30_000,      // 30 秒 TTL（生图不频繁，短缓存已足够）
};

/** 刷新相册缓存：批量 stat（限制并发数），避免 Promise.all 2251 并发压垮事件循环 */
async function refreshGalleryCache() {
  const files = await readdir(IMAGES_DIR);
  const imageFiles = files.filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));

  // 批量 stat：每次最多 64 个并发，避免事件循环被 2000+ 个 Promise 同时 resolve 卡死
  const BATCH_SIZE = 64;
  const results = [];
  for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
    const batch = imageFiles.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (name) => {
        const s = await stat(join(IMAGES_DIR, name));
        return { name, size: s.size, mtime: s.mtimeMs };
      })
    );
    results.push(...batchResults);
  }

  // 按修改时间倒序（最新的在前）
  results.sort((a, b) => b.mtime - a.mtime);

  const images = results.map(s => ({
    name: s.name,
    url: `/images/${s.name}`,
    size: s.size,
    mtime: s.mtime,
  }));

  galleryCache.data = { images, total: images.length };
  galleryCache.mtime = Date.now();
}

/** 当新图片生成后调用，使缓存失效（由 imageSkill 在生图成功后调用） */
export function invalidateGalleryCache() {
  galleryCache.data = null;
  galleryCache.mtime = 0;
}

// GET /api/images/gallery — 获取相册图片列表（按修改时间倒序，支持分页）
router.get('/gallery', async (req, res) => {
  try {
    // 检查缓存是否有效
    if (!galleryCache.data || Date.now() - galleryCache.mtime > galleryCache.ttl) {
      await refreshGalleryCache();
    }

    const { images, total } = galleryCache.data;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    res.json({
      images: images.slice(offset, offset + limit),
      total,
      hasMore: offset + limit < total,
    });
  } catch (err) {
    console.error('[gallery] read images dir error:', err.message);
    res.status(500).json({ error: 'Failed to read images directory' });
  }
});

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
// mode: 'chat' (对话配图) | 'moments' (朋友圈配图) | 'event' (奇遇配图)，默认 'chat'
router.post('/test-style', async (req, res) => {
  const { artist, width, height, mode = 'chat', prompt: customPrompt } = req.body;

  const CHAT_PROMPT_DEFAULT = `1girl, solo, kiana kaslana(honkai impact 3rd), herrscher of finality, voluminous white hair, gradient hair, blue eyes with purple cross-shaped pupils, side ahoge, ponytail, floating hair, white cat ears, cat tail, soft breasts, hair ornament, sailor uniform, one hand on hip, other hand making peace sign near face, classroom, open window, cherry blossoms, cherry blossom petals drifting indoors, direct eye contact, facing viewer, kiana kaslana (honkai impact 3rd) as the herrscher of finality, with voluminous, glossy white hair and blue eyes featuring purple cross-shaped pupils like a starry sky, side ahoge, gradient hair, nekomusume, white cat ears, cat tail, ponytail, floating hair, soft breasts, hair ornament, background is a classroom with an open window, cherry blossom tree outside, petals drifting into the classroom, kiana standing with one hand on her hip and the other making a peace sign near her face, wearing a sailor uniform`;

  const MOMENTS_PROMPT_DEFAULT = `2girls, Kiana Kaslana(honkai impact 3rd), white hair in twin braids, blue eyes, wearing a casual outfit, sitting at a cozy café table with a giant strawberry cake in front of her, laughing joyfully. Raiden Mei(honkai impact 3rd) is sitting across from her, smiling softly, two pudding cups on the table. Warm afternoon sunlight streaming through the window, soft bokeh, cute and heartwarming atmosphere, anime style, high quality illustration.`;

  const EVENT_PROMPT_DEFAULT = `1girl, Hatsune Miku (VOCALOID), teal twin-tailed hair, blue eyes, standing alone on a dimly lit rooftop at dusk, looking over her shoulder with a mysterious expression, one hand reaching toward a glowing floating envelope in the air, city skyline in the distance, warm orange sky fading into deep purple, cinematic lighting, atmospheric, anime style, high quality illustration.`;

  const isMoments = mode === 'moments';
  const isEvent = mode === 'event';
  // 自定义 prompt 优先，否则用默认
  const prompt = customPrompt || (isEvent ? EVENT_PROMPT_DEFAULT : (isMoments ? MOMENTS_PROMPT_DEFAULT : CHAT_PROMPT_DEFAULT));
  const finalArtist = artist || (isEvent ? config.comfyui.eventArtist : (isMoments ? config.comfyui.momentsArtist : config.comfyui.artist));
  const finalWidth = width || (isEvent ? config.comfyui.eventWidth : (isMoments ? config.comfyui.momentsWidth : config.comfyui.width));
  const finalHeight = height || (isEvent ? config.comfyui.eventHeight : (isMoments ? config.comfyui.momentsHeight : config.comfyui.height));

  console.log(`[test-style] mode="${mode}" artist="${finalArtist}" ${finalWidth}x${finalHeight}`);

  const t0 = performance.now();
  const timing = {};

  try {
    const result = await generateImageRaw(prompt, {
      artist: finalArtist,
      width: finalWidth,
      height: finalHeight,
      skipOptimization: true,
      onProgress: (p) => {
        // 捕获各阶段时间戳用于 timing breakdown
        if (p.stage === 'submitting') timing.submitting = performance.now();
        else if (p.phase === 'submitted') timing.submitted = performance.now();
        else if (p.phase === 'started') timing.started = performance.now();
        else if (p.phase === 'executed') timing.executed = performance.now();
        else if (p.phase === 'done') timing.done = performance.now();
      },
    });

    const elapsed = Math.round(performance.now() - t0);

    // 计算各阶段耗时（ms，整数）
    const breakdown = {};
    if (timing.submitted && timing.started) {
      breakdown.ws_setup = Math.round(timing.started - timing.submitted);
    }
    if (timing.submitted && timing.executed) {
      breakdown.comfyui = Math.round(timing.executed - timing.submitted);
    }
    if (timing.executed && timing.done) {
      breakdown.download = Math.round(timing.done - timing.executed);
    }
    if (timing.done) {
      breakdown.overhead = Math.round(elapsed - (timing.done - t0));
    }

    if (result.success) {
      res.json({
        success: true, images: result.images, promptId: result.promptId, elapsed,
        timing: {
          total_ms: elapsed,
          comfyui_ms: breakdown.comfyui,
          download_ms: breakdown.download,
          overhead_ms: breakdown.overhead,
          ws_setup_ms: breakdown.ws_setup,
        },
      });
    } else {
      res.json({ success: false, error: result.error || 'No image generated', elapsed });
    }
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0);
    console.error('[test-style] error:', err.message);
    res.status(500).json({ success: false, error: err.message, elapsed });
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
