/**
 * AI 小镇核心服务（v2：瓦片地图 + 轻量 NPC + 角色 opt-in）
 *
 * 分层（详见 ai-town-plan.md v2）：
 *   L0 确定性模拟：NPC 作息 FSM / 入住角色日程投影 → A* 寻路 → 服务端权威推进（无 LLM）
 *   L1 规则触发：  相遇判定、玩家靠近问候（本地模板）、天气/时段修正（无 LLM）
 *   L2 LLM 事件：  相遇对话、批量状态短语（独立串行队列，永不挤占聊天）
 *   L3 记忆回写：  角色×角色相遇摘要 → memory_fragments；NPC 对话历史由 townNpcService 落库
 *
 * 状态原则：服务端权威 + 内存为准；坐标只在换目标/换活动时落库，
 * 进程重启后由「作息/日程 + 当前时刻」重建（town_agent_state 仅是恢复快照）。
 * 居民身份：agentKey = 'npc:{id}'（轻量居民）| 'char:{id}'（入住角色）；玩家恒为 'me'。
 */
import { playerRouteStart, applyPlayerRoute } from './playerMovement.js';
import { advanceAgentPosition } from './agentMovement.js';
import { createTownActorRegistry } from './townActorRegistry.js';
import { createTownActionRunner } from './townActionRunner.js';
import { findRoutineSlot } from './routineSchedule.js';
import { createTownClock } from './townClock.js';
import { createTownSimulation } from './townSimulation.js';
import { createEconomyService } from './economyService.js';
import { createTownOrderService } from './townOrderService.js';
import { maintainTownOrders, getTownBusinessRuntime, isTownActorServing, abortTownServiceGenerations,
  getTownAppointmentRuntime } from './townEconomyRuntime.js';
import { getDb } from '../../db/index.js';
import { config } from '../../config.js';
import { chatSync } from '../../llm/llm-client.js';
import { getCurrentActivity, isSleeping } from '../scheduleManager.js';
import { applyMemoryActions } from '../memory/memoryRepository.js';
import { getTimeLight, getSeason } from '../timeLight.js';
import { createTownWeatherFacts } from './townWeatherFacts.js';
import { getWeatherSourceKey } from '../weatherSource.js';
import { createTownWeatherShelter, isIdleScheduleActivity } from './townWeatherShelter.js';
import { getMapRow, buildWalkGridFromLayers } from './townMapService.js';
import { getTownGenerationSettings, mergeTownGenerationSettings } from './townGenerationConfig.js';
import { buildLocationMatcher } from './townLocationMatch.js';
import { findPath, isWalkable, pickStandingCell } from './townPathfinding.js';
import { listAssets, createAsset, regenerateAsset, getAssetsByKey, deleteAsset, captureTownAssetWorld } from './townAssetService.js';
import { generateSpritePrompt } from './townPromptBuilder.js';
import { buildCharacterAppearanceSection, buildCharacterPersona } from '../characterPersona.js';
import { createTownAppearanceSignature, townAssetAppearanceStatus } from './townAppearanceSignature.js';
import {
  broadcastTownMove, broadcastTownBubble,
  broadcastTownEncounterStart, broadcastTownEncounterEnd, broadcastTownPing,
  broadcastTownStateUpdated, setTownBusScope,
} from './townBus.js';

const state = {
  generation: 0,        // 内存装载代次；异步表达不能回写已卸载的场景
  world: null,
  actors: new Map(),
  simulation: null,
  simulationActorIds: new Set(),
  running: false,
  timer: null,
  startupTimer: null,
  map: null,             // { id, name, cols, rows, tileSize, version, layers, walkGrid, assetsById }
  locations: [],         // [{ id, key, name, aliases, kind, x, y, radius, ambient }]
  matcher: null,
  agents: new Map(),     // agentKey -> agent
  meta: new Map(),       // agentKey -> { agentKey, kind, refId, displayName, personaPrompt, avatarPath, sprites }
  relationships: new Set(),   // 'min:max'（有 relationship_text 的角色无向对）
  moods: new Map(),      // charId -> { valence, arousal, dominantEmotion, updatedAt }
  encounters: new Map(), // id -> encounter
  pairCooldown: new Map(),   // 'aKey|bKey' -> 可再次相遇/问候的时间戳
  occupied: new Map(),   // 'x,y' -> agentKey
  player: null,          // { agentKey:'me', displayName, x, y, path, speed, moveStartedAt, sprites }
  lastBubbleBatchAt: 0,
  lastMoodRefreshAt: 0,
  lastEncounterStartAt: 0,
  llmChain: Promise.resolve(),  // L2 串行队列：同一时刻最多一个 LLM 调用在跑
};

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

// ── 启动 / 状态装载 ──

