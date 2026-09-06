/**
 * AI 小镇（世界页）API 路由（v2）
 *
 * 运行时   GET  /api/town/state                     — 全量快照（地图版本/居民/玩家/天气/相遇）
 *          POST /api/town/player/move               — 点击寻路 {x, y}
 *          POST /api/town/player/dir                — WASD 单步 {dx, dy}
 *          GET  /api/town/encounters/:id/messages   — 相遇对话记录
 *          POST /api/town/tick                      — 调试：手动触发一拍
 * 素材库   GET/POST /api/town/assets、POST :id/regenerate、DELETE :id、POST /batch
 * 地图     GET  /api/town/map                       — 渲染载荷（layers + assets）
 *          PUT  /api/town/map                       — 编辑器保存（version+1 广播）
 * 向导     GET/POST/PUT/DELETE /api/town/init*      — 七步初始化流程
 * 居民     GET/POST /api/town/npcs、PUT/DELETE :id、:id/sprites、:id/reroll、:id/chat、:id/messages
 * 角色     GET  /api/town/characters                — 素材状态 + 入住状态（管理面板）
 *          PUT  /api/town/characters/:id            — 入住/退住 {townEnabled}
 */
import { Router } from 'express';
import {
  getTownState, movePlayerTo, movePlayerDir, getEncounterMessages,
  setTownCharacterEnabled, listTownCharacters, forceTick, setNpcEnabled, reloadTown,
  generateCharacterSprites, getTownSettings, updateTownSettings, resetWorld,
} from '../services/town/townService.js';
import {
  listAssets, createAsset, regenerateAsset, deleteAsset, generateAssetsBatch, saveEditedAssetImage,
} from '../services/town/townAssetService.js';
import { getMapPayload, saveMap } from '../services/town/townMapService.js';
import {
  getInitState, startInit, updateBlueprint, generateSamples, startBatch,
  generateLayout, rerollLayout, confirmInit, cancelInit, getInitPreview, commitWizardNpcs,
  regenerateNpcRoster,
} from '../services/town/townInitService.js';
import {
  listNpcs, getNpc, createNpc, updateNpc, deleteNpc,
  generateNpcSprites, generateNpcPortrait, generateCharacterPortrait,
  rerollNpc, getNpcChatHistory, chatWithNpc, inviteNpcAsCharacter,
  getPlayerKit, regeneratePlayerKit,
} from '../services/town/townNpcService.js';

const router = Router();

// ── 运行时 ──

router.get('/state', (req, res) => {
  res.json(getTownState());
});

router.post('/player/move', (req, res) => {
  const { x, y } = req.body || {};
  const result = movePlayerTo(x, y);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post('/player/dir', (req, res) => {
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
    const { name, cols, rows, tileSize, layers } = req.body || {};
    if (!layers || !Number.isInteger(cols) || !Number.isInteger(rows)) {
      return res.status(400).json({ error: 'layers/cols/rows 必填' });
    }
    const result = saveMap({ name, cols, rows, tileSize, layers });
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
  const { displayName, persona, appearanceDesc, job, traits } = req.body || {};
  if (!displayName) return res.status(400).json({ error: 'displayName 必填' });
  const mapId = getMapPayload()?.id ?? null;
  const npc = createNpc({ mapId, displayName, persona, appearanceDesc, job, traits });
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
    res.json(await generateNpcSprites(parseInt(req.params.id, 10)));
  } catch (err) {
    res.status(500).json({ error: err?.message || '精灵生成失败' });
  }
});

router.post('/npcs/:id/portrait', async (req, res) => {
  try {
    res.json(await generateNpcPortrait(parseInt(req.params.id, 10)));
  } catch (err) {
    res.status(500).json({ error: err?.message || '立绘生成失败' });
  }
});

// 邀请居民入邻舍（NPC → 聊天侧角色）
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
    const { message } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ error: '说点什么吧' });
    res.json(await chatWithNpc(parseInt(req.params.id, 10), String(message).trim()));
  } catch (err) {
    res.status(500).json({ error: err?.message || '对方暂时没有回应' });
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
    res.json(await generateCharacterSprites(id));
  } catch (err) {
    res.status(500).json({ error: err?.message || '精灵生成失败' });
  }
});

// ── 小镇设置 / 世界重置 ──

router.get('/settings', (req, res) => {
  res.json(getTownSettings());
});

router.put('/settings', (req, res) => {
  res.json(updateTownSettings(req.body || {}));
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

export { router as default };
