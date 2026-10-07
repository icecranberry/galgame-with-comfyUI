import { Router } from 'express';
import {
  getTodayNewspaperForFrontend,
  maybeGenerateDailyNewspaper,
  setWorldStateDismissed,
  listNewspaperEditions,
  getNewspaperByDate,
  regenerateNewspaperImage,
  regenerateTodayNewspaper,
} from '../services/newspaperService.js';

const router = Router();

router.post('/regenerate', async (req, res) => {
  try {
    res.json({ newspaper: await regenerateTodayNewspaper() });
  } catch (err) {
    res.status(400).json({ error: err.message || '日报重新生成失败，请稍后再试' });
  }
});

// GET /api/newspaper/today — 今天的《邻舍日报》（没有则 { newspaper: null }）
router.get('/today', (req, res) => {
  res.json({ newspaper: getTodayNewspaperForFrontend() });
});

// GET /api/newspaper/editions — 历史期简目（最新在前，供期号导航）
router.get('/editions', (req, res) => {
  res.json({ editions: listNewspaperEditions() });
});

// GET /api/newspaper/by-date/:date — 按日期回看某一期（YYYY-MM-DD）
router.get('/by-date/:date', (req, res) => {
  res.json({ newspaper: getNewspaperByDate(req.params.date) });
});

// POST /api/newspaper/generate — 手动补发今天的报纸（已存在则直接返回现有内容）
router.post('/generate', async (req, res) => {
  const existing = getTodayNewspaperForFrontend();
  if (existing) {
    res.json({ newspaper: existing, started: false });
    return;
  }
  const task = maybeGenerateDailyNewspaper();
  if (!task) {
    res.status(409).json({ error: '当前不满足生成条件（清晨时段外 / 刚失败冷却中 / 已在生成）' });
    return;
  }
  res.json({ started: true });
});

// POST /api/newspaper/regenerate-image — 手动补印一张缺失的配图（前端「重新生成配图」按钮）
// body: { slot: 'lead'|'world'|'item', index?: number, date?: 'YYYY-MM-DD' }
// date 省略 = 今天的报纸；带 date 可给历史期补图。不受自动补印的 15 分钟冷却限制
router.post('/regenerate-image', async (req, res) => {
  const date = typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
    ? req.body.date
    : undefined;
  const result = await regenerateNewspaperImage({
    date,
    slot: req.body?.slot,
    index: req.body?.index,
  });
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true, newspaper: result.newspaper });
});

// POST /api/newspaper/dismiss-world — 消除/恢复今天的世界影响
// body 可选 { dismissed: boolean }：true=消除（当天不再注入），false=恢复；省略则按当前状态切换
router.post('/dismiss-world', (req, res) => {
  const paper = getTodayNewspaperForFrontend();
  if (!paper?.world_state) {
    res.json({ ok: false, error: '今天的报纸没有世界影响', newspaper: paper });
    return;
  }
  const target = typeof req.body?.dismissed === 'boolean'
    ? req.body.dismissed
    : !paper.world_dismissed;
  setWorldStateDismissed(target);
  res.json({ ok: true, dismissed: target, newspaper: getTodayNewspaperForFrontend() });
});

export default router;
