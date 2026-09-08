import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
process.env.TZ = 'UTC';
globalThis.fetch = async url => {
  if (String(url).endsWith('/object_info')) return { ok: true, json: async () => ({}) };
  throw new Error('Network forbidden in timezone fixture');
};
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');

function fixture(t, time, { routine = [], nightOwl = false } = {}) {
  let now = Date.parse(`2026-09-08T${time}:00+08:00`);
  t.mock.method(Date, 'now', () => now);
  t.mock.method(Math, 'random', () => 0.1);
  config.features.town = true;
  config.features.townLLM = false;
  config.features.weather = false;
  Object.assign(config.town, { timeZone: 'Asia/Shanghai', simulation: 'legacy', economyEnabled: false,
    npcSpeed: 1, maxActiveEncounters: 0, tickSeconds: 3600 });
  const db = getDb();
  t.after(() => { town.stopTownScheduler(); closeDb(); });
  const grid = () => Array.from({ length: 6 }, () => Array(6).fill(null));
  const { mapId } = saveMap({ name: 'timezone fixture', cols: 6, rows: 6,
    layers: { ground: grid(), road: grid(), objects: [] }, locations: [
      { key: 'leisure', name: '庭院', kind: 'outdoor', x: 0, y: 0, radius: 0 },
      { key: 'home', name: '家', x: 4, y: 4, radius: 0 },
    ] });
  const home = db.prepare("SELECT id FROM town_locations WHERE key='home'").get().id;
  const npc = createNpc({ mapId, displayName: '时区居民', routine, traits: { nightOwl }, homeLocationId: home });
  const key = `npc:${npc.id}`;
  db.prepare(`INSERT INTO town_agent_state(agent_key,grid_x,grid_y,current_location_id)
    VALUES(?,0,0,(SELECT id FROM town_locations WHERE key='leisure'))`).run(key);
  town.startTownScheduler();
  town.forceTick();
  return { read: () => town.getTownState().agents.find(agent => agent.agentKey === key),
    advance: () => { now += 60000; }, home, hostHour: new Date(now).getHours() };
}

for (const [time, sleeping] of [['00:00', true], ['08:00', false], ['22:59', false],
  ['23:00', true], ['05:59', true], ['06:00', false]]) {
  test(`actual empty-routine NPC uses town ${time} for fallback sleep`, t => {
    const f = fixture(t, time);
    const agent = f.read();
    assert.equal(f.hostHour, (Number(time.slice(0, 2)) + 16) % 24);
    assert.equal(agent.sleeping, sleeping);
    if (sleeping) {
      assert.equal(agent.locationId, f.home);
      assert.ok(agent.path.length > 0, 'night fallback starts real movement home');
      assert.equal(agent.x, 0);
      assert.equal(agent.y, 0);
      f.advance();
      const arrived = f.read();
      assert.equal(arrived.path.length, 0);
      assert.equal(arrived.x, 4);
      assert.equal(arrived.y, 4);
      assert.equal(arrived.sleeping, true);
    }
  });
}

test('existing routine slot takes priority over fallback at town midnight', t => {
  const f = fixture(t, '00:00', { routine: [
    { start: '00:00', end: '24:00', locationKey: 'leisure', activity: '原有夜间作息' },
  ] });
  const agent = f.read();
  assert.equal(agent.sleeping, false);
  assert.equal(agent.activityText, '原有夜间作息');
  assert.notEqual(agent.locationId, f.home);
});

test('nightOwl retains exemption from empty-routine nighttime fallback', t => {
  assert.equal(fixture(t, '00:00', { nightOwl: true }).read().sleeping, false);
});
