import { Router } from 'express';
import { getDb } from '../db/index.js';
import {
  generateInstantReaction,
  describePromptLayers,
  buildUserContext,
  readUserName,
} from '../services/characterReactionService.js';
import {
  PACK_EVENT_TYPES,
  PACK_LINES_PER_EVENT,
  deleteReactionPack,
  generateReactionPack,
  getReactionPack,
  normalizePackEventTypes,
  saveManualReactionPack,
} from '../services/characterReactionPackService.js';

const router = Router();

/**
 * POST /api/character-reactions/instant
 * 低概率即时反应：一次获准事件至多一次请求。
 * body: { event, history?, emojis? }
 * 事实校验失败返回 4xx；模型失败 / 非法输出返回 502。
 * 所有失败都由前端回退缓存短句，本接口不做自动重试。
 */
router.post('/instant', async (req, res) => {
  const body = req.body || {};
  const event = body.event;
  if (!event || typeof event !== 'object') {
    return res.status(400).json({ ok: false, error: '缺少事件对象' });
  }

  try {
    const result = await generateInstantReaction({
      event,
      history: Array.isArray(body.history) ? body.history.slice(-3) : [],
      emojis: Array.isArray(body.emojis) ? body.emojis : [],
      timeoutMs: 4000,
    });
    if (!result.ok) {
      return res.status(result.status || 502).json({ ok: false, error: result.reason });
    }
    res.json({
      ok: true,
      text: result.text,
      emoji: result.emoji ?? null,
      idempotent: !!result.idempotent,
    });
  } catch (error) {
    console.error('[character-reactions] instant failed:', error.message);
    res.status(502).json({ ok: false, error: '即时反应失败' });
  }
});

/** POST /api/character-reactions/prompt-probe — 只回四层前缀摘要，不调用模型（调试高缓存前缀用） */
router.post('/prompt-probe', (req, res) => {
  try {
    const event = req.body?.event || {};
    const actorId = parseInt(String(event.actorKey || '').replace(/^character:/, ''), 10);
    if (!Number.isInteger(actorId)) return res.status(400).json({ ok: false, error: '缺少角色 id' });
    const character = getDb()
      .prepare('SELECT id, display_name, base_prompt, short_prompt FROM characters WHERE id = ?')
      .get(actorId);
    const userContext = buildUserContext({
      characterId: actorId,
      characterName: character?.display_name || character?.name || '',
      userName: readUserName(getDb()),
      content: { type: event.type, content: '调试用操作说明', actorKey: event.actorKey },
      occurredAtMs: Date.now(),
      history: [],
    });
    res.json({ ok: true, layers: describePromptLayers({ character: character || { id: actorId }, userContext }), userContext });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── 短句包（M2）──

/** GET /api/character-reactions/packs/:characterId — 读取短句包（含失效标记与前端覆盖结构） */
router.get('/packs/:characterId', (req, res) => {
  try {
    const entry = getReactionPack(req.params.characterId);
    if (!entry) return res.status(404).json({ ok: false, error: '该角色还没有短句包' });
    res.json({ ok: true, entry });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/character-reactions/packs/:characterId/generate — 用户主动触发生成一份短句包。
 * body: { eventTypes? } 缺省覆盖全部支持事件。
 * 整包不合法时返回 502 且不覆盖旧包；本路径不自动重试、不逐角色批量生成。
 */
router.post('/packs/:characterId/generate', async (req, res) => {
  try {
    const requested = req.body?.eventTypes === undefined ? PACK_EVENT_TYPES : normalizePackEventTypes(req.body?.eventTypes);
    const result = await generateReactionPack({ characterId: req.params.characterId, eventTypes: requested });
    if (!result.ok) return res.status(result.status || 502).json({ ok: false, error: result.error });
    res.json({ ok: true, entry: result.entry });
  } catch (error) {
    console.error('[character-reactions] pack generate failed:', error.message);
    res.status(502).json({ ok: false, error: '短句包生成失败' });
  }
});

/** PUT /api/character-reactions/packs/:characterId — 保存用户手动编辑的短句包（同一套严格校验） */
router.put('/packs/:characterId', (req, res) => {
  try {
    const pack = req.body?.pack || req.body;
    const result = saveManualReactionPack({ characterId: req.params.characterId, pack });
    if (!result.ok) return res.status(result.status || 400).json({ ok: false, error: result.error });
    res.json({ ok: true, entry: result.entry });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

/** DELETE /api/character-reactions/packs/:characterId — 删除短句包（删除后该角色未命中概率时不再弹通知） */
router.delete('/packs/:characterId', (req, res) => {
  try {
    const removed = deleteReactionPack(req.params.characterId);
    res.json({ ok: true, removed });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/** GET /api/character-reactions/pack-meta — 每个事件需要几条、支持哪些事件（设置页展示用） */
router.get('/pack-meta', (_req, res) => {
  res.json({ ok: true, eventTypes: PACK_EVENT_TYPES, linesPerEvent: PACK_LINES_PER_EVENT });
});

export default router;
