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
import { getDb } from '../../db/index.js';
import { config } from '../../config.js';
import { chatSync } from '../../llm/llm-client.js';
import { getCurrentActivity, isSleeping } from '../scheduleManager.js';
import { buildCharacterPersona } from '../characterPersona.js';
import { applyMemoryActions } from '../memory/memoryRepository.js';
import { getWeatherContext } from '../weatherService.js';
import { getMapRow, buildWalkGridFromLayers } from './townMapService.js';
import { buildLocationMatcher } from './townLocationMatch.js';
import { findPath, isWalkable, pickStandingCell } from './townPathfinding.js';
import { listAssets, createAsset, getAssetsByKey, deleteAsset } from './townAssetService.js';
import { generateSpritePrompt } from './townPromptBuilder.js';
import { buildCharacterAppearanceSection } from '../characterPersona.js';
import {
  broadcastTownMove, broadcastTownBubble,
  broadcastTownEncounterStart, broadcastTownEncounterEnd, broadcastTownPing,
} from './townBus.js';

const state = {
  running: false,
  timer: null,
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

function isRaining() {
  try {
    const w = getWeatherContext()?.weather?.weather || '';
    return /雨/.test(w);
  } catch { return false; }
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
  setTimeout(() => { if (state.running) tick(); }, 5000);
  state.timer = setInterval(tick, config.town.tickSeconds * 1000);
  console.log(`[town] scheduler started (tick=${config.town.tickSeconds}s, agents=${state.agents.size}${state.map ? '' : ', 等待世界初始化'})`);
}

export function stopTownScheduler() {
  state.running = false;
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  persistAllAgents();
}

/** 地图保存/开镇后重载世界（不重启 tick 定时器） */
export function reloadTown() {
  if (!state.running) return;
  try {
    loadState();
    console.log(`[town] world reloaded (agents=${state.agents.size})`);
  } catch (err) {
    console.error('[town] reload failed:', err?.message || err);
  }
}

function loadState() {
  const db = getDb();
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

  // 居民元数据 + agent 重建
  const saved = new Map(
    db.prepare('SELECT * FROM town_agent_state').all().map(r => [r.agent_key, r])
  );

  // 1) 轻量 NPC（作息驱动）
  const npcRows = db.prepare('SELECT * FROM town_npcs WHERE town_enabled = 1').all();
  for (const row of npcRows) {
    const agentKey = `npc:${row.id}`;
    const meta = {
      agentKey, kind: 'npc', refId: row.id,
      displayName: row.display_name,
      personaPrompt: [row.job ? `职业：${row.job}` : '', row.persona].filter(Boolean).join('\n'),
      avatarPath: null,
      sprites: spriteUrlsByKey(`npc_${row.id}_`, assets),
    };
    state.meta.set(agentKey, meta);
    restoreAgent(agentKey, meta, saved.get(agentKey), homeLocationOfNpc(row));
  }

  // 2) 入住角色（日程投影驱动）
  for (const row of db.prepare(`
    SELECT c.id, c.name, c.display_name, c.avatar_path, c.standing_url, c.base_prompt, c.short_prompt
    FROM town_characters tc JOIN characters c ON c.id = tc.character_id
    WHERE tc.town_enabled = 1
  `).all()) {
    const agentKey = `char:${row.id}`;
    const meta = {
      agentKey, kind: 'char', refId: row.id,
      displayName: row.display_name || row.name,
      personaPrompt: '',
      avatarPath: row.avatar_path || null,
      standingUrl: row.standing_url || null,
      basePrompt: row.base_prompt || '',
      shortPrompt: row.short_prompt || '',
      sprites: spriteUrlsByKey(`char_${row.id}_`, assets),
    };
    state.meta.set(agentKey, meta);
    restoreAgent(agentKey, meta, saved.get(agentKey), getHomeLocation(row.id));
  }

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
    const endTs = toEpochSeconds(row.ended_at || row.created_at) * 1000;
    state.pairCooldown.set(pairKey(decodeAgentId(row.char_a), decodeAgentId(row.char_b)), endTs + config.town.encounterCooldownHours * 3600_000);
  }

  // 玩家
  db.prepare(`INSERT INTO town_players (id, display_name) VALUES ('me', ?) ON CONFLICT(id) DO NOTHING`)
    .run(config.user.nickname || '我');
  const pRow = db.prepare(`SELECT * FROM town_players WHERE id = 'me'`).get();
  const playerSaved = saved.get('me');
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
  if (!agent.path || agent.path.length === 0) {
    if (agent.path) agent.path = null;
    return;
  }
  const cells = ((now - agent.moveStartedAt) / 1000) * agent.speed;
  if (cells >= agent.path.length) {
    const last = agent.path[agent.path.length - 1];
    agent.x = last.x; agent.y = last.y;
    agent.path = null;
  } else {
    const idx = Math.max(0, Math.floor(cells));
    const step = agent.path[Math.min(idx, agent.path.length - 1)];
    agent.x = step.x; agent.y = step.y;
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
    const step = p.path[Math.min(idx, p.path.length - 1)];
    p.x = step.x; p.y = step.y;
  }
}

