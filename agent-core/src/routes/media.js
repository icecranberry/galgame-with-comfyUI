/**
 * /api/media —— 媒体内容页（传媒 / 数字媒体）
 *
 * 路由分三组：
 *   /outlets...  媒体 CRUD（含板块）
 *   /posts       帖子分页
 *   /refresh     触发一批生成（**异步**：LLM 要几十秒，不能占着请求）
 */

import { Router } from 'express';
import {
  listOutlets, getOutlet, createOutlet, updateOutlet, deleteOutlet, OUTLET_LAYOUTS,
  listBoards, createBoard, updateBoard, deleteBoard,
  listPosts, generateMediaBatch, fillPendingImages, fillPortalImages, getAutoState,
  cleanupOrphanMediaImages, resetStaleMediaGenerating,
  regeneratePostImage, deletePost,
  deletePosts, regeneratePostImages, MAX_BATCH_POSTS,
  publishIssue, listIssues, MEDIA_CATEGORIES,
  generatePortalSection,
  DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE, MEDIA_AUTO_STEPS,
} from '../services/mediaService.js';
import { config, updateMediaAutoPerNight } from '../config.js';
// T5/T7：媒体操作日志（查询删除/创建痕迹 —— 墓碑是给补种逻辑看的，此处流水是给人看的）
import { listMediaOps, countMediaOps, MEDIA_OP_TYPES, MEDIA_TARGET_TYPES } from '../services/mediaOpLog.js';

const router = Router();

/** 把 service 抛出的 statusCode 透出去，否则一律 500 */
function fail(res, err) {
  const status = err?.statusCode || 500;
  if (status >= 500) console.error('[media] error:', err.message);
  res.status(status).json({ error: err.message });
}

// ── 媒体 ──

// GET /api/media/outlets — 全部媒体（含板块数/帖子数）
router.get('/outlets', (req, res) => {
  try {
    res.json({ outlets: listOutlets() });
  } catch (err) { fail(res, err); }
});

// GET /api/media/layouts — 可选的媒体形态（社交平台 / 数字报刊）
// 放在 /outlets/:id 之前：字面路径要早于参数路由注册（本项目既有约定）。
router.get('/layouts', (req, res) => {
  try {
    res.json({ layouts: OUTLET_LAYOUTS });
  } catch (err) { fail(res, err); }
});

// POST /api/media/outlets — 新建媒体 Body: { name, tagline?, prompt, icon?, layout? }
router.post('/outlets', (req, res) => {
  try {
    res.status(201).json(createOutlet(req.body || {}));
  } catch (err) { fail(res, err); }
});

// PUT /api/media/outlets/:id — 改媒体 Body: { name?, tagline?, prompt?, icon?, enabled?, layout? }
router.put('/outlets/:id', (req, res) => {
  try {
    const o = updateOutlet(Number(req.params.id), req.body || {});
    if (!o) return res.status(404).json({ error: '媒体不存在' });
    res.json(o);
  } catch (err) { fail(res, err); }
});

// DELETE /api/media/outlets/:id — 删媒体（板块与帖子级联删除）
router.delete('/outlets/:id', (req, res) => {
  try {
    if (!deleteOutlet(Number(req.params.id))) return res.status(404).json({ error: '媒体不存在' });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

// ── 板块 ──

// GET /api/media/outlets/:id/boards
router.get('/outlets/:id/boards', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!getOutlet(id)) return res.status(404).json({ error: '媒体不存在' });
    res.json({ boards: listBoards(id) });
  } catch (err) { fail(res, err); }
});

// GET /api/media/outlets/:id/issues — 该刊的期简目（往期导航用，最新在前）
// 适用于所有按期出刊的形态：数字报刊（门户）/ 官方传媒（海报、旧周刊）
router.get('/outlets/:id/issues', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!getOutlet(id)) return res.status(404).json({ error: '媒体不存在' });
    res.json({ issues: listIssues(id) });
  } catch (err) { fail(res, err); }
});

/**
 * POST /api/media/outlets/:id/issue — 出一刊（数字报刊形态专用）
 * Body: { force?: boolean }
 *   不带 force：当天已出过就直接返回那一期（省 token，与《邻舍日报》同口径）
 *   force=true：今天出过也再出一期（读者点「再出一期」加刊）
 */
router.post('/outlets/:id/issue', async (req, res) => {
  try {
    const r = await publishIssue(Number(req.params.id), { force: req.body?.force === true });
    res.json(r);
  } catch (err) { fail(res, err); }
});

