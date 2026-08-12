import { Router } from 'express';
import { getDb } from '../db/index.js';
import { generateEventTypes, generateTopics } from '../services/libraryGenerator.js';

const router = Router();

// ── 工具函数 ──

function toSnakeKey(raw) {
  let s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9_\u4e00-\u9fff]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function toStringVal(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function parseFunFrom(raw) {
  if (Array.isArray(raw)) return raw.filter(f => typeof f === 'string' && f.trim()).map(f => f.trim());
  if (typeof raw === 'string') {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter(f => typeof f === 'string' && f.trim()).map(f => f.trim());
    } catch { /* not JSON, fall through to comma split */ }
    return raw.replace(/[，]/g, ',').split(',').map(f => f.trim()).filter(Boolean);
  }
  return [];
}

// key 兜底生成：优先从名称派生；纯中文或空名时用随机后缀保证唯一
function autoKey(name) {
  const base = toSnakeKey(name);
  if (base) return base;
  return `custom_evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// 对候选 key 做去重：冲突时追加序号
function dedupeKey(candidate, used) {
  let key = candidate;
  let n = 1;
  while (used.has(key)) key = `${candidate}_${n++}`;
  used.add(key);
  return key;
}

function eventTypeToApi(row) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    durationMin: row.duration_min,
    urgency: row.urgency,
    funFrom: parseFunFrom(row.fun_from),
    desc: row.desc,
    source: row.source,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function topicToApi(row) {
  return {
    id: row.id,
    name: row.name,
    desc: row.desc,
    source: row.source,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ──────────────── 奇遇事件类型库 ────────────────

// GET /api/library/event-types — 全部活动条目
router.get('/event-types', (req, res) => {
  const rows = getDb().prepare(
    `SELECT * FROM event_types WHERE is_active = 1 ORDER BY id`
  ).all();
  res.json(rows.map(eventTypeToApi));
});

// POST /api/library/event-types — 新建一条自定义事件类型
router.post('/event-types', (req, res) => {
  const name = toStringVal(req.body?.name);
  if (!name) return res.status(400).json({ error: 'invalid_name', message: 'name 不能为空' });

  const db = getDb();
  const used = new Set(db.prepare(`SELECT key FROM event_types`).all().map(r => r.key));
  const key = dedupeKey(toSnakeKey(req.body?.key) || autoKey(name), used);

  // 手动新增统一 60 分钟；批量生成时仍保留 LLM 给出的各自时长
  const durationMin = 60;
  const urgency = clampInt(req.body?.urgency, 1, 5, 1);
  const funFrom = parseFunFrom(req.body?.funFrom);
  const desc = toStringVal(req.body?.desc);

  const result = db.prepare(
    `INSERT INTO event_types (key, name, duration_min, urgency, fun_from, desc, source, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 'custom', 1)`
  ).run(key, name, durationMin, urgency, JSON.stringify(funFrom), desc);

  const row = db.prepare(`SELECT * FROM event_types WHERE id = ?`).get(result.lastInsertRowid);
  res.json(eventTypeToApi(row));
});

// PUT /api/library/event-types/:id — 更新（系统/自定义均可）
router.put('/event-types/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM event_types WHERE id = ? AND is_active = 1`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'event_type_not_found' });

  const body = req.body || {};
  const key = body.key !== undefined ? toSnakeKey(body.key) : row.key;
  const name = body.name !== undefined ? toStringVal(body.name, row.name) : row.name;
  const durationMin = body.durationMin !== undefined ? clampInt(body.durationMin, 1, 1440, row.duration_min) : row.duration_min;
  const urgency = body.urgency !== undefined ? clampInt(body.urgency, 1, 5, row.urgency) : row.urgency;
  const funFrom = body.funFrom !== undefined ? parseFunFrom(body.funFrom) : parseFunFrom(row.fun_from);
  const desc = body.desc !== undefined ? toStringVal(body.desc, row.desc) : row.desc;

  if (!key) return res.status(400).json({ error: 'invalid_key', message: 'key 不能为空' });
  if (!name) return res.status(400).json({ error: 'invalid_name', message: 'name 不能为空' });

  const dup = db.prepare(`SELECT id FROM event_types WHERE key = ? AND id != ?`).get(key, row.id);
  if (dup) return res.status(409).json({ error: 'duplicate_key', message: `key「${key}」已被其他条目使用` });

  db.prepare(
    `UPDATE event_types SET key = ?, name = ?, duration_min = ?, urgency = ?, fun_from = ?, desc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(key, name, durationMin, urgency, JSON.stringify(funFrom), desc, row.id);

  const updated = db.prepare(`SELECT * FROM event_types WHERE id = ?`).get(row.id);
  res.json(eventTypeToApi(updated));
});

// DELETE /api/library/event-types/:id — 软删除
router.delete('/event-types/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare(
    `UPDATE event_types SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1`
  ).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'event_type_not_found' });
  res.json({ ok: true });
});

// POST /api/library/event-types/generate — LLM 生成一批（8 条，不落库）
router.post('/event-types/generate', async (req, res) => {
  try {
    const items = await generateEventTypes(req.body?.direction || '');
    res.json({ items });
  } catch (err) {
    console.error('[library] generate event-types failed:', err.message);
    res.status(500).json({ error: 'generate_failed', message: err.message });
  }
});

// POST /api/library/event-types/save-batch — 批量保存预览编辑后的条目（source=custom）
router.post('/event-types/save-batch', (req, res) => {
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (rawItems.length === 0) return res.status(400).json({ error: 'empty_items', message: '没有要保存的条目' });

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO event_types (key, name, duration_min, urgency, fun_from, desc, source, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 'custom', 1)`
  );

  const used = new Set(
    db.prepare(`SELECT key FROM event_types`).all().map(r => r.key)
  );
  const saved = [];
  const errors = [];

  for (const it of rawItems) {
    const name = toStringVal(it.name);
    if (!name) { errors.push({ index: saved.length, error: 'invalid_name' }); continue; }
    const key = dedupeKey(toSnakeKey(it.key) || autoKey(name), used);

    const durationMin = clampInt(it.durationMin, 1, 1440, 20);
    const urgency = clampInt(it.urgency, 1, 5, 1);
    const funFrom = parseFunFrom(it.funFrom);
    const desc = toStringVal(it.desc);

    const result = insert.run(key, name, durationMin, urgency, JSON.stringify(funFrom), desc);
    const row = db.prepare(`SELECT * FROM event_types WHERE id = ?`).get(result.lastInsertRowid);
    saved.push(eventTypeToApi(row));
  }

  res.json({ saved, errors });
});