function assignTarget(agent, loc, now) {
  if (!state.map) return;
  if (agent.slotKey) {
    const cur = state.occupied.get(agent.slotKey);
    if (cur === agent.agentKey) state.occupied.delete(agent.slotKey);
    agent.slotKey = null;
  }

  const cell = pickStandingCell(state.map.walkGrid, state.occupied, { x: loc.x, y: loc.y }, loc.radius)
    || { x: loc.x, y: loc.y };
  state.occupied.set(`${cell.x},${cell.y}`, agent.agentKey);
  agent.slotKey = `${cell.x},${cell.y}`;
  agent.targetLocId = loc.id;

  const from = { x: agent.x, y: agent.y };
  let path = null;
  if (agent.x === null || agent.y === null) {
    agent.x = cell.x; agent.y = cell.y;
    agent.path = null;
  } else if (from.x === cell.x && from.y === cell.y) {
    agent.path = null;
  } else {
    path = findPath(state.map.walkGrid, from, cell);
    if (path === null) {
      // 不可达（不该发生）→ 服务端权威瞬移兜底
      agent.x = cell.x; agent.y = cell.y;
      agent.path = null;
      path = null;
    } else if (path.length === 0) {
      agent.path = null;
    } else {
      agent.path = path;
      agent.moveStartedAt = now;
    }
  }
  agent.dirty = true;

  broadcastTownMove({
    charId: agent.agentKey,
    from,
    path: path || [],
    speed: agent.speed,
    startedAt: now,
  });
}

// ── 居民驱动：NPC 作息 / 入住角色日程投影 ──

function routineMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 当前作息段（nightOwl 作息整体后移 1.5 小时） */
function getRoutineSlot(agent, now) {
  if (!agent.routine || agent.routine.length === 0) return null;
  const d = new Date(now);
  const offset = agent.traits?.nightOwl ? 90 : 0;
  let minutes = d.getHours() * 60 + d.getMinutes() - offset;
  if (minutes < 0) minutes += 24 * 60;
  for (const slot of agent.routine) {
    const s = routineMinutes(slot.start);
    const e = routineMinutes(slot.end) || 24 * 60;
    const adjE = e <= s ? 24 * 60 : e;
    if (minutes >= s && minutes < adjE) return slot;
  }
  return null;
}

function locationFromKey(key) {
  if (!key) return null;
  if (key === 'home') return null; // 由调用方解析家
  return state.locations.find(l => l.key === key) || state.matcher(key) || null;
}

function refreshNpcAgent(agent, now) {
  const slot = getRoutineSlot(agent, now);
  const hour = new Date(now).getHours();
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
    const sleepState = isSleeping(agent.refId, now);
    sleeping = !!sleepState.sleeping;
    act = getCurrentActivity(agent.refId, now);
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
    if (agent.kind !== 'npc' || agent.sleeping || agent.encounterId !== null) continue;
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
    if (agent.encounterId !== null || agent.sleeping) continue;
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
  state.llmChain = state.llmChain.then(fn).catch(err => {
    console.warn('[town] llm task failed:', err?.message || err);
  });
  return state.llmChain;
}

