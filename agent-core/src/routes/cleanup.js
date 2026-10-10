/**
 * /api/cleanup —— 按时间清理「生成的图片」与「生成的内容记录」
 *
 * 两个端点，两段式：
 *   GET  /api/cleanup/survey?days=7   只统计不删（界面预览用）
 *   POST /api/cleanup/purge           真删（body: { days, targets: [] }，必须显式指定目标）
 *
 * 另外 GET /api/cleanup/backups 列出执行前自动生成的数据库备份。
 */

import { Router } from 'express';
import { surveyData, purgeData, listCleanupBackups, CLEANUP_TARGETS } from '../services/dataCleanup.js';

const router = Router();

// GET /api/cleanup/targets — 可清理项的定义（界面据此渲染分组与说明）
router.get('/targets', (req, res) => {
  res.json({
    targets: CLEANUP_TARGETS.map(t => ({
      key: t.key, label: t.label, group: t.group, desc: t.desc,
    })),
  });
});

// GET /api/cleanup/survey?days=7 — 预览：会删多少行、多少个文件、多少字节
router.get('/survey', (req, res) => {
  try {
    const days = Number(req.query.days) || 7;
    res.json(surveyData(days));
  } catch (err) {
    console.error('[cleanup] survey error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/cleanup/purge — 执行清理。
 * Body: { days: 7, targets: ['chat','moments'] }
 * **必须显式传 targets**：不存在「不带参数就把能删的都删了」这种路径。
 * 执行前会自动备份数据库，备份路径随响应返回。
 */
router.post('/purge', async (req, res) => {
  try {
    const days = Number(req.body?.days) || 7;
    const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
    if (!targets.length) {
      return res.status(400).json({ error: '必须指定要清理的项目（targets 不能为空）' });
    }
    // purgeData 是 async（备份走 SQLite 一致性快照，含 WAL 未合并数据）
    const result = await purgeData({ days, targets });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[cleanup] purge error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cleanup/backups — 已有的清理前备份
router.get('/backups', (req, res) => {
  try {
    res.json({ backups: listCleanupBackups() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
