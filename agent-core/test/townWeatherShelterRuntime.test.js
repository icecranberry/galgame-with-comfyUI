import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
process.env.TZ = 'UTC';
globalThis.fetch = async url => {
  if (String(url).endsWith('/object_info')) return { ok: true, json: async () => ({}) };
  throw new Error('Network forbidden in shelter fixture');
};
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { createTownWeatherShelter, shelterRuleKey, isIdleScheduleActivity } = await import('../src/services/town/townWeatherShelter.js');
const schedules = await import('../src/services/scheduleManager.js');
const { getWeatherSourceKey } = await import('../src/services/weatherSource.js');

function fixture(t, { homeKind = 'home', bound = true, routine = [], unreachable = false, linked = false,
  time = '10:00', nightOwl = false } = {}) {
  let now = Date.parse(`2026-09-08T${time}:00+08:00`);
  const forecastAt = now;
  t.mock.method(Date, 'now', () => now);
  config.features.town = true; config.features.townLLM = false; config.features.weather = true;
  Object.assign(config.town, { timeZone: 'Asia/Shanghai', simulation: 'rules', economyEnabled: false,
    npcSpeed: 1, maxActiveEncounters: 0, tickSeconds: 60 });
  const db = getDb();
  t.after(() => { town.stopTownScheduler(); schedules.invalidateAllCache(); closeDb(); });
  const grid = () => Array.from({ length: 6 }, () => Array(6).fill(null));
  const { mapId } = saveMap({ name: 'shelter fixture', cols: 6, rows: 6,
    layers: { ground: grid(), road: grid(), objects: [],
      ...(unreachable ? { blockOverride: Array.from({ length: 6 }, (_, y) => Array(6).fill(y === 2 ? 1 : null)) } : {}) }, locations: [
      { key: 'square', name: '广场', kind: 'outdoor', x: 0, y: 0, radius: 0 },
      { key: 'my-home', name: '自己的家', kind: homeKind, x: 4, y: 4, radius: 0 },
      { key: 'other-home', name: '另一处家', kind: 'home', x: 5, y: 4, radius: 0 },
    ] });
  const home = db.prepare("SELECT id FROM town_locations WHERE key='my-home'").get().id;
  const npc = createNpc({ mapId, displayName: '避雨居民', routine, traits: { nightOwl }, homeLocationId: bound ? home : null });
  let characterId = null;
  if (linked) {
    characterId = Number(db.prepare("INSERT INTO characters(name,display_name,base_prompt) VALUES('shelter_char','关联避雨居民','fixture')").run().lastInsertRowid);
    db.prepare('UPDATE town_npcs SET character_id=? WHERE id=?').run(characterId, npc.id);
    db.prepare('INSERT INTO town_characters(character_id,town_enabled,home_location_id) VALUES(?,1,?)').run(characterId, bound ? home : null);
  }
  const agentKey = linked ? `char:${characterId}` : `npc:${npc.id}`;
  db.prepare(`INSERT INTO town_agent_state(agent_key,grid_x,grid_y,current_location_id)
    VALUES(?,0,0,(SELECT id FROM town_locations WHERE key='square'))`).run(agentKey);
  const cache = (text = '小雨', at = forecastAt) => {
    db.prepare('DELETE FROM weather_hourly').run();
    db.prepare(`INSERT INTO weather_hourly(weather_time,weather_text,temperature,forecast_at,fetched_at,source_key)
      VALUES('10:00',?,'温暖',?,?,?)`).run(text, at, now, getWeatherSourceKey(config.weather.city));
  };
  cache(); town.startTownScheduler();
  const initial = town.getTownState();
  const actorId = initial.agents.find(a => a.agentKey === agentKey).actorId;
  const scope = { worldId: initial.worldId, worldEpoch: initial.worldEpoch };
  const read = () => town.getTownState().agents.find(a => a.agentKey === agentKey);
  const actions = () => db.prepare('SELECT * FROM town_actions WHERE actor_id=? ORDER BY rowid').all(actorId);
  return { db, home, npc, characterId, actorId, scope, forecastAt, read, actions, cache,
    tick(ms = 1000) { now += ms; town.forceTick(); },
    get now() { return now; },
    remaining() { return createTownWeatherShelter({ db }).remaining({ ...scope, actorId, forecastAt }); },
    reach() { for (let i = 0; i < 10 && !actions().some(a => a.type === 'wait' && a.rule_key === shelterRuleKey(forecastAt)); i++) this.tick(10000);
      assert.ok(actions().some(a => a.type === 'wait' && a.status === 'running' && a.rule_key === shelterRuleKey(forecastAt))); },
  };
}

