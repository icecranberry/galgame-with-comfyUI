import { Router } from 'express';
import { readdir, stat } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/index.js';
import { generateImage, generateImageRaw, getLastWorkflowMode } from '../services/imageSkill.js';
import { config } from '../config.js';
import { getState, updateServiceConfig, startFullCompression, cancelCompression } from '../services/imageCompressor.js';
import { getAllImageDirs, IMAGE_CATEGORIES, LEGACY_CATEGORY, saveBase64Image, getImageDir } from '../services/imagePaths.js';
import fs from 'fs';
import path from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = resolve(__dirname, '../../data/images');

const router = Router();

const FOLDER_LABEL = {
  [LEGACY_CATEGORY]: '历史',
  ...Object.fromEntries(Object.entries(IMAGE_CATEGORIES).map(([k, v]) => [k, v.label])),
};

// ── 相册缓存（避免每次请求都 readdir + stat 阻塞事件循环）──
const galleryCache = {
  data: null,       // { images: [...], total: number }
  mtime: 0,         // 缓存创建时间
  ttl: 30_000,      // 30 秒 TTL（生图不频繁，短缓存已足够）
};

/** 扫描单个目录，返回带 folder 标记的图片列表 */
async function scanDirectory(dirPath, category, urlPrefix) {
  try {
    const files = await readdir(dirPath);
    const imageFiles = files.filter(f => /\.(png|jpg|jpeg|webp|gif|avif)$/i.test(f));
    if (imageFiles.length === 0) return [];

    const BATCH_SIZE = 64;
    const results = [];
    for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
      const batch = imageFiles.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (name) => {
          const s = await stat(join(dirPath, name));
          return { name, size: s.size, mtime: s.mtimeMs, folder: category, url: `${urlPrefix}/${name}` };
        })
      );
      results.push(...batchResults);
    }
    return results;
  } catch {
    return [];
  }
}

/** 刷新相册缓存：扫描所有子目录 + 历史平铺目录，批量 stat */
async function refreshGalleryCache() {
  const dirs = getAllImageDirs();
  const allResults = [];

  for (const { category, dir, urlPrefix } of dirs) {
    const results = await scanDirectory(dir, category, urlPrefix);
    allResults.push(...results);
  }

  allResults.sort((a, b) => b.mtime - a.mtime);

  galleryCache.data = { images: allResults, total: allResults.length };
  galleryCache.mtime = Date.now();
}

/** 当新图片生成后调用，使缓存失效（由 imageSkill 在生图成功后调用） */
export function invalidateGalleryCache() {
  galleryCache.data = null;
  galleryCache.mtime = 0;
}

// GET /api/images/gallery — 获取相册图片列表（按修改时间倒序，支持分页 + 文件夹筛选）
router.get('/gallery', async (req, res) => {
  try {
    if (!galleryCache.data || Date.now() - galleryCache.mtime > galleryCache.ttl) {
      await refreshGalleryCache();
    }

    const { folder } = req.query;
    let { images, total } = galleryCache.data;

    if (folder) {
      images = images.filter(img => img.folder === folder);
      total = images.length;
    }

    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    const pageImages = images.slice(offset, offset + limit);
    res.json({
      images: pageImages.map(img => ({ name: img.name, url: img.url, size: img.size, mtime: img.mtime, folder: img.folder })),
      total,
      hasMore: offset + limit < total,
      folders: getAvailableFolders(galleryCache.data.images),
    });
  } catch (err) {
    console.error('[gallery] read images dir error:', err.message);
    res.status(500).json({ error: 'Failed to read images directory' });
  }
});

