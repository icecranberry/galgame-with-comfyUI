/**
 * AI 小镇核心服务（v2：瓦片地图 + 轻量 NPC + 角色 opt-in）
 *
 * 分层（详见 ai-town-plan.md v2）：
 *   L0 确定性模拟：NPC 作息 FSM / 入住角色日程投影 → A* 寻路 → 服务端权威推进（无 LLM）
 *   L1 规则触发：  相遇判定、玩家靠近问候（本地模板）、天气/时段修正（无 LLM）
 *   L2 LLM 事件：  相遇对话、批量状态短语（独立串行队列，永不挤占聊天）
 *                  由 config.features.townAutoLLM 统一控制：关闭时这两个 tick 驱动的自动
 *                  生成不再调用模型（相遇仍照常发生，只是静默）；玩家主动发起的 NPC 交谈
 *                  与互动奇遇不受影响，仍由 config.features.townLLM 决定。
 *   L3 记忆回写：  相遇摘要入账为 town.encounter.happened 事件 → townExperienceService 沉淀双方
 *                  经历与角色记忆；NPC 对话历史由 townNpcService 落库
 *
 * 状态原则：服务端权威 + 内存为准；坐标只在换目标/换活动时落库，
 * 进程重启后由「作息/日程 + 当前时刻」重建（town_agent_state 仅是恢复快照）。
 * 居民身份：agentKey = 'npc:{id}'（轻量居民）| 'char:{id}'（入住角色）；玩家恒为 'me'。
 */
import { playerRouteStart, applyPlayerRoute } from './playerMovement.js';
import { advanceAgentPosition } from './agentMovement.js';
import { createTownActorRegistry } from './townActorRegistry.js';
import { reconcileTownResponsibilities } from './townResponsibilityRuntime.js';
import { townCapabilities, defaultTownCapabilities, parseCharacterCapabilities, readCharacterCapabilities, setCharacterCapabilities } from './townCapabilities.js';
import { createTownActionRunner } from './townActionRunner.js';
import { findRoutineSlot } from './routineSchedule.js';
import { createTownClock } from './townClock.js';
import { createTownSimulation } from './townSimulation.js';
import { createEconomyService } from './economyService.js';
import { maintainTownLife, getTownLifeRuntime } from './townEconomyRuntime.js';
import { createTownEventService } from './townEventService.js';
import { TOWN_EXPERIENCE_CONSUMER } from './townExperienceService.js';
import { generateTownNpcEvent, TOWN_NPC_AMBIENT_EVENT_TYPE_KEY } from './townNpcEventGenerator.js';
import { getDb } from '../../db/index.js';
import { config } from '../../config.js';
import { chatSync } from '../../llm/llm-client.js';
import { getCurrentActivity, isSleeping } from '../scheduleManager.js';
import { getTimeLight, getSeason } from '../timeLight.js';
import { createTownWeatherFacts } from './townWeatherFacts.js';
import { getWeatherSourceKey } from '../weatherSource.js';
import { createTownWeatherShelter, isIdleScheduleActivity } from './townWeatherShelter.js';
import { getMapRow, listMaps, buildWalkGridFromLayers } from './townMapService.js';
import { getTownGenerationSettings, mergeTownGenerationSettings } from './townGenerationConfig.js';
import { buildLocationMatcher } from './townLocationMatch.js';
import { findPath, isWalkable, pickStandingCell } from './townPathfinding.js';
import { listAssets, createAsset, regenerateAsset, getAssetsByKey, deleteAsset, captureTownAssetWorld, registerAssetFromUrl, SPRITE_DIRECTIONS } from './townAssetService.js';
import { generateSpritePrompt } from './townPromptBuilder.js';
import { buildCharacterAppearanceSection, buildCharacterPersona } from '../characterPersona.js';
import { createTownAppearanceSignature, townAssetAppearanceStatus } from './townAppearanceSignature.js';
import {
  broadcastTownMove, broadcastTownBubble,
  broadcastTownEncounterStart, broadcastTownEncounterEnd, broadcastTownPing,
  broadcastTownStateUpdated, broadcastTownPlayerMapChanged,
  setTownBusScope, setTownBusMapScope, onTownAssetsUpdated,
} from './townBus.js';

/**
 * 世界级共享状态：与具体地图无关，多图并存时也只有一份。
 * - 玩家整局只有一个身份，`playerMapId` 是聚焦口径的权威来源
 * - `llmChain` 全局串行：多张图不会同时打模型
 */
const shared = {
  world: null,
  actors: new Map(),   // agentKey -> actor（身份注册表视图，全世界一份）
  running: false,
  timer: null,
  startupTimer: null,
  playerMapId: null,
  player: null,        // { agentKey:'me', displayName, x, y, path, speed, moveStartedAt, sprites }
  playerRevision: 0,   // 场景修订号：出行等关键场景变更时递增，客户端据此丢弃迟到结果
  llmChain: Promise.resolve(),  // L2 串行队列：同一时刻最多一个 LLM 调用在跑
};

/** mapId -> 该地图的运行实例；字段与原单图状态同构 */
const runtimes = new Map();

function createRuntimeState({ mapId = null, map = null, locations = [], matcher = null } = {}) {
  return {
    mapId,
    generation: 0,       // 内存装载代次；异步表达不能回写已卸载的场景
    world: shared.world,
    map,                 // { id, name, cols, rows, tileSize, version, layers, walkGrid, assetsById }
    locations,           // [{ id, key, name, aliases, kind, x, y, radius, ambient }]
    matcher,
    agents: new Map(),   // agentKey -> agent
    meta: new Map(),     // agentKey -> { agentKey, kind, refId, displayName, personaPrompt, avatarPath, sprites }
    relationships: new Set(),   // 'min:max'（有 relationship_text 的角色无向对）
    moods: new Map(),    // charId -> { valence, arousal, dominantEmotion, updatedAt }
    encounters: new Map(), // id -> encounter
    pairCooldown: new Map(),   // 'aKey|bKey' -> 可再次相遇/问候的时间戳
    occupied: new Map(),   // 'x,y' -> agentKey
    player: null,        // 只有玩家所在地图指向 shared.player
    simulation: null,
    simulationActorIds: new Set(),
    lastBubbleBatchAt: 0,
    lastMoodRefreshAt: 0,
    lastEncounterStartAt: 0,
  };
}

/** 未开镇时使用的空实例，保证所有 state.* 读取与旧行为一致 */
const EMPTY_RUNTIME = createRuntimeState();

/**
 * 当前正在处理的运行实例：默认指向聚焦图。
 * 既有逻辑全部通过 `state.` 读写「这一张图」，tick 遍历其他图时用 withRuntime 临时切换。
 */
let state = EMPTY_RUNTIME;

function withRuntime(rt, fn) {
  const previous = state;
  state = rt || EMPTY_RUNTIME;
  setTownBusMapScope(state.mapId);
  try {
    return fn();
  } finally {
    state = previous;
    setTownBusMapScope(previous?.mapId ?? null);
  }
}

/** 玩家所在地图的运行实例（多图里唯一允许产生 LLM 演出的那一张） */
function focusedRuntime() {
  return shared.playerMapId == null ? null : runtimes.get(shared.playerMapId) || null;
}

function firstRuntime() {
  for (const rt of runtimes.values()) return rt;
  return null;
}

/** 把 state 复位到聚焦图：所有导出的玩家/管理接口默认作用于玩家所在地图 */
function syncFocusRuntime() {
  state = focusedRuntime() || firstRuntime() || EMPTY_RUNTIME;
  setTownBusMapScope(state.mapId);
}

/** 玩家坐标对象只挂在所在地图的运行实例上，切图时同步引用 */
function syncPlayerRefs() {
  for (const rt of runtimes.values()) rt.player = rt.mapId === shared.playerMapId ? shared.player : null;
}

// ── 身份编码（town_encounters.char_a/char_b 存整数：NPC 取负，角色取正） ──

function encodeAgentId(agentKey) {
  const [kind, id] = String(agentKey).split(':');
  const n = parseInt(id, 10);
  return kind === 'npc' ? -n : n;
}

function decodeAgentId(n) {
  return n < 0 ? `npc:${-n}` : `char:${n}`;
}

