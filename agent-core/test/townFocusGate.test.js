import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw Error(`focus gate fixture forbids network: ${url}`); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');

/**
 * 聚焦闸门 = 「玩家在这张图上」×「小镇页面在线」。
 * 相遇开场、相遇摘要/环境奇遇升级、批量状态气泡是 tick 里仅有的 LLM 演出入口，全都在
 * `tickRuntime` 里被 `isMapFocused(rt.mapId)` 拦住；这里用**同一批居民、同一套触发规则**，
 * 只翻转玩家所在地图，验证后台图的演出计数恒为 0、聚焦图立刻照常开演。
 * （townLLM 关闭是为了测试不碰模型；闸门在 LLM 检查之前，验的是同一道门。）
 */
test('聚焦闸门：同一批居民，只有玩家所在那张图才开演出，后台图计数恒为 0', async t => {
  let now = Date.parse('2026-09-08T10:00:00+08:00');
  t.mock.method(Date, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  const db = getDb();
  // 注意顺序：getDb 会用库里存的设置覆盖 config，测试口径必须在 getDb 之后再定
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false, playerSpeed: 1, npcSpeed: 1,
    maxActiveEncounters: 1, encounterStrangerProb: 1, encounterRelatedProb: 1,
    encounterMinStartGapMin: 0, timeZone: 'Asia/Shanghai' });
  t.after(() => { town.stopTownScheduler(); closeDb(); t.mock.restoreAll(); t.mock.timers.reset(); });

  const grid = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  // 老镇：玩家在这里，只有一位居民，构不成相遇
  const { mapId: mapA } = saveMap({ create: true, name: '老镇', cols: 8, rows: 8,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [{ key: 'plaza', name: '中央广场', x: 0, y: 0, radius: 3 },
      { key: 'tea', name: '老茶馆', x: 6, y: 6, radius: 1 }] });
  // 海边的镇：两位居民钉在同一个广场（图里只有这一个地点，游走没有别的去处）
  const { mapId: mapB } = saveMap({ create: true, name: '海边的镇', cols: 8, rows: 8,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [{ key: 'plaza', name: '渡口广场', x: 0, y: 0, radius: 3 }] });

  createNpc({ mapId: mapA, displayName: '独居的老张', job: '看店的',
    routine: [{ start: '00:00', end: '24:00', locationKey: 'plaza', activity: '看店' }] });
  const loneId = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
  db.prepare(`INSERT INTO town_agent_state(agent_key,map_id,grid_x,grid_y,current_location_id)
    VALUES(?,?,0,0,(SELECT id FROM town_locations WHERE key = 'plaza' AND map_id = ?))`).run(`npc:${loneId}`, mapA, mapA);
  for (const [displayName, x] of [['渡口老板娘', 0], ['修船的小伙', 1]]) {
    createNpc({ mapId: mapB, displayName, job: '居民',
      routine: [{ start: '00:00', end: '24:00', locationKey: 'plaza', activity: '固定岗位' }] });
    const id = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
    db.prepare(`INSERT INTO town_agent_state(agent_key,map_id,grid_x,grid_y,current_location_id)
      VALUES(?,?,?,0,(SELECT id FROM town_locations WHERE key = 'plaza' AND map_id = ?))`).run(`npc:${id}`, mapB, x, mapB);
  }
  db.prepare("INSERT INTO town_players (id, display_name, grid_x, grid_y, map_id) VALUES ('me', '玩家', 0, 1, ?)")
    .run(mapA);

  town.startTownScheduler();
  // 页面在线：前端 15s 一次心跳（服务端 TTL 45s），这里每拍补一次
  const tickWithViewer = (ms = 30_000) => { now += ms; town.touchTownViewer(); town.forceTick(); };

  // ── 阶段一：玩家在老镇，海边的镇是后台图 ──
  town.touchTownViewer();
  assert.equal(town.isMapFocused(mapA), true);
  assert.equal(town.isMapFocused(mapB), false);
  let backgroundEncounters = 0;
  for (let i = 0; i < 10; i++) {
    tickWithViewer();
    backgroundEncounters += town.getTownState(mapB).encountersActive.length;
  }
  assert.equal(backgroundEncounters, 0, '后台图连开十拍也不该出现任何演出');
  assert.equal(town.getTownState(mapB).agents.every(a => a.encounterId === null), true, '后台图居民不被拉进演出');
  assert.equal(town.getTownState(mapB).agents.every(a => a.bubble === null), true, '后台图不发状态气泡');

  // ── 阶段二：玩家出行到海边的镇，同一批居民、同一套规则，立刻照常开演 ──
  const travel = town.travelPlayer({ targetMapId: mapB });
  assert.equal(travel.ok, true);
  assert.equal(town.isMapFocused(mapB), true);
  assert.equal(town.isMapFocused(mapA), false);
  tickWithViewer();
  assert.equal(town.getTownState(mapB).encountersActive.length, 1, '聚焦图第一拍就照常相遇');
  assert.equal(town.getTownState(mapA).encountersActive.length, 0, '老镇降级为后台图后不再开新的演出');

  // ── 阶段三：页面关掉（心跳过期）后，任何图都不再是聚焦图 ──
  now += 46_000;
  assert.equal(town.isMapFocused(mapB), false, '没人看页面时不该再为任何一张图花钱');
  assert.equal(town.isMapFocused(mapA), false);
  town.touchTownViewer();
  assert.equal(town.isMapFocused(mapB), true, '页面回来自动恢复聚焦');
});