function getAvailableFolders(images) {
  const counts = {};
  for (const img of images) {
    const f = img.folder;
    counts[f] = (counts[f] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, label: FOLDER_LABEL[key] || key, count }));
}

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
          UPDATE image_tasks SET status = 'done', output_paths = ?, workflow_template = ?, finished_at = datetime('now')
          WHERE id = ?
        `).run(JSON.stringify(result.images.map(i => i.filename)), result.wfMode, taskId);
      } else {
        db.prepare(`
          UPDATE image_tasks SET status = 'failed', error_message = ?, workflow_template = ?, finished_at = datetime('now')
          WHERE id = ?
        `).run(result.error || 'No images', result.wfMode, taskId);
      }
    })
    .catch(err => {
      db.prepare(`
        UPDATE image_tasks SET status = 'failed', error_message = ?, workflow_template = ?, finished_at = datetime('now')
        WHERE id = ?
      `).run(err.message, getLastWorkflowMode(), taskId);
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

  const EVENT_PROMPT_DEFAULT = `Yae Miko (Genshin Impact), long pink hair in a high ponytail, M-shaped bangs, purple fox-like eyes with a sly expression, wearing a red and white shrine maiden outfit with exposed side breast, lying on a futon in the Grand Narukami Shrine's private sleeping quarters. She is half-asleep, one hand loosely holding a closed light novel on her chest, the other tucked under her cheek. Her posture is relaxed, legs slightly bent, bare feet peeking out from under the thin silk blanket. Around her, soft lantern light casts warm shadows on tatami mats, a half-eaten plate of fried tofu sits on a low wooden tray nearby, and a faint smile plays on her lips as she drifts into peaceful slumber. Camera angle: slightly elevated, looking down from a 45-degree angle, capturing her serene yet mischievous aura in the dim, cozy chamber.`;

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
      scene: mode,
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

