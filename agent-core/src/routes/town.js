/**
 * AI 小镇（世界页）API 路由（v2）
 *
 * 运行时   GET  /api/town/state                     — 全量快照（地图版本/居民/玩家/天气/相遇）
 *          POST /api/town/player/move               — 点击寻路 {x, y}
 *          POST /api/town/player/dir                — WASD 单步 {dx, dy}
 *          POST /api/town/actors/:id/hold           — 对话驻留：让居民停走在原地（租约制）
 *          POST /api/town/actors/:id/release        — 解除对话驻留
 *          GET  /api/town/encounters/:id/messages   — 相遇对话记录
 *          POST /api/town/tick                      — 调试：手动触发一拍
 * 素材库   GET/POST /api/town/assets、POST :id/regenerate、POST :id/upload（手动上传图片替换）、DELETE :id、POST /batch
 * 地图     GET  /api/town/map                       — 渲染载荷（layers + assets）
 *          PUT  /api/town/map                       — 编辑器保存（version+1 广播）
 * 向导     GET/POST/PUT/DELETE /api/town/init*      — 七步初始化流程
 * 居民     GET/POST /api/town/npcs、PUT/DELETE :id、:id/sprites、:id/portrait、:id/asset-set（一次出齐全套）、:id/reroll、:id/chat、:id/messages
 * 角色     GET  /api/town/characters                — 素材状态 + 入住状态（管理面板；只含角色自己的小镇素材）
 *          PUT  /api/town/characters/:id            — 入住/退住 {townEnabled}（入住前先补齐素材，齐了才入住）
 *          POST /api/town/characters/:id/portrait   — 立绘（复用关联居民立绘，缺失才生成；酒馆立绘不参与）
 *          POST /api/town/characters/:id/sprites    — 正/背像素小人
 *          POST /api/town/characters/:id/assets     — 一键补齐全套素材
 */
import { Router } from 'express';
import { getDb } from '../db/index.js';
import {
  getTownState, movePlayerTo, movePlayerDir, getEncounterMessages,
  setTownCharacterEnabled, listTownCharacters, forceTick, setNpcEnabled, reloadTown,
  generateCharacterSprites, ensureCharacterTownAssets, getTownSettings, updateTownSettings, resetWorld,
  holdTownActor, releaseTownActor, touchTownViewer,
} from '../services/town/townService.js';
import {
  listAssets, createAsset, regenerateAsset, deleteAsset, generateAssetsBatch, saveEditedAssetImage, importAssetImage, getAssetById, cropAssetImage, cropTileAssetImage, refineAssetWithHires,
  updateAssetGenerationConfig,
} from '../services/town/townAssetService.js';
import { regenerateAssetPrompt } from '../services/town/townPromptBuilder.js';
import { getMapPayload, saveMap } from '../services/town/townMapService.js';
import { getTownWallet, getTownNpcFunctions, receiveTownNpcGift } from '../services/town/townEconomyRuntime.js';
import { getTownInteractions, offerTownInteraction, respondTownInteraction, getTownTargetTrade, executeTownTargetTrade } from '../services/town/townInteractionRuntime.js';
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

// 对话驻留：打开对话框让对方停走（租约制，客户端续租/关闭释放，失联自动过期恢复）
router.post('/actors/:id/hold', (req, res) => {
  if (!checkMovementScope(req.body || {}, res)) return;
  const result = holdTownActor(req.params.id);
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json(result);
});

router.post('/actors/:id/release', (req, res) => {
  if (!checkMovementScope(req.body || {}, res)) return;
  res.json(releaseTownActor(req.params.id));
});

router.get('/encounters/:id/messages', (req, res) => {
  res.json({ messages: getEncounterMessages(parseInt(req.params.id, 10) || 0) });
});

router.post('/tick', (req, res) => {
  res.json(forceTick());
});

