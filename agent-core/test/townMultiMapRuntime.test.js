import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw Error(`multi-map fixture forbids network: ${url}`); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');

test('两张地图同时运行：各自的居民、场景与后续重建互不串', async t => {
  let now = Date.parse('2026-09-08T10:00:00+08:00');
  t.mock.method(Date, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false,
    playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });

  const db = getDb();
  const grid = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  // 两张图用同一批地点 key：迁移后 key 是「图内唯一」，不该互相顶掉
  const mkMap = (name, plazaName, teaName) => saveMap({ create: true, name, cols: 8, rows: 8,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [
      { key: 'plaza', name: plazaName, x: 0, y: 0, radius: 0 },
      { key: 'tea', name: teaName, x: 7, y: 7, radius: 0 },
    ] });
  const { mapId: mapA } = mkMap('老镇', '中央广场', '老茶馆');
  const { mapId: mapB } = mkMap('海边的镇', '渡口', '海边茶棚');
  assert.notEqual(mapA, mapB);

  const npcsOf = { [mapA]: [], [mapB]: [] };
  for (const [mapId, displayName, x, y] of [
    [mapA, '阿甲', 0, 0], [mapA, '阿乙', 1, 0],
    [mapB, '阿丙', 0, 0], [mapB, '阿丁', 1, 0],
  ]) {
    createNpc({ mapId, displayName, job: '居民',
      routine: [{ start: '00:00', end: '24:00', locationKey: 'plaza', activity: '固定岗位' }] });
    const id = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
    db.prepare(`INSERT INTO town_agent_state(agent_key,map_id,grid_x,grid_y,current_location_id)
      VALUES(?,?,?,?,(SELECT id FROM town_locations WHERE key = ? AND map_id = ?))`)
      .run(`npc:${id}`, mapId, x, y, 'plaza', mapId);
    npcsOf[mapId].push(id);
  }
  db.prepare("INSERT INTO town_players (id, display_name, grid_x, grid_y, map_id) VALUES ('me', '玩家', 0, 0, ?)")
    .run(mapA);

  town.startTownScheduler();
  t.after(() => { town.stopTownScheduler(); closeDb(); t.mock.restoreAll(); t.mock.timers.reset(); });

  // 出行目录：两张图都在，玩家在老镇
  const maps = town.getTownMaps();
  assert.deepEqual(maps.maps.map(m => [m.id, m.name, m.status]),
    [[mapA, '老镇', 'ready'], [mapB, '海边的镇', 'ready']]);
  assert.equal(maps.currentMapId, mapA);
  assert.equal(maps.maps.every(m => m.residentCount === 2), true, '居民数按图统计');

  // 场景隔离：每张图的快照只装自己的居民与地点；玩家只出现在自己那张图上
  const stateA = town.getTownState(mapA);
  const stateB = town.getTownState(mapB);
  assert.equal(stateA.map.name, '老镇');
  assert.equal(stateB.map.name, '海边的镇');
  assert.deepEqual(stateA.locations.map(l => l.name), ['中央广场', '老茶馆']);
  assert.deepEqual(stateB.locations.map(l => l.name), ['渡口', '海边茶棚']);
  assert.deepEqual(stateA.agents.map(a => a.npcId).sort(), [...npcsOf[mapA]].sort());
  assert.deepEqual(stateB.agents.map(a => a.npcId).sort(), [...npcsOf[mapB]].sort());
  assert.equal(stateA.player?.agentKey, 'me');
  assert.equal(stateB.player, null, '玩家不在的图上没有玩家实体');

  // 两张图各自动作：同一个时钟推进下都能游走起步
  const walked = { [mapA]: false, [mapB]: false };
  for (let i = 0; i < 8; i++) {
    now += 30_000;
    town.forceTick();
    for (const mapId of [mapA, mapB]) {
      if (town.getTownState(mapId).agents.some(a => a.path.length > 0)) walked[mapId] = true;
    }
    if (walked[mapA] && walked[mapB]) break;
  }
  assert.equal(walked[mapA], true, '老镇的居民在动');
  assert.equal(walked[mapB], true, '后台图的居民照样在跑模拟');

  // 只重建一张图：另一张的场景与居民完全不受影响
  const beforeB = town.getTownState(mapB);
  const beforeA = town.getTownState(mapA);
  assert.equal(town.reloadMap(mapA).ok, true);
  const afterB = town.getTownState(mapB);
  assert.deepEqual(afterB.agents.map(a => [a.npcId, a.locationId]).sort(),
    beforeB.agents.map(a => [a.npcId, a.locationId]).sort());
  assert.deepEqual(afterB.locations.map(l => l.name), beforeB.locations.map(l => l.name));
  const afterA = town.getTownState(mapA);
  assert.deepEqual(afterA.agents.map(a => a.npcId).sort(), beforeA.agents.map(a => a.npcId).sort());

  // 收尾落盘：两张图的快照都各自写在 (agent_key, map_id) 下，不会互相覆盖
  town.stopTownScheduler();
  const snapshots = db.prepare('SELECT agent_key, map_id FROM town_agent_state ORDER BY map_id, agent_key').all();
  const keysByMap = new Map();
  for (const s of snapshots) keysByMap.set(s.map_id, [...(keysByMap.get(s.map_id) || []), s.agent_key]);
  assert.deepEqual([...keysByMap.keys()].sort(), [mapA, mapB].sort());
  assert.equal(keysByMap.get(mapA).length, npcsOf[mapA].length + 1, '老镇：两位居民 + 玩家');
  assert.equal(keysByMap.get(mapB).length, npcsOf[mapB].length);
});