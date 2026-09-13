import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw Error(`stroll rest fixture forbids network: ${url}`); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');

test('居民游走到站后停留 60 秒再启程', async t => {
  let now = Date.parse('2026-09-08T10:00:00+08:00');
  t.mock.method(Date, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false,
    playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });

  const db = getDb();
  const grid = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  const { mapId } = saveMap({ name: 'stroll rest fixture', cols: 8, rows: 8,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [
      { key: 'plaza', name: '广场', x: 0, y: 0, radius: 0 },
      { key: 'cafe', name: '咖啡馆', x: 7, y: 0, radius: 0 },
      { key: 'shop', name: '杂货铺', x: 7, y: 7, radius: 0 },
    ] });
  createNpc({ mapId, displayName: '闲逛的阿慢' });
  const npcId = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
  db.prepare('INSERT INTO town_agent_state(agent_key,grid_x,grid_y) VALUES(?,?,?)').run(`npc:${npcId}`, 0, 0);

  town.startTownScheduler();
  t.after(() => { town.stopTownScheduler(); closeDb(); t.mock.restoreAll(); t.mock.timers.reset(); });

  const agentOf = () => town.getTownState().agents.find(a => a.agentKey === `npc:${npcId}`);
  const tick = (ms = 0) => { now += ms; town.forceTick(); return agentOf(); };

  // 起步：首个时间桶按兵不动，之后几个桶内应出现游走路径
  let agent = tick();
  assert.equal(agent.path.length, 0, '入场首个时间桶不应立即起步');
  let steps = 0;
  while (!(agent.path.length > 0) && steps++ < 6) agent = tick(30_000);
  assert.ok(agent.path.length > 0, '游走目标应在几个时间桶内出现');
  const firstTarget = agent.locationId;

  // 到站：等路径走完
  steps = 0;
  while (agent.path.length > 0 && steps++ < 24) agent = tick(5_000);
  assert.equal(agent.path.length, 0, '应在限定时间内到站');
  assert.equal(agent.locationId, firstTarget);
  const arrivedAt = now;

  // 停留 60 秒：期间任何一拍都不应再次起步
  while (now < arrivedAt + 55_000) {
    agent = tick(5_000);
    assert.equal(agent.path.length, 0, '停留期内不应再次起步');
    assert.equal(agent.locationId, firstTarget, '停留期内目标不应变化');
  }

  // 停留结束后启程，且新目标是不同地点
  steps = 0;
  while (agent.path.length === 0 && steps++ < 8) agent = tick(10_000);
  assert.ok(agent.path.length > 0, '停留结束后应再次启程');
  assert.notEqual(agent.locationId, firstTarget, '新目标应是不同地点');
});