function personaLine(agentKey) {
  const meta = state.meta.get(agentKey);
  if (!meta) return '';
  if (meta.kind === 'npc') return `${meta.displayName}：${meta.personaPrompt || '（神秘居民，性格开朗）'}`;
  try {
    return buildCharacterPersona(meta, { variant: 'full', person: meta.displayName, outfits: 'auto' });
  } catch {
    return `${meta.displayName}：${meta.shortPrompt || meta.basePrompt || ''}`;
  }
}

async function runEncounterDialogue(enc) {
  if (!state.encounters.has(enc.id)) return;
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
        if (!state.encounters.has(enc.id)) return;
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
  const intervalMs = config.town.statusBubbleIntervalMin * 60_000;
  if (now - state.lastBubbleBatchAt < intervalMs) return;
  state.lastBubbleBatchAt = now;

  if (!config.features.townLLM) return;

  const candidates = [];
  for (const agent of state.agents.values()) {
    if (agent.sleeping || agent.encounterId !== null) continue;
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

    const parsed = safeJsonParse(content);
    if (!Array.isArray(parsed?.bubbles)) return;
    for (const item of parsed.bubbles) {
      const agent = state.agents.get(String(item?.id));
      const text = String(item?.text ?? '').trim().slice(0, 30);
      if (!agent || !text || agent.sleeping || agent.encounterId !== null) continue;
      agent.activityText = text;
      agent.dirty = true;
      agent.bubble = { text, until: Date.now() + 14_000 };
      broadcastTownBubble({ charId: agent.agentKey, text, ttl: 14 });
    }
  });
}

function getWeatherNote() {
  try {
    const ctx = getWeatherContext();
    if (!ctx) return '';
    const w = ctx.weather;
    return [ctx.timeDesc, w?.weather, w?.temperature != null ? `${w.temperature}°C` : '']
      .filter(Boolean).join('，');
  } catch { return ''; }
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
    for (const agent of state.agents.values()) {
      advanceAgent(agent, now);
      if (agent.kind === 'npc') refreshNpcAgent(agent, now);
      else refreshCharAgent(agent, now);
    }
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
  for (const agent of state.agents.values()) advanceAgent(agent, now);
  advancePlayer(now);

  const locName = (id) => state.locations.find(l => l.id === id)?.name || null;

  const agents = [...state.agents.values()].map(agent => {
    const meta = state.meta.get(agent.agentKey);
    const mood = agent.kind === 'char' ? state.moods.get(agent.refId) : null;
    return {
      agentKey: agent.agentKey,
      kind: agent.kind,
      characterId: agent.kind === 'char' ? agent.refId : null,
      npcId: agent.kind === 'npc' ? agent.refId : null,
      displayName: meta?.displayName || agent.agentKey,
      avatarPath: meta?.avatarPath || null,
      standingUrl: meta?.standingUrl || null,
      sprites: meta?.sprites || null,
      x: agent.x, y: agent.y,
      path: agent.path || [],
      speed: agent.speed,
      startedAt: agent.path ? agent.moveStartedAt : now,
      locationId: agent.targetLocId,
      locationName: locName(agent.targetLocId),
      activityText: agent.activityText || '',
      sleeping: agent.sleeping,
      encounterId: agent.encounterId,
      mood: mood ? { valence: mood.valence, arousal: mood.arousal, dominantEmotion: mood.dominantEmotion } : null,
      bubble: agent.bubble && agent.bubble.until > now ? agent.bubble : null,
    };
  });

  const weather = (() => {
    try {
      const ctx = getWeatherContext();
      if (!ctx) return null;
      return {
        timeDesc: ctx.timeDesc, hour: ctx.hour, season: ctx.season,
        text: ctx.weather?.weather || '', temperature: ctx.weather?.temperature ?? null,
      };
    } catch { return null; }
  })();

  return {
    enabled: config.features.town,
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
    encountersActive: [...state.encounters.values()].map(e => ({ id: e.id, a: e.a, b: e.b, locationId: e.locationId })),
    player: state.player
      ? {
        displayName: state.player.displayName,
        sprites: state.player.sprites,
        x: state.player.x, y: state.player.y,
        path: state.player.path || [],
        speed: state.player.speed,
        startedAt: state.player.path ? state.player.moveStartedAt : now,
      }
      : null,
    weather,
  };
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
  const from = { x: state.player.x, y: state.player.y };
  const path = (from.x === x && from.y === y) ? [] : findPath(state.map.walkGrid, from, { x, y });
  if (path === null) return { ok: false, error: '目标位置不可到达' };

  state.player.x = from.x;
  state.player.y = from.y;
  state.player.path = path;
  state.player.moveStartedAt = now;
  broadcastTownMove({ charId: 'me', from, path, speed: state.player.speed, startedAt: now });
  return { ok: true, pathLength: path.length };
}

