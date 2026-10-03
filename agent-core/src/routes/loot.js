import { Router } from 'express';
import {
  getPageStats, getWindow, rollWindow, takeItems,
  getImageQueueState, repairMissingImages,
} from '../services/lootService.js';

const router = Router();

// GET /api/loot/pages — 分页配置 + 各页可选商品数（前端渲染标签页用）
router.get('/pages', (req, res) => {
  try {
    res.json({ pages: getPageStats(), queue: getImageQueueState() });
  } catch (err) {
    console.error('[loot] pages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/loot/window?page=xxx — 当前橱窗（每页 8 格；未刷新过时全为空位）
router.get('/window', (req, res) => {
  try {
    const page = String(req.query.page || '').trim();
    if (!page) return res.status(400).json({ error: '缺少 page 参数' });
    res.json({ ...getWindow(page), queue: getImageQueueState() });
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

// POST /api/loot/repair-images — 给缺图的商品排队生图（管理用，不阻塞返回）
router.post('/repair-images', (req, res) => {
  try {
    const limit = Number(req.body?.limit) || 50;
    res.json({ ok: true, ...repairMissingImages({ limit }), queue: getImageQueueState() });
  } catch (err) {
    console.error('[loot] repair error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
