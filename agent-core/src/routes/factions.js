/**
 * /api/factions —— 「派系与组织」模块的路由（酒馆页第三块）。
 *
 * 本文件**不改 app.js**（见 `_autoMount.js`）：放在 `src/routes/` 下即按约定自动挂到 `/api/factions`。
 * 业务在 `services/factionService.js`；本文件只做 HTTP 适配与错误映射。
 *
 * ⚠ 路由顺序：`/types`、`/relations` 必须排在 `/:id` 之前，否则会被 `/:id` 吃掉。
 */

import { Router } from 'express';
import {
  FACTION_TYPE_SUGGESTIONS,
  FACTION_STATUS_SUGGESTIONS,
  FACTION_STANCE_SUGGESTIONS,
  FACTION_RELATIONS,
  ROLE_SUGGESTIONS,
  POWER_PILLAR_SUGGESTIONS,
  DEFAULT_VISIBLE_RELATIONS,
  listFactions,
  getFaction,
  createFaction,
  updateFaction,
  deleteFaction,
  addMember,
  updateMember,
  removeMember,
  upsertRelation,
  removeRelation,
  buildPromptBlock,
} from '../services/factionService.js';

const router = Router();

/** 统一的错误出口：业务抛的错带 `status`，其余按 500（并把原因如实回给前端） */
function handle(res, fn) {
  try {
    fn();
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error('[factions]', err);
    res.status(status).json({ error: err?.message || '派系与组织操作失败' });
  }
}

// ── 词表（红线 8：唯一真源在后端，前端只渲染）──
// ⚠ `types` / `statuses` / `stances` 是**建议值，不是白名单**：类型/状态/立场都可自由填
//   （硬校验会让"换世界观"直接失配 —— 2026-10-07 用户实报「类型不合适」后改的）。
//   只有 `relations` 是枚举（那几个词通用，不指向任何世界观）。
router.get('/types', (req, res) => {
  res.json({
    types: FACTION_TYPE_SUGGESTIONS,
    statuses: FACTION_STATUS_SUGGESTIONS,
    stances: FACTION_STANCE_SUGGESTIONS,
    relations: FACTION_RELATIONS,
    roleSuggestions: ROLE_SUGGESTIONS,
    pillarSuggestions: POWER_PILLAR_SUGGESTIONS,
    defaultVisibleRelations: DEFAULT_VISIBLE_RELATIONS,
  });
});

// ⚠ /prompt-block 必须排在 /:id 之前，否则会被 :id 吃掉
router.get('/prompt-block', (req, res) => handle(res, () => {
  const text = buildPromptBlock({
    onlyWithGoal: req.query.onlyWithGoal === '1' || req.query.onlyWithGoal === 'true',
  });
  res.json({ text, empty: text == null });
}));

// ── 派系 CRUD ──
router.get('/', (req, res) => handle(res, () => res.json({ items: listFactions() })));

router.get('/:id', (req, res) => handle(res, () => res.json(getFaction(req.params.id))));

router.post('/', (req, res) => handle(res, () => res.status(201).json(createFaction(req.body || {}))));

router.put('/:id', (req, res) => handle(res, () => res.json(updateFaction(req.params.id, req.body || {}))));

router.delete('/:id', (req, res) => handle(res, () => res.json(deleteFaction(req.params.id))));

// ── 成员（多对多：角色可同时属多个派系）──
router.post('/:id/members', (req, res) => handle(res, () => res.status(201).json(addMember(req.params.id, req.body || {}))));

router.put('/:id/members/:memberId', (req, res) => handle(res, () => res.json(updateMember(req.params.id, req.params.memberId, req.body || {}))));

router.delete('/:id/members/:memberId', (req, res) => handle(res, () => res.json(removeMember(req.params.id, req.params.memberId))));

// ── 势力关系（派系↔派系）──
router.post('/relations', (req, res) => handle(res, () => res.status(201).json(upsertRelation(req.body || {}))));

router.delete('/relations/:relationId', (req, res) => handle(res, () => res.json(removeRelation(req.params.relationId))));

export default router;
