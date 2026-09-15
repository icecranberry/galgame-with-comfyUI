import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw Error(`travel fixture forbids network: ${url}`); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const { addClient, removeClient } = await import('../src/services/unifiedStreamBus.js');

test('出行协议：校验、幂等、并发只成功一次、SSE 回执与坐标分图落库', async t => {
  let now = Date.parse('2026-09-08T10:00:00+08:00');
  t.mock.method(Date, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false,
    playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });

  const db = getDb();
  const grid = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  const mkMap = name => saveMap({ create: true, name, cols: 8, rows: 8,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [
      { key: 'plaza', name: '广场', x: 0, y: 0, radius: 3 },
      { key: 'tea', name: '茶棚', x: 6, y: 6, radius: 1 },
    ] });
  const { mapId: mapA } = mkMap('老镇');
  const { mapId: mapB } = mkMap('海边的镇');
  const { mapId: mapC } = mkMap('还没建好的镇');
  // 未建成：出行目录里在，但不接受出行
  db.prepare(`UPDATE town_maps SET status = 'planning' WHERE id = ?`).run(mapC);
  createNpc({ mapId: mapB, displayName: '渡口老板娘', job: '掌柜',
    routine: [{ start: '00:00', end: '24:00', locationKey: 'plaza', activity: '看店' }] });
  db.prepare("INSERT INTO town_players (id, display_name, grid_x, grid_y, map_id) VALUES ('me', '玩家', 1, 1, ?)")
    .run(mapA);

  town.startTownScheduler();
  t.after(() => { town.stopTownScheduler(); closeDb(); t.mock.restoreAll(); t.mock.timers.reset(); });
  town.touchTownViewer();   // 页面在线，聚焦口径成立

  const frames = [];
  const client = { write: payload => frames.push(payload) };
  addClient(client);
  t.after(() => removeClient(client));

  const rev0 = town.getTownMaps().playerRevision;
  assert.equal(town.isMapFocused(mapA), true, '玩家所在图 = 聚焦图');
  assert.equal(town.isMapFocused(mapB), false, '后台图不聚焦');

  // 目录：未建成的图也在列表里，但状态可判
  const catalog = town.getTownMaps();
  assert.deepEqual(catalog.maps.map(m => [m.name, m.status]),
    [['老镇', 'ready'], ['海边的镇', 'ready'], ['还没建好的镇', 'planning']]);

  // 目的地不存在 / 未建成 / 已经在目的地
  assert.equal(town.travelPlayer({ targetMapId: 9999 }).code, 'MAP_NOT_FOUND');
  assert.equal(town.travelPlayer({ targetMapId: mapC }).code, 'MAP_NOT_READY');
  const stay = town.travelPlayer({ targetMapId: mapA });
  assert.equal(stay.ok, true);
  assert.equal(stay.alreadyThere, true);
  assert.equal(town.getTownMaps().playerRevision, rev0, '原地不动不发新修订号');

  // 过期世界 / 过期场景修订号都拒绝
  assert.equal(town.travelPlayer({ targetMapId: mapB, worldId: 'not-this-world' }).code, 'STALE_WORLD');
  const stale = town.travelPlayer({ targetMapId: mapB, expectedPlayerRevision: rev0 + 99 });
  assert.equal(stale.code, 'PLAYER_SCENE_CHANGED');
  assert.equal(town.getTownMaps().playerRevision, rev0);

  // 并发出行：同一修订号只成功一次，后到的拿到 PLAYER_SCENE_CHANGED
  const first = town.travelPlayer({ targetMapId: mapB, expectedPlayerRevision: rev0 });
  const second = town.travelPlayer({ targetMapId: mapA, expectedPlayerRevision: rev0 });
  assert.equal(first.ok, true);
  assert.equal(first.mapId, mapB);
  assert.equal(first.playerRevision, rev0 + 1);
  assert.equal(second.code, 'PLAYER_SCENE_CHANGED');
  assert.equal(town.getTownMaps().currentMapId, mapB, '后到的请求不能把玩家拽回去');

  // 聚焦随之翻转
  assert.equal(town.isMapFocused(mapB), true);
  assert.equal(town.isMapFocused(mapA), false);

  // SSE：玩家级事件带目标图与新修订号，客户端据此换场
  const frame = frames.find(f => f.startsWith('event: town_player_map_changed'));
  assert.ok(frame, '出游事件必须推给前端');
  const payload = JSON.parse(frame.split('\ndata: ')[1]);
  assert.equal(payload.mapId, mapB);
  assert.equal(payload.playerRevision, rev0 + 1);
  assert.equal(typeof payload.worldId, 'string', '玩家级事件仍带世界范围，跨世界时不误用');
  assert.equal(payload.worldEpoch, town.getTownState(mapB).worldEpoch);

  // 落点：新图内的可行走格，且老镇的坐标原样留在老镇那张快照里
  const stateB = town.getTownState(mapB);
  assert.equal(stateB.mapId, mapB);
  assert.equal(stateB.player.agentKey, 'me');
  assert.ok(stateB.player.x >= 0 && stateB.player.x < 8 && stateB.player.y >= 0 && stateB.player.y < 8);
  assert.equal(town.getTownState(mapA).player, null);

  const snapA = db.prepare(`SELECT * FROM town_agent_state WHERE agent_key = 'me' AND map_id = ?`).get(mapA);
  const snapB = db.prepare(`SELECT * FROM town_agent_state WHERE agent_key = 'me' AND map_id = ?`).get(mapB);
  assert.equal(snapA.grid_x, 1, '离开前把老镇坐标落盘');
  assert.equal(snapA.grid_y, 1);
  assert.ok(snapB, '抵达新图后立刻写下新图坐标');
  assert.equal(db.prepare("SELECT map_id FROM town_players WHERE id = 'me'").get().map_id, mapB);
  assert.equal(town.getTownState(mapB).playerRevision, rev0 + 1);

  // 幂等重试：拿到回执后再点一次不会重复搬动
  const retry = town.travelPlayer({ targetMapId: mapB, expectedPlayerRevision: rev0 + 1 });
  assert.equal(retry.ok, true);
  assert.equal(retry.alreadyThere, true);
  assert.equal(town.getTownMaps().playerRevision, rev0 + 1);
});
