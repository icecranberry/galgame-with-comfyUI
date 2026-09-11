/**
 * AI 小镇（世界页）API 路由（v2）
 *
 * 运行时   GET  /api/town/state                     — 全量快照（地图版本/居民/玩家/天气/相遇）
 *          POST /api/town/player/move               — 点击寻路 {x, y}
 *          POST /api/town/player/dir                — WASD 单步 {dx, dy}
 *          GET  /api/town/encounters/:id/messages   — 相遇对话记录
 *          POST /api/town/tick                      — 调试：手动触发一拍
 * 素材库   GET/POST /api/town/assets、POST :id/regenerate、POST :id/upload（手动上传图片替换）、DELETE :id、POST /batch
 * 地图     GET  /api/town/map                       — 渲染载荷（layers + assets）
 *          PUT  /api/town/map                       — 编辑器保存（version+1 广播）
 * 向导     GET/POST/PUT/DELETE /api/town/init*      — 七步初始化流程
 * 居民     GET/POST /api/town/npcs、PUT/DELETE :id、:id/sprites、:id/portrait、:id/asset-set（一次出齐全套）、:id/reroll、:id/chat、:id/messages
 * 角色     GET  /api/town/characters                — 素材状态 + 入住状态（管理面板）
 *          PUT  /api/town/characters/:id            — 入住/退住 {townEnabled}
 */
import { Router } from 'express';
import { getDb } from '../db/index.js';
import {
  getTownState, movePlayerTo, movePlayerDir, getEncounterMessages,
  setTownCharacterEnabled, listTownCharacters, forceTick, setNpcEnabled, reloadTown,
  generateCharacterSprites, getTownSettings, updateTownSettings, resetWorld,
} from '../services/town/townService.js';
import {
  listAssets, createAsset, regenerateAsset, deleteAsset, generateAssetsBatch, saveEditedAssetImage, importAssetImage, getAssetById, cropAssetImage, cropTileAssetImage, refineAssetWithHires,
  updateAssetGenerationConfig,
} from '../services/town/townAssetService.js';
import { regenerateAssetPrompt } from '../services/town/townPromptBuilder.js';
import { getMapPayload, saveMap } from '../services/town/townMapService.js';
import { getTownWallet, getTownActorActivities, getTownEconomyState, setupTownEconomy, executeTownOrder, maintainTownOrders, executeTownService, getTownService } from '../services/town/townEconomyRuntime.js';
import { getTownAppointments, executeTownAppointment } from '../services/town/townEconomyRuntime.js';
import { getTownDeliveryDiagnostics, retryTownDelivery } from '../services/town/townEconomyRuntime.js';
import { getTownLiquidityStatus } from '../services/town/townEconomyRuntime.js';
import { getTownMailboxTaskCards } from '../services/town/townEconomyRuntime.js';
import {
  getInitState, startInit, updateBlueprint, generateSamples, startBatch,
  generateAssetPrompts,
  generateLayout, rerollLayout, relayoutWorld, confirmInit, cancelInit, getInitPreview, commitWizardNpcs,
  regenerateNpcRoster,
} from '../services/town/townInitService.js';
import {
  listNpcs, getNpc, updateNpc, deleteNpc,
  generateNpcSprites, generateNpcPortrait, generateNpcAssetSet, generateCharacterPortrait,
  regenerateNpcPersonaCard, createNpcWithOnboarding,
  rerollNpc, getNpcChatHistory, chatWithNpc, inviteNpcAsCharacter,
  getPlayerKit, regeneratePlayerKit, regeneratePlayerSprite, regeneratePlayerPortrait,
} from '../services/town/townNpcService.js';

const router = Router();

// ── 运行时 ──

router.get('/state', (req, res) => {
  res.json(getTownState());
});