export function startTownScheduler() {
  if (!config.features.town) {
    console.log('[town] feature disabled, scheduler skipped');
    return;
  }
  if (state.running) return;
  state.running = true;
  loadState();

  // 首拍延后几秒：等 app.js 里日程管理器完成初始化
  state.startupTimer = setTimeout(() => {
    state.startupTimer = null;
    if (state.running) tick();
  }, 5000);
  state.timer = setInterval(tick, config.town.tickSeconds * 1000);
  console.log(`[town] scheduler started (tick=${config.town.tickSeconds}s, agents=${state.agents.size}${state.map ? '' : ', 等待世界初始化'})`);
}

export function stopTownScheduler() {
  state.running = false;
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  if (state.startupTimer) { clearTimeout(state.startupTimer); state.startupTimer = null; }
  invalidateSceneCallbacks();
  persistAllAgents();
  if (state.player) persistPlayer();
}

/** 地图保存/开镇后重载世界（不重启 tick 定时器） */
export function reloadTown() {
  if (!state.running) return;
  try {
    persistAllAgents();
    if (state.player) persistPlayer();
    loadState();
    console.log(`[town] world reloaded (agents=${state.agents.size})`);
  } catch (err) {
    console.error('[town] reload failed:', err?.message || err);
  }
}

function loadState() {
  invalidateSceneCallbacks();
  const db = getDb();
  state.world = createTownActorRegistry(db).getWorldState();
  setTownBusScope(state.world);
  const mapRow = getMapRow();
  const assets = listAssets({});
  const assetsById = new Map(assets.map(a => [a.id, a]));

  state.agents.clear();
  state.occupied.clear();
  state.encounters.clear();
  state.meta.clear();

  if (!mapRow) {
    state.map = null;
    state.locations = [];
    state.matcher = null;
  } else {
    const walkGrid = buildWalkGridFromLayers(mapRow.grid_cols, mapRow.grid_rows, mapRow.layers, assetsById);
    state.map = {
      id: mapRow.id, name: mapRow.name,
      cols: mapRow.grid_cols, rows: mapRow.grid_rows,
      tileSize: mapRow.tile_size || 32, version: mapRow.version || 1,
      layers: mapRow.layers, walkGrid, assetsById,
    };
  }

  state.locations = state.map
    ? db.prepare('SELECT * FROM town_locations WHERE map_id = ? ORDER BY id').all(state.map.id)
      .map(row => ({
        id: row.id, key: row.key, name: row.name,
        aliases: safeParseArray(row.aliases_json),
        kind: row.kind, x: row.grid_x, y: row.grid_y,
        radius: row.radius, ambient: row.ambient || '',
      }))
    : [];
  state.matcher = buildLocationMatcher(state.locations);

  // actor registry 决定唯一实体；邀请后沿用原 NPC 的身份与位置。
  synchronizeMembership();

  // 关系（角色无向对，相遇概率修正用）
  state.relationships.clear();
  for (const row of db.prepare(`
    SELECT from_character_id, to_character_id FROM character_relationships
    WHERE relationship_text IS NOT NULL AND TRIM(relationship_text) != ''
  `).all()) {
    state.relationships.add(pairKey(`char:${row.from_character_id}`, `char:${row.to_character_id}`));
  }

  // 冷却：最近一段时间的 done 相遇重建（进程重启不重置冷却）
  state.pairCooldown.clear();
  const cooldownCutoff = Date.now() - config.town.encounterCooldownHours * 3600_000;
  for (const row of db.prepare(`
    SELECT char_a, char_b, ended_at, created_at FROM town_encounters
    WHERE status IN ('done','cancelled') AND COALESCE(ended_at, created_at) >= ?
  `).all(new Date(cooldownCutoff).toISOString().slice(0, 19).replace('T', ' '))) {
    const endTs = toEpochSeconds(row.ended_at || row.created_at);
    state.pairCooldown.set(pairKey(decodeAgentId(row.char_a), decodeAgentId(row.char_b)), endTs + config.town.encounterCooldownHours * 3600_000);
  }

  // 玩家
  db.prepare(`INSERT INTO town_players (id, display_name) VALUES ('me', ?) ON CONFLICT(id) DO NOTHING`)
    .run(config.user.nickname || '我');
  const pRow = db.prepare(`SELECT * FROM town_players WHERE id = 'me'`).get();
  const playerSaved = db.prepare("SELECT * FROM town_agent_state WHERE agent_key = 'me'").get() || pRow;
  const center = state.map
    ? { x: Math.floor(state.map.cols / 2), y: Math.floor(state.map.rows / 2) }
    : { x: 0, y: 0 };
  state.player = {
    agentKey: 'me',
    displayName: pRow?.display_name || config.user.nickname || '我',
    x: center.x,
    y: center.y,
    path: null, speed: config.town.playerSpeed, moveStartedAt: 0,
    sprites: spriteUrlsByKey('player_', assets),
  };
  if (state.map) {
    const savedOk = playerSaved && Number.isInteger(playerSaved.grid_x) && Number.isInteger(playerSaved.grid_y)
      && isWalkable(state.map.walkGrid, playerSaved.grid_x, playerSaved.grid_y);
    if (savedOk) {
      state.player.x = playerSaved.grid_x;
      state.player.y = playerSaved.grid_y;
    } else if (!isWalkable(state.map.walkGrid, center.x, center.y)) {
      // 中心被占（建筑/阻挡）→ 找一个可走格落位
      const cell = pickStandingCell(state.map.walkGrid, state.occupied, center, Math.max(state.map.cols, state.map.rows));
      if (cell) { state.player.x = cell.x; state.player.y = cell.y; }
    }
  }

  // 活跃 encounter 恢复：重启后对话上下文丢失，直接收尾
  const activeEncs = db.prepare(`SELECT * FROM town_encounters WHERE status = 'chatting'`).all();
  if (activeEncs.length > 0) {
    const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const upd = db.prepare(`UPDATE town_encounters SET status = 'done', ended_at = ?, summary = COALESCE(NULLIF(summary,''), '（对话被打断）') WHERE id = ?`);
    for (const enc of activeEncs) upd.run(nowIso, enc.id);
    console.log(`[town] closed ${activeEncs.length} stale encounter(s) on boot`);
  }

  refreshMoods();
  initializeSimulation();
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
    mode: config.town.simulation === 'rules' || config.town.economyEnabled ? 'rules' : 'legacy',
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
      agent.path = null;
      agent.simulationMoveId = null;
      if (agent.slotKey && state.occupied.get(agent.slotKey) === agent.agentKey) state.occupied.delete(agent.slotKey);
      agent.slotKey = `${agent.x},${agent.y}`;
      if (agent.presence !== 'off_town') state.occupied.set(agent.slotKey, agent.agentKey);
      broadcastTownMove({ charId: agent.agentKey, from: { x: agent.x, y: agent.y }, path: [], speed: agent.speed, startedAt: Date.now() });
    },
  });
}

