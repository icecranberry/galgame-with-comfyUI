import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { migrateTownEconomySchema } from '../src/db/townEconomySchema.js';
import { migrateTownBusinessSchema } from '../src/db/townBusinessSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { createEconomyService } from '../src/services/town/economyService.js';
import { createTownBusinessService, DELIVERY_SLICE } from '../src/services/town/townBusinessService.js';
import { createTownOrderService } from '../src/services/town/townOrderService.js';

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  t.mock.method(globalThis,'fetch',() => { throw new Error('Network forbidden'); });
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY AUTOINCREMENT,character_id INTEGER,town_enabled INTEGER DEFAULT 1);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    INSERT INTO town_npcs(id) VALUES(1),(2),(3);`);
  migrateTownSchema(db); migrateTownActionSchema(db); migrateTownEconomySchema(db); migrateTownBusinessSchema(db);
  const registry = createTownActorRegistry(db);
  let time = 1000;
  const clock = { now: () => time };
  const world = registry.getWorldState();
  let scope = { worldId: world.worldId,worldEpoch: world.epoch };
  const playerId = registry.resolveAgentKey('me').actorId;
  const arrivals = new Map();
  const locations = new Set(['board','source','workshop']);
  const position = {
    getLocation: ({ locationKey }) => locations.has(locationKey) ? { locationKey } : null,
    hasArrived: ({ worldId,worldEpoch,actorId,locationKey }) => {
      const p = arrivals.get(actorId);
      return !!p && p.worldId === worldId && p.worldEpoch === worldEpoch && !p.moving && p.locationKey === locationKey;
    },
  };
  const economy = createEconomyService({ db,clock,getWorldEpoch: registry.getWorldEpoch,getActor: registry.getActor });
  const dependencies = { db,clock,registry,economy,position };
  const business = createTownBusinessService(dependencies), orders = createTownOrderService(dependencies);
  let counter = 0;
  const cmd = (fields = {}) => ({ ...scope,idempotencyKey: `request-${++counter}`,sourceKey: `source-${counter}`,...fields });
  const setupInput = () => cmd({ npcActorIds: { commissioner: registry.resolveAgentKey(-1).actorId,
    supplier: registry.resolveAgentKey(-2).actorId,workshop: registry.resolveAgentKey(-3).actorId },
  locationKeys: { board: 'board',supplier: 'source',workshop: 'workshop' } });
  const arrive = (locationKey,moving = false) => arrivals.set(playerId,{ ...scope,locationKey,moving });
  const act = (method,order,extra = {}) => orders[method](cmd({ orderId: order.orderId,
    actorId: playerId,expectedVersion: order.version,...extra })).order;
  const account = id => economy.getAccount({ ...scope,accountId: id });
  const stock = id => economy.getStock({ ...scope,stockId: id });
  const snapshot = () => ['economy_accounts','town_resource_stocks','economy_reservations','economy_transactions',
    'economy_entries','town_resource_entries','town_domain_events','town_business_log','town_delivery_orders','town_business_receipts','town_business_requests']
    .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
  return { db,registry,clock,position,economy,business,orders,cmd,setupInput,arrive,act,account,stock,snapshot,playerId,locations,
    get scope() { return scope; }, setEpoch: epoch => { scope = { ...scope,worldEpoch: epoch }; },setTime: value => { time = value; } };
}

test('explicit slice setup is bounded, idempotent and migration is repeatable', t => {
  const f = fixture(t);
  const input = f.setupInput(), slice = f.business.setup(input);
  assert.equal(f.account(slice.accounts.player).balance,0);
  assert.equal(f.account(slice.accounts.fund).balance,2000);
  assert.equal(f.account(slice.accounts.supplier).balance,600);
  assert.equal(f.account(slice.accounts.workshop).balance,400);
  assert.equal(f.stock(slice.stocks.supplier).quantity,20);
  const before = f.snapshot();
  assert.deepEqual(f.business.setup(input),slice);
  migrateTownBusinessSchema(f.db);
  assert.deepEqual(f.snapshot(),before);
  assert.deepEqual(f.business.setup(f.setupInput()),slice);
  assert.equal(f.account(slice.accounts.fund).balance,2000);
  assert.equal(f.db.prepare('SELECT SUM(balance) n FROM economy_accounts').get().n,0);
  assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
});

test('setup requires three distinct real NPCs and current locations, with no partial seeds', t => {
  const f = fixture(t);
  const input = f.setupInput();
  input.npcActorIds.supplier = input.npcActorIds.commissioner;
  assert.throws(() => f.business.setup(input),{ code: 'INVALID_SLICE' });
  const next = f.setupInput(); next.npcActorIds.supplier = f.playerId;
  assert.throws(() => f.business.setup(next),{ code: 'ACTOR_UNAVAILABLE' });
  f.locations.delete('workshop');
  assert.throws(() => f.business.setup(f.setupInput()),{ code: 'LOCATION_UNAVAILABLE' });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM economy_accounts').get().n,0);
});

test('delivery pays only after authoritative board/source/workshop arrival and locked material handoff', t => {
  const f = fixture(t), slice = f.business.setup(f.setupInput());
  let order = f.orders.publish(f.cmd()).order;
  assert.equal(f.account(slice.accounts.fund).reserved,30);
  assert.equal(f.stock(slice.stocks.supplier).reserved,1);
  assert.throws(() => f.act('accept',order,{ x: 1,y: 1,locationKey: 'board' }),{ code: 'NOT_ARRIVED' });
  f.arrive('board',true);
  assert.throws(() => f.act('accept',order),{ code: 'NOT_ARRIVED' });
  f.arrive('board'); order = f.act('accept',order);
  assert.equal(f.account(slice.accounts.player).balance,0);
  assert.throws(() => f.act('complete',order),{ code: 'ORDER_STATE_CONFLICT' });
  assert.throws(() => f.act('pickup',order),{ code: 'NOT_ARRIVED' });
  f.arrive('source'); order = f.act('pickup',order);
  assert.equal(f.stock(slice.stocks.supplier).quantity,19);
  assert.equal(f.stock(order.cargoStockId).quantity,1);
  assert.equal(f.stock(order.cargoStockId).available,0);
  assert.equal(f.account(slice.accounts.player).balance,0);
  assert.throws(() => f.economy.transferStock({ ...f.cmd(),reasonCode: 'test.sale',
    fromStockId: order.cargoStockId,toStockId: slice.stocks.workshop,amount: 1 }),{ code: 'INSUFFICIENT_STOCK' });
  assert.throws(() => f.act('complete',order),{ code: 'NOT_ARRIVED' });
  f.arrive('workshop'); order = f.act('complete',order);
  assert.equal(order.status,'completed');
  assert.equal(f.account(slice.accounts.player).balance,30);
  assert.equal(f.account(slice.accounts.fund).balance,1970);
  assert.equal(f.account(slice.accounts.fund).reserved,0);
  assert.equal(f.stock(order.cargoStockId).quantity,0);
  assert.equal(f.stock(slice.stocks.workshop).quantity,1);
  assert.equal(f.db.prepare('SELECT SUM(remaining) n FROM economy_reservations').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM town_business_log WHERE order_id=?').get(order.orderId).n,4);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM town_domain_events WHERE type='town.delivery.changed'").get().n,4);
  assert.equal(f.db.prepare('SELECT SUM(balance) n FROM economy_accounts').get().n,0);
});

test('idempotency/source retries return original result; changed semantics and stale versions fail', t => {
  const f = fixture(t); f.business.setup(f.setupInput());
  const publish = f.cmd();
  const result = f.orders.publish(publish), order = result.order;
  assert.deepEqual(f.orders.publish(publish),result);
  assert.deepEqual(f.orders.publish({ ...publish,idempotencyKey: 'new-request' }),result);
  f.arrive('board');
  const accept = f.cmd({ orderId: order.orderId,actorId: f.playerId,expectedVersion: order.version });
  const accepted = f.orders.accept(accept);
  assert.deepEqual(f.orders.accept(accept),accepted);
  assert.deepEqual(f.orders.accept({ ...accept,idempotencyKey: 'alternate',expectedVersion: 999 }),accepted);
  assert.throws(() => f.orders.accept({ ...accept,expectedVersion: 999 }),{ code: 'IDEMPOTENCY_CONFLICT' });
  assert.throws(() => f.orders.pickup({ ...accept,idempotencyKey: 'source-collision' }),{ code: 'SOURCE_CONFLICT' });
  assert.throws(() => f.act('pickup',order),{ code: 'VERSION_CONFLICT' });
  f.arrive('source'); const picked = f.act('pickup',accepted.order);
  f.arrive('workshop');
  const complete = f.cmd({ orderId: picked.orderId,actorId: f.playerId,expectedVersion: picked.version });
  const final = f.orders.complete(complete), before = f.snapshot();
  assert.deepEqual(f.orders.complete(complete),final);
  assert.deepEqual(f.snapshot(),before);
  assert.throws(() => f.act('complete',final.order),{ code: 'ORDER_STATE_CONFLICT' });
});

test('cancel before/after pickup returns reservations and materials without paying', t => {
  const f = fixture(t), slice = f.business.setup(f.setupInput());
  for (const pickup of [false,true]) {
    let order = f.orders.publish(f.cmd()).order;
    f.arrive('board'); order = f.act('accept',order);
    if (pickup) { f.arrive('source'); order = f.act('pickup',order); }
    order = f.act('cancel',order);
    assert.equal(order.status,'cancelled');
    assert.equal(f.stock(slice.stocks.supplier).quantity,20);
    assert.equal(f.stock(slice.stocks.supplier).reserved,0);
    assert.equal(f.account(slice.accounts.fund).reserved,0);
    assert.equal(f.account(slice.accounts.player).balance,0);
  }
});

test('expiry denies late delivery and reclaims goods at every active stage', t => {
  const f = fixture(t), slice = f.business.setup(f.setupInput());
  for (const stage of ['open','accepted','picked_up']) {
    let order = f.orders.publish(f.cmd()).order;
    if (stage !== 'open') { f.arrive('board'); order = f.act('accept',order); }
    if (stage === 'picked_up') { f.arrive('source'); order = f.act('pickup',order); }
    assert.throws(() => f.act('expire',order),{ code: 'ORDER_NOT_DUE' });
    f.setTime(order.expiresAt);
    if (stage === 'picked_up') {
      f.arrive('workshop'); assert.throws(() => f.act('complete',order),{ code: 'ORDER_EXPIRED' });
    }
    assert.equal(f.act('expire',order).status,'expired');
    assert.equal(f.stock(slice.stocks.supplier).quantity,20);
    assert.equal(f.account(slice.accounts.fund).reserved,0);
    assert.equal(f.account(slice.accounts.player).balance,0);
  }
});

test('rebuild returns in-transit goods before epoch fence and never reseeds balances/materials', t => {
  const f = fixture(t), slice = f.business.setup(f.setupInput());
  let paid = f.orders.publish(f.cmd()).order;
  f.arrive('board'); paid = f.act('accept',paid);
  f.arrive('source'); paid = f.act('pickup',paid);
  f.arrive('workshop'); paid = f.act('complete',paid);
  let picked = f.orders.publish(f.cmd()).order;
  f.arrive('board'); picked = f.act('accept',picked);
  f.arrive('source'); picked = f.act('pickup',picked);
  f.orders.publish(f.cmd());
  const oldCommand = f.cmd({ orderId: picked.orderId,actorId: f.playerId,expectedVersion: picked.version });
  f.db.transaction(() => {
    assert.equal(f.orders.cancelForRebuild(f.cmd()).orders.length,2);
    f.registry.advanceEpoch({ expectedEpoch: f.scope.worldEpoch });
  })();
  assert.throws(() => f.orders.complete(oldCommand),{ code: 'STALE_EPOCH' });
  f.setEpoch(2);
  const next = f.business.setup(f.setupInput());
  assert.deepEqual(next.accounts,slice.accounts);
  assert.equal(f.account(next.accounts.player).balance,30);
  assert.equal(f.account(next.accounts.fund).balance,1970);
  assert.equal(f.account(next.accounts.fund).reserved,0);
  assert.equal(f.stock(next.stocks.supplier).quantity,19);
  assert.equal(f.stock(next.stocks.workshop).quantity,1);
  assert.equal(f.db.prepare('SELECT SUM(remaining) n FROM economy_reservations').get().n,0);
});

test('outer rebuild failure rolls back order cancellation, reservations and epoch together', t => {
  const f = fixture(t); f.business.setup(f.setupInput());
  let order = f.orders.publish(f.cmd()).order;
  f.arrive('board'); order = f.act('accept',order);
  f.arrive('source'); order = f.act('pickup',order);
  const before = f.snapshot(), epoch = f.registry.getWorldState().epoch;
  const rebuild = f.cmd();
  assert.throws(() => f.db.transaction(() => {
    f.orders.cancelForRebuild(rebuild);
    f.registry.advanceEpoch({ expectedEpoch: epoch });
    throw new Error('injected scene cleanup failure');
  })(),/injected scene cleanup failure/);
  assert.deepEqual(f.snapshot(),before);
  assert.equal(f.registry.getWorldState().epoch,epoch);
  assert.equal(f.orders.cancelForRebuild(rebuild).orders.length,1);
  assert.equal(f.stock(order.cargoStockId).quantity,0);
});

test('late failure rolls back goods, wage, ledger, event, log and request together', t => {
  const f = fixture(t); f.business.setup(f.setupInput());
  let order = f.orders.publish(f.cmd()).order;
  f.arrive('board'); order = f.act('accept',order);
  f.arrive('source'); order = f.act('pickup',order);
  f.arrive('workshop');
  f.db.exec(`CREATE TRIGGER fail_delivery_log BEFORE INSERT ON town_business_log
    WHEN NEW.phase='completed' BEGIN SELECT RAISE(ABORT,'injected log failure'); END`);
  const before = f.snapshot();
  assert.throws(() => f.act('complete',order),/injected log failure/);
  assert.deepEqual(f.snapshot(),before);
});

test('bounded stock prevents overpublishing and rolls back wage reservation on shortage', t => {
  const f = fixture(t), slice = f.business.setup(f.setupInput());
  for (let i = 0; i < DELIVERY_SLICE.initialMaterials; i++) f.orders.publish(f.cmd());
  assert.equal(f.account(slice.accounts.fund).reserved,600);
  const before = f.snapshot();
  assert.throws(() => f.orders.publish(f.cmd()),{ code: 'INSUFFICIENT_STOCK' });
  assert.deepEqual(f.snapshot(),before);
});

test('insufficient public budget cannot publish an unfunded wage promise', t => {
  const f = fixture(t), slice = f.business.setup(f.setupInput());
  f.economy.transfer({ ...f.cmd(),reasonCode: 'test.budget_spent',fromAccountId: slice.accounts.fund,
    toAccountId: slice.accounts.supplier,amount: 1990 });
  const before = f.snapshot();
  assert.throws(() => f.orders.publish(f.cmd()),{ code: 'INSUFFICIENT_FUNDS' });
  assert.deepEqual(f.snapshot(),before);
  assert.equal(f.stock(slice.stocks.supplier).reserved,0);
});

test('lost custody, wrong actor and async location adapters fail closed', t => {
  const f = fixture(t), slice = f.business.setup(f.setupInput());
  let order = f.orders.publish(f.cmd()).order;
  f.arrive('board');
  assert.throws(() => f.act('accept',order,{ actorId: slice.npcActorIds.supplier }),{ code: 'ACTOR_UNAVAILABLE' });
  f.position.hasArrived = () => Promise.resolve(true);
  assert.throws(() => f.act('accept',order),{ code: 'ASYNC_ADAPTER_FORBIDDEN' });
  f.position.hasArrived = () => true;
  order = f.act('accept',order); order = f.act('pickup',order);
  const r = f.economy.getReservation({ ...f.scope,reservationId: order.cargoReservationId });
  f.economy.releaseStock({ ...f.cmd(),reasonCode: 'test.external_release',reservationId: r.reservationId,expectedVersion: r.version });
  const before = f.snapshot();
  assert.throws(() => f.act('complete',order),{ code: 'ORDER_RESERVATION_LOST' });
  assert.deepEqual(f.snapshot(),before);
});
