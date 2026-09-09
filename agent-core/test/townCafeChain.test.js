import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { migrateTownEconomySchema } from '../src/db/townEconomySchema.js';
import { migrateTownBusinessSchema } from '../src/db/townBusinessSchema.js';
import { migrateTownServiceSessionSchema } from '../src/db/townServiceSessionSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { createEconomyService } from '../src/services/town/economyService.js';
import { createTownBusinessService } from '../src/services/town/townBusinessService.js';
import { createTownOrderService } from '../src/services/town/townOrderService.js';
import { createTownCafeService, CAFE_SERVICE, CAFE_WORK_SERVICE } from '../src/services/town/townCafeService.js';

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Network forbidden'); });
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY AUTOINCREMENT,character_id INTEGER,town_enabled INTEGER DEFAULT 1);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    INSERT INTO town_npcs(id) VALUES(1),(2),(3),(4);`);
  migrateTownSchema(db); migrateTownActionSchema(db); migrateTownEconomySchema(db);
  migrateTownBusinessSchema(db); migrateTownServiceSessionSchema(db);
  const registry = createTownActorRegistry(db);
  let time = 1000;
  const clock = { now: () => time };
  const world = registry.getWorldState();
  let scope = { worldId: world.worldId, worldEpoch: world.epoch };
  const playerId = registry.resolveAgentKey('me').actorId;
  const arrivals = new Map();
  const locations = new Set(['board', 'source', 'workshop', 'cafe']);
  const position = {
    getLocation: ({ locationKey }) => locations.has(locationKey) ? { locationKey } : null,
    hasArrived: ({ worldId, worldEpoch, actorId, locationKey }) => {
      const point = arrivals.get(actorId);
      return !!point && point.worldId === worldId && point.worldEpoch === worldEpoch
        && !point.moving && point.locationKey === locationKey;
    },
    isServiceOpen: () => true,
  };
  const economy = createEconomyService({ db, clock, getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor });
  const dependencies = { db, clock, registry, economy, position };
  const business = createTownBusinessService(dependencies);
  const orders = createTownOrderService(dependencies);
  const getCafe = requestedScope => {
    const slice = business.getSlice(requestedScope);
    if (!slice.cafe) throw Object.assign(new Error('CAFE_NOT_CONFIGURED'), { code: 'CAFE_NOT_CONFIGURED' });
    return { accountId: slice.accounts.cafe, stockId: slice.cafe.stockId,
      actorId: slice.cafe.actorId, locationKey: slice.cafe.locationKey };
  };
  const cafe = createTownCafeService({ ...dependencies, getCafe });
  let counter = 0;
  const cmd = (fields = {}) => ({ ...scope, idempotencyKey: `request-${++counter}`, sourceKey: `source-${counter}`, ...fields });
  const setupInput = () => cmd({ npcActorIds: { commissioner: registry.resolveAgentKey(-1).actorId,
    supplier: registry.resolveAgentKey(-2).actorId, workshop: registry.resolveAgentKey(-3).actorId,
    cafe: registry.resolveAgentKey(-4).actorId },
  locationKeys: { board: 'board', supplier: 'source', workshop: 'workshop', cafe: 'cafe' } });
  const arrive = (actorId, locationKey, moving = false) => arrivals.set(actorId, { ...scope, locationKey, moving });
  const act = (method, order, extra = {}) => orders[method](cmd({ orderId: order.orderId,
    actorId: playerId, expectedVersion: order.version, ...extra })).order;
  const account = id => economy.getAccount({ ...scope, accountId: id });
  const stock = id => economy.getStock({ ...scope, stockId: id });
  const snapshot = () => ['economy_accounts','town_resource_stocks','economy_reservations','economy_transactions',
    'economy_entries','town_resource_entries','town_domain_events','town_business_log','town_delivery_orders',
    'town_business_receipts','town_business_requests','town_service_sessions','town_service_settlements']
    .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
  return { db, registry, clock, position, economy, business, orders, cafe, cmd, setupInput, arrive, act,
    account, stock, snapshot, playerId, locations, get scope() { return scope; }, setEpoch: epoch => { scope = { ...scope, worldEpoch: epoch }; }, setTime: value => { time = value; } };
}

test('cafe slice coexists with workshop and never reseeds on repeat setup', t => {
  const f = fixture(t);
  const input = f.setupInput();
  const slice = f.business.setup(input);
  assert.equal(f.account(slice.accounts.player).balance, 0);
  assert.equal(slice.functionalBuildings[0].businessKey, 'cafe');
  assert.equal(f.account(slice.accounts.cafe).balance, 600);
  assert.equal(f.stock(slice.cafe.supplierStockId).quantity, 20);
  assert.equal(f.stock(slice.cafe.stockId).quantity, 8);
  assert.equal(f.stock(slice.stocks.supplier).quantity, 20);
  assert.equal(f.stock(slice.stocks.workshop).quantity, 0);
  const before = f.snapshot();
  assert.deepEqual(f.business.setup(input), slice);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.account(slice.accounts.cafe).balance, 600);
  assert.deepEqual(f.db.pragma('foreign_key_check'), []);
});

test('cafe delivery pays from cafe budget and moves beans into cafe stock only', t => {
  const f = fixture(t), slice = f.business.setup(f.setupInput());
  let order = f.orders.publish(f.cmd({ businessKey: 'cafe' })).order;
  assert.equal(order.businessKey, 'cafe');
  assert.equal(f.account(slice.accounts.cafe).reserved, 30);
  assert.equal(f.stock(slice.cafe.supplierStockId).reserved, 1);
  f.arrive(f.playerId, 'board'); order = f.act('accept', order);
  f.arrive(f.playerId, 'source'); order = f.act('pickup', order);
  f.arrive(f.playerId, 'cafe'); order = f.act('complete', order);
  assert.equal(order.status, 'completed');
  assert.equal(f.account(slice.accounts.player).balance, 30);
  assert.equal(f.account(slice.accounts.cafe).balance, 570);
  assert.equal(f.account(slice.accounts.fund).balance, 2000);
  assert.equal(f.stock(slice.cafe.supplierStockId).quantity, 19);
  assert.equal(f.stock(slice.cafe.stockId).quantity, 9);
  assert.equal(f.stock(slice.stocks.workshop).quantity, 0);
  assert.equal(f.stock(slice.stocks.supplier).quantity, 20);
  assert.equal(f.db.prepare('SELECT SUM(remaining) n FROM economy_reservations').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM town_business_log WHERE order_id=?').get(order.orderId).n, 4);
  const event = f.db.prepare('SELECT envelope FROM town_domain_events WHERE type=? ORDER BY seq DESC LIMIT 1').get('town.delivery.changed');
  assert.equal(JSON.parse(event.envelope).locationKey, 'cafe');
  // Workshop line still uses the public fund and remains untouched by cafe cargo.
  let workshop = f.orders.publish(f.cmd()).order;
  f.arrive(f.playerId, 'board'); workshop = f.act('accept', workshop);
  f.arrive(f.playerId, 'source'); workshop = f.act('pickup', workshop);
  f.arrive(f.playerId, 'workshop'); workshop = f.act('complete', workshop);
  assert.equal(f.account(slice.accounts.fund).balance, 1970);
  assert.equal(f.stock(slice.stocks.workshop).quantity, 1);
});

test('fixed cafe service consumes one bean, settles 18 coins and writes no item receipt', t => {
  const f = fixture(t), slice = f.business.setup(f.setupInput());
  let order = f.orders.publish(f.cmd({ businessKey: 'cafe' })).order;
  f.arrive(f.playerId, 'board'); order = f.act('accept', order);
  f.arrive(f.playerId, 'source'); order = f.act('pickup', order);
  f.arrive(f.playerId, 'cafe'); order = f.act('complete', order);
  assert.equal(f.account(slice.accounts.player).balance, 30);

  f.arrive(slice.cafe.actorId, 'cafe'); f.arrive(f.playerId, 'cafe');
  const offered = f.cafe.offer(f.cmd({ actorId: f.playerId }));
  assert.equal(offered.status, 'offered');
  const accepted = f.cafe.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  assert.equal(accepted.status, 'active');
  assert.equal(f.account(slice.accounts.player).reserved, 0);
  assert.equal(f.stock(slice.cafe.stockId).reserved, 1);
  const served = f.cafe.turn(f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId,
    expectedVersion: accepted.version, clientTurnId: 'serve-touch', intentKey: 'serve' }));
  assert.equal(served.status, 'completed');
  assert.equal(served.settlement.status, 'completed');
  assert.deepEqual(served.settlement.itemIds, []);
  assert.equal(served.settlement.paid, 18);
  assert.equal(served.settlement.payout, 18);
  assert.equal(served.settlement.refund, 0);
  assert.equal(f.account(slice.accounts.player).balance, 12);
  assert.equal(f.account(slice.accounts.cafe).balance, 588);
  assert.equal(f.stock(slice.cafe.stockId).quantity, 8);
  assert.equal(f.stock(slice.cafe.stockId).reserved, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM town_domain_events WHERE type='town.service.settled'").get().n, 1);
  assert.equal(f.db.prepare('SELECT SUM(balance) n FROM economy_accounts').get().n, 0);
});

test('cafe cancel before serving refunds all and restores bean reservation', t => {
  const f = fixture(t), slice = f.business.setup(f.setupInput());
  f.arrive(slice.cafe.actorId, 'cafe'); f.arrive(f.playerId, 'cafe');
  f.economy.seed({ ...f.scope, accountId: f.account(slice.accounts.player).accountId, amount: 20, seedVersion: 2,
    idempotencyKey: 'test-seed-player', sourceKey: 'test-seed-player', reasonCode: 'test.seed' });
  const offered = f.cafe.offer(f.cmd({ actorId: f.playerId }));
  const accepted = f.cafe.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  assert.equal(f.account(slice.accounts.player).balance, 2);
  const cancelled = f.cafe.cancel(f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId, expectedVersion: accepted.version }));
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.settlement.status, 'cancelled');
  assert.equal(cancelled.settlement.refund, 18);
  assert.equal(f.account(slice.accounts.player).balance, 20);
  assert.equal(f.stock(slice.cafe.stockId).quantity, 8);
  assert.equal(f.stock(slice.cafe.stockId).reserved, 0);
  assert.equal(f.db.prepare('SELECT SUM(remaining) n FROM economy_reservations').get().n, 0);
});

test('cafe work shift pays the player from cafe-held escrow after one finished turn', t => {
  const f = fixture(t), slice = f.business.setup(f.setupInput());
  f.arrive(slice.cafe.actorId, 'cafe'); f.arrive(f.playerId, 'cafe');
  const offered = f.cafe.offer(f.cmd({ actorId: f.playerId, serviceKey: CAFE_WORK_SERVICE.key }));
  assert.equal(offered.serviceKey, CAFE_WORK_SERVICE.key);
  const accepted = f.cafe.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  assert.equal(f.account(slice.accounts.cafe).balance, 576);
  assert.equal(f.account(slice.accounts.player).balance, 0);
  const served = f.cafe.turn(f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId,
    expectedVersion: accepted.version, clientTurnId: 'shift-done', intentKey: 'serve' }));
  assert.equal(served.status, 'completed');
  assert.equal(served.settlement.paid, 0);
  assert.equal(served.settlement.payout, 24);
  assert.equal(served.settlement.refund, 0);
  assert.equal(f.account(slice.accounts.player).balance, 24);
  assert.equal(f.account(slice.accounts.cafe).balance, 576);
  assert.equal(f.stock(slice.cafe.stockId).quantity, 7);
  assert.equal(f.stock(slice.cafe.stockId).reserved, 0);
  assert.equal(f.db.prepare('SELECT SUM(balance) n FROM economy_accounts').get().n, 0);
});

test('cafe work shift cancel returns the held wage to the cafe, not the player', t => {
  const f = fixture(t), slice = f.business.setup(f.setupInput());
  f.arrive(slice.cafe.actorId, 'cafe'); f.arrive(f.playerId, 'cafe');
  const offered = f.cafe.offer(f.cmd({ actorId: f.playerId, serviceKey: CAFE_WORK_SERVICE.key }));
  const accepted = f.cafe.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  const cancelled = f.cafe.cancel(f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId, expectedVersion: accepted.version }));
  assert.equal(cancelled.settlement.status, 'cancelled');
  assert.equal(cancelled.settlement.refund, 24);
  assert.equal(f.account(slice.accounts.player).balance, 0);
  assert.equal(f.account(slice.accounts.cafe).balance, 600);
  assert.equal(f.stock(slice.cafe.stockId).quantity, 8);
  assert.equal(f.db.prepare('SELECT SUM(remaining) n FROM economy_reservations').get().n, 0);
});
