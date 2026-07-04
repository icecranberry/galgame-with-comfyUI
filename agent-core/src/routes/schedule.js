/**
 * 日程 API 路由
 *
 * GET    /api/schedule                         — 所有角色日程概览
 * GET    /api/schedule/:characterId            — 指定角色完整今日日程
 * GET    /api/schedule/:characterId/current    — 当前活动（轻量）
 * POST   /api/schedule/:characterId/peek       — 瞄一眼快照（异步生图）
 * POST   /api/schedule/:characterId/regenerate — 强制重新生成日程
 * POST   /api/schedule/regenerate-all          — 重置世界线（SSE 推送进度）
 * POST   /api/schedule/regenerate-all/cancel   — 取消重置世界线
 * GET    /api/schedule/queue/status            — 调试：查看队列概览
 */

import { Router } from 'express';
import { getDb, getSystemRules, getWorldSetting, getGlobalRule } from '../db/index.js';
import { config } from '../config.js';
import {
  getTodaySchedule, getCurrentActivity,
  getAllOverview, ensureTodaySchedule, invalidateCache,
  syncSleepingState,
} from '../services/scheduleManager.js';
import { generateSchedule, assignNextRefreshTime, snapshotTodaySchedule } from '../services/scheduleGenerator.js';
import { generateImage } from '../services/imageSkill.js';
import { broadcast } from '../services/unifiedStreamBus.js';
import { chatSync } from '../llm/llm-client.js';
import { getTimeLight } from '../services/timeLight.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PEEK_IMAGES_DIR = path.join(__dirname, '..', '..', 'data', 'images');

const router = Router();

// ── GET /api/schedule — 所有角色概览 ──

