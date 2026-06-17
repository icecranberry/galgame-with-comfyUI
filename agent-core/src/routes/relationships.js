import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

// GET /api/relationships?character_id=xxx — 查询某角色发起的所有关系（含被关联角色的基本信息）
router.get('/', (req, res) => {
  const db = getDb();
  const { character_id } = req.query;
  if (!character_id) {
    return res.status(400).json({ error: 'character_id is required' });
  }

  const relationships = db.prepare(`
    SELECT
      cr.id,
      cr.from_character_id,
      cr.to_character_id,
      cr.relationship_text,
      cr.created_at,
      c.display_name AS to_display_name,
      c.avatar_path AS to_avatar_path,
      c.avatar_color AS to_avatar_color
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.from_character_id = ?
    ORDER BY cr.created_at ASC
  `).all(character_id);

  res.json({ relationships });
});

// POST /api/relationships — 创建关系
// Body: { from_character_id, to_character_id, relationship_text }
router.post('/', (req, res) => {
  const db = getDb();
  const { from_character_id, to_character_id, relationship_text } = req.body;

  if (!from_character_id || !to_character_id) {
    return res.status(400).json({ error: 'from_character_id and to_character_id are required' });
  }
  if (!relationship_text || !relationship_text.trim()) {
    return res.status(400).json({ error: 'relationship_text cannot be empty' });
  }

  // 验证两个角色都存在
  const fromChar = db.prepare('SELECT id FROM characters WHERE id = ?').get(from_character_id);
  const toChar = db.prepare('SELECT id FROM characters WHERE id = ?').get(to_character_id);
  if (!fromChar || !toChar) {
    return res.status(404).json({ error: 'Character not found' });
  }
  if (from_character_id === to_character_id) {
    return res.status(400).json({ error: 'Cannot create self-relationship' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO character_relationships (from_character_id, to_character_id, relationship_text)
      VALUES (?, ?, ?)
    `).run(from_character_id, to_character_id, relationship_text.trim());

    const created = db.prepare(`
      SELECT
        cr.*,
        c.display_name AS to_display_name,
        c.avatar_path AS to_avatar_path,
        c.avatar_color AS to_avatar_color
      FROM character_relationships cr
      JOIN characters c ON c.id = cr.to_character_id
      WHERE cr.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ relationship: created });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Relationship already exists between these characters' });
    }
    throw err;
  }
});

// PUT /api/relationships/:id — 修改关系文本
// Body: { relationship_text }
router.put('/:id', (req, res) => {
  const db = getDb();
  const { relationship_text } = req.body;

  const rel = db.prepare('SELECT id FROM character_relationships WHERE id = ?').get(req.params.id);
  if (!rel) {
    return res.status(404).json({ error: 'Relationship not found' });
  }

  if (!relationship_text || !relationship_text.trim()) {
    return res.status(400).json({ error: 'relationship_text cannot be empty' });
  }

  db.prepare('UPDATE character_relationships SET relationship_text = ? WHERE id = ?')
    .run(relationship_text.trim(), req.params.id);

  const updated = db.prepare(`
    SELECT
      cr.*,
      c.display_name AS to_display_name,
      c.avatar_path AS to_avatar_path,
      c.avatar_color AS to_avatar_color
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.id = ?
  `).get(req.params.id);

  res.json({ relationship: updated });
});

// DELETE /api/relationships/:id — 删除关系（断开连线）
router.delete('/:id', (req, res) => {
  const db = getDb();
  const rel = db.prepare('SELECT id FROM character_relationships WHERE id = ?').get(req.params.id);
  if (!rel) {
    return res.status(404).json({ error: 'Relationship not found' });
  }

  db.prepare('DELETE FROM character_relationships WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
