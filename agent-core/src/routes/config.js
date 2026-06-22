import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, updateComfyConfig, updateFeatureFlag, getLlmConfig, updateLlmConfig, updateUserConfig, getUserConfig, updateProactiveFreq } from '../config.js';
import { getDb } from '../db/index.js';
import { restartProactiveFreq } from '../services/proactiveChatScheduler.js';

const router = Router();

// GET /api/config — 获取全部配置
router.get('/', (req, res) => {
  res.json({
    comfy: {
      url: config.comfyui.url,
      artist: config.comfyui.artist,
      width: config.comfyui.width,
      height: config.comfyui.height,
      momentsArtist: config.comfyui.momentsArtist,
      momentsWidth: config.comfyui.momentsWidth,
      momentsHeight: config.comfyui.momentsHeight,
    },
    features: config.features,
    llm: getLlmConfig(),
  });
});

// PUT /api/config/comfy — 更新 ComfyUI 参数
router.put('/comfy', (req, res) => {
  const { artist, width, height, url, momentsArtist, momentsWidth, momentsHeight } = req.body;
  updateComfyConfig({ artist, width, height, url, momentsArtist, momentsWidth, momentsHeight });
  res.json({ ok: true, ...config.comfyui });
});

// PUT /api/config/features — 更新功能开关
router.put('/features', (req, res) => {
  const { key, value } = req.body;
  if (!key || !(key in config.features)) {
    return res.status(400).json({ error: `Invalid feature key: ${key}` });
  }
  updateFeatureFlag(key, value);
  res.json({ ok: true, features: config.features });
});

// PUT /api/config/proactive-freq — 更新主动聊天频率 0~1
router.put('/proactive-freq', (req, res) => {
  const { value } = req.body;
  if (value == null || typeof value !== 'number' || value < 0 || value > 1) {
    return res.status(400).json({ error: 'value must be 0~1' });
  }
  updateProactiveFreq(value);
  restartProactiveFreq();
  res.json({ ok: true, proactiveChatFreq: config.features.proactiveChatFreq });
});

// PUT /api/config/llm — 更新 LLM 配置
router.put('/llm', (req, res) => {
  const { apiKey, baseURL, model } = req.body;
  const result = updateLlmConfig({ apiKey, baseURL, model });
  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json({ ok: true, ...getLlmConfig() });
});

// GET /api/config/rules — 获取全部全局规则
router.get('/rules', (req, res) => {
  const db = getDb();
  const rules = db.prepare(`SELECT id, rule_key, rule_content, is_active, created_at, updated_at FROM global_rules ORDER BY id`).all();
  res.json({ rules });
});

// PUT /api/config/rules/:key — 更新单条全局规则
router.put('/rules/:key', (req, res) => {
  const db = getDb();
  const { rule_content, is_active } = req.body;
  const rule = db.prepare(`SELECT id FROM global_rules WHERE rule_key = ?`).get(req.params.key);
  if (!rule) {
    return res.status(404).json({ error: `Rule not found: ${req.params.key}` });
  }
  const updates = [];
  const params = [];
  if (rule_content !== undefined) { updates.push('rule_content = ?'); params.push(rule_content); }
  if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  updates.push("updated_at = datetime('now')");
  params.push(req.params.key);
  db.prepare(`UPDATE global_rules SET ${updates.join(', ')} WHERE rule_key = ?`).run(...params);
  const updated = db.prepare(`SELECT * FROM global_rules WHERE rule_key = ?`).get(req.params.key);
  res.json({ ok: true, rule: updated });
});

// GET /api/config/user — 获取用户昵称 + 自我设定
router.get('/user', (req, res) => {
  res.json(getUserConfig());
});

// PUT /api/config/user — 更新用户昵称 + 性别 + 外观 + 其他说明
router.put('/user', (req, res) => {
  const { nickname, gender, appearance, persona } = req.body;
  updateUserConfig({ nickname, gender, appearance, persona });
  res.json({ ok: true, ...getUserConfig() });
});

// GET /api/config/user-avatar — 获取用户头像路径
router.get('/user-avatar', (req, res) => {
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.dirname(path.dirname(path.dirname(__filename)));
  const avatarDir = path.join(projectRoot, 'data', 'avatars');
  const userAvatarPath = path.join(avatarDir, 'user_avatar.png');
  if (fs.existsSync(userAvatarPath)) {
    const mtime = fs.statSync(userAvatarPath).mtimeMs;
    res.json({ avatar_path: `/avatars/user_avatar.png?v=${mtime}` });
  } else {
    res.json({ avatar_path: null });
  }
});

// POST /api/config/user-avatar — 上传用户头像（base64）
router.post('/user-avatar', (req, res) => {
  const { base64 } = req.body;
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.dirname(path.dirname(path.dirname(__filename)));
  const avatarDir = path.join(projectRoot, 'data', 'avatars');
  fs.mkdirSync(avatarDir, { recursive: true });

  // null / 空字符串 = 删除头像
  if (!base64) {
    const userAvatarPath = path.join(avatarDir, 'user_avatar.png');
    try { if (fs.existsSync(userAvatarPath)) fs.unlinkSync(userAvatarPath); } catch {}
    return res.json({ ok: true, avatar_path: null });
  }

  const filePath = path.join(avatarDir, 'user_avatar.png');
  const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  const mtime = fs.statSync(filePath).mtimeMs;

  res.json({ ok: true, avatar_path: `/avatars/user_avatar.png?v=${mtime}` });
});

// ── 画师串收藏夹 ──

// GET /api/config/artist-favorites
router.get('/artist-favorites', (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, label, artist, sort_order, created_at FROM artist_favorites ORDER BY sort_order, created_at DESC`
  ).all();
  res.json({ favorites: rows });
});

// POST /api/config/artist-favorites
router.post('/artist-favorites', (req, res) => {
  const db = getDb();
  const { label, artist } = req.body;
  if (!label || !artist) {
    return res.status(400).json({ error: 'label and artist are required' });
  }
  // 去重检查
  const existing = db.prepare(`SELECT id FROM artist_favorites WHERE artist = ?`).get(artist.trim());
  if (existing) {
    return res.status(409).json({ error: 'duplicate', id: existing.id });
  }
  const result = db.prepare(
    `INSERT INTO artist_favorites (label, artist) VALUES (?, ?)`
  ).run(label.trim(), artist.trim());
  const row = db.prepare(`SELECT * FROM artist_favorites WHERE id = ?`).get(result.lastInsertRowid);
  res.json({ ok: true, favorite: row });
});

// PUT /api/config/artist-favorites/:id
router.put('/artist-favorites/:id', (req, res) => {
  const db = getDb();
  const { label, artist } = req.body;
  const existing = db.prepare(`SELECT id FROM artist_favorites WHERE id = ?`).get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Favorite not found' });
  }
  const updates = [];
  const params = [];
  if (label !== undefined) { updates.push('label = ?'); params.push(label.trim()); }
  if (artist !== undefined) { updates.push('artist = ?'); params.push(artist.trim()); }
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  params.push(req.params.id);
  db.prepare(`UPDATE artist_favorites SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const updated = db.prepare(`SELECT * FROM artist_favorites WHERE id = ?`).get(req.params.id);
  res.json({ ok: true, favorite: updated });
});

// DELETE /api/config/artist-favorites/:id
router.delete('/artist-favorites/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM artist_favorites WHERE id = ?`).get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Favorite not found' });
  }
  db.prepare(`DELETE FROM artist_favorites WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

export default router;
