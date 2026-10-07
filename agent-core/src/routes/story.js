/**
 * 「故事」页接口（T2，2026-10-07）。
 *
 * 走 `routes/_autoMount.js` 约定式挂载 → `/api/story`（无需改 app.js）。
 * 迁移走得 `src/db/migrations/`（无需改 db/index.js）。
 *
 * ── 本期范围（按用户裁定"分期"，第一期只做数据层 + 列表）──────
 * ✅ 线的 CRUD、阶段推进、人工锁线、节点图数据（自动算边）
 * ⬜ 前端「故事」页与节点图渲染（第二期）
 * ⬜ 与奇遇衔接（第三期，用户已明确"不碰奇遇"）
 */

import { Router } from 'express';
import {
  LINE_STAGES, TERMINAL_LINE_STAGES, AUTO_LINE_CAPACITY, GRAPH_NODE_LIMIT,
  listEventLines, getEventLine, createEventLine, updateEventLine, deleteEventLine,
  setEventLinePin, buildLineGraph, listParticipantOptions, listPlaceOptions,
  generateEventLineDraft,
} from '../services/story/eventLineService.js';

const router = Router();

/** 阶段与容量的**唯一真源**随接口下发（前端只渲染，不自建一份 —— 红线 8） */
router.get('/meta', (req, res) => {
  res.json({
    stages: LINE_STAGES,
    terminalStages: TERMINAL_LINE_STAGES,
    capacity: AUTO_LINE_CAPACITY,
    graphNodeLimit: GRAPH_NODE_LIMIT,
  });
});

/**
 * 编辑表单的候选数据（2026-10-07 用户要求：涉及角色/地点改为可检索多选）。
 * 角色候选**已排除归档角色**；地点候选来自世界地图（唯一真源）。
 */
router.get('/options', (req, res) => {
  try {
    res.json({ participants: listParticipantOptions(), places: listPlaceOptions() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/lines', (req, res) => {
  try {
    res.json({ lines: listEventLines() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 节点图数据：节点=事件线，边=**代码自动算**的结构性关联（不让 AI 生成）。
 *
 * ── 筛选（第二期）─────────────────────────────────────────
 * query: `participantId`（只看某角色卷入的线）、`includeTerminal=0`（排除终态线）。
 * ⚠ 筛选在服务层完成（"选节点 + 算边"必须原子，否则产生指向隐藏节点的悬空边）。
 * ⚠ 不传 query 时与加筛选前行为一致（红线 4）；响应含 `total/truncated` 以**显式**告知上限截断（红线 0）。
 */
router.get('/graph', (req, res) => {
  try {
    const q = req.query || {};
    res.json(buildLineGraph({
      participantId: q.participantId != null && q.participantId !== '' ? Number(q.participantId) : null,
      // ⚠ 只有**显式**传 `includeTerminal=0/false` 才排除终态；缺省保持"含全部"（默认不改行为）
      includeTerminal: q.includeTerminal === undefined || q.includeTerminal === ''
        ? true
        : !/^(0|false|no)$/i.test(String(q.includeTerminal)),
      limit: q.limit != null && q.limit !== '' ? Number(q.limit) : undefined,
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/lines/:id', (req, res) => {
  const line = getEventLine(req.params.id);
  if (!line) return res.status(404).json({ error: '事件线不存在' });
  res.json({ line });
});

router.post('/lines', (req, res) => {
  try {
    const line = createEventLine(req.body || {});
    res.json({ ok: true, line });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/lines/:id', (req, res) => {
  try {
    const line = updateEventLine(req.params.id, req.body || {});
    res.json({ ok: true, line });
  } catch (err) {
    const code = /不存在/.test(err.message) ? 404 : 400;
    res.status(code).json({ error: err.message });
  }
});

/** 人工锁线（开关）。锁上后 AI 不得改动本线 —— 与 T1/T3 同取向的保护 */
router.put('/lines/:id/pin', (req, res) => {
  const ok = setEventLinePin(req.params.id, req.body?.pin === true || req.body?.pin === 1);
  if (!ok) return res.status(404).json({ error: '事件线不存在' });
  res.json({ ok: true, line: getEventLine(req.params.id) });
});

router.delete('/lines/:id', (req, res) => {
  const ok = deleteEventLine(req.params.id);
  if (!ok) return res.status(404).json({ error: '事件线不存在' });
  res.json({ ok: true });
});

/**
 * AI 生成事件线草稿（用户要求「需要一个 AI 生成按钮」）。
 *
 * ★ 只出草稿、**不落库** —— 与「修正地点」「修正外观」同一范式：
 *   结果回给前端填进编辑表单，用户可改，点「保存」才写库。
 * ⚠ **必须放在 `/lines/:id` 之前**声明也不影响（路径不同），但保持"具体路径在前"的习惯。
 */
router.post('/generate', async (req, res) => {
  try {
    const draft = await generateEventLineDraft(req.body || {});
    res.json({ ok: true, draft });
  } catch (err) {
    const code = err.statusCode || (/请先写下/.test(err.message) ? 400 : 502);
    res.status(code).json({ error: err.message });
  }
});

export default router;