/** WASD/方向键连续移动：向相邻格走一步（本地节流上报，服务端校验） */
export function movePlayerDir(dx, dy) {
  if (!state.map || !state.player) return { ok: false, error: '尚未开镇' };
  if (![0, 1, -1].includes(dx) || ![0, 1, -1].includes(dy)) return { ok: false, error: 'invalid direction' };
  const now = Date.now();
  advancePlayer(now);
  const target = { x: state.player.x + dx, y: state.player.y + dy };
  if (!isWalkable(state.map.walkGrid, target.x, target.y)) return { ok: false, error: 'blocked' };
  state.player.path = [target];
  state.player.moveStartedAt = now;
  broadcastTownMove({ charId: 'me', from: { x: state.player.x, y: state.player.y }, path: [target], speed: state.player.speed, startedAt: now });
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
  } else if (townEnabled) {
    db.prepare('INSERT INTO town_characters (character_id, town_enabled) VALUES (?, 1) ON CONFLICT(character_id) DO UPDATE SET town_enabled = 1')
      .run(characterId);
  }
  applyMembershipChange(`char:${characterId}`, townEnabled === undefined ? !!row?.town_enabled : !!townEnabled);
  return { ok: true };
}

/** NPC 启停（管理面板） */
export function setNpcEnabled(npcId, enabled) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(npcId);
  if (!row) return { ok: false, error: 'NPC 不存在' };
  db.prepare('UPDATE town_npcs SET town_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, npcId);
  applyMembershipChange(`npc:${npcId}`, !!enabled);
  return { ok: true };
}

