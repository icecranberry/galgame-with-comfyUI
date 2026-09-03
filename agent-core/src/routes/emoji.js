import { Router } from 'express';
import { getDb } from '../db/index.js';
import {
  generateEmojiPrompts,
  generateEmojiImage,
  getEmojiCategories,
  saveEmojiCategories,
  getEmojiFixedTagsText,
  saveEmojiFixedTagsText,
  getEmojiStyleMode,
  saveEmojiStyleMode,
  getEmojiResolution,
  saveEmojiResolution,
} from '../services/emojiService.js';
import { deleteImageFileByUrl, saveBase64Image } from '../services/imagePaths.js';

const router = Router();

/** GET /api/characters/emoji/overview — 所有角色 + 全部表情包行 */
router.get('/overview', (req, res) => {
  const db = getDb();
  const characters = db.prepare(`
    SELECT id, display_name, name, short_prompt, base_prompt, artist_override, custom_workflow, loras
    FROM characters ORDER BY id
  `).all();
  const emojis = db.prepare(`
    SELECT * FROM character_emojis ORDER BY character_id, id
  `).all();
  res.json({ characters, emojis });
});

/** GET /api/characters/emoji/categories — 当前表情类别列表 */
router.get('/categories', (req, res) => {
  const db = getDb();
  res.json({ keys: getEmojiCategories(db) });
});