function economicActorIds() {
  if (!config.town.economyEnabled || !state.world) return [];
  const row = getDb().prepare('SELECT config FROM town_business_slices WHERE world_id = ? AND world_epoch = ?')
    .get(state.world.worldId, state.world.epoch);
  return row ? Object.values(JSON.parse(row.config).npcActorIds) : [];
}

function activeAppointment(actorId, now, runtime = getTownAppointmentRuntime()) {
  if (!state.world || !actorId) return null;
  const scope = { worldId: state.world.worldId, worldEpoch: state.world.epoch };
  return runtime.appointments.getActiveForActor({ scope, actorId, at: now })
    .find(appointment => appointment.providerActorId === actorId
      && appointment.startAt <= now && now < appointment.endAt) ?? null;
}

function reconcileSimulationScope(now) {
  const selected = new Set(economicActorIds());
  if (config.town.simulation === 'rules') {
    for (const agent of state.agents.values()) if (agent.actorId) selected.add(agent.actorId);
  } else if (state.world) {
    const runtime = getTownAppointmentRuntime();
    for (const agent of state.agents.values()) {
      if (agent.actorId && activeAppointment(agent.actorId,now,runtime)) selected.add(agent.actorId);
    }
  }
  state.simulation?.setMode(config.town.simulation === 'rules' || selected.size ? 'rules' : 'legacy');
  for (const actorId of state.simulationActorIds) {
    if (!selected.has(actorId)) state.simulation?.cancelActor(actorId,'SIMULATION_SCOPE_ENDED');
  }
  state.simulationActorIds = selected;
  return selected;
}

function tickTownSimulation(now = Date.now(), selected = reconcileSimulationScope(now)) {
  if (config.town.simulation === 'rules') state.simulation?.tick();
  else state.simulation?.tick({ actorIds: [...selected] });
}

