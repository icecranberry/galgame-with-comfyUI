import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw Error(`map directory fixture forbids network: ${url}`); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const router = (await import('../src/routes/town.js')).default;

// 地图目录口径：GET /api/town/map 省略 mapId 时必须落在玩家当前那张图上。
// 回归：它曾经退回「世界里 id 最小的那张」，于是玩家站在新镇、NPC 是新镇的、画布还是老镇的
// —— 快照按玩家图取、瓦片载荷按首图取，两边各看一张图。

/** 直接驱动 express router：GET /map 与 PATCH /maps/:id 都是同步 handler，res.json 一次性返回 */
function call(method, url, { body = undefined, query = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, url, body, query };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, payload }); },
    };
    router.handle(req, res, err => (err ? reject(err) : resolve({ status: 404, payload: null })));
  });
}

function startWorld(t) {
  const now = Date.parse('2026-09-15T10:00:00+08:00');
  t.mock.method(Date, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false,
    playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });

  const db = getDb();
  const grid = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  const mkMap = (name, plaza) => saveMap({ create: true, name, cols: 8, rows: 8,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [{ key: 'plaza', name: plaza, x: 0, y: 0, radius: 1 }] });
  const { mapId: oldTown } = mkMap('老镇', '老广场');
  const { mapId: newTown } = mkMap('新镇', '新广场');
  // 玩家在后建的那张图上：画布取图口径出错时，这个排布才会露出来
  db.prepare("INSERT INTO town_players (id, display_name, grid_x, grid_y, map_id) VALUES ('me', '玩家', 0, 0, ?)")
    .run(newTown);

  town.startTownScheduler();
  t.after(() => { town.stopTownScheduler(); closeDb(); t.mock.restoreAll(); t.mock.timers.reset(); });
  return { db, oldTown, newTown };
}

test('地图载荷与场景快照取同一张图：玩家在哪就画哪', async t => {
  const { oldTown, newTown } = startWorld(t);

  const state = await call('GET', '/state');
  assert.equal(state.payload.mapId, newTown);
  assert.equal(state.payload.map.id, newTown, '快照要带 map.id，客户端才不用猜画布画哪张');

  const payload = await call('GET', '/map');
  assert.equal(payload.payload.id, newTown, '省略 mapId = 玩家当前那张图，不是 id 最小那张');
  assert.equal(payload.payload.name, '新镇');

  const explicit = await call('GET', '/map', { query: { mapId: String(oldTown) } });
  assert.equal(explicit.payload.id, oldTown, '显式指定仍然照办（出行预载、编辑器固定图）');
});

test('改名只动名字：图层、POI 与别的镇都不受影响', async t => {
  const { db, oldTown, newTown } = startWorld(t);
  const before = db.prepare('SELECT layers_json, version FROM town_maps WHERE id = ?').get(newTown);
  const beforeLocations = db.prepare('SELECT key, name FROM town_locations WHERE map_id = ? ORDER BY id').all(newTown);
  const oldTownRow = db.prepare('SELECT name, version FROM town_maps WHERE id = ?').get(oldTown);

  const res = await call('PATCH', `/maps/${newTown}`, { body: { name: '  海边的镇  ' } });
  assert.equal(res.status, 200);
  assert.equal(res.payload.name, '海边的镇', '名字去掉首尾空白');

  const after = db.prepare('SELECT name, layers_json, version FROM town_maps WHERE id = ?').get(newTown);
  assert.equal(after.name, '海边的镇');
  assert.equal(after.layers_json, before.layers_json, '图层原样保留');
  assert.equal(after.version, before.version + 1);
  assert.deepEqual(db.prepare('SELECT key, name FROM town_locations WHERE map_id = ? ORDER BY id').all(newTown),
    beforeLocations, 'POI 原样保留');
  assert.deepEqual(db.prepare('SELECT name, version FROM town_maps WHERE id = ?').get(oldTown), oldTownRow, '别的镇不受影响');
  assert.equal(db.prepare("SELECT map_id FROM town_players WHERE id = 'me'").get().map_id, newTown, '改名不搬人');
  // 出行面板读的就是这份目录，改完名字要立刻能看见
  assert.equal(town.getTownMaps().maps.find(m => m.id === newTown).name, '海边的镇');
});

test('改名拒绝空名字与不存在的地图', async t => {
  const { newTown } = startWorld(t);
  assert.equal((await call('PATCH', `/maps/${newTown}`, { body: { name: '   ' } })).status, 400);
  assert.equal((await call('PATCH', `/maps/${newTown}`, { body: {} })).status, 400);
  assert.equal((await call('PATCH', '/maps/99999', { body: { name: '查无此镇' } })).status, 400);
  assert.equal((await call('PATCH', '/maps/abc', { body: { name: '查无此镇' } })).status, 400);
});

test('酒馆角色列表返回角色入住的地图，不使用玩家所在地图', t => {
  const { db, oldTown, newTown } = startWorld(t);
  const characterId = db.prepare('SELECT id FROM characters ORDER BY id LIMIT 1').get().id;
  const readCharacter = () => town.listTownCharacters().find(c => c.id === characterId);
  assert.equal(readCharacter().mapId, null);
  db.prepare('INSERT INTO town_characters (character_id, map_id, town_enabled) VALUES (?, ?, 1)')
    .run(characterId, oldTown);
  assert.equal(readCharacter().mapId, oldTown);
  assert.equal(readCharacter().townEnabled, true);
  db.prepare('UPDATE town_characters SET map_id = ? WHERE character_id = ?').run(newTown, characterId);
  assert.equal(readCharacter().mapId, newTown);
});

test('新建同名小镇自动递增编号，更新已有地图保留名字', t => {
  const { db } = startWorld(t);
  const save = (name, options = { create: true }) => saveMap({ ...options, name, cols: 2, rows: 2,
    layers: { ground: [[null, null], [null, null]] }, assignResponsibilities: false });
  const readName = result => db.prepare('SELECT name FROM town_maps WHERE id = ?').get(result.mapId).name;
  assert.equal(readName(save('新小镇')), '新小镇');
  assert.equal(readName(save('新小镇')), '新小镇-1');
  assert.equal(readName(save('新小镇')), '新小镇-2');
  assert.equal(readName(save('新小镇-1')), '新小镇-3');
  assert.equal(readName(save('  新小镇  ')), '新小镇-4');
  const other = save('海风镇');
  assert.equal(readName(other), '海风镇');
  assert.equal(readName(save('海风镇', { mapId: other.mapId })), '海风镇');
});