function checkMovementScope(body, res) {
  if (!Object.hasOwn(body, 'worldId') && !Object.hasOwn(body, 'worldEpoch')) return true;
  if (typeof body.worldId !== 'string' || !body.worldId.trim()
    || !Number.isSafeInteger(body.worldEpoch) || body.worldEpoch < 1) {
    res.status(400).json({ code: 'INVALID_WORLD_SCOPE', error: '小镇范围参数无效' });
    return false;
  }
  const world = getDb().prepare('SELECT world_id, epoch FROM town_world_state WHERE singleton = 1').get();
  if (!world || world.world_id !== body.worldId || world.epoch !== body.worldEpoch) {
    res.status(409).json({ code: 'STALE_WORLD', error: '小镇已变化，请刷新后再移动' });
    return false;
  }
  return true;
}

router.post('/player/move', (req, res) => {
  if (!checkMovementScope(req.body || {}, res)) return;
  const { x, y } = req.body || {};
  const result = movePlayerTo(x, y);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post('/player/dir', (req, res) => {
  if (!checkMovementScope(req.body || {}, res)) return;
  const { dx, dy } = req.body || {};
  const result = movePlayerDir(parseInt(dx, 10) || 0, parseInt(dy, 10) || 0);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.get('/encounters/:id/messages', (req, res) => {
  res.json({ messages: getEncounterMessages(parseInt(req.params.id, 10) || 0) });
});

router.post('/tick', (req, res) => {
  res.json(forceTick());
});

// ── 素材库 ──

router.get('/assets', (req, res) => {
  res.json({ assets: listAssets({ kind: req.query.kind || undefined }) });
});

// 单张素材详情（含 source_prompt，供提示词编辑预填）
router.get('/assets/:id', (req, res) => {
  const asset = getAssetById(parseInt(req.params.id, 10));
  if (!asset) return res.status(404).json({ error: '素材不存在' });
  res.json({ asset });
});

router.post('/assets', async (req, res) => {
  try {
    const { kind, key, name, desc, meta, worldSettingId } = req.body || {};
    if (!kind || !name) return res.status(400).json({ error: 'kind/name 必填' });
    const asset = await createAsset({ kind, key, name, desc, meta, worldSettingId });
    res.json({ asset });
  } catch (err) {
    res.status(500).json({ error: err?.message || '生成失败' });
  }
});

router.post('/assets/:id/regenerate', async (req, res) => {
  try {
    const asset = await regenerateAsset(parseInt(req.params.id, 10), req.body || {});
    res.json({ asset });
  } catch (err) {
    res.status(500).json({ error: err?.message || '重生成失败' });
  }
});

router.patch('/assets/:id/generation', (req, res) => {
  try {
    res.json({ asset: updateAssetGenerationConfig(parseInt(req.params.id, 10), req.body || {}) });
  } catch (err) {
    res.status(err?.message?.includes('not found') ? 404 : 400).json({ error: err?.message || '保存生成配置失败' });
  }
});

router.get('/wallet', (req, res) => {
  try { res.json(getTownWallet()); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

const townCommandMessages = {
  LIQUIDITY_ACTIVATION_RESERVE_REQUIRED: '公共基金至少需要 60 邻币可用准备金，暂不能开启保障',
  LIQUIDITY_RESERVE_REQUIRED: '公共基金准备金不足，暂不能发布新的委托',
  LIQUIDITY_CLOCK_ROLLBACK: '系统时间回拨，基金保障暂时暂停',
  LIQUIDITY_COOLDOWN: '公共基金补助尚在冷却，请稍后再来',
  LIQUIDITY_CAP: '公共基金补助已达到本期或本镇额度上限',
  LIQUIDITY_CIRCULATION_CAP: '小镇流通邻币已达到保障政策上限',
  SCHEDULE_UNAVAILABLE: '这段时间与原日程冲突，请选择其他时间',
  APPOINTMENT_CONFLICT: '这段时间已有预约，请选择其他时间',
  INVALID_APPOINTMENT_TIME: '请选择有效期内的未来时间，并预留完整的三十分钟',
  PROVIDER_NOT_LINKED: '这位居民尚未成为入住角色，暂时不能预约回访',
  CANDIDATE_NOT_FOUND: '回访邀请不存在，请重新读取',
  CANDIDATE_EXPIRED: '这份回访邀请已过期',
  CANDIDATE_CLOSED: '这份回访邀请已处理，请重新读取',
  APPOINTMENT_NOT_FOUND: '预约不存在，请重新读取',
  APPOINTMENT_CLOSED: '这次预约已结束，请重新读取',
  APPOINTMENT_NOT_OWNED: '这次预约不属于当前玩家',
  SERVICE_NOT_OPEN: '这家店目前未营业，请稍后再来',
  SERVICE_LOCKED: '这家店完成一次真实备料后，才能提供这项服务',
  INVALID_SERVICE_KEY: '请选择当前提供的服务',
  INVALID_SERVICE_DEFINITION: '这份服务记录暂时无法确认，请重新读取服务状态',
  SERVICE_ACTOR_BUSY: '居民正在忙于其他事情，请稍后再来',
  SESSION_NOT_OWNED: '这次服务不属于当前玩家，请重新读取',
  SESSION_NOT_FOUND: '服务记录不存在，请重新读取',
  SESSION_STATE_CONFLICT: '服务状态已变化，请重新读取',
  INVALID_SERVICE_INTENT: '当前阶段已变化，请重新选择',
  INVALID_SERVICE_INPUT: '服务输入无效，请检查后重试',
  VENUE_NOT_CONFIGURED: '这家店还没有配置经营者或地点',
  ITEM_TEMPLATES_REQUIRED: '这家店的商品模板尚未就绪，请稍后再来',
  SERVICE_GRANT_INVALID: '商品发放未完成，已改为原路退回',
  SESSION_BUSY: '服务正在处理中，请稍后重新读取',
  SESSION_CLOSED: '这次服务已结束，请查看结算记录',
  OFFER_EXPIRED: '这份报价已过期，请重新查看',
  NOT_ARRIVED: '请走到委托要求的地点，停下后再试',
  INSUFFICIENT_FUNDS: '可用邻币不足，暂时无法完成这项操作',
  INSUFFICIENT_STOCK: '原料暂时不足，请稍后再来',
  ORDER_EXPIRED: '这份委托已到期，请刷新查看',
  VERSION_CONFLICT: '状态已变化，请刷新后重试',
  IDEMPOTENCY_CONFLICT: '这次请求内容已变化，请刷新后重试',
  SOURCE_CONFLICT: '这项操作已有记录，请刷新查看',
  SLICE_NOT_CONFIGURED: '请先选择经营者与地点',
  SLICE_CONFLICT: '当前小镇已配置委托地点，重建后才能重新选择',
  ACTOR_UNAVAILABLE: '居民目前不在镇上，请重新选择',
  LOCATION_UNAVAILABLE: '地点已变化，请刷新后重试',
  INVALID_SLICE: '请选择互不相同的居民和地点',
};
function sendTownCommandError(res, err) {
  const message = townCommandMessages[err.code] || err.message || '操作未完成';
  res.status(err.status || (err.code ? 409 : 500)).json({ error: message, code: err.code });
}

router.get('/economy', (req, res) => {
  try { maintainTownOrders(); res.json(getTownEconomyState()); }
  catch (err) { sendTownCommandError(res, err); }
});
router.get('/liquidity', (req, res) => {
  try { res.json(getTownLiquidityStatus()); }
  catch (err) { sendTownCommandError(res, err); }
});
router.get('/mailbox-tasks', (req, res) => {
  let cursor = null;
  if (req.query.cursor != null) {
    try { cursor = JSON.parse(req.query.cursor); }
    catch { return res.status(400).json({ error: '分页位置无效，请重新读取委托。', code: 'INVALID_PAGE' }); }
  }
  try { res.json(getTownMailboxTaskCards({ cursor, limit: req.query.limit == null ? 10 : Number(req.query.limit) })); }
  catch (err) { sendTownCommandError(res, err); }
});
router.get('/appointments', (req, res) => {
  try { res.json(getTownAppointments()); }
  catch (err) { sendTownCommandError(res, err); }
});
router.get('/deliveries', (req, res) => {
  try {
    const cursor = req.query.cursorSeq == null && req.query.cursorConsumer == null ? null
      : { seq: Number(req.query.cursorSeq), consumerKey: req.query.cursorConsumer };
    res.json(getTownDeliveryDiagnostics({ cursor, limit: req.query.limit == null ? 20 : Number(req.query.limit) }));
  } catch (err) { sendTownCommandError(res, err); }
});
router.post('/deliveries/retry', (req, res) => {
  try { res.json(retryTownDelivery(req.body || {})); }
  catch (err) { sendTownCommandError(res, err); }
});
router.post('/appointments/candidates/:id/accept', (req, res) => {
  try { res.json(executeTownAppointment('accept', req.params.id, req.body || {})); }
  catch (err) { sendTownCommandError(res, err); }
});
router.post('/appointments/:id/cancel', (req, res) => {
  try { res.json(executeTownAppointment('cancel', req.params.id, req.body || {})); }
  catch (err) { sendTownCommandError(res, err); }
});
router.post('/economy/setup', (req, res) => {
  try { res.json(setupTownEconomy(req.body || {})); }
  catch (err) { sendTownCommandError(res, err); }
});
router.get('/orders', (req, res) => {
  try { maintainTownOrders(); res.json({ orders: getTownEconomyState().orders }); }
  catch (err) { sendTownCommandError(res, err); }
});
router.post('/orders/publish', (req, res) => {
  try { res.json(executeTownOrder('publish', null, req.body || {})); }
  catch (err) { sendTownCommandError(res, err); }
});
for (const command of ['accept', 'pickup', 'complete', 'cancel']) {
  router.post(`/orders/:id/${command}`, (req, res) => {
    try { res.json(executeTownOrder(command, req.params.id, req.body || {})); }
    catch (err) { sendTownCommandError(res, err); }
  });
}

router.post('/services/offer', async (req, res) => {
  try { res.json(await executeTownService('offer', null, req.body || {})); }
  catch (err) { sendTownCommandError(res, err); }
});
router.get('/services/:id', (req, res) => {
  try { res.json(getTownService(req.params.id)); }
  catch (err) { sendTownCommandError(res, err); }
});
for (const command of ['accept', 'turn', 'cancel']) {
  router.post(`/services/:id/${command}`, async (req, res) => {
    try { res.json(await executeTownService(command, req.params.id, req.body || {})); }
    catch (err) { sendTownCommandError(res, err); }
  });
}

router.get('/actors/:id/activities', (req, res) => {
  try {
    res.json(getTownActorActivities(req.params.id, {
      cursor: req.query.cursor === undefined ? 0 : Number(req.query.cursor),
      limit: req.query.limit === undefined ? 20 : Number(req.query.limit),
    }));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post('/assets/:id/regenerate-prompt', async (req, res) => {
  try {
    const asset = getAssetById(parseInt(req.params.id, 10));
    if (!asset) return res.status(404).json({ error: '素材不存在' });
    const prompt = await regenerateAssetPrompt({
      currentPrompt: asset.source_prompt,
      requirement: req.body?.requirement,
      kind: asset.kind,
      name: asset.name,
    });
    res.json({ prompt });
  } catch (err) {
    res.status(500).json({ error: err?.message || '提示词改写失败' });
  }
});
router.delete('/assets/:id', (req, res) => {
  res.json(deleteAsset(parseInt(req.params.id, 10)));
});

// 保存前端编辑后的素材图（点击抠白 / 裁底等，dataUrl PNG）
router.post('/assets/:id/image', async (req, res) => {
  try {
    const asset = await saveEditedAssetImage(parseInt(req.params.id, 10), req.body?.dataUrl);
    res.json({ asset });
  } catch (err) {
    res.status(400).json({ error: err?.message || '保存失败' });
  }
});

// 手动上传本地图片替换素材（base64 dataUrl）：走生成同款后处理管线，直接变成可用成品
router.post('/assets/:id/upload', async (req, res) => {
  try {
    const asset = await importAssetImage(parseInt(req.params.id, 10), req.body?.dataUrl);
    res.json({ asset });
  } catch (err) {
    res.status(400).json({ error: err?.message || '上传失败' });
  }
});
// 按截取框裁剪素材并覆盖（放大查看后划定最终成图范围）
router.post('/assets/:id/crop', async (req, res) => {
  try {
    const asset = await cropAssetImage(parseInt(req.params.id, 10), req.body || {});
    res.json({ asset });
  } catch (err) {
    res.status(400).json({ error: err?.message || '裁剪失败' });
  }
});

// 地砖专用：按用户调整的菱形在「裁剪前原图」上重裁（x/y/w，高 = 宽 / 2），覆盖成品贴图
router.post('/assets/:id/crop-tile', async (req, res) => {
  try {
    const asset = await cropTileAssetImage(parseInt(req.params.id, 10), req.body || {});
    res.json({ asset });
  } catch (err) {
    res.status(400).json({ error: err?.message || '地砖裁剪失败' });
  }
});

// 小镇立绘 HiresFix（按全局 HiresFix 设置细化并覆盖原图）
router.post('/assets/:id/hires', async (req, res) => {
  try {
    const asset = await refineAssetWithHires(parseInt(req.params.id, 10));
    res.json({ asset });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'HiresFix 细化失败' });
  }
});

router.post('/assets/batch', async (req, res) => {
  try {
    const { jobs } = req.body || {};
    if (!Array.isArray(jobs) || jobs.length === 0) return res.status(400).json({ error: 'jobs 为空' });
    const results = await generateAssetsBatch(jobs.slice(0, 60));
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err?.message || '批量生成失败' });
  }
});

// ── 地图 ──

router.get('/map', (req, res) => {
  res.json(getMapPayload());
});

router.put('/map', (req, res) => {
  try {
    const { name, cols, rows, tileSize, layers, locations } = req.body || {};
    if (!layers || !Number.isInteger(cols) || !Number.isInteger(rows)) {
      return res.status(400).json({ error: 'layers/cols/rows 必填' });
    }
    const result = saveMap({ name, cols, rows, tileSize, layers, locations });
    reloadTown();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err?.message || '保存失败' });
  }
});

// ── 初始化向导 ──

router.get('/init', (req, res) => {
  res.json(getInitState());
});

router.post('/init/start', async (req, res) => {
  try {
    res.json(await startInit(req.body || {}));
  } catch (err) {
    res.status(500).json({ error: err?.message || '蓝图生成失败' });
  }
});

router.put('/init/blueprint', (req, res) => {
  const result = updateBlueprint(req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(getInitState());
});

// 清单确认后：根据名称/类别生成每项素材 prompt（不直接生图）
router.post('/init/asset-prompts', async (req, res) => {
  try {
    res.json(await generateAssetPrompts(req.body || {}));
  } catch (err) {
    res.status(500).json({ error: err?.message || '素材提示词生成失败' });
  }
});

router.post('/init/samples', async (req, res) => {
  try {
    res.json(await generateSamples());
  } catch (err) {
    res.status(500).json({ error: err?.message || '小样生成失败' });
  }
});

router.post('/init/batch', async (req, res) => {
  try {
    res.json(await startBatch());
  } catch (err) {
    res.status(500).json({ error: err?.message || '批量生成失败' });
  }
});

router.get('/init/preview', (req, res) => {
  res.json(getInitPreview());
});

router.post('/init/layout', async (req, res) => {
  try {
    res.json(await generateLayout());
  } catch (err) {
    res.status(500).json({ error: err?.message || '布图生成失败' });
  }
});

router.post('/init/reroll', async (req, res) => {
  try {
    res.json(await rerollLayout());
  } catch (err) {
    res.status(500).json({ error: err?.message || '重掷失败' });
  }
});

// 向导居民步：按蓝图提前建档居民（稳定人格卡），返回含素材的居民 DTO
router.post('/init/npcs', async (req, res) => {
  try {
    await commitWizardNpcs();
    res.json(getInitState());
  } catch (err) {
    res.status(500).json({ error: err?.message || '居民建档失败' });
  }
});

// 向导居民步：按数量重新生成名单（拉条）
router.post('/init/npc-roster', async (req, res) => {
  try {
    res.json(await regenerateNpcRoster(req.body?.count));
  } catch (err) {
    res.status(500).json({ error: err?.message || '名册生成失败' });
  }
});

router.post('/init/confirm', async (req, res) => {
  try {
    const state = await confirmInit();
    reloadTown();
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err?.message || '开镇失败' });
  }
});

router.delete('/init', (req, res) => {
  res.json(cancelInit());
});

// ── 轻量居民（NPC） ──

router.get('/npcs', (req, res) => {
  res.json({ npcs: listNpcs() });
});

router.get('/npcs/:id', (req, res) => {
  const npc = getNpc(parseInt(req.params.id, 10));
  if (!npc) return res.status(404).json({ error: 'NPC 不存在' });
  res.json({ npc });
});

router.post('/npcs', (req, res) => {
  const { displayName, persona, brief, job, traits } = req.body || {};
  if (!displayName || !String(displayName).trim()) return res.status(400).json({ error: 'displayName 必填' });
  // 一句话人设统一归位到 brief（旧字段名叫 persona），由后台流水线据此生成完整人格卡
  const npcBrief = String(brief ?? persona ?? '').trim().slice(0, 300);
  const mapId = getMapPayload()?.id ?? null;
  // 建档同步返回，人格卡 → 作息 → 全套图片素材在后台自动生成
  const npc = createNpcWithOnboarding({
    mapId,
    displayName: String(displayName).trim(),
    persona: '',
    brief: npcBrief,
    job: String(job || '').trim().slice(0, 20),
    traits: traits && typeof traits === 'object' ? traits : {},
  });
  res.json({ npc });
});

router.put('/npcs/:id', (req, res) => {
  const npc = updateNpc(parseInt(req.params.id, 10), req.body || {});
  if (!npc) return res.status(404).json({ error: 'NPC 不存在' });
  res.json({ npc });
});

router.delete('/npcs/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  deleteNpc(id);
  setNpcEnabled(id, false); // 清理运行时（不存在时无副作用）
  res.json({ ok: true });
});

router.post('/npcs/:id/sprites', async (req, res) => {
  try {
    res.json(await generateNpcSprites(parseInt(req.params.id, 10), { ...(req.body || {}), refreshAppearance: req.body?.refreshAppearance === true }));
  } catch (err) {
    if (err?.code === 'TOWN_ASSET_STALE') return res.status(409).json({ error: err.message || '素材生成已过期，请重试', code: err.code });
    res.status(500).json({ error: err?.message || '精灵生成失败' });
  }
});

router.post('/npcs/:id/portrait', async (req, res) => {
  try {
    res.json(await generateNpcPortrait(parseInt(req.params.id, 10), req.body || {}));
  } catch (err) {
    res.status(500).json({ error: err?.message || '立绘生成失败' });
  }
});

// 一次出齐全套素材（正面 / 背面 / 大立绘）：一次 LLM 返回三条提示词后再分别出图
router.post('/npcs/:id/asset-set', async (req, res) => {
  try {
    res.json(await generateNpcAssetSet(parseInt(req.params.id, 10), { ...(req.body || {}), refreshAppearance: req.body?.refreshAppearance === true }));
  } catch (err) {
    if (err?.code === 'TOWN_ASSET_STALE') return res.status(409).json({ error: err.message || '素材生成已过期，请重试', code: err.code });
    res.status(500).json({ error: err?.message || '素材生成失败' });
  }
});

// 邀请居民入邻舍（NPC → 聊天侧角色）
router.post('/npcs/:id/persona-card', async (req, res) => {
  try {
    res.json({ npc: await regenerateNpcPersonaCard(parseInt(req.params.id, 10), req.body || {}) });
  } catch (err) {
    res.status(500).json({ error: err?.message || '人格卡生成失败' });
  }
});

router.post('/npcs/:id/invite', async (req, res) => {
  try {
    res.json(await inviteNpcAsCharacter(parseInt(req.params.id, 10)));
  } catch (err) {
    res.status(500).json({ error: err?.message || '邀请失败' });
  }
});

// 角色立绘（复用 characters.standing_url，没有才 LLM 生成）
router.post('/characters/:id/portrait', async (req, res) => {
  try {
    res.json(await generateCharacterPortrait(parseInt(req.params.id, 10)));
  } catch (err) {
    res.status(500).json({ error: err?.message || '立绘生成失败' });
  }
});

router.post('/npcs/:id/reroll', async (req, res) => {
  try {
    res.json({ npc: await rerollNpc(parseInt(req.params.id, 10)) });
  } catch (err) {
    res.status(500).json({ error: err?.message || '重掷失败' });
  }
});

router.get('/npcs/:id/messages', (req, res) => {
  res.json({ messages: getNpcChatHistory(parseInt(req.params.id, 10)) });
});

router.post('/npcs/:id/chat', async (req, res) => {
  try {
    const { message, clientMessageId, worldId, worldEpoch } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: '说点什么吧' });
    if (clientMessageId != null && (typeof clientMessageId !== 'string' || !clientMessageId.trim() || clientMessageId.length > 128)) {
      return res.status(400).json({ error: '消息标识无效' });
    }
    res.json(await chatWithNpc(parseInt(req.params.id, 10), message.trim(), { clientMessageId, worldId, worldEpoch }));
  } catch (err) {
    const conflict = ['STALE_WORLD', 'NPC_BUSY', 'DIALOGUE_PAYLOAD_CONFLICT'].includes(err.code);
    res.status(err.status || (conflict ? 409 : 500)).json({ error: err?.message || '对方暂时没有回应', code: err.code, requestId: err.requestId, characterId: err.characterId });
  }
});

