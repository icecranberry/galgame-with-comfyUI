import { Router } from 'express';
import {
  getPageStats, getWindow, rollWindow, takeItems, discardSlot,
  getImageQueueState, repairMissingImages, getImageLibraryStats,
} from '../services/lootService.js';

const router = Router();

// GET /api/loot/pages — 分页配置 + 各页可选商品数（前端渲染标签页用）
router.get('/pages', (req, res) => {
  try {
    res.json({ pages: getPageStats(), library: getImageLibraryStats(), queue: getImageQueueState() });
  } catch (err) {
    console.error('[loot] pages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/loot/window?page=xxx[&ensure=1] — 当前橱窗（每页 4 格；未刷新过时全为空位）
// ensure=1：把缺图的格子补进生图队列（前端打开橱窗时用，让「生成中」是真在生成）
router.get('/window', (req, res) => {
  try {
    const page = String(req.query.page || '').trim();
    if (!page) return res.status(400).json({ error: '缺少 page 参数' });
    const ensure = req.query.ensure === '1' || req.query.ensure === 'true';
    res.json({ ...getWindow(page, { ensure }), queue: getImageQueueState() });
  } catch (err) {
    console.error('[loot] window error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loot/window/roll — 刷新某页（重抽 8 个；缺图的异步排队生成）
router.post('/window/roll', (req, res) => {
  try {
    const page = String(req.body?.page || '').trim();
    if (!page) return res.status(400).json({ error: '缺少 page 参数' });
    const result = rollWindow(page);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ...result, queue: getImageQueueState() });
  } catch (err) {
    console.error('[loot] roll error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loot/window/take — 带走选中的格子（body: { page, slots: [0,3] }）
router.post('/window/take', (req, res) => {
  try {
    const page = String(req.body?.page || '').trim();
    if (!page) return res.status(400).json({ error: '缺少 page 参数' });
    const result = takeItems(page, req.body?.slots);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[loot] take error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loot/window/discard — 丢弃橱窗里的一格（不带走、不进背包）body: { page, slot }
router.post('/window/discard', (req, res) => {
  try {
    const page = String(req.body?.page || '').trim();
    if (!page) return res.status(400).json({ error: '缺少 page 参数' });
    const result = discardSlot(page, req.body?.slot);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[loot] discard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loot/repair-images — 给缺图的商品排队生图（管理用，不阻塞返回）
// body: { limit?, tags? }  tags 为清单 tag 数组时只补这几件
router.post('/repair-images', (req, res) => {
  try {
    const limit = Number(req.body?.limit) || 50;
    const tags = Array.isArray(req.body?.tags) ? req.body.tags : null;
    res.json({ ok: true, ...repairMissingImages({ limit, tags }), queue: getImageQueueState() });
  } catch (err) {
    console.error('[loot] repair error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