// ── 工具 ──

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function stripJsonFence(content) {
  if (!content) return '';
  return String(content)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

function safeJsonParse(content) {
  try {
    return JSON.parse(stripJsonFence(content));
  } catch {
    return null;
  }
}

function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function toEpochSeconds(sqliteDT) {
  if (!sqliteDT) return 0;
  const t = Date.parse(sqliteDT.includes('T') ? sqliteDT : sqliteDT.replace(' ', 'T') + 'Z');
  return Number.isNaN(t) ? 0 : t;
}

function safeParseArray(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function safeParseObject(json) {
  try {
    const obj = JSON.parse(json || '{}');
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  } catch { return {}; }
}

let weatherWarningAt = null;
let localTimeClock = null;
let localTimeZone = null;
function townLocalTime(now) {
  const timeZone = config.town.timeZone || 'Asia/Shanghai';
  if (!localTimeClock || localTimeZone !== timeZone) {
    localTimeClock = createTownClock({ timeZone });
    localTimeZone = timeZone;
  }
  return localTimeClock.at(now);
}
function readTownWeather(now = Date.now()) {
  const local = townLocalTime(now);
  const hour = Math.floor(local.minuteOfDay / 60);
  // Reuse the pure display vocabulary with town wall-clock fields, not a shifted instant.
  const { timeDesc } = getTimeLight({ getHours: () => hour, getMinutes: () => local.minuteOfDay % 60 });
  const db = getDb();
  let facts;
  try {
    facts = createTownWeatherFacts({ db, clock: { now: () => now },
      enabled: config.features.weather === true,
      expectedSourceKey: getWeatherSourceKey(config.weather.city) }).readCurrent();
  } catch (err) {
    // Optional forecast failure must not abort the town snapshot or simulation tick.
    // Keep schema diagnostics server-side, at most once per minute (also handle clock rollback).
    if (weatherWarningAt === null || now < weatherWarningAt || now - weatherWarningAt >= 60000) {
      weatherWarningAt = now;
      console.warn('[town] weather read failed; forecast unavailable:', err);
    }
    facts = { source: 'forecast', status: 'unknown', precipitation: null, text: '', temperature: null,
      forecastAt: null, fetchedAt: null, validUntil: null, reason: 'READ_FAILED' };
  }
  return { timeDesc, hour, season: getSeason(Number(local.date.slice(5, 7))), ...facts };
}

function isRaining() {
  const weather = readTownWeather();
  return weather.status === 'known' && weather.precipitation === 'rain';
}

// ── 世界页在线状态 ──
// 前端 TownView 挂载期间定期打点（POST /town/viewer/heartbeat）；超过 TTL 没有心跳
// 即视为无人观看。相遇对话、环境奇遇升级、批量状态气泡都属于「给人看」的 LLM 消耗，
// 无人观看时 tick 跳过它们，页面回来自动恢复。
const VIEWER_TTL_MS = 45_000;
let lastViewerSeenAt = 0;

export function touchTownViewer() {
  lastViewerSeenAt = Date.now();
}

export function hasTownViewers() {
  return Date.now() - lastViewerSeenAt < VIEWER_TTL_MS;
}

/**
 * 聚焦闸门：玩家在这张图上，而且小镇页面在线（viewer 心跳未过期）。
 * 只有聚焦图才产生 LLM 演出（相遇对话/摘要、状态气泡、环境奇遇、镇民朋友圈）；
 * 后台图照常走位、上下班、结算与维护，只是不花模型钱。
 */
export function isMapFocused(mapId) {
  return shared.running && mapId != null && shared.playerMapId === mapId && hasTownViewers();
}

// ── 启动 / 状态装载 ──

export function startTownScheduler() {
  if (!config.features.town) {
    console.log('[town] feature disabled, scheduler skipped');
    return;
  }
  if (shared.running) return;
  shared.running = true;
  loadState();

  // 首拍延后几秒：等 app.js 里日程管理器完成初始化
  shared.startupTimer = setTimeout(() => {
    shared.startupTimer = null;
    if (shared.running) tick();
  }, 5000);
  shared.timer = setInterval(tick, config.town.tickSeconds * 1000);
  shared.simTimer = setInterval(simSubTick, TOWN_SIM_SUBTICK_MS);
  console.log(`[town] scheduler started (tick=${config.town.tickSeconds}s, simSubtick=${TOWN_SIM_SUBTICK_MS / 1000}s, maps=${runtimes.size}${shared.playerMapId ? '' : ', 等待世界初始化'})`);
}

export function stopTownScheduler() {
  shared.running = false;
  if (shared.timer) { clearInterval(shared.timer); shared.timer = null; }
  if (shared.simTimer) { clearInterval(shared.simTimer); shared.simTimer = null; }
  if (shared.startupTimer) { clearTimeout(shared.startupTimer); shared.startupTimer = null; }
  persistAllRuntimes();
}

/** 地图保存/开镇后重载世界（不重启 tick 定时器） */
export function reloadTown() {
  if (!shared.running) return;
  try {
    persistAllRuntimes();
    loadState();
    console.log(`[town] world reloaded (maps=${runtimes.size})`);
  } catch (err) {
    console.error('[town] reload failed:', err?.message || err);
  }
}

function loadState() {
  const db = getDb();
  shared.world = createTownActorRegistry(db).getWorldState();
  setTownBusScope(shared.world);

  // 旧实例先落盘再作废其异步回调（generation 递增让在途 LLM 结果不再回写）
  persistAllRuntimes();
  runtimes.clear();

  const assets = listAssets({});
  const assetsById = new Map(assets.map(a => [a.id, a]));
  for (const meta of listMaps()) {
    if (meta.status === 'archived') continue;
    const mapRow = getMapRow(meta.id);
    if (!mapRow) continue;
    // 每张图各自补岗/补地址，两镇的店铺与岗位互不串
    reconcileTownResponsibilities({ db, allowFallback: true, mapId: mapRow.id });
    const rt = buildRuntimeState(mapRow, assetsById);
    runtimes.set(rt.mapId, rt);
    withRuntime(rt, () => hydrateRuntime(assets));
  }

  // 玩家：显式记录的地图 → 默认图（首图）→ 尚未开镇
  db.prepare(`INSERT INTO town_players (id, display_name) VALUES ('me', ?) ON CONFLICT(id) DO NOTHING`)
    .run(config.user.nickname || '我');
  const pRow = db.prepare(`SELECT * FROM town_players WHERE id = 'me'`).get() || {};
  shared.playerMapId = (pRow.map_id != null && runtimes.has(pRow.map_id)) ? pRow.map_id : (firstRuntime()?.mapId ?? null);
  if (shared.playerMapId != null && pRow.map_id !== shared.playerMapId) {
    db.prepare('UPDATE town_players SET map_id = ? WHERE id = ?').run(shared.playerMapId, 'me');
  }
  loadPlayer(pRow);
  syncPlayerRefs();
  syncFocusRuntime();
  closeStaleEncounters();
}

/** 由地图行构造运行实例（walkGrid 按图层现算） */
function buildRuntimeState(mapRow, assetsById) {
  const walkGrid = buildWalkGridFromLayers(mapRow.grid_cols, mapRow.grid_rows, mapRow.layers, assetsById);
  const rt = createRuntimeState({
    mapId: mapRow.id,
    map: {
      id: mapRow.id, name: mapRow.name,
      cols: mapRow.grid_cols, rows: mapRow.grid_rows,
      tileSize: mapRow.tile_size || 32, version: mapRow.version || 1,
      layers: mapRow.layers, walkGrid, assetsById,
    },
  });
  syncRuntimeWorld(rt);
  return rt;
}

/** 世界身份是全世界一份：实例登记与重建时同步引用 */
function syncRuntimeWorld(rt) {
  rt.world = shared.world;
}

/** 装载某张图的场景内容：地点、成员、关系、冷却、心情与模拟引擎 */
function hydrateRuntime(assets = listAssets({})) {
  const db = getDb();
  const rt = state;
  rt.locations = rt.map
    ? db.prepare('SELECT * FROM town_locations WHERE map_id = ? ORDER BY id').all(rt.map.id)
      .map(row => ({
        id: row.id, key: row.key, name: row.name,
        businessKind: row.business_kind || 'none', capabilities: townCapabilities(row, defaultTownCapabilities(row.business_kind)),
        aliases: safeParseArray(row.aliases_json),
        kind: row.kind, x: row.grid_x, y: row.grid_y,
        radius: row.radius, ambient: row.ambient || '',
      }))
    : [];
  rt.matcher = buildLocationMatcher(rt.locations);
  rt.spriteAssets = assets;

  // actor registry 决定唯一实体；邀请后沿用原 NPC 的身份与位置（按所在图过滤）
  synchronizeMembership();

  // 关系（角色无向对，相遇概率修正用）
  rt.relationships.clear();
  for (const row of db.prepare(`
    SELECT from_character_id, to_character_id FROM character_relationships
    WHERE relationship_text IS NOT NULL AND TRIM(relationship_text) != ''
  `).all()) {
    rt.relationships.add(pairKey(`char:${row.from_character_id}`, `char:${row.to_character_id}`));
  }

  // 冷却：最近一段时间的 done 相遇重建（进程重启不重置冷却，按图各自计算）
  rt.pairCooldown.clear();
  const cooldownCutoff = Date.now() - config.town.encounterCooldownHours * 3600_000;
  for (const row of db.prepare(`
    SELECT char_a, char_b, ended_at, created_at FROM town_encounters
    WHERE map_id = ? AND status IN ('done','cancelled') AND COALESCE(ended_at, created_at) >= ?
  `).all(rt.mapId, new Date(cooldownCutoff).toISOString().slice(0, 19).replace('T', ' '))) {
    const endTs = toEpochSeconds(row.ended_at || row.created_at);
    rt.pairCooldown.set(pairKey(decodeAgentId(row.char_a), decodeAgentId(row.char_b)), endTs + config.town.encounterCooldownHours * 3600_000);
  }

  refreshMoods();
  initializeSimulation();
}

/** 玩家坐标：优先本图上次落点，其次 town_players 记录，最后地图中心的可走格 */
function loadPlayer(pRow) {
  const db = getDb();
  const rt = focusedRuntime();
  const saved = shared.playerMapId != null
    ? db.prepare('SELECT * FROM town_agent_state WHERE agent_key = ? AND map_id = ?').get('me', shared.playerMapId)
    : null;
  const center = rt?.map
    ? { x: Math.floor(rt.map.cols / 2), y: Math.floor(rt.map.rows / 2) }
    : { x: 0, y: 0 };
  const player = {
    agentKey: 'me',
    displayName: pRow?.display_name || config.user.nickname || '我',
    x: center.x,
    y: center.y,
    path: null, speed: config.town.playerSpeed, moveStartedAt: 0,
    moveRevision: shared.playerRevision,
    sprites: spriteUrlsByKey('player_', listAssets({})),
  };
  const savedRow = (saved && Number.isInteger(saved.grid_x) && Number.isInteger(saved.grid_y))
    ? saved
    : (pRow?.map_id === shared.playerMapId && Number.isInteger(pRow?.grid_x) && Number.isInteger(pRow?.grid_y) ? pRow : null);
  if (rt?.map && savedRow && isWalkable(rt.map.walkGrid, savedRow.grid_x, savedRow.grid_y)) {
    player.x = savedRow.grid_x;
    player.y = savedRow.grid_y;
  } else if (rt?.map && !isWalkable(rt.map.walkGrid, center.x, center.y)) {
    // 中心被占（建筑/阻挡）→ 找一个可走格落位
    const cell = pickStandingCell(rt.map.walkGrid, rt.occupied, center, Math.max(rt.map.cols, rt.map.rows));
    if (cell) { player.x = cell.x; player.y = cell.y; }
  }
  shared.player = player;
}

/** 重启后 chatting 状态的相遇无法恢复上下文：统一收尾（不调 LLM） */
function closeStaleEncounters() {
  const db = getDb();
  const activeEncs = db.prepare(`SELECT * FROM town_encounters WHERE status = 'chatting'`).all();
  if (activeEncs.length === 0) return;
  const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const upd = db.prepare(`UPDATE town_encounters SET status = 'done', ended_at = ?, summary = COALESCE(NULLIF(summary,''), '（对话被打断）') WHERE id = ?`);
  for (const enc of activeEncs) upd.run(nowIso, enc.id);
  console.log(`[town] closed ${activeEncs.length} stale encounter(s) on boot`);
}

/** 每张图各自落盘后作废异步回调（停止调度 / 世界重载） */
function persistAllRuntimes() {
  for (const rt of runtimes.values()) {
    withRuntime(rt, () => {
      invalidateSceneCallbacks();
      persistAllAgents();
      if (rt.player) persistPlayer();
    });
  }
}

function initializeSimulation() {
  const db = getDb();
  // Include persisted owners so an appointment that ended while offline cannot
  // leave an excluded actor's old movement/station lease behind after reload.
  const hasSimulationState = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='town_simulation_state'").get();
  state.simulationActorIds = new Set(hasSimulationState && state.world
    ? db.prepare('SELECT actor_id FROM town_simulation_state WHERE world_id=? AND world_epoch=?')
      .all(state.world.worldId,state.world.epoch).map(row => row.actor_id) : []);
  state.simulation = createTownSimulation({ db,
    registry: createTownActorRegistry(db),
    clock: createTownClock({ timeZone: config.town.timeZone || 'Asia/Shanghai' }),
    leaseMs: Math.max(180000, config.town.tickSeconds * 3000),
    readActorFacts: readSimulationFacts,
    moveToTarget: ({ actor, action, target, nowUtcMs }) => {
      const agent = state.agents.get(actor?.agentKey);
      const loc = state.locations.find(l => l.key === target);
      if (!agent || !loc || action.worldEpoch !== state.world?.epoch) return { status: 'unreachable' };
      if (agent.simulationMoveId === action.id && (agent.path || agent.targetLocId === loc.id)) return { status: 'moving' };
      const success = assignTarget(agent, loc, nowUtcMs, { strictRadius: true });
      if (success) agent.simulationMoveId = action.id;
      return { status: success ? 'moving' : 'unreachable' };
    },
    stopMoving: ({ actor, action }) => {
      const agent = state.agents.get(actor?.agentKey);
      if (!agent || !action || action.worldEpoch !== state.world?.epoch || agent.simulationMoveId !== action.id) return;
      stopAgentMovement(agent);
    },
  });
}

function reconcileSimulationScope() {
  const selected = new Set();
  for (const agent of state.agents.values()) if (agent.actorId) selected.add(agent.actorId);
  for (const actorId of state.simulationActorIds) {
    if (!selected.has(actorId)) state.simulation?.cancelActor(actorId,'SIMULATION_SCOPE_ENDED');
  }
  state.simulationActorIds = selected;
  return selected;
}

function tickTownSimulation() {
  reconcileSimulationScope();
  state.simulation?.tick();
}

function readSimulationFacts(actor, { worldEpoch, nowUtcMs, action }) {
  const agent = state.agents.get(actor.agentKey);
  let intent = 'wait', loc = null, target = null, scheduleKey = 'idle', sleeping = false, hasOriginalTask = false;
  if (agent) {
    advanceAgent(agent, nowUtcMs);
    if (agent.kind === 'npc') {
      const slot = getRoutineSlot(agent, nowUtcMs);
      hasOriginalTask = !!slot;
      const home = getDb().prepare('SELECT home_location_id FROM town_npcs WHERE id = ?').get(agent.refId)?.home_location_id;
      loc = slot?.locationKey === 'home' ? state.locations.find(l => l.id === home) : locationFromKey(slot?.locationKey);
      target = loc?.key || (slot?.locationKey !== 'home' ? slot?.locationKey : null) || null;
      scheduleKey = slot ? JSON.stringify([slot.start, slot.end, slot.locationKey, slot.actionType || null]) : 'idle';
      // 职业地点/动作标签是结构化配置；不从 activityText 猜测已工作。
      intent = slot?.actionType === 'work_shift' || (target && agent.traits?.workLocationKey === target) ? 'work'
        : slot?.actionType === 'rest' || slot?.sleeping === true ? 'rest' : 'wait';
      sleeping = intent === 'rest';
      agent.activityText = slot?.activity || '在镇上休息';
      if (intent !== 'rest') {
        // 除睡觉外都在镇上走动：作息段只保留活动文案与睡觉判定，不再钉住地点；
        // 营业时段的岗位居民随后会被岗位适配器覆盖成 work，照旧钉在店里（经营依赖人在岗）。
        const localMinute = townLocalTime(nowUtcMs).minuteOfDay;
        if (!slot && !agent.traits?.nightOwl && (localMinute >= 23 * 60 || localMinute < 6 * 60)) {
          // 深夜无作息的居民回家睡觉（有作息的居民夜里由睡觉段接管）
          const homeLoc = state.locations.find(l => l.id === home);
          if (homeLoc) { loc = homeLoc; target = homeLoc.key; intent = 'rest'; sleeping = true; agent.activityText = '睡得正香'; }
        } else {
          const stroll = pickStrollLocation(agent, nowUtcMs);
          if (stroll) { loc = stroll; target = stroll.key; intent = 'wait'; if (!slot) agent.activityText = '在镇上闲逛'; }
        }
      }
    } else {
      const date = new Date(nowUtcMs);
      const sleep = isSleeping(agent.refId, date);
      const activity = getCurrentActivity(agent.refId, date);
      sleeping = !!sleep.sleeping || activity?.replyDelay === -1;
      loc = sleeping ? getHomeLocation(agent.refId) : state.matcher(activity?.location);
      const scheduled = !!activity?.startTime;
      hasOriginalTask = sleeping || !isIdleScheduleActivity(activity);
      // 日程地点匹配不到镇内 POI 时不判离镇（日程 location 是 LLM 自由文本，对不上号是常态）：
      // 一律当「没被安排到镇内地点」处理，人留在镇上，活动文案保留日程叙事
      intent = sleeping ? 'rest' : activity?.tags?.includes('work') && loc ? 'work' : 'wait';
      target = loc?.key || null;
      scheduleKey = scheduled ? JSON.stringify([activity.startTime, activity.endTime, activity.location, sleeping]) : `idle:${sleeping}`;
      agent.activityText = sleeping ? '睡得正香' : activity?.activity || '自由时间';
      // 入驻角色：没在睡觉、日程也没把人钉到镇内地点时，同样在镇上到处走动。
      // 日程醒着的角色（当前时段有安排且非睡眠档）深夜也照常游走，否则会被深夜闸门整夜冻在原地
      if (!sleeping && intent === 'wait' && !loc) {
        const stroll = pickStrollLocation(agent, nowUtcMs, { allowNight: !!activity && activity.replyDelay !== -1 });
        if (stroll) { loc = stroll; target = stroll.key; if (!scheduled) agent.activityText = '在镇上闲逛'; }
      }
    }
    agent.sleeping = sleeping;
    agent.presence = intent === 'off_town' ? 'off_town' : 'town';
    if (intent === 'off_town' && agent.slotKey && state.occupied.get(agent.slotKey) === agent.agentKey) state.occupied.delete(agent.slotKey);
  }
  const arrived = !!(agent && loc && !agent.path && chebyshev(agent, loc) <= (loc.radius ?? 2));
  const facts = { actorId: actor.actorId, worldEpoch, intent, scheduleKey, target,
    targetExists: target === null || !!loc, arrived, locationKey: arrived ? target : null,
    allowsAction: !!agent && actor.participating && agent.encounterId === null && !isChatHeld(agent, nowUtcMs)
      && intent !== 'off_town',
    durationMs: 15 * 60000, minDurationMs: 60000 };
  const enriched = facts;
  if (!agent || hasOriginalTask
      || !enriched.allowsAction || enriched.intent !== 'wait' || enriched.target !== null
      || enriched.scheduleKey !== facts.scheduleKey) return enriched;
  // Do not change rules sleep semantics or an explicit night-owl preference here.
  const localMinute = townLocalTime(nowUtcMs).minuteOfDay;
  if (agent.kind === 'npc' && !agent.traits?.nightOwl && (localMinute >= 23 * 60 || localMinute < 6 * 60)) return enriched;
  const db = getDb();
  const binding = agent.kind === 'npc'
    ? db.prepare('SELECT home_location_id FROM town_npcs WHERE id=?').get(agent.refId)
    : db.prepare('SELECT home_location_id FROM town_characters WHERE character_id=? AND town_enabled=1').get(agent.refId);
  const homeRow = binding?.home_location_id ? db.prepare("SELECT id,key FROM town_locations WHERE id=? AND map_id=? AND kind='home'")
    .get(binding.home_location_id, state.map?.id) : null;
  const home = state.locations.find(place => place.id === homeRow?.id && place.key === homeRow.key && place.kind === 'home');
  if (!home) return enriched;
  const shelter = createTownWeatherShelter({ db }).enrich({ actor,
    scope: { worldId: state.world.worldId, worldEpoch }, facts: enriched, weather: readTownWeather(nowUtcMs),
    sourceKey: getWeatherSourceKey(config.weather.city), home, hasOriginalTask, actionId: action?.id });
  if (shelter === enriched) return enriched;
  const atHome = !agent.path && chebyshev(agent, home) <= (home.radius ?? 2);
  agent.activityText = atHome ? '在自己家中避雨' : '正在回家避雨';
  return { ...shelter, arrived: atHome, locationKey: atHome ? home.key : null };
}

/** 素材库 → 正/背spirit URL（齐备才有值） */
function spriteUrlsByKey(prefix, assets) {
  const dirs = ['down', 'up'];
  const byKey = new Map((assets || listAssets({})).map(a => [a.key, a]));
  const sprites = {};
  let ready = 0;
  for (const dir of dirs) {
    const a = byKey.get(`${prefix}${dir}`);
    if (a?.status === 'ready' && a.image_path) { sprites[dir] = a.image_path; ready++; }
  }
  return ready === dirs.length ? sprites : (ready > 0 ? sprites : null);
}

function readyAssetUrl(asset) {
  return asset?.status === 'ready' && asset.image_path ? asset.image_path : null;
}

/**
 * 角色的立绘来源链（与 NPC 立绘同口径：立绘始终以小镇素材为准）：
 * 小镇立绘 char_{id}_portrait → 关联居民的小镇立绘 npc_{npcId}_portrait → 酒馆立绘 characters.standing_url。
 * 邀约 NPC 转成的角色一开始没有自己的立绘，走中间这层复用原居民的立绘，不重复生图。
 */
function charPortraitUrl(characterId, { npcId = null, standingUrl = null } = {}) {
  return readyAssetUrl(getAssetsByKey([`char_${characterId}_portrait`])[0])
    || (npcId ? readyAssetUrl(getAssetsByKey([`npc_${npcId}_portrait`])[0]) : null)
    || standingUrl || null;
}

function characterStandingUrl(characterId) {
  return getDb().prepare('SELECT standing_url FROM characters WHERE id = ?').get(characterId)?.standing_url || null;
}

function homeLocationOfNpc(row) {
  if (row.home_location_id) {
    const loc = state.locations.find(l => l.id === row.home_location_id);
    if (loc) return loc;
  }
  return state.locations.find(l => l.kind === 'outdoor') || state.locations[0] || null;
}

function getHomeLocation(charId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT tl.* FROM town_characters tc JOIN town_locations tl ON tl.id = tc.home_location_id
    WHERE tc.character_id = ?
  `).get(charId);
  if (row) return state.locations.find(l => l.id === row.id) || null;
  return state.locations.find(l => l.kind === 'outdoor') || state.locations[0] || null;
}

/** 由快照或就近锚点重建一个 agent 的位置并占用格子（尚未开镇时不建） */
function restoreAgent(agentKey, meta, savedRow, anchorLoc) {
  if (!state.map) return; // 无地图（向导模式）：只登记 meta，不落 agent
  const agent = {
    agentKey,
    actorId: meta.actorId,
    x: null, y: null,
    path: null, speed: config.town.npcSpeed, moveStartedAt: 0,
    targetLocId: null, slotKey: null,
    activityText: '', sleeping: false,
    encounterId: null,
    bubble: null,
    dirty: false,
    kind: meta.kind,
    refId: meta.refId,
    routine: null,
    traits: {},
  };
  if (agent.kind === 'npc') {
    const db = getDb();
    const row = db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(meta.refId);
    if (row) {
      agent.routine = safeParseArray(row.routine_json);
      agent.traits = safeParseObject(row.traits_json);
    }
  }
  if (state.map) {
    const anchor = anchorLoc || state.locations[0] || { x: Math.floor(state.map.cols / 2), y: Math.floor(state.map.rows / 2), radius: 3 };
    if (savedRow && Number.isInteger(savedRow.grid_x) && Number.isInteger(savedRow.grid_y)
      && isWalkable(state.map.walkGrid, savedRow.grid_x, savedRow.grid_y)) {
      agent.x = savedRow.grid_x; agent.y = savedRow.grid_y;
      agent.activityText = savedRow.activity_text || '';
      agent.targetLocId = savedRow.current_location_id || null;
    } else {
      const cell = pickStandingCell(state.map.walkGrid, state.occupied, { x: anchor.x, y: anchor.y }, anchor.radius || 2)
        || { x: anchor.x, y: anchor.y };
      agent.x = cell.x; agent.y = cell.y;
      agent.targetLocId = anchorLoc?.id ?? null;
    }
    state.occupied.set(`${agent.x},${agent.y}`, agentKey);
    agent.slotKey = `${agent.x},${agent.y}`;
  }
  state.agents.set(agentKey, agent);
}

// ── L0 确定性移动 ──

function advanceAgent(agent, now) {
  if (advanceAgentPosition(agent, now) && agent.stroll?.targetKey) {
    // 游走到站：停留一段时间再换下一个目的地
    const loc = state.locations.find(l => l.key === agent.stroll.targetKey);
    if (loc && agent.targetLocId === loc.id) agent.stroll.restUntil = now + TOWN_STROLL_REST_MS;
  }
}

function advancePlayer(now) {
  const p = state.player;
  if (!p || !p.path || p.path.length === 0) return;
  const cells = ((now - p.moveStartedAt) / 1000) * p.speed;
  if (cells >= p.path.length) {
    const last = p.path[p.path.length - 1];
    p.x = last.x; p.y = last.y;
    p.path = null;
    persistPlayer();
  } else {
    const idx = Math.max(0, Math.floor(cells));
    const step = idx ? p.path[idx - 1] : (p.moveFrom || p);
    p.x = step.x; p.y = step.y;
  }
}

function assignTarget(agent, loc, now, { strictRadius = false } = {}) {
  if (!state.map || now < (agent.pathRetryAt || 0)) return false;
  const oldSlot = agent.slotKey;
  if (oldSlot && state.occupied.get(oldSlot) === agent.agentKey) state.occupied.delete(oldSlot);
  const cell = pickStandingCell(state.map.walkGrid, state.occupied, { x: loc.x, y: loc.y }, loc.radius);
  const start = agent.x == null || agent.y == null
    ? (cell && { from: cell, cell, prefix: [], startedAt: now }) : playerRouteStart(agent, now);
  const tail = cell && start
    ? (start.cell.x === cell.x && start.cell.y === cell.y ? [] : findPath(state.map.walkGrid, start.cell, cell)) : null;
  if (!cell || tail === null || (strictRadius && chebyshev(cell, loc) > (loc.radius ?? 2))) {
    if (oldSlot) state.occupied.set(oldSlot, agent.agentKey);
    agent.pathRetryAt = now + 30000;
    agent.pathFailureReason = cell ? 'PATH_NOT_FOUND' : 'NO_STANDING_CELL';
    return false;
  }
  agent.slotKey = `${cell.x},${cell.y}`;
  state.occupied.set(agent.slotKey, agent.agentKey);
  agent.targetLocId = loc.id;
  agent.pathFailureReason = null;
  agent.pathRetryAt = 0;
  applyPlayerRoute(agent, start, tail);
  if (!agent.path.length) agent.path = null;
  agent.dirty = true;
  broadcastTownMove({ charId: agent.agentKey, from: start.from,
    path: agent.path || [], speed: agent.speed, startedAt: start.startedAt });
  return true;
}

/** 就地停走：清空剩余路径、占位格改到当前格，并向客户端广播空路径定格。 */
function stopAgentMovement(agent) {
  agent.path = null;
  agent.simulationMoveId = null;
  if (agent.slotKey && state.occupied.get(agent.slotKey) === agent.agentKey) state.occupied.delete(agent.slotKey);
  agent.slotKey = `${agent.x},${agent.y}`;
  if (agent.presence !== 'off_town') state.occupied.set(agent.slotKey, agent.agentKey);
  agent.dirty = true;
  broadcastTownMove({ charId: agent.agentKey, from: { x: agent.x, y: agent.y }, path: [], speed: agent.speed, startedAt: Date.now() });
}

// ── 对话驻留 ──
// 对话框打开期间把对方留在原地陪聊。租约制：客户端开窗时驻留、每 30s 续租、
// 关窗即释放；客户端失联（没释放）时租约到期，作息下一拍自动恢复正常走动。

const CHAT_HOLD_MS = 90_000;

function isChatHeld(agent, now = Date.now()) {
  return Number.isSafeInteger(agent?.chatHoldUntil) && agent.chatHoldUntil > now;
}

// ── 居民驱动：NPC 作息 / 入住角色日程投影 ──

function getRoutineSlot(agent, now) {
  return findRoutineSlot(agent.routine, now, {
    timeZone: config.town.timeZone || 'Asia/Shanghai', offsetMinutes: agent.traits?.nightOwl ? 90 : 0,
  });
}

function locationFromKey(key) {
  if (!key) return null;
  if (key === 'home') return null; // 由调用方解析家
  return state.locations.find(l => l.key === key) || state.matcher(key) || null;
}

// ── 居民游走（模拟引擎事实层）：除睡觉与营业在岗外，全镇到处走动 ──

const TOWN_STROLL_PERIOD_MS = 30_000;    // 换游走目的地的时间桶
const TOWN_STROLL_REST_MS = 60_000;      // 到站后的停留时长

const strollHash = (key, seed) => {
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
};

/** 当前时间桶的游走目的地（全镇非住宅地点）。桶内（以及行走中）重复读到的事实必须稳定，
 * 否则引擎会不停 SCHEDULE_CHANGED；雨天原地歇脚让位给避雨，深夜安静（nightOwl 特质或
 * 日程醒着的入驻角色除外）；正在前往/脚下的地点不重选，保证每个桶都真的迈步；
 * 到站后停留 TOWN_STROLL_REST_MS 再启程。 */
function pickStrollLocation(agent, nowUtcMs, { allowNight = false } = {}) {
  if (isRaining()) return null;
  const localMinute = townLocalTime(nowUtcMs).minuteOfDay;
  if (!agent.traits?.nightOwl && !allowNight && (localMinute >= 23 * 60 || localMinute < 6 * 60)) return null;
  const bucket = Math.floor((nowUtcMs + strollHash(agent.agentKey, 0) % TOWN_STROLL_PERIOD_MS) / TOWN_STROLL_PERIOD_MS);
  if (agent.path?.length || agent.stroll?.bucket === bucket) {
    return agent.stroll ? state.locations.find(l => l.key === agent.stroll.targetKey) || null : null;
  }
  if (!agent.stroll) {
    // 刚入场的居民先按兵不动，等各自相位边界再起步，避免重启/重载后全镇同时开走
    agent.stroll = { bucket, targetKey: null };
    return null;
  }
  // 到站停留中：原地不动，等 restUntil 过了再选下一个目的地
  if (Number.isSafeInteger(agent.stroll.restUntil) && nowUtcMs < agent.stroll.restUntil) return null;
  const candidates = state.locations.filter(l => l.kind !== 'home' && Number.isInteger(l.x) && Number.isInteger(l.y)
    && l.id !== agent.targetLocId
    && Math.max(Math.abs(l.x - agent.x), Math.abs(l.y - agent.y)) > (l.radius ?? 2));
  const targetKey = candidates.length ? candidates[strollHash(agent.agentKey, bucket) % candidates.length].key : null;
  agent.stroll = { bucket, targetKey };
  return state.locations.find(l => l.key === targetKey) || null;
}

// ── L1 规则触发 ──

const GREETINGS = [
  '（挥手）{player}，你好呀！',
  '哟，{player}！出来散步？',
  '今天天气真不错～',
  '（微笑点头）辛苦啦～',
  '{player}，要来{loc}坐坐吗？',
];

function playerNearbyReactions(now) {
  if (!state.player || !state.map) return;
  for (const agent of state.agents.values()) {
    if (agent.kind !== 'npc' || agent.sleeping || agent.presence === 'off_town' || agent.encounterId !== null || isChatHeld(agent, now)) continue;
    if (agent.x === null || agent.path !== null) continue;
    if (chebyshev(agent, state.player) > 1) continue;
    const key = pairKey(agent.agentKey, 'me');
    if ((state.pairCooldown.get(key) ?? 0) > now) continue;

    const meta = state.meta.get(agent.agentKey);
    if (!meta) continue;
    const loc = state.locations.find(l => l.id === agent.targetLocId);
    const tpl = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
    const text = tpl
      .replaceAll('{player}', state.player.displayName)
      .replaceAll('{loc}', loc?.name || '店里');
    agent.bubble = { text, until: now + 8_000 };
    broadcastTownBubble({ charId: agent.agentKey, text, ttl: 8 });
    // 问候冷却 5 分钟（比相遇冷却短，不写库）
    state.pairCooldown.set(key, now + 5 * 60_000);
  }
}

function scanEncounters(now) {
  if (state.encounters.size >= config.town.maxActiveEncounters) return;
  if (now - (state.lastEncounterStartAt ?? 0) < config.town.encounterMinStartGapMin * 60_000) return;

  // 按 POI 分组（仅统计已到站、睡醒、空手的居民）
  const groups = new Map();
  for (const agent of state.agents.values()) {
    if (agent.encounterId !== null || isChatHeld(agent, now) || agent.sleeping || agent.presence === 'off_town') continue;
    if (agent.path !== null || agent.targetLocId === null) continue;
    if (agent.x === null || agent.y === null) continue;
    if (!groups.has(agent.targetLocId)) groups.set(agent.targetLocId, []);
    groups.get(agent.targetLocId).push(agent);
  }

  let startedThisTick = 0;
  for (const [locId, members] of groups) {
    if (members.length < 2) continue;
    const loc = state.locations.find(l => l.id === locId);
    if (!loc) continue;
    for (let i = 0; i < members.length && startedThisTick === 0 && state.encounters.size < config.town.maxActiveEncounters; i++) {
      for (let j = i + 1; j < members.length && startedThisTick === 0; j++) {
        const a = members[i];
        const b = members[j];
        if (chebyshev(a, b) > 2) continue;

        const key = pairKey(a.agentKey, b.agentKey);
        if ((state.pairCooldown.get(key) ?? 0) > now) continue;

        const related = state.relationships.has(key);
        let prob = related ? config.town.encounterRelatedProb : config.town.encounterStrangerProb;
        const moodA = a.kind === 'char' ? state.moods.get(a.refId) : null;
        const moodB = b.kind === 'char' ? state.moods.get(b.refId) : null;
        const withdrawn = (m) => m && (m.valence < -0.35 || m.arousal > 0.8);
        if (withdrawn(moodA)) prob *= 0.4;
        if (withdrawn(moodB)) prob *= 0.4;

        if (Math.random() < prob) {
          startEncounter(a, b, loc, now);
          startedThisTick++;
        }
      }
    }
    if (startedThisTick > 0) break;
  }
}

function startEncounter(a, b, loc, now) {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO town_encounters (map_id, char_a, char_b, location_id, status) VALUES (?, ?, ?, ?, ?)'
  ).run(state.map.id, encodeAgentId(a.agentKey), encodeAgentId(b.agentKey), loc.id, 'chatting');

  const enc = {
    generation: state.generation,
    id: Number(result.lastInsertRowid),
    a: a.agentKey, b: b.agentKey,
    locationId: loc.id, location: loc,
    messages: [],
    startedAt: now,
    endAt: Infinity,
    timeouts: [],
  };
  state.encounters.set(enc.id, enc);
  a.encounterId = enc.id;
  b.encounterId = enc.id;
  a.dirty = b.dirty = true;
  state.lastEncounterStartAt = now;

  broadcastTownEncounterStart({
    id: enc.id, a: a.agentKey, b: b.agentKey,
    locationId: loc.id, gridX: loc.x, gridY: loc.y,
  });
  const nameA = state.meta.get(a.agentKey)?.displayName || a.agentKey;
  const nameB = state.meta.get(b.agentKey)?.displayName || b.agentKey;
  console.log(`[town] encounter #${enc.id}: ${nameA} × ${nameB} @ ${loc.name}`);

  enqueueLlm(() => runEncounterDialogue(enc));
}

function endEncounter(enc, now) {
  const db = getDb();
  state.encounters.delete(enc.id);
  for (const t of enc.timeouts) clearTimeout(t);

  for (const agentKey of [enc.a, enc.b]) {
    const agent = state.agents.get(agentKey);
    if (agent && agent.encounterId === enc.id) {
      agent.encounterId = null;
      agent.dirty = true;
    }
  }
  state.pairCooldown.set(pairKey(enc.a, enc.b), now + config.town.encounterCooldownHours * 3600_000);

  db.prepare(`UPDATE town_encounters SET status = 'done', ended_at = ? WHERE id = ?`)
    .run(new Date(now).toISOString().slice(0, 19).replace('T', ' '), enc.id);
  broadcastTownEncounterEnd({ id: enc.id });

  if (enc.messages.length > 0) {
    // 任何组合（镇民×镇民 / 镇民×角色 / 角色×角色）的相遇都沉淀摘要并入账经历
    // 只有聚焦图才花 LLM：玩家离开后残留的相遇直接静默收尾（不写摘要、不升级奇遇）
    if (isMapFocused(state.mapId)) {
      enqueueLlm(() => runEncounterSummary(enc));
      maybeUpgradeToAmbientStory(enc, now);
    }
  }
}

function expireEncounters(now) {
  for (const enc of [...state.encounters.values()]) {
    if (now >= enc.endAt) endEncounter(enc, now);
  }
}

// ── L2 LLM 事件 ──

/** 串行队列：小镇 LLM 永远一次只有一单，独立于聊天/后台任务池 */
/**
 * L2 串行队列：同一时刻最多一个 LLM 调用在跑（多图共用一条链）。
 * 任务绑定提交时的运行实例，排队期间即使用户切图，结果也只写回原来那张图。
 */
function enqueueLlm(fn, rt = state) {
  const runtime = rt || EMPTY_RUNTIME;
  const generation = runtime.generation;
  shared.llmChain = shared.llmChain.then(() => {
    if (generation !== runtime.generation) return;
    return withRuntime(runtime, () => fn());
  }).catch(err => {
    console.warn('[town] llm task failed:', err?.message || err);
  });
  return shared.llmChain;
}

function personaLine(agentKey) {
  const meta = state.meta.get(agentKey);
  if (!meta) return '';
  if (meta.kind === 'npc') return `${meta.displayName}：${meta.personaPrompt || '（神秘居民，性格开朗）'}`;
  // 相遇文字聊天沿用角色人格；生图外观组装仅用于下面的素材生成入口。
  return `${meta.displayName}：${meta.basePrompt || meta.shortPrompt || ''}`;
}

async function runEncounterDialogue(enc) {
  if (enc.generation !== state.generation || state.encounters.get(enc.id) !== enc) return;
  if (!config.features.townLLM || !config.features.townAutoLLM) {
    enc.endAt = Date.now() + 45_000;
    return;
  }
  const metaA = state.meta.get(enc.a);
  const metaB = state.meta.get(enc.b);
  if (!metaA || !metaB) {
    enc.endAt = Date.now() + 30_000;
    return;
  }

  const weather = getWeatherNote();
  const relLine = (metaA.kind === 'char' && metaB.kind === 'char')
    ? describeRelationship(metaA.refId, metaB.refId, metaA, metaB)
    : '';
  const activityLine = (agentKey) => {
    const agent = state.agents.get(agentKey);
    const meta = state.meta.get(agentKey);
    if (!agent || !meta) return '';
    const loc = state.locations.find(l => l.id === agent.targetLocId);
    return `${meta.displayName}此刻${agent.sleeping ? '在打瞌睡' : `在${loc?.name || '镇上'}（${agent.activityText || '闲逛'}）`}`;
  };

  const messages = [
    {
      role: 'system',
      content: [
        '你是小镇的"旁白导演"。小镇里两位居民恰好在同一个地点相遇，你要为他们即兴编写一段 3~6 条的短对话。',
        '',
        '必须严格按以下 JSON 格式输出，禁止输出 JSON 以外的任何文字（解释、注释、markdown 代码块都不允许）：',
        '{',
        '  "dialogue": [',
        '    { "speaker": "A", "text": "（第一条台词）" },',
        '    { "speaker": "B", "text": "（第二条台词）" },',
        '    { "speaker": "A", "text": "（之后 A/B 严格交替，共 3~6 条）" }',
        '  ]',
        '}',
        '字段约束：',
        '- speaker：只能是 "A" 或 "B"，第一条必须是 "A"，之后严格交替',
        '- text：中文台词，不超过 40 字；符合角色性格与两人关系；可自然提及眼前的场景；小动作用（括号）内嵌在台词里；禁止写旁白或神态总结',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【地点】${enc.location.name}${enc.location.ambient ? '——' + enc.location.ambient : ''}`,
        weather ? `【天气】${weather}` : '',
        `【A】${metaA.displayName}`,
        personaLine(enc.a),
        activityLine(enc.a),
        `【B】${metaB.displayName}`,
        personaLine(enc.b),
        activityLine(enc.b),
        relLine ? `【两人关系】${relLine}` : '',
        '',
        '请输出这段相遇的对话 JSON。',
      ].filter(Boolean).join('\n'),
    },
  ];

  try {
    const content = await chatSync(messages, {
      max_tokens: 1200,
      temperature: 0.9,
      response_format: { type: 'json_object' },
      label: '小镇相遇对话',
    });
    if (enc.generation !== state.generation || state.encounters.get(enc.id) !== enc) return;
    const parsed = safeJsonParse(content);
    const dialogue = Array.isArray(parsed?.dialogue) ? parsed.dialogue : null;
    if (!dialogue || dialogue.length === 0) throw new Error('empty dialogue');

    const lines = dialogue.slice(0, 6);
    const now = Date.now();
    lines.forEach((line, i) => {
      const text = String(line?.text ?? '').trim().slice(0, 60);
      const speaker = line?.speaker === 'B' ? enc.b : enc.a;
      if (!text) return;
      const at = now + i * 3800 + 1800;
      // 定时器在之后的拍子里才触发：必须回到这场相遇所属的那张图，
      // 否则读到的会是别的实例（气泡丢失、mapId 串图）
      const owner = state;
      const timer = setTimeout(() => withRuntime(owner, () => {
        if (enc.generation !== state.generation || state.encounters.get(enc.id) !== enc) return;
        enc.messages.push({ speakerAgentKey: speaker, content: text, at });
        try {
          getDb().prepare('INSERT INTO town_chat_messages (encounter_id, speaker_char_id, content) VALUES (?, ?, ?)')
            .run(enc.id, encodeAgentId(speaker), text);
        } catch { /* 对话记录失败不影响演出 */ }
        const ag = state.agents.get(speaker);
        if (ag) ag.bubble = { text, until: at + 9_000 };
        broadcastTownBubble({ charId: speaker, encounterId: enc.id, text, ttl: 9 });
      }), at - now);
      enc.timeouts.push(timer);
    });

    enc.endAt = Date.now() + lines.length * 3800 + 60_000;
  } catch (err) {
    console.warn('[town] encounter dialogue failed:', err?.message || err);
    enc.endAt = Date.now() + 30_000;
  }
}

async function runEncounterSummary(enc) {
  if (enc.generation !== state.generation) return;
  if (!config.features.townLLM || !config.features.townAutoLLM || enc.messages.length === 0) return;
  const metaA = state.meta.get(enc.a);
  const metaB = state.meta.get(enc.b);
  if (!metaA || !metaB) return;

  const transcript = enc.messages
    .map(m => `${(m.speakerAgentKey === enc.a ? metaA : metaB).displayName}：${m.content}`)
    .join('\n');

  try {
    const content = await chatSync([
      {
        role: 'system',
        content: [
          '把两位角色在小镇上的一段对话浓缩成一条第三人称记忆。严格按以下 JSON 格式输出，禁止输出 JSON 以外的任何文字：',
          '{',
          '  "summary": "（不超过 60 字，写明谁和谁在哪里聊了什么）",',
          '  "tags": ["（2~4 个检索锚点，必须包含两位角色的名字）"]',
          '}',
          '字段约束：summary 为中文、不超过 60 字、第三人称陈述句；tags 为字符串数组，每项 2~8 字。',
        ].join('\n'),
      },
      { role: 'user', content: `【地点】${enc.location.name}\n【对话】\n${transcript}` },
    ], {
      max_tokens: 300,
      temperature: 0.5,
      response_format: { type: 'json_object' },
      label: '小镇相遇摘要',
    });
    if (enc.generation !== state.generation) return;
    const parsed = safeJsonParse(content);
    const summary = String(parsed?.summary || '').trim().slice(0, 120);
    if (!summary) return;

    const db = getDb();
    db.prepare('UPDATE town_encounters SET summary = ? WHERE id = ?').run(summary, enc.id);

    // 相遇入账：townExperienceService 消费后写入双方 town_experiences（角色侧自动写记忆）
    settleEncounterExperience(enc, summary);
  } catch (err) {
    console.warn('[town] encounter summary failed:', err?.message || err);
  }
}

/** 相遇经历事件服务：只在 townService 侧追加，校验由这里的 validators 承担。 */
let encounterEvents = null;
function encounterEventService() {
  if (!encounterEvents) {
    encounterEvents = createTownEventService({
      db: getDb(), clock: { now: Date.now },
      getWorldEpoch: worldId => createTownActorRegistry(getDb()).getWorldEpoch(worldId),
      validators: {
        'town.encounter.happened': payload => !!payload && Number.isSafeInteger(payload.encounterId)
          && payload.encounterId > 0 && typeof payload.summary === 'string'
          && payload.summary.trim().length > 0 && payload.summary.length <= 200,
      },
    });
  }
  return encounterEvents;
}

function settleEncounterExperience(enc, summary) {
  try {
    const world = state.world;
    const actorIds = [enc.a, enc.b].map(key => state.meta.get(key)?.actorId).filter(Boolean);
    if (!world || actorIds.length !== 2) return;
    encounterEventService().append({
      eventId: `encounter:${enc.id}`, worldId: world.worldId, worldEpoch: world.epoch,
      type: 'town.encounter.happened', occurredAt: Date.now(),
      actorIds, locationKey: enc.location?.key || null,
      source: { system: 'town.encounters', entityId: `encounter:${enc.id}` },
      payload: { encounterId: enc.id, summary: String(summary).slice(0, 200) },
    }, [TOWN_EXPERIENCE_CONSUMER]);
  } catch (err) {
    console.warn('[town] encounter experience settlement failed:', err?.message || err);
  }
}

function ambientStoryCountToday(db) {
  const active = db.prepare(`SELECT count(*) n FROM town_npc_events
    WHERE event_type_key = ? AND created_at >= datetime('now', '-24 hours')`).get(TOWN_NPC_AMBIENT_EVENT_TYPE_KEY).n;
  const history = db.prepare(`SELECT count(*) n FROM town_npc_event_history
    WHERE event_type_key = ? AND created_at >= datetime('now', '-24 hours')`).get(TOWN_NPC_AMBIENT_EVENT_TYPE_KEY).n;
  return active + history;
}

/** 环境奇遇钩子：NPC×NPC 相遇后有概率升级为一条镇民奇遇（town.ambient），进玩家奇遇列表。 */
function maybeUpgradeToAmbientStory(enc) {
  try {
    if (!config.features.townLLM || !config.features.townAutoLLM || !config.features.events) return;
    if (!isMapFocused(state.mapId)) return; // 非聚焦图不消耗 LLM（残留相遇收尾时同样不升级）
    if (!state.world) return;
    if (Math.random() >= (config.town.ambientStoryProb ?? 0)) return;
    const metaA = state.meta.get(enc.a), metaB = state.meta.get(enc.b);
    if (!metaA || !metaB) return;
    if (metaA.kind !== 'npc' || metaB.kind !== 'npc') return; // 环境奇遇只锚定镇民；角色相遇走角色管线
    const db = getDb();
    if (ambientStoryCountToday(db) >= (config.town.ambientStoryDailyCap ?? 0)) return;
    const npcRow = db.prepare('SELECT * FROM town_npcs WHERE id = ? AND town_enabled = 1').get(metaA.refId);
    const companionRow = db.prepare('SELECT display_name, appearance_desc, persona FROM town_npcs WHERE id = ?').get(metaB.refId);
    if (!npcRow || !companionRow) return;

    const owner = npcRow;
    const transcript = enc.messages.slice(-4)
      .map(m => `${(m.speakerAgentKey === enc.a ? metaA : metaB).displayName}：${m.content}`)
      .join('\n');
    const customPrompt = `镇民${metaA.displayName}和${metaB.displayName}刚在${enc.location.name}碰面，聊了几句：\n${transcript}\n以${owner.display_name}为主角、${companionRow.display_name}为同伴，从这次碰面出发，展开一段正在发生的小镇日常奇遇。`;

    enqueueLlm(async () => {
      try {
        if (ambientStoryCountToday(db) >= (config.town.ambientStoryDailyCap ?? 0)) return;
        await generateTownNpcEvent(owner, {
          customPrompt,
          ambient: true,
          companionNpc: { name: companionRow.display_name, appearance: companionRow.appearance_desc, persona: companionRow.persona },
          locationName: enc.location?.name || null,
          locationKey: enc.location?.key || null,
          manual: false,
          worldId: state.world?.worldId ?? null,
          worldEpoch: state.world?.epoch ?? null,
          durationMin: config.town.ambientStoryDurationMin,
        });
        console.log(`[town] ambient story spawned from encounter #${enc.id} (${owner.display_name} × ${companionRow.display_name})`);
      } catch (err) {
        if (err?.message !== 'ALREADY_ACTIVE_EVENT') console.warn('[town] ambient story failed:', err?.message || err);
      }
    });
  } catch (err) {
    console.warn('[town] ambient story hook failed:', err?.message || err);
  }
}

function maybeStatusBubbles(now) {
  const generation = state.generation;
  const intervalMs = config.town.statusBubbleIntervalMin * 60_000;
  if (now - state.lastBubbleBatchAt < intervalMs) return;
  state.lastBubbleBatchAt = now;

  if (!config.features.townLLM || !config.features.townAutoLLM) return;

  const candidates = [];
  for (const agent of state.agents.values()) {
    if (agent.sleeping || agent.presence === 'off_town' || agent.encounterId !== null) continue;
    const meta = state.meta.get(agent.agentKey);
    if (!meta) continue;
    candidates.push({
      id: agent.agentKey,
      name: meta.displayName,
      activity: agent.activityText,
      location: state.locations.find(l => l.id === agent.targetLocId)?.name || '',
    });
  }
  if (candidates.length === 0) return;

  enqueueLlm(async () => {
    const weather = getWeatherNote();
    const content = await chatSync([
      {
        role: 'system',
        content: [
          '你是小镇的旁白。为下面每位居民各写一句"正在做什么"的状态气泡。',
          '严格按以下 JSON 格式输出，禁止输出 JSON 以外的任何文字：',
          '{',
          '  "bubbles": [',
          '    { "id": "npc:1", "text": "（一句话）" },',
          '    { "id": "char:2", "text": "（一句话）" }',
          '  ]',
          '}',
          '字段约束：id 必须与输入列表的 id 完全一致、一个不落（字符串原样抄写）；text 为中文、不超过 20 字、写当前正在做的具体小动作或小念头，符合角色性格与地点、天气，禁止复述活动名称。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          weather ? `【天气】${weather}` : '',
          `【居民】${JSON.stringify(candidates)}`,
        ].filter(Boolean).join('\n'),
      },
    ], {
      max_tokens: 900,
      temperature: 0.95,
      response_format: { type: 'json_object' },
      label: '小镇状态气泡',
    });

    if (generation !== state.generation) return;

    const parsed = safeJsonParse(content);
    if (!Array.isArray(parsed?.bubbles)) return;
    for (const item of parsed.bubbles) {
      const agent = state.agents.get(String(item?.id));
      const text = String(item?.text ?? '').trim().slice(0, 30);
      if (!agent || !text || agent.sleeping || agent.encounterId !== null) continue;
      agent.flavorText = text;
      agent.bubble = { text, until: Date.now() + 14_000 };
      broadcastTownBubble({ charId: agent.agentKey, text, ttl: 14 });
    }
  });
}

function getWeatherNote() {
  const weather = readTownWeather();
  return [weather.timeDesc, weather.text, weather.temperature].filter(Boolean).join('，');
}

function describeRelationship(charA, charB, metaA, metaB) {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT from_character_id, to_character_id, relationship_text FROM character_relationships
      WHERE (from_character_id = ? AND to_character_id = ?) OR (from_character_id = ? AND to_character_id = ?)
    `).all(charA, charB, charB, charA);
    if (rows.length === 0) return '彼此还不熟，只是刚好在同一地点碰见，可以自然地打个招呼或各自安静待着';
    const parts = rows.map(r => {
      const from = r.from_character_id === charA ? metaA.displayName : metaB.displayName;
      const to = r.to_character_id === charA ? metaA.displayName : metaB.displayName;
      return `${from}眼中的${to}：${r.relationship_text}`;
    });
    return parts.join('；');
  } catch {
    return '';
  }
}

// ── 情绪缓存 ──

function refreshMoods() {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT conversation_id, valence, arousal, dominance, dominant_emotion
      FROM emotion_snapshots
    `).all();
    const latest = new Map();
    for (const r of rows) {
      const m = r.conversation_id?.match(/^char_(\d+)$/);
      if (!m) continue;
      const charId = Number(m[1]);
      latest.set(charId, {
        valence: r.valence ?? 0,
        arousal: r.arousal ?? 0.5,
        dominance: r.dominance ?? 0.5,
        dominantEmotion: r.dominant_emotion || '',
        updatedAt: Date.now(),
      });
    }
    state.moods = latest;
    state.lastMoodRefreshAt = Date.now();
  } catch { /* 情绪系统关闭时无情绪修正 */ }
}

