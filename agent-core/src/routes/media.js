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
  listOutlets, getOutlet, createOutlet, updateOutlet, deleteOutlet,
  listBoards, createBoard, updateBoard, deleteBoard,
  listPosts, generateMediaBatch, fillPendingImages, fillPortalImages, getAutoState,
  regeneratePostImage, deletePost,
  deletePosts, regeneratePostImages, MAX_BATCH_POSTS,
  generatePortalSection,
  DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE, MEDIA_AUTO_STEPS,
} from '../services/mediaService.js';
import { config, updateMediaAutoMinutes } from '../config.js';
import { generateMediaOutletDraft } from '../services/mediaOutletDesigner.js';

const router = Router();

/** 把 service 抛出的 statusCode 透出去，否则一律 500 */
function fail(res, err) {
  const status = err?.statusCode || 500;
  if (status >= 500) console.error('[media] error:', err.message);
  res.status(status).json({ error: err.message });
}

// ── 媒体 ──

// 仅生成表单草稿，不创建媒体、不触发出刊或生图。
router.post('/outlets/draft', async (req, res) => {
  try {
    res.json({ draft: await generateMediaOutletDraft(req.body || {}) });
  } catch (err) { fail(res, err); }
});

// GET /api/media/outlets — 全部媒体（含板块数/帖子数）
router.get('/outlets', (req, res) => {
  try {
    res.json({ outlets: listOutlets() });
  } catch (err) { fail(res, err); }
});

// POST /api/media/outlets — 新建媒体 Body: { name, tagline?, prompt, icon?, layout?: "feed"|"portal" }
router.post('/outlets', (req, res) => {
  try {
    res.status(201).json(createOutlet(req.body || {}));
  } catch (err) { fail(res, err); }
});

// PUT /api/media/outlets/:id — 改媒体 Body: { name?, tagline?, prompt?, icon?, enabled?, layout?: "feed"|"portal" }
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

// GET /api/media/posts?outlet=&board=&limit=&offset=
router.get('/posts', (req, res) => {
  try {
    const outletId = req.query.outlet ? Number(req.query.outlet) : null;
    const boardId = req.query.board ? Number(req.query.board) : null;
    const category = req.query.category === 'digital' || req.query.category === 'social' ? req.query.category : null;
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
 * Body: { outletId?, count? }
 * **异步**：立刻返回 { started: true }，生成在后台跑；
 * 前端靠 SSE 的 `media_new_posts` 事件或轮询 /status 得知完成。
 */
router.post('/refresh', (req, res) => {
  try {
    const outletId = req.body?.outletId ? Number(req.body.outletId) : null;
    const count = req.body?.count ? Number(req.body.count) : DEFAULT_BATCH_SIZE;
    if (outletId && !getOutlet(outletId)) return res.status(404).json({ error: '媒体不存在' });
    // 不 await：LLM 生成要几十秒，占着请求会让前端转圈超时
    generateMediaBatch({ outletId, count: Math.min(count, MAX_BATCH_SIZE) })
      .then(r => console.log(`[media] refresh done: +${r.inserted}`))
      .catch(err => console.error('[media] refresh failed:', err.message));
    res.json({ started: true, outletId, count });
  } catch (err) { fail(res, err); }
});

// GET /api/media/status — 自动抓帖状态（档位 + 距下次还有多久）
router.get('/status', (req, res) => {
  try {
    res.json({ ok: true, auto: getAutoState() });
  } catch (err) { fail(res, err); }
});

// GET /api/media/auto — 当前自动抓帖频率
router.get('/auto', (req, res) => {
  try {
    res.json({ auto: getAutoState(), steps: MEDIA_AUTO_STEPS });
  } catch (err) { fail(res, err); }
});

// PUT /api/media/auto — 改自动抓帖频率 Body: { minutes }
// minutes=0 关闭自动（只手动刷新）；其余夹在 5 分钟 ~ 12 小时
router.put('/auto', (req, res) => {
  try {
    const minutes = updateMediaAutoMinutes(req.body?.minutes);
    res.json({ ok: true, auto: getAutoState(), minutes });
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

export default router;
