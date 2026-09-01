import { Router } from 'express';
import { readdir, stat } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb, getSystemRulesWithWorld, getWorldSetting } from '../db/index.js';
import { generateImage, generateImageRaw, getLastWorkflowMode } from '../services/imageSkill.js';
import { refineImage } from '../services/imageRefine.js';
import { startEditTask, listEditTasks, applyEditTask, discardEditTask, rerunEditTask } from '../services/imageEditTasks.js';
import { charArtistOverride } from '../services/characterImageOpts.js';
import { buildImageCrossRefInfo } from '../services/characterPersona.js';
import { config } from '../config.js';
import { getState, updateServiceConfig, startFullCompression, cancelCompression } from '../services/imageCompressor.js';
import { getAllImageDirs, IMAGE_CATEGORIES, LEGACY_CATEGORY, saveBase64Image, getImageDir } from '../services/imagePaths.js';
import { RAG_TIMEOUT_FAST_MS } from '../services/imagePromptKnowledge.js';
import { chatSync } from '../llm/llm-client.js';
import { IMAGE_PROMPT_RULE, getWorldIntegrationRule } from '../builtinRules.js';
import { matchAll } from '../services/characterSearch.js';
import { parseLoras } from '../maibot-bridge/generate.js';
import { extractImagePromptResponse } from '../services/imagePromptResponse.js';
import fs from 'fs';
import path from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = resolve(__dirname, '../../data/images');

const router = Router();

const FOLDER_LABEL = {
  [LEGACY_CATEGORY]: '历史',
  ...Object.fromEntries(Object.entries(IMAGE_CATEGORIES).map(([k, v]) => [k, v.label])),
};