// ── 持久化 ──

function persistAgent(agent) {
  try {
    getDb().prepare(`
      INSERT INTO town_agent_state (agent_key, map_id, grid_x, grid_y, path_json, current_location_id, activity_text, updated_at)
      VALUES (?, ?, ?, ?, '[]', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(agent_key, map_id) DO UPDATE SET
        grid_x = excluded.grid_x, grid_y = excluded.grid_y,
        current_location_id = excluded.current_location_id,
        activity_text = excluded.activity_text,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      agent.agentKey, state.mapId, agent.x, agent.y,
      agent.targetLocId, agent.activityText,
    );
    agent.dirty = false;
  } catch { /* 快照落库失败可容忍 */ }
}

function persistAllAgents() {
  for (const agent of state.agents.values()) persistAgent(agent);
}

function persistPlayer() {
  try {
    const player = state.player;
    if (!player) return;
    getDb().prepare('UPDATE town_players SET grid_x = ?, grid_y = ?, map_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(player.x, player.y, state.mapId, 'me');
    getDb().prepare(`
      INSERT INTO town_agent_state (agent_key, map_id, grid_x, grid_y, path_json, current_location_id, activity_text, updated_at)
      VALUES ('me', ?, ?, ?, '[]', NULL, '', CURRENT_TIMESTAMP)
      ON CONFLICT(agent_key, map_id) DO UPDATE SET
        grid_x = excluded.grid_x, grid_y = excluded.grid_y, updated_at = CURRENT_TIMESTAMP
    `).run(state.mapId, player.x, player.y);
  } catch { /* 可容忍 */ }
}

// ── tick 主循环 ──

function tick() {
  if (!shared.running) return;
  const now = Date.now();
  // 逐图驱动：每张图各自走位、上下班、结算；只有聚焦图跑 LLM 演出
  for (const rt of [...runtimes.values()]) {
    withRuntime(rt, () => {
      try {
        tickRuntime(rt, now);
      } catch (err) {
        console.error(`[town] tick failed (map ${rt.mapId}):`, err?.message || err);
      }
    });
  }
  broadcastTownPing();
}

/** 单张图的一拍：无 LLM 的模拟对每张图都跑，演出类只在聚焦图跑 */
function tickRuntime(rt, now) {
  if (!shared.running || !rt.map) return; // 尚未开镇的图：等向导初始化
  const focused = isMapFocused(rt.mapId);
  if (now - rt.lastMoodRefreshAt > 5 * 60_000) refreshMoods();
  synchronizeMembership();
  for (const agent of rt.agents.values()) {
    advanceAgent(agent, now);
  }
  tickTownSimulation();
  maintainTownLife();
  broadcastTownStateUpdated({ reason: 'simulation_tick' });
  advancePlayer(now);
  playerNearbyReactions(now);
  // 聚焦图才开新相遇、发状态气泡：相遇对话/环境奇遇/气泡都是页面演出，有 LLM 成本。
  // expireEncounters 保留给所有图，把残留相遇正常收尾（非聚焦图按无 LLM 方式收尾）。
  if (focused) {
    scanEncounters(now);
  }
  expireEncounters(now);
  if (focused) {
    maybeStatusBubbles(now);
  }
  for (const agent of rt.agents.values()) {
    if (agent.dirty) persistAgent(agent);
  }
}

// ── 模拟子时钟 ──
// 主 tick 默认 60 秒一跳，跟不上 15 秒的游走桶，也不够及时确认到达/换目标。
// 这里用更快的间隔只驱动模拟引擎本身（不做天气、相遇、广播状态等重活）。

const TOWN_SIM_SUBTICK_MS = 5000;

function simSubTick() {
  if (!shared.running) return;
  for (const rt of [...runtimes.values()]) {
    if (!rt.map) continue;
    withRuntime(rt, () => {
      try {
        tickTownSimulation();
      } catch (err) {
        console.error(`[town] sim subtick failed (map ${rt.mapId}):`, err?.message || err);
      }
    });
  }
}

// ── 对外 API ──

/**
 * 场景快照。不传 mapId 时返回玩家当前那张图（既有多数调用点的口径）；
 * 传 mapId 可取任意 ready 图（出行面板预载目标图），但只有玩家所在地图带 player。
 */
export function getTownState(mapId = null) {
  const rt = mapId == null ? (focusedRuntime() || firstRuntime()) : (runtimes.get(Number(mapId)) || null);
  if (!rt) return emptyTownState();
  return withRuntime(rt, () => buildTownState(rt));
}

function emptyTownState() {
  const now = Date.now();
  return {
    enabled: config.features.town,
    worldId: shared.world?.worldId || null,
    worldEpoch: shared.world?.epoch || null,
    stateVersion: 0,
    initialized: false,
    serverTime: now,
    tickSeconds: config.town.tickSeconds,
    mapId: null,
    map: null,
    locations: [],
    agents: [],
    awayAgents: [],
    encountersActive: [],
    player: null,
    playerRevision: shared.playerRevision,
    weather: readTownWeather(now),
  };
}

function buildTownState(rt) {
  const now = Date.now();
  if (rt.map) synchronizeMembership();
  for (const agent of state.agents.values()) advanceAgent(agent, now);
  advancePlayer(now);
  if (shared.running && config.features.town) tickTownSimulation(now);

  const locName = (id) => state.locations.find(l => l.id === id)?.name || null;

  const agents = [...state.agents.values()].filter(agent => agent.presence !== 'off_town').map(agent => {
    const meta = state.meta.get(agent.agentKey);
    const mood = agent.kind === 'char' ? state.moods.get(agent.refId) : null;
    return {
      agentKey: agent.agentKey,
      actorId: meta?.actorId || null,
      kind: agent.kind,
      characterId: meta?.characterId || null,
      npcId: meta?.npcId || null,
      displayName: meta?.displayName || agent.agentKey,
      avatarPath: meta?.avatarPath || null,
      standingUrl: meta?.standingUrl || null,
      sprites: meta?.sprites || null,
      x: agent.path?.length ? agent.moveFrom?.x ?? agent.x : agent.x,
      y: agent.path?.length ? agent.moveFrom?.y ?? agent.y : agent.y,
      path: agent.path || [],
      speed: agent.speed,
      startedAt: agent.path ? agent.moveStartedAt : now,
      locationId: agent.targetLocId,
      locationName: locName(agent.targetLocId),
      activityText: agent.activityText || '',
      flavorText: agent.flavorText || '',
      action: currentActorAction(meta?.actorId),
      busyReason: agent.pathFailureReason || null,
      sleeping: agent.sleeping,
      encounterId: agent.encounterId,
      mood: mood ? { valence: mood.valence, arousal: mood.arousal, dominantEmotion: mood.dominantEmotion } : null,
      bubble: agent.bubble && agent.bubble.until > now ? agent.bubble : null,
    };
  });

  const weather = readTownWeather(now);

  return {
    enabled: config.features.town,
    worldId: state.world?.worldId || null,
    worldEpoch: state.world?.epoch || null,
    stateVersion: state.generation,
    initialized: !!state.map,
    serverTime: now,
    tickSeconds: config.town.tickSeconds,
    mapId: state.mapId,
    playerRevision: shared.playerRevision,
    map: state.map
      ? { id: state.mapId, name: state.map.name, cols: state.map.cols, rows: state.map.rows, tileSize: state.map.tileSize, version: state.map.version }
      : null,
    locations: state.locations.map(l => ({
      id: l.id, key: l.key, name: l.name, kind: l.kind, x: l.x, y: l.y, radius: l.radius, ambient: l.ambient,
    })),
    agents,
    awayAgents: [...state.agents.values()].filter(a => a.presence === 'off_town')
      .map(a => ({ actorId: a.actorId, agentKey: a.agentKey, activityText: a.activityText })),
    encountersActive: [...state.encounters.values()].map(e => ({ id: e.id, a: e.a, b: e.b, locationId: e.locationId })),
    player: state.player
      ? {
        agentKey: 'me', kind: 'player',
        actorId: shared.actors.get('me')?.actorId || null,
        displayName: state.player.displayName,
        moveRevision: state.player.moveRevision || 0,
        sprites: state.player.sprites,
        x: state.player.path?.length ? state.player.moveFrom?.x ?? state.player.x : state.player.x,
        y: state.player.path?.length ? state.player.moveFrom?.y ?? state.player.y : state.player.y,
        path: state.player.path || [],
        speed: state.player.speed,
        startedAt: state.player.path ? state.player.moveStartedAt : now,
      }
      : null,
    weather,
  };
}

function currentActorAction(actorId) {
  if (!actorId || !state.world) return null;
  return getDb().prepare(`SELECT id, type, status AS phase, version, target, due_at AS dueAt,
    failure_reason AS failureReason FROM town_actions WHERE world_id = ? AND world_epoch = ?
    AND actor_id = ? AND status IN ('validated', 'reserved', 'running') ORDER BY updated_at DESC LIMIT 1`)
    .get(state.world.worldId, state.world.epoch, actorId) || null;
}

/** Server-only position evidence for orders/services; no renderer coordinates. */
export function getTownActorPosition(actorId) {
  if (!shared.running || !config.features.town || !state.map || !state.world) return null;
  const actor = createTownActorRegistry(getDb()).getActor(actorId, state.world.worldId);
  if (!actor || actor.actorId !== actorId || !actor.participating || actor.archived) return null;
  const agent = actor.playerId === 'me' ? state.player : state.agents.get(actor.agentKey);
  if (!agent || agent.presence === 'off_town') return null;
  if (actor.playerId === 'me') advancePlayer(Date.now());
  else advanceAgent(agent, Date.now());
  return { worldId: state.world.worldId, worldEpoch: state.world.epoch, actorId,
    x: agent.x, y: agent.y, moving: !!agent.path?.length, sleeping: !!agent.sleeping,
    encounterId: agent.encounterId ?? null,
    locationKeys: agent.path?.length ? [] : state.locations.filter(l => chebyshev(agent, l) <= (l.radius ?? 2)).map(l => l.key) };
}

function resolveTownActorAgent(actorId) {
  if (!shared.running || !config.features.town || !state.map || !state.world
    || typeof actorId !== 'string' || !actorId.length) return null;
  const actor = createTownActorRegistry(getDb()).getActor(actorId, state.world.worldId);
  if (!actor || actor.actorId !== actorId || !actor.participating || actor.archived || actor.playerId === 'me') return null;
  const agent = state.agents.get(actor.agentKey);
  return agent && agent.presence !== 'off_town' ? agent : null;
}

/** 对话框打开：让对方停在原地（先推进到当前格，再清空剩余路径并广播定格），并立一段驻留租约。 */
export function holdTownActor(actorId) {
  const agent = resolveTownActorAgent(actorId);
  if (!agent) return { ok: false, error: '这位居民目前不在镇上' };
  const now = Date.now();
  advanceAgent(agent, now);
  agent.chatHoldUntil = now + CHAT_HOLD_MS;
  stopAgentMovement(agent);
  return { ok: true };
}

/** 对话框关闭：解除驻留，作息与日程的下一拍即可恢复正常走动。 */
export function releaseTownActor(actorId) {
  const agent = resolveTownActorAgent(actorId);
  if (!agent) return { ok: true };
  agent.chatHoldUntil = 0;
  agent.dirty = true;
  return { ok: true };
}

export function movePlayerTo(x, y) {
  if (!config.features.town) return { ok: false, error: '小镇未启用' };
  if (!state.map || !state.player) return { ok: false, error: '尚未开镇' };
  x = parseInt(x, 10); y = parseInt(y, 10);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !isWalkable(state.map.walkGrid, x, y)) {
    return { ok: false, error: '目标位置不可到达' };
  }
  const now = Date.now();
  advancePlayer(now);
  const start = playerRouteStart(state.player, now);
  const tail = (start.cell.x === x && start.cell.y === y) ? [] : findPath(state.map.walkGrid, start.cell, { x, y });
  if (tail === null) return { ok: false, error: '目标位置不可到达' };
  applyPlayerRoute(state.player, start, tail);
  const path = state.player.path;
  broadcastTownMove({ charId: 'me', revision: state.player.moveRevision, from: start.from, path, speed: state.player.speed, startedAt: start.startedAt });
  return { ok: true, pathLength: path.length };
}

/** WASD/方向键连续移动：向相邻格走一步（本地节流上报，服务端校验） */
export function movePlayerDir(dx, dy) {
  if (!state.map || !state.player) return { ok: false, error: '尚未开镇' };
  if (![0, 1, -1].includes(dx) || ![0, 1, -1].includes(dy)) return { ok: false, error: 'invalid direction' };
  const now = Date.now();
  advancePlayer(now);
  const start = playerRouteStart(state.player, now);
  const target = { x: start.cell.x + dx, y: start.cell.y + dy };
  if (!isWalkable(state.map.walkGrid, target.x, target.y)) return { ok: false, error: 'blocked' };
  applyPlayerRoute(state.player, start, dx || dy ? [target] : []);
  broadcastTownMove({ charId: 'me', revision: state.player.moveRevision, from: start.from, path: state.player.path, speed: state.player.speed, startedAt: start.startedAt });
  return { ok: true };
}

export function getEncounterMessages(encounterId) {
  const rows = getDb().prepare(`
    SELECT m.id, m.speaker_char_id AS speakerAgentId, m.content, m.created_at AS createdAt
    FROM town_chat_messages m WHERE m.encounter_id = ? ORDER BY m.id
  `).all(encounterId);
  return rows.map(r => {
    const agentKey = decodeAgentId(r.speakerAgentId);
    const meta = state.meta.get(agentKey);
    return {
      id: r.id,
      speakerAgentKey: agentKey,
      speakerName: meta?.displayName || agentKey,
      content: r.content,
      createdAt: r.createdAt,
    };
  });
}

/** 角色入住/退住（管理面板） */
export function setTownCharacterEnabled(characterId, { townEnabled } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_characters WHERE character_id = ?').get(characterId);
  let enabled;
  if (row) {
    enabled = townEnabled === undefined ? row.town_enabled : (townEnabled ? 1 : 0);
    db.prepare('UPDATE town_characters SET town_enabled = ? WHERE character_id = ?').run(enabled, characterId);
  } else if (townEnabled !== undefined) {
    enabled = townEnabled ? 1 : 0;
    // 入住归属当前所在的镇；已有归属不因为一次勾选被搬走
    db.prepare(`INSERT INTO town_characters (character_id, map_id, town_enabled) VALUES (?, ?, ?)
      ON CONFLICT(character_id) DO UPDATE SET town_enabled = excluded.town_enabled,
        map_id = COALESCE(town_characters.map_id, excluded.map_id)`)
      .run(characterId, state.mapId, enabled);
  } else {
    enabled = 0;
  }
  synchronizeMembership();
  return { ok: true, townEnabled: !!enabled };
}

/**
 * 角色职能权限（管理面板）：写入角色自己的小镇职能（打工 / 服务 / 交易，至少一项）。
 * 只写职能表，不动入住状态；角色没配过时运行时会回退到关联居民的权限，配过就以角色为准。
 */
export function setTownCharacterCapabilities(characterId, capabilities) {
  const db = getDb();
  if (!db.prepare('SELECT id FROM characters WHERE id = ?').get(characterId)) {
    return { ok: false, error: '角色不存在' };
  }
  let list;
  try {
    list = setCharacterCapabilities(db, characterId, capabilities);
  } catch (err) {
    if (err?.code === 'INVALID_TOWN_CAPABILITIES') {
      return { ok: false, error: '职能权限无效，至少要选一项。' };
    }
    throw err;
  }
  // 影子档案的权限跟着角色走：货架调度之类的旁路直接读 town_npcs
  db.prepare('UPDATE town_npcs SET capabilities_json = ? WHERE character_id = ? AND COALESCE(character_managed, 0) = 1')
    .run(JSON.stringify(list), characterId);
  // 职能只影响能提供什么服务，不动入住状态，所以不用同步成员名单
  return { ok: true, capabilities: list };
}

/**
 * 为酒馆角色补一份「托管居民档案」。
 * 角色的服务 / 打工 / 货架项目都以 npc_id 落库，所以先要有这条影子档案；
 * 它不进居民名单、不派岗、不发朋友圈，角色删除时一并清理。幂等：已有档案直接返回。
 */
export async function ensureCharacterNpcProfile(characterId) {
  const db = getDb();
  const id = Number(characterId);
  if (!Number.isInteger(id)) return { ok: false, error: '角色无效' };
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  if (!character) return { ok: false, error: '角色不存在' };
  const existing = db.prepare('SELECT id FROM town_npcs WHERE character_id = ? ORDER BY id LIMIT 1').get(id);
  if (existing) return { ok: true, npcId: existing.id, created: false };
  const member = db.prepare('SELECT * FROM town_characters WHERE character_id = ?').get(id);
  if (!member || member.town_enabled !== 1) return { ok: false, error: '先让角色入住小镇，再建镇上的档案。' };

  const { createNpc } = await import('./townNpcService.js');
  const npc = createNpc({
    mapId: member.map_id ?? state.mapId,
    displayName: character.display_name || character.name,
    persona: character.base_prompt || '',
    brief: character.short_prompt || '',
    job: '',
    routine: [],
    homeLocationId: member.home_location_id ?? null,
    townEnabled: 1,
    workplaceKey: null,
    capabilities: readCharacterCapabilities(db, id) ?? defaultTownCapabilities(null),
    assignResponsibilities: false,
  });
  // 影子档案：与角色绑定、不派岗、不发朋友圈
  db.prepare('UPDATE town_npcs SET character_id = ?, character_managed = 1, moments_disabled = 1 WHERE id = ?').run(id, npc.id);
  createTownActorRegistry(db).linkNpcCharacter(npc.id, id);
  synchronizeMembership();
  return { ok: true, npcId: npc.id, created: true };
}

/**
 * 删除角色的托管居民档案（影子档案不留在镇上）；普通居民档案不受影响。
 * 返回删掉的档案条数，并同步小镇运行时。
 */
export function removeCharacterNpcProfile(characterId) {
  const db = getDb();
  const ids = db.prepare('SELECT id FROM town_npcs WHERE character_id = ? AND COALESCE(character_managed, 0) = 1').all(characterId);
  if (!ids.length) return 0;
  db.prepare('DELETE FROM town_npcs WHERE character_id = ? AND COALESCE(character_managed, 0) = 1').run(characterId);
  try { createTownActorRegistry(db).synchronize(); }
  catch (err) { console.warn('[town] profile actor sync failed:', err?.message); }
  reloadTown();
  return ids.length;
}

/** NPC 启停（管理面板） */
export function setNpcEnabled(npcId, enabled) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(npcId);
  if (!row) return { ok: false, error: 'NPC 不存在' };
  db.prepare('UPDATE town_npcs SET town_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, npcId);
  synchronizeMembership();
  return { ok: true };
}

/** agentKey -> 归属地图：镇民看 town_npcs.map_id，入住角色看 town_characters.map_id（退回住宅所在图） */
function actorMapIds() {
  const db = getDb();
  // 未指定归属（向导提前建档 / 老行）的居民按默认图（最小 id）处理：
  // 与 getMapRow(null) 的「第一张图」旧口径一致，避免居民在分图后凭空消失
  const fallbackMapId = db.prepare('SELECT id FROM town_maps ORDER BY id LIMIT 1').get()?.id ?? null;
  const npcMaps = new Map(db.prepare('SELECT id, map_id FROM town_npcs').all().map(r => [r.id, r.map_id]));
  const charMaps = new Map(db.prepare(`SELECT tc.character_id, COALESCE(tc.map_id, tl.map_id) AS map_id
    FROM town_characters tc LEFT JOIN town_locations tl ON tl.id = tc.home_location_id`).all()
    .map(r => [r.character_id, r.map_id]));
  return actor => {
    if (actor.playerId === 'me') return shared.playerMapId;
    if (actor.characterId != null && charMaps.has(actor.characterId)) return charMaps.get(actor.characterId) ?? fallbackMapId;
    if (actor.npcId != null && npcMaps.has(actor.npcId)) return npcMaps.get(actor.npcId) ?? fallbackMapId;
    return null;
  };
}

function synchronizeMembership() {
  const registry = createTownActorRegistry(getDb());
  const actors = registry.synchronize();
  shared.actors = new Map(actors.filter(a => a.agentKey).map(a => [a.agentKey, a]));
  // meta 只在入住时构建一次，改名落库后这里刷新 displayName，避免快照一直吐旧名字
  const db = getDb();
  for (const meta of state.meta.values()) {
    if (meta.kind === 'npc') {
      const row = db.prepare('SELECT display_name FROM town_npcs WHERE id = ?').get(meta.refId);
      if (row) meta.displayName = row.display_name;
    } else if (meta.kind === 'char') {
      const row = db.prepare('SELECT display_name, name FROM characters WHERE id = ?').get(meta.refId);
      if (row) meta.displayName = row.display_name || row.name;
    }
  }
  // 只有归属这张图的居民进入本图运行实例：同一个角色不会同时出现在两镇
  const mapOf = actorMapIds();
  const desired = new Set(actors.filter(a => a.participating && a.agentKey && a.agentKey !== 'me'
    && mapOf(a) === state.mapId).map(a => a.agentKey));
  const membershipChanged = desired.size !== state.meta.size || [...desired].some(key => !state.meta.has(key));
  for (const key of state.agents.keys()) if (!desired.has(key)) {
    const agent = state.agents.get(key);
    if (agent?.actorId) state.simulation?.cancelActor(agent.actorId, 'MEMBERSHIP_CHANGED');
    applyMembershipChange(key, false);
  }
  for (const key of state.meta.keys()) if (!desired.has(key)) state.meta.delete(key);
  for (const key of desired) applyMembershipChange(key, true);
  if (membershipChanged) broadcastTownStateUpdated({ reason: 'membership_changed' });
}

/** 启停后同步内存 agent（reload 太重，增量处理） */
function applyMembershipChange(agentKey, enabled) {
  if (enabled && !state.agents.has(agentKey)) {
    const db = getDb();
    const actor = shared.actors.get(agentKey);
    const saved = db.prepare('SELECT * FROM town_agent_state WHERE agent_key = ? AND map_id = ?').get(agentKey, state.mapId)
      || (actor?.npcExists ? db.prepare('SELECT * FROM town_agent_state WHERE agent_key = ? AND map_id = ?').get(`npc:${actor.npcId}`, state.mapId) : null);
    if (agentKey.startsWith('npc:')) {
      const row = db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(Number(agentKey.slice(4)));
      if (!row) return;
      const meta = {
        actorId: actor?.actorId, npcId: row.id, characterId: actor?.characterExists ? actor.characterId : null,
        agentKey, kind: 'npc', refId: row.id,
        displayName: row.display_name,
        personaPrompt: [row.job ? `职业：${row.job}` : '', row.persona].filter(Boolean).join('\n'),
        avatarPath: null,
        sprites: spriteUrlsByKey(`npc_${row.id}_`),
      };
      state.meta.set(agentKey, meta);
      restoreAgent(agentKey, meta, saved, homeLocationOfNpc(row));
    } else {
      const charId = Number(agentKey.slice(5));
      const metaRow = db.prepare('SELECT id, name, display_name, avatar_path, standing_url, base_prompt, short_prompt FROM characters WHERE id = ?').get(charId);
      if (!metaRow) return;
      const linkedNpcId = actor?.npcExists ? actor.npcId : null;
      const meta = {
        actorId: actor?.actorId, characterId: metaRow.id, npcId: linkedNpcId,
        agentKey, kind: 'char', refId: metaRow.id,
        displayName: metaRow.display_name || metaRow.name,
        personaPrompt: '',
        avatarPath: metaRow.avatar_path || null,
        // 立绘与 NPC 同口径：小镇立绘素材（缺失时回退酒馆立绘 / 关联居民的小镇立绘）
        standingUrl: charPortraitUrl(metaRow.id, { npcId: linkedNpcId, standingUrl: metaRow.standing_url || null }),
        basePrompt: metaRow.base_prompt || '',
        shortPrompt: metaRow.short_prompt || '',
        sprites: spriteUrlsByKey(`char_${metaRow.id}_`)
          || (linkedNpcId ? spriteUrlsByKey(`npc_${linkedNpcId}_`) : null),
      };
      state.meta.set(agentKey, meta);
      const linkedNpc = actor?.npcExists ? db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(actor.npcId) : null;
      const hasCharacterHome = db.prepare(`SELECT 1 FROM town_characters tc JOIN town_locations tl
        ON tl.id = tc.home_location_id WHERE tc.character_id = ?`).get(charId);
      restoreAgent(agentKey, meta, saved, hasCharacterHome || !linkedNpc ? getHomeLocation(charId) : homeLocationOfNpc(linkedNpc));
    }
    const agent = state.agents.get(agentKey);
    if (agent) {
      broadcastTownMove({ charId: agentKey, from: { x: agent.x, y: agent.y }, path: [], speed: agent.speed, startedAt: Date.now() });
    }
  } else if (!enabled && state.agents.has(agentKey)) {
    const agent = state.agents.get(agentKey);
    if (agent.encounterId !== null) {
      const enc = state.encounters.get(agent.encounterId);
      if (enc) endEncounter(enc, Date.now());
    }
    if (agent.slotKey && state.occupied.get(agent.slotKey) === agentKey) state.occupied.delete(agent.slotKey);
    state.agents.delete(agentKey);
    broadcastTownEncounterEnd({ id: -1, removed: agentKey });
  }
}

/**
 * 角色名单（管理面板：素材状态 + 入住状态）
 * 素材口径与 NPC 一致，且**只认角色自己名下的小镇素材**：立绘 = char_{id}_portrait，小人 = char_{id}_down/up。
 * 没做过的素材如实返回 null（面板显示空槽），既不拿酒馆立绘充数，也不借用关联居民的素材。
 */
export function listTownCharacters() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.id, c.name, c.display_name, c.avatar_path,
           COALESCE(tc.town_enabled, 0) AS town_enabled,
           cc.capabilities_json AS char_capabilities,
           n.id AS linked_npc_id, n.job AS linked_job, n.capabilities_json AS linked_npc_capabilities
    FROM characters c
    LEFT JOIN town_characters tc ON tc.character_id = c.id
    LEFT JOIN town_character_capabilities cc ON cc.character_id = c.id
    LEFT JOIN town_npcs n ON n.id = (SELECT id FROM town_npcs WHERE character_id = c.id ORDER BY id LIMIT 1)
    ORDER BY c.id
  `).all();
  const assets = listAssets({});
  const byKey = new Map(assets.map(a => [a.key, a]));
  return rows.map(r => {
    const appearanceStatus = { sprites: {}, portrait: 'unknown', standing: 'unknown' };
    const snapshots = new Map();
    const statusFor = (asset, mode) => {
      if (!asset?.meta?.appearanceSource) return 'unknown';
      if (!snapshots.has(mode)) snapshots.set(mode, createTownAppearanceSignature({ db,
        buildAppearanceSection: buildCharacterAppearanceSection, buildPersona: buildCharacterPersona })
        .capture({ sourceKind: 'character', sourceId: r.id, mode }));
      return townAssetAppearanceStatus(asset, snapshots.get(mode));
    };
    const sprites = {};
    const spriteIds = {};
    const spriteAssets = {};
    let ready = 0;
    for (const dir of ['down', 'up']) {
      const own = byKey.get(`char_${r.id}_${dir}`) || null;
      spriteAssets[dir] = own;
      appearanceStatus.sprites[dir] = own ? statusFor(own, 'sprite') : 'unknown';
      sprites[dir] = own?.status === 'ready' ? own.image_path : null;
      spriteIds[dir] = own?.id ?? null;
      if (sprites[dir]) ready++;
    }
    const portrait = byKey.get(`char_${r.id}_portrait`) || null;
    appearanceStatus.portrait = portrait ? statusFor(portrait, 'portrait') : 'unknown';
    const agentKey = `char:${r.id}`;
    const agent = state.agents.get(agentKey);
    // 职能权限：角色自己的设置优先，没配过才回退到关联居民，再回退到默认（服务）
    const ownCapabilities = parseCharacterCapabilities(r.char_capabilities);
    const linkedNpc = r.linked_npc_id != null
      ? { id: r.linked_npc_id, job: r.linked_job, capabilities_json: r.linked_npc_capabilities } : null;
    return {
      id: r.id,
      displayName: r.display_name || r.name,
      avatarPath: r.avatar_path || null,
      capabilities: ownCapabilities ?? (linkedNpc ? townCapabilities(linkedNpc) : defaultTownCapabilities(null)),
      capabilitiesExplicit: ownCapabilities !== null,
      // 立绘 / 小人都是角色自己的小镇素材，没做过就是 null（面板显示空槽）
      portrait,
      townEnabled: !!r.town_enabled,
      spriteReady: ready === 2,
      spriteCount: ready,
      sprites,
      spriteIds,
      spriteAssets,
      portraitId: portrait?.id ?? null,
      appearanceStatus,
      locationName: agent ? state.locations.find(l => l.id === agent.targetLocId)?.name || null : null,
      activityText: agent?.activityText || '',
    };
  });
}

/** 调试用：手动触发一拍 */
export function forceTick() {
  if (!shared.running) return { ok: false, error: 'town scheduler not running' };
  tick();
  return { ok: true };
}

/** 地图列表（出行目录）+ 玩家所在地图与场景修订号 */
export function getTownMaps() {
  return {
    maps: listMaps(),
    currentMapId: shared.playerMapId,
    playerRevision: shared.playerRevision,
  };
}

/** 目标图尚未装载时按数据库现建（新建镇、存档里后加的地图） */
function ensureRuntime(mapId) {
  const existing = runtimes.get(mapId);
  if (existing) return existing;
  const mapRow = getMapRow(mapId);
  if (!mapRow) return null;
  const assets = listAssets({});
  reconcileTownResponsibilities({ db: getDb(), allowFallback: true, mapId });
  const rt = buildRuntimeState(mapRow, new Map(assets.map(a => [a.id, a])));
  runtimes.set(rt.mapId, rt);
  withRuntime(rt, () => hydrateRuntime(assets));
  syncPlayerRefs();
  return rt;
}

/** 只重建一张图（地图保存 / 新镇建成）：不打断玩家当前那张图 */
export function reloadMap(mapId) {
  if (!shared.running) return { ok: false, error: 'town scheduler not running' };
  const id = Number(mapId);
  if (!Number.isInteger(id)) return { ok: false, error: '地图 id 无效' };
  const existing = runtimes.get(id);
  if (existing) {
    withRuntime(existing, () => {
      invalidateSceneCallbacks();
      persistAllAgents();
      if (existing.player) persistPlayer();
    });
  }
  runtimes.delete(id);
  const mapRow = getMapRow(id);
  if (mapRow) {
    const assets = listAssets({});
    reconcileTownResponsibilities({ db: getDb(), allowFallback: true, mapId: id });
    const rt = buildRuntimeState(mapRow, new Map(assets.map(a => [a.id, a])));
    runtimes.set(rt.mapId, rt);
    withRuntime(rt, () => hydrateRuntime(assets));
  }
  syncPlayerRefs();
  syncFocusRuntime();
  // 重建出来的这张图要把内存引用对齐到当前素材：shared.player 是跨图复用的同一个对象，
  // 它身上的小人清单只在 loadPlayer 那一刻算过，不刷新就会一直吐开工时的旧 URL。
  refreshAgentVisuals();
  broadcastTownStateUpdated({ reason: 'map_reloaded' });
  return { ok: true, mapId: id };
}

/** 落点：目标图上一次离开的位置 → 该图的户外广场 → 地图中心附近的空位 */
function placePlayerOnMap(rt) {
  const player = shared.player;
  if (!player || !rt?.map) return;
  const db = getDb();
  const saved = db.prepare('SELECT * FROM town_agent_state WHERE agent_key = ? AND map_id = ?').get('me', rt.mapId);
  const pRow = db.prepare(`SELECT * FROM town_players WHERE id = 'me'`).get();
  const center = { x: Math.floor(rt.map.cols / 2), y: Math.floor(rt.map.rows / 2) };
  player.path = null;
  player.moveStartedAt = 0;
  const candidates = [];
  if (saved && Number.isInteger(saved.grid_x) && Number.isInteger(saved.grid_y)) candidates.push({ x: saved.grid_x, y: saved.grid_y });
  if (pRow?.map_id === rt.mapId && Number.isInteger(pRow.grid_x) && Number.isInteger(pRow.grid_y)) candidates.push({ x: pRow.grid_x, y: pRow.grid_y });
  const outdoor = rt.locations.find(l => l.kind === 'outdoor') || rt.locations[0];
  if (outdoor) candidates.push({ x: outdoor.x, y: outdoor.y });
  candidates.push(center);
  for (const anchor of candidates) {
    const cell = pickStandingCell(rt.map.walkGrid, rt.occupied, anchor, 4)
      || (isWalkable(rt.map.walkGrid, anchor.x, anchor.y) ? anchor : null);
    if (cell) { player.x = cell.x; player.y = cell.y; return; }
  }
  player.x = center.x;
  player.y = center.y;
}

/**
 * 玩家出行（顶栏「出行」）：把玩家搬到目标地图。
 * 不传 expectedPlayerRevision 视为强制出行；并发时后到的请求会拿到 PLAYER_SCENE_CHANGED。
 * 旧图立刻降级为后台图（不再产生 LLM 演出），新图成为聚焦图。
 */
export function travelPlayer({ targetMapId, expectedPlayerRevision = null, worldId = null, worldEpoch = null } = {}) {
  if (!config.features.town) return { ok: false, code: 'DISABLED', error: '小镇未启用' };
  if (!shared.world) return { ok: false, code: 'NO_WORLD', error: '尚未开镇' };
  if (worldId != null && worldId !== shared.world.worldId) return { ok: false, code: 'STALE_WORLD', error: '世界已更新，请刷新后重试' };
  if (worldEpoch != null && Number(worldEpoch) !== shared.world.epoch) return { ok: false, code: 'STALE_WORLD', error: '世界已更新，请刷新后重试' };
  const targetId = Number(targetMapId);
  if (!Number.isInteger(targetId)) return { ok: false, code: 'INVALID_MAP', error: '目的地无效' };
  const meta = listMaps().find(m => m.id === targetId);
  if (!meta) return { ok: false, code: 'MAP_NOT_FOUND', error: '目的地不存在' };
  if (meta.status !== 'ready') return { ok: false, code: 'MAP_NOT_READY', error: '这座小镇还没建成' };
  if (shared.playerMapId === targetId) {
    return { ok: true, alreadyThere: true, mapId: targetId, playerRevision: shared.playerRevision,
      position: shared.player ? { x: shared.player.x, y: shared.player.y } : null, map: meta };
  }
  if (expectedPlayerRevision != null && Number(expectedPlayerRevision) !== shared.playerRevision) {
    return { ok: false, code: 'PLAYER_SCENE_CHANGED', error: '场景已变化，请重试',
      mapId: shared.playerMapId, playerRevision: shared.playerRevision };
  }
  const target = ensureRuntime(targetId);
  if (!target) return { ok: false, code: 'MAP_NOT_FOUND', error: '目的地还没有布局' };

  // 离开：先落盘旧图坐标，并静默收尾玩家仍在参与的相遇
  // （旧图随后就是后台图，按聚焦闸门口径不再产生摘要/奇遇）
  const fromRt = focusedRuntime();
  if (fromRt) {
    withRuntime(fromRt, () => {
      persistPlayer();
      for (const enc of [...fromRt.encounters.values()]) {
        if (enc.a === 'me' || enc.b === 'me') endEncounter(enc, Date.now());
      }
    });
  }

  shared.playerMapId = targetId;
  shared.playerRevision += 1;
  syncPlayerRefs();
  placePlayerOnMap(target);
  syncFocusRuntime();
  withRuntime(target, () => persistPlayer());
  broadcastTownPlayerMapChanged({ mapId: targetId, playerRevision: shared.playerRevision });
  broadcastTownStateUpdated({ reason: 'player_map_changed' });
  console.log(`[town] player travelled ${fromRt?.mapId ?? '-'} → ${targetId}`);
  return { ok: true, mapId: targetId, playerRevision: shared.playerRevision,
    position: shared.player ? { x: shared.player.x, y: shared.player.y } : null, map: meta };
}

// ── 管理面板：角色spirit / 小镇设置 / 重置世界 ──

/** 生成一个入住角色的正/背像素小人（600×800 → 36×48；外观走 characterPersona 统一入口 + 酒馆式 LLM 出 prompt） */
export async function generateCharacterSprites(characterId, { expectedWorld = captureTownAssetWorld(), refreshAppearance = false } = {}) {
  const db = getDb();
  const generation = state.generation;
  const row = db.prepare(`
    SELECT id, name, display_name, base_prompt, short_prompt FROM characters WHERE id = ?
  `).get(characterId);
  if (!row) throw new Error('角色不存在');
  const appearanceGuard = createTownAppearanceSignature({ db,
    buildAppearanceSection: buildCharacterAppearanceSection, buildPersona: buildCharacterPersona })
    .capture({ sourceKind: 'character', sourceId: characterId, mode: 'sprite' });
  const assertCurrent = () => {
    const world = captureTownAssetWorld();
    const current = db.prepare('SELECT id, name, display_name, base_prompt, short_prompt FROM characters WHERE id = ?').get(characterId);
    if (world.worldId !== expectedWorld.worldId || world.epoch !== expectedWorld.epoch
      || generation !== state.generation || !current
      || ['name', 'display_name', 'base_prompt', 'short_prompt'].some(key => current[key] !== row[key])) {
      throw Object.assign(new Error('世界或角色已变化，已取消旧spirit任务'), { code: 'TOWN_ASSET_STALE' });
    }
    appearanceGuard.assertCurrent();
  };
  assertCurrent();

  const appearance = appearanceGuard.description;
  const appearanceInfo = appearanceGuard.appearanceInfo;

  for (const dir of ['down', 'up']) {
    assertCurrent();
    const key = `char_${characterId}_${dir}`;
    const existing = getAssetsByKey([key])[0];
    // 未记录外观签名的素材（老图/上传图）不视为过时，只有明确 needs_update 才重绘
    if (existing?.status === 'ready' && (refreshAppearance !== true || townAssetAppearanceStatus(existing, appearanceGuard) !== 'needs_update')) continue;
    try {
      const prompt = await generateSpritePrompt({ appearanceInfo, direction: dir });
      assertCurrent();
      if (existing) {
        await regenerateAsset(existing.id, { prompt, expectedWorld, appearanceGuard });
      } else {
        await createAsset({
          kind: 'npc', key, name: `${row.display_name || row.name} ${dir}`, expectedWorld, appearanceGuard,
          desc: appearance || row.display_name,
          meta: { direction: dir, characterId, promptOverride: prompt },
        });
      }
      assertCurrent();
    } catch (err) {
      assertCurrent();
      if (err.code === 'TOWN_ASSET_STALE') throw err;
      console.warn(`[town] char #${characterId} sprite ${dir} failed:`, err?.message);
    }
  }
  // 入住状态下刷新内存里的spirit引用
  assertCurrent();
  refreshCharacterAssets(characterId);
  return { ok: true };
}

/** 角色素材变化后刷新内存 agent 的立绘 / spirit引用（位置与行为不动；未入住则无事发生） */
export function refreshCharacterAssets(characterId) {
  const meta = state.meta.get(`char:${characterId}`);
  if (!meta) return { ok: false };
  refreshAgentVisuals();
  return { ok: true };
}

/** 作息落库后同步内存 agent 的作息表（开镇后台补作息用；未开跑/未入住则无事发生，下个 tick 按新作息行动） */
export function refreshNpcRoutine(npcId) {
  const agent = state.agents.get(`npc:${npcId}`);
  if (!agent || agent.kind !== 'npc') return { ok: false };
  const row = getDb().prepare('SELECT routine_json FROM town_npcs WHERE id = ?').get(npcId);
  if (row) agent.routine = safeParseArray(row.routine_json);
  return { ok: true };
}

/**
 * 素材落盘/删除后重建内存 agent 的立绘 / 小人引用（npc / char / 玩家统一口径）。
 * 素材每次提交都会写新文件并删除旧文件（townAssetService.commitAssetImage），
 * 这里的引用不同步的话，getTownState 会一直吐出已删除文件的 URL，场景 404。
 * 空查结果不回退旧值：旧值指向的文件可能已被删，宁可让渲染端走立绘/占位兜底。
 */
export function refreshAgentVisuals() {
  const assets = listAssets({});
  // 素材是全世界共用的：每张图摆在场景里的引用都要按新文件重建（多图并存时别只刷新聚焦那张）
  for (const rt of runtimes.values()) {
    for (const meta of rt.meta.values()) {
      if (meta.kind === 'npc') {
        meta.sprites = spriteUrlsByKey(`npc_${meta.refId}_`, assets);
      } else if (meta.kind === 'char') {
        meta.sprites = spriteUrlsByKey(`char_${meta.refId}_`, assets)
          || (meta.npcId ? spriteUrlsByKey(`npc_${meta.npcId}_`, assets) : null);
        meta.standingUrl = charPortraitUrl(meta.refId, { npcId: meta.npcId, standingUrl: characterStandingUrl(meta.refId) });
      }
    }
  }
  // 玩家身份只有一份，且**开镇前就存在**（loadPlayer 在向导阶段就建好了这个对象，地图随后才有）：
  // 所以这里看 shared.player 而不是 state.player——没有运行实例时 state.player 是 null，
  // 开镇前补生成的正面/背面小人就永远进不了这份清单（表现：素材库有图，地图上是占位色块）。
  if (shared.player) shared.player.sprites = spriteUrlsByKey('player_', assets);
}

// 素材提交/删除统一走 townBus 广播：运行中的小镇就地重建内存引用，避免快照吐出已删除文件的 URL
onTownAssetsUpdated(() => refreshAgentVisuals());

/**
 * 角色素材补齐（与「新增居民自动入驻」同口径，各阶段独立容错）：
 * 1) 立绘：优先**登记**关联居民已有的小镇立绘（邀请入邻舍的角色复用原居民形象）；没有才 LLM 生成
 * 2) 正/背小人：优先登记关联居民的小镇小人（char_{id}_*）；没有才 LLM 生成
 * 已有 ready 素材的环节直接跳过，重复调用安全。
 * 返回的 `ready` 表示三张素材（立绘 + 正/背小人）是否齐备 —— 入住的前置条件。
 */
export async function ensureCharacterTownAssets(characterId) {
  const db = getDb();
  const char = db.prepare('SELECT id, name, display_name, standing_url FROM characters WHERE id = ?').get(characterId);
  if (!char) return { ok: false, error: '角色不存在' };
  const actor = createTownActorRegistry(db).resolveAgentKey(`char:${characterId}`);
  const npcId = actor?.npcExists ? actor.npcId : null;
  const label = char.display_name || char.name;
  const steps = { portrait: 'skipped', sprites: 'skipped' };

  try {
    if (readyAssetUrl(getAssetsByKey([`char_${characterId}_portrait`])[0])) {
      steps.portrait = 'ready';
    } else {
      const npcPortrait = npcId ? readyAssetUrl(getAssetsByKey([`npc_${npcId}_portrait`])[0]) : null;
      const { generateCharacterPortrait } = await import('./townNpcService.js');
      const result = await generateCharacterPortrait(characterId, { fallbackUrl: npcPortrait });
      steps.portrait = result.reused ? 'imported' : 'generated';
    }
  } catch (err) {
    steps.portrait = 'failed';
    console.warn(`[town] char #${characterId} portrait failed:`, err?.message);
  }

  // 正/背都要有才算齐（spriteUrlsByKey 有一向就返回对象，不能拿它当「齐备」判据）
  const ownSpriteUrl = (dir) => readyAssetUrl(getAssetsByKey([`char_${characterId}_${dir}`])[0]);
  const npcSpriteUrl = (dir) => (npcId ? readyAssetUrl(getAssetsByKey([`npc_${npcId}_${dir}`])[0]) : null);
  try {
    if (SPRITE_DIRECTIONS.every(ownSpriteUrl)) {
      steps.sprites = 'ready';
    } else if (SPRITE_DIRECTIONS.every(npcSpriteUrl)) {
      // 关联居民正/背都在才整套登记，避免只借来半套让角色半身可动
      for (const dir of SPRITE_DIRECTIONS) {
        if (ownSpriteUrl(dir)) continue;
        registerAssetFromUrl({
          kind: 'npc', key: `char_${characterId}_${dir}`, name: `${label} ${dir}`,
          url: npcSpriteUrl(dir), desc: label,
          meta: { direction: dir, characterId, importSource: 'linked_npc' },
        });
      }
      steps.sprites = 'imported';
    } else {
      // generateCharacterSprites 会跳过已就绪的方向，只补缺的那一向
      await generateCharacterSprites(characterId);
      steps.sprites = 'generated';
    }
  } catch (err) {
    steps.sprites = 'failed';
    console.warn(`[town] char #${characterId} sprites failed:`, err?.message);
  }

  refreshCharacterAssets(characterId);
  // 三张素材齐备才算补齐（入住前置条件；失败或还在生成的环节会如实报 false）
  const ready = !!readyAssetUrl(getAssetsByKey([`char_${characterId}_portrait`])[0])
    && SPRITE_DIRECTIONS.every(ownSpriteUrl);
  console.log(`[town] char #${characterId} assets ensured:`, JSON.stringify({ ...steps, ready }));
  return { ok: true, ready, steps };
}

const TOWN_SETTING_FIELDS = {
  timeZone: { type: 'timezone' },
  tickSeconds: { min: 20, max: 300, type: 'int' },
  npcSpeed: { min: 0.1, max: 4, type: 'float' },
  playerSpeed: { min: 0.2, max: 6, type: 'float' },
  encounterCooldownHours: { min: 0.5, max: 24, type: 'float' },
  encounterMinStartGapMin: { min: 1, max: 120, type: 'int' },
  maxActiveEncounters: { min: 0, max: 6, type: 'int' },
  encounterRelatedProb: { min: 0, max: 1, type: 'float' },
  encounterStrangerProb: { min: 0, max: 1, type: 'float' },
  statusBubbleIntervalMin: { min: 5, max: 240, type: 'int' },
  buildingDensity: { min: 0.5, max: 20, type: 'float' },
  propDensity: { min: 0.5, max: 40, type: 'float' },
  mapSize: { min: 30, max: 80, type: 'int' },
  aiLayoutOptimize: { type: 'boolean' },
  npcMomentsDisabled: { type: 'boolean' },
};

export function getTownSettings() {
  return { ...config.town, generation: getTownGenerationSettings() };
}

export function updateTownSettings(patch = {}) {
  const db = getDb();
  const next = { ...config.town };
  const applied = {};
  if (patch.generation !== undefined) {
    next.generation = mergeTownGenerationSettings(next.generation, patch.generation);
  }
  for (const [key, spec] of Object.entries(TOWN_SETTING_FIELDS)) {
    if (patch[key] === undefined) continue;
    if (spec.type === 'boolean') {
      if (typeof patch[key] === 'boolean') next[key] = applied[key] = patch[key];
      continue;
    }
    if (spec.type === 'enum') {
      if (spec.values.includes(patch[key])) next[key] = applied[key] = patch[key];
      continue;
    }
    if (spec.type === 'timezone') {
      try {
        if (typeof patch[key] !== 'string') continue;
        new Intl.DateTimeFormat('en', { timeZone: patch[key] }).format();
        next[key] = applied[key] = patch[key];
      } catch { /* Invalid timezone cannot poison the running clock. */ }
      continue;
    }
    let v = spec.type === 'int' ? parseInt(patch[key], 10) : parseFloat(patch[key]);
    if (Number.isNaN(v)) continue;
    v = Math.max(spec.min, Math.min(spec.max, v));
    next[key] = v;
    applied[key] = v;
  }
  // 保证道具密度始终高于建筑密度，而不是只在 prompt 里口头提醒。
  if (applied.buildingDensity !== undefined || applied.propDensity !== undefined) {
    next.propDensity = Math.min(TOWN_SETTING_FIELDS.propDensity.max, Math.max(next.propDensity, next.buildingDensity + 0.1));
    applied.buildingDensity = next.buildingDensity;
    applied.propDensity = next.propDensity;
  }
  // Validate and persist under the same writer lock. In-memory settings/timers
  // change only after commit, including when generation settings share the patch.
  db.transaction(() => {
    if (patch.generation !== undefined) db.prepare(`
      INSERT INTO system_settings (setting_key, setting_value) VALUES ('town_generation_settings', ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
    `).run(JSON.stringify(next.generation));
    if (!Object.keys(applied).length) return;
    const snapshot = {};
    for (const key of Object.keys(TOWN_SETTING_FIELDS)) snapshot[key] = next[key];
    db.prepare(`
        INSERT INTO system_settings (setting_key, setting_value) VALUES ('town_settings', ?)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
      `).run(JSON.stringify(snapshot));
  }).immediate();
  Object.assign(config.town, next);
  if (Object.keys(applied).length > 0) {
    // tick 间隔变更即时生效
    if (applied.tickSeconds && shared.timer) {
      clearInterval(shared.timer);
      shared.timer = setInterval(tick, config.town.tickSeconds * 1000);
    }
    if (applied.timeZone || applied.tickSeconds) {
      // 每张图的模拟引擎各自重建（时区/节拍是全局设置，但实例是每图一个）
      for (const rt of runtimes.values()) withRuntime(rt, initializeSimulation);
      broadcastTownStateUpdated({ reason: 'settings_changed' });
    }
  }
  return { ok: true, applied };
}

/** 仅清内存世界状态（DB 由调用方负责）——向导重新初始化时用 */
function invalidateSceneCallbacks() {
  state.generation++;
  for (const enc of state.encounters.values()) {
    for (const timer of enc.timeouts || []) clearTimeout(timer);
  }
}

export function resetWorldState() {
  for (const rt of runtimes.values()) withRuntime(rt, invalidateSceneCallbacks);
  runtimes.clear();
  shared.player = null;
  shared.playerMapId = null;
  shared.actors.clear();
  state = EMPTY_RUNTIME;
  setTownBusMapScope(null);
}

/**
 * 重置前的止血：作废在途演出、释放道具锁与托管款，然后跨 epoch。
 *
 * 这套记账只有世界维度（world_id + world_epoch），没有地图维度，所以整世界重置和单图重置共用。
 * 它动到的只有在途请求本身（会被标记成失败/过期，下个 tick 自行重排），不删任何镇的数据。
 */
function fenceInFlightWork(db, registry, world, reasonCode) {
  db.prepare(`UPDATE town_dialogue_requests SET status = 'failed', error = ?, updated_at = ?
    WHERE world_id = ? AND world_epoch = ? AND status = 'processing'`).run(reasonCode, Date.now(), world.worldId, world.epoch);
  db.prepare(`UPDATE town_interaction_offers SET status='expired',updated_at=?
    WHERE world_id=? AND world_epoch=? AND status IN ('offered','generating')`).run(Date.now(), world.worldId, world.epoch);
  // 旧 epoch 仍有效时原子取消在途动作、释放资源，然后再跨 epoch。
  createTownActionRunner({ db, clock: { now: Date.now },
    getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor, readFacts: () => ({})
  }).cancelActive({ worldId: world.worldId, worldEpoch: world.epoch,
    reasonCode, idempotencyKey: `reset:${world.epoch}` });
  const economy = createEconomyService({ db, clock: { now: Date.now }, getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor });
  getTownLifeRuntime().itemTemplates.releaseLocks({ worldId: world.worldId, worldEpoch: world.epoch,
    idempotencyKey: `reset-items:${world.epoch}`, sourceKey: `reset-items:${world.epoch}`, reasonCode });
  economy.releaseActive({ worldId: world.worldId, worldEpoch: world.epoch,
      idempotencyKey: `reset-reserves:${world.epoch}`, sourceKey: `reset-reserves:${world.epoch}`, reasonCode });
  db.prepare(`UPDATE town_event_deliveries SET status = 'dead', lease_token = NULL,
    lease_until = NULL, last_error = ? WHERE status IN ('pending', 'processing')
    AND event_id IN (SELECT event_id FROM town_domain_events WHERE world_id = ? AND world_epoch = ?)`)
    .run(reasonCode, world.worldId, world.epoch);
  registry.advanceEpoch({ expectedEpoch: world.epoch });
}

/** 丢掉一张图的运行实例且不回写（地图行已经被删了，回写会把它的居民又写回库里） */
function dropRuntime(mapId) {
  const rt = runtimes.get(mapId);
  if (!rt) return;
  withRuntime(rt, invalidateSceneCallbacks);   // 在途回调不再回写这一张图
  runtimes.delete(mapId);
}

/** 重新初始化世界：清地图/POI/居民/相遇历史，走向导 */
export function resetWorld() {
  const db = getDb();
  const registry = createTownActorRegistry(db);
  const world = registry.getWorldState();
  const nextWorld = db.transaction(() => {
    fenceInFlightWork(db, registry, world, 'WORLD_RESET');
    db.exec('UPDATE town_npcs SET home_location_id = NULL');
    db.exec('DELETE FROM town_npc_chat_messages');
    db.exec('DELETE FROM town_chat_messages');
    db.exec('DELETE FROM town_encounters');
    db.exec('DELETE FROM town_characters');
    db.exec('DELETE FROM town_npcs');
    db.exec('DELETE FROM town_locations');
    db.exec('DELETE FROM town_agent_state');
    db.exec('DELETE FROM town_maps');
    db.exec("UPDATE town_players SET sprite_asset_id = NULL, grid_x = NULL, grid_y = NULL, map_id = NULL WHERE id = 'me'");
    registry.synchronize();
    return registry.getWorldState();
  })();
  resetWorldState();
  shared.world = nextWorld;
  setTownBusScope(nextWorld);
  broadcastTownStateUpdated({ reason: 'world_reset' });
  return { ok: true, worldId: nextWorld.worldId, worldEpoch: nextWorld.epoch };
}

/**
 * 重新初始化**一张图**：清掉这张图的地图数据、POI、居民、相遇记录与入住角色，
 * 世界里别的镇原样保留——地图、地点、居民、相遇历史和运行实例都不动。
 *
 * 与 resetWorld 的区别只在「删什么」：删除全部按 map_id 收窄；止血那一段（作废在途演出、
 * 释放道具锁与托管款、跨 epoch）是世界维度的记账，没有地图维度，所以两侧共用。
 * 素材库不动：批量生图按 key 幂等复用，同世界观重建直接复用旧图，不重复烧生图。
 */
export function resetMap(mapId) {
  const db = getDb();
  const id = Number(mapId);
  if (!Number.isInteger(id)) return { ok: false, error: '地图 id 无效' };
  if (!getMapRow(id)) return { ok: false, error: '地图不存在' };

  const registry = createTownActorRegistry(db);
  const world = registry.getWorldState();
  const npcIds = db.prepare('SELECT id FROM town_npcs WHERE map_id = ?').all(id).map(r => r.id);
  const encounterIds = db.prepare('SELECT id FROM town_encounters WHERE map_id = ?').all(id).map(r => r.id);
  const inList = ids => `(${ids.map(() => '?').join(',')})`;

  const nextWorld = db.transaction(() => {
    fenceInFlightWork(db, registry, world, 'MAP_RESET');
    // 聊天记录按「这张图的居民 / 这张图的相遇」清，别的镇的对话不跟着陪葬
    if (npcIds.length) {
      db.prepare(`DELETE FROM town_npc_chat_messages WHERE npc_id IN ${inList(npcIds)}`).run(...npcIds);
    }
    if (encounterIds.length) {
      db.prepare(`DELETE FROM town_chat_messages WHERE encounter_id IN ${inList(encounterIds)}`).run(...encounterIds);
    }
    db.prepare('DELETE FROM town_encounters WHERE map_id = ?').run(id);
    db.prepare('DELETE FROM town_characters WHERE map_id = ?').run(id);
    db.prepare('DELETE FROM town_npcs WHERE map_id = ?').run(id);
    db.prepare('DELETE FROM town_locations WHERE map_id = ?').run(id);
    db.prepare('DELETE FROM town_agent_state WHERE map_id = ?').run(id);
    db.prepare('DELETE FROM town_maps WHERE id = ?').run(id);
    // 玩家正站在这张图上：坐标作废，下面 loadState 会把他落到还活着的镇（没有别的镇就回未落座）
    db.prepare("UPDATE town_players SET grid_x = NULL, grid_y = NULL, map_id = NULL WHERE id = 'me' AND map_id = ?").run(id);
    registry.synchronize();
    return registry.getWorldState();
  })();

  dropRuntime(id);
  shared.world = nextWorld;
  setTownBusScope(nextWorld);
  if (shared.running) {
    loadState();   // 重建存活各图的实例，让它们拿到新的 world 视图并重新安置玩家
  } else {
    shared.player = null;
    shared.playerMapId = null;
    syncFocusRuntime();
  }
  broadcastTownStateUpdated({ reason: 'map_reset' });
  return { ok: true, mapId: id, worldId: nextWorld.worldId, worldEpoch: nextWorld.epoch };
}
