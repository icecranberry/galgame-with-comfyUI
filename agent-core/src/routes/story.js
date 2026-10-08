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
  // 「面 → 线」弱关联（2026-10-07）
  findBeatsReferencingLine, renameLineInOutlineRaw,
} from '../services/story/eventLineService.js';
// 「面」= 剧情大纲（构画「点线面」的第三块）
import {
  getOutline, saveOutline, setOutlineCursor, setOutlinePin,
  updateBeatScene, deleteBeat, clearOutline,
  generateOutlineDraft, judgeOutlineAdvance,
  // 字段化编辑器（2026-10-07 用户口径：生成模块照「新建事件线」做）
  getOutlineForEditor, saveOutlineFromEditor, refineOutlineBeat,
} from '../services/story/outlineService.js';

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

// ══════════════════════════════════════════════════════════
// 「面」= 剧情大纲（构画「点线面」第三块）
//
// ★ 与「线」的关系：线是"某条线索怎么走"，面是"整个故事往哪走"。
//   面的 Beat 里有「所属故事线」一栏可指向线名 —— **用名字不用外键**（线可删，大纲是历史产物）。
// ══════════════════════════════════════════════════════════

/**
 * 读「字段化编辑器」载荷（含各节点原文块，供"未改动即原样保留"）。
 * ⚠ 必须声明在 `/outline/line-refs` 之类的**具体路径**之外无所谓（路径不冲突），
 *   但保持"具体在前"的书写习惯。
 */
router.get('/outline/editor', (req, res) => {
  try {
    res.json({ editor: getOutlineForEditor() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 读当前大纲（含 Beat 序列与游标） */
router.get('/outline', (req, res) => {
  try {
    res.json({ outline: getOutline() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * AI 生成大纲草稿（**只出草稿不落库** —— 与「修正地点」「AI 生成事件线」同一范式）。
 * 响应里同时给 `raw` 与解析后的 `beats`，前端可先展示再由用户决定保存。
 * ★ 2026-10-07：可带 `participantIds` / `places`（与「新建事件线」同构的上下文）。
 */
router.post('/outline/generate', async (req, res) => {
  try {
    const draft = await generateOutlineDraft(req.body || {});
    res.json({ ok: true, draft });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/**
 * 细化**某一个**节点（只出草稿，不落库、不动其他节点、不动游标）。
 * 字段化编辑器的「✨ 重写这个节点」入口用。
 */
router.post('/outline/beat/refine', async (req, res) => {
  try {
    res.json({ ok: true, draft: await refineOutlineBeat(req.body || {}) });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/**
 * 从**字段化编辑器**保存（服务端统一序列化，未改动节点逐字节保留）。
 * ⚠ 与 `PUT /outline` 的区别：那个收完整 `raw`（历史入口，保留兼容），
 *   这个收「哪些节点改成了什么」。
 */
router.put('/outline/editor', (req, res) => {
  try {
    res.json({ ok: true, outline: saveOutlineFromEditor(req.body || {}) });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/** 保存大纲（首次生成或整体替换） */
router.put('/outline', (req, res) => {
  try {
    res.json({ ok: true, outline: saveOutline(req.body || {}) });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/** 人工改游标（重定位到第 N 个节点） */
router.put('/outline/cursor', (req, res) => {
  try {
    res.json({ ok: true, outline: setOutlineCursor(req.body?.cursor) });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/** 人工锁定：锁上后不参与自动推进（构画的人工锁线保护） */
router.put('/outline/pin', (req, res) => {
  try {
    res.json({ ok: true, outline: setOutlinePin(req.body?.pin === true || req.body?.pin === 1) });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/** 改某个节点（Beat）的 Scene */
router.put('/outline/beats/:index', (req, res) => {
  try {
    res.json({ ok: true, outline: updateBeatScene(Number(req.params.index), req.body?.scene) });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/** 删某个节点 */
router.delete('/outline/beats/:index', (req, res) => {
  try {
    res.json({ ok: true, outline: deleteBeat(Number(req.params.index)) });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/** 清空大纲（人工显式操作） */
router.delete('/outline', (req, res) => {
  res.json(clearOutline());
});

/**
 * 判定"剧情是否已推进到下一节点"。
 * ★ 半自动：判定通过才把游标 +1；人工锁定（pin）或已是最后一节点时**不发起调用**。
 */
router.post('/outline/advance', async (req, res) => {
  try {
    const r = await judgeOutlineAdvance({ recentText: req.body?.recentText || '' });
    res.json({ ok: true, ...r, outline: getOutline() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 「面 → 线」弱关联 · 查询（2026-10-07 用户裁定）。
 *
 * 大纲 Beat 的「所属线」刻意**用名字不用外键**（线可删，大纲是历史产物不该残缺），
 * 但"不用外键"不等于"放任孤儿"。本接口让前端能：
 *   ① 点 Beat 上的线名 → 跳到线列表并定位（`matched` 给命中的线 id）；
 *   ② 名字对不上任何线时**明确告知**（`matched: null`），由前端标成"未匹配"，
 *      而不是点下去没反应（红线 0）。
 *
 * ⚠ 只做**精确名称匹配**（trim 后全等）—— 模糊匹配会让「线A」误命中「线A·分部」。
 */
router.get('/outline/line-refs', (req, res) => {
  try {
    const outline = getOutline();
    const lines = listEventLines();
    const byName = new Map(lines.map(l => [String(l.name || '').trim(), l]));
    const refs = (outline?.beats || []).map((b, index) => {
      const name = String(b?.line || '').trim();
      if (!name) return { index, name: '', matched: null };
      const hit = byName.get(name);
      return { index, name, matched: hit ? { id: hit.id, stage: hit.stage, terminal: !!hit.terminal } : null };
    });
    // 只回有名字的引用（空的不必占位）
    res.json({ refs: refs.filter(r => r.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 「面 → 线」弱关联 · 改名同步（2026-10-07 用户裁定）。
 *
 * 改某条线的名字时，大纲里引用了**旧名**的 Beat 会变成孤儿引用。本接口：
 *   · `dryRun=true`（默认）→ 只**回报**会改几处（供前端提示"有 N 个节点引用了旧名"）；
 *   · `dryRun=false` → 真的同步（仍走「不重新序列化」，只动 `Beat:` 行的第 4 段）。
 *
 * ★ 由**用户显式决定**是否同步 —— 不自动改（红线 L10：人工编辑不受自动护栏约束）。
 */
router.post('/outline/rename-line-ref', (req, res) => {
  try {
    const oldName = String(req.body?.oldName || '').trim();
    const newName = String(req.body?.newName || '').trim();
    if (!oldName || !newName) return res.status(400).json({ error: '需要 oldName 与 newName' });
    const outline = getOutline();
    if (!outline) return res.json({ ok: true, changed: 0, indices: [], outline: null });

    const indices = findBeatsReferencingLine(outline.beats, oldName);
    // dryRun 默认 true：不改库，只回答"会改几处"
    if (req.body?.dryRun !== false) {
      return res.json({ ok: true, dryRun: true, changed: indices.length, indices, outline });
    }
    if (!indices.length) return res.json({ ok: true, changed: 0, indices: [], outline });

    const { raw, changed } = renameLineInOutlineRaw(outline.raw, oldName, newName);
    // 复用 saveOutline 的落库路径（它内部会重新解析并校验"一个 Beat 都没有就抛错"）
    const saved = saveOutline({ raw, basisNote: outline.basisNote, cursor: outline.cursor });
    res.json({ ok: true, changed, indices, outline: saved });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

export default router;