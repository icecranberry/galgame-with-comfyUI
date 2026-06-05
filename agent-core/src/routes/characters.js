import { Router } from 'express';
import { getDb } from '../db/index.js';
import { loadEmotionState } from '../services/emotionEngine.js';
import { DEFAULT_CHARACTERS } from '../services/seeds.js';

const router = Router();

// 首次启动时播种默认角色
function seedCharacters() {
  const db = getDb();
  const count = db.prepare(`SELECT COUNT(*) as c FROM characters`).get();
  if (count.c === 0) {
    const insert = db.prepare(`
      INSERT INTO characters (name, display_name, base_prompt, emotion_baseline)
      VALUES (?, ?, ?, ?)
    `);
    for (const ch of DEFAULT_CHARACTERS) {
      insert.run(ch.name, ch.display_name, ch.base_prompt, ch.emotion_baseline);
    }
    console.log(`[characters] seeded ${DEFAULT_CHARACTERS.length} default characters`);
  }
}
seedCharacters();

// GET /api/characters — 列出所有角色
router.get('/', (req, res) => {
  const db = getDb();
  const characters = db.prepare(`SELECT * FROM characters WHERE is_active = 1`).all();
  res.json({ characters });
});

// POST /api/characters — 创建角色
router.post('/', (req, res) => {
  const db = getDb();
  const { name, display_name, base_prompt, emotion_baseline } = req.body;

  if (!name || !base_prompt) {
    return res.status(400).json({ error: 'name and base_prompt are required' });
  }

  const emotion = emotion_baseline
    ? (typeof emotion_baseline === 'string' ? emotion_baseline : JSON.stringify(emotion_baseline))
    : JSON.stringify({ valence: 0.5, arousal: 0.5, dominance: 0.5 });

  try {
    const result = db.prepare(`
      INSERT INTO characters (name, display_name, base_prompt, emotion_baseline)
      VALUES (?, ?, ?, ?)
    `).run(name, display_name || name, base_prompt, emotion);

    res.status(201).json({ id: result.lastInsertRowid, name, display_name });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: `Character "${name}" already exists` });
    }
    throw err;
  }
});

// PUT /api/characters/:id — 更新角色
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, display_name, base_prompt, emotion_baseline, is_active } = req.body;
  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (display_name !== undefined) { updates.push('display_name = ?'); params.push(display_name); }
  if (base_prompt !== undefined) { updates.push('base_prompt = ?'); params.push(base_prompt); }
  if (emotion_baseline !== undefined) {
    updates.push('emotion_baseline = ?');
    params.push(typeof emotion_baseline === 'string' ? emotion_baseline : JSON.stringify(emotion_baseline));
  }
  if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE characters SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  res.json({ ok: true });
});

// GET /api/characters/:id/emotion — 获取角色当前情绪
router.get('/:id/emotion', (req, res) => {
  const db = getDb();
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!character) return res.status(404).json({ error: 'Character not found' });

  const baseline = JSON.parse(character.emotion_baseline || '{}');
  const { conversation_id } = req.query;

  const state = loadEmotionState(conversation_id || null, baseline);

  res.json({
    character_id: character.id,
    character_name: character.name,
    emotion: {
      instant: state.instant,
      mood: state.mood,
      baseline,
    },
  });
});

// POST /api/characters/:id/emotion/reset — 重置情绪到基线
router.post('/:id/emotion/reset', (req, res) => {
  const db = getDb();
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!character) return res.status(404).json({ error: 'Character not found' });

  const baseline = JSON.parse(character.emotion_baseline || '{}');
  res.json({
    ok: true,
    emotion: {
      instant: { valence: baseline.valence || 0.5, arousal: baseline.arousal || 0.5, dominance: baseline.dominance || 0.5 },
      mood: { valence: baseline.valence || 0.5, arousal: baseline.arousal || 0.5, dominance: baseline.dominance || 0.5 },
    },
  });
});

export default router;
