import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkWorkflowHealth, restoreWorkflow, ACTIVE_WORKFLOW, PRO_WORKFLOW } from '../services/workflowTemplates.js';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');

// GET /api/workflows — 列出 workflow 目录下所有 JSON 工作流文件（排除内置工作流）
router.get('/', (req, res) => {
  try {
    const EXCLUDED = new Set([ACTIVE_WORKFLOW, PRO_WORKFLOW]);
    const files = fs.readdirSync(WORKFLOW_DIR)
      .filter(f => f.endsWith('.json') && !EXCLUDED.has(f))
      .map(f => ({ filename: f, label: f.replace('.json', '') }));
    res.json({ workflows: files });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list workflows' });
  }
});

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
