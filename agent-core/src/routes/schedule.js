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
 * POST   /api/schedule/:characterId/wake-up-phone — 电话叫醒（40% 概率，最多 3 次）
 * POST   /api/schedule/:characterId/wake-up-door — 上门摇醒（必定成功）
 * GET    /api/schedule/queue/status            — 调试：查看队列概览
 */

import { Router } from 'express';
import { getDb, getSystemRules, getWorldSetting, getGlobalRule } from '../db/index.js';
import { appendOathRing } from '../services/oathUtils.js';
import { config } from '../config.js';
import {
  getTodaySchedule, getCurrentActivity,
  getAllOverview, ensureTodaySchedule, invalidateCache,
  syncSleepingState, isTempWoken, isSleeping,
  scheduleTempWakeExpiry, resetGroggyShown,
} from '../services/scheduleManager.js';
import { generateSchedule, assignNextRefreshTime, snapshotTodaySchedule } from '../services/scheduleGenerator.js';
import { generateImage, getLastWorkflowMode } from '../services/imageSkill.js';
import { broadcast } from '../services/unifiedStreamBus.js';
import { chatSync } from '../llm/llm-client.js';
import { getTimeLightInline } from '../services/timeLight.js';
import { saveBase64Image } from '../services/imagePaths.js';
import { processWakeUp } from '../services/wakeService.js';

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
let resetTask = null; // { cancelled, processing, current, total, currentName }

