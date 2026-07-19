import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

function toISODate(sqliteDT) {
  if (!sqliteDT) return sqliteDT;
  return sqliteDT.replace(' ', 'T') + '.000Z';
}

// GET /api/mailbox — 列出所有信件
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const total = db.prepare('SELECT COUNT(*) AS c FROM mailbox_letters').get().c;

    const letters = db.prepare(`
      SELECT ml.*, c.display_name, c.avatar_path
      FROM mailbox_letters ml
      LEFT JOIN characters c ON ml.character_id = c.id
      ORDER BY ml.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.json({
      letters: letters.map(l => ({
        ...l,
        created_at: toISODate(l.created_at),
        replied_at: toISODate(l.replied_at),
        reply_at: toISODate(l.reply_at),
      })),
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error('[mailbox] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mailbox/unread — 未读计数
router.get('/unread', (req, res) => {
  try {
    const db = getDb();
    const count = db.prepare(
      `SELECT COUNT(*) AS c FROM mailbox_letters WHERE direction = 'char_to_user' AND is_read = 0`
    ).get().c;
    const processingCount = db.prepare(
      `SELECT COUNT(*) AS c FROM mailbox_letters WHERE status = 'processing'`
    ).get().c;
    res.json({ unread: count, processing: processingCount });
  } catch (err) {
    console.error('[mailbox] unread error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mailbox/send — 用户发信给角色
router.post('/send', (req, res) => {
  try {
    const { character_id, title, content } = req.body;
    if (!character_id) return res.status(400).json({ error: '缺少 character_id' });
    if (!content || !content.trim()) return res.status(400).json({ error: '信件内容不能为空' });

    const db = getDb();

    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(character_id);
    if (!character) return res.status(404).json({ error: '角色不存在' });

    // 计算回信时间：3~10 分钟后（UTC 格式，与系统其他模块一致）
    const replyDelayMs = 180000 + Math.random() * 420000;
    const replyAt = new Date(Date.now() + replyDelayMs).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');

    const result = db.prepare(`
      INSERT INTO mailbox_letters (character_id, direction, title, content, status, reply_at)
      VALUES (?, 'user_to_char', ?, ?, 'pending', ?)
    `).run(character_id, title || '', content.trim(), replyAt);

    const replyAtLocal = new Date(Date.now() + replyDelayMs);
    const replyAtStr = `${String(replyAtLocal.getHours()).padStart(2,'0')}:${String(replyAtLocal.getMinutes()).padStart(2,'0')}`;
    console.log(`[mailbox] letter to "${character.name}" → reply scheduled at ${replyAtStr} (in ${Math.round(replyDelayMs/60000)}min) [id=${result.lastInsertRowid}]`);

    const letter = db.prepare('SELECT ml.*, c.display_name, c.avatar_path FROM mailbox_letters ml LEFT JOIN characters c ON ml.character_id = c.id WHERE ml.id = ?').get(result.lastInsertRowid);

    res.json({
      letter: {
        ...letter,
        created_at: toISODate(letter.created_at),
        reply_at: toISODate(letter.reply_at),
        replied_at: null,
      },
    });
  } catch (err) {
    console.error('[mailbox] send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mailbox/:id — 单封信详情
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const letter = db.prepare(`
      SELECT ml.*, c.display_name, c.avatar_path
      FROM mailbox_letters ml
      LEFT JOIN characters c ON ml.character_id = c.id
      WHERE ml.id = ?
    `).get(req.params.id);

    if (!letter) return res.status(404).json({ error: '信件不存在' });

    // 标记已读
    if (!letter.is_read) {
      db.prepare('UPDATE mailbox_letters SET is_read = 1 WHERE id = ?').run(req.params.id);
    }

    res.json({
      ...letter,
      created_at: toISODate(letter.created_at),
      replied_at: toISODate(letter.replied_at),
      reply_at: toISODate(letter.reply_at),
    });
  } catch (err) {
    console.error('[mailbox] detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/mailbox/:id/mark-read — 标记已读
router.put('/:id/mark-read', (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE mailbox_letters SET is_read = 1 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[mailbox] mark-read error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/mailbox/:id — 删除信件
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const letter = db.prepare('SELECT * FROM mailbox_letters WHERE id = ?').get(req.params.id);
    if (!letter) return res.status(404).json({ error: '信件不存在' });

    db.prepare('DELETE FROM mailbox_letters WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[mailbox] delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