function readSimulationFacts(actor, { worldEpoch, nowUtcMs, action }) {
  const agent = state.agents.get(actor.agentKey);
  if (agent && isTownActorServing(actor.actorId)) {
    advanceAgent(agent, nowUtcMs);
    agent.activityText = '正在工坊提供服务';
    agent.sleeping = false;
    agent.presence = 'town';
    return { actorId: actor.actorId, worldEpoch, intent: 'wait', scheduleKey: 'service:busy', target: null,
      targetExists: true, arrived: false, locationKey: null, allowsAction: false,
      durationMs: 15 * 60000, minDurationMs: 60000 };
  }
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
    } else {
      const date = new Date(nowUtcMs);
      const sleep = isSleeping(agent.refId, date);
      const activity = getCurrentActivity(agent.refId, date);
      sleeping = !!sleep.sleeping || activity?.replyDelay === -1;
      loc = sleeping ? getHomeLocation(agent.refId) : state.matcher(activity?.location);
      const scheduled = !!activity?.startTime;
      hasOriginalTask = sleeping || !isIdleScheduleActivity(activity);
      intent = sleeping ? 'rest' : scheduled && !loc ? 'off_town'
        : activity?.tags?.includes('work') && loc ? 'work' : 'wait';
      target = loc?.key || null;
      scheduleKey = scheduled ? JSON.stringify([activity.startTime, activity.endTime, activity.location, sleeping]) : `idle:${sleeping}`;
      agent.activityText = sleeping ? '睡得正香' : activity?.activity || '自由时间';
    }
    agent.sleeping = sleeping;
    agent.presence = intent === 'off_town' ? 'off_town' : 'town';
    if (intent === 'off_town' && agent.slotKey && state.occupied.get(agent.slotKey) === agent.agentKey) state.occupied.delete(agent.slotKey);
  }
  const arrived = !!(agent && loc && !agent.path && chebyshev(agent, loc) <= (loc.radius ?? 2));
  const facts = { actorId: actor.actorId, worldEpoch, intent, scheduleKey, target,
    targetExists: target === null || !!loc, arrived, locationKey: arrived ? target : null,
    allowsAction: !!agent && actor.participating && agent.encounterId === null && intent !== 'off_town' && !isTownActorServing(actor.actorId),
    durationMs: 15 * 60000, minDurationMs: 60000 };
  // A follow-up appointment is a temporary idle target, never a base schedule
  // mutation or a work_shift. getActiveForActor also rechecks persisted schedules.
  if (agent && facts.allowsAction && !['work','rest','off_town'].includes(intent)) {
    const appointment = activeAppointment(actor.actorId,nowUtcMs);
    if (appointment) {
      const place = state.locations.find(location => location.key === appointment.locationKey);
      const atAppointment = !!place && !agent.path && chebyshev(agent,place) <= (place.radius ?? 2);
      agent.activityText = atAppointment ? '在工坊等候预约见面' : '正在前往预约地点';
      return { ...facts, intent: 'wait', target: appointment.locationKey,
        scheduleKey: `appointment:${appointment.appointmentId}`, targetExists: !!place,
        arrived: atAppointment, locationKey: atAppointment ? appointment.locationKey : null,
        durationMs: Math.max(1,Math.min(30 * 60000,appointment.endAt-nowUtcMs)), minDurationMs: 0 };
    }
  }
  const enriched = config.town.economyEnabled ? getTownBusinessRuntime().work.enrichFacts(actor,
    { worldId: state.world.worldId, worldEpoch, nowUtcMs }, facts) : facts;
  if (agent && enriched.intent === 'work' && enriched.scheduleKey.startsWith('business:')) {
    agent.activityText = enriched.arrived ? '正在岗位上营业' : '正在前往岗位';
  }
  if (config.town.simulation !== 'rules' || !agent || hasOriginalTask
      || !enriched.allowsAction || enriched.intent !== 'wait' || enriched.target !== null
      || enriched.scheduleKey !== facts.scheduleKey) return enriched;
  // Keep legacy's default rest window out of new weather behavior; do not change
  // rules sleep semantics or an explicit night-owl preference here.
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

/** 素材库 → 正/背精灵 URL（齐备才有值） */
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
  advanceAgentPosition(agent, now);
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

function refreshNpcAgent(agent, now) {
  const slot = getRoutineSlot(agent, now);
  const hour = Math.floor(townLocalTime(now).minuteOfDay / 60);
  const isNight = hour >= 23 || hour < 6;

  if (!slot && isNight && !agent.traits?.nightOwl) {
    // 无作息覆盖的深夜 → 睡觉（在家/任一地点）
    const home = agent.refId ? (getDb().prepare('SELECT home_location_id FROM town_npcs WHERE id = ?').get(agent.refId)?.home_location_id) : null;
    const loc = state.locations.find(l => l.id === home) || state.locations[0];
    agent.sleeping = true;
    agent.activityText = '睡得正香';
    if (loc && loc.id !== agent.targetLocId && agent.encounterId === null) assignTarget(agent, loc, now);
    return;
  }

  agent.sleeping = false;

  let loc = null;
  if (slot) {
    if (slot.locationKey === 'home') {
      const home = agent.refId ? (getDb().prepare('SELECT home_location_id FROM town_npcs WHERE id = ?').get(agent.refId)?.home_location_id) : null;
      loc = state.locations.find(l => l.id === home) || null;
    } else {
      loc = locationFromKey(slot.locationKey);
    }
    agent.activityText = slot.activity || agent.activityText || '忙着自己的事';
  }

  if (!loc) {
    // 空闲时段：按 traits 偏好伪随机选地闲逛（雨天少外出）
    loc = pickWanderLocation(agent);
    if (loc) agent.activityText = agent.activityText && agent.activityText !== '睡得正香' ? agent.activityText : '在镇上闲逛';
  }

  if (agent.encounterId !== null) return; // 相遇中：原地聊天
  if (loc && loc.id !== agent.targetLocId) {
    const wanderProb = isRaining() ? 0.06 : 0.15;
    if (Math.random() < Math.max(0.5, wanderProb * 3)) assignTarget(agent, loc, now);
    else agent.activityText = agent.activityText || '在镇上闲逛';
  } else if (loc && agent.path === null && Math.random() < (isRaining() ? 0.03 : 0.08)) {
    assignTarget(agent, loc, now); // 同一地点小游走
  }
}

