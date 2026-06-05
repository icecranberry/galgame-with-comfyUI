import { Router } from 'express';
import { getDb } from '../db/index.js';
import { DEFAULT_CHARACTERS } from '../services/seeds.js';

const router = Router();

function seedCharacters() {
  const db = getDb();
  // ON CONFLICT DO UPDATE: 新角色插入，已有角色按 name 更新 prompt → 改 seeds.js 重启即生效，对话历史不丢
  const upsert = db.prepare(`
    INSERT INTO characters (name, display_name, base_prompt, emotion_baseline) VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      display_name = excluded.display_name,
      base_prompt = excluded.base_prompt,
      emotion_baseline = excluded.emotion_baseline
  `);
  let added = 0, updated = 0;
  for (const ch of DEFAULT_CHARACTERS) {
    // 先查是否存在，区分 insert 和 update 的日志
    const existing = db.prepare('SELECT id FROM characters WHERE name = ?').get(ch.name);
    upsert.run(ch.name, ch.display_name, ch.base_prompt, ch.emotion_baseline);
    if (existing) updated++; else added++;
  }
  if (added > 0 || updated > 0) {
    console.log(`[characters] seeded: ${added} new, ${updated} updated`);
  }
}
seedCharacters();

// GET /api/characters — 列出角色，含最近消息摘要
router.get('/', (req, res) => {
  const db = getDb();
  const characters = db.prepare(`SELECT * FROM characters WHERE is_active = 1`).all();

  const enriched = characters.map(c => {
    const convId = `char_${c.id}`;
    const last = db.prepare(`
      SELECT role, content, created_at FROM messages
      WHERE conversation_id = ? AND is_deleted = 0
      ORDER BY id DESC LIMIT 1
    `).get(convId);

    const count = db.prepare(`SELECT COUNT(*) as c FROM messages WHERE conversation_id = ? AND is_deleted = 0`).get(convId);

    return {
      ...c,
      last_message: last ? last.content.slice(0, 80) : null,
      last_message_at: last?.created_at || null,
      message_count: count?.c || 0,
    };
  });

  // 按最近消息时间排序（有消息的在前）
  enriched.sort((a, b) => {
    if (!a.last_message_at && !b.last_message_at) return a.id - b.id;
    if (!a.last_message_at) return 1;
    if (!b.last_message_at) return -1;
    return new Date(b.last_message_at) - new Date(a.last_message_at);
  });

  res.json({ characters: enriched });
});

// POST /api/characters — 创建角色
router.post('/', (req, res) => {
  const db = getDb();
  const { name, display_name, base_prompt, emotion_baseline } = req.body;
  if (!name || !base_prompt) return res.status(400).json({ error: 'name and base_prompt are required' });

  const emotion = emotion_baseline ? (typeof emotion_baseline === 'string' ? emotion_baseline : JSON.stringify(emotion_baseline)) : '{"valence":0.5,"arousal":0.5,"dominance":0.5}';

  try {
    const result = db.prepare(`INSERT INTO characters (name, display_name, base_prompt, emotion_baseline) VALUES (?, ?, ?, ?)`)
      .run(name, display_name || name, base_prompt, emotion);
    res.status(201).json({ id: result.lastInsertRowid, name, display_name });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: `"${name}" already exists` });
    throw err;
  }
});

// PUT /api/characters/:id — 更新角色
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, display_name, base_prompt, emotion_baseline, is_active } = req.body;
  const updates = [], params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (display_name !== undefined) { updates.push('display_name = ?'); params.push(display_name); }
  if (base_prompt !== undefined) { updates.push('base_prompt = ?'); params.push(base_prompt); }
  if (emotion_baseline !== undefined) { updates.push('emotion_baseline = ?'); params.push(typeof emotion_baseline === 'string' ? emotion_baseline : JSON.stringify(emotion_baseline)); }
  if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active); }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  db.prepare(`UPDATE characters SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

export default router;
