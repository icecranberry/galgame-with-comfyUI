import { Router } from 'express';
import { getDb } from '../db/index.js';
import {
  generateEmojiPrompts as defaultGenerateEmojiPrompts,
  generateEmojiImage as defaultGenerateEmojiImage,
  getEmojiCategories,
  saveEmojiCategories,
  getEmojiFixedTagsText,
  saveEmojiFixedTagsText,
  getEmojiStyleMode,
  saveEmojiStyleMode,
  getEmojiResolution,
  saveEmojiResolution,
  createEmojiSet,
  setEmojiSetEnabled,
  renameEmojiSet,
  deleteEmojiSet,
  resolveOrCreateEmojiSet,
} from '../services/emojiService.js';
import { deleteImageFileByUrl, saveBase64Image, imageUrlExists } from '../services/imagePaths.js';
import { inspectStandingOutfits, normalizeStandingOutfitScene, validateMissingOutfitPolicy } from '../services/expressionStandingAppearance.js';
import { assertGodCommit } from '../services/godSays/commitGuard.js';

export function createEmojiRouter({generateEmojiPrompts=defaultGenerateEmojiPrompts,generateEmojiImage=defaultGenerateEmojiImage}={}) {
const router = Router();

router.get('/sets/:setId', (req,res) => {
  const db=getDb();
  const set=db.prepare('SELECT * FROM emoji_sets WHERE id=?').get(req.params.setId);
  if (!set) return res.status(404).json({error:'表情包不存在'});
  res.json({set,emojis:db.prepare('SELECT * FROM character_emojis WHERE set_id=? ORDER BY id').all(set.id)});
});

function savePromptDraft(db,characterId,setId,prompts,style) {
  const upsert=db.prepare(`INSERT INTO character_emojis(character_id,set_id,emoji_key,prompt,style,status,updated_at)
    VALUES(?,?,?,?,?,'prompt_ready',datetime('now')) ON CONFLICT(set_id,emoji_key) DO UPDATE SET
    prompt=excluded.prompt,style=excluded.style,status='prompt_ready',error_message=NULL,updated_at=datetime('now')`);
  db.transaction(()=>{for(const [key,prompt] of Object.entries(prompts)) upsert.run(characterId,setId,key,prompt,style);})();
}
function unchangedEmoji(db,row) {
  const current=db.prepare('SELECT prompt,image_path FROM character_emojis WHERE id=?').get(row.id);
  return current && current.prompt===row.prompt && current.image_path===row.image_path;
}
router.post('/prompts/apply',(req,res) => {
  const db=getDb();
  const {character_id:characterId,set_id:setId,prompts,style=''}=req.body||{};
  if (!Number.isSafeInteger(characterId) || !Number.isSafeInteger(setId) || typeof style!=='string' || style.length>1000) return res.status(400).json({error:'表情草稿参数无效'});
  if (!db.prepare('SELECT id FROM emoji_sets WHERE id=? AND character_id=?').get(setId,characterId)) return res.status(404).json({error:'表情包不存在或不属于该角色'});
  const keys=getEmojiCategories(db);
  if (!prompts || Array.isArray(prompts) || typeof prompts!=='object' || !Object.keys(prompts).length || Object.entries(prompts).some(([key,value])=>!keys.includes(key)||typeof value!=='string'||!value.trim()||value.length>12000)) return res.status(400).json({error:'表情提示词草稿无效'});
  assertGodCommit(req);
  savePromptDraft(db,characterId,setId,prompts,style);
  res.json({ok:true,character_id:characterId,set_id:setId,count:Object.keys(prompts).length});
});
router.post('/images/apply',(req,res) => {
  const db=getDb();
  const {character_id:characterId,set_id:setId,images}=req.body||{};
  if (!Number.isSafeInteger(characterId)||!Number.isSafeInteger(setId)||!Array.isArray(images)||!images.length||images.length>100) return res.status(400).json({error:'表情图片草稿无效'});
  if (!db.prepare('SELECT id FROM emoji_sets WHERE id=? AND character_id=?').get(setId,characterId)) return res.status(404).json({error:'表情包不存在或不属于该角色'});
  const seen=new Set();
  for(const image of images) {
    if (typeof image?.emoji_key!=='string'||seen.has(image.emoji_key)||typeof image.image_path!=='string'||!/^\/images\/emoji\/[^/\\?#%]+$/.test(image.image_path)||!imageUrlExists(image.image_path)||!db.prepare('SELECT id FROM character_emojis WHERE set_id=? AND emoji_key=?').get(setId,image.emoji_key)) return res.status(400).json({error:'表情图片不存在或目标已改变'});
    seen.add(image.emoji_key);
  }
  assertGodCommit(req);
  const update=db.prepare("UPDATE character_emojis SET image_path=?,status='done',error_message=NULL,updated_at=datetime('now') WHERE set_id=? AND emoji_key=?");
  db.transaction(()=>{for(const image of images) update.run(image.image_path,setId,image.emoji_key);})();
  res.json({ok:true,count:images.length,images});
});

/** 解析单条操作的目标配置单：显式 set_id 优先（校验归属），否则该角色启用中的配置单；都没有返回 null */
function resolveSetId(db, characterId, requested) {
  if (requested !== null && requested !== undefined && requested !== '') {
    const set = db.prepare('SELECT id FROM emoji_sets WHERE id = ? AND character_id = ?').get(parseInt(requested, 10), characterId);
    return set?.id || null;
  }
  const active = db.prepare('SELECT id FROM emoji_sets WHERE character_id = ? AND is_active = 1 ORDER BY id LIMIT 1').get(characterId);
  return active?.id || null;
}

/** GET /api/characters/emoji/overview — 所有角色 + 全部配置单 + 全部表情包行 */
router.get('/overview', (req, res) => {
  const db = getDb();
  const characters = db.prepare(`
    SELECT id, display_name, name, short_prompt, base_prompt, artist_override, custom_workflow, loras
    FROM characters ORDER BY id
  `).all();
  const sets = db.prepare(`
    SELECT id, character_id, name, is_active, created_at FROM emoji_sets ORDER BY character_id, id
  `).all();
  const emojis = db.prepare(`
    SELECT * FROM character_emojis ORDER BY set_id, id
  `).all();
  res.json({ characters, sets, emojis });
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

/** POST /api/characters/emoji/sets — 新建并启用一张空白配置单，保留其他套装勾选状态 */
router.post('/sets', (req, res) => {
  const db = getDb();
  const characterId = parseInt(req.body?.character_id, 10);
  if (!Number.isInteger(characterId)) {
    return res.status(400).json({ error: 'character_id is required' });
  }
  const char = db.prepare('SELECT id FROM characters WHERE id = ?').get(characterId);
  if (!char) return res.status(404).json({ error: '角色不存在' });
  try {
    const set = createEmojiSet(characterId, req.body?.name, db);
    res.json({ ok: true, set });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/characters/emoji/sets/:setId/activate — 独立启用/停用配置单；旧调用不传 enabled 时启用 */
router.post('/sets/:setId/activate', (req, res) => {
  const enabled = req.body?.enabled === undefined ? true : req.body.enabled;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled 必须为布尔值' });
  const db = getDb();
  try {
    const set = setEmojiSetEnabled(parseInt(req.params.setId, 10), enabled, db);
    if (!set) return res.status(404).json({ error: '表情包组不存在' });
    res.json({ ok: true, set });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/characters/emoji/sets/:setId — 重命名配置单 */
router.put('/sets/:setId', (req, res) => {
  const db = getDb();
  try {
    const set = renameEmojiSet(parseInt(req.params.setId, 10), req.body?.name, db);
    if (!set) return res.status(404).json({ error: '表情包组不存在' });
    res.json({ ok: true, set });
  } catch (err) {
    const status = err.message === '表情包组名称不能为空' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

/** DELETE /api/characters/emoji/sets/:setId — 删除配置单（仅删配置，不动已生成的图片文件） */
router.delete('/sets/:setId', (req, res) => {
  const db = getDb();
  try {
    const result = deleteEmojiSet(parseInt(req.params.setId, 10), db);
    if (!result) return res.status(404).json({ error: '表情包组不存在' });
    res.json({ ok: true, activated_set_id: result.activatedSetId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function inspectEmojiOutfits(body = {}) {
  const { character_ids, outfitScene, missingOutfitPolicy } = body;
  if (!Array.isArray(character_ids) || !character_ids.length) {
    throw Object.assign(new Error('character_ids is required (non-empty array)'), { status: 400 });
  }
  normalizeStandingOutfitScene(outfitScene);
  validateMissingOutfitPolicy(missingOutfitPolicy);
  const characters = [...new Set(character_ids)].map(id => getDb().prepare('SELECT * FROM characters WHERE id = ?').get(id));
  if (characters.some(char => !char)) throw Object.assign(new Error('角色不存在'), { status: 404 });
  return inspectStandingOutfits(characters, outfitScene);
}

router.post('/outfits/preflight', (req, res) => {
  try { res.json(inspectEmojiOutfits(req.body)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

/** POST /api/characters/emoji/prompts — 为单个或多个角色生成全部表情类别 prompt（作用于各自启用中的配置单，或指定的 set_id） */
router.post('/prompts', async (req, res) => {
  const { character_ids, style, set_id, outfitScene, missingOutfitPolicy } = req.body || {};
  if (!Array.isArray(character_ids) || character_ids.length === 0) {
    return res.status(400).json({ error: 'character_ids is required (non-empty array)' });
  }
  try {
    const preview = inspectEmojiOutfits(req.body);
    if (preview.missingCharacters.length && !missingOutfitPolicy) {
      return res.status(409).json({ error: '所选服装尚未配置，请选择自动补全或使用默认外观', ...preview });
    }
  } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }

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
        const availableKeys=getEmojiCategories(db);
        const emojiKeys=req.body.keys===undefined?availableKeys:req.body.keys;
        if (!Array.isArray(emojiKeys)||!emojiKeys.length||new Set(emojiKeys).size!==emojiKeys.length||emojiKeys.some(key=>!availableKeys.includes(key))) throw new Error('表情类别无效，请先查询真实类别');
        const set = req.body.save===false
          ? db.prepare('SELECT * FROM emoji_sets WHERE id=? AND character_id=?').get(set_id,characterId)
          : resolveOrCreateEmojiSet(characterId, set_id ?? null, db);
        if (!set) throw new Error('表情包不存在或不属于该角色');
        const prompts = await generateEmojiPrompts(char, typeof style === 'string' ? style.trim() : '', emojiKeys, { outfitScene, missingOutfitPolicy });
        if (req.body.save!==false) { assertGodCommit(req); savePromptDraft(db,characterId,set.id,prompts,style||''); }
        results.push({ character_id: characterId, set_id: set.id, ok: true, count: emojiKeys.length,...(req.body.save===false?{prompts}:{}) });
        } catch (err) {
          results.push({ character_id: characterId, ok: false, error: err.message });
        }
      }

  res.json({ ok: true, results });
});

/** POST /api/characters/emoji/images — 批量把 prompt_ready/failed 的行提交 ComfyUI（后台执行）；
 * 未指定 set_id 时只作用于各角色启用中的配置单 */
router.post('/images', (req, res) => {
  const { character_ids, keys, artist, includeDone, set_id } = req.body || {};
  if (!Array.isArray(character_ids) || character_ids.length === 0) {
    return res.status(400).json({ error: 'character_ids is required (non-empty array)' });
  }

  const db = getDb();
  if (set_id!==undefined && !db.prepare(`SELECT id FROM emoji_sets WHERE id=? AND character_id IN (${character_ids.map(()=>'?').join(',')})`).get(set_id,...character_ids)) return res.status(404).json({error:'表情包不存在或不属于指定角色'});
  const placeholders = character_ids.map(() => '?').join(',');
  // includeDone 时把已生成完成的行也纳入重画（仍要求已有 prompt）；generating 行始终排除，避免重复提交
  const statuses = includeDone ? ['done', 'prompt_ready', 'failed'] : ['prompt_ready', 'failed'];
  const params = [...character_ids, ...statuses];
  let where = `ce.character_id IN (${placeholders}) AND ce.status IN (${statuses.map(() => '?').join(',')}) AND ce.prompt != ''`;
  if (req.body.onlyMissing===true) where += " AND (ce.image_path IS NULL OR ce.image_path='')";
  if (set_id !== null && set_id !== undefined && set_id !== '') {
    where += ' AND ce.set_id = ?';
    params.push(parseInt(set_id, 10));
  } else {
    where += ' AND ce.set_id IN (SELECT id FROM emoji_sets WHERE is_active = 1)';
  }
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
    return res.json({ started: false, count: 0, message: includeDone ? '没有可重新生成的表情包' : '没有待生成的表情包' });
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
        if (!unchangedEmoji(db2,row)) continue; // 新图仍在相册中，不覆盖生成期间被修改的表情。
        if (db2.prepare('SELECT base_prompt FROM characters WHERE id=?').get(row.character_id)?.base_prompt!==char.base_prompt) {
          db2.prepare("UPDATE character_emojis SET status='failed',error_message='生成期间角色资料已改变，请核对提示词后重试' WHERE id=?").run(row.id);
          continue;
        }
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
        if (!unchangedEmoji(db2,row)) continue;
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
  const setId = resolveSetId(db, characterId, req.body?.set_id);
  if (!setId) return res.status(404).json({ error: '表情包不存在' });

  const row = db.prepare(`
    SELECT * FROM character_emojis WHERE set_id = ? AND emoji_key = ?
  `).get(setId, emojiKey);
  if (!row) return res.status(404).json({ error: '表情包不存在' });

  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!char) return res.status(404).json({ error: '角色不存在' });

  try {
    const style = typeof req.body?.style === 'string' ? req.body.style.trim() : '';
    const prompts = await generateEmojiPrompts(char, style, [emojiKey], {
      outfitScene: req.body?.outfitScene, missingOutfitPolicy: req.body?.missingOutfitPolicy,
    });
      const prompt = prompts[emojiKey];
    assertGodCommit(req);
    if (!unchangedEmoji(db,row)) return res.status(409).json({error:'生成期间表情已改变，请重新生成草稿'});

    db.prepare(`
      UPDATE character_emojis
      SET prompt = ?, style = ?, status = 'prompt_ready', error_message = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(prompt, style, row.id);

    res.json({ ok: true, prompt, style });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
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
  const setId = resolveSetId(db, characterId, req.body?.set_id);
  if (!setId) return res.status(404).json({ error: '表情包不存在' });

  const row = db.prepare(`
    SELECT * FROM character_emojis WHERE set_id = ? AND emoji_key = ?
  `).get(setId, emojiKey);
  if (!row) return res.status(404).json({ error: '表情包不存在' });
  if (!row.prompt) return res.status(400).json({ error: '该表情还没有 prompt，请先生成 prompt' });

  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!char) return res.status(404).json({ error: '角色不存在' });

  const previewOnly=req.body?.previewOnly===true;
  if (!previewOnly) db.prepare(`
    UPDATE character_emojis SET status='generating', error_message=NULL, updated_at=datetime('now') WHERE id=?
  `).run(row.id);
    const artist = typeof req.body?.artist === 'string' ? req.body.artist.trim() : '@ebora';
  req.socket.setTimeout(0);
  res.setTimeout(0);

  try {
      const result = await generateEmojiImage(row, char, artist);
    if (previewOnly) return res.status(result.ok?200:502).json(result.ok?{ok:true,image_path:result.url}:{error:result.error||'表情图片草稿失败'});
    if (!unchangedEmoji(db,row)) return res.status(409).json({error:'生成期间表情已改变，新图未覆盖旧记录'});
    if (db.prepare('SELECT base_prompt FROM characters WHERE id=?').get(characterId)?.base_prompt!==char.base_prompt) {
      db.prepare("UPDATE character_emojis SET status='failed',error_message='生成期间角色资料已改变，请核对提示词后重试' WHERE id=?").run(row.id);
      return res.status(409).json({error:'生成期间角色资料已改变，新图未覆盖旧记录'});
    }
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
    if (previewOnly) return res.status(502).json({error:err.message||'表情图片草稿失败'});
    if (!unchangedEmoji(db,row)) return res.status(409).json({error:'生成期间表情已改变，未覆盖新内容'});
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
  let set;
  try {
    set = resolveOrCreateEmojiSet(characterId, req.body?.set_id ?? null, db);
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
  const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };
  const safeKey = emojiKey.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
  const filename = `char_${characterId}_set${set.id}_${safeKey}_${Date.now()}.${extMap[mimeMatch[1]]}`;
  const imagePath = saveBase64Image('emoji', filename, base64);
  db.prepare(`
    INSERT INTO character_emojis (character_id, set_id, emoji_key, prompt, image_path, status, updated_at)
    VALUES (?, ?, ?, '', ?, 'done', datetime('now'))
    ON CONFLICT(set_id, emoji_key) DO UPDATE SET
      image_path = excluded.image_path,
      status = 'done',
      error_message = NULL,
      updated_at = datetime('now')
  `).run(characterId, set.id, emojiKey, imagePath);
  res.json({ ok: true, image_path: imagePath });
});

/** DELETE /api/characters/emoji/:characterId/:key — 清空表情包图片（保留 prompt 和栏位；set_id 走 query） */
router.delete('/:characterId/:key', (req, res) => {
  const characterId = parseInt(req.params.characterId, 10);
  const emojiKey = req.params.key;
  const db = getDb();
  const setId = resolveSetId(db, characterId, req.query?.set_id);
  if (!setId) return res.status(404).json({ error: '表情包不存在' });

  const row = db.prepare(`
    SELECT * FROM character_emojis WHERE set_id = ? AND emoji_key = ?
  `).get(setId, emojiKey);
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

return router;
}
export default createEmojiRouter();
