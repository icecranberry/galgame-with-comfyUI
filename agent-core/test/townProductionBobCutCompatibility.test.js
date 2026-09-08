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
import { migrateTownExperienceSchema } from '../src/db/townExperienceSchema.js';
import { createTownExperienceService, TOWN_EXPERIENCE_CONSUMER } from '../src/services/town/townExperienceService.js';
import { createTownEventService } from '../src/services/town/townEventService.js';

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
    effectRegistry: { mood_fix: { kind: 'mood' },energy: { kind: 'buff' },bob_cut: { kind: 'hairstyle' } } });
  const service = createTownServiceSessionService({ ...deps,itemTemplates: items,getWorkshop: () => ({ accountId: config.accounts.workshop,
    stockId: config.stocks.workshop,actorId: config.npcActorIds.workshop,locationKey: 'workshop' }) });
  const production = createTownProductionService({ ...deps,getSlice: business.getSlice });
  production.initializeResourceNode(cmd());
  const runner = createTownActionRunner({ db,clock,getWorldEpoch: registry.getWorldEpoch,getActor: registry.getActor,
    readFacts: action => ({ worldEpoch: scope.worldEpoch,actorId: action.actorId,targetExists: true,
      arrived: positions.get(action.actorId) === action.target,locationKey: positions.get(action.actorId),allowsAction: true }),
    leaseMs: 600000 });
  async function paidService(serviceKey) {
    let order = orders.publish(cmd()).order;
    for (const [method,key] of [['accept','board'],['pickup','supplier'],['complete','workshop']]) {
      positions.set(actorId,key);
      order = orders[method](cmd({ orderId: order.orderId,actorId,expectedVersion: order.version })).order;
    }
    let value = service.offer(cmd({ actorId, ...(serviceKey ? { serviceKey } : {}) }));
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
  return { db,registry,economy,production,service,clock,cmd,scope,config,positions,paidService,beginWork,finishWork,proofs,snapshot,account,
    advance: ms => { time += ms; } };
}

async function unlockBob(f) {
  const sessionId = await f.paidService();
  const batch = f.production.start(f.cmd({ sessionId })).production;
  f.production.complete(f.cmd({ productionId: batch.productionId,expectedVersion: batch.version,...f.proofs() }));
  return f.paidService('town.workshop.bob_cut');
}

test('real unlocked bob-cut settlement authorizes production without changing its recipe',async t => {
  const f = fixture(t), sessionId = await unlockBob(f);
  const receipt = JSON.parse(f.db.prepare('SELECT receipt_json FROM town_service_settlements WHERE session_id=?').get(sessionId).receipt_json);
  assert.equal(receipt.outcomeKey,'bob_cut');assert.equal(receipt.paid,30);
  assert.equal(receipt.payout,30);assert.equal(receipt.refund,0);
  const item = f.db.prepare('SELECT * FROM backpack_items WHERE id=?').get(receipt.itemIds[0]);
  assert.equal(item.template_id,'town.bob_cut');assert.equal(item.effect_key,'bob_cut');
  assert.equal(item.used_at,null);
  const input = f.cmd({ sessionId }), result = f.production.start(input);
  assert.equal(result.production.status,'reserved');assert.equal(f.account('workshop').reserved,30);
  assert.deepEqual(f.production.start(input),result);
  assert.throws(()=>f.production.start(f.cmd({ sessionId })),{code:'SERVICE_PRODUCTION_ALREADY_USED'});
  const completed = f.production.complete(f.cmd({productionId:result.production.productionId,
    expectedVersion:result.production.version,...f.proofs()}));
  assert.equal(completed.production.status,'completed');
  assert.equal(f.production.getResourceNode(f.scope).remaining,198);
});

test('bob-cut experience records only receiving the card and replay grants no new item or money',async t => {
  const f = fixture(t), sessionId = await unlockBob(f);
  migrateTownExperienceSchema(f.db);
  const store = createTownEventService({db:f.db,clock:f.clock,getWorldEpoch:f.registry.getWorldEpoch,
    validators:{'town.service.settled':()=>true}});
  const event = store.get(`service:${sessionId}:settled`);
  store.append(event,[TOWN_EXPERIENCE_CONSUMER]);
  const experience = createTownExperienceService({db:f.db,clock:f.clock,registry:f.registry});
  const before = f.snapshot();
  experience.drain(f.scope);
  const rows = f.db.prepare('SELECT * FROM town_experiences').all();
  assert.equal(rows.length,2);assert.ok(rows.every(row=>row.summary==='玩家在工坊获得了一张发型卡，服务已经结算。'));
  assert.deepEqual(f.snapshot(),before);
  f.db.prepare("UPDATE town_event_deliveries SET status='pending',attempts=0 WHERE event_id=?").run(event.eventId);
  experience.drain(f.scope);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_experiences').get().n,2);
  assert.deepEqual(f.snapshot(),before);
  assert.equal(f.db.prepare('SELECT count(*) n FROM backpack_items').get().n,2);
  assert.equal(f.db.prepare('SELECT count(*) n FROM backpack_items WHERE used_at IS NOT NULL').get().n,0);
});

test('bob-cut frozen definition and outcome resist mutation; mismatched grant source rejects experience',async t => {
  for (const change of ['definition','outcome','grant']) await t.test(change,async t => {
    const f = fixture(t), sessionId = await unlockBob(f);
    migrateTownExperienceSchema(f.db);
    const eventId = `service:${sessionId}:settled`;
    if (change==='definition') {
      const config = JSON.parse(f.db.prepare('SELECT config_json FROM town_service_sessions WHERE session_id=?').get(sessionId).config_json);
      config.template.templateId='town.mood_patch';
      assert.throws(()=>f.db.prepare('UPDATE town_service_sessions SET config_json=? WHERE session_id=?').run(JSON.stringify(config),sessionId),
        {code:'SQLITE_CONSTRAINT_TRIGGER'});
    } else if (change==='outcome') {
      const receipt = JSON.parse(f.db.prepare('SELECT receipt_json FROM town_service_settlements WHERE session_id=?').get(sessionId).receipt_json);
      receipt.outcomeKey='mood_patch';
      assert.throws(()=>f.db.prepare('UPDATE town_service_settlements SET receipt_json=? WHERE session_id=?').run(JSON.stringify(receipt),sessionId),
        {code:'SQLITE_CONSTRAINT_TRIGGER'});
    } else {
      f.db.prepare("UPDATE backpack_items SET source_id='another-service' WHERE template_id='town.bob_cut'").run();
    }
    const store = createTownEventService({db:f.db,clock:f.clock,getWorldEpoch:f.registry.getWorldEpoch,
      validators:{'town.service.settled':()=>true}});
    store.append(store.get(eventId),[TOWN_EXPERIENCE_CONSUMER]);
    const before = f.snapshot();
    createTownExperienceService({db:f.db,clock:f.clock,registry:f.registry}).drain(f.scope);
    assert.equal(f.db.prepare('SELECT count(*) n FROM town_experiences').get().n,change==='grant'?0:2);
    if(change==='grant') assert.equal(f.db.prepare('SELECT last_error FROM town_event_deliveries WHERE event_id=?').get(eventId).last_error,'EXPERIENCE_SOURCE_INVALID');
    assert.deepEqual(f.snapshot(),before);
  });
});


