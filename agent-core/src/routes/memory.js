import { Router } from 'express';
import { getDb } from '../db/index.js';
import { hybridSearch } from '../services/memorySearch.js';
import { listActiveMemories, softDeleteMemory, memoryStats, reindexAllMemories, retryFailedIndexJobs } from '../services/memory/memoryRepository.js';

const router = Router();

router.get('/search', async (req, res) => {
  try {
    const { q, conversation_id, top_k } = req.query;
    if (!q) return res.status(400).json({ error: 'q is required' });
    const results = await hybridSearch(q, { conversationId: conversation_id || null, topK: Number.parseInt(top_k, 10) || undefined });
    res.json({ results, query: q });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/fragments', (req, res) => {
  const { conversation_id, memory_type, type, status = 'active', limit = '20', offset = '0' } = req.query;
  const fragments = listActiveMemories({
    conversationId: conversation_id || null,
    memoryType: memory_type || type || null,
    status: status || null,
    limit: Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20)),
    offset: Math.max(0, Number.parseInt(offset, 10) || 0),
  });
  let sql = `SELECT COUNT(*) AS count FROM memory_fragments WHERE 1=1`;
  const params = [];
  if (conversation_id) { sql += ` AND conversation_id = ?`; params.push(conversation_id); }
  if (status) { sql += ` AND status = ?`; params.push(status); }
  res.json({ fragments, total: getDb().prepare(sql).get(...params).count });
});

router.delete('/fragments/:id', (req, res) => {
  const deleted = softDeleteMemory(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'memory not found' });
  res.json({ ok: true });
});

router.get('/stats', (_req, res) => {
  res.json(memoryStats());
});

router.post('/reindex', async (_req, res) => {
  try { res.json({ ok: true, ...(await reindexAllMemories()) }); }
  catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

router.post('/retry-failed', async (_req, res) => {
  try { res.json({ ok: true, ...(await retryFailedIndexJobs()) }); }
  catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

router.get('/index-jobs', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
  res.json({ jobs: getDb().prepare(`SELECT * FROM memory_index_jobs ORDER BY id DESC LIMIT ?`).all(limit) });
});

router.get('/emotion/history', (req, res) => {
  const { conversation_id, limit = '50' } = req.query;
  let sql = `SELECT * FROM emotion_snapshots`;
  const params = [];
  if (conversation_id) { sql += ` WHERE conversation_id = ?`; params.push(conversation_id); }
  sql += ` ORDER BY id DESC LIMIT ?`; params.push(Number.parseInt(limit, 10));
  res.json({ snapshots: getDb().prepare(sql).all(...params).reverse() });
});

export default router;