function pickWanderLocation(agent) {
  if (state.locations.length === 0) return null;
  const outdoorPref = Math.max(0, Math.min(1, agent.traits?.outdoor ?? 0.5));
  const weighted = [];
  for (const l of state.locations) {
    const w = l.kind === 'outdoor' ? 0.4 + outdoorPref : 0.4 + (1 - outdoorPref);
    weighted.push({ l, w });
  }
  const total = weighted.reduce((s, i) => s + i.w, 0);
  let r = Math.random() * total;
  for (const { l, w } of weighted) {
    r -= w;
    if (r <= 0) return l;
  }
  return state.locations[0];
}

function refreshCharAgent(agent, now) {
  const meta = state.meta.get(agent.agentKey);
  if (!meta) return;

  let sleeping = false;
  let act = null;
  try {
    const sleepState = isSleeping(agent.refId, new Date(now));
    sleeping = !!sleepState.sleeping;
    act = getCurrentActivity(agent.refId, new Date(now));
    if (act && act.replyDelay === -1) sleeping = true;
  } catch { /* 日程系统异常时按自由活动处理 */ }

  agent.sleeping = sleeping;

  let loc = null;
  if (sleeping) {
    loc = getHomeLocation(agent.refId);
    agent.activityText = '睡得正香';
  } else if (act) {
    loc = state.matcher(act.location) || pickWanderLocation(agent);
    agent.activityText = act.activity || agent.activityText || '自由时间';
  } else {
    loc = pickWanderLocation(agent);
    if (!agent.activityText) agent.activityText = '自由时间';
  }

  if (agent.encounterId !== null) return;
  if (loc && loc.id !== agent.targetLocId) {
    assignTarget(agent, loc, now);
  } else if (loc && agent.path === null && Math.random() < 0.08) {
    assignTarget(agent, loc, now);
  }
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
    if (agent.kind !== 'npc' || agent.sleeping || agent.presence === 'off_town' || agent.encounterId !== null) continue;
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
    if (agent.encounterId !== null || agent.sleeping || agent.presence === 'off_town') continue;
    if (isTownActorServing(agent.actorId) || currentActorAction(agent.actorId)?.type === 'work_shift') continue;
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

  if (enc.messages.length > 0 && enc.a.startsWith('char:') && enc.b.startsWith('char:')) {
    enqueueLlm(() => runEncounterSummary(enc));
  }
}

function expireEncounters(now) {
  for (const enc of [...state.encounters.values()]) {
    if (now >= enc.endAt) endEncounter(enc, now);
  }
}

// ── L2 LLM 事件 ──

