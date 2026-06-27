import { Router } from 'express';
import { getDb, getSystemRulesWithWorld } from '../db/index.js';
import { config } from '../config.js';
import { generateEvent, generateNextBranch } from '../services/eventGenerator.js';
import {
  addSSEClient,
  removeSSEClient,
  broadcastNewEvent,
  broadcastEventUpdate,
  broadcastEventConclusion,
  broadcastEventExpired,
} from '../services/eventNotificationBus.js';

const router = Router();

// ── 工具函数 ──

function toISO(dt) {
  if (!dt) return dt;
  return dt.replace(' ', 'T') + '.000Z';
}

function toSQLite(dt) {
  if (!dt) return dt;
  return dt.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

// ──────────────── SSE 推送 ────────────────

// GET /api/events/stream — SSE 端点（事件实时通知）
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write('event: connected\ndata: {}\n\n');
  addSSEClient(res);

  const heartbeat = setInterval(() => {
    try { res.write(':keepalive\n\n'); } catch { clearInterval(heartbeat); removeSSEClient(res); }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSSEClient(res);
  });
});

// GET /api/events/unread-count — 未读活跃事件数
router.get('/unread-count', (req, res) => {
  const db = getDb();
  const lastSeen = db.prepare(
    `SELECT setting_value FROM system_settings WHERE setting_key = 'last_events_seen_at'`
  ).pluck().get() || '1970-01-01T00:00:00.000Z';

  const lastSeenSQLite = toSQLite(lastSeen);

  const row = db.prepare(
    `SELECT COUNT(*) AS count FROM character_events WHERE status IN ('open','engaged') AND created_at > ?`
  ).get(lastSeenSQLite);

  res.json({ count: row ? row.count : 0 });
});