/** 启停后同步内存 agent（reload 太重，增量处理） */
function applyMembershipChange(agentKey, enabled) {
  if (enabled && !state.agents.has(agentKey)) {
    const db = getDb();
    const saved = db.prepare('SELECT * FROM town_agent_state WHERE agent_key = ?').get(agentKey);
    if (agentKey.startsWith('npc:')) {
      const row = db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(Number(agentKey.slice(4)));
      if (!row) return;
      const meta = {
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
        agentKey, kind: 'char', refId: metaRow.id,
        displayName: metaRow.display_name || metaRow.name,
        personaPrompt: '',
        avatarPath: metaRow.avatar_path || null,
        standingUrl: metaRow.standing_url || null,
        basePrompt: metaRow.base_prompt || '',
        shortPrompt: metaRow.short_prompt || '',
        sprites: spriteUrlsByKey(`char_${metaRow.id}_`),
      };
      state.meta.set(agentKey, meta);
      restoreAgent(agentKey, meta, saved, getHomeLocation(charId));
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
    const sprites = {};
    const spriteIds = {};
    let ready = 0;
    for (const dir of ['down', 'up']) {
      const a = byKey.get(`char_${r.id}_${dir}`);
      sprites[dir] = a?.status === 'ready' ? a.image_path : null;
      spriteIds[dir] = a?.id ?? null;
      if (sprites[dir]) ready++;
    }
    const portrait = byKey.get(`char_${r.id}_portrait`);
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
export async function generateCharacterSprites(characterId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, name, display_name, base_prompt, short_prompt FROM characters WHERE id = ?
  `).get(characterId);
  if (!row) throw new Error('角色不存在');

  let appearance = '';
  try {
    appearance = buildCharacterAppearanceSection(row, { outfits: 'auto' })
      .replace(/^##\s*你的外观\s*$/m, '')
      .replace(/^[-*]\s*/gm, '')
      .trim();
  } catch {
    appearance = row.short_prompt || row.base_prompt || row.display_name;
  }
  const appearanceInfo = [
    `【名字】${row.display_name || row.name}`,
    `【外观描述（必以此为准）】${appearance || row.display_name}`,
  ].join('\n');

  for (const dir of ['down', 'up']) {
    const key = `char_${characterId}_${dir}`;
    const existing = getAssetsByKey([key])[0];
    if (existing?.status === 'ready') continue;
    if (existing) deleteAsset(existing.id);
    try {
      const prompt = await generateSpritePrompt({ appearanceInfo, direction: dir });
      await createAsset({
        kind: 'npc', key, name: `${row.display_name || row.name} ${dir}`,
        desc: appearance || row.display_name,
        meta: { direction: dir, characterId, promptOverride: prompt },
      });
    } catch (err) {
      console.warn(`[town] char #${characterId} sprite ${dir} failed:`, err?.message);
    }
  }
  // 入住状态下刷新内存里的精灵引用
  const agentKey = `char:${characterId}`;
  const meta = state.meta.get(agentKey);
  if (meta) meta.sprites = spriteUrlsByKey(`char_${characterId}_`);
  return { ok: true };
}

const TOWN_SETTING_FIELDS = {
  tickSeconds: { min: 20, max: 300, type: 'int' },
  npcSpeed: { min: 0.1, max: 4, type: 'float' },
  playerSpeed: { min: 0.2, max: 6, type: 'float' },
  encounterCooldownHours: { min: 0.5, max: 24, type: 'float' },
  encounterMinStartGapMin: { min: 1, max: 120, type: 'int' },
  maxActiveEncounters: { min: 0, max: 6, type: 'int' },
  encounterRelatedProb: { min: 0, max: 1, type: 'float' },
  encounterStrangerProb: { min: 0, max: 1, type: 'float' },
  statusBubbleIntervalMin: { min: 5, max: 240, type: 'int' },
};

export function getTownSettings() {
  return { ...config.town };
}

export function updateTownSettings(patch = {}) {
  const applied = {};
  for (const [key, spec] of Object.entries(TOWN_SETTING_FIELDS)) {
    if (patch[key] === undefined) continue;
    let v = spec.type === 'int' ? parseInt(patch[key], 10) : parseFloat(patch[key]);
    if (Number.isNaN(v)) continue;
    v = Math.max(spec.min, Math.min(spec.max, v));
    config.town[key] = v;
    applied[key] = v;
  }
  if (Object.keys(applied).length > 0) {
    // 存当前生效的全部字段，保证下次启动完整恢复
    const snapshot = {};
    for (const key of Object.keys(TOWN_SETTING_FIELDS)) snapshot[key] = config.town[key];
    try {
      getDb().prepare(`
        INSERT INTO system_settings (setting_key, setting_value) VALUES ('town_settings', ?)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
      `).run(JSON.stringify(snapshot));
    } catch (err) {
      console.warn('[town] persist settings failed:', err?.message);
    }
    // tick 间隔变更即时生效
    if (applied.tickSeconds && state.timer) {
      clearInterval(state.timer);
      state.timer = setInterval(tick, config.town.tickSeconds * 1000);
    }
  }
  return { ok: true, applied };
}

/** 重新初始化世界：清地图/POI/居民（相遇历史保留），走向导 */
export function resetWorld() {
  const db = getDb();
  db.exec("UPDATE town_characters SET home_location_id = NULL");
  db.exec('UPDATE town_npcs SET home_location_id = NULL');
  db.exec('DELETE FROM town_npc_chat_messages');
  db.exec('DELETE FROM town_npcs');
  db.exec('DELETE FROM town_locations');
  db.exec('DELETE FROM town_agent_state');
  db.exec('DELETE FROM town_maps');
  db.exec("UPDATE town_players SET sprite_asset_id = NULL, grid_x = NULL, grid_y = NULL WHERE id = 'me'");
  state.map = null;
  state.locations = [];
  state.agents.clear();
  state.meta.clear();
  state.occupied.clear();
  state.encounters.clear();
  return { ok: true };
}