/** PUT /api/characters/emoji/categories — 整体替换表情类别 */
router.put('/categories', (req, res) => {
  const db = getDb();
  try {
    const keys = saveEmojiCategories(req.body?.keys, db);
    res.json({ ok: true, keys });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/characters/emoji/tags — 当前固定 tag 文本（逗号分隔）+ 表情包风格 + 生成分辨率 */
router.get('/tags', (_req, res) => {
  res.json({ tags: getEmojiFixedTagsText(), styleMode: getEmojiStyleMode(), resolution: getEmojiResolution() });
});

/** PUT /api/characters/emoji/tags — 更新固定 tag 文本、表情包风格与生成分辨率（styleMode / resolution 可选） */
router.put('/tags', (req, res) => {
  try {
    const tags = saveEmojiFixedTagsText(req.body?.tags);
    const styleMode = req.body?.styleMode !== undefined ? saveEmojiStyleMode(req.body.styleMode) : getEmojiStyleMode();
    const resolution = req.body?.resolution !== undefined
      ? saveEmojiResolution(req.body.resolution?.width, req.body.resolution?.height)
      : getEmojiResolution();
    res.json({ ok: true, tags, styleMode, resolution });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/characters/emoji/prompts — 为单个或多个角色生成全部表情类别 prompt */
router.post('/prompts', async (req, res) => {
  const { character_ids, style } = req.body || {};
  if (!Array.isArray(character_ids) || character_ids.length === 0) {
    return res.status(400).json({ error: 'character_ids is required (non-empty array)' });
  }

  const db = getDb();
  const results = [];
  for (const rawId of character_ids) {
    const characterId = parseInt(rawId, 10);
    const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
    if (!char) {
      results.push({ character_id: characterId, ok: false, error: '角色不存在' });
      continue;
    }

      try {
        const emojiKeys = getEmojiCategories(db);
        const prompts = await generateEmojiPrompts(char, typeof style === 'string' ? style.trim() : '', emojiKeys);
        const upsert = db.prepare(`
          INSERT INTO character_emojis (character_id, emoji_key, prompt, style, status, updated_at)
          VALUES (?, ?, ?, ?, 'prompt_ready', datetime('now'))
          ON CONFLICT(character_id, emoji_key)
          DO UPDATE SET
            prompt = excluded.prompt,
            style = excluded.style,
            status = 'prompt_ready',
            error_message = NULL,
            updated_at = datetime('now')
        `);
        for (const key of emojiKeys) {
          upsert.run(characterId, key, prompts[key], style || '');
        }
        results.push({ character_id: characterId, ok: true, count: emojiKeys.length });
        } catch (err) {
          results.push({ character_id: characterId, ok: false, error: err.message });
        }
      }

  res.json({ ok: true, results });
});

/** POST /api/characters/emoji/images — 批量把 prompt_ready/failed 的行提交 ComfyUI（后台执行） */
router.post('/images', (req, res) => {
  const { character_ids, keys, artist, includeDone } = req.body || {};
  if (!Array.isArray(character_ids) || character_ids.length === 0) {
    return res.status(400).json({ error: 'character_ids is required (non-empty array)' });
  }

  const db = getDb();
  const placeholders = character_ids.map(() => '?').join(',');
  // includeDone 时把已生成完成的行也纳入重画（仍要求已有 prompt）；generating 行始终排除，避免重复提交
  const statuses = includeDone ? ['done', 'prompt_ready', 'failed'] : ['prompt_ready', 'failed'];
  const params = [...character_ids, ...statuses];
  let where = `ce.character_id IN (${placeholders}) AND ce.status IN (${statuses.map(() => '?').join(',')}) AND ce.prompt != ''`;
  if (Array.isArray(keys) && keys.length > 0) {
    where += ` AND ce.emoji_key IN (${keys.map(() => '?').join(',')})`;
    params.push(...keys);
  }

  const rows = db.prepare(`
    SELECT ce.* FROM character_emojis ce
    WHERE ${where}
    ORDER BY ce.character_id, ce.id
  `).all(...params);

  if (rows.length === 0) {
    return res.json({ started: true, count: 0, message: includeDone ? '没有可重新生成的表情包' : '没有待生成的表情包' });
  }

  // 先全部置为 generating，再后台串行生成
  const update = db.prepare(`
    UPDATE character_emojis SET status = 'generating', error_message = NULL, updated_at = datetime('now')
    WHERE id = ?
  `);
  for (const row of rows) update.run(row.id);

  res.json({ started: true, count: rows.length });

  setImmediate(async () => {
    const db2 = getDb();
    for (const row of rows) {
      const char = db2.prepare('SELECT * FROM characters WHERE id = ?').get(row.character_id);
      if (!char) {
        db2.prepare(`UPDATE character_emojis SET status='failed', error_message='角色不存在', updated_at=datetime('now') WHERE id=?`).run(row.id);
        continue;
      }
      try {
      const result = await generateEmojiImage(row, char, artist);
        if (result.ok) {
          db2.prepare(`
            UPDATE character_emojis
            SET status='done', image_path=?, error_message=NULL, updated_at=datetime('now')
            WHERE id=?
          `).run(result.url, row.id);
        } else {
          db2.prepare(`
            UPDATE character_emojis
            SET status='failed', error_message=?, updated_at=datetime('now')
            WHERE id=?
          `).run(result.error || '生成失败', row.id);
        }
      } catch (err) {
        db2.prepare(`
          UPDATE character_emojis
          SET status='failed', error_message=?, updated_at=datetime('now')
          WHERE id=?
        `).run(err.message || String(err), row.id);
      }
    }
  });
});

/** POST /api/characters/emoji/:characterId/:key/prompt — 单个表情重新生成 prompt */
router.post('/:characterId/:key/prompt', async (req, res) => {
  const characterId = parseInt(req.params.characterId, 10);
  const emojiKey = req.params.key;
  const db = getDb();

  const row = db.prepare(`
    SELECT * FROM character_emojis WHERE character_id = ? AND emoji_key = ?
  `).get(characterId, emojiKey);
  if (!row) return res.status(404).json({ error: '表情包不存在' });

  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!char) return res.status(404).json({ error: '角色不存在' });

  try {
    const style = typeof req.body?.style === 'string' ? req.body.style.trim() : '';
    const prompts = await generateEmojiPrompts(char, style, [emojiKey]);
      const prompt = prompts[emojiKey];

    db.prepare(`
      UPDATE character_emojis
      SET prompt = ?, style = ?, status = 'prompt_ready', error_message = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(prompt, style, row.id);

    res.json({ ok: true, prompt, style });
  } catch (err) {
    db.prepare(`
      UPDATE character_emojis SET status='failed', error_message=?, updated_at=datetime('now') WHERE id=?
    `).run(err.message || String(err), row.id);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/characters/emoji/:characterId/:key/image — 单个表情用当前 prompt 生成/重新生成图片 */
router.post('/:characterId/:key/image', async (req, res) => {
  const characterId = parseInt(req.params.characterId, 10);
  const emojiKey = req.params.key;
  const db = getDb();

  const row = db.prepare(`
    SELECT * FROM character_emojis WHERE character_id = ? AND emoji_key = ?
  `).get(characterId, emojiKey);
  if (!row) return res.status(404).json({ error: '表情包不存在' });
  if (!row.prompt) return res.status(400).json({ error: '该表情还没有 prompt，请先生成 prompt' });

  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!char) return res.status(404).json({ error: '角色不存在' });

  db.prepare(`
    UPDATE character_emojis SET status='generating', error_message=NULL, updated_at=datetime('now') WHERE id=?
  `).run(row.id);
    const artist = typeof req.body?.artist === 'string' ? req.body.artist.trim() : '@ebora';
  req.socket.setTimeout(0);
  res.setTimeout(0);

  try {
      const result = await generateEmojiImage(row, char, artist);
    if (result.ok) {
      db.prepare(`
        UPDATE character_emojis
        SET status='done', image_path=?, error_message=NULL, updated_at=datetime('now')
        WHERE id=?
      `).run(result.url, row.id);
      res.json({ ok: true, image_path: result.url });
    } else {
      db.prepare(`
        UPDATE character_emojis SET status='failed', error_message=?, updated_at=datetime('now') WHERE id=?
      `).run(result.error || '生成失败', row.id);
      res.json({ ok: false, error: result.error || '生成失败' });
    }
  } catch (err) {
    db.prepare(`
      UPDATE character_emojis SET status='failed', error_message=?, updated_at=datetime('now') WHERE id=?
    `).run(err.message || String(err), row.id);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/characters/emoji/:characterId/:key/upload — 手动上传/替换表情包图片 */
router.post('/:characterId/:key/upload', (req, res) => {
  const characterId = parseInt(req.params.characterId, 10);
  const emojiKey = String(req.params.key || '').trim();
  if (!Number.isInteger(characterId) || !emojiKey) {
    return res.status(400).json({ error: '参数无效' });
  }
  const db = getDb();
  const char = db.prepare('SELECT id FROM characters WHERE id = ?').get(characterId);
  if (!char) return res.status(404).json({ error: '角色不存在' });
  const base64 = req.body?.base64;
  if (typeof base64 !== 'string' || !base64) {
    return res.status(400).json({ error: '缺少图片数据' });
  }
  const mimeMatch = base64.match(/^data:(image\/(?:png|jpeg|webp|gif|bmp));base64,/);
  if (!mimeMatch) {
    return res.status(400).json({ error: '仅支持 PNG / JPG / WEBP / GIF / BMP 图片' });
  }
  const buf = Buffer.from(base64.slice(mimeMatch[0].length), 'base64');
  if (buf.length === 0) return res.status(400).json({ error: '图片为空' });
  if (buf.length > 6 * 1024 * 1024) {
    return res.status(400).json({ error: '图片不能超过 6MB' });
  }
  const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };
  const safeKey = emojiKey.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
  const filename = `char_${characterId}_${safeKey}_${Date.now()}.${extMap[mimeMatch[1]]}`;
  const imagePath = saveBase64Image('emoji', filename, base64);
  db.prepare(`
    INSERT INTO character_emojis (character_id, emoji_key, prompt, image_path, status, updated_at)
    VALUES (?, ?, '', ?, 'done', datetime('now'))
    ON CONFLICT(character_id, emoji_key) DO UPDATE SET
      image_path = excluded.image_path,
      status = 'done',
      error_message = NULL,
      updated_at = datetime('now')
  `).run(characterId, emojiKey, imagePath);
  res.json({ ok: true, image_path: imagePath });
});

/** DELETE /api/characters/emoji/:characterId/:key — 清空表情包图片（保留 prompt 和栏位） */
router.delete('/:characterId/:key', (req, res) => {
  const characterId = parseInt(req.params.characterId, 10);
  const emojiKey = req.params.key;
  const db = getDb();

  const row = db.prepare(`
    SELECT * FROM character_emojis WHERE character_id = ? AND emoji_key = ?
  `).get(characterId, emojiKey);
  if (!row) return res.status(404).json({ error: '表情包不存在' });

  if (row.image_path) {
    try { deleteImageFileByUrl(row.image_path); } catch {}
  }
  db.prepare(`
    UPDATE character_emojis
    SET image_path = NULL,
        status = 'prompt_ready',
        error_message = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(row.id);
  res.json({ ok: true });
});

export default router;
