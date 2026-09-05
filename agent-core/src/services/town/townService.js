/**
 * AI 小镇核心服务
 *
 * 分层（详见 docs 计划 ai-town-plan.md）：
 *   L0 确定性移动：日程 → 地点别名匹配 → A* 寻路 → 服务端推进 + 广播意图（无 LLM）
 *   L1 规则触发：  同地点 + 距离 + 关系/情绪/冷却 → 生成 encounter（无 LLM）
 *   L2 LLM 事件：  相遇对话气泡、批量状态短语（独立串行队列，永不挤占聊天）
 *   L3 记忆回写：  encounter 摘要 → memory_fragments（复用记忆管线）
 *
 * 状态原则：服务端权威 + 内存为准；坐标只在换目标/换活动时落库，
 * 进程重启后由「日程 + 当前时刻」重建（town_agent_state 仅是恢复快照）。
 */
import { getDb } from '../../db/index.js';
import { config } from '../../config.js';
import { chatSync } from '../../llm/llm-client.js';
import { getCurrentActivity, isSleeping } from '../scheduleManager.js';
import { buildCharacterPersona } from '../characterPersona.js';
import { applyMemoryActions } from '../memory/memoryRepository.js';
import { getWeatherContext } from '../weatherService.js';
import { ensureTownSeed, buildWalkGrid } from './townSeed.js';
import { buildLocationMatcher } from './townLocationMatch.js';
import { findPath, isWalkable, pickStandingCell } from './townPathfinding.js';
import {
  broadcastTownMove, broadcastTownBubble,
  broadcastTownEncounterStart, broadcastTownEncounterEnd, broadcastTownPing,
} from './townBus.js';

const state = {
  running: false,
  timer: null,
  map: null,             // { id, name, imagePath, cols, rows, walkGrid }
  locations: [],         // [{ id, key, name, aliases, kind, x, y, radius, ambient }]
  matcher: null,
  agents: new Map(),     // charId -> agent
  charMeta: new Map(),   // charId -> { id, name, displayName, avatarPath, standingUrl, basePrompt, shortPrompt }
  relationships: new Set(),   // 'min:max'（有 relationship_text 的无向对）
  moods: new Map(),      // charId -> { valence, arousal, dominantEmotion, updatedAt }
  encounters: new Map(), // id -> encounter
  pairCooldown: new Map(),   // 'min:max' -> 可再次相遇的时间戳
  occupied: new Map(),   // 'x,y' -> charId（NPC 目标站立格占用）
  player: null,          // { id: 'me', displayName, x, y, path, speed, moveStartedAt }
  lastBubbleBatchAt: 0,
  lastMoodRefreshAt: 0,
  lastEncounterStartAt: 0,
  llmChain: Promise.resolve(),  // L2 串行队列：同一时刻最多一个 LLM 调用在跑
};

// ── 工具 ──