// ──────────────── 朋友圈话题库 ────────────────

// GET /api/library/topics — 全部活动条目
router.get('/topics', (req, res) => {
  const rows = getDb().prepare(
    `SELECT * FROM moment_topics WHERE is_active = 1 ORDER BY id`
  ).all();
  res.json(rows.map(topicToApi));
});

// POST /api/library/topics — 新建一条自定义话题
router.post('/topics', (req, res) => {
  const name = toStringVal(req.body?.name);
  if (!name) return res.status(400).json({ error: 'invalid_name', message: 'name 不能为空' });

  const db = getDb();
  const exists = db.prepare(`SELECT id FROM moment_topics WHERE name = ?`).get(name);
  if (exists) return res.status(409).json({ error: 'duplicate_name', message: `话题「${name}」已存在` });

  const desc = toStringVal(req.body?.desc);
  const result = db.prepare(
    `INSERT INTO moment_topics (name, desc, source, is_active) VALUES (?, ?, 'custom', 1)`
  ).run(name, desc);

  const row = db.prepare(`SELECT * FROM moment_topics WHERE id = ?`).get(result.lastInsertRowid);
  res.json(topicToApi(row));
});

// PUT /api/library/topics/:id — 更新（系统/自定义均可）
router.put('/topics/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM moment_topics WHERE id = ? AND is_active = 1`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'topic_not_found' });

  const body = req.body || {};
  const name = body.name !== undefined ? toStringVal(body.name, row.name) : row.name;
  const desc = body.desc !== undefined ? toStringVal(body.desc, row.desc) : row.desc;

  if (!name) return res.status(400).json({ error: 'invalid_name', message: 'name 不能为空' });

  const dup = db.prepare(`SELECT id FROM moment_topics WHERE name = ? AND id != ?`).get(name, row.id);
  if (dup) return res.status(409).json({ error: 'duplicate_name', message: `话题「${name}」已被其他条目使用` });

  db.prepare(
    `UPDATE moment_topics SET name = ?, desc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(name, desc, row.id);

  const updated = db.prepare(`SELECT * FROM moment_topics WHERE id = ?`).get(row.id);
  res.json(topicToApi(updated));
});

// DELETE /api/library/topics/:id — 软删除
router.delete('/topics/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare(
    `UPDATE moment_topics SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1`
  ).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'topic_not_found' });
  res.json({ ok: true });
});

// POST /api/library/topics/generate — LLM 生成一批（8 条，不落库）
router.post('/topics/generate', async (req, res) => {
  try {
    const items = await generateTopics(req.body?.direction || '');
    res.json({ items });
  } catch (err) {
    console.error('[library] generate topics failed:', err.message);
    res.status(500).json({ error: 'generate_failed', message: err.message });
  }
});

// POST /api/library/topics/save-batch — 批量保存预览编辑后的条目（source=custom）
router.post('/topics/save-batch', (req, res) => {
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (rawItems.length === 0) return res.status(400).json({ error: 'empty_items', message: '没有要保存的条目' });

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO moment_topics (name, desc, source, is_active) VALUES (?, ?, 'custom', 1)`
  );

  const used = new Set(
    db.prepare(`SELECT name FROM moment_topics`).all().map(r => r.name)
  );
  const saved = [];
  const errors = [];

  for (const it of rawItems) {
    let name = toStringVal(it.name);
    if (!name) { errors.push({ index: saved.length, error: 'invalid_name' }); continue; }
    let candidate = name;
    let n = 1;
    while (used.has(candidate)) candidate = `${name}_${n++}`;
    name = candidate;
    used.add(name);

    const desc = toStringVal(it.desc);
    const result = insert.run(name, desc);
    const row = db.prepare(`SELECT * FROM moment_topics WHERE id = ?`).get(result.lastInsertRowid);
    saved.push(topicToApi(row));
  }

  res.json({ saved, errors });
});

export default router;