/** 串行队列：小镇 LLM 永远一次只有一单，独立于聊天/后台任务池 */
function enqueueLlm(fn) {
  const generation = state.generation;
  state.llmChain = state.llmChain.then(() => {
    if (generation !== state.generation) return;
    return fn();
  }).catch(err => {
    console.warn('[town] llm task failed:', err?.message || err);
  });
  return state.llmChain;
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
  if (!config.features.townLLM) {
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
      const timer = setTimeout(() => {
        if (enc.generation !== state.generation || state.encounters.get(enc.id) !== enc) return;
        enc.messages.push({ speakerAgentKey: speaker, content: text, at });
        try {
          getDb().prepare('INSERT INTO town_chat_messages (encounter_id, speaker_char_id, content) VALUES (?, ?, ?)')
            .run(enc.id, encodeAgentId(speaker), text);
        } catch { /* 对话记录失败不影响演出 */ }
        const ag = state.agents.get(speaker);
        if (ag) ag.bubble = { text, until: at + 9_000 };
        broadcastTownBubble({ charId: speaker, encounterId: enc.id, text, ttl: 9 });
      }, at - now);
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
  if (!config.features.townLLM || enc.messages.length === 0) return;
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
    const tags = (Array.isArray(parsed?.tags) ? parsed.tags : [])
      .map(t => String(t).trim().slice(0, 8)).filter(Boolean).slice(0, 4);
    if (!summary) return;

    const db = getDb();
    db.prepare('UPDATE town_encounters SET summary = ? WHERE id = ?').run(summary, enc.id);

    try {
      applyMemoryActions({
        conversationId: `town_enc_${enc.id}`,
        sourceRawStartId: null,
        sourceRawEndId: null,
        actions: [{
          action: 'create',
          sourceMemoryIds: [],
          memory: {
            memoryType: 'event',
            subject: 'character',
            judgment: summary,
            reasoning: `${metaA.displayName}与${metaB.displayName}在${enc.location.name}的小镇相遇对话`,
            tags: [...new Set([...tags, '小镇相遇'])].slice(0, 6),
          },
        }],
      });
    } catch (memErr) {
      console.warn('[town] encounter memory writeback failed:', memErr?.message || memErr);
    }
  } catch (err) {
    console.warn('[town] encounter summary failed:', err?.message || err);
  }
}

