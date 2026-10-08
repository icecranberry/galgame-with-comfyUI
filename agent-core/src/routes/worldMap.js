/**
 * /api/worldmap —— 「地图」页（世界地图骨架 = 叙事地理）
 *
 * ⚠ 与 /api/town 的 map 接口是两回事：那边是可行走的网格图（tile + 寻路 + 资产），
 * 这边是纯文本的地理骨架（大地区 → 子地区 → 场景 → POI）。
 *
 * 路由分三组：
 *   /maps...            地图档 CRUD
 *   /maps/:id/generate  骨架生成（1 次短 LLM 出 L1+L2）
 *   /places...          地点 CRUD + 逐区展开（L3 + POI）
 */

import { Router } from 'express';
import {
  listMaps, createMap, updateMap, deleteMap, duplicateMap, getMap,
  addPlace, upsertPlace, deletePlace,
  generateSkeleton, expandPlace, exportMarkdown,
  LEVEL_LABEL, POI_TYPES,
} from '../services/worldMapService.js';

const router = Router();

function fail(res, err) {
  const status = err?.statusCode || 500;
  if (status >= 500) console.error('[worldmap] error:', err.message);
  res.status(status).json({ error: err.message });
}

// ── 元信息：层级标签与 POI 类型（前端不写死，改口径只改服务端）──
router.get('/meta', (req, res) => {
  res.json({ level_label: LEVEL_LABEL, poi_types: POI_TYPES });
});

// ── 地图档 ──

router.get('/maps', (req, res) => {
  try { res.json({ maps: listMaps() }); } catch (err) { fail(res, err); }
});

router.post('/maps', (req, res) => {
  try {
    const { name, worldSettingId = null, note = '' } = req.body || {};
    res.json({ ok: true, map: createMap({ name, worldSettingId, note }) });
  } catch (err) { fail(res, err); }
});

router.get('/maps/:id', (req, res) => {
  try {
    const map = getMap(Number(req.params.id));
    if (!map) return res.status(404).json({ error: '地图不存在' });
    res.json({ map });
  } catch (err) { fail(res, err); }
});

router.put('/maps/:id', (req, res) => {
  try {
    const r = updateMap(Number(req.params.id), req.body || {});
    if (!r.ok) return res.status(404).json({ error: r.error });
    res.json(r);
  } catch (err) { fail(res, err); }
});

router.delete('/maps/:id', (req, res) => {
  try {
    const r = deleteMap(Number(req.params.id));
    if (!r.ok) return res.status(404).json({ error: '地图不存在' });
    res.json(r);
  } catch (err) { fail(res, err); }
});

// POST /api/worldmap/maps/:id/duplicate — 复制一张地图（整棵子树）为新地图
// 用途：把建好的地图**当模板**新建（如「二相乐园」）
router.post('/maps/:id/duplicate', (req, res) => {
  try {
    const r = duplicateMap(Number(req.params.id), req.body?.name);
    if (!r.ok) return res.status(404).json({ error: r.error });
    res.json(r);
  } catch (err) { fail(res, err); }
});

// ── 骨架生成（第 1 段：L1 + L2）──
// 同步等待：这次 LLM 刻意压短（max_tokens 1600），几秒就能回，
// 前端给一个明确的加载态即可，不需要任务队列。
router.post('/maps/:id/generate', async (req, res) => {
  try {
    const { brief = '', regionCount, districtPerRegion } = req.body || {};
    const r = await generateSkeleton(Number(req.params.id), { brief, regionCount, districtPerRegion });
    res.json(r);
  } catch (err) { fail(res, err); }
});

// ── 导出 Markdown（贴回知识库用）──
router.get('/maps/:id/export', (req, res) => {
  try {
    const md = exportMarkdown(Number(req.params.id));
    if (md == null) return res.status(404).json({ error: '地图不存在' });
    res.json({ markdown: md });
  } catch (err) { fail(res, err); }
});

// ── 地点 ──

router.post('/maps/:id/places', (req, res) => {
  try {
    const r = addPlace(Number(req.params.id), req.body || {});
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) { fail(res, err); }
});

router.put('/places/:placeId', (req, res) => {
  try {
    const r = upsertPlace(Number(req.params.placeId), req.body || {});
    if (!r.ok) {
      // 「不存在」是 404，其余（移动成环 / 上级不存在 / 校验不过）是 **400** ——
      // 早先一律 404，前端会把「不能移动到自己的下级里」这种参数错误当成资源丢失。
      return res.status(r.error === '地点不存在' ? 404 : 400).json({ error: r.error });
    }
    res.json(r);
  } catch (err) { fail(res, err); }
});

/**
 * PATCH /api/worldmap/places/:placeId/move —— **改归属（搬家）专用端点**。
 *
 * 用户 2026-10-06 裁定 A6：「加一个改归属接口」。虽然 `PUT /places/:id` 也能带
 * `parentId` 达到同样效果，但**语义不同、风险也不同**：
 *   · PUT 是"整体覆盖"，客户端必须把父级之外的字段也原样回传（漏传即被覆盖）；
 *   · 本端点**只接受 `parentId` 一个字段**，其余一律不碰 —— 前端做一次"拖动节点"
 *     的交互时不必先拉全量、也不会误清字段。
 * ★ 成环 / 上级不存在 / 层级重算都由 `upsertPlace` 内部的 `movePlace` 负责（单一真源），
 *   这里只做参数收敛与状态码映射。`parentId: null` = 移到顶层。
 */
router.patch('/places/:placeId/move', (req, res) => {
  try {
    // ⚠ 必须用 `in` 判断"字段在不在"，不能写 `req.body.parentId || null`：
    //   后者会把显式传的 `null`（移到顶层）与"没传"混为一谈。
    if (!('parentId' in (req.body || {}))) {
      return res.status(400).json({ error: '缺少 parentId（移到顶层请显式传 null）' });
    }
    const r = upsertPlace(Number(req.params.placeId), { parentId: req.body.parentId });
    if (!r.ok) {
      return res.status(r.error === '地点不存在' ? 404 : 400).json({ error: r.error });
    }
    res.json(r);
  } catch (err) { fail(res, err); }
});

router.delete('/places/:placeId', (req, res) => {
  try {
    const r = deletePlace(Number(req.params.placeId));
    if (!r.ok) return res.status(404).json({ error: r.error });
    res.json(r);
  } catch (err) { fail(res, err); }
});

// ── 逐区展开（第 2 段：L3 场景 + POI）──
router.post('/places/:placeId/expand', async (req, res) => {
  try {
    const r = await expandPlace(Number(req.params.placeId));
    res.json(r);
  } catch (err) { fail(res, err); }
});

export default router;