// 最近一次测试画风成功结果（仅内存，不落盘），供测试细化选取“最近一张图”
let lastStyleTest = null;

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
  const { conversation_id, prompt, rag_query } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const db = getDb();

  const taskResult = db.prepare(`
    INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status)
    VALUES (?, ?, ?, 'running')
  `).run(conversation_id, prompt, prompt);

  const taskId = taskResult.lastInsertRowid;

  // 异步执行，立即返回 taskId
  generateImage(prompt, { promptScene: 'standalone', ragQuery: rag_query, ragTimeoutMs: RAG_TIMEOUT_FAST_MS })
    .then(result => {
      if (result.success) {
        db.prepare(`
          UPDATE image_tasks SET status = 'done', prompt_refined = ?, output_paths = ?, workflow_template = ?, finished_at = datetime('now')
          WHERE id = ?
        `).run(result.promptRefined || prompt, JSON.stringify(result.images.map(i => i.filename)), result.wfMode, taskId);
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
// sceneDesc: 自由画面描述（可选）→ 分层 LLM 生图链路完善为 prompt 后再生图
router.post('/test-style', async (req, res) => {
  const { artist, width, height, mode = 'chat', prompt: customPrompt, sceneDesc, reuseSceneLoras } = req.body;

  /**
   * 自由画面描述 → 分层 system LLM 生成生图 prompt（对齐私聊生图链路）：
   *   system0 = 破甲 + 世界观 / system1 = 世界观强化 / system2 = 生图规则
   *   system3 = 画面描述中匹配到的角色（注入外观描述，返回值附带其 loras）
   */
  const generateScenePrompt = async (desc) => {
    const msgs = [{ role: 'system', content: getSystemRulesWithWorld() || '你是一个角色扮演 AI。' }];
    try {
      if (getWorldSetting()) msgs.push({ role: 'system', content: getWorldIntegrationRule('photo') });
    } catch { /* 规则缺失非致命 */ }
    msgs.push({ role: 'system', content: `【生图规则】\n${IMAGE_PROMPT_RULE.rule_content}` });

    const loras = [];
    const matched = matchAll(desc);
    if (matched.length > 0) {
      const db = getDb();
      const chars = matched.map(m =>
        db.prepare('SELECT id, display_name, base_prompt, loras FROM characters WHERE id = ?').get(m.id)
      ).filter(Boolean);
      if (chars.length > 0) {
        const blocks = chars.map(c => `[${c.display_name}]\n${buildImageCrossRefInfo(c)}`).join('\n\n');
        msgs.push({
          role: 'system',
          content: `【画面交叉参考】以下角色的身份与外观信息必须体现在生成的画面中：\n\n${blocks}`,
        });
        loras.push(...chars.flatMap(c => parseLoras(c)));
      }
    }

    msgs.push({
      role: 'user',
      content: `【画面描述】\n${desc}\n\n【当前任务】\n根据上面的画面描述，直接输出对应的英文生图 prompt（严格遵循【生图规则】）。不要任何格式包装或额外文字。`,
    });

    const raw = await chatSync(msgs, { temperature: 0.85, max_tokens: 1024, label: '画风测试' });
    const prompt = extractImagePromptResponse(raw);
    if (!prompt) throw new Error('模型未返回有效的提示词');
    return { prompt, loras };
  };

  const CHAT_PROMPT_DEFAULT = `1girl, solo, kiana kaslana(honkai impact 3rd), herrscher of finality, voluminous white hair, gradient hair, blue eyes with purple cross-shaped pupils, side ahoge, ponytail, floating hair, white cat ears, cat tail, soft breasts, hair ornament, sailor uniform, one hand on hip, other hand making peace sign near face, classroom, open window, cherry blossoms, cherry blossom petals drifting indoors, direct eye contact, facing viewer, kiana kaslana (honkai impact 3rd) as the herrscher of finality, with voluminous, glossy white hair and blue eyes featuring purple cross-shaped pupils like a starry sky, side ahoge, gradient hair, nekomusume, white cat ears, cat tail, ponytail, floating hair, soft breasts, hair ornament, background is a classroom with an open window, cherry blossom tree outside, petals drifting into the classroom, kiana standing with one hand on her hip and the other making a peace sign near her face, wearing a sailor uniform`;

  const MOMENTS_PROMPT_DEFAULT = `2girls, Kiana Kaslana(honkai impact 3rd), white hair in twin braids, blue eyes, wearing a casual outfit, sitting at a cozy café table with a giant strawberry cake in front of her, laughing joyfully. Raiden Mei(honkai impact 3rd) is sitting across from her, smiling softly, two pudding cups on the table. Warm afternoon sunlight streaming through the window, soft bokeh, cute and heartwarming atmosphere, anime style, high quality illustration.`;

  const EVENT_PROMPT_DEFAULT = `Yae Miko (Genshin Impact), long pink hair in a high ponytail, M-shaped bangs, purple fox-like eyes with a sly expression, wearing a red and white shrine maiden outfit with exposed side breast, lying on a futon in the Grand Narukami Shrine's private sleeping quarters. She is half-asleep, one hand loosely holding a closed light novel on her chest, the other tucked under her cheek. Her posture is relaxed, legs slightly bent, bare feet peeking out from under the thin silk blanket. Around her, soft lantern light casts warm shadows on tatami mats, a half-eaten plate of fried tofu sits on a low wooden tray nearby, and a faint smile plays on her lips as she drifts into peaceful slumber. Camera angle: slightly elevated, looking down from a 45-degree angle, capturing her serene yet mischievous aura in the dim, cozy chamber.`;

  const isMoments = mode === 'moments';
  const isEvent = mode === 'event';
  const finalArtist = artist || (isEvent ? config.comfyui.eventArtist : (isMoments ? config.comfyui.momentsArtist : config.comfyui.artist));
  const finalWidth = width || (isEvent ? config.comfyui.eventWidth : (isMoments ? config.comfyui.momentsWidth : config.comfyui.width));
  const finalHeight = height || (isEvent ? config.comfyui.eventHeight : (isMoments ? config.comfyui.momentsHeight : config.comfyui.height));

  // 自由画面描述 → LLM 分层链路生成 prompt（匹配到的角色 lora 一并带入生图）
  const freeScene = typeof sceneDesc === 'string' ? sceneDesc.trim() : '';
  let prompt;
  let generatedPrompt = null;
  let sceneLoras = [];
  if (freeScene) {
    const tPrompt = performance.now();
    try {
      ({ prompt, loras: sceneLoras } = await generateScenePrompt(freeScene));
    } catch (err) {
      console.error('[test-style] scene prompt generation error:', err.message);
      return res.status(500).json({ success: false, error: '提示词生成失败: ' + err.message });
    }
    generatedPrompt = prompt;
    console.log(`[test-style] sceneDesc → prompt in ${Math.round(performance.now() - tPrompt)}ms${sceneLoras.length > 0 ? ` (+${sceneLoras.length} lora(s))` : ''}: ${prompt.slice(0, 80)}...`);
  } else {
    // 自定义 prompt 优先，否则用默认
    prompt = customPrompt || (isEvent ? EVENT_PROMPT_DEFAULT : (isMoments ? MOMENTS_PROMPT_DEFAULT : CHAT_PROMPT_DEFAULT));
    // 复用提示词重测（前端拿已生成的 prompt 再点发送测试）→ 上次匹配到的角色 lora 继续生效
    if (reuseSceneLoras && Array.isArray(lastStyleTest?.sceneLoras)) {
      sceneLoras = lastStyleTest.sceneLoras;
      if (sceneLoras.length > 0) console.log(`[test-style] reusing ${sceneLoras.length} scene lora(s) from last test`);
    }
  }

  console.log(`[test-style] mode="${mode}" artist="${finalArtist}" ${finalWidth}x${finalHeight}${freeScene ? ' scene=free' : ''}`);

  const t0 = performance.now();
  const timing = {};

  try {
    const result = await generateImageRaw(prompt, {
      ragQuery: freeScene || '',
      ragTimeoutMs: RAG_TIMEOUT_FAST_MS,
      artist: finalArtist,
      width: finalWidth,
      height: finalHeight,
      scene: mode,
      persistPreparation: false,
      ...(sceneLoras.length > 0 ? { loras: sceneLoras } : {}),
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
      lastStyleTest = {
        at: Date.now(),
        images: result.images,
        prompt: result.promptRefined || prompt,
        artist: finalArtist,
        width: finalWidth,
        height: finalHeight,
        mode,
        wfMode: result.wfMode,
        sceneLoras,
      };
      res.json({
        success: true, images: result.images, promptId: result.promptId, elapsed,
        generatedPrompt,
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

/** 最近一张可测试细化的图：优先内存中的测试画风结果，否则最近一条 done 任务 */
async function pickLatestTestImage() {
  const db = getDb();
  const task = db.prepare(`
    SELECT conversation_id, prompt_original, prompt_refined, style, resolution,
           workflow_template, output_paths, finished_at, created_at
    FROM image_tasks
    WHERE status = 'done' AND output_paths IS NOT NULL AND output_paths != '[]'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get();

  let saved = null;
  if (task) {
    let urls = [];
    try { urls = JSON.parse(task.output_paths || '[]'); } catch {}
    const url = urls.find(u => parseImageTarget(String(u).replace(/\?.*$/, '')));
    if (url) {
      const cleanUrl = String(url).replace(/\?.*$/, '');
      const target = parseImageTarget(cleanUrl);
      const filePath = target ? path.join(getImageDir(target.category), target.filename) : null;
      if (filePath && fs.existsSync(filePath)) {
        saved = {
          type: 'saved',
          url: cleanUrl,
          at: fs.statSync(filePath).mtimeMs,
          promptFallback: task.prompt_refined || task.prompt_original || '',
          workflowTemplateFallback: task.workflow_template || null,
        };
      }
    }
  }

  if (!saved) {
    if (!galleryCache.data || Date.now() - galleryCache.mtime > galleryCache.ttl) {
      await refreshGalleryCache();
    }
    const latest = galleryCache.data?.images?.[0];
    if (latest) {
      saved = { type: 'saved', url: latest.url, at: latest.mtime, promptFallback: '' };
    }
  }

  if (lastStyleTest && (!saved || lastStyleTest.at >= saved.at)) {
    return { type: 'test', ...lastStyleTest };
  }
  return saved;
}

// POST /api/images/test-hires — 测试细化（最近一张图，HiresFix 参数流程，不落盘）
router.post('/test-hires', async (req, res) => {
  const t0 = performance.now();
  try {
    const source = await pickLatestTestImage();
    if (!source) {
      return res.status(404).json({ success: false, error: '暂时没有可细化的图片' });
    }

    let buffer;
    let original;
    const refineOpts = {};

    if (source.type === 'test') {
      const img = source.images?.[0];
      if (!img?.base64) {
        return res.status(404).json({ success: false, error: '最近一次测试画风结果不可用，请先发送测试' });
      }
      original = img.base64;
      buffer = Buffer.from(img.base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      refineOpts.promptText = source.prompt;
      refineOpts.artist = source.artist;
      refineOpts.loras = [];
      refineOpts.sourceMode = source.wfMode;
      refineOpts.scene = source.mode;
      refineOpts.ext = path.extname(img.filename || '') || '.png';
    } else {
      const cleanUrl = source.url.replace(/\?.*$/, '');
      const target = parseImageTarget(cleanUrl);
      if (!target) {
        return res.status(400).json({ success: false, error: `invalid image url format: ${source.url}` });
      }
      const { category, filename } = target;
      const filePath = path.join(getImageDir(category), filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'file not found' });
      }
      const params = lookupImageGenerationParams(filename);
      const promptText = params.promptText || source.promptFallback;
      if (!promptText || promptText.trim().length === 0) {
        return res.status(404).json({ success: false, error: '未找到该图片的生成参数，无法测试细化' });
      }
      original = cleanUrl;
      buffer = fs.readFileSync(filePath);
      refineOpts.promptText = promptText;
      refineOpts.artist = resolveArtist(category, params);
      refineOpts.loras = params.charLoras || [];
      refineOpts.customWorkflow = params.charCustomWorkflow;
      refineOpts.sourceMode = params.taskWorkflowTemplate || source.workflowTemplateFallback;
      refineOpts.scene = CATEGORY_SCENE[category] || 'chat';
      refineOpts.ext = path.extname(filename) || '.png';
    }

    const result = await refineImage({ ...refineOpts, buffer, output: 'buffer' });
    if (!result.success || !result.base64) {
      throw new Error(result.error || '细化失败');
    }

    res.json({
      success: true,
      original,
      refined: result.base64,
      elapsed: Math.round(performance.now() - t0),
      source: source.type,
    });
  } catch (err) {
    console.error('[test-hires] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 图片参数反查（regenerate / upscale 放大细化共用）──

/** 解析图片 URL → { category, filename }（失败返回 null） */
function parseImageTarget(cleanUrl) {
  const match = cleanUrl.match(/^\/images\/([^/]+)\/([^/]+)$/);
  if (match) {
    const folder = match[1];
    const filename = match[2];
    for (const [cat, info] of Object.entries(IMAGE_CATEGORIES)) {
      if (info.dir === folder) return { category: cat, filename };
    }
    return null;
  }
  const legacyMatch = cleanUrl.match(/^\/images\/([^/]+)$/);
  if (legacyMatch) {
    return { category: LEGACY_CATEGORY, filename: legacyMatch[1] };
  }
  return null;
}

/**
 * 按文件名反查这张图片的完整生成参数（prompt / 画风 / 分辨率 / 工作流模式 / 角色配置）
 * 查找顺序: image_tasks → moment_posts → raw_messages → character_events → choice_history
 */
function lookupImageGenerationParams(filename) {
  const db = getDb();
  const params = {
    promptText: null, taskStyle: null, taskResolution: null, taskWorkflowTemplate: null,
    charLoras: null, charCustomWorkflow: null, charArtist: null,
  };

  // 辅助：从 conversation_id 提取角色 lora/workflow
  function tryGetCharConfig(conversationId) {
    const m = conversationId?.match(/^char_(\d+)/);
    if (!m) return;
    const char = db.prepare(`SELECT loras, custom_workflow, artist_override FROM characters WHERE id = ?`).get(parseInt(m[1], 10));
    if (char) {
      if (!params.charLoras && char.loras) {
        try { params.charLoras = JSON.parse(char.loras); } catch {}
      }
      if (!params.charCustomWorkflow && char.custom_workflow) {
        params.charCustomWorkflow = char.custom_workflow;
      }
      if (params.charArtist == null) params.charArtist = charArtistOverride(char);
    }
  }

  // 1. image_tasks
  const task = db.prepare(
    `SELECT prompt_original, prompt_refined, conversation_id, style, resolution, workflow_template
     FROM image_tasks WHERE output_paths LIKE ? ORDER BY created_at DESC LIMIT 1`
  ).get(`%${filename}%`);
  if (task?.prompt_refined || task?.prompt_original) {
    params.promptText = task.prompt_refined || task.prompt_original;
    params.taskStyle = task.style;
    params.taskResolution = task.resolution || null;
    params.taskWorkflowTemplate = task.workflow_template || null;
    if (task.conversation_id) tryGetCharConfig(task.conversation_id);
  }

  // 2. moment_posts
  if (!params.promptText) {
    const mp = db.prepare(
      `SELECT prompt, character_id FROM moment_posts WHERE images LIKE ? ORDER BY created_at DESC LIMIT 1`
    ).get(`%${filename}%`);
    if (mp?.prompt) {
      params.promptText = mp.prompt;
      if (mp.character_id) tryGetCharConfig(`char_${mp.character_id}`);
    }
  }

  // 3. raw_messages (主动聊天配图)
  if (!params.promptText) {
    const rm = db.prepare(
      `SELECT raw.prompt, raw.conversation_id FROM raw_messages raw
       JOIN messages msg ON msg.raw_id = raw.id
       WHERE msg.images LIKE ? ORDER BY raw.created_at DESC LIMIT 1`
    ).get(`%${filename}%`);
    if (rm?.prompt) {
      params.promptText = rm.prompt;
      if (rm.conversation_id) tryGetCharConfig(rm.conversation_id);
    }
  }

  // 4. character_events (奇遇)
  if (!params.promptText) {
    const ceMatch = db.prepare(
      `SELECT prompt, character_id FROM character_events WHERE image LIKE ? ORDER BY created_at DESC LIMIT 1`
    ).get(`%${filename}%`);
    if (ceMatch?.prompt) {
      params.promptText = ceMatch.prompt;
      if (ceMatch.character_id) tryGetCharConfig(`char_${ceMatch.character_id}`);
    }
  }

  // 5. character_events.choice_history JSON (奇遇分支)
  if (!params.promptText) {
    const ch = db.prepare(
      `SELECT id, prompt, character_id FROM character_events WHERE choice_history LIKE ? ORDER BY created_at DESC LIMIT 1`
    ).get(`%${filename}%`);
    if (ch) {
      params.promptText = ch.prompt;
      if (ch.character_id) tryGetCharConfig(`char_${ch.character_id}`);
    }
  }

  return params;
}

// 根据 category 的生图参数（画风/分辨率）与场景映射（运行时读取，配置修改即时生效）
function categoryGenConfig(category) {
  const map = {
    chat:      { artist: config.comfyui.artist,        width: config.comfyui.width,        height: config.comfyui.height },
    moments:   { artist: config.comfyui.momentsArtist,  width: config.comfyui.momentsWidth,  height: config.comfyui.momentsHeight },
    events:    { artist: config.comfyui.eventArtist,    width: config.comfyui.eventWidth,    height: config.comfyui.eventHeight },
    peek:      { artist: config.comfyui.eventArtist,    width: config.comfyui.eventWidth,    height: config.comfyui.eventHeight },
    gifts:     { artist: config.comfyui.artist,         width: config.comfyui.width,         height: config.comfyui.height },
    avatargen: { artist: config.comfyui.momentsArtist,  width: 768,                         height: 768 },
  };
  return map[category] || { artist: config.comfyui.artist, width: 1024, height: 1024 };
}

const CATEGORY_SCENE = {
  chat: 'chat',
  moments: 'moments',
  events: 'schedule',
  peek: 'schedule',
  mailbox: 'chat',
  gifts: 'chat',
  avatargen: 'chat',
};

/** 画风优先级：角色覆盖 > 任务记录 > 分类默认 */
function resolveArtist(category, params) {
  if (params.charArtist !== null) return params.charArtist;
  if (params.taskStyle !== null) return params.taskStyle;
  return categoryGenConfig(category).artist;
}



// ── 图片编辑任务（重新生成 / HiresFix 细化：后台执行，确认后覆盖）──

function taskHttpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function dataUriExt(dataUri) {
  const m = String(dataUri || '').match(/^data:image\/(png|jpe?g|webp|avif|gif);/i);
  if (!m) return '.png';
  return m[1].toLowerCase() === 'jpeg' ? '.jpg' : `.${m[1].toLowerCase()}`;
}

async function startImageEditTask(action, url) {
  if (!url) throw taskHttpError('url is required', 400);
  const cleanUrl = String(url).replace(/\?.*$/, '');
  const target = parseImageTarget(cleanUrl);
  if (!target) throw taskHttpError(`invalid image url format: ${url}`, 400);
  const { category, filename } = target;

  const params = lookupImageGenerationParams(filename);
  const promptText = params.promptText;
  if (!promptText || promptText.trim().length === 0) {
    throw taskHttpError('prompt not found for this image', 404);
  }
  const filePath = path.join(getImageDir(category), filename);

  const run = async ({ stageBase, onProgress }) => {
    if (action === 'regenerate') {
      const opts = { ...categoryGenConfig(category) };
      if (params.taskStyle !== null && params.taskResolution) {
        const resolutionMatch = params.taskResolution.match(/^(\d+)x(\d+)$/);
        if (resolutionMatch) {
          opts.width = Number(resolutionMatch[1]);
          opts.height = Number(resolutionMatch[2]);
        }
      }
      const genOpts = {
        artist: resolveArtist(category, params),
        width: opts.width,
        height: opts.height,
        scene: CATEGORY_SCENE[category] || 'chat',
        alreadyPrepared: true,
        disableRAG: true,
        persistPreparation: false,
        onProgress,
      };
      if (params.charLoras?.length > 0) genOpts.loras = params.charLoras;
      if (params.charCustomWorkflow) genOpts.customWorkflow = params.charCustomWorkflow;
      const result = await generateImageRaw(promptText, genOpts);
      if (!result.success || !result.images?.length) {
        throw new Error(result.error || 'Image generation failed');
      }
      const img = result.images[0];
      const ext = dataUriExt(img.base64);
      const stagedName = path.basename(stageBase) + ext;
      const base64 = img.base64.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(stageBase + ext, Buffer.from(base64, 'base64'));
      return { filename: stagedName };
    }

    if (!fs.existsSync(filePath)) throw taskHttpError('file not found', 404);
    const ext = path.extname(filePath) || '.png';
    const outPath = stageBase + ext;
    await refineImage({
      filePath,
      outPath,
      promptText,
      artist: resolveArtist(category, params),
      loras: params.charLoras || [],
      customWorkflow: params.charCustomWorkflow,
      sourceMode: params.taskWorkflowTemplate,
      scene: CATEGORY_SCENE[category] || 'chat',
      onProgress,
    });
    return { filename: path.basename(outPath) };
  };

  return startEditTask({ action, url: cleanUrl, targetPath: filePath, run });
}

function sendTaskError(res, err) {
  console.error('[image-edit-task] error:', err?.message || err);
  res.status(err?.status || 500).json({ error: err?.message || '任务操作失败' });
}

// POST /api/images/regenerate — 提交后台重新生成任务（确认后才覆盖原图）
router.post('/regenerate', async (req, res) => {
  try {
    const task = await startImageEditTask('regenerate', req.body?.url);
    res.status(202).json({ success: true, task_id: task.id, status: 'running' });
  } catch (err) { sendTaskError(res, err); }
});

// POST /api/images/upscale — 提交后台 HiresFix 细化任务（确认后才覆盖原图）
router.post('/upscale', async (req, res) => {
  try {
    const task = await startImageEditTask('upscale', req.body?.url);
    res.status(202).json({ success: true, task_id: task.id, status: 'running' });
  } catch (err) { sendTaskError(res, err); }
});

// GET /api/images/edit-tasks — 运行中 / 待确认 / 失败的任务
router.get('/edit-tasks', (req, res) => {
  res.json({ tasks: listEditTasks() });
});

// POST /api/images/edit-tasks/:id/apply — 确认覆盖：暂存文件原子替换原图
router.post('/edit-tasks/:id/apply', async (req, res) => {
  try {
    const task = await applyEditTask(req.params.id, req.body?.token);
    const cleanUrl = task.url.replace(/\?.*$/, '');
    res.json({ success: true, url: `${cleanUrl}?t=${Date.now()}`, task_id: task.id });
  } catch (err) { sendTaskError(res, err); }
});

// POST /api/images/edit-tasks/:id/rerun — 按原动作 + 原图重新跑一次
router.post('/edit-tasks/:id/rerun', async (req, res) => {
  try {
    const task = await rerunEditTask(req.params.id, req.body?.token, async ({ action, url }) => startImageEditTask(action, url));
    res.status(202).json({ success: true, task_id: task.id, status: 'running' });
  } catch (err) { sendTaskError(res, err); }
});

// POST /api/images/edit-tasks/:id/discard — 保留原图，删除暂存
router.post('/edit-tasks/:id/discard', (req, res) => {
  try {
    discardEditTask(req.params.id, req.body?.token);
    res.json({ success: true });
  } catch (err) { sendTaskError(res, err); }
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