// 世界页在线打点：TownView 挂载期间前端定期调用，服务端据此决定是否跑
// 相遇对话 / 环境奇遇 / 状态气泡等「给人看」的 LLM 消耗
router.post('/viewer/heartbeat', (req, res) => {
  touchTownViewer();
  res.json({ ok: true });
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
  STORY_GENERATION_FAILED: '这段奇遇暂时没能展开，稍后再问一次就好。',
  NOT_ARRIVED: '请先走到目标地点，停下后再试',
  INSUFFICIENT_FUNDS: '可用邻币不足，暂时无法完成这项操作',
  INSUFFICIENT_STOCK: '原料暂时不足，请稍后再来',
  VERSION_CONFLICT: '状态已变化，请刷新后重试',
  IDEMPOTENCY_CONFLICT: '这次请求内容已变化，请刷新后重试',
  SOURCE_CONFLICT: '这项操作已有记录，请刷新查看',
  ACTOR_UNAVAILABLE: '居民目前不在镇上，请重新选择',
  LOCATION_UNAVAILABLE: '地点已变化，请刷新后重试',
  NPC_NOT_FOUND: '这位居民不存在，请重新读取',
  NOT_A_GIFT_GIVER: '这位邻居没有随身带礼物的习惯',
  GIFT_COOLDOWN: '这位邻居今天已经送过东西了，改天再来',
  NOT_A_TRADER: '这位邻居不做买卖',
  INVALID_TRADE_ITEM: '这里不做这件物品的生意',
  ITEM_NOT_FOUND: '背包里找不到这件物品，请重新读取',
  ITEM_NOT_TRADABLE: '这件物品不能交易',
  ITEM_LOCKED: '这件物品正被占用，稍后再试',
  ACCOUNT_OWNER_MISMATCH: '交易账户校验未通过，请重新读取后再试',
  TEMPLATE_NOT_FOUND: '这件商品的模板还没准备好，请稍后再来',
};
function sendTownCommandError(res, err) {
  const message = townCommandMessages[err.code] || err.message || '操作未完成';
  res.status(err.status || (err.code ? 409 : 500)).json({ error: message, code: err.code });
}

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
    res.status(500).json({ error: err?.message || 'spirit生成失败' });
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

// 角色立绘（复用关联居民的小镇立绘；没有才 LLM 生成。酒馆 standing_url 不参与）
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

// ── NPC 功能点（送东西 / 做买卖） ──

for (const [path, prefix] of [['npcs', 'npc'], ['characters', 'char'], ['locations', 'location']]) {
  const target = req => `${prefix}:${prefix === 'location' ? req.params.id : Number(req.params.id)}`;
  router.get(`/${path}/:id/interactions`, (req, res) => {
    try { res.json(getTownInteractions(target(req))); } catch (error) { sendTownCommandError(res, error); }
  });
  router.post(`/${path}/:id/interactions`, (req, res) => {
    try { res.json(offerTownInteraction(target(req), req.body?.key, req.body || {})); }
    catch (error) { sendTownCommandError(res, error); }
  });
  router.post(`/${path}/:id/interactions/:requestId`, async (req, res) => {
    try { res.json(await respondTownInteraction(target(req), req.params.requestId, req.body?.decision, req.body || {})); }
    catch (error) { sendTownCommandError(res, error); }
  });
  router.get(`/${path}/:id/trade`, (req, res) => {
    try { res.json(getTownTargetTrade(target(req))); } catch (error) { sendTownCommandError(res, error); }
  });
  router.post(`/${path}/:id/trade`, (req, res) => {
    try { res.json(executeTownTargetTrade(target(req), req.body || {})); } catch (error) { sendTownCommandError(res, error); }
  });
}

router.get('/npcs/:id/functions', (req, res) => {
  try { res.json(getTownNpcFunctions(parseInt(req.params.id, 10))); }
  catch (err) { sendTownCommandError(res, err); }
});
router.post('/npcs/:id/gift', (req, res) => {
  try { res.json(receiveTownNpcGift(parseInt(req.params.id, 10), req.body || {})); }
  catch (err) { sendTownCommandError(res, err); }
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

router.put('/characters/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const { townEnabled } = req.body || {};
    if (townEnabled === undefined) return res.json(setTownCharacterEnabled(id));
    if (!townEnabled) return res.json(setTownCharacterEnabled(id, { townEnabled: false }));

    // 入住前置：先把立绘 + 正/背小人补齐（优先复用关联居民的素材，缺失才生成），三张齐了才允许入住
    const ensure = await ensureCharacterTownAssets(id);
    if (!ensure.ready) {
      const result = setTownCharacterEnabled(id, { townEnabled: false });
      return res.json({ ...result, ok: false, townEnabled: false, ready: false, steps: ensure.steps,
        error: '素材还没补齐，暂时不能入住。稍后重试，或去「角色素材」列表点「一键生成所有缺失素材」。' });
    }
    res.json({ ...setTownCharacterEnabled(id, { townEnabled: true }), ready: true, steps: ensure.steps });
  } catch (err) {
    if (err?.code === 'TOWN_ASSET_STALE') return res.status(409).json({ error: err.message || '素材生成已过期，请重试', code: err.code });
    res.status(500).json({ error: err?.message || '入住失败' });
  }
});

// 一键补齐角色的全套素材（立绘 + 正/背小人；已有 ready 素材的环节自动跳过）
router.post('/characters/:id/assets', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    res.json(await ensureCharacterTownAssets(id));
  } catch (err) {
    if (err?.code === 'TOWN_ASSET_STALE') return res.status(409).json({ error: err.message || '素材生成已过期，请重试', code: err.code });
    res.status(500).json({ error: err?.message || '素材补齐失败' });
  }
});

router.post('/characters/:id/sprites', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    res.json(await generateCharacterSprites(id, { refreshAppearance: req.body?.refreshAppearance === true }));
  } catch (err) {
    if (err?.code === 'TOWN_ASSET_STALE') return res.status(409).json({ error: err.message || '素材生成已过期，请重试', code: err.code });
    res.status(500).json({ error: err?.message || 'spirit生成失败' });
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
