import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => {
  if (String(url).endsWith('/object_info')) return { ok: true, json: async () => ({}) };
  throw new Error('Network forbidden in delivery fixture');
};
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const economy = await import('../src/services/town/townEconomyRuntime.js');

test('真实运行层：零余额领取配送、走完路径后取货/交付、30邻币只到账一次', t => {
  let now = Date.parse('2026-09-08T10:00:00+08:00');
  t.mock.method(Date, 'now', () => now);
  const db = getDb();
  config.features.town = true; config.features.townLLM = false;
  config.town.simulation = 'legacy'; config.town.economyEnabled = false;
  config.town.playerSpeed = 1; config.town.maxActiveEncounters = 0;
  t.after(() => { town.stopTownScheduler(); closeDb(); });
  const grid = () => Array.from({ length: 6 }, () => Array(6).fill(null));
  const { mapId } = saveMap({ name: '配送fixture', cols: 6, rows: 6,
    layers: { ground: grid(), road: grid(), objects: [] }, locations: [
      { key: 'board', name: '公告站', x: 0, y: 0, radius: 0 },
      { key: 'supplier', name: '原料点', x: 4, y: 0, radius: 0 },
      { key: 'workshop', name: '工坊', x: 4, y: 4, radius: 0 },
    ] });
  for (const name of ['公告员', '备料员', '工坊师傅']) createNpc({ mapId, displayName: name });
  db.prepare("INSERT INTO town_players (id, display_name, grid_x, grid_y) VALUES ('me', '玩家', 0, 0)").run();
  town.startTownScheduler();
  const state = economy.getTownEconomyState();
  const worldEpoch = state.worldEpoch;
  const command = idempotencyKey => ({ worldEpoch, idempotencyKey });
  const npcs = state.participants.map(a => a.actorId);
  economy.setupTownEconomy({ ...command('setup'), npcActorIds: { commissioner: npcs[0], supplier: npcs[1], workshop: npcs[2] },
    locationKeys: { board: 'board', supplier: 'supplier', workshop: 'workshop' } });
  assert.equal(economy.getTownWallet().balance, 0);
  let order = economy.executeTownOrder('publish', null, command('publish')).order;
  const act = (name, key = name) => economy.executeTownOrder(name, order.orderId, { ...command(key), expectedVersion: order.version });
  order = act('accept').order;
  config.town.economyEnabled = false;
  assert.throws(() => economy.executeTownOrder('publish', null, command('disabled-publish')), { code: 'ECONOMY_DISABLED' });
  assert.equal(economy.getTownWallet().balance, 0);
  assert.throws(() => act('pickup'), { code: 'NOT_ARRIVED' });
  assert.equal(town.movePlayerTo(4, 0).ok, true);
  now += 3999;
  assert.throws(() => act('pickup'), { code: 'NOT_ARRIVED' });
  now += 1;
  order = act('pickup').order;
  assert.equal(order.status, 'picked_up');
  assert.equal(economy.getTownWallet().balance, 0);
  assert.equal(town.movePlayerTo(4, 4).ok, true);
  now += 3999;
  assert.throws(() => act('complete'), { code: 'NOT_ARRIVED' });
  now += 1;
  const request = { ...command('complete'), expectedVersion: order.version };
  const completed = economy.executeTownOrder('complete', order.orderId, request);
  assert.equal(completed.order.status, 'completed');
  assert.deepEqual(economy.executeTownOrder('complete', order.orderId, request), completed);
  assert.equal(economy.getTownWallet().balance, 30);
  const reset = town.resetWorld();
  assert.equal(reset.worldEpoch, worldEpoch + 1);
  assert.equal(economy.getTownWallet().balance, 30);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM economy_reservations WHERE remaining > 0').get().n, 0);
});