// POST /api/images/regenerate — 用原 prompt 重新生图，覆盖原文件
router.post('/regenerate', async (req, res) => {
  const { url: imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'url is required' });

  // 解析 URL 提取 category 和 filename（忽略查询参数）
  const cleanUrl = imageUrl.replace(/\?.*$/, '');
  const match = cleanUrl.match(/^\/images\/([^/]+)\/([^/]+)$/);
  if (!match) return res.status(400).json({ error: `invalid image url format: ${imageUrl}` });

  const folder = match[1];
  const filename = match[2];

  // 映射 folder → category
  let category = null;
  for (const [cat, info] of Object.entries(IMAGE_CATEGORIES)) {
    if (info.dir === folder) { category = cat; break; }
  }
  if (!category && folder === '') category = LEGACY_CATEGORY;
  if (!category) return res.status(400).json({ error: `unknown folder: ${folder}` });

  // 查找 prompt：优先 image_tasks，其次 moment_posts，再 raw_messages，最后 character_events
  const db = getDb();
  let promptText = null;
  let charLoras = null;
  let charCustomWorkflow = null;

  // 辅助：从 conversation_id 提取角色 lora/workflow
  function tryGetCharConfig(conversationId) {
    const m = conversationId?.match(/^char_(\d+)/);
    if (!m) return;
    const char = db.prepare(`SELECT loras, custom_workflow FROM characters WHERE id = ?`).get(parseInt(m[1]));
    if (char) {
      if (!charLoras && char.loras) {
        try { charLoras = JSON.parse(char.loras); } catch {}
      }
      if (!charCustomWorkflow && char.custom_workflow) {
        charCustomWorkflow = char.custom_workflow;
      }
    }
  }

  // 1. image_tasks
  const task = db.prepare(
    `SELECT prompt_original, conversation_id FROM image_tasks WHERE output_paths LIKE ? ORDER BY created_at DESC LIMIT 1`
  ).get(`%${filename}%`);
  if (task?.prompt_original) {
    promptText = task.prompt_original;
    if (task.conversation_id) tryGetCharConfig(task.conversation_id);
  }

  // 2. moment_posts
  if (!promptText) {
    const mp = db.prepare(
      `SELECT prompt, character_id FROM moment_posts WHERE images LIKE ? ORDER BY created_at DESC LIMIT 1`
    ).get(`%${filename}%`);
    if (mp?.prompt) {
      promptText = mp.prompt;
      if (mp.character_id) tryGetCharConfig(`char_${mp.character_id}`);
    }
  }

  // 3. raw_messages (主动聊天配图)
  if (!promptText) {
    const rm = db.prepare(
      `SELECT raw.prompt, raw.conversation_id FROM raw_messages raw
       JOIN messages msg ON msg.raw_id = raw.id
       WHERE msg.images LIKE ? ORDER BY raw.created_at DESC LIMIT 1`
    ).get(`%${filename}%`);
    if (rm?.prompt) {
      promptText = rm.prompt;
      if (rm.conversation_id) tryGetCharConfig(rm.conversation_id);
    }
  }

  // 4. character_events (奇遇)
  if (!promptText) {
    const ceMatch = db.prepare(
      `SELECT prompt, character_id FROM character_events WHERE image LIKE ? ORDER BY created_at DESC LIMIT 1`
    ).get(`%${filename}%`);
    if (ceMatch?.prompt) {
      promptText = ceMatch.prompt;
      if (ceMatch.character_id) tryGetCharConfig(`char_${ceMatch.character_id}`);
    }
  }

  // 5. character_events.choice_history JSON (奇遇分支)
  if (!promptText) {
    const ch = db.prepare(
      `SELECT id, prompt, character_id FROM character_events WHERE choice_history LIKE ? ORDER BY created_at DESC LIMIT 1`
    ).get(`%${filename}%`);
    if (ch) {
      promptText = ch.prompt;
      if (ch.character_id) tryGetCharConfig(`char_${ch.character_id}`);
    }
  }

  if (!promptText || promptText.trim().length === 0) {
    return res.status(404).json({ error: 'prompt not found for this image' });
  }

  console.log(`[regenerate] category="${category}" file="${filename}" prompt="${promptText.slice(0, 80)}..."${charLoras?.length ? ` loras=${charLoras.length}` : ''}${charCustomWorkflow ? ` workflow=${charCustomWorkflow}` : ''}`);

  // 根据 category 选择生图参数
  const categoryConfig = {
    chat:      { artist: config.comfyui.artist,        width: config.comfyui.width,        height: config.comfyui.height },
    moments:   { artist: config.comfyui.momentsArtist,  width: config.comfyui.momentsWidth,  height: config.comfyui.momentsHeight },
    events:    { artist: config.comfyui.eventArtist,    width: config.comfyui.eventWidth,    height: config.comfyui.eventHeight },
    peek:      { artist: config.comfyui.eventArtist,    width: config.comfyui.eventWidth,    height: config.comfyui.eventHeight },
    gifts:     { artist: config.comfyui.artist,         width: config.comfyui.width,         height: config.comfyui.height },
    avatargen: { artist: config.comfyui.momentsArtist,  width: 768,                         height: 768 },
  };

  const opts = categoryConfig[category] || { artist: config.comfyui.artist, width: 1024, height: 1024 };

  try {
    const genOpts = {
      artist: opts.artist,
      width: opts.width,
      height: opts.height,
      scene: category === 'moments' ? 'moments' : (category === 'events' || category === 'peek' ? 'schedule' : 'chat'),
    };
    if (charLoras?.length > 0) genOpts.loras = charLoras;
    if (charCustomWorkflow) genOpts.customWorkflow = charCustomWorkflow;
    const result = await generateImageRaw(promptText, genOpts);

    if (!result.success || !result.images?.length) {
      return res.status(500).json({ error: result.error || 'Image generation failed' });
    }

    const img = result.images[0];
    const dir = getImageDir(category);
    const filePath = path.join(dir, filename);

    // 原子写入：先写临时文件，再 rename
    const tmpPath = filePath + '.regenerating';
    const base64 = img.base64.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(tmpPath, Buffer.from(base64, 'base64'));
    fs.renameSync(tmpPath, filePath);

    console.log(`[regenerate] overwrote ${filePath}`);

    // 失效相册缓存
    invalidateGalleryCache();

    res.json({
      success: true,
      url: `${cleanUrl}?t=${Date.now()}`,
    });
  } catch (err) {
    console.error('[regenerate] error:', err.message);
    res.status(500).json({ error: 'Regenerate failed: ' + err.message });
  }
});