function maybeStatusBubbles(now) {
  const generation = state.generation;
  const intervalMs = config.town.statusBubbleIntervalMin * 60_000;
  if (now - state.lastBubbleBatchAt < intervalMs) return;
  state.lastBubbleBatchAt = now;

  if (!config.features.townLLM) return;

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
      INSERT INTO town_agent_state (agent_key, grid_x, grid_y, path_json, current_location_id, activity_text, updated_at)
      VALUES (?, ?, ?, '[]', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(agent_key) DO UPDATE SET
        grid_x = excluded.grid_x, grid_y = excluded.grid_y,
        current_location_id = excluded.current_location_id,
        activity_text = excluded.activity_text,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      agent.agentKey, agent.x, agent.y,
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
    getDb().prepare('UPDATE town_players SET grid_x = ?, grid_y = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(state.player.x, state.player.y, 'me');
  } catch { /* 可容忍 */ }
}

// ── tick 主循环 ──

function tick() {
  if (!state.running) return;
  const now = Date.now();
  try {
    if (!state.map) {
      broadcastTownPing();
      return; // 尚未开镇：心跳保连接，等向导初始化
    }
    if (now - state.lastMoodRefreshAt > 5 * 60_000) refreshMoods();
    synchronizeMembership();
    const simulatedActors = reconcileSimulationScope(now);
    for (const agent of state.agents.values()) {
      advanceAgent(agent, now);
      if (config.town.simulation !== 'rules' && !simulatedActors.has(agent.actorId) && !isTownActorServing(agent.actorId)) {
        if (agent.kind === 'npc') refreshNpcAgent(agent, now);
        else refreshCharAgent(agent, now);
      }
    }
    tickTownSimulation(now,simulatedActors);
    maintainTownOrders();
    if (config.town.simulation === 'rules') broadcastTownStateUpdated({ reason: 'simulation_tick' });
    advancePlayer(now);
    playerNearbyReactions(now);
    scanEncounters(now);
    expireEncounters(now);
    maybeStatusBubbles(now);
    for (const agent of state.agents.values()) {
      if (agent.dirty) persistAgent(agent);
    }
    broadcastTownPing();
  } catch (err) {
    console.error('[town] tick failed:', err?.message || err);
  }
}

// ── 对外 API ──

export function getTownState() {
  const now = Date.now();
  if (state.map) synchronizeMembership();
  for (const agent of state.agents.values()) advanceAgent(agent, now);
  advancePlayer(now);
  if (state.running && config.features.town) tickTownSimulation(now);

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
      busyReason: isTownActorServing(meta?.actorId) ? 'SERVICE_BUSY' : agent.pathFailureReason || null,
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
    map: state.map
      ? { name: state.map.name, cols: state.map.cols, rows: state.map.rows, tileSize: state.map.tileSize, version: state.map.version }
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
        actorId: state.actors.get('me')?.actorId || null,
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
  if (!state.running || !config.features.town || !state.map || !state.world) return null;
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
  if (row) {
    const enabled = townEnabled === undefined ? row.town_enabled : (townEnabled ? 1 : 0);
    db.prepare('UPDATE town_characters SET town_enabled = ? WHERE character_id = ?').run(enabled, characterId);
  } else if (townEnabled !== undefined) {
    db.prepare('INSERT INTO town_characters (character_id, town_enabled) VALUES (?, ?) ON CONFLICT(character_id) DO UPDATE SET town_enabled = excluded.town_enabled')
      .run(characterId, townEnabled ? 1 : 0);
  }
  synchronizeMembership();
  return { ok: true };
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

function synchronizeMembership() {
  const registry = createTownActorRegistry(getDb());
  const actors = registry.synchronize();
  state.actors = new Map(actors.filter(a => a.agentKey).map(a => [a.agentKey, a]));
  const desired = new Set(actors.filter(a => a.participating && a.agentKey && a.agentKey !== 'me').map(a => a.agentKey));
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
    const actor = state.actors.get(agentKey);
    const saved = db.prepare('SELECT * FROM town_agent_state WHERE agent_key = ?').get(agentKey)
      || (actor?.npcExists ? db.prepare('SELECT * FROM town_agent_state WHERE agent_key = ?').get(`npc:${actor.npcId}`) : null);
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
      const meta = {
        actorId: actor?.actorId, characterId: metaRow.id, npcId: actor?.npcExists ? actor.npcId : null,
        agentKey, kind: 'char', refId: metaRow.id,
        displayName: metaRow.display_name || metaRow.name,
        personaPrompt: '',
        avatarPath: metaRow.avatar_path || null,
        standingUrl: metaRow.standing_url || null,
        basePrompt: metaRow.base_prompt || '',
        shortPrompt: metaRow.short_prompt || '',
        sprites: spriteUrlsByKey(`char_${metaRow.id}_`)
          || (actor?.npcExists ? spriteUrlsByKey(`npc_${actor.npcId}_`) : null),
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

/** 角色名单（管理面板：素材状态 + 入住状态） */
export function listTownCharacters() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.id, c.name, c.display_name, c.avatar_path,
           COALESCE(tc.town_enabled, 0) AS town_enabled
    FROM characters c
    LEFT JOIN town_characters tc ON tc.character_id = c.id
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
    let ready = 0;
    for (const dir of ['down', 'up']) {
      const a = byKey.get(`char_${r.id}_${dir}`);
      appearanceStatus.sprites[dir] = statusFor(a, 'sprite');
      sprites[dir] = a?.status === 'ready' ? a.image_path : null;
      spriteIds[dir] = a?.id ?? null;
      if (sprites[dir]) ready++;
    }
    const portrait = byKey.get(`char_${r.id}_portrait`);
    appearanceStatus.portrait = statusFor(portrait, 'portrait');
    const agentKey = `char:${r.id}`;
    const agent = state.agents.get(agentKey);
    return {
      id: r.id,
      displayName: r.display_name || r.name,
      avatarPath: r.avatar_path || null,
      standingUrl: db.prepare('SELECT standing_url FROM characters WHERE id = ?').get(r.id)?.standing_url || null,
      portraitUrl: portrait?.status === 'ready' ? portrait.image_path : null,
      townEnabled: !!r.town_enabled,
      spriteReady: ready === 2,
      spriteCount: ready,
      sprites,
      spriteIds,
      portraitId: portrait?.id ?? null,
      appearanceStatus,
      locationName: agent ? state.locations.find(l => l.id === agent.targetLocId)?.name || null : null,
      activityText: agent?.activityText || '',
    };
  });
}

/** 调试用：手动触发一拍 */
export function forceTick() {
  if (!state.running) return { ok: false, error: 'town scheduler not running' };
  tick();
  return { ok: true };
}

// ── 管理面板：角色精灵 / 小镇设置 / 重置世界 ──

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
      throw Object.assign(new Error('世界或角色已变化，已取消旧精灵任务'), { code: 'TOWN_ASSET_STALE' });
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
    if (existing?.status === 'ready' && (refreshAppearance !== true || townAssetAppearanceStatus(existing, appearanceGuard) === 'current')) continue;
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
  // 入住状态下刷新内存里的精灵引用
  assertCurrent();
  const agentKey = `char:${characterId}`;
  const meta = state.meta.get(agentKey);
  if (meta) meta.sprites = spriteUrlsByKey(`char_${characterId}_`);
  return { ok: true };
}