// ── 入住角色（管理面板） ──

router.get('/characters', (req, res) => {
  res.json({ characters: listTownCharacters() });
});

router.put('/characters/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  const { townEnabled } = req.body || {};
  res.json(setTownCharacterEnabled(id, {
    townEnabled: townEnabled === undefined ? undefined : !!townEnabled,
  }));
});

router.post('/characters/:id/sprites', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    res.json(await generateCharacterSprites(id, { refreshAppearance: req.body?.refreshAppearance === true }));
  } catch (err) {
    if (err?.code === 'TOWN_ASSET_STALE') return res.status(409).json({ error: err.message || '素材生成已过期，请重试', code: err.code });
    res.status(500).json({ error: err?.message || '精灵生成失败' });
  }
});

// ── 小镇设置 / 世界重置 ──

router.get('/settings', (req, res) => {
  res.json(getTownSettings());
});

router.put('/settings', (req, res) => {
  try { res.json(updateTownSettings(req.body || {})); }
  catch (err) {
    if (String(err.code || '').startsWith('SQLITE_')) {
      return res.status(500).json({ error: '设置未能保存，请稍后重试。当前设置保持不变。', code: 'SETTINGS_SAVE_FAILED' });
    }
    sendTownCommandError(res, err);
  }
});

// 管理面板：复用素材与居民重新生成布局
router.post('/map/relayout', async (req, res) => {
  try {
    const result = await relayoutWorld();
    if (!result?.ok) return res.status(400).json({ error: result?.error || '重新布局失败' });
    reloadTown();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message || '重新布局失败' });
  }
});

router.delete('/world', (req, res) => {
  const r = resetWorld();
  cancelInit(); // 世界重置后向导从头开始（避免残留 done 状态卡住入口）
  res.json(r);
});

// 玩家形象套装（立绘 + 正/背小人）
router.get('/player/kit', (req, res) => {
  res.json(getPlayerKit());
});

router.post('/player/kit', async (req, res) => {
  try {
    res.json(await regeneratePlayerKit());
  } catch (err) {
    res.status(500).json({ error: err?.message || '生成失败' });
  }
});

router.post('/player/portrait', async (req, res) => {
  try {
    res.json(await regeneratePlayerPortrait(req.body || {}));
  } catch (err) {
    res.status(500).json({ error: err?.message || '重绘立绘失败' });
  }
});

router.post('/player/sprites/:direction', async (req, res) => {
  try {
    res.json(await regeneratePlayerSprite(req.params.direction, req.body || {}));
  } catch (err) {
    res.status(500).json({ error: err?.message || '重绘小人失败' });
  }
});

export { router as default };
