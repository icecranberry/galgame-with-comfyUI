import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

// GET /api/user-relationships — 查询用户到所有角色的关系（含角色的基本信息）
router.get('/', (req, res) => {
  const db = getDb();

  const relationships = db.prepare(`
    SELECT
      ur.id,
      ur.character_id,
      ur.relationship_text,
      ur.created_at,
      c.display_name AS to_display_name,
      c.avatar_path AS to_avatar_path,
      c.avatar_color AS to_avatar_color
    FROM user_relationships ur
    JOIN characters c ON c.id = ur.character_id
    WHERE ur.relationship_text != ''
    ORDER BY ur.created_at ASC
  `).all();

  res.json({ relationships });
});

// POST /api/user-relationships — 创建用户到角色的关系
// Body: { character_id, relationship_text }
router.post('/', (req, res) => {
  const db = getDb();
  const { character_id, relationship_text } = req.body;

  if (!character_id) {
    return res.status(400).json({ error: 'character_id is required' });
  }
  if (!relationship_text || !relationship_text.trim()) {
    return res.status(400).json({ error: 'relationship_text cannot be empty' });
  }

  // 验证角色存在
  const char = db.prepare('SELECT id FROM characters WHERE id = ?').get(character_id);
  if (!char) {
    return res.status(404).json({ error: 'Character not found' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO user_relationships (character_id, relationship_text)
      VALUES (?, ?)
    `).run(character_id, relationship_text.trim());

    const created = db.prepare(`
      SELECT
        ur.*,
        c.display_name AS to_display_name,
        c.avatar_path AS to_avatar_path,
        c.avatar_color AS to_avatar_color
      FROM user_relationships ur
      JOIN characters c ON c.id = ur.character_id
      WHERE ur.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ relationship: created });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Relationship already exists with this character' });
    }
    throw err;
  }
});

// PUT /api/user-relationships/:id — 修改关系文本
// Body: { relationship_text }
router.put('/:id', (req, res) => {
  const db = getDb();
  const { relationship_text } = req.body;

  const rel = db.prepare('SELECT id FROM user_relationships WHERE id = ?').get(req.params.id);
  if (!rel) {
    return res.status(404).json({ error: 'Relationship not found' });
  }

  if (!relationship_text || !relationship_text.trim()) {
    return res.status(400).json({ error: 'relationship_text cannot be empty' });
  }

  db.prepare('UPDATE user_relationships SET relationship_text = ? WHERE id = ?')
    .run(relationship_text.trim(), req.params.id);

  const updated = db.prepare(`
    SELECT
      ur.*,
      c.display_name AS to_display_name,
      c.avatar_path AS to_avatar_path,
      c.avatar_color AS to_avatar_color
    FROM user_relationships ur
    JOIN characters c ON c.id = ur.character_id
    WHERE ur.id = ?
  `).get(req.params.id);

  res.json({ relationship: updated });
});

// DELETE /api/user-relationships/:id — 删除关系
router.delete('/:id', (req, res) => {
  const db = getDb();
  const rel = db.prepare('SELECT id FROM user_relationships WHERE id = ?').get(req.params.id);
  if (!rel) {
    return res.status(404).json({ error: 'Relationship not found' });
  }

  db.prepare('DELETE FROM user_relationships WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