const TOWN_SETTING_FIELDS = {
  economyEnabled: { type: 'boolean' },
  liquidityEnabled: { type: 'boolean' },
  simulation: { type: 'enum', values: ['legacy', 'rules'] },
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
    if (patch.liquidityEnabled === true && config.town.liquidityEnabled !== true) {
      const context = getTownBusinessRuntime();
      const activation = context.liquidity.checkActivation(context.scope);
      if (!activation.allowed) throw Object.assign(new Error('公共基金至少需要 60 邻币可用准备金，暂不能开启保障'),
        { code: activation.reason, status: 409 });
    }
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
    if (applied.tickSeconds && state.timer) {
      clearInterval(state.timer);
      state.timer = setInterval(tick, config.town.tickSeconds * 1000);
    }
    if (applied.simulation || applied.timeZone || applied.tickSeconds || Object.hasOwn(applied, 'economyEnabled')) {
      if (applied.simulation === 'legacy' || (applied.economyEnabled === false && config.town.simulation !== 'rules')) {
        state.simulation?.setMode('legacy');
        state.simulation?.tick();
        for (const agent of state.agents.values()) agent.presence = 'town';
      }
      initializeSimulation();
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
  invalidateSceneCallbacks();
  state.map = null;
  state.locations = [];
  state.matcher = null;
  state.player = null;
  state.simulation = null;
  state.simulationActorIds.clear();
  state.actors.clear();
  state.pairCooldown.clear();
  state.agents.clear();
  state.meta.clear();
  state.occupied.clear();
  state.encounters.clear();
}

/** 重新初始化世界：清地图/POI/居民/相遇历史，走向导 */
export function resetWorld() {
  const db = getDb();
  const registry = createTownActorRegistry(db);
  const world = registry.getWorldState();
  const nextWorld = db.transaction(() => {
    db.prepare(`UPDATE town_dialogue_requests SET status = 'failed', error = 'WORLD_RESET', updated_at = ?
      WHERE world_id = ? AND world_epoch = ? AND status = 'processing'`).run(Date.now(), world.worldId, world.epoch);
    // 旧 epoch 仍有效时原子取消在途动作、释放资源，然后再跨 epoch。
    createTownActionRunner({ db, clock: { now: Date.now },
      getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor, readFacts: () => ({})
    }).cancelActive({ worldId: world.worldId, worldEpoch: world.epoch,
      reasonCode: 'WORLD_RESET', idempotencyKey: `reset:${world.epoch}` });
    const economy = createEconomyService({ db, clock: { now: Date.now }, getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor });
    const runtime = getTownBusinessRuntime();
    runtime.services.failForRebuild({ worldId: world.worldId, worldEpoch: world.epoch });
    runtime.cafe.failForRebuild({ worldId: world.worldId, worldEpoch: world.epoch });
    getTownAppointmentRuntime().appointments.cancelForRebuild({ scope: { worldId: world.worldId, worldEpoch: world.epoch } });
    runtime.production.cancelForRebuild({ worldId: world.worldId, worldEpoch: world.epoch,
      idempotencyKey: `reset-production:${world.epoch}`, sourceKey: `reset-production:${world.epoch}` });
    runtime.itemTemplates.releaseLocks({ worldId: world.worldId, worldEpoch: world.epoch,
      idempotencyKey: `reset-items:${world.epoch}`, sourceKey: `reset-items:${world.epoch}`, reasonCode: 'WORLD_RESET' });
    createTownOrderService({ db, clock: { now: Date.now }, registry, economy,
      position: { getLocation: () => null, hasArrived: () => false } })
      .cancelForRebuild({ worldId: world.worldId, worldEpoch: world.epoch,
        idempotencyKey: `reset-orders:${world.epoch}`, sourceKey: `reset-orders:${world.epoch}` });
    economy.releaseActive({ worldId: world.worldId, worldEpoch: world.epoch,
        idempotencyKey: `reset-reserves:${world.epoch}`, sourceKey: `reset-reserves:${world.epoch}`, reasonCode: 'WORLD_RESET' });
    db.prepare(`UPDATE town_event_deliveries SET status = 'dead', lease_token = NULL,
      lease_until = NULL, last_error = 'WORLD_RESET' WHERE status IN ('pending', 'processing')
      AND event_id IN (SELECT event_id FROM town_domain_events WHERE world_id = ? AND world_epoch = ?)`)
      .run(world.worldId, world.epoch);
    registry.advanceEpoch({ expectedEpoch: world.epoch });
    db.exec('UPDATE town_npcs SET home_location_id = NULL');
    db.exec('DELETE FROM town_npc_chat_messages');
    db.exec('DELETE FROM town_chat_messages');
    db.exec('DELETE FROM town_encounters');
    db.exec('DELETE FROM town_characters');
    db.exec('DELETE FROM town_npcs');
    db.exec('DELETE FROM town_locations');
    db.exec('DELETE FROM town_agent_state');
    db.exec('DELETE FROM town_maps');
    db.exec("UPDATE town_players SET sprite_asset_id = NULL, grid_x = NULL, grid_y = NULL WHERE id = 'me'");
    registry.synchronize();
    return registry.getWorldState();
  })();
  abortTownServiceGenerations(world.worldId, world.epoch);
  resetWorldState();
  state.world = nextWorld;
  setTownBusScope(nextWorld);
  broadcastTownStateUpdated({ reason: 'world_reset' });
  return { ok: true, worldId: nextWorld.worldId, worldEpoch: nextWorld.epoch };
}
