import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { migrateTownEconomySchema } from '../src/db/townEconomySchema.js';
import { migrateTownBusinessSchema } from '../src/db/townBusinessSchema.js';
import { migrateTownServiceSessionSchema } from '../src/db/townServiceSessionSchema.js';
import { migrateTownVenueRegularSchema } from '../src/db/townVenueRegularSchema.js';
import { migrateTownItemTemplateSchema } from '../src/db/townItemTemplateSchema.js';
import { migrateTownItemSchema } from '../src/db/townItemSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { createEconomyService } from '../src/services/town/economyService.js';
import { createTownBusinessService } from '../src/services/town/townBusinessService.js';
import { createTownOrderService } from '../src/services/town/townOrderService.js';
import { createTownCafeService } from '../src/services/town/townCafeService.js';
import { createTownVenueService } from '../src/services/town/townVenueService.js';
import { createTownVenueRegularService } from '../src/services/town/townVenueRegularService.js';
import { createItemTemplateService } from '../src/services/town/itemTemplateService.js';
import { venueProductTemplates } from '../src/services/town/townVenuePlaybooks.js';

const EFFECT_REGISTRY = Object.freeze({ mood_fix: { kind: 'mood' }, energy: { kind: 'buff' },
  bob_cut: { kind: 'hairstyle' }, tipsy: { kind: 'buff' }, yukata: { kind: 'outfit' } });

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Network forbidden'); });
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY AUTOINCREMENT,character_id INTEGER,town_enabled INTEGER DEFAULT 1);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    INSERT INTO town_npcs(id) VALUES(1),(2),(3),(4),(5),(6),(7),(8),(9);
    CREATE TABLE IF NOT EXISTS backpack_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      effect_key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      rarity TEXT NOT NULL DEFAULT 'common',
      image_url TEXT,
      status TEXT NOT NULL DEFAULT 'generating',
      payload_json TEXT,
      collected_at DATETIME,
      acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      used_at DATETIME
    );`);migrateTownSchema(db); migrateTownActionSchema(db); migrateTownEconomySchema(db);
  migrateTownBusinessSchema(db); migrateTownServiceSessionSchema(db);
  migrateTownVenueRegularSchema(db);
  migrateTownItemTemplateSchema(db); migrateTownItemSchema(db);
  const registry = createTownActorRegistry(db);
  let time = 1000;
  const clock = { now: () => time };
  const world = registry.getWorldState();
  let scope = { worldId: world.worldId, worldEpoch: world.epoch };
  const playerId = registry.resolveAgentKey('me').actorId;
  const arrivals = new Map();
  const locations = new Set(['board', 'source', 'workshop', 'cafe', 'tavern', 'clothing_shop', 'inn', 'study']);
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
  const itemTemplates = createItemTemplateService({ db, clock, getWorldEpoch: registry.getWorldEpoch,
    getActor: registry.getActor, effectRegistry: EFFECT_REGISTRY, economy });
  const dependencies = { db, clock, registry, economy, position, itemTemplates };
  const business = createTownBusinessService(dependencies);
  const orders = createTownOrderService(dependencies);
  const getVenue = requestedScope => {
    const slice = business.getSlice(requestedScope);
    const profile = (slice.functionalBuildings || [])
      .find(building => building.businessKey === requestedScope.businessKey);
    if (!profile) throw Object.assign(new Error('VENUE_NOT_CONFIGURED'), { code: 'VENUE_NOT_CONFIGURED' });
    return { businessKey: profile.businessKey, accountId: profile.accountId, stockId: profile.stockId,
      actorId: profile.actorId, locationKey: profile.locationKey, services: profile.serviceKeys };
  };
  const getCafe = requestedScope => {
    const slice = business.getSlice(requestedScope);
    if (!slice.cafe) throw Object.assign(new Error('CAFE_NOT_CONFIGURED'), { code: 'CAFE_NOT_CONFIGURED' });
    return { accountId: slice.accounts.cafe, stockId: slice.cafe.stockId,
      actorId: slice.cafe.actorId, locationKey: slice.cafe.locationKey };
  };
  const regulars = createTownVenueRegularService({ db, clock, registry });
  const onConsumed = input => regulars.record(input);
  const cafe = createTownCafeService({ ...dependencies, getCafe, onConsumed });
  const venues = createTownVenueService({ ...dependencies, getVenue, onConsumed });
  let counter = 0;
  const cmd = (fields = {}) => ({ ...scope, idempotencyKey: `request-${++counter}`, sourceKey: `source-${counter}`, ...fields });
  const setupInput = () => cmd({ npcActorIds: { commissioner: registry.resolveAgentKey(-1).actorId,
    supplier: registry.resolveAgentKey(-2).actorId, workshop: registry.resolveAgentKey(-3).actorId,
    cafe: registry.resolveAgentKey(-4).actorId, tavern: registry.resolveAgentKey(-5).actorId,
    clothing_shop: registry.resolveAgentKey(-6).actorId },
  locationKeys: { board: 'board', supplier: 'source', workshop: 'workshop', cafe: 'cafe',
    tavern: 'tavern', clothing_shop: 'clothing_shop' } });
  /** 基础三站 + 咖啡馆之外，再按需加挂注册表里的建筑：新增建筑只在调用点声明 businessKey。 */
  const venueSetup = (keys = []) => {
    const input = setupInput();
    const npcActorIds = { ...input.npcActorIds }, locationKeys = { ...input.locationKeys };
    keys.forEach((key, index) => {
      npcActorIds[key] = registry.resolveAgentKey(-(7 + index)).actorId;
      locationKeys[key] = key;
      locations.add(key);
    });
    return cmd({ npcActorIds, locationKeys });
  };
  const arrive = (actorId, locationKey, moving = false) => arrivals.set(actorId, { ...scope, locationKey, moving });
  const account = id => economy.getAccount({ ...scope, accountId: id });
  const stock = id => economy.getStock({ ...scope, stockId: id });
  const venue = businessKey => business.getSlice(scope).functionalBuildings
    .find(building => building.businessKey === businessKey);
  const snapshot = () => ['economy_accounts','town_resource_stocks','economy_reservations','economy_transactions',
    'economy_entries','town_resource_entries','town_domain_events','town_business_log','town_delivery_orders',
    'town_business_receipts','town_business_requests','town_service_sessions','town_service_settlements',
    'item_templates','backpack_items']
    .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
  const playerAccountId = () => economy.ensureAccount({ ...scope, ownerKey: 'actor:' + playerId,
    actorId: playerId, accountType: 'actor' }).accountId;
  return { db, registry, clock, position, economy, itemTemplates, business, orders, cafe, venues, regulars, cmd, setupInput, venueSetup, playerAccountId,
    arrive, account, stock, venue, snapshot, playerId, locations,
    get scope() { return scope; }, setEpoch: epoch => { scope = { ...scope, worldEpoch: epoch }; },
    setTime: value => { time = value; } };
}

function openVenue(f, businessKey, input = f.setupInput()) {
  const slice = f.business.setup(input);
  f.itemTemplates.ensureVenueTemplates({ ...f.scope, idempotencyKey: 'venue-templates', sourceKey: 'venue-templates',
    reasonCode: 'VENUE_PRODUCT_TEMPLATE' }, venueProductTemplates());
  const profile = f.venue(businessKey);
  f.arrive(profile.actorId, profile.locationKey);
  f.arrive(f.playerId, profile.locationKey);
  return { slice, profile };
}

test('generic venue setup registers tavern and clothing shop without reseeding or touching cafe bytes', t => {
  const f = fixture(t);
  const input = f.setupInput();
  const slice = f.business.setup(input);
  const keys = slice.functionalBuildings.map(building => building.businessKey);
  assert.deepEqual(keys, ['cafe', 'tavern', 'clothing_shop']);
  assert.equal(f.account(slice.accounts.cafe).balance, 600);
  assert.equal(f.account(slice.accounts.tavern).balance, 480);
  assert.equal(f.account(slice.accounts.clothing_shop).balance, 520);
  assert.equal(f.stock(f.venue('tavern').stockId).quantity, 8);
  assert.equal(f.stock(f.venue('tavern').supplierStockId).quantity, 16);
  assert.equal(f.venue('tavern').resourceKey, 'tavern:ingredient');
  assert.equal(f.venue('clothing_shop').resourceKey, 'clothing:cloth');
  assert.deepEqual(f.venue('tavern').serviceKeys, ['town.tavern.shift', 'town.tavern.help_swap', 'town.tavern.buy_meal']);
  const before = f.snapshot();
  assert.deepEqual(f.business.setup(input), slice);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.account(slice.accounts.tavern).balance, 480);
  assert.deepEqual(f.db.pragma('foreign_key_check'), []);
});

test('venue setup rejects changing an existing shop owner or location', t => {
  const f = fixture(t);
  f.business.setup(f.setupInput());
  const other = f.registry.resolveAgentKey(-7).actorId;
  assert.throws(() => f.business.setup(f.cmd({ npcActorIds: { commissioner: other,
    supplier: f.registry.resolveAgentKey(-2).actorId, workshop: f.registry.resolveAgentKey(-3).actorId,
    cafe: f.registry.resolveAgentKey(-4).actorId, tavern: f.registry.resolveAgentKey(-5).actorId,
    clothing_shop: f.registry.resolveAgentKey(-6).actorId },
  locationKeys: { board: 'board', supplier: 'source', workshop: 'workshop', cafe: 'cafe',
    tavern: 'tavern', clothing_shop: 'clothing_shop' } })), { code: 'SLICE_CONFLICT' });
});

test('tavern help_swap trades one shift for one meal item and pays no money', t => {
  const f = fixture(t), { profile } = openVenue(f, 'tavern');
  const offered = f.venues.offer(f.cmd({ actorId: f.playerId, serviceKey: 'town.tavern.help_swap' }));
  assert.equal(offered.serviceKey, 'town.tavern.help_swap');
  assert.equal(offered.playbookKey, 'help_swap');
  assert.equal(offered.payer, 'venue');
  const accepted = f.venues.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  assert.equal(accepted.status, 'active');
  assert.equal(accepted.phaseKey, 'prep');
  assert.deepEqual(accepted.choices, ['work', 'cancel']);
  assert.equal(f.stock(profile.stockId).reserved, 1);
  const prepped = f.venues.turn(f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId,
    expectedVersion: accepted.version, clientTurnId: 'swap-prep', intentKey: 'work' }));
  assert.equal(prepped.phaseKey, 'finish');
  assert.deepEqual(prepped.choices, ['serve', 'clarify', 'cancel']);
  const done = f.venues.turn(f.cmd({ sessionId: prepped.sessionId, actorId: f.playerId,
    expectedVersion: prepped.version, clientTurnId: 'swap-done', intentKey: 'serve' }));
  assert.equal(done.status, 'completed');
  assert.equal(done.settlement.status, 'completed');
  assert.equal(done.settlement.paid, 0);
  assert.equal(done.settlement.payout, 0);
  assert.equal(done.settlement.refund, 0);
  assert.equal(done.settlement.itemIds.length, 1);
  const item = f.db.prepare('SELECT * FROM backpack_items WHERE id=?').get(done.settlement.itemIds[0]);
  assert.equal(item.effect_key, 'tipsy');
  assert.equal(item.owner_key, 'me');
  assert.equal(item.source_id, `service:${done.sessionId}:outcome:tavern_meal_taken`);
  assert.equal(f.account(f.venue('tavern').accountId).balance, 480);
  assert.equal(f.account(f.playerAccountId()).balance, 0);
  assert.equal(f.stock(profile.stockId).quantity, 7);
  assert.equal(f.stock(profile.stockId).reserved, 0);
  assert.equal(f.db.prepare('SELECT SUM(balance) n FROM economy_accounts').get().n, 0);
  assert.equal(f.db.prepare('SELECT SUM(remaining) n FROM economy_reservations').get().n, 0);
});

test('tavern shift escrows the wage from the shop and refunds it on cancel', t => {
  const f = fixture(t), { profile } = openVenue(f, 'tavern');
  const offered = f.venues.offer(f.cmd({ actorId: f.playerId, serviceKey: 'town.tavern.shift' }));
  const accepted = f.venues.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  assert.equal(accepted.phaseKey, 'prep');
  assert.deepEqual(accepted.choices, ['work', 'cancel']);
  assert.equal(f.account(profile.accountId).balance, 454);
  assert.equal(f.account(profile.accountId).reserved, 0);
  const cancelled = f.venues.cancel(f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId, expectedVersion: accepted.version }));
  assert.equal(cancelled.settlement.status, 'cancelled');
  assert.equal(cancelled.settlement.refund, 26);
  assert.equal(f.account(profile.accountId).balance, 480);
  assert.equal(f.stock(profile.stockId).quantity, 8);
  assert.equal(f.db.prepare('SELECT SUM(remaining) n FROM economy_reservations').get().n, 0);
});

test('clothing custom order charges the fee, walks two phases and grants the ordered piece', t => {
  const f = fixture(t), { profile } = openVenue(f, 'clothing_shop');
  f.economy.seed({ ...f.scope, accountId: f.playerAccountId(),
    amount: 50, seedVersion: 2, idempotencyKey: 'test-seed-player', sourceKey: 'test-seed-player', reasonCode: 'test.seed' });
  const offered = f.venues.offer(f.cmd({ actorId: f.playerId, serviceKey: 'town.clothing.custom_order' }));
  assert.equal(offered.payer, 'player');
  const accepted = f.venues.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  assert.equal(accepted.phaseKey, 'brief');
  assert.deepEqual(accepted.choices, ['choose_style', 'cancel']);
  const briefed = f.venues.turn(f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId,
    expectedVersion: accepted.version, clientTurnId: 'style-1', intentKey: 'choose_style' }));
  assert.equal(briefed.phaseKey, 'make');
  assert.deepEqual(briefed.choices, ['craft', 'clarify', 'cancel']);
  const made = f.venues.turn(f.cmd({ sessionId: briefed.sessionId, actorId: f.playerId,
    expectedVersion: briefed.version, clientTurnId: 'craft-1', intentKey: 'craft' }));
  assert.equal(made.status, 'completed');
  assert.equal(made.settlement.paid, 22);
  assert.equal(made.settlement.payout, 22);
  assert.equal(made.settlement.refund, 0);
  assert.equal(made.settlement.itemIds.length, 1);
  const item = f.db.prepare('SELECT * FROM backpack_items WHERE id=?').get(made.settlement.itemIds[0]);
  assert.equal(item.effect_key, 'yukata');
  assert.equal(f.account(f.venue('clothing_shop').accountId).balance, 542);
  assert.equal(f.stock(profile.stockId).quantity, 7);
});

test('venue turn idempotency replays the same client turn and rejects a changed payload', t => {
  const f = fixture(t), { profile } = openVenue(f, 'tavern');
  const offered = f.venues.offer(f.cmd({ actorId: f.playerId, serviceKey: 'town.tavern.help_swap' }));
  const accepted = f.venues.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  const turnInput = f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId,
    expectedVersion: accepted.version, clientTurnId: 'same-turn', intentKey: 'work' });
  const first = f.venues.turn(turnInput);
  const replay = f.venues.turn(turnInput);
  assert.equal(replay.sessionId, first.sessionId);
  assert.equal(replay.phaseKey, 'finish');
  const done = f.venues.turn(f.cmd({ sessionId: replay.sessionId, actorId: f.playerId,
    expectedVersion: replay.version, clientTurnId: 'finish-turn', intentKey: 'serve' }));
  assert.equal(done.settlement.itemIds.length, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM backpack_items').get().n, 1);
  assert.equal(f.stock(profile.stockId).quantity, 7);
  const before = f.snapshot();
  assert.throws(() => f.venues.turn({ ...turnInput, intentKey: 'clarify' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(f.snapshot(), before);
});

test('venue recovery fails an accepted session when the shopkeeper leaves and refunds the fee', t => {
  const f = fixture(t), { profile } = openVenue(f, 'clothing_shop');
  f.economy.seed({ ...f.scope, accountId: f.playerAccountId(),
    amount: 50, seedVersion: 2, idempotencyKey: 'test-seed-player', sourceKey: 'test-seed-player', reasonCode: 'test.seed' });
  const offered = f.venues.offer(f.cmd({ actorId: f.playerId, serviceKey: 'town.clothing.custom_order' }));
  const accepted = f.venues.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  f.arrive(profile.actorId, 'workshop');
  const recovered = f.venues.recover(f.scope);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, 'failed');
  assert.equal(recovered[0].settlement.refund, 22);
  assert.equal(f.account(f.playerAccountId()).balance, 50);
  assert.equal(f.stock(profile.stockId).quantity, 8);
  assert.equal(f.db.prepare('SELECT SUM(remaining) n FROM economy_reservations').get().n, 0);
});

test('tavern restock order uses its own account, stock and business key', t => {
  const f = fixture(t), { slice } = openVenue(f, 'tavern');
  let order = f.orders.publish(f.cmd({ businessKey: 'tavern' })).order;
  assert.equal(order.businessKey, 'tavern');
  assert.equal(f.account(f.venue('tavern').accountId).reserved, 30);
  assert.equal(f.stock(f.venue('tavern').supplierStockId).reserved, 1);
  f.arrive(f.playerId, 'board'); order = f.orders.accept(f.cmd({ orderId: order.orderId, actorId: f.playerId,
    expectedVersion: order.version })).order;
  f.arrive(f.playerId, 'source'); order = f.orders.pickup(f.cmd({ orderId: order.orderId, actorId: f.playerId,
    expectedVersion: order.version })).order;
  f.arrive(f.playerId, 'tavern'); order = f.orders.complete(f.cmd({ orderId: order.orderId, actorId: f.playerId,
    expectedVersion: order.version })).order;
  assert.equal(order.status, 'completed');
  assert.equal(f.account(slice.accounts.player).balance, 30);
  assert.equal(f.account(slice.accounts.cafe).balance, 600);
  assert.equal(f.stock(slice.cafe.stockId).quantity, 8);
  assert.equal(f.stock(f.venue('tavern').stockId).quantity, 9);
});

test('tavern buy_meal charges the price, walks order to pickup and grants one meal', t => {
  const f = fixture(t), { profile } = openVenue(f, 'tavern');
  f.economy.seed({ ...f.scope, accountId: f.playerAccountId(), amount: 40, seedVersion: 2,
    idempotencyKey: 'meal-seed', sourceKey: 'meal-seed', reasonCode: 'test.seed' });
  const offered = f.venues.offer(f.cmd({ actorId: f.playerId, serviceKey: 'town.tavern.buy_meal' }));
  assert.equal(offered.playbookKey, 'purchase');
  assert.equal(offered.payer, 'player');
  const accepted = f.venues.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  assert.equal(accepted.phaseKey, 'order');
  assert.deepEqual(accepted.choices, ['confirm_order', 'cancel']);
  assert.equal(f.account(profile.accountId).balance, 480);
  assert.equal(f.account(f.playerAccountId()).balance, 28);
  const ordered = f.venues.turn(f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId,
    expectedVersion: accepted.version, clientTurnId: 'meal-order', intentKey: 'confirm_order' }));
  assert.equal(ordered.phaseKey, 'pickup');
  assert.deepEqual(ordered.choices, ['take', 'clarify', 'cancel']);
  const taken = f.venues.turn(f.cmd({ sessionId: ordered.sessionId, actorId: f.playerId,
    expectedVersion: ordered.version, clientTurnId: 'meal-take', intentKey: 'take' }));
  assert.equal(taken.status, 'completed');
  assert.equal(taken.settlement.paid, 12);
  assert.equal(taken.settlement.payout, 12);
  assert.equal(taken.settlement.itemIds.length, 1);
  assert.equal(f.db.prepare('SELECT effect_key FROM backpack_items WHERE id=?').get(taken.settlement.itemIds[0]).effect_key, 'tipsy');
  assert.equal(f.account(profile.accountId).balance, 492);
  assert.equal(f.stock(profile.stockId).quantity, 7);
});

test('regular visits count only completed player-paid services and unlock a topic once', t => {
  const f = fixture(t), { profile } = openVenue(f, 'tavern');
  f.economy.seed({ ...f.scope, accountId: f.playerAccountId(), amount: 200, seedVersion: 2,
    idempotencyKey: 'regular-seed', sourceKey: 'regular-seed', reasonCode: 'test.seed' });
  const buyMeal = index => {
    const offered = f.venues.offer(f.cmd({ actorId: f.playerId, serviceKey: 'town.tavern.buy_meal' }));
    const accepted = f.venues.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
    const ordered = f.venues.turn(f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId,
      expectedVersion: accepted.version, clientTurnId: `regular-order-${index}`, intentKey: 'confirm_order' }));
    return f.venues.turn(f.cmd({ sessionId: ordered.sessionId, actorId: f.playerId,
      expectedVersion: ordered.version, clientTurnId: `regular-take-${index}`, intentKey: 'take' }));
  };
  const first = buyMeal(1), second = buyMeal(2);
  assert.deepEqual(f.regulars.get({ ...f.scope, businessKey: 'tavern', playerActorId: f.playerId }),
    { businessKey: 'tavern', displayName: '镇口酒馆', label: '熟客', visits: 2, tier: 0,
      nextTierAt: 3, topic: null, unlockedAt: null, lastVisitAt: f.clock.now() });
  // 同一会话重复记录只算一次。
  f.regulars.record({ ...f.scope, businessKey: 'tavern', playerActorId: f.playerId,
    sessionId: first.sessionId, occurredAt: f.clock.now() });
  assert.equal(f.regulars.get({ ...f.scope, businessKey: 'tavern', playerActorId: f.playerId }).visits, 2);
  // 店方付费的帮工不计入熟客。
  const swap = f.venues.offer(f.cmd({ actorId: f.playerId, serviceKey: 'town.tavern.help_swap' }));
  const swapAccepted = f.venues.accept(f.cmd({ sessionId: swap.sessionId, actorId: f.playerId, expectedVersion: swap.version }));
  const swapWork = f.venues.turn(f.cmd({ sessionId: swapAccepted.sessionId, actorId: f.playerId,
    expectedVersion: swapAccepted.version, clientTurnId: 'swap-work', intentKey: 'work' }));
  f.venues.turn(f.cmd({ sessionId: swapWork.sessionId, actorId: f.playerId,
    expectedVersion: swapWork.version, clientTurnId: 'swap-serve', intentKey: 'serve' }));
  assert.equal(f.regulars.get({ ...f.scope, businessKey: 'tavern', playerActorId: f.playerId }).visits, 2);
  const third = buyMeal(3);
  const regular = f.regulars.get({ ...f.scope, businessKey: 'tavern', playerActorId: f.playerId });
  assert.equal(regular.visits, 3);
  assert.equal(regular.tier, 1);
  assert.equal(regular.nextTierAt, 6);
  assert.match(regular.topic, /^熟客专属：/);
  assert.equal(regular.unlockedAt, f.clock.now());
  const events = f.db.prepare("SELECT event_id, envelope FROM town_domain_events WHERE type='town.venue.regular'").all();
  assert.equal(events.length, 1);
  assert.equal(JSON.parse(events[0].envelope).payload.sessionId, third.sessionId);
  assert.equal(f.regulars.record({ ...f.scope, businessKey: 'unknown_shop', playerActorId: f.playerId,
    sessionId: second.sessionId, occurredAt: f.clock.now() }), null);
  assert.equal(f.account(profile.accountId).balance, 516);
});

test('cafe consumption shares the same regular accounting as registry venues', t => {
  const f = fixture(t);
  const slice = f.business.setup(f.setupInput());
  f.arrive(slice.cafe.actorId, 'cafe'); f.arrive(f.playerId, 'cafe');
  f.economy.seed({ ...f.scope, accountId: f.playerAccountId(), amount: 40, seedVersion: 2,
    idempotencyKey: 'cafe-regular-seed', sourceKey: 'cafe-regular-seed', reasonCode: 'test.seed' });
  const offered = f.cafe.offer(f.cmd({ actorId: f.playerId, serviceKey: 'town.cafe.drink_coffee' }));
  const accepted = f.cafe.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  assert.deepEqual(accepted.choices, ['serve', 'clarify', 'cancel']);
  const served = f.cafe.turn(f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId,
    expectedVersion: accepted.version, clientTurnId: 'cafe-regular-serve', intentKey: 'serve' }));
  assert.equal(served.status, 'completed');
  const regular = f.regulars.get({ ...f.scope, businessKey: 'cafe', playerActorId: f.playerId });
  assert.equal(regular.visits, 1); assert.equal(regular.displayName, '咖啡馆');
  assert.equal(f.regulars.list({ ...f.scope, playerActorId: f.playerId })
    .find(item => item.businessKey === 'cafe').visits, 1);
});

test('inn and study join the same registry with their own accounts, stock and products', t => {
  const f = fixture(t);
  const slice = f.business.setup(f.venueSetup(['inn', 'study']));
  assert.deepEqual(slice.functionalBuildings.map(building => building.businessKey),
    ['cafe', 'tavern', 'clothing_shop', 'inn', 'study']);
  assert.equal(f.account(slice.accounts.inn).balance, 460);
  assert.equal(f.account(slice.accounts.study).balance, 420);
  assert.equal(f.venue('inn').resourceKey, 'inn:bedding');
  assert.equal(f.venue('inn').resourceLabel, '铺盖');
  assert.equal(f.venue('study').resourceKey, 'study:paper');
  assert.equal(f.venue('study').displayName, '街尾书斋');
  assert.deepEqual(f.venue('inn').serviceKeys, ['town.inn.stay', 'town.inn.shift']);
  assert.deepEqual(f.venue('study').serviceKeys, ['town.study.lesson', 'town.study.shift']);
  assert.equal(f.stock(f.venue('inn').stockId).quantity, 8);
  assert.equal(f.stock(f.venue('study').supplierStockId).quantity, 16);
  assert.deepEqual(venueProductTemplates().map(product => product.templateId).sort(),
    ['town.clothing_piece', 'town.inn_tea', 'town.study_note', 'town.tavern_meal']);
  assert.equal(f.db.prepare('SELECT count(*) n FROM item_templates WHERE template_id LIKE ?').get('town.inn%').n, 0);
  assert.deepEqual(f.db.pragma('foreign_key_check'), []);
});

test('inn lodging charges the room fee, walks checkin to resting and hands over the tea', t => {
  const f = fixture(t), { profile } = openVenue(f, 'inn', f.venueSetup(['inn']));
  f.economy.seed({ ...f.scope, accountId: f.playerAccountId(), amount: 40, seedVersion: 2,
    idempotencyKey: 'inn-stay-seed', sourceKey: 'inn-stay-seed', reasonCode: 'test.seed' });
  const offered = f.venues.offer(f.cmd({ actorId: f.playerId, serviceKey: 'town.inn.stay' }));
  assert.equal(offered.playbookKey, 'lodging');
  assert.equal(offered.payer, 'player');
  assert.equal(offered.template.price, 16);
  assert.equal(offered.template.wage, 0);
  assert.equal(offered.phaseKey, 'checkin');
  const accepted = f.venues.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  assert.equal(accepted.status, 'active');
  assert.equal(accepted.phaseKey, 'checkin');
  assert.deepEqual(accepted.choices, ['settle_in', 'cancel']);
  assert.equal(f.stock(profile.stockId).reserved, 1);
  const settledIn = f.venues.turn(f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId,
    expectedVersion: accepted.version, clientTurnId: 'inn-settle-in', intentKey: 'settle_in' }));
  assert.equal(settledIn.phaseKey, 'resting');
  assert.deepEqual(settledIn.choices, ['rest_up', 'clarify', 'cancel']);
  const rested = f.venues.turn(f.cmd({ sessionId: settledIn.sessionId, actorId: f.playerId,
    expectedVersion: settledIn.version, clientTurnId: 'inn-rest-up', intentKey: 'rest_up' }));
  assert.equal(rested.status, 'completed');
  assert.equal(rested.settlement.status, 'completed');
  assert.equal(rested.settlement.paid, 16);
  assert.equal(rested.settlement.payout, 16);
  assert.equal(rested.settlement.refund, 0);
  assert.equal(rested.settlement.itemIds.length, 1);
  const tea = f.db.prepare('SELECT * FROM backpack_items WHERE id=?').get(rested.settlement.itemIds[0]);
  assert.equal(tea.template_id, 'town.inn_tea');
  assert.equal(tea.effect_key, 'energy');
  assert.equal(tea.owner_key, 'me');
  assert.equal(tea.source_id, 'service:' + rested.sessionId + ':outcome:inn_stay_done');
  assert.equal(f.account(profile.accountId).balance, 476);
  assert.equal(f.account(f.playerAccountId()).balance, 24);
  assert.equal(f.stock(profile.stockId).quantity, 7);
  assert.equal(f.stock(profile.stockId).reserved, 0);
  const regular = f.regulars.get({ ...f.scope, businessKey: 'inn', playerActorId: f.playerId });
  assert.equal(regular.visits, 1);
  assert.equal(regular.displayName, '镇东客栈');
  assert.equal(regular.topic, null);
});

test('study lesson charges the fee, walks ask to practice and grants the hand-copied note', t => {
  const f = fixture(t), { profile } = openVenue(f, 'study', f.venueSetup(['study']));
  f.economy.seed({ ...f.scope, accountId: f.playerAccountId(), amount: 30, seedVersion: 2,
    idempotencyKey: 'study-lesson-seed', sourceKey: 'study-lesson-seed', reasonCode: 'test.seed' });
  const offered = f.venues.offer(f.cmd({ actorId: f.playerId, serviceKey: 'town.study.lesson' }));
  assert.equal(offered.playbookKey, 'lesson');
  assert.equal(offered.payer, 'player');
  assert.equal(offered.template.price, 14);
  assert.equal(offered.phaseKey, 'ask');
  const accepted = f.venues.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  assert.equal(accepted.phaseKey, 'ask');
  assert.deepEqual(accepted.choices, ['ask_lesson', 'cancel']);
  assert.equal(f.stock(profile.stockId).reserved, 1);
  const asked = f.venues.turn(f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId,
    expectedVersion: accepted.version, clientTurnId: 'study-ask', intentKey: 'ask_lesson' }));
  assert.equal(asked.phaseKey, 'practice');
  assert.deepEqual(asked.choices, ['take_lesson', 'clarify', 'cancel']);
  const taken = f.venues.turn(f.cmd({ sessionId: asked.sessionId, actorId: f.playerId,
    expectedVersion: asked.version, clientTurnId: 'study-take', intentKey: 'take_lesson' }));
  assert.equal(taken.status, 'completed');
  assert.equal(taken.settlement.paid, 14);
  assert.equal(taken.settlement.itemIds.length, 1);
  const note = f.db.prepare('SELECT * FROM backpack_items WHERE id=?').get(taken.settlement.itemIds[0]);
  assert.equal(note.template_id, 'town.study_note');
  assert.equal(note.effect_key, 'mood_fix');
  assert.equal(note.source_id, 'service:' + taken.sessionId + ':outcome:study_lesson_done');
  assert.equal(f.account(profile.accountId).balance, 434);
  assert.equal(f.account(f.playerAccountId()).balance, 16);
  assert.equal(f.stock(profile.stockId).quantity, 7);
  assert.equal(f.stock(profile.stockId).reserved, 0);
});

test('leaving an inn before check-in refunds the whole room fee and frees the bedding', t => {
  const f = fixture(t), { profile } = openVenue(f, 'inn', f.venueSetup(['inn']));
  f.economy.seed({ ...f.scope, accountId: f.playerAccountId(), amount: 40, seedVersion: 2,
    idempotencyKey: 'inn-cancel-seed', sourceKey: 'inn-cancel-seed', reasonCode: 'test.seed' });
  const offered = f.venues.offer(f.cmd({ actorId: f.playerId, serviceKey: 'town.inn.stay' }));
  const accepted = f.venues.accept(f.cmd({ sessionId: offered.sessionId, actorId: f.playerId, expectedVersion: offered.version }));
  const cancelled = f.venues.cancel(f.cmd({ sessionId: accepted.sessionId, actorId: f.playerId, expectedVersion: accepted.version }));
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.settlement.refund, 16);
  assert.equal(cancelled.settlement.itemIds.length, 0);
  assert.equal(f.account(f.playerAccountId()).balance, 40);
  assert.equal(f.account(profile.accountId).balance, 460);
  assert.equal(f.stock(profile.stockId).quantity, 8);
  assert.equal(f.stock(profile.stockId).reserved, 0);
  assert.equal(f.regulars.get({ ...f.scope, businessKey: 'inn', playerActorId: f.playerId }).visits, 0);
});

