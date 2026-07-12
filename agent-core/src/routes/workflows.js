import { Router } from 'express';
import { checkWorkflowHealth, restoreWorkflow } from '../services/workflowTemplates.js';

const router = Router();

// GET /api/workflows/status — 检查工作流文件健康状况
router.get('/status', (req, res) => {
  const health = checkWorkflowHealth();
  res.json({ ok: true, ...health });
});

// POST /api/workflows/restore — 恢复工作流（写入 turbo → 制图工作流.json, base → 制图工作流-pro.json）
router.post('/restore', (req, res) => {
  try {
    const result = restoreWorkflow();
    res.json(result);
  } catch (err) {
    console.error('[workflows] restore error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