// DELETE /api/images/delete — 删除图片文件，不清理 DB 引用
router.delete('/delete', async (req, res) => {
  const { url: imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'url is required' });

  const cleanUrl = imageUrl.replace(/\?.*$/, '');
  const match = cleanUrl.match(/^\/images\/([^/]+)\/([^/]+)$/);

  let dirPath, filename, category;
  if (match) {
    const folder = match[1];
    filename = match[2];
    category = null;
    for (const [cat, info] of Object.entries(IMAGE_CATEGORIES)) {
      if (info.dir === folder) { category = cat; break; }
    }
    if (!category && folder === '') category = LEGACY_CATEGORY;
    if (!category) return res.status(400).json({ error: `unknown folder: ${folder}` });
    dirPath = getImageDir(category);
  } else {
    // legacy flat format: /images/xxx.png
    const legacyMatch = cleanUrl.match(/^\/images\/([^/]+)$/);
    if (!legacyMatch) return res.status(400).json({ error: `invalid image url format: ${imageUrl}` });
    filename = legacyMatch[1];
    category = LEGACY_CATEGORY;
    dirPath = getImageDir(LEGACY_CATEGORY);
  }

  const filePath = path.join(dirPath, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'file not found' });
  }

  try {
    fs.unlinkSync(filePath);
    console.log(`[delete] removed ${filePath}`);
    invalidateGalleryCache();

    // 聊天图片：清理 messages.images 和 raw_messages.prompt
    if (category === 'chat') {
      try {
        const db = getDb();
        const msgRows = db.prepare(
          `SELECT id, images, raw_id FROM messages WHERE images LIKE '%' || ? || '%'`
        ).all(filename);

        for (const row of msgRows) {
          try {
            const urls = JSON.parse(row.images) || [];
            const filtered = urls.filter(u => {
              const uBase = u.replace(/\?.*$/, '');
              return uBase !== cleanUrl;
            });
            if (filtered.length > 0) {
              db.prepare(`UPDATE messages SET images = ? WHERE id = ?`).run(JSON.stringify(filtered), row.id);
            } else {
              db.prepare(`UPDATE messages SET images = NULL WHERE id = ?`).run(row.id);
            }
            console.log(`[delete] cleaned images from message id=${row.id}`);
          } catch (e) {
            console.error(`[delete] parse images for message id=${row.id}:`, e.message);
          }
        }

        // 清除关联 raw_messages 的 prompt，使 regenerate 不再生效
        const rawIds = [...new Set(msgRows.map(r => r.raw_id).filter(Boolean))];
        if (rawIds.length > 0) {
          const placeholders = rawIds.map(() => '?').join(',');
          const result = db.prepare(
            `UPDATE raw_messages SET prompt = NULL WHERE id IN (${placeholders})`
          ).run(...rawIds);
          console.log(`[delete] cleared prompt from ${result.changes} raw_messages`);
        }
      } catch (e) {
        console.error('[delete] DB cleanup error:', e.message);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[delete] error:', err.message);
    res.status(500).json({ error: 'Delete failed: ' + err.message });
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

// ── 图片压缩 API ──

// GET /api/images/compress/status — 获取压缩状态（含立即压缩进度）
router.get('/compress/status', (req, res) => {
  res.json(getState());
});

// PUT /api/images/compress/config — 更新压缩配置
router.put('/compress/config', (req, res) => {
  const { enabled, compressionType: type } = req.body;
  if (type && !['oxipng', 'avif'].includes(type)) {
    return res.status(400).json({ error: 'compressionType must be "oxipng" or "avif"' });
  }
  const state = updateServiceConfig({ enabled, type });
  res.json(state);
});

// POST /api/images/compress/start — 启动立即压缩（全量，SSE 推送进度）
router.post('/compress/start', (req, res) => {
  const result = startFullCompression();
  if (result.error) {
    return res.status(409).json(result);
  }
  res.json(result);
});

// POST /api/images/compress/cancel — 取消正在进行的压缩
router.post('/compress/cancel', (req, res) => {
  const result = cancelCompression();
  if (result.error) {
    return res.status(404).json(result);
  }
  res.json(result);
});

export default router;
