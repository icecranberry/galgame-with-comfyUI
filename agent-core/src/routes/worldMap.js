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
  generateSkeleton, expandPlace, expandPois, exportMarkdown, generateScenePrompt,
  refinePlaceFromImage, refinePlaceFromText,
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

/**
 * POST /api/worldmap/places/scene-prompt —— 依据「名称/类型/简介」生成**英文画面描述**。
 *
 * 用户 2026-10-06 口径：写好了名称、类型、一句话简介以后，给一个按钮自动生成生图 TAG。
 * **不落库**（只返回预览，用户可改可重掷，确认后随 PUT /places/:id 保存）——
 * 与「论坛马甲」同一取向：生成物先给人看，不直接覆盖已有内容。
 * ⚠ 放在 `/places/:placeId` 参数路由**之前**注册（字面路径早于参数路由，本项目既有约定）。
 */
router.post('/places/scene-prompt', async (req, res) => {
  try {
    res.json(await generateScenePrompt(req.body || {}));
  } catch (err) { fail(res, err); }
});

/**
 * POST /api/worldmap/places/:placeId/poi-draft —— **AI 追加生活地点**（不落库）。
 *
 * 用户 2026-10-07 口径：「很多时候不需要添加新的下一级」——
 * 只想给这个地点补几个店/设施，不想为了加一条街边摊再建一层子地点。
 * 与「✨ 让 AI 展开下一级」的区别：那个会**删除**全部子节点后整体替换，这个只往
 * 当前节点的 pois 里**追加**，不碰任何子节点。
 *
 * ⚠ `excludeNames` 是前端传来**当前表单里已有**的 POI 名（含未保存的手改条目）：
 *   用户刚打完名字还没点保存时，库里的 pois_json 并不包含它，只查库会去重失败。
 * 生成器出口已有两道闸门（与已有条目去重 / 全重复时抛错而非返回空），详见服务层。
 */
router.post('/places/:placeId/poi-draft', async (req, res) => {
  try {
    const { count, hint, excludeNames } = req.body || {};
    res.json(await expandPois(Number(req.params.placeId), { count, hint, excludeNames }));
  } catch (err) { fail(res, err); }
});

/**
 * POST /api/worldmap/places/:placeId/refine-draft —— **修正地点**（不落库）。
 *
 * 用户 2026-10-07 口径：明确要求照「角色 → 修正外观」那一套做（含样式参考）。
 * 两条入口与角色侧同名同构：
 *   · `mode: 'image'` + `image` → 观察参考图重写；
 *   · `mode: 'text'`  + `brief` → 按用户零散要点扩写。
 * 产出 `{kind, summary, scenePrompt}` 三个字段的**草稿**，由前端填进编辑表单，
 * 用户可再手改，点「保存」才随 `PUT /places/:id` 落库 —— 与角色侧一致：
 * AI 产出先给人看，不直接覆盖。
 *
 * ⚠ 与 `POST /places/scene-prompt` 的分工：那个只补 `scene_prompt` **一个字段**
 *   （输入是用户已写好的中文）；这个重写**整条可描述字段**（输入是图或要点）。
 */
router.post('/places/:placeId/refine-draft', async (req, res) => {
  try {
    const { mode = 'image', image = '', brief = '', hints = '' } = req.body || {};
    const placeId = Number(req.params.placeId);
    const r = mode === 'text'
      ? await refinePlaceFromText({ placeId, brief, hints })
      : await refinePlaceFromImage({ placeId, image, hints });
    res.json(r);
  } catch (err) { fail(res, err); }
});

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
