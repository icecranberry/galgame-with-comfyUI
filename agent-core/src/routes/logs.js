import { Router } from 'express';
import { getLogs, clearLogs } from '../services/logBuffer.js';

const router = Router();

// 增量拉取运行日志：?after=<seq> 只返回 seq 更大的条目
router.get('/', (req, res) => {
  const after = Number(req.query.after) || 0;
  res.json(getLogs(after));
});

// 清空内存日志
router.delete('/', (req, res) => {
  clearLogs();
  res.json({ ok: true });
});

export default router;
