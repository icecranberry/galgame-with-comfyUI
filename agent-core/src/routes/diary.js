/**
 * 角色日记路由。
 *
 *   GET    /api/diaries/:characterId            当日（或指定日期）日记
 *   GET    /api/diaries/:characterId/history    历史日记简目（翻页导航）
 *   POST   /api/diaries/:characterId/generate   生成 / 重新生成（后台，SSE 推送进度）
 *
 * 生成走后台：请求立刻返回，进度与结果通过 unifiedStream 的 diary_* 事件推送，
 * 右下角生成提示由 image_edit_task_* 事件承担（见 diaryGenerator）。
 */

import { Router } from 'express';
import { getDiary, listDiaries, startDiaryGeneration, isDiaryGenerating } from '../services/diaryGenerator.js';
import { getLocalDateKey } from '../utils/localDate.js';

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseCharacterId(req, res) {
  const id = Number(req.params.characterId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: '无效的角色 ID' });
    return null;
  }
  return id;
}

function parseDate(value) {
  return typeof value === 'string' && DATE_RE.test(value) ? value : null;
}

// GET /api/diaries/:characterId?date=YYYY-MM-DD
router.get('/:characterId', (req, res) => {
  const characterId = parseCharacterId(req, res);
  if (characterId === null) return;
  const dateKey = parseDate(req.query.date) || getLocalDateKey();
  res.json({
    date: dateKey,
    generating: isDiaryGenerating(characterId, dateKey),
    diary: getDiary(characterId, dateKey),
  });
});

// GET /api/diaries/:characterId/history?limit=60
router.get('/:characterId/history', (req, res) => {
  const characterId = parseCharacterId(req, res);
  if (characterId === null) return;
  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 365) : 60;
  res.json({ diaries: listDiaries(characterId, limit) });
});

// POST /api/diaries/:characterId/generate  body: { date? }
router.post('/:characterId/generate', (req, res) => {
  const characterId = parseCharacterId(req, res);
  if (characterId === null) return;
  const dateKey = parseDate(req.body?.date) || undefined;
  try {
    const result = startDiaryGeneration(characterId, { date: dateKey });
    res.status(result.started ? 202 : 200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '日记生成启动失败' });
  }
});

export default router;