router.get('/', (req, res) => {
  try {
    if (config.features.schedule === false) {
      return res.json({ characters: [], disabled: true });
    }

    const overview = getAllOverview();
    res.json({ characters: overview });
  } catch (err) {
    console.error('[schedule] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 重置世界线状态 ──
let resetTask = null; // { cancelled, processing, current, total }

// ── POST /api/schedule/regenerate-all — 重置世界线（重新生成所有角色日程）──
router.post('/regenerate-all', async (req, res) => {
  try {
    if (resetTask?.processing) {
      return res.status(409).json({ error: '重置世界线正在进行中', busy: true });
    }

    const db = getDb();
    const characters = db.prepare('SELECT id, display_name, base_prompt FROM characters ORDER BY id').all();

    if (!characters.length) {
      return res.status(404).json({ error: '没有角色' });
    }

    resetTask = { cancelled: false, processing: true, current: 0, total: characters.length };

    // 立即返回，不阻塞
    res.json({ started: true, total: characters.length });

    // 异步逐个生成
    for (let i = 0; i < characters.length; i++) {
      if (resetTask.cancelled) break;

      const character = characters[i];
      resetTask.current = i + 1;

      // 广播进度：开始生成
      broadcast('schedule_reset_progress', {
        phase: 'running',
        character_name: character.display_name,
        current: i + 1,
        total: characters.length,
        status: 'generating',
      });

      console.log(`[schedule] Reset worldline: generating for ${character.display_name} (${i + 1}/${characters.length})`);

      try {
        const result = await generateSchedule(character);
        assignNextRefreshTime(character.id);
        snapshotTodaySchedule(character.id);
        syncSleepingState(character.id);
        invalidateCache(character.id);

        broadcast('schedule_reset_progress', {
          phase: 'running',
          character_name: character.display_name,
          current: i + 1,
          total: characters.length,
          status: 'done',
          version: result.version,
        });
      } catch (genErr) {
        console.error(`[schedule] Reset worldline: failed for ${character.display_name}:`, genErr.message);
        broadcast('schedule_reset_progress', {
          phase: 'running',
          character_name: character.display_name,
          current: i + 1,
          total: characters.length,
          status: 'error',
          error: genErr.message,
        });
      }

      // 角色间短暂间隔，避免 LLM API 限流
      if (i < characters.length - 1 && !resetTask.cancelled) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // 广播完成
    broadcast('schedule_reset_progress', {
      phase: resetTask.cancelled ? 'cancelled' : 'complete',
      current: resetTask.current,
      total: characters.length,
      cancelled: resetTask.cancelled,
    });

    console.log(`[schedule] Reset worldline finished. Processed: ${resetTask.current}/${characters.length}, cancelled: ${resetTask.cancelled}`);
    resetTask = null;
  } catch (err) {
    console.error('[schedule] POST /regenerate-all error:', err.message);
    resetTask = null;
    // 响应已发送，仅广播错误
    broadcast('schedule_reset_progress', {
      phase: 'error',
      error: err.message,
    });
  }
});

// ── POST /api/schedule/regenerate-all/cancel — 取消重置世界线 ──
router.post('/regenerate-all/cancel', (req, res) => {
  if (!resetTask?.processing) {
    return res.json({ cancelled: false, message: '没有正在进行的重置任务' });
  }
  resetTask.cancelled = true;
  console.log('[schedule] Reset worldline cancellation requested');
  res.json({ cancelled: true, message: '已请求取消' });
});

// ── GET /api/schedule/:characterId — 完整今日日程 ──

router.get('/:characterId', (req, res) => {
  try {
    const characterId = parseInt(req.params.characterId, 10);
    if (isNaN(characterId)) {
      return res.status(400).json({ error: 'invalid characterId' });
    }

    const db = getDb();
    const character = db.prepare('SELECT id, display_name, avatar_path, base_prompt FROM characters WHERE id = ?').get(characterId);
    if (!character) {
      return res.status(404).json({ error: 'character not found' });
    }

    // 确保今日有日程快照
    ensureTodaySchedule(characterId);

    const schedule = getTodaySchedule(characterId);
    const template = db.prepare('SELECT version, generated_at FROM schedule_templates WHERE character_id = ?').get(characterId);

    res.json({
      character_id: character.id,
      display_name: character.display_name,
      avatar_path: character.avatar_path,
      schedule_date: new Date().toISOString().slice(0, 10),
      activities: schedule || [],
      template_version: template?.version || 0,
      template_generated_at: template?.generated_at || null,
    });
  } catch (err) {
    console.error('[schedule] GET /:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/schedule/:characterId/current — 当前活动（轻量）──

router.get('/:characterId/current', (req, res) => {
  try {
    const characterId = parseInt(req.params.characterId, 10);
    if (isNaN(characterId)) {
      return res.status(400).json({ error: 'invalid characterId' });
    }

    const activity = getCurrentActivity(characterId);

    res.json({
      character_id: characterId,
      current_activity: activity,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[schedule] GET /:id/current error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 辅助函数：JSON 修复 / 提取 / image_prompt 规则解析 ──

function repairJson(text) {
  return text.replace(/\\([^"\\\/bfnrtu])/g, '$1');
}

function extractFirstJson(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function parseImagePromptRule(ruleContent) {
  if (!ruleContent) return null;
  try {
    let sanitized = ruleContent
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
    sanitized = repairJson(sanitized);
    const parsed = JSON.parse(sanitized);
    return parsed.prompt || null;
  } catch {
    return null;
  }
}

/** 将 base64 图片落盘，返回对外可访问的 URL 路径 */
function savePeekImage(base64, filename) {
  try {
    if (!fs.existsSync(PEEK_IMAGES_DIR)) {
      fs.mkdirSync(PEEK_IMAGES_DIR, { recursive: true });
    }
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
    const ext = base64.match(/^data:image\/(\w+);base64,/)?.[1] || 'png';
    const safeName = `peek_${filename}_${Date.now()}.${ext}`;
    const filePath = path.join(PEEK_IMAGES_DIR, safeName);
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    console.log(`[schedule] Peek image saved: ${safeName}`);
    return `/images/${safeName}`;
  } catch (err) {
    console.error('[schedule] Failed to save peek image:', err.message);
    return null;
  }
}

// ── POST /api/schedule/:characterId/peek/retake — 再拍一张（必须在 peek 前定义，避免被 :characterId/peek 前缀匹配）──

router.post('/:characterId/peek/retake', async (req, res) => {
  try {
    const characterId = parseInt(req.params.characterId, 10);
    if (isNaN(characterId)) {
      return res.status(400).json({ error: 'invalid characterId' });
    }

    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const db = getDb();
    const character = db.prepare('SELECT id, display_name FROM characters WHERE id = ?').get(characterId);
    if (!character) {
      return res.status(404).json({ error: 'character not found' });
    }

    console.log(`[schedule] Peek retake for ${character.display_name}: "${prompt.slice(0, 100)}..."`);

    // 立即返回，异步生图
    res.json({
      success: true,
      character_id: character.id,
      message: 'Retake started, result will be pushed via SSE schedule_peek_ready',
    });

    // 异步生图，使用奇遇事件参数
    try {
      const result = await generateImage(prompt, {
        artist: config.comfyui.eventArtist,
        width: config.comfyui.eventWidth,
        height: config.comfyui.eventHeight,
        onProgress: (p) => {
          if (p.progress != null) {
            broadcast('schedule_peek_progress', {
              character_id: character.id,
              progress: Math.round(p.progress * 100),
            });
          }
        },
      });

      if (result.success && result.images?.length > 0) {
        const img = result.images[0];
        const imageUrl = savePeekImage(img.base64, img.filename || 'comfy');
        broadcast('schedule_peek_ready', {
          character_id: character.id,
          display_name: character.display_name,
          prompt,
          images: imageUrl ? [imageUrl] : [img.base64],
        });
        console.log(`[schedule] Peek retake ready for ${character.display_name}`);
      } else {
        broadcast('schedule_peek_ready', {
          character_id: character.id,
          display_name: character.display_name,
          prompt,
          error: result.error || 'Image generation failed',
        });
      }
    } catch (genErr) {
      console.error(`[schedule] Peek retake failed for ${character.display_name}:`, genErr.message);
      broadcast('schedule_peek_ready', {
        character_id: character.id,
        display_name: character.display_name,
        prompt,
        error: genErr.message,
      });
    }
  } catch (err) {
    console.error('[schedule] POST /:id/peek/retake error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/schedule/:characterId/peek — 瞄一眼快照 ──

router.post('/:characterId/peek', async (req, res) => {
  try {
    const characterId = parseInt(req.params.characterId, 10);
    if (isNaN(characterId)) {
      return res.status(400).json({ error: 'invalid characterId' });
    }

    const db = getDb();
    const character = db.prepare('SELECT id, display_name, base_prompt FROM characters WHERE id = ?').get(characterId);
    if (!character) {
      return res.status(404).json({ error: 'character not found' });
    }

    const activity = getCurrentActivity(characterId);
    if (!activity) {
      return res.status(404).json({ error: 'no schedule found for this character' });
    }

    const genImage = req.body?.gen_image !== false; // 默认生成图片

    if (!genImage) {
      return res.json({
        character_id: character.id,
        display_name: character.display_name,
        activity: activity.activity,
        location: activity.location,
        snapshot_prompt: activity.snapshotPrompt,
        image: null,
      });
    }

    // ── 构建 LLM 消息生成专用人像 prompt ──
    const charName = character.display_name;

    // system0: 系统规则(角色扮演=no) + 世界观
    const systemRules = getSystemRules({ roleplay: false });
    const worldSetting = getWorldSetting();
    const system0 = [systemRules, worldSetting].filter(Boolean).join('\n\n');

    // system1: 世界观强化 + 人像摄影师指令
    let system1 = '';
    if (worldSetting) {
      system1 = `<world_integration priority="highest">
上述世界观设定不是可有可无的背景说明——它是这个虚构世界的基本法则。照片必须在这个世界观的框架内拍摄：

1. 照片中的场景、服饰、氛围必须符合世界观。角色的穿着、所处的环境、互动方式，都必须自然地反映这个世界特有的元素。
2. 角色的表情和身体语言以世界观定义的行为基准为参照——什么情绪在这个世界里是"日常"的、什么行为是"出格"的，都由世界观决定。
3. 画面中的每一个视觉元素都应该一致地属于这个世界。世界观不是背景，是地基。
</world_integration>\n\n`;
    }
    // 睡眠中：强制强调闭眼
    const isSleeping = activity.replyDelay === -1;
    // 当前时间 + 时段 + 光线描述
    const { timeStr, timeDesc, lightNote } = getTimeLight();
    const sleepNote = isSleeping
      ? `\n\n【极其重要】角色正在睡觉，双眼必须紧闭，**房间里没有灯光，睡觉时候不开灯**，不能睁眼。表情安详放松，呈现深度睡眠的自然状态，盖被子。睡姿、床、被子、**睡衣（睡觉时候绝对不会穿本来的衣服）**等细节贴合角色性格。`
      : '';

    system1 += `你是一个专业的人像摄影师，你现在需要给「${charName}」拍一张人像照，任意角度（俯拍，仰拍，正脸，侧脸，背面，低角度全都不限制），角色也不看着镜头，表现角色当前正在做的事情。角色表情、动作神态、服饰根据角色人格来生成，要贴合角色气质。当前角色日程是：${activity.activity}，地点：${activity.location}，现在是${timeStr}（${timeDesc}），光线参考：${lightNote}（室内场景以人造光源为主，不必严格遵守）。照片里的角色要体现正在做的日程。${sleepNote}`;

    // system2: 角色完整人格，"你"替换为角色姓名
    const personaText = character.base_prompt
      ? character.base_prompt.replace(/你/g, charName)
      : `角色名：${charName}`;

    // system3: image_prompt 规则作为输出格式指令
    const imageRulesText = getGlobalRule('image_prompt')?.rule_content || '';
    const imageInstruction = parseImagePromptRule(imageRulesText);
    const system3 = `你将画面表达为prompt输出，只输出一个{"prompt":"..."} JSON格式。${imageInstruction ? '\n\n输出格式要求：\n' + imageInstruction : ''}`;

    // user: 拍摄指令
    const userMsg = `请为「${charName}」拍一张当前正在${activity.location}进行${activity.activity}的照片，具体照片表现是${activity.description}`;

    const llmMsgs = [
      { role: 'system', content: system0 },
      { role: 'system', content: system1 },
      { role: 'system', content: personaText },
      { role: 'system', content: system3 },
      { role: 'user', content: userMsg },
    ];

    // 立即返回，异步执行 LLM + 生图
    res.json({
      character_id: character.id,
      display_name: character.display_name,
      activity: activity.activity,
      location: activity.location,
      generating: true,
      message: 'Prompt generation + image generation started, result will be pushed via SSE schedule_peek_ready',
    });

    // 不阻塞响应，异步执行
    try {
      console.log(`[schedule] Peek: generating prompt for ${charName}...`);

      // 调用 LLM 生成专用 prompt
      let generatedPrompt = '';
      try {
        const rawResult = await chatSync(llmMsgs, {
          temperature: 0.7,
          max_tokens: 1024,
          label: '瞄一眼人像prompt生成',
        });

        // 解析 LLM 响应：多层兜底
        const jsonStr = extractFirstJson(rawResult);
        if (jsonStr) {
          try {
            const parsed = JSON.parse(repairJson(jsonStr));
            generatedPrompt = parsed.prompt || '';
          } catch {
            // JSON 解析失败，尝试正则提取
            const promptMatch = rawResult.match(/"prompt"\s*:\s*"([^"]+)"/);
            generatedPrompt = promptMatch ? promptMatch[1] : '';
          }
        } else {
          // 无 JSON，尝试正则提取
          const promptMatch = rawResult.match(/"prompt"\s*:\s*"([^"]+)"/);
          generatedPrompt = promptMatch ? promptMatch[1] : '';
        }

        if (!generatedPrompt) {
          console.warn(`[schedule] Peek prompt parse failed, using fallback. Raw: ${rawResult.slice(0, 200)}`);
          // 兜底：回退到 snapshotPrompt
          generatedPrompt = activity.snapshotPrompt || `${charName} doing ${activity.activity} at ${activity.location}`;
        }
      } catch (llmErr) {
        console.error(`[schedule] Peek LLM failed for ${charName}:`, llmErr.message);
        // LLM 失败兜底
        generatedPrompt = activity.snapshotPrompt || `${charName} doing ${activity.activity} at ${activity.location}`;
      }

      console.log(`[schedule] Peek prompt for ${charName}: "${generatedPrompt.slice(0, 120)}..."`);

      // 用奇遇事件参数生图
      const result = await generateImage(generatedPrompt, {
        artist: config.comfyui.eventArtist,
        width: config.comfyui.eventWidth,
        height: config.comfyui.eventHeight,
        onProgress: (p) => {
          if (p.progress != null) {
            broadcast('schedule_peek_progress', {
              character_id: character.id,
              progress: Math.round(p.progress * 100),
            });
          }
        },
      });

      if (result.success && result.images?.length > 0) {
        // 图片落盘，通过 URL 发送（base64 过大可能导致 SSE 写失败）
        const img = result.images[0];
        const imageUrl = savePeekImage(img.base64, img.filename || 'comfy');
        broadcast('schedule_peek_ready', {
          character_id: character.id,
          display_name: character.display_name,
          activity: activity.activity,
          location: activity.location,
          prompt: generatedPrompt,
          images: imageUrl ? [imageUrl] : [img.base64], // 落盘失败则仍然传 base64 兜底
        });
        console.log(`[schedule] Peek snapshot ready for ${charName}`);
      } else {
        broadcast('schedule_peek_ready', {
          character_id: character.id,
          display_name: character.display_name,
          prompt: generatedPrompt,
          error: result.error || 'Image generation failed',
        });
      }
    } catch (genErr) {
      console.error(`[schedule] Peek snapshot failed for ${charName}:`, genErr.message);
      broadcast('schedule_peek_ready', {
        character_id: character.id,
        display_name: character.display_name,
        error: genErr.message,
      });
    }
  } catch (err) {
    console.error('[schedule] POST /:id/peek error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/schedule/:characterId/regenerate — 重新生成日程 ──

router.post('/:characterId/regenerate', async (req, res) => {
  try {
    const characterId = parseInt(req.params.characterId, 10);
    if (isNaN(characterId)) {
      return res.status(400).json({ error: 'invalid characterId' });
    }

    const db = getDb();
    const character = db.prepare('SELECT id, display_name, base_prompt FROM characters WHERE id = ?').get(characterId);
    if (!character) {
      return res.status(404).json({ error: 'character not found' });
    }

    console.log(`[schedule] Regenerating schedule for ${character.display_name}...`);

    // 生成新模板
    const result = await generateSchedule(character);

    // 分配下次刷新时间
    assignNextRefreshTime(characterId);

    // 快照到今天
    snapshotTodaySchedule(characterId);

    // 同步睡眠状态
    syncSleepingState(characterId);

    // 清除缓存
    invalidateCache(characterId);

    res.json({
      success: true,
      character_id: character.id,
      display_name: character.display_name,
      version: result.version,
      message: 'Schedule regenerated',
    });
  } catch (err) {
    console.error('[schedule] POST /:id/regenerate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/schedule/queue/status — 调试：队列概览 ──

router.get('/queue/status', (req, res) => {
  try {
    const db = getDb();

    const waiting = db.prepare(
      "SELECT COUNT(*) as count FROM reply_queue WHERE status = 'waiting'"
    ).get();

    const processing = db.prepare(
      "SELECT COUNT(*) as count FROM reply_queue WHERE status = 'processing'"
    ).get();

    const byChar = db.prepare(`
      SELECT c.display_name, rq.status, COUNT(*) as count
      FROM reply_queue rq
      JOIN characters c ON c.id = rq.character_id
      GROUP BY rq.character_id, rq.status
      ORDER BY c.display_name, rq.status
    `).all();

    const nextDue = db.prepare(`
      SELECT rq.id, c.display_name, rq.scheduled_reply_at, rq.delay_minutes, rq.status
      FROM reply_queue rq
      JOIN characters c ON c.id = rq.character_id
      WHERE rq.status = 'waiting'
      ORDER BY rq.scheduled_reply_at ASC
      LIMIT 5
    `).all();

    res.json({
      waiting: waiting.count,
      processing: processing.count,
      by_character: byChar,
      next_due: nextDue,
    });
  } catch (err) {
    console.error('[schedule] GET /queue/status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
