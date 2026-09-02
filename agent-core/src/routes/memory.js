import { Router } from 'express';
import { getDb } from '../db/index.js';
import { hybridSearch } from '../services/memorySearch.js';
import { listActiveMemories, softDeleteMemory, memoryStats, reindexAllMemories, retryFailedIndexJobs, restoreArchivedMemory } from '../services/memory/memoryRepository.js';
import { runConsolidationOnce } from '../services/memory/consolidationScheduler.js';

const router = Router();

router.get('/search', async (req, res) => {
  try {
    const { q, conversation_id, top_k } = req.query;
    if (!q) return res.status(400).json({ error: 'q is required' });
    const results = await hybridSearch(q, { conversationId: conversation_id || null, topK: Number.parseInt(top_k, 10) || undefined, timeoutMs: 10000 });
    res.json({ results, query: q });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/fragments', (req, res) => {
  const { conversation_id, memory_type, type, status = 'active', limit = '20', offset = '0' } = req.query;
  const normalizedStatus = status === 'all' ? null : (status || null);
  const fragments = listActiveMemories({
    conversationId: conversation_id || null,
    memoryType: memory_type || type || null,
    status: normalizedStatus,
    limit: Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20)),
    offset: Math.max(0, Number.parseInt(offset, 10) || 0),
  });
  let sql = `SELECT COUNT(*) AS count FROM memory_fragments WHERE 1=1`;
  const params = [];
  if (conversation_id) { sql += ` AND conversation_id = ?`; params.push(conversation_id); }
  if (normalizedStatus) { sql += ` AND status = ?`; params.push(normalizedStatus); }
  if (memory_type || type) { sql += ` AND memory_type = ?`; params.push(memory_type || type); }
  res.json({ fragments, total: getDb().prepare(sql).get(...params).count });
});

router.delete('/fragments/:id', (req, res) => {
  const deleted = softDeleteMemory(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'memory not found' });
  res.json({ ok: true });
});

// 阶段四：archived 记忆恢复（status='active' + stale 触发重嵌入，恢复后重新可见于被动/主动检索）
router.post('/fragments/:id/restore', (req, res) => {
  const restored = restoreArchivedMemory(req.params.id);
  if (!restored) return res.status(404).json({ error: 'archived memory not found' });
  res.json({ ok: true });
});

// 阶段三：整理 daemon 任务队列记录（kill 后续跑/失败原因可查）
router.get('/consolidation/jobs', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
  const jobs = getDb().prepare(`SELECT * FROM memory_consolidation_jobs ORDER BY id DESC LIMIT ?`).all(limit);
  res.json({ jobs });
});

// 阶段三：手动触发一轮整理（仍受空闲保护：聊天进行中拒绝）
router.post('/consolidation/run', async (_req, res) => {
  try { res.json(await runConsolidationOnce({ force: true })); }
  catch (error) { res.status(500).json({ ok: false, error: error.message }); }
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
  const jobs = getDb().prepare(`
    SELECT
      mij.*,
      mf.conversation_id,
      mf.memory_type,
      mf.status AS memory_status,
      COALESCE(mf.judgment, mf.content) AS memory_content,
      mf.reasoning AS memory_reasoning,
      mf.tags AS memory_tags
    FROM memory_index_jobs mij
    LEFT JOIN memory_fragments mf ON mf.memory_id = mij.memory_id
    ORDER BY mij.id DESC
    LIMIT ?
  `).all(limit);
  res.json({ jobs });
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
