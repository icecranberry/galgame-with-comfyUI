import { Router } from 'express';
import { getDb } from '../db/index.js';
import { hybridSearch } from '../services/memorySearch.js';

const router = Router();

// GET /api/memory/search — 三路召回 + RRF 融合
router.get('/search', async (req, res) => {
  try {
    const { q, conversation_id, top_k } = req.query;
    if (!q) return res.status(400).json({ error: 'q is required' });

    const results = await hybridSearch(q, {
      conversationId: conversation_id || null,
      topK: parseInt(top_k, 10) || 10,
    });

    res.json({ results, query: q });
  } catch (err) {
    console.error('[memory/search] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/memory/fragments — 获取记忆碎片
router.get('/fragments', (req, res) => {
  const db = getDb();
  const { conversation_id, type, limit = '20', offset = '0' } = req.query;

  let sql = `SELECT * FROM memory_fragments WHERE 1=1`;
  const params = [];

  if (conversation_id) {
    sql += ` AND conversation_id = ?`;
    params.push(conversation_id);
  }
  if (type) {
    sql += ` AND fragment_type = ?`;
    params.push(type);
  }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit, 10), parseInt(offset, 10));

  const fragments = db.prepare(sql).all(...params);

  const { count } = db.prepare(`
    SELECT COUNT(*) as count FROM memory_fragments
    ${conversation_id ? 'WHERE conversation_id = ?' : ''}
  `).get(...(conversation_id ? [conversation_id] : []));

  res.json({ fragments, total: count });
});

// DELETE /api/memory/fragments/:id — 删除碎片
router.delete('/fragments/:id', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM memory_fragments WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// GET /api/memory/emotion/history — 情绪历史
router.get('/emotion/history', (req, res) => {
  const db = getDb();
  const { conversation_id, limit = '50' } = req.query;

  let sql = `SELECT * FROM emotion_snapshots`;
  const params = [];

  if (conversation_id) {
    sql += ` WHERE conversation_id = ?`;
    params.push(conversation_id);
  }

  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(parseInt(limit, 10));

  const snapshots = db.prepare(sql).all(...params);
  res.json({ snapshots: snapshots.reverse() });
});

export default router;