// POST /api/events/mark-read — 标记已读
router.post('/mark-read', (req, res) => {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES ('last_events_seen_at', ?, CURRENT_TIMESTAMP)`
  ).run(now);
  res.json({ ok: true, lastSeenAt: now });
});

// ──────────────── 奇遇事件 ────────────────

// GET /api/events — 列出所有活跃事件 + 全部事件历史
router.get('/', (req, res) => {
  const db = getDb();

  const activeEvents = db.prepare(`
    SELECT ce.*, c.display_name, c.avatar_path
    FROM character_events ce
    JOIN characters c ON c.id = ce.character_id
    WHERE ce.status IN ('open','engaged')
    ORDER BY ce.created_at DESC
  `).all();

  const history = db.prepare(`
    SELECT eh.*, c.display_name, c.avatar_path
    FROM event_history eh
    JOIN characters c ON c.id = eh.character_id
    ORDER BY eh.ended_at DESC
  `).all();

  // 序列化
  const format = (e) => ({
    ...e,
    choice_history: JSON.parse(e.choice_history || '[]'),
    created_at: toISO(e.created_at),
    expires_at: e.expires_at ? toISO(e.expires_at) : null,
    last_interaction_at: e.last_interaction_at ? toISO(e.last_interaction_at) : null,
    ended_at: e.ended_at ? toISO(e.ended_at) : null,
  });

  res.json({
    active: activeEvents.map(format),
    history: history.map(format),
  });
});

// GET /api/events/active/:characterId — 获取指定角色当前活跃事件
router.get('/active/:characterId', (req, res) => {
  const db = getDb();
  const event = db.prepare(`
    SELECT ce.*, c.display_name, c.avatar_path
    FROM character_events ce
    JOIN characters c ON c.id = ce.character_id
    WHERE ce.character_id = ? AND ce.status IN ('open','engaged')
    ORDER BY ce.id DESC LIMIT 1
  `).get(req.params.characterId);

  if (!event) {
    return res.json(null);
  }

  res.json({
    ...event,
    choice_history: JSON.parse(event.choice_history || '[]'),
    created_at: toISO(event.created_at),
    expires_at: toISO(event.expires_at),
    last_interaction_at: event.last_interaction_at ? toISO(event.last_interaction_at) : null,
  });
});

// POST /api/events/:id/choose — 选择选项 (A/B/C)
router.post('/:id/choose', async (req, res) => {
  const db = getDb();
  const event = db.prepare(`SELECT * FROM character_events WHERE id = ?`).get(req.params.id);

  if (!event) {
    return res.status(404).json({ error: 'event_not_found' });
  }

  if (event.status !== 'open' && event.status !== 'engaged') {
    return res.status(400).json({ error: 'event_not_active' });
  }

  // 检查过期
  const expiresAt = new Date(event.expires_at + 'Z');
  if (new Date() >= expiresAt) {
    return res.status(410).json({ error: 'event_expired' });
  }

  const { choice, customText } = req.body;
  if (!choice || !['A', 'B', 'C'].includes(choice)) {
    return res.status(400).json({ error: 'invalid_choice', message: 'choice must be "A", "B", or "C"' });
  }

  // 构建选择对象
  const choiceLabel = choice === 'A' ? event.choice_a
    : choice === 'B' ? event.choice_b
    : (customText || '自由发挥');

  const character = db.prepare(`SELECT * FROM characters WHERE id = ?`).get(event.character_id);
  if (!character) {
    return res.status(404).json({ error: 'character_not_found' });
  }

  try {
    const updatedEvent = await generateNextBranch(character, event, {
      choice,
      label: choiceLabel,
      customText: choice === 'C' ? customText : '',
    });

    if (!updatedEvent) {
      // 事件已结束（到达最大分支或过期）
      return res.json({ concluded: true });
    }

    res.json({
      concluded: false,
      event: {
        ...updatedEvent,
        choice_history: JSON.parse(updatedEvent.choice_history || '[]'),
        created_at: toISO(updatedEvent.created_at),
        expires_at: toISO(updatedEvent.expires_at),
        last_interaction_at: updatedEvent.last_interaction_at ? toISO(updatedEvent.last_interaction_at) : null,
      },
    });
  } catch (err) {
    console.error(`[events] choose error:`, err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// POST /api/events/:id/dismiss — 取消事件（不互动直接关闭）
router.post('/:id/dismiss', async (req, res) => {
  const db = getDb();
  const event = db.prepare(`SELECT * FROM character_events WHERE id = ?`).get(req.params.id);

  if (!event) {
    return res.status(404).json({ error: 'event_not_found' });
  }

  // 移到 history（不生成结局，不存记忆）
  db.prepare(`
    INSERT INTO event_history (character_id, event_type_key, title, description, final_image, summary, choice_history, total_branches, engaged, outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'cancelled')
  `).run(
    event.character_id, event.event_type_key,
    event.title, event.description, event.image,
    event.summary || event.description,
    event.choice_history, event.current_branch || 0,
    event.engaged
  );

  db.prepare(`DELETE FROM character_events WHERE id = ?`).run(event.id);

  broadcastEventExpired({
    character_id: event.character_id,
    event_title: event.title,
    outcome: 'cancelled',
  });

  res.json({ ok: true });
});

// POST /api/events/generate — 手动触发事件生成（调试用）
router.post('/generate', async (req, res) => {
  if (!config.features.events) {
    return res.status(503).json({ error: 'events_disabled' });
  }

  const db = getDb();
  const { characterId, eventTypeKey } = req.body;

  let character;
  if (characterId) {
    character = db.prepare(`SELECT * FROM characters WHERE id = ?`).get(characterId);
  } else {
    // 随机选一个符合条件的角色
    const candidates = db.prepare(`
      SELECT * FROM characters
      WHERE events_disabled = 0
        AND id NOT IN (SELECT character_id FROM character_events WHERE status IN ('pending','open','engaged'))
      ORDER BY RANDOM() LIMIT 1
    `).all();

    if (candidates.length === 0) {
      return res.status(404).json({ error: 'no_available_characters' });
    }
    character = candidates[0];
  }

  if (!character) {
    return res.status(404).json({ error: 'character_not_found' });
  }

  try {
    const event = await generateEvent(character, { eventTypeKey, manual: true });
    res.json({
      ...event,
      choice_history: JSON.parse(event.choice_history || '[]'),
      created_at: toISO(event.created_at),
      expires_at: toISO(event.expires_at),
    });
  } catch (err) {
    if (err.message === 'ALREADY_ACTIVE_EVENT') {
      return res.status(409).json({ error: 'already_active_event' });
    }
    console.error(`[events] generate error:`, err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

export { router as default };

// 不重新导出 generateEvent，scheduler 直接从 eventGenerator.js 导入
