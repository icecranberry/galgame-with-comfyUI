import { Router } from 'express';
import { config, updateComfyConfig, updateFeatureFlag } from '../config.js';

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

export default router;
