/**
 * 日程 API 路由
 *
 * GET    /api/schedule                         — 所有角色日程概览
 * GET    /api/schedule/:characterId            — 指定角色完整今日日程
 * GET    /api/schedule/:characterId/current    — 当前活动（轻量）
 * POST   /api/schedule/:characterId/peek       — 瞄一眼快照（异步生图）
 * POST   /api/schedule/:characterId/regenerate — 强制重新生成日程
 * GET    /api/schedule/queue/status            — 调试：查看队列概览
 */

import { Router } from 'express';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import {
  getTodaySchedule, getCurrentActivity,
  getAllOverview, ensureTodaySchedule, invalidateCache,
} from '../services/scheduleManager.js';
import { generateSchedule, assignNextRefreshTime, snapshotTodaySchedule } from '../services/scheduleGenerator.js';
import { generateImage } from '../services/imageSkill.js';
import { broadcast } from '../services/unifiedStreamBus.js';

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
      // 不生成图片，仅返回当前活动信息
      return res.json({
        character_id: character.id,
        display_name: character.display_name,
        activity: activity.activity,
        location: activity.location,
        snapshot_prompt: activity.snapshotPrompt,
        image: null,
      });
    }

    // 异步生成图片
    res.json({
      character_id: character.id,
      display_name: character.display_name,
      activity: activity.activity,
      location: activity.location,
      snapshot_prompt: activity.snapshotPrompt,
      generating: true,
      message: 'Image generation started, result will be pushed via SSE schedule_peek_ready',
    });

    // 不阻塞响应，异步生图
    try {
      // 构建 snapshot prompt：角色当前活动 + 角色外观描述
      const appearanceMatch = character.base_prompt?.match(/你的外观[\s\S]*/);
      const appearanceHint = appearanceMatch
        ? appearanceMatch[0].replace(/你/g, '角色').slice(0, 200)
        : '';

      const fullPrompt = [
        activity.snapshotPrompt,
        appearanceHint,
      ].filter(Boolean).join(', ');

      console.log(`[schedule] Peek snapshot for ${character.display_name}: "${fullPrompt.slice(0, 100)}..."`);

      const result = await generateImage(fullPrompt);

      if (result.success && result.images?.length > 0) {
        broadcast('schedule_peek_ready', {
          character_id: character.id,
          display_name: character.display_name,
          activity: activity.activity,
          location: activity.location,
          images: result.images.map(img => img.base64),
        });
        console.log(`[schedule] Peek snapshot ready for ${character.display_name}`);
      } else {
        broadcast('schedule_peek_ready', {
          character_id: character.id,
          display_name: character.display_name,
          error: result.error || 'Image generation failed',
        });
      }
    } catch (genErr) {
      console.error(`[schedule] Peek snapshot failed for ${character.display_name}:`, genErr.message);
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
