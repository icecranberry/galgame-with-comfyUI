import { Router } from 'express';
import { getDb } from '../db/index.js';
import { addSSEClient, removeSSEClient } from '../services/notificationBus.js';
import { forceProactiveNow } from '../services/proactiveChatScheduler.js';

const router = Router();

// Helper: SQLite datetime → ISO
function toISO(dt) {
  if (!dt) return dt;
  return dt.replace(' ', 'T') + '.000Z';
}

// GET /api/notifications/stream — SSE 推送端点（主动消息实时通知）
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

// ── 未读红点持久化 ──

// GET /api/notifications/unread — 返回所有有未读主动消息的角色
router.get('/unread', (_req, res) => {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT c.id, c.display_name, c.avatar_path,
             m.content, m.created_at as last_message_at, m.id as msg_id
      FROM characters c
      JOIN messages m ON m.id = (
        SELECT id FROM messages
        WHERE conversation_id = 'char_' || c.id AND role = 'assistant' AND is_proactive = 1
        ORDER BY id DESC LIMIT 1
      )
      WHERE c.proactive_disabled = 0
        AND m.created_at > COALESCE(c.proactive_last_read_at, '1970-01-01 00:00:00')
      ORDER BY m.created_at DESC
    `).all();

    const list = rows.map(r => ({
      character_id: r.id,
      display_name: r.display_name,
      avatar_path: r.avatar_path,
      
      content: r.content,
      created_at: toISO(r.last_message_at),
      msg_id: r.msg_id,
    }));

    res.json({ unread: list });
  } catch (err) {
    console.error('[notifications] unread error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/mark-read/:characterId — 标记该角色的主动消息已读
router.post('/mark-read/:characterId', (req, res) => {
  const db = getDb();
  try {
    db.prepare(`UPDATE characters SET proactive_last_read_at = datetime('now') WHERE id = ?`)
      .run(req.params.characterId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications] mark-read error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/force-proactive — 调试用：随机强制一个角色发起主动聊天
router.post('/force-proactive', async (_req, res) => {
  try {
    const result = await forceProactiveNow();
    if (result) {
      res.json({ ok: true, ...result });
    } else {
      res.json({ ok: false, error: 'No eligible characters (all have proactive_disabled=1)' });
    }
  } catch (err) {
    console.error('[notifications] force-proactive error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