// POST /api/media/outlets/:id/boards — Body: { name, desc? }
router.post('/outlets/:id/boards', (req, res) => {
  try {
    res.status(201).json(createBoard(Number(req.params.id), req.body || {}));
  } catch (err) { fail(res, err); }
});

// PUT /api/media/boards/:boardId — Body: { name?, desc? }
router.put('/boards/:boardId', (req, res) => {
  try {
    const b = updateBoard(Number(req.params.boardId), req.body || {});
    if (!b) return res.status(404).json({ error: '板块不存在' });
    res.json(b);
  } catch (err) { fail(res, err); }
});

// DELETE /api/media/boards/:boardId — 板块下的帖子不删，只解绑
router.delete('/boards/:boardId', (req, res) => {
  try {
    if (!deleteBoard(Number(req.params.boardId))) return res.status(404).json({ error: '板块不存在' });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

// ── 帖子 ──

// GET /api/media/posts?outlet=&board=&category=&limit=&offset=
router.get('/posts', (req, res) => {
  try {
    const outletId = req.query.outlet ? Number(req.query.outlet) : null;
    const boardId = req.query.board ? Number(req.query.board) : null;
    /**
     * 分类白名单**从 service 取**，不在这里硬编码。
     *
     * ⚠ 这里原本写的是 `=== 'digital' || === 'social'` 两个字面量：
     *   新增 print 分类（现名「官方传媒」）时改了 service、**漏改这里** →
     *   前端传 `print` 被转成 `null` → `listPosts` **不过滤** → 返回全部帖子，
     *   于是《狸狸通讯社》的门户帖混进了这一档。
     *   改成读 `MEDIA_CATEGORIES` 后，再加分类不会再漏这一处。
     */
    const raw = String(req.query.category || '');
    const category = MEDIA_CATEGORIES.includes(raw) ? raw : null;
    const limit = req.query.limit ? Number(req.query.limit) : 40;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const data = listPosts({ outletId, boardId, category, limit, offset });
    res.json(data);
  } catch (err) { fail(res, err); }
});

// POST /api/media/posts/:id/regenerate-image — 为这条内容重新生成配图
// （周刊/海报会连同 payload 里的小图一起清空重出）
// ── 门户（数字报刊·两层生成）──

// POST /api/media/posts/:id/sections/:key — 生成/读取某个板块的正文（第 2 层）
// 已生成过直接返回缓存（二次点开秒开）；首次要调 LLM，所以是同步等待（前端显骨架屏）。
router.post('/posts/:id/sections/:key', async (req, res) => {
  try {
    const r = await generatePortalSection(Number(req.params.id), String(req.params.key || ''));
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) { fail(res, err); }
});

// ── 批量操作 ──
// ⚠ 顺序要紧：`batch` 系列必须注册在参数路由 `/posts/:id...` **之前**，
//   否则 Express 会先把 "batch" 当成 :id 匹配走（数字化成 NaN → 报「内容不存在」）。

// DELETE /api/media/posts/batch — 批量删除。Body: { ids: number[] }
router.delete('/posts/batch', (req, res) => {
  try {
    const r = deletePosts(req.body?.ids);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) { fail(res, err); }
});

// POST /api/media/posts/batch/regenerate-image — 批量重新生图。Body: { ids: number[] }
router.post('/posts/batch/regenerate-image', (req, res) => {
  try {
    const r = regeneratePostImages(req.body?.ids);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) { fail(res, err); }
});

router.post('/posts/:id/regenerate-image', (req, res) => {
  try {
    const r = regeneratePostImage(Number(req.params.id));
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) { fail(res, err); }
});

// DELETE /api/media/posts/:id — 删除内容（含配图文件）
router.delete('/posts/:id', (req, res) => {
  try {
    const r = deletePost(Number(req.params.id));
    if (!r.ok) return res.status(404).json({ error: r.error });
    res.json(r);
  } catch (err) { fail(res, err); }
});

// ── 生成 ──

/**
 * POST /api/media/refresh — 抓一批新帖。
 * Body: { outletId?, count?, category? }
 * **异步**：立刻返回 { started: true }，生成在后台跑；
 * 前端靠 SSE 的 `media_new_posts` 事件或轮询 /status 得知完成。
 *
 * `category`：没指定 `outletId`（前端在「全部」档点刷新）时，只在**该分类内**随机抽一个媒体。
 * 不传 = 全库随机。少了它就会出现「在数字报刊点刷新、结果抽到社交平台的媒体」——
 * 生成的内容不出现在当前页，用户看到的是"没反应"。
 */
router.post('/refresh', (req, res) => {
  try {
    const outletId = req.body?.outletId ? Number(req.body.outletId) : null;
    const count = req.body?.count ? Number(req.body.count) : DEFAULT_BATCH_SIZE;
    const raw = String(req.body?.category || '');
    const category = MEDIA_CATEGORIES.includes(raw) ? raw : null;
    if (outletId && !getOutlet(outletId)) return res.status(404).json({ error: '媒体不存在' });
    // 不 await：LLM 生成要几十秒，占着请求会让前端转圈超时
    generateMediaBatch({ outletId, count: Math.min(count, MAX_BATCH_SIZE), category })
      .then(r => console.log(`[media] refresh done: +${r.inserted}`))
      .catch(err => console.error('[media] refresh failed:', err.message));
    res.json({ started: true, outletId, category, count });
  } catch (err) { fail(res, err); }
});

// GET /api/media/status — 自动抓帖状态（档位 + 距下次还有多久）
router.get('/status', (req, res) => {
  try {
    res.json({ ok: true, auto: getAutoState() });
  } catch (err) { fail(res, err); }
});

// GET /api/media/auto — 当前自动抓帖设置（每晚几批 + 排期 + 可选档位）
router.get('/auto', (req, res) => {
  try {
    res.json({ auto: getAutoState(), steps: MEDIA_AUTO_STEPS });
  } catch (err) { fail(res, err); }
});

/**
 * PUT /api/media/auto — 改自动抓帖频率。Body: { perNight }
 *
 * ★ 2026-10-05 语义变更：由「固定间隔（分钟）」改成「**每晚几批**」。
 *   自动抓帖只在夜间窗口（20:00→次日 02:00）内**错峰随机**执行，白天不产新内容。
 *   `perNight = 0` 关闭（只手动刷新）。可选值 = `MEDIA_AUTO_STEPS` 里的档位。
 *
 * 兼容：仍接受旧的 `{ minutes }` 字段 —— 老前端/老脚本传进来时**不静默忽略**，
 * 而是按"曾经开过就折成每晚 1 批、0 就是关"处理，避免"看起来设置成功了其实没生效"。
 */
router.put('/auto', (req, res) => {
  try {
    const raw = req.body?.perNight ?? req.body?.nights;
    let value;
    if (raw == null && req.body?.minutes != null) {
      value = Number(req.body.minutes) > 0 ? 1 : 0;
    } else {
      value = updateMediaAutoPerNight(raw);
    }
    if (raw != null) updateMediaAutoPerNight(value);
    res.json({ ok: true, auto: getAutoState(), perNight: Number(config.features.mediaAutoPerNight ?? 0) });
  } catch (err) { fail(res, err); }
});

// POST /api/media/cleanup-images — 清理未被引用的孤儿配图 + 重置卡住的生成状态
// （重复生图的历史遗留；平时启动后也会自动清一次）
router.post('/cleanup-images', (req, res) => {
  try {
    const stale = resetStaleMediaGenerating();
    // maxAge 0 = 立刻清（用户显式点的，说明就是要清干净）
    const r = cleanupOrphanMediaImages(0);
    res.json({ ok: true, ...r, staleReset: stale });
  } catch (err) { fail(res, err); }
});

// POST /api/media/fill-images — 手动催一次配图补印（页面上「补图」按钮）
router.post('/fill-images', (req, res) => {
  try {
    const limit = req.body?.limit ? Number(req.body.limit) : 6;
    const n = Math.min(Math.max(1, limit), 20);
    // 两条通道都要跑：主图/海报小图，与门户的板块头图（后者被 listPostsNeedingImage 排除在外）
    fillPendingImages(n)
      .then(c => console.log(`[media] 手动补图完成 ${c} 张`))
      .catch(err => console.error('[media] 手动补图失败:', err.message));
    fillPortalImages(n)
      .then(c => c && console.log(`[media] 手动补图（门户）完成 ${c} 张`))
      .catch(err => console.error('[media] 手动补图（门户）失败:', err.message));
    res.json({ started: true });
  } catch (err) { fail(res, err); }
});

// GET /api/media/op-log — 媒体操作日志（删除/创建/批量类的审计流水）
// 放在其它字面路径之前无妨；参数路由是 /outlets/:id，这里没有冲突。
router.get('/op-log', (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const targetType = MEDIA_TARGET_TYPES.includes(req.query.targetType) ? req.query.targetType : '';
    const opType = MEDIA_OP_TYPES.includes(req.query.opType) ? req.query.opType : '';
    res.json({
      total: countMediaOps(),
      ops: listMediaOps({ limit, targetType, opType }),
    });
  } catch (err) { fail(res, err); }
});

export default router;