// ── POST /api/schedule/regenerate-all — 重置世界线（重新生成所有角色日程）──
router.post('/regenerate-all', async (req, res) => {
  try {
    if (resetTask?.processing) {
      return res.status(409).json({ error: '重置世界线正在进行中', busy: true });
    }

    const db = getDb();
    const characters = db.prepare("SELECT id, display_name, base_prompt FROM characters WHERE name != 'default' ORDER BY id").all();

    if (!characters.length) {
      return res.status(404).json({ error: '没有角色' });
    }

    const direction = (req.body && req.body.direction) ? String(req.body.direction).trim() : null;

    resetTask = { cancelled: false, processing: true, current: 0, lastCompleted: 0, total: characters.length, currentName: '' };

    // 立即返回，不阻塞
    res.json({ started: true, total: characters.length });

    // 异步逐个生成
    for (let i = 0; i < characters.length; i++) {
      if (resetTask.cancelled) break;

      const character = characters[i];
      resetTask.current = i + 1;
      resetTask.currentName = character.display_name;

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
        const result = await generateSchedule(character, direction);

        // 生成期间已被取消 → 不保存、广播跳过
        if (resetTask.cancelled) break;

        assignNextRefreshTime(character.id);
        snapshotTodaySchedule(character.id);
        syncSleepingState(character.id);
        invalidateCache(character.id);

        resetTask.lastCompleted = i + 1;

        broadcast('schedule_reset_progress', {
          phase: 'running',
          character_name: character.display_name,
          current: i + 1,
          total: characters.length,
          status: 'done',
          version: result.version,
        });
      } catch (genErr) {
        // 生成失败但已被取消 → 直接跳出
        if (resetTask.cancelled) break;

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

    const finalCurrent = resetTask.cancelled ? resetTask.lastCompleted : resetTask.current;

    // 广播完成
    broadcast('schedule_reset_progress', {
      phase: resetTask.cancelled ? 'cancelled' : 'complete',
      current: finalCurrent,
      total: characters.length,
      cancelled: resetTask.cancelled,
    });

    console.log(`[schedule] Reset worldline finished. Processed: ${finalCurrent}/${characters.length}, cancelled: ${resetTask.cancelled}`);
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

// ── GET /api/schedule/reset-status — 查询当前重置任务状态（页面刷新恢复用）──
router.get('/reset-status', (req, res) => {
  if (!resetTask?.processing) {
    return res.json({ active: false });
  }
  res.json({
    active: true,
    phase: 'running',
    current: resetTask.current,
    total: resetTask.total,
    currentName: resetTask.currentName || '',
  });
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

/** 将 base64 图片落盘，返回对外可访问的 URL 路径 */
function savePeekImage(base64, filename) {
  try {
    const ext = base64.match(/^data:image\/(\w+);base64,/)?.[1] || 'png';
    const safeName = `peek_${filename}_${Date.now()}.${ext}`;
    const url = saveBase64Image('peek', safeName, base64);
    console.log(`[schedule] Peek image saved: ${safeName} → ${url}`);
    return url;
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
    const character = db.prepare('SELECT id, display_name, custom_workflow, loras FROM characters WHERE id = ?').get(characterId);
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

    // 异步生图，使用日程事件参数
    try {
      const result = await generateImage(prompt, {
        artist: config.comfyui.eventArtist,
        width: config.comfyui.eventWidth,
        height: config.comfyui.eventHeight,
        scene: 'schedule',
        priority: 'high',
        ...(() => {
          const chLoras = _parseLoras(character.loras);
          const opts = {};
          if (character.custom_workflow) opts.customWorkflow = character.custom_workflow;
          if (chLoras.length > 0) opts.loras = chLoras;
          return opts;
        })(),
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
        if (imageUrl) {
          db.prepare(`INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status, output_paths, workflow_template, finished_at)
            VALUES (?, ?, ?, 'done', ?, ?, datetime('now'))`)
            .run('schedule_peek_retake', prompt, prompt, JSON.stringify([imageUrl]), getLastWorkflowMode());
        }
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
    const character = db.prepare('SELECT id, display_name, base_prompt, custom_workflow, loras FROM characters WHERE id = ?').get(characterId);
    if (!character) {
      return res.status(404).json({ error: 'character not found' });
    }

    const reqActivity = req.body?.activity;
    let activity;
    if (reqActivity && reqActivity.activity && reqActivity.location) {
      activity = {
        activity: reqActivity.activity,
        location: reqActivity.location,
        replyDelay: reqActivity.replyDelay ?? 0,
        snapshotPrompt: reqActivity.snapshotPrompt || '',
        description: reqActivity.description || '',
        startTime: reqActivity.startTime || '',
        endTime: reqActivity.endTime || '',
        tags: reqActivity.tags || [],
      };
    } else {
      activity = getCurrentActivity(characterId);
    }
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
    // 睡眠中：强制强调闭眼（优先检查临时叫醒，因为日程 replyDelay 即使叫醒后仍为 -1）
    const tempWoken = isTempWoken(characterId);
    const isSleeping = !tempWoken && activity.replyDelay === -1;
    // 当前时间 + 时段 + 光线描述（使用日程活动的 startTime 确定光线，反映活动实际发生时间而非墙钟）
    let lightTime = new Date();
    if (activity.startTime) {
      const [h, m] = activity.startTime.split(':').map(Number);
      if (!isNaN(h)) {
        lightTime = new Date();
        lightTime.setHours(h, m || 0, 0, 0);
      }
    }
    const timeLightInline = getTimeLightInline(lightTime);
    const sleepNote = isSleeping
      ? `\n\n【极其重要】角色正在睡觉，双眼必须紧闭，**房间里没有灯光，睡觉时候不开灯**，不能睁眼。表情安详放松，呈现深度睡眠的自然状态，盖被子。睡姿、床、被子、**睡衣（睡觉时候绝对不会穿本来的衣服）**等细节贴合角色性格。`
      : '';

    // 临时叫醒时覆盖活动描述（日程数据仍是睡觉，与实际不符）
    let effectiveActivity = activity.activity;
    let effectiveDescription = activity.description;
    let wakeNote = '';
    if (tempWoken) {
      const wakeMode = db.prepare('SELECT wake_mode FROM characters WHERE id = ?').get(characterId)?.wake_mode;
      const userName = config.user.nickname || '用户';
      if (wakeMode === 'phone') {
        effectiveActivity = '被电话吵醒';
        effectiveDescription = '半睁着眼看着手机，睡眼惺忪，正在打哈欠';
        wakeNote = `\n\n【注意】角色刚被${userName}的电话吵醒，处于半睡半醒的迷糊状态。双眼半睁半合，睡眼惺忪，头发凌乱，**穿着睡衣（睡觉时候绝对不会穿本来的衣服）**，正在打哈欠。手机屏幕的亮光照在角色脸上，角色靠在床上或枕头上看着手机屏幕。表情困倦慵懒，展现出被吵醒后的迷蒙感。`;
      } else if (wakeMode === 'door' || wakeMode === 'shake') {
        const userAppearance = config.user.appearance ? `（${config.user.appearance}）` : '';
        effectiveActivity = '被各种方式叫醒/晃醒/摇醒/拖拽等姿势';
        effectiveDescription = `被${userName}${userAppearance}从床上被各种方式叫醒/晃醒/摇醒/拖拽等姿势弄醒的瞬间`;
        wakeNote = `\n\n【注意】画面中是${userName}${userAppearance}上门把角色从床上摇醒的场景。角色半坐在床上，睡眼惺忪地睁开眼，表情懵懂迷糊。${userName}${userAppearance}正俯身或弯腰，${userName}的手搭在角色任意部位，把角色晃醒或者摇醒或者拖拉拽弄醒。角色穿着**穿着睡衣（睡觉时候绝对不会穿本来的衣服）**，被子半掀开，展现了刚被强行弄醒的瞬间动态。`;
      }
    }

    system1 += `你是一个专业的人像摄影师，你现在需要给「${charName}」拍一张人像照，任意角度（俯拍，仰拍，正脸，侧脸，背面，低角度全都不限制），角色也不看着镜头，表现角色当前正在做的事情。角色表情、动作神态、服饰根据角色人格来生成，要贴合角色气质。当前角色日程是：${effectiveActivity}，地点：${activity.location}，${timeLightInline}。照片里的角色要体现正在做的日程。${sleepNote}${wakeNote}`;

    // system2: 角色完整人格，"你"替换为角色姓名
    let personaText = character.base_prompt
      ? character.base_prompt.replace(/你/g, charName)
      : `角色名：${charName}`;

    // 誓约角色：银白细戒指外观细节
    const ringUserName = config.user?.nickname || 'user';
    personaText = appendOathRing(personaText, characterId, ringUserName, { isFirstPerson: false, charName });

    // system3: image_prompt 规则作为 prompt 画质指令
    const imageRulesText = getGlobalRule('image_prompt')?.rule_content || '';
    const system3 = `直接输出英文画面描述，不要任何格式包装或额外文字。${imageRulesText ? '\n\n输出要求：\n' + imageRulesText : ''}`;

    // event: 角色当前奇遇注入
    const activeEvent = db.prepare(`
      SELECT title, description, choice_history FROM character_events
      WHERE character_id = ? AND status IN ('pending','open','engaged')
      ORDER BY created_at DESC LIMIT 1
    `).get(characterId);

    // user: 拍摄指令
    const userMsg = `请为「${charName}」拍一张当前正在${activity.location}进行${effectiveActivity}的照片，具体照片表现是${effectiveDescription}`;

    const llmMsgs = [
      { role: 'system', content: system0 },
      { role: 'system', content: system1 },
    ];
    if (activeEvent) {
      const choiceHistory = JSON.parse(activeEvent.choice_history || '[]');
      const branchCount = choiceHistory.length - 1;
      llmMsgs.push({
        role: 'system',
        content: `【当前奇遇事件】角色正在经历一场奇遇事件——「${activeEvent.title}」。\n当前场景：${activeEvent.description}\n${branchCount > 0 ? `已推进了 ${branchCount} 步。` : '事件刚刚开始。'}\n人像照中角色的表情和神态应反映出当前奇遇事件带来的情绪。`,
      });
    }
    llmMsgs.push(
      { role: 'system', content: personaText },
      { role: 'system', content: system3 },
      { role: 'user', content: userMsg },
    );

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

        // 提取 prompt：纯文本优先，JSON 格式向后兼容
        let text = rawResult.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        if (text.length >= 5) {
          generatedPrompt = text;
        }
        // 兜底：如果 LLM 仍输出了 {"prompt":"..."} JSON 格式
        if (!generatedPrompt) {
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

      // 用日程事件参数生图
      const result = await generateImage(generatedPrompt, {
        artist: config.comfyui.eventArtist,
        width: config.comfyui.eventWidth,
        height: config.comfyui.eventHeight,
        scene: 'schedule',
        priority: 'high',
        ...(() => {
          const chLoras = _parseLoras(character.loras);
          const opts = {};
          if (character.custom_workflow) opts.customWorkflow = character.custom_workflow;
          if (chLoras.length > 0) opts.loras = chLoras;
          return opts;
        })(),
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
        if (imageUrl) {
          db.prepare(`INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status, output_paths, workflow_template, finished_at)
            VALUES (?, ?, ?, 'done', ?, ?, datetime('now'))`)
            .run('schedule_peek', generatedPrompt, generatedPrompt, JSON.stringify([imageUrl]), getLastWorkflowMode());
        }
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

    const direction = (req.body && req.body.direction) ? String(req.body.direction).trim() : null;

    console.log(`[schedule] Regenerating schedule for ${character.display_name}${direction ? ` (direction: ${direction.slice(0, 50)}...)` : ''}...`);

    // 生成新模板
    const result = await generateSchedule(character, direction);

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

// ── POST /api/schedule/:characterId/clear — 清空角色所有日程 ──

router.post('/:characterId/clear', (req, res) => {
  try {
    const characterId = parseInt(req.params.characterId, 10);
    if (isNaN(characterId)) {
      return res.status(400).json({ error: 'invalid characterId' });
    }

    const db = getDb();
    const character = db.prepare('SELECT id, display_name FROM characters WHERE id = ?').get(characterId);
    if (!character) {
      return res.status(404).json({ error: 'character not found' });
    }

    // 清空日程数据
    db.prepare('DELETE FROM daily_schedules WHERE character_id = ?').run(characterId);
    db.prepare('DELETE FROM schedule_templates WHERE character_id = ?').run(characterId);

    // 标记角色不再自动生成日程
    db.prepare(`
      UPDATE characters SET
        schedule_enabled = 0,
        next_schedule_refresh_at = NULL,
        is_sleeping = 0,
        sleep_until = NULL
      WHERE id = ?
    `).run(characterId);

    // 清除内存缓存
    invalidateCache(characterId);

    console.log(`[schedule] Cleared all schedule data for ${character.display_name}`);
    res.json({ success: true, character_id: character.id, display_name: character.display_name });
  } catch (err) {
    console.error('[schedule] POST /:id/clear error:', err.message);
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

// ── POST /api/schedule/:characterId/wake-up-phone — 电话叫醒（40% 概率，最多 3 次）──

router.post('/:id/wake-up-phone', async (req, res) => {
  try {
    const db = getDb();
    const characterId = parseInt(req.params.id, 10);

    const char = db.prepare(`SELECT id, display_name, is_sleeping, wake_attempts, temporary_wake_until FROM characters WHERE id = ?`).get(characterId);
    if (!char) return res.status(404).json({ error: 'Character not found' });

    // 已经在临时唤醒中
    if (isTempWoken(characterId)) {
      return res.json({ success: false, message: 'already awake', attempts: char.wake_attempts });
    }

    // 统一判定（含日程 fallback）：DB 缓存列可能滞后于日程
    const sleepState = isSleeping(characterId);
    if (!sleepState.sleeping) {
      return res.json({ success: false, message: 'not sleeping' });
    }
    // DB 缓存列滞后 → 顺手同步，保证后续写库路径状态一致
    // 同步可能重置叫醒列（新睡眠周期），重读最新值
    let wakeAttemptsNow = char.wake_attempts || 0;
    if (char.is_sleeping !== 1) {
      syncSleepingState(characterId);
      wakeAttemptsNow = db.prepare('SELECT wake_attempts FROM characters WHERE id = ?').get(characterId)?.wake_attempts || 0;
    }

    // 已到 3 次电话上限 → 短路，不再自增，只允许上门摇醒
    if (wakeAttemptsNow >= 3) {
      console.log(`[schedule] ${char.display_name} phone wake: capped at 3 → suggest door`);
      return res.json({
        success: false,
        attempts: 3,
        door_wake_available: true,
      });
    }

    // 原子增 count（防快速双击竞态）
    db.prepare('UPDATE characters SET wake_attempts = wake_attempts + 1 WHERE id = ?').run(characterId);
    const attempts = db.prepare('SELECT wake_attempts FROM characters WHERE id = ?').get(characterId).wake_attempts || 1;

    // 并发窗口内已被别处叫醒 → 幂等返回
    if (isTempWoken(characterId)) {
      return res.json({ success: false, message: 'already awake', attempts });
    }

    // 40% 概率叫醒
    const rolled = Math.random();
    if (rolled < 0.4) {
      console.log(`[schedule] ${char.display_name} phone wake #${attempts}: rolled=${rolled.toFixed(3)} < 0.4 → success`);
      // 临时唤醒 5~15 分钟
      const tempMinutes = 5 + Math.floor(Math.random() * 11);
      const tempWakeUntil = new Date(Date.now() + tempMinutes * 60000)
        .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');

      // 原子写库：仅当角色不在有效临时唤醒中才生效（防多入口双触发）
      const claimed = db.prepare(`
        UPDATE characters SET is_sleeping = 0, sleep_until = NULL, temporary_wake_until = ?, wake_mode = ?, wake_attempts = 0
        WHERE id = ? AND (temporary_wake_until IS NULL OR temporary_wake_until <= datetime('now'))
      `).run(tempWakeUntil, 'phone', characterId);
      if (claimed.changes === 0) {
        return res.json({ success: false, message: 'already awake', attempts });
      }

      // 立即注册到期定时器（不依赖 processWakeUp 成功，避免状态卡死）
      scheduleTempWakeExpiry(characterId, tempWakeUntil);
      // 重置 groggy 一次性提示标记：本次唤醒周期内首条聊天消息注入一次
      resetGroggyShown(characterId);

      // 异步处理叫醒（不阻塞响应）
      processWakeUp(characterId, 'phone', attempts).catch(err => {
        console.error(`[schedule] Wake-up processing failed for ${char.display_name}:`, err.message);
      });

      return res.json({
        success: true,
        attempts,
        temporary_wake_until: tempWakeUntil,
        temp_minutes: tempMinutes,
      });
    }

    // 叫醒失败
    console.log(`[schedule] ${char.display_name} phone wake #${attempts}: rolled=${rolled.toFixed(3)} >= 0.4 → miss`);
    return res.json({
      success: false,
      attempts,
      door_wake_available: attempts >= 3,
    });
  } catch (err) {
    console.error('[schedule] POST /wake-up-phone error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/schedule/:characterId/wake-up-door — 上门摇醒（必定成功）──

router.post('/:id/wake-up-door', async (req, res) => {
  try {
    const db = getDb();
    const characterId = parseInt(req.params.id, 10);

    const char = db.prepare(`SELECT id, display_name, is_sleeping, was_door_woken, temporary_wake_until FROM characters WHERE id = ?`).get(characterId);
    if (!char) return res.status(404).json({ error: 'Character not found' });

    // 已经在临时唤醒中
    if (isTempWoken(characterId)) {
      return res.json({ success: false, message: 'already awake' });
    }

    // 统一判定（含日程 fallback）：DB 缓存列可能滞后于日程
    const sleepState = isSleeping(characterId);
    if (!sleepState.sleeping) {
      return res.json({ success: false, message: 'not sleeping' });
    }
    // 同步可能重置叫醒列（新睡眠周期），重读最新值
    let wasDoorWoken = char.was_door_woken;
    if (char.is_sleeping !== 1) {
      syncSleepingState(characterId);
      wasDoorWoken = db.prepare('SELECT was_door_woken FROM characters WHERE id = ?').get(characterId)?.was_door_woken;
    }

    // 判定模式: 之前上门摇醒过 → 'shake'，否则 'door'
    const mode = wasDoorWoken === 1 ? 'shake' : 'door';

    console.log(`[schedule] ${char.display_name} door wake → mode=${mode}`);

    // 临时唤醒 5~15 分钟
    const tempMinutes = 5 + Math.floor(Math.random() * 11);
    const tempWakeUntil = new Date(Date.now() + tempMinutes * 60000)
      .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');

    // 原子写库：仅当角色不在有效临时唤醒中才生效（防多入口双触发）
    const claimed = db.prepare(`
      UPDATE characters SET is_sleeping = 0, sleep_until = NULL, was_door_woken = 1, temporary_wake_until = ?, wake_mode = ?, wake_attempts = 0
      WHERE id = ? AND (temporary_wake_until IS NULL OR temporary_wake_until <= datetime('now'))
    `).run(tempWakeUntil, mode, characterId);
    if (claimed.changes === 0) {
      return res.json({ success: false, message: 'already awake' });
    }

    // 立即注册到期定时器（不依赖 processWakeUp 成功，避免状态卡死）
    scheduleTempWakeExpiry(characterId, tempWakeUntil);
    // 重置 groggy 一次性提示标记：本次唤醒周期内首条聊天消息注入一次
    resetGroggyShown(characterId);

    // 异步处理叫醒
    processWakeUp(characterId, mode, null).catch(err => {
      console.error(`[schedule] Door-wake processing failed for ${char.display_name}:`, err.message);
    });

    return res.json({
      success: true,
      mode,
      temporary_wake_until: tempWakeUntil,
      temp_minutes: tempMinutes,
    });
  } catch (err) {
    console.error('[schedule] POST /wake-up-door error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function _parseLoras(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return [];
}

export default router;
