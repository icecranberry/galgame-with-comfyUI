import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { migrateTownEconomySchema } from '../src/db/townEconomySchema.js';
import { migrateTownBusinessSchema } from '../src/db/townBusinessSchema.js';
import { migrateTownProductionSchema } from '../src/db/townProductionSchema.js';
import { migrateTownServiceSessionSchema } from '../src/db/townServiceSessionSchema.js';
import { migrateTownItemTemplateSchema } from '../src/db/townItemTemplateSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { createTownActionRunner } from '../src/services/town/townActionRunner.js';
import { createEconomyService } from '../src/services/town/economyService.js';
import { createTownBusinessService } from '../src/services/town/townBusinessService.js';
import { createTownOrderService } from '../src/services/town/townOrderService.js';
import { createTownProductionService, PRODUCTION_RECIPE } from '../src/services/town/townProductionService.js';
import { createItemTemplateService } from '../src/services/town/itemTemplateService.js';
import { createTownServiceSessionService } from '../src/services/town/townServiceSessionService.js';

// All prerequisites are real services. No hand-authored money/stock transfers,
// fabricated service receipts, fake action completion, or production seed calls.
function fixture(t) {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); t.after(() => db.close());
  t.mock.method(globalThis,'fetch',() => { throw new Error('Network forbidden'); });
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    INSERT INTO town_npcs VALUES(1,NULL,1),(2,NULL,1),(3,NULL,1);
    CREATE TABLE backpack_items(id INTEGER PRIMARY KEY AUTOINCREMENT,effect_key TEXT,name TEXT,description TEXT,
      rarity TEXT,image_url TEXT,status TEXT,payload_json TEXT,collected_at TEXT,acquired_at TEXT,used_at TEXT);
    CREATE TABLE item_effects(id INTEGER PRIMARY KEY,item_id INTEGER);`);
  for (const migrate of [migrateTownSchema,migrateTownActionSchema,migrateTownEconomySchema,migrateTownBusinessSchema,
    migrateTownItemTemplateSchema,migrateTownServiceSessionSchema,migrateTownProductionSchema]) migrate(db);
  const registry = createTownActorRegistry(db), world = registry.getWorldState();
  let time = Date.UTC(2026,8,8,2), sequence = 0;
  const clock = { now: () => time }, positions = new Map();
  const scope = { worldId: world.worldId,worldEpoch: world.epoch };
  const cmd = extra => ({ ...scope,idempotencyKey: `production-test:${++sequence}`,sourceKey: `production-test:${sequence}`,...extra });
  const position = { getLocation: ({ locationKey }) => ['board','supplier','workshop'].includes(locationKey) ? { locationKey } : null,
    hasArrived: ({ actorId,locationKey }) => positions.get(actorId) === locationKey,isServiceOpen: () => true };
  const economy = createEconomyService({ db,clock,getWorldEpoch: registry.getWorldEpoch,getActor: registry.getActor });
  const deps = { db,clock,registry,economy,position }, business = createTownBusinessService(deps);
  const config = business.setup(cmd({ npcActorIds: { commissioner: registry.resolveAgentKey(-1).actorId,
    supplier: registry.resolveAgentKey(-2).actorId,workshop: registry.resolveAgentKey(-3).actorId },
  locationKeys: { board: 'board',supplier: 'supplier',workshop: 'workshop' } }));
  const actorId = config.playerActorId;
  positions.set(config.npcActorIds.supplier,'supplier'); positions.set(config.npcActorIds.workshop,'workshop');
  const orders = createTownOrderService(deps);
  const items = createItemTemplateService({ db,clock,getWorldEpoch: registry.getWorldEpoch,getActor: registry.getActor,
    effectRegistry: { mood_fix: { kind: 'mood' },energy: { kind: 'buff' } } });
  const service = createTownServiceSessionService({ ...deps,itemTemplates: items,getWorkshop: () => ({ accountId: config.accounts.workshop,
    stockId: config.stocks.workshop,actorId: config.npcActorIds.workshop,locationKey: 'workshop' }) });
  const production = createTownProductionService({ ...deps,getSlice: business.getSlice });
  production.initializeResourceNode(cmd());
  const runner = createTownActionRunner({ db,clock,getWorldEpoch: registry.getWorldEpoch,getActor: registry.getActor,
    readFacts: action => ({ worldEpoch: scope.worldEpoch,actorId: action.actorId,targetExists: true,
      arrived: positions.get(action.actorId) === action.target,locationKey: positions.get(action.actorId),allowsAction: true }),
    leaseMs: 600000 });
  async function paidService() {
    let order = orders.publish(cmd()).order;
    for (const [method,key] of [['accept','board'],['pickup','supplier'],['complete','workshop']]) {
      positions.set(actorId,key);
      order = orders[method](cmd({ orderId: order.orderId,actorId,expectedVersion: order.version })).order;
    }
    let value = service.offer(cmd({ actorId }));
    value = service.accept(cmd({ actorId,sessionId: value.sessionId,expectedVersion: value.version }));
    for (const intentKey of ['choose_theme','confirm_materials','craft','deliver']) value = await service.turn({ ...scope,
      actorId,sessionId: value.sessionId,expectedVersion: value.version,clientTurnId: `turn:${++sequence}`,intentKey });
    assert.equal(value.status,'completed'); return value.sessionId;
  }
  function beginWork(role, durationMs = PRODUCTION_RECIPE.workMs) {
    let action = runner.create(cmd({ actorId: config.npcActorIds[role],type: 'work_shift',target: config.locationKeys[role],payload: { durationMs } }));
    action = runner.reserve(cmd({ actionId: action.id,expectedVersion: action.version }));
    return runner.start(cmd({ actionId: action.id,expectedVersion: action.version }));
  }
  function finishWork(action) { return runner.advance(cmd({ actionId: action.id,expectedVersion: action.version })); }
  function proofs() {
    const supplier = beginWork('supplier'), workshop = beginWork('workshop');
    time += PRODUCTION_RECIPE.workMs;
    return { supplierActionId: finishWork(supplier).id,workshopActionId: finishWork(workshop).id };
  }
  const snapshot = () => ['economy_accounts','economy_transactions','economy_reservations','town_resource_stocks','town_resource_entries',
    'town_production_nodes','town_productions','town_production_proofs','town_production_log','town_domain_events','town_business_receipts']
    .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
  const account = role => economy.getAccount({ ...scope,accountId: config.accounts[role] });
  return { db,registry,economy,production,cmd,scope,config,positions,paidService,beginWork,finishWork,proofs,snapshot,account,
    advance: ms => { time += ms; } };
}

test('finite capacity initialization is stable and does not issue money or inventory', t => {
  const f = fixture(t), before = f.snapshot();
  migrateTownProductionSchema(f.db);
  f.production.initializeResourceNode(f.cmd());
  assert.deepEqual(f.production.getResourceNode(f.scope),{ worldId: f.scope.worldId,capacity: 200,remaining: 200,reserved: 0,available: 200 });
  assert.deepEqual(f.snapshot().slice(0,5),before.slice(0,5));
  assert.equal(f.account('fund').balance,2000);
});

test('only a real completed paid service authorizes one reserved production batch', async t => {
  const f = fixture(t);
  assert.throws(() => f.production.start(f.cmd({ sessionId: 'fictional' })),{ code: 'PAID_SERVICE_REQUIRED' });
  const sessionId = await f.paidService(), input = f.cmd({ sessionId });
  const result = f.production.start(input);
  assert.equal(f.account('workshop').reserved,30);
  assert.equal(f.production.getResourceNode(f.scope).reserved,1);
  assert.deepEqual(f.production.start(input),result);
  assert.throws(() => f.production.start(f.cmd({ sessionId })),{ code: 'SERVICE_PRODUCTION_ALREADY_USED' });
});

test('cancel, expiry and rebuild release capacity and money without output or wages', async t => {
  const f = fixture(t), sessionId = await f.paidService();
  for (const method of ['cancel','expire','cancelForRebuild']) {
    const value = f.production.start(f.cmd({ sessionId })).production;
    if (method === 'expire') f.advance(PRODUCTION_RECIPE.lifetimeMs);
    f.production[method](f.cmd({ productionId: value.productionId,expectedVersion: value.version }));
    assert.equal(f.production.getResourceNode(f.scope).remaining,200);
    assert.equal(f.production.getResourceNode(f.scope).reserved,0);
    assert.equal(f.account('workshop').reserved,0);
    assert.equal(f.account('workshop').balance,430);
  }
});

test('production commits real attendance, bounded output, wages and public return atomically', async t => {
  const f = fixture(t), sessionId = await f.paidService();
  const batch = f.production.start(f.cmd({ sessionId })).production;
  const input = f.cmd({ productionId: batch.productionId,expectedVersion: batch.version,...f.proofs() });
  const receipt = f.production.complete(input);
  assert.equal(receipt.production.status,'completed');
  assert.equal(f.production.getResourceNode(f.scope).remaining,199);
  assert.equal(f.account('fund').balance,1990);
  assert.equal(f.account('workshop').balance,400);
  assert.equal(f.account('supplier').balance,606);
  assert.equal(f.economy.getStock({ ...f.scope,stockId: f.config.stocks.supplier }).quantity,20);
  for (const accountId of Object.values(batch.config.workers)) assert.equal(f.economy.getAccount({ ...f.scope,accountId }).balance,2);
  const before = f.snapshot();
  assert.deepEqual(f.production.complete(input),receipt); assert.deepEqual(f.snapshot(),before);
  assert.equal(f.db.prepare('SELECT SUM(balance) n FROM economy_accounts').get().n,0);
  assert.equal(f.db.prepare("SELECT SUM(balance) n FROM economy_accounts WHERE account_type<>'issuance'").get().n,3400);
  assert.equal(f.db.prepare('SELECT SUM(remaining) n FROM economy_reservations').get().n,0);
  assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
});

test('claimed time without a completed five-minute action cannot pay or produce', async t => {
  const f = fixture(t), sessionId = await f.paidService();
  const batch = f.production.start(f.cmd({ sessionId })).production;
  const a = f.beginWork('supplier'), b = f.beginWork('workshop');
  const input = f.cmd({ productionId: batch.productionId,expectedVersion: batch.version,supplierActionId: a.id,workshopActionId: b.id });
  const before = f.snapshot();
  assert.throws(() => f.production.complete(input),{ code: 'INVALID_WORK_PROOF' });
  assert.deepEqual(f.snapshot(),before);
});

test('short attendance, wrong role, missing target and stale epoch are rejected before output', async t => {
  const f = fixture(t), sessionId = await f.paidService();
  const batch = f.production.start(f.cmd({ sessionId })).production;
  const short = f.beginWork('supplier',1000), workshop = f.beginWork('workshop');
  f.advance(PRODUCTION_RECIPE.workMs);
  const supplier = f.finishWork(short), worker = f.finishWork(workshop);
  const input = f.cmd({ productionId: batch.productionId,expectedVersion: batch.version,supplierActionId: supplier.id,workshopActionId: worker.id });
  assert.throws(() => f.production.complete(input),{ code: 'INVALID_WORK_PROOF' });
  assert.throws(() => f.production.complete({ ...input,...f.cmd(),supplierActionId: worker.id,workshopActionId: supplier.id }),{ code: 'INVALID_WORK_PROOF' });
  f.registry.advanceEpoch({ expectedEpoch: 1 });
  assert.throws(() => f.production.complete(input),{ code: 'STALE_EPOCH' });
});

test('capacity exhaustion fails without reserving money; conflicting requests do not alter batch', async t => {
  const f = fixture(t), sessionId = await f.paidService();
  // Explicit boundary fixture: no produced stock, money or proof is fabricated.
  f.db.prepare('UPDATE town_production_nodes SET remaining=0').run();
  const before = f.snapshot();
  assert.throws(() => f.production.start(f.cmd({ sessionId })),{ code: 'RESOURCE_CAPACITY_EXHAUSTED' });
  assert.deepEqual(f.snapshot(),before);
});

test('rebuild failure rolls capacity reservation, batch and epoch back together', async t => {
  const f = fixture(t), sessionId = await f.paidService();
  const input = f.cmd({ sessionId });
  f.production.start(input);
  assert.throws(() => f.production.start({ ...input,sessionId: 'other' }),{ code: 'IDEMPOTENCY_CONFLICT' });
  const before = f.snapshot();
  assert.throws(() => f.db.transaction(() => {
    f.production.cancelForRebuild(f.cmd());
    f.registry.advanceEpoch({ expectedEpoch: 1 });
    throw new Error('rebuild failed');
  })(),/rebuild failed/);
  assert.deepEqual(f.snapshot(),before);
  assert.equal(f.registry.getWorldEpoch(f.scope.worldId),1);
});

test('a late log failure rolls back output, capacity, proof use and every payment', async t => {
  const f = fixture(t), sessionId = await f.paidService();
  const batch = f.production.start(f.cmd({ sessionId })).production;
  const input = f.cmd({ productionId: batch.productionId,expectedVersion: batch.version,...f.proofs() });
  f.db.exec(`CREATE TRIGGER production_log_failure BEFORE INSERT ON town_production_log
    WHEN NEW.phase='completed' BEGIN SELECT RAISE(ABORT,'injected production log failure'); END`);
  const before = f.snapshot();
  assert.throws(() => f.production.complete(input),/injected production log failure/);
  assert.deepEqual(f.snapshot(),before);
});

test('proof discovery skips the earliest short work and never writes or claims proofs', async t => {
  const f = fixture(t), sessionId = await f.paidService();
  const batch = f.production.start(f.cmd({ sessionId })).production;
  assert.equal(f.production.findAvailableProofs({ scope: f.scope,productionId: batch.productionId }),null);
  const short = f.beginWork('supplier',1000);
  f.advance(1000); f.finishWork(short);
  const valid = f.proofs(), before = f.snapshot();
  const changes = f.db.prepare('SELECT total_changes() n').get().n;
  assert.deepEqual(f.production.findAvailableProofs({ scope: f.scope,productionId: batch.productionId }),valid);
  assert.deepEqual(f.production.findAvailableProofs({ ...f.scope,productionId: batch.productionId }),valid);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);
  assert.deepEqual(f.snapshot(),before);
  const result = f.production.complete(f.cmd({ productionId: batch.productionId,expectedVersion: batch.version,...valid }));
  assert.equal(result.production.status,'completed');
  assert.equal(f.production.findAvailableProofs({ scope: f.scope,productionId: batch.productionId }),null);
});

test('discovery respects arrival and expiry, and completion rechecks changed position', async t => {
  const f = fixture(t), sessionId = await f.paidService();
  const batch = f.production.start(f.cmd({ sessionId })).production, proofs = f.proofs();
  const query = { scope: f.scope,productionId: batch.productionId };
  assert.deepEqual(f.production.findAvailableProofs(query),proofs);
  f.positions.set(f.config.npcActorIds.supplier,'board');
  assert.equal(f.production.findAvailableProofs(query),null);
  assert.throws(() => f.production.complete(f.cmd({ productionId: batch.productionId,expectedVersion: batch.version,...proofs })),{ code: 'NOT_ARRIVED' });
  f.positions.set(f.config.npcActorIds.supplier,'supplier');
  f.advance(PRODUCTION_RECIPE.lifetimeMs);
  assert.equal(f.production.findAvailableProofs(query),null);
  assert.equal(f.production.findAvailableProofs({ scope: f.scope,productionId: 'missing' }),null);
  assert.throws(() => f.production.findAvailableProofs({ scope: { ...f.scope,worldEpoch: 2 },productionId: batch.productionId }),{ code: 'STALE_EPOCH' });
});

test('discovery skips proofs claimed by another batch and settlement rejects an old discovery', async t => {
  const f = fixture(t), firstSession = await f.paidService(), secondSession = await f.paidService();
  const first = f.production.start(f.cmd({ sessionId: firstSession })).production;
  const second = f.production.start(f.cmd({ sessionId: secondSession })).production;
  const proofs = f.proofs();
  assert.deepEqual(f.production.findAvailableProofs({ scope: f.scope,productionId: second.productionId }),proofs);
  f.production.complete(f.cmd({ productionId: first.productionId,expectedVersion: first.version,...proofs }));
  assert.equal(f.production.findAvailableProofs({ scope: f.scope,productionId: second.productionId }),null);
  assert.throws(() => f.production.complete(f.cmd({ productionId: second.productionId,expectedVersion: second.version,...proofs })),{ code: 'WORK_PROOF_ALREADY_USED' });
  const next = f.proofs();
  assert.deepEqual(f.production.findAvailableProofs({ scope: f.scope,productionId: second.productionId }),next);
});