test('rules rain walks home then waits at most 15m, no refill or money/items', t => {
  const f = fixture(t);
  const before = f.db.prepare('SELECT count(*) AS n FROM economy_transactions').get().n;
  const moving = f.read();
  assert.ok(moving.path.length > 0);
  assert.equal(moving.x, 0); assert.equal(moving.y, 0);
  assert.equal(f.actions().filter(a => a.type === 'wait').length, 0);
  f.reach();
  assert.equal(f.read().x, 4); assert.equal(f.read().y, 4);
  for (let i = 0; i < 16; i++) f.tick(60000);
  assert.equal(f.remaining(), 0);
  for (let i = 0; i < 3; i++) f.tick(60000);
  assert.equal(f.actions().filter(a => a.type === 'wait' && a.rule_key === shelterRuleKey(f.forecastAt)).length, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM economy_transactions').get().n, before);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM backpack_items WHERE source_type='service'").get().n, 0);
});

test('cancel after 14m, change home, reload and resume only remaining forecast budget', t => {
  const f = fixture(t); f.reach();
  for (let i = 0; i < 14; i++) f.tick(60000);
  f.cache('晴'); f.tick(1);
  assert.ok(f.remaining() > 0 && f.remaining() <= 60000);
  const left = f.remaining();
  f.db.prepare("UPDATE town_npcs SET home_location_id=(SELECT id FROM town_locations WHERE key='other-home') WHERE id=?").run(f.npc.id);
  f.cache(); town.reloadTown();
  for (let i = 0; i < 4; i++) f.tick(60000);
  assert.equal(f.remaining(), 0);
  const waits = f.actions().filter(a => a.type === 'wait' && a.rule_key === shelterRuleKey(f.forecastAt));
  assert.equal(waits.length, 2);
  assert.ok(waits[1].due_at - waits[1].started_at <= left);
  assert.equal(waits[1].target, 'other-home');
  const next = f.forecastAt + 3600000;
  f.cache('小雨', next); f.tick(next - f.now + 1000);
  for (let i = 0; i < 3; i++) f.tick(60000);
  assert.ok(f.actions().some(a => a.rule_key === shelterRuleKey(next)));
});

test('weather invalidation cancels moving shelter and releases its claim', t => {
  const f = fixture(t);
  const move = f.actions().find(a => a.type === 'move_to');
  f.cache('雨天建议'); f.tick(1);
  assert.equal(f.db.prepare('SELECT status FROM town_actions WHERE id=?').get(move.id).status, 'cancelled');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM town_resource_claims WHERE action_id=?').get(move.id).n, 0);
  assert.equal(f.read().path.length, 0);
});

test('existing idle routine and subsequent work take priority over rain shelter', t => {
  const f = fixture(t, { routine: [{ start: '00:00', end: '24:00', locationKey: 'square', activity: '原有任务' }] });
  f.tick();
  assert.equal(f.actions().some(a => a.rule_key.startsWith('town.weather.shelter:')), false);
  f.db.prepare('UPDATE town_npcs SET routine_json=? WHERE id=?').run('[]', f.npc.id);
  town.reloadTown(); f.reach();
  f.db.prepare('UPDATE town_npcs SET routine_json=? WHERE id=?').run(JSON.stringify([
    { start: '00:00', end: '24:00', locationKey: 'square', actionType: 'work_shift', activity: '原工作' },
  ]), f.npc.id);
  town.reloadTown(); f.tick();
  assert.equal(f.actions().filter(a => a.rule_key.startsWith('town.weather.shelter:')).every(a => ['cancelled','completed','failed'].includes(a.status)), true);
});

for (const options of [{ bound: false }, { homeKind: 'place' }]) test(`no inferred home: ${JSON.stringify(options)}`, t => {
  const f = fixture(t, options); f.tick();
  assert.equal(f.actions().some(a => a.rule_key.startsWith('town.weather.shelter:')), false);
});

test('home wrong-map or removed cancels own route without borrowing another home', t => {
  const f = fixture(t);
  f.db.prepare('UPDATE town_npcs SET home_location_id=NULL WHERE id=?').run(f.npc.id);
  f.tick();
  assert.equal(f.actions().filter(a => a.rule_key.startsWith('town.weather.shelter:')).every(a => a.status === 'cancelled'), true);
  f.db.prepare('UPDATE town_npcs SET home_location_id=? WHERE id=?').run(f.home, f.npc.id);
  const map = f.db.prepare('SELECT * FROM town_maps LIMIT 1').get();
  const columns = Object.keys(map).filter(key => key !== 'id');
  const otherMap = f.db.prepare(`INSERT INTO town_maps(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`)
    .run(...columns.map(key => map[key])).lastInsertRowid;
  f.db.prepare('UPDATE town_locations SET map_id=? WHERE id=?').run(otherMap, f.home);
  town.reloadTown(); f.tick();
  assert.equal(f.read().path.length, 0);
});

test('reload with expired lease never completes offline shelter; reset clears old claims', t => {
  const f = fixture(t); f.reach();
  town.stopTownScheduler();
  f.tick(20 * 60000); // scheduler stopped; elapsed time is not a completed action
  town.startTownScheduler(); f.tick();
  const waits = f.actions().filter(a => a.type === 'wait' && a.rule_key === shelterRuleKey(f.forecastAt));
  assert.equal(waits[0].status, 'failed');
  assert.equal(waits[0].failure_reason, 'LEASE_EXPIRED');
  const reset = town.resetWorld();
  assert.equal(reset.worldEpoch, f.scope.worldEpoch + 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM town_resource_claims WHERE world_epoch=?').get(f.scope.worldEpoch).n, 0);
  assert.equal(createTownWeatherShelter({ db: f.db }).remaining({ ...f.scope, worldEpoch: reset.worldEpoch, actorId: f.actorId, forecastAt: f.forecastAt }), 900000);
});

test('unreachable home uses runner backoff without starting or spending wait budget', t => {
  const f = fixture(t, { unreachable: true });
  const first = f.actions().find(a => a.rule_key === shelterRuleKey(f.forecastAt));
  assert.equal(first.status, 'failed');
  assert.equal(first.failure_reason, 'PATH_UNREACHABLE');
  for (let i = 0; i < 10; i++) f.tick(1);
  assert.equal(f.actions().filter(a => a.rule_key === shelterRuleKey(f.forecastAt)).length, 1);
  assert.equal(f.remaining(), 900000);
  assert.equal(f.read().path.length, 0);
});

test('home kind mutation cancels immediately without waiting for map reload', t => {
  const f = fixture(t);
  f.db.prepare("UPDATE town_locations SET kind='place' WHERE id=?").run(f.home);
  f.tick();
  assert.equal(f.actions().filter(a => a.rule_key === shelterRuleKey(f.forecastAt)).every(a => a.status === 'cancelled'), true);
  assert.equal(f.read().path.length, 0);
});

test('budget reader is query-only and uses the actor/rule/type history index', t => {
  const f = fixture(t); f.reach();
  const query = f.db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM town_actions WHERE world_id=? AND world_epoch=?
    AND actor_id=? AND type='wait' AND rule_key=?`).all(f.scope.worldId, f.scope.worldEpoch, f.actorId, shelterRuleKey(f.forecastAt));
  assert.ok(query.some(row => /SEARCH.*town_actions_actor_rule_type/.test(row.detail)));
  const before = f.db.prepare('SELECT total_changes() AS n').get().n;
  f.db.pragma('query_only=ON');
  assert.equal(f.remaining(), 0, 'unresolved owner reserves its allowance');
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n, before);
  f.db.pragma('query_only=OFF');
});

test('linked character without schedule uses own membership home, never NPC fallback', t => {
  const f = fixture(t, { linked: true }); f.reach();
  assert.equal(f.read().kind, 'char');
  assert.equal(f.read().x, 4);
  f.db.prepare('UPDATE town_characters SET home_location_id=NULL WHERE character_id=?').run(f.characterId);
  f.tick();
  assert.equal(f.actions().filter(a => a.rule_key === shelterRuleKey(f.forecastAt)).every(a => ['completed','cancelled'].includes(a.status)), true);
  assert.equal(f.db.prepare('SELECT home_location_id FROM town_npcs WHERE id=?').get(f.npc.id).home_location_id, f.home);
});

test('global rules works with economy enabled for unrelated idle residents; legacy cancels shelter', t => {
  const f = fixture(t);
  config.town.economyEnabled = true;
  f.reach();
  config.town.simulation = 'legacy';
  f.tick();
  assert.equal(f.actions().filter(a => a.rule_key === shelterRuleKey(f.forecastAt)).every(a => ['completed','cancelled'].includes(a.status)), true);
});

for (const [time, nightOwl, allowed] of [['23:00', false, false], ['05:59', false, false],
  ['06:00', false, true], ['23:00', true, true]]) test(`shelter respects default rest eligibility ${time} owl=${nightOwl}`, t => {
  const f = fixture(t, { time, nightOwl });
  f.tick();
  assert.equal(f.actions().some(a => a.rule_key === shelterRuleKey(f.forecastAt)), allowed);
});

test('only explicit free-time sentinel is task-free; malformed activities remain protected', () => {
  const idle = { activity: '自由时间', location: '未知', replyDelay: 0, snapshotPrompt: '',
    description: '没有特定安排，自由支配时间', startTime: '', endTime: '', tags: ['idle'] };
  assert.equal(isIdleScheduleActivity(null), true);
  assert.equal(isIdleScheduleActivity(idle), true);
  for (const value of [undefined, {}, { activity: '已安排任务' }, { ...idle, startTime: undefined },
    { ...idle, activity: '预约' }, { ...idle, tags: ['work'] }, { ...idle, startTime: '10:00' }]) {
    assert.equal(isIdleScheduleActivity(value), false);
  }
});

test('malformed terminal timestamp cannot refund shelter allowance', t => {
  const f = fixture(t); f.reach();
  f.tick(60000); f.cache('晴'); f.tick();
  const wait = f.actions().find(a => a.type === 'wait' && a.rule_key === shelterRuleKey(f.forecastAt));
  assert.equal(wait.status, 'cancelled');
  f.db.prepare('UPDATE town_actions SET updated_at=started_at-1 WHERE id=?').run(wait.id);
  f.db.pragma('query_only=ON');
  assert.equal(f.remaining(), 0);
  f.db.pragma('query_only=OFF');
});

test('256-character home target works with bounded schedule key; rename cancels and oversized key is excluded', t => {
  const f = fixture(t);
  const longKey = 'h'.repeat(256);
  f.db.prepare('UPDATE town_locations SET key=? WHERE id=?').run(longKey, f.home);
  town.reloadTown();
  for (let i = 0; i < 8; i++) f.tick(10000);
  const wait = f.actions().find(a => a.type === 'wait' && a.target === longKey && a.status === 'running');
  assert.ok(wait, 'legal long target reaches home and starts wait');
  const state = JSON.parse(f.db.prepare('SELECT state_json FROM town_simulation_state WHERE actor_id=?').get(f.actorId).state_json);
  assert.ok(state.plan.scheduleKey.length <= 256);
  assert.equal(state.plan.target, longKey);
  const renamed = 'r'.repeat(256);
  f.db.prepare('UPDATE town_locations SET key=? WHERE id=?').run(renamed, f.home);
  town.reloadTown(); f.tick();
  assert.equal(f.db.prepare('SELECT status FROM town_actions WHERE id=?').get(wait.id).status, 'cancelled');
  for (let i = 0; i < 4; i++) f.tick(60000);
  assert.ok(f.actions().some(a => a.target === renamed && a.rule_key === shelterRuleKey(f.forecastAt)));
  const oversized = 'x'.repeat(257);
  f.db.prepare('UPDATE town_locations SET key=? WHERE id=?').run(oversized, f.home);
  town.reloadTown(); f.tick();
  assert.equal(f.actions().some(a => a.target === oversized), false);
  assert.equal(f.actions().filter(a => a.rule_key === shelterRuleKey(f.forecastAt))
    .every(a => ['completed','cancelled','failed'].includes(a.status)), true);
});

test('city source change preserves actual NPC default night sleep while forecast is unknown', t => {
  const f = fixture(t, { time: '23:00' });
  const previous = config.weather.city;
  t.after(() => { config.weather.city = previous; });
  config.town.simulation = 'legacy';
  config.weather.city = '上海'; f.cache(); f.tick();
  assert.equal(town.getTownState().weather.status, 'known');
  assert.equal(f.read().sleeping, true);
  config.weather.city = '北京'; f.tick();
  assert.equal(town.getTownState().weather.reason, 'SOURCE_MISMATCH');
  assert.equal(town.getTownState().weather.hour, 23);
  assert.equal(f.read().sleeping, true);
  f.cache(); f.tick();
  assert.equal(town.getTownState().weather.status, 'known');
  assert.equal(f.read().sleeping, true);
});

for (const phase of ['moving', 'waiting']) test(`same-hour rainy city replacement cancels ${phase} without a mismatch read or budget refill`, t => {
  const previous = config.weather.city;
  config.weather.city = '上海';
  t.after(() => { config.weather.city = previous; });
  const f = fixture(t);
  if (phase === 'waiting') {
    f.reach();
    for (let i = 0; i < 14; i++) f.tick(60000);
  }
  const old = f.actions().find(a => a.status === 'running' && a.rule_key === shelterRuleKey(f.forecastAt));
  assert.equal(old.type, phase === 'waiting' ? 'wait' : 'move_to');
  const planBefore = JSON.parse(f.db.prepare('SELECT state_json FROM town_simulation_state WHERE actor_id=?').get(f.actorId).state_json).plan;
  assert.ok(planBefore.scheduleKey.includes(getWeatherSourceKey('上海')));
  config.weather.city = '北京';
  f.cache('小雨', f.forecastAt); // No tick/read between configuration and matching replacement cache.
  f.tick(1);
  assert.equal(f.db.prepare('SELECT status FROM town_actions WHERE id=?').get(old.id).status, 'cancelled');
  const left = f.remaining();
  assert.ok(left > 0 && left <= (phase === 'waiting' ? 60000 : 900000));
  assert.equal(town.getTownState().weather.status, 'known');
  for (let i = 0; i < 3; i++) f.tick(10000);
  const newWait = f.actions().find(a => a.type === 'wait' && a.status === 'running' && a.id !== old.id);
  assert.ok(newWait);
  assert.equal(newWait.rule_key, old.rule_key);
  assert.ok(newWait.due_at - newWait.started_at <= left);
  const planAfter = JSON.parse(f.db.prepare('SELECT state_json FROM town_simulation_state WHERE actor_id=?').get(f.actorId).state_json).plan;
  assert.ok(planAfter.scheduleKey.includes(getWeatherSourceKey('北京')));
  assert.ok(planAfter.scheduleKey.length <= 256);
  assert.notEqual(planAfter.scheduleKey, planBefore.scheduleKey);
  for (let i = 0; i < 16; i++) f.tick(60000);
  assert.equal(f.remaining(), 0);
  const waits = f.actions().filter(a => a.type === 'wait' && a.rule_key === old.rule_key);
  const total = waits.reduce((sum, a) => sum + Math.max(0, Math.min(a.updated_at, a.due_at) - a.started_at), 0);
  assert.equal(total, 900000);
});