function pairKey(a, b) {
  return `${Math.min(a, b)}:${Math.max(a, b)}`;
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

// ── 启动 / 状态装载 ──

export function startTownScheduler() {
  if (!config.features.town) {
    console.log('[town] feature disabled, scheduler skipped');
    return;
  }
  if (state.running) return;
  ensureTownSeed();
  loadState();
  state.running = true;

  // 首拍延后几秒：等 app.js 里日程管理器完成初始化
  setTimeout(() => { if (state.running) tick(); }, 5000);
  state.timer = setInterval(tick, config.town.tickSeconds * 1000);
  console.log(`[town] scheduler started (tick=${config.town.tickSeconds}s, agents=${state.agents.size})`);
}

export function stopTownScheduler() {
  state.running = false;
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  persistAllAgents();
}

function loadState() {
  const db = getDb();

  const mapRow = db.prepare('SELECT * FROM town_maps ORDER BY id LIMIT 1').get();
  if (!mapRow) throw new Error('[town] no town_maps row — seed failed');
  let walkGrid;
  try { walkGrid = JSON.parse(mapRow.walk_grid || '[]'); } catch { walkGrid = []; }
  if (!Array.isArray(walkGrid) || walkGrid.length === 0) {
    walkGrid = buildWalkGrid(mapRow.grid_cols, mapRow.grid_rows);
  }
  state.map = {
    id: mapRow.id, name: mapRow.name, imagePath: mapRow.image_path || null,
    cols: mapRow.grid_cols, rows: mapRow.grid_rows, walkGrid,
  };

  state.locations = db.prepare('SELECT * FROM town_locations WHERE map_id = ? ORDER BY id').all(mapRow.id)
    .map(row => ({
      id: row.id, key: row.key, name: row.name,
      aliases: safeParseArray(row.aliases_json),
      kind: row.kind, x: row.grid_x, y: row.grid_y,
      radius: row.radius, ambient: row.ambient || '',
    }));
  state.matcher = buildLocationMatcher(state.locations);

  // 角色元数据
  state.charMeta.clear();
  for (const row of db.prepare(`
    SELECT c.id, c.name, c.display_name, c.avatar_path, c.standing_url, c.base_prompt, c.short_prompt
    FROM town_characters tc JOIN characters c ON c.id = tc.character_id
    WHERE tc.town_enabled = 1
  `).all()) {
    state.charMeta.set(row.id, {
      id: row.id, name: row.name,
      displayName: row.display_name || row.name,
      avatarPath: row.avatar_path || null,
      standingUrl: row.standing_url || null,
      basePrompt: row.base_prompt || '',
      shortPrompt: row.short_prompt || '',
    });
  }

  // 关系（无向对）
  state.relationships.clear();
  for (const row of db.prepare(`
    SELECT from_character_id, to_character_id FROM character_relationships
    WHERE relationship_text IS NOT NULL AND TRIM(relationship_text) != ''
  `).all()) {
    state.relationships.add(pairKey(row.from_character_id, row.to_character_id));
  }

  // 冷却：最近一段时间的 done 相遇重建（进程重启不重置冷却）
  state.pairCooldown.clear();
  const cooldownCutoff = Date.now() - config.town.encounterCooldownHours * 3600_000;
  for (const row of db.prepare(`
    SELECT char_a, char_b, ended_at, created_at FROM town_encounters
    WHERE status IN ('done','cancelled') AND COALESCE(ended_at, created_at) >= ?
  `).all(new Date(cooldownCutoff).toISOString().slice(0, 19).replace('T', ' '))) {
    const endTs = toEpochSeconds(row.ended_at || row.created_at) * 1000;
    state.pairCooldown.set(pairKey(row.char_a, row.char_b), endTs + config.town.encounterCooldownHours * 3600_000);
  }

  // agent 状态恢复
  state.agents.clear();
  state.occupied.clear();
  const homeLoc = getLocationByKey('apartment') || state.locations[0];
  const saved = new Map(
    db.prepare('SELECT * FROM town_agent_state').all().map(r => [r.character_id, r])
  );
  for (const charId of state.charMeta.keys()) {
    const agent = {
      charId,
      x: null, y: null,
      path: null, speed: config.town.npcSpeed, moveStartedAt: 0,
      targetLocId: null, slotKey: null,
      activityText: '', sleeping: false,
      encounterId: null,
      bubble: null,
      dirty: false,
    };
    const s = saved.get(charId);
    if (s && Number.isInteger(s.grid_x) && Number.isInteger(s.grid_y) && isWalkable(state.map.walkGrid, s.grid_x, s.grid_y)) {
      agent.x = s.grid_x; agent.y = s.grid_y;
      agent.activityText = s.activity_text || '';
      agent.targetLocId = s.current_location_id || null;
      state.occupied.set(`${agent.x},${agent.y}`, charId);
      agent.slotKey = `${agent.x},${agent.y}`;
    } else if (homeLoc) {
      // 无快照 → 直接安置在家附近（首拍 refreshActivity 会纠正目标）
      const cell = pickStandingCell(state.map.walkGrid, state.occupied, { x: homeLoc.x, y: homeLoc.y }, homeLoc.radius) || { x: homeLoc.x, y: homeLoc.y };
      agent.x = cell.x; agent.y = cell.y;
      agent.targetLocId = homeLoc.id;
      state.occupied.set(`${cell.x},${cell.y}`, charId);
      agent.slotKey = `${cell.x},${cell.y}`;
    }
    state.agents.set(charId, agent);
  }

  // 玩家
  const pRow = db.prepare(`SELECT * FROM town_players WHERE id = 'me'`).get();
  state.player = {
    id: 'me',
    displayName: pRow?.display_name || config.user.nickname || '我',
    x: pRow?.grid_x ?? 20, y: pRow?.grid_y ?? 15,
    path: null, speed: config.town.playerSpeed, moveStartedAt: 0,
  };

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

function safeParseArray(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function getLocationByKey(key) {
  return state.locations.find(l => l.key === key) || null;
}

function getHomeLocation(charId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT tl.* FROM town_characters tc JOIN town_locations tl ON tl.id = tc.home_location_id
    WHERE tc.character_id = ?
  `).get(charId);
  if (row) return state.locations.find(l => l.id === row.id) || null;
  return getLocationByKey('apartment');
}

/** 日程地点匹配不到地图时的稳定去处：charId 散列到 广场(50%) / 公园(30%) / 家(20%) */
function fallbackHangout(charId) {
  const h = charId % 10;
  if (h < 5) return getLocationByKey('plaza');
  if (h < 8) return getLocationByKey('park');
  return getHomeLocation(charId) || getLocationByKey('plaza');
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
  if (agent.slotKey) {
    const cur = state.occupied.get(agent.slotKey);
    if (cur === agent.charId) state.occupied.delete(agent.slotKey);
    agent.slotKey = null;
  }

  const cell = pickStandingCell(state.map.walkGrid, state.occupied, { x: loc.x, y: loc.y }, loc.radius)
    || { x: loc.x, y: loc.y };
  state.occupied.set(`${cell.x},${cell.y}`, agent.charId);
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
    charId: agent.charId,
    from,
    path: path || [],
    speed: agent.speed,
    startedAt: now,
  });
}

function refreshAgentActivity(agent, now) {
  const meta = state.charMeta.get(agent.charId);
  if (!meta) return;

  let sleeping = false;
  let act = null;
  try {
    const sleepState = isSleeping(agent.charId, now);
    sleeping = !!sleepState.sleeping;
    act = getCurrentActivity(agent.charId, now);
    if (act && act.replyDelay === -1) sleeping = true;
  } catch { /* 日程系统异常时按自由活动处理 */ }

  agent.sleeping = sleeping;

  let loc = null;
  if (sleeping) {
    loc = getHomeLocation(agent.charId);
    agent.activityText = '睡得正香';
  } else if (act) {
    // 匹配不到地图的日程地点（架空场所）→ 按角色稳定散到 广场/公园/家，避免全员聚在一处
    loc = state.matcher(act.location) || fallbackHangout(agent.charId);
    agent.activityText = act.activity || agent.activityText || '自由时间';
  } else {
    loc = fallbackHangout(agent.charId);
    if (!agent.activityText) agent.activityText = '自由时间';
  }

  // 相遇中：站在原地聊天，不换目标
  if (agent.encounterId !== null) return;
  if (loc && loc.id !== agent.targetLocId) {
    assignTarget(agent, loc, now);
  } else if (loc && agent.path === null && Math.random() < 0.08) {
    // 同一地点的小游走：低概率换个站立位，让小镇看起来"活着"
    assignTarget(agent, loc, now);
  }
}

// ── L1 相遇规则 ──

function scanEncounters(now) {
  if (state.encounters.size >= config.town.maxActiveEncounters) return;
  // 全局节流：两场相遇至少间隔 N 分钟，控制 LLM 成本
  if (now - (state.lastEncounterStartAt ?? 0) < config.town.encounterMinStartGapMin * 60_000) return;

  // 按 POI 分组（仅统计已到站的角色）
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

        const key = pairKey(a.charId, b.charId);
        if ((state.pairCooldown.get(key) ?? 0) > now) continue;

        const related = state.relationships.has(key);
        let prob = related ? config.town.encounterRelatedProb : config.town.encounterStrangerProb;
        const moodA = state.moods.get(a.charId);
        const moodB = state.moods.get(b.charId);
        // 高唤醒/负效价 → 性格化的"今天不太想说话"
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
  ).run(state.map.id, a.charId, b.charId, loc.id, 'chatting');

  const enc = {
    id: Number(result.lastInsertRowid),
    a: a.charId, b: b.charId,
    locationId: loc.id, location: loc,
    messages: [],           // [{ speakerCharId, content, at }]
    startedAt: now,
    endAt: Infinity,        // 对话生成完才定
    timeouts: [],
  };
  state.encounters.set(enc.id, enc);
  a.encounterId = enc.id;
  b.encounterId = enc.id;
  a.dirty = b.dirty = true;
  state.lastEncounterStartAt = now;

  broadcastTownEncounterStart({
    id: enc.id, a: a.charId, b: b.charId,
    locationId: loc.id, gridX: loc.x, gridY: loc.y,
  });
  const nameA = state.charMeta.get(a.charId)?.displayName || `角色${a.charId}`;
  const nameB = state.charMeta.get(b.charId)?.displayName || `角色${b.charId}`;
  console.log(`[town] encounter #${enc.id}: ${nameA} × ${nameB} @ ${loc.name}`);

  enqueueLlm(() => runEncounterDialogue(enc));
}

function endEncounter(enc, now) {
  const db = getDb();
  state.encounters.delete(enc.id);
  for (const t of enc.timeouts) clearTimeout(t);

  for (const charId of [enc.a, enc.b]) {
    const agent = state.agents.get(charId);
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

async function runEncounterDialogue(enc) {
  if (!state.encounters.has(enc.id)) return; // 已被收尾（如重启）
  if (!config.features.townLLM) {
    enc.endAt = Date.now() + 45_000;
    return;
  }

  const metaA = state.charMeta.get(enc.a);
  const metaB = state.charMeta.get(enc.b);
  if (!metaA || !metaB) {
    enc.endAt = Date.now() + 30_000;
    return;
  }

  const weather = getWeatherNote();
  const relLine = describeRelationship(enc.a, enc.b, metaA, metaB);
  const activityA = getActivityLine(enc.a, metaA);
  const activityB = getActivityLine(enc.b, metaB);

  const messages = [
    {
      role: 'system',
      content: [
        '你是小镇的"旁白导演"。小镇里两位角色恰好在同一个地点相遇，你要为他们即兴编写一段 3~6 条的短对话。',
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
        `【A 的设定】${metaA.displayName}`,
        personaText(metaA),
        activityA,
        `【B 的设定】${metaB.displayName}`,
        personaText(metaB),
        activityB,
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
        if (!state.encounters.has(enc.id)) return; // 已收尾
        enc.messages.push({ speakerCharId: speaker, content: text, at });
        try {
          getDb().prepare('INSERT INTO town_chat_messages (encounter_id, speaker_char_id, content) VALUES (?, ?, ?)')
            .run(enc.id, speaker, text);
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
    // 降级：没有对话，两位角色安静地待一会儿
    enc.endAt = Date.now() + 30_000;
  }
}

async function runEncounterSummary(enc) {
  if (!config.features.townLLM || enc.messages.length === 0) return;
  const metaA = state.charMeta.get(enc.a);
  const metaB = state.charMeta.get(enc.b);
  if (!metaA || !metaB) return;

  const transcript = enc.messages
    .map(m => `${(m.speakerCharId === enc.a ? metaA : metaB).displayName}：${m.content}`)
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

    // L3 记忆回写：照常进 memory_fragments，下次相遇的对话 prompt 可检索到
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
    const meta = state.charMeta.get(agent.charId);
    if (!meta) continue;
    candidates.push({
      id: agent.charId,
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
          '    { "id": 1, "text": "（一句话）" },',
          '    { "id": 2, "text": "（一句话）" }',
          '  ]',
          '}',
          '字段约束：id 必须与输入列表的 id 完全一致、一个不落；text 为中文、不超过 20 字、写当前正在做的具体小动作或小念头，符合角色性格与地点、天气，禁止复述活动名称。',
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
      const agent = state.agents.get(Number(item?.id));
      const text = String(item?.text ?? '').trim().slice(0, 30);
      if (!agent || !text || agent.sleeping || agent.encounterId !== null) continue;
      agent.activityText = text;
      agent.dirty = true;
      agent.bubble = { text, until: Date.now() + 14_000 };
      broadcastTownBubble({ charId: agent.charId, text, ttl: 14 });
    }
  });
}

function personaText(meta) {
  try {
    return buildCharacterPersona(meta, { variant: 'full', person: meta.displayName, outfits: 'auto' });
  } catch {
    return meta.shortPrompt || meta.basePrompt || '';
  }
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

function getActivityLine(charId, meta) {
  try {
    const act = getCurrentActivity(charId);
    if (!act) return `${meta.displayName}此刻没有特别安排，在自由活动。`;
    return `${meta.displayName}此刻：【${act.location}】${act.activity}${act.description ? '（' + act.description + '）' : ''}`;
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
      INSERT INTO town_agent_state (character_id, grid_x, grid_y, path_json, current_location_id, activity_text, mood_json, updated_at)
      VALUES (?, ?, ?, '[]', ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(character_id) DO UPDATE SET
        grid_x = excluded.grid_x, grid_y = excluded.grid_y,
        current_location_id = excluded.current_location_id,
        activity_text = excluded.activity_text, mood_json = excluded.mood_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      agent.charId, agent.x, agent.y,
      agent.targetLocId, agent.activityText,
      JSON.stringify(state.moods.get(agent.charId) || null),
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
    if (now - state.lastMoodRefreshAt > 5 * 60_000) refreshMoods();
    for (const agent of state.agents.values()) {
      advanceAgent(agent, now);
      refreshAgentActivity(agent, now);
    }
    advancePlayer(now);
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
    const meta = state.charMeta.get(agent.charId);
    const mood = state.moods.get(agent.charId);
    return {
      characterId: agent.charId,
      displayName: meta?.displayName || `角色${agent.charId}`,
      avatarPath: meta?.avatarPath || null,
      standingUrl: meta?.standingUrl || null,
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
    serverTime: now,
    tickSeconds: config.town.tickSeconds,
    map: {
      name: state.map.name, imagePath: state.map.imagePath,
      cols: state.map.cols, rows: state.map.rows,
    },
    locations: state.locations.map(l => ({
      id: l.id, key: l.key, name: l.name, kind: l.kind, x: l.x, y: l.y, radius: l.radius,
    })),
    agents,
    encountersActive: [...state.encounters.values()].map(e => ({ id: e.id, a: e.a, b: e.b, locationId: e.locationId })),
    player: {
      displayName: state.player.displayName,
      x: state.player.x, y: state.player.y,
      path: state.player.path || [],
      speed: state.player.speed,
      startedAt: state.player.path ? state.player.moveStartedAt : now,
    },
    weather,
  };
}

export function movePlayerTo(x, y) {
  if (!config.features.town) return { ok: false, error: '小镇未启用' };
  x = parseInt(x, 10); y = parseInt(y, 10);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !isWalkable(state.map?.walkGrid || [], x, y)) {
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

export function getEncounterMessages(encounterId) {
  const rows = getDb().prepare(`
    SELECT m.id, m.speaker_char_id AS speakerCharId, m.content, m.created_at AS createdAt
    FROM town_chat_messages m WHERE m.encounter_id = ? ORDER BY m.id
  `).all(encounterId);
  return rows.map(r => {
    const meta = state.charMeta.get(r.speakerCharId);
    return { ...r, speakerName: meta?.displayName || `角色${r.speakerCharId}` };
  });
}

export function setTownCharacterEnabled(characterId, { townEnabled, homeLocationId } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_characters WHERE character_id = ?').get(characterId);
  if (!row) return { ok: false, error: '角色不在小镇名单中' };
  const enabled = townEnabled === undefined ? row.town_enabled : (townEnabled ? 1 : 0);
  const home = homeLocationId === undefined ? row.home_location_id : homeLocationId;
  db.prepare('UPDATE town_characters SET town_enabled = ?, home_location_id = ? WHERE character_id = ?')
    .run(enabled, home, characterId);

  if (enabled) {
    if (!state.charMeta.has(characterId)) {
      const metaRow = db.prepare('SELECT id, name, display_name, avatar_path, standing_url, base_prompt, short_prompt FROM characters WHERE id = ?').get(characterId);
      if (metaRow) {
        state.charMeta.set(metaRow.id, {
          id: metaRow.id, name: metaRow.name,
          displayName: metaRow.display_name || metaRow.name,
          avatarPath: metaRow.avatar_path || null,
          standingUrl: metaRow.standing_url || null,
          basePrompt: metaRow.base_prompt || '',
          shortPrompt: metaRow.short_prompt || '',
        });
        const homeLoc = state.locations.find(l => l.id === home) || getHomeLocation(characterId) || getLocationByKey('plaza');
        const cell = homeLoc ? (pickStandingCell(state.map.walkGrid, state.occupied, { x: homeLoc.x, y: homeLoc.y }, homeLoc.radius) || { x: homeLoc.x, y: homeLoc.y }) : { x: 20, y: 15 };
        state.agents.set(characterId, {
          charId: characterId,
          x: cell.x, y: cell.y, path: null,
          speed: config.town.npcSpeed, moveStartedAt: 0,
          targetLocId: homeLoc?.id ?? null, slotKey: `${cell.x},${cell.y}`,
          activityText: '', sleeping: false, encounterId: null, bubble: null, dirty: false,
        });
        state.occupied.set(`${cell.x},${cell.y}`, characterId);
        broadcastTownMove({ charId: characterId, from: { x: cell.x, y: cell.y }, path: [], speed: config.town.npcSpeed, startedAt: Date.now() });
      }
    }
  } else if (state.agents.has(characterId)) {
    const agent = state.agents.get(characterId);
    if (agent.encounterId !== null) {
      const enc = state.encounters.get(agent.encounterId);
      if (enc) endEncounter(enc, Date.now());
    }
    if (agent.slotKey && state.occupied.get(agent.slotKey) === characterId) state.occupied.delete(agent.slotKey);
    state.agents.delete(characterId);
    broadcastTownEncounterEnd({ id: -1, removed: characterId });
  }
  return { ok: true };
}

export function listTownCharacters() {
  return [...state.charMeta.values()].map(m => {
    const agent = state.agents.get(m.id);
    return {
      id: m.id, displayName: m.displayName, avatarPath: m.avatarPath,
      locationName: agent ? state.locations.find(l => l.id === agent.targetLocId)?.name || null : null,
      activityText: agent?.activityText || '',
      townEnabled: !!agent,
    };
  });
}

/** 调试用：手动触发一拍 */
export function forceTick() {
  if (!state.running) return { ok: false, error: 'town scheduler not running' };
  tick();
  return { ok: true };
}

/** 供 town_bubble 之外的途径更新气泡（预留） */
export function setAgentBubble(charId, text, ttlMs) {
  const agent = state.agents.get(charId);
  if (!agent) return;
  agent.bubble = { text, until: Date.now() + ttlMs };
}
