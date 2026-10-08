/**
 * 「我的表情库」API —— 用户自己的表情包，跨角色通用。
 *
 * 与 /api/characters/emoji（角色表情包）分开挂载：那张表有 character_id 外键，
 * 且 /:characterId/:key/upload 与 /user/:key/upload 路径同构，同文件注册只能靠顺序区分，
 * 容易踩坑，所以独立成一个前缀。
 *
 * GET    /api/user-emoji              — 列表
 * POST   /api/user-emoji/:key/upload  — 上传图片（base64 data URI，≤6MB）
 * DELETE /api/user-emoji/:key         — 删除
 */
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { saveBase64Image } from '../services/imagePaths.js';

const router = Router();

/** 表情名规整：只留中英文、数字、下划线、连字符，最长 24 字 */
function normalizeKey(raw) {
  return String(raw || '').trim().replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 24);
}

router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT emoji_key, image_path, updated_at FROM user_emojis
      WHERE status = 'done' AND image_path IS NOT NULL
      ORDER BY updated_at DESC, emoji_key ASC
    `).all();
    res.json({
      emojis: rows.map(r => ({ key: r.emoji_key, image_path: r.image_path, updated_at: r.updated_at })),
    });
  } catch (err) {
    console.error('[userEmoji] GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:key/upload', (req, res) => {
  try {
    const emojiKey = normalizeKey(req.params.key);
    if (!emojiKey) return res.status(400).json({ error: '表情名无效' });

    const base64 = req.body?.base64;
    if (typeof base64 !== 'string' || !base64) return res.status(400).json({ error: '缺少图片数据' });
    const mimeMatch = base64.match(/^data:(image\/(?:png|jpeg|webp|gif|bmp));base64,/);
    if (!mimeMatch) return res.status(400).json({ error: '仅支持 PNG / JPG / WEBP / GIF / BMP 图片' });
    const buf = Buffer.from(base64.slice(mimeMatch[0].length), 'base64');
    if (buf.length === 0) return res.status(400).json({ error: '图片为空' });
    if (buf.length > 6 * 1024 * 1024) return res.status(400).json({ error: '图片不能超过 6MB' });

    const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };
    const filename = `user_${emojiKey}_${Date.now()}.${extMap[mimeMatch[1]]}`;
    const imagePath = saveBase64Image('emoji', filename, base64);

    const db = getDb();
    db.prepare(`
      INSERT INTO user_emojis (emoji_key, prompt, image_path, status, updated_at)
      VALUES (?, '', ?, 'done', datetime('now'))
      ON CONFLICT(emoji_key) DO UPDATE SET
        image_path = excluded.image_path,
        status = 'done',
        error_message = NULL,
        updated_at = datetime('now')
    `).run(emojiKey, imagePath);

    res.json({ ok: true, key: emojiKey, image_path: imagePath });
  } catch (err) {
    console.error('[userEmoji] upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:key', (req, res) => {
  try {
    const emojiKey = normalizeKey(req.params.key);
    if (!emojiKey) return res.status(400).json({ error: '表情名无效' });
    const db = getDb();
    const info = db.prepare('DELETE FROM user_emojis WHERE emoji_key = ?').run(emojiKey);
    if (!info.changes) return res.status(404).json({ error: '表情不存在' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[userEmoji] delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
