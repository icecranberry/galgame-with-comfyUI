import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

// GET /api/portraits/:characterId — 获取指定角色视角下的用户画像
router.get('/:characterId', (req, res) => {
  const db = getDb();
  const { characterId } = req.params;

  const portraits = db.prepare(`
    SELECT id, trait_type, content, confidence, created_at
    FROM user_portraits
    WHERE character_id = ?
    ORDER BY trait_type, confidence DESC
  `).all(characterId);

  // 按类型分组
  const grouped = { appearance: [], personality: [], preference: [] };
  for (const p of portraits) {
    grouped[p.trait_type] = grouped[p.trait_type] || [];
    grouped[p.trait_type].push(p);
  }

  res.json({ portraits, grouped });
});

// POST /api/portraits — 手动添加一条画像
router.post('/', (req, res) => {
  const db = getDb();
  const { characterId, traitType, content } = req.body;
  if (!characterId) return res.status(400).json({ error: 'characterId is required' });
  if (!['appearance', 'personality', 'preference'].includes(traitType)) {
    return res.status(400).json({ error: 'traitType must be appearance/personality/preference' });
  }
  if (!content || typeof content !== 'string' || content.trim().length < 2) {
    return res.status(400).json({ error: 'content must be a string with at least 2 characters' });
  }
  const trimmed = content.trim();
  try {
    const result = db.prepare(`
      INSERT OR IGNORE INTO user_portraits (character_id, trait_type, content, confidence)
      VALUES (?, ?, ?, 1.0)
    `).run(characterId, traitType, trimmed);
    if (result.changes === 0) {
      return res.status(409).json({ error: '该特征已存在' });
    }
    const row = db.prepare(`SELECT id, trait_type, content, confidence, created_at FROM user_portraits WHERE id = ?`).get(result.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    console.error('[portraits] POST error:', err.message);
    res.status(500).json({ error: '添加失败' });
  }
});

// PUT /api/portraits/:id — 编辑单条画像内容
router.put('/:id', (req, res) => {
  const db = getDb();
  const { content } = req.body;
  if (!content || typeof content !== 'string' || content.trim().length < 2) {
    return res.status(400).json({ error: 'content must be a string with at least 2 characters' });
  }
  const trimmed = content.trim();
  const existing = db.prepare(`SELECT id FROM user_portraits WHERE id = ?`).get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Portrait entry not found' });
  }
  db.prepare(`UPDATE user_portraits SET content = ? WHERE id = ?`).run(trimmed, req.params.id);
  res.json({ ok: true, id: Number(req.params.id), content: trimmed });
});

// DELETE /api/portraits/:id — 删除单条画像
router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare(`DELETE FROM user_portraits WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Portrait entry not found' });
  }
  res.json({ ok: true });
});

// DELETE /api/portraits/character/:characterId — 清空某角色的全部用户画像
router.delete('/character/:characterId/all', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM user_portraits WHERE character_id = ?`).run(req.params.characterId);
  res.json({ ok: true });
});

export default router;
