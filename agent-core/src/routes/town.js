/**
 * AI 小镇（世界页）API 路由
 *
 * GET  /api/town/state                      — 全量快照（地图/POI/agents/玩家/天气/活跃相遇）
 * POST /api/town/player/move                — 玩家 token 移动 {x, y}（服务端寻路 + 广播）
 * GET  /api/town/encounters/:id/messages    — 相遇对话记录
 * GET  /api/town/characters                 — 小镇角色名单（在场状态）
 * PUT  /api/town/characters/:id             — 更新参与配置 {townEnabled, homeLocationId}
 * POST /api/town/tick                       — 调试：手动触发一拍
 */

import { Router } from 'express';
import {
  getTownState, movePlayerTo, getEncounterMessages,
  setTownCharacterEnabled, listTownCharacters, forceTick,
} from '../services/town/townService.js';

const router = Router();

router.get('/state', (req, res) => {
  res.json(getTownState());
});

router.post('/player/move', (req, res) => {
  const { x, y } = req.body || {};
  const result = movePlayerTo(x, y);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.get('/encounters/:id/messages', (req, res) => {
  res.json({ messages: getEncounterMessages(parseInt(req.params.id, 10) || 0) });
});

router.get('/characters', (req, res) => {
  res.json({ characters: listTownCharacters() });
});

router.put('/characters/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  const { townEnabled, homeLocationId } = req.body || {};
  const result = setTownCharacterEnabled(id, {
    townEnabled: townEnabled === undefined ? undefined : !!townEnabled,
    homeLocationId: homeLocationId === undefined ? undefined : (Number.isInteger(homeLocationId) ? homeLocationId : null),
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post('/tick', (req, res) => {
  res.json(forceTick());
});

export { router as default };
