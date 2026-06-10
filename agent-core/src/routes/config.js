import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, updateComfyConfig, updateFeatureFlag, getDeepseekApiKeyPreview, updateDeepseekApiKey } from '../config.js';
import { getDb } from '../db/index.js';

const router = Router();

// GET /api/config — 获取全部配置
router.get('/', (req, res) => {
  res.json({
    comfy: {
      artist: config.comfyui.artist,
      width: config.comfyui.width,
      height: config.comfyui.height,
    },
    features: config.features,
    deepseek: getDeepseekApiKeyPreview(),
  });
});

// PUT /api/config/comfy — 更新 ComfyUI 参数
router.put('/comfy', (req, res) => {
  const { artist, width, height } = req.body;
  updateComfyConfig({ artist, width, height });
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

// PUT /api/config/deepseek — 更新 DeepSeek API Key
router.put('/deepseek', (req, res) => {
  const { apiKey } = req.body;
  const result = updateDeepseekApiKey(apiKey);
  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json({ ok: true, ...getDeepseekApiKeyPreview() });
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

// GET /api/config/user-avatar — 获取用户头像路径
router.get('/user-avatar', (req, res) => {
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.dirname(path.dirname(path.dirname(__filename)));
  const avatarDir = path.join(projectRoot, 'data', 'avatars');
  const userAvatarPath = path.join(avatarDir, 'user_avatar.png');
  if (fs.existsSync(userAvatarPath)) {
    res.json({ avatar_path: '/avatars/user_avatar.png' });
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

  res.json({ ok: true, avatar_path: '/avatars/user_avatar.png' });
});

export default router;
