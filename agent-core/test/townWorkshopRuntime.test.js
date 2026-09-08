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

test('真实运行层：配送收入消费工坊，重复回合只发一份背包物品且重建保留', async t => {
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
  const providerId = db.prepare('SELECT id FROM town_npcs ORDER BY id DESC LIMIT 1').get().id;
  db.prepare('UPDATE town_npcs SET home_location_id = (SELECT id FROM town_locations WHERE key = ?) WHERE id = ?').run('workshop', providerId);
  db.prepare('INSERT INTO town_agent_state (agent_key, grid_x, grid_y, current_location_id) VALUES (?, 4, 4, (SELECT id FROM town_locations WHERE key = ?))').run(`npc:${providerId}`, 'workshop');
  town.startTownScheduler();
  const state = economy.getTownEconomyState();
  const worldEpoch = state.worldEpoch;
  const command = idempotencyKey => ({ worldEpoch, idempotencyKey });
  const npcs = ['公告员', '备料员', '工坊师傅'].map(name => state.participants.find(a => a.displayName === name).actorId);
  economy.setupTownEconomy({ ...command('setup'), npcActorIds: { commissioner: npcs[0], supplier: npcs[1], workshop: npcs[2] },
    locationKeys: { board: 'board', supplier: 'supplier', workshop: 'workshop' } });
  const { inviteNpcAsCharacter } = await import('../src/services/town/townNpcService.js');
  const linkedProvider = await inviteNpcAsCharacter(providerId);
  assert.equal(linkedProvider.actorId, npcs[2]);
  assert.equal(economy.getTownWallet().balance, 0);
  let order = economy.executeTownOrder('publish', null, command('publish')).order;
  const act = (name, key = name) => economy.executeTownOrder(name, order.orderId, { ...command(key), expectedVersion: order.version });
  order = act('accept').order;
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
  // The provider is also required to be physically at the workshop.
  const { createTownActionRunner } = await import('../src/services/town/townActionRunner.js');
  const context = economy.getTownEconomyContext();
  const runner = createTownActionRunner({ db, clock: { now: Date.now },
    getWorldEpoch: context.registry.getWorldEpoch, getActor: context.registry.getActor,
    readFacts: action => ({ actorId: action.actorId, worldEpoch, allowsAction: true,
      targetExists: true, arrived: true, locationKey: 'workshop' }) });
  let work = runner.create({ ...context.scope, actorId: npcs[2], type: 'work_shift', target: 'workshop',
    payload: { durationMs: 900000 }, idempotencyKey: 'work-create' });
  work = runner.reserve({ ...context.scope, actionId: work.id, expectedVersion: work.version, idempotencyKey: 'work-reserve' });
  work = runner.start({ ...context.scope, actionId: work.id, expectedVersion: work.version, idempotencyKey: 'work-start' });
  const offered = await economy.executeTownService('offer', null, command('offer'));
  let session = await economy.executeTownService('accept', offered.sessionId,
    { ...command('service-accept'), expectedVersion: offered.version });
  assert.equal(runner.get(work.id).phase, 'cancelled');
  assert.equal(town.getTownState().agents.find(a => a.actorId === npcs[2]).busyReason, 'SERVICE_BUSY');
  assert.equal(economy.getTownWallet().balance, 0);
  for (const intentKey of ['choose_theme', 'confirm_materials', 'craft', 'deliver']) {
    const request = { ...command(`service-${intentKey}`), expectedVersion: session.version, intentKey };
    session = await economy.executeTownService('turn', session.sessionId, request);
    assert.deepEqual(await economy.executeTownService('turn', session.sessionId, request), session);
  }
  assert.equal(session.status, 'completed');
  assert.equal(session.settlement.payout, 30);
  assert.equal(session.settlement.itemIds.length, 1);
  economy.maintainTownOrders();
  const experiences = db.prepare('SELECT * FROM town_experiences').all();
  assert.equal(experiences.length, 4);
  economy.maintainTownOrders();
  assert.equal(db.prepare('SELECT count(*) n FROM town_experiences').get().n, 4);
  assert.equal(db.prepare("SELECT count(*) n FROM memory_fragments WHERE conversation_id = ? AND status = 'active'").get(`char_${linkedProvider.characterId}`).n, 2);
  const itemId = session.settlement.itemIds[0];
  const item = db.prepare('SELECT * FROM backpack_items WHERE id = ?').get(itemId);
  assert.equal(item.source_type, 'service');
  assert.equal(item.owner_key, 'me');
  assert.equal(item.effect_key, 'mood_fix');
  assert.equal(item.status, 'ready');
  assert.ok(item.collected_at);
  const { useItem } = await import('../src/services/itemService.js');
  const characterId = db.prepare('SELECT id FROM characters ORDER BY id LIMIT 1').get().id;
  assert.equal(useItem(itemId, characterId, { expectedVersion: item.version }).ok, true);
  assert.equal(useItem(itemId, characterId).ok, false);
  assert.equal(db.prepare('SELECT dominant_emotion FROM emotion_snapshots WHERE conversation_id = ?').get(`char_${characterId}`).dominant_emotion, 'joy');
  const reset = town.resetWorld();
  assert.equal(reset.worldEpoch, worldEpoch + 1);
  assert.equal(economy.getTownWallet().balance, 0);
  assert.equal(db.prepare('SELECT status FROM backpack_items WHERE id = ?').get(itemId).status, 'used');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM economy_reservations WHERE remaining > 0').get().n, 0);
});
