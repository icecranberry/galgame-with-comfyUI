import { Router } from 'express';
import { listBackpack, listActiveEffects, openChest, useItem, discardItem, collectItem, removeActiveEffect } from '../services/itemService.js';

const router = Router();

// GET /api/items — 背包内容（已收下）+ 待收下道具 + 宝箱冷却状态 + 生效中的效果
router.get('/', (req, res) => {
  try {
    const backpack = listBackpack();
    res.json({ ...backpack, activeEffects: listActiveEffects() });
  } catch (err) {
    console.error('[items] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/items/chest/open — 开启每日宝箱（16 小时冷却；道具图片异步生成）
router.post('/chest/open', async (req, res) => {
  try {
    const result = await openChest();
    if (!result.ok) {
      return res.status(409).json({ error: result.error, cooldownRemaining: result.cooldownRemaining });
    }
    res.json(result);
  } catch (err) {
    console.error('[items] open chest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/items/:id/collect — 收下道具（收下后才出现在背包、才可使用）
router.post('/:id/collect', (req, res) => {
  try {
    const result = collectItem(Number(req.params.id));
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[items] collect error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/items/:id/use — 使用道具（body: { character_id }）
router.post('/:id/use', (req, res) => {
  try {
    const { character_id } = req.body || {};
    if (!character_id) return res.status(400).json({ error: '缺少 character_id' });
    const result = useItem(Number(req.params.id), Number(character_id));
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[items] use error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/items/effects/:id — 提前移除已生效的效果
router.delete('/effects/:id', (req, res) => {
  try {
    const result = removeActiveEffect(Number(req.params.id));
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[items] remove effect error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/items/:id — 丢弃道具
router.delete('/:id', (req, res) => {
  try {
    const result = discardItem(Number(req.params.id));
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[items] discard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
