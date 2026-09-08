import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {migrateTownSchema} from '../src/db/townSchema.js';
import {migrateTownActionSchema} from '../src/db/townActionSchema.js';
import {migrateTownEconomySchema} from '../src/db/townEconomySchema.js';
import {migrateTownBusinessSchema} from '../src/db/townBusinessSchema.js';
import {migrateTownItemTemplateSchema} from '../src/db/townItemTemplateSchema.js';
import {migrateTownServiceSessionSchema} from '../src/db/townServiceSessionSchema.js';
import {createTownActorRegistry} from '../src/services/town/townActorRegistry.js';
import {createEconomyService} from '../src/services/town/economyService.js';
import {createTownBusinessService} from '../src/services/town/townBusinessService.js';
import {createTownOrderService} from '../src/services/town/townOrderService.js';
import {createItemTemplateService} from '../src/services/town/itemTemplateService.js';
import {createTownServiceSessionService} from '../src/services/town/townServiceSessionService.js';
import {migrateTownProductionSchema} from '../src/db/townProductionSchema.js';
import {createTownProductionService} from '../src/services/town/townProductionService.js';
import {createTownActionRunner} from '../src/services/town/townActionRunner.js';
import {createTownEventService} from '../src/services/town/townEventService.js';

// Business feasibility baseline, deliberately no test-authored money/material transfers.
// The position adapter supplies arrival facts; this is not a movement/runtime test.
function fixture(t) {
  t.mock.method(globalThis,'fetch',()=>{throw new Error('Network forbidden');});
  const db=new Database(':memory:');t.after(()=>db.close());db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    INSERT INTO town_npcs VALUES(1,NULL,1),(2,NULL,1),(3,NULL,1);
    CREATE TABLE backpack_items(id INTEGER PRIMARY KEY AUTOINCREMENT,effect_key TEXT,name TEXT,description TEXT,
      rarity TEXT,image_url TEXT,status TEXT,payload_json TEXT,collected_at TEXT,acquired_at TEXT,used_at TEXT);
    CREATE TABLE item_effects(id INTEGER PRIMARY KEY,item_id INTEGER);`);
  for(const migrate of [migrateTownSchema,migrateTownActionSchema,migrateTownEconomySchema,
    migrateTownBusinessSchema,migrateTownItemTemplateSchema,migrateTownServiceSessionSchema,migrateTownProductionSchema])migrate(db);
  const registry=createTownActorRegistry(db),world=registry.getWorldState();
  const scope={worldId:world.worldId,worldEpoch:world.epoch};
  let time=Date.UTC(2026,8,8,2),sequence=0;
  const clock={now:()=>time},positions=new Map(),places=new Set(['board','supplier','workshop']);
  const position={getLocation:({locationKey})=>places.has(locationKey)?{locationKey}:null,
    hasArrived:({actorId,locationKey})=>positions.get(actorId)===locationKey,isServiceOpen:()=>true};
  const cmd=extra=>({...scope,idempotencyKey:`audit:${++sequence}`,sourceKey:`audit:${sequence}`,...extra});
  const economy=createEconomyService({db,clock,getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor});
  const dependencies={db,clock,registry,economy,position},business=createTownBusinessService(dependencies);
  const config=business.setup(cmd({npcActorIds:{commissioner:registry.resolveAgentKey('npc:1').actorId,
    supplier:registry.resolveAgentKey('npc:2').actorId,workshop:registry.resolveAgentKey('npc:3').actorId},
    locationKeys:{board:'board',supplier:'supplier',workshop:'workshop'}}));
  const actorId=config.playerActorId;positions.set(config.npcActorIds.workshop,'workshop');
  positions.set(config.npcActorIds.supplier,'supplier');
  const orders=createTownOrderService(dependencies);
  const itemTemplates=createItemTemplateService({db,clock,getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor,
    effectRegistry:{mood_fix:{kind:'mood'},energy:{kind:'buff'}}});
  const services=createTownServiceSessionService({...dependencies,itemTemplates,
    getWorkshop:()=>({accountId:config.accounts.workshop,stockId:config.stocks.workshop,
      actorId:config.npcActorIds.workshop,locationKey:'workshop'})});
  const production=createTownProductionService(dependencies);
  production.initializeResourceNode(cmd());
  const runner=createTownActionRunner({db,clock,getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor,
    leaseMs:600000,readFacts:a=>({worldEpoch:scope.worldEpoch,actorId:a.actorId,targetExists:true,
      arrived:positions.get(a.actorId)===a.target,locationKey:positions.get(a.actorId),allowsAction:true})});
  function prepareProduction(sessionId) {
    const batch=production.start(cmd({sessionId})).production;
    const actions=['supplier','workshop'].map(role=>{
      let action=runner.create(cmd({actorId:config.npcActorIds[role],type:'work_shift',
        target:config.locationKeys[role],payload:{durationMs:300000}}));
      action=runner.reserve(cmd({actionId:action.id,expectedVersion:action.version}));
      return runner.start(cmd({actionId:action.id,expectedVersion:action.version}));
    });
    time+=300000;
    for(const action of actions)assert.equal(runner.advance(cmd({actionId:action.id,expectedVersion:action.version})).phase,'completed');
    return cmd({productionId:batch.productionId,expectedVersion:batch.version,
      supplierActionId:actions[0].id,workshopActionId:actions[1].id});
  }
  function delivery() {
    let order=orders.publish(cmd()).order;
    for(const [method,place] of [['accept','board'],['pickup','supplier'],['complete','workshop']]) {
      positions.set(actorId,place);
      const input=cmd({actorId,orderId:order.orderId,expectedVersion:order.version});
      const result=orders[method](input);
      assert.deepEqual(orders[method](input),result,'business replay must not pay twice');
      order=result.order;
    }
  }
  async function service() {
    positions.set(actorId,'workshop');let value=services.offer(cmd({actorId}));
    try { value=services.accept(cmd({actorId,sessionId:value.sessionId,expectedVersion:value.version})); }
    catch(error) {
      services.cancel(cmd({actorId,sessionId:value.sessionId,expectedVersion:value.version}));throw error;
    }
    for(const intentKey of ['choose_theme','confirm_materials','craft','deliver']) {
      const input={...scope,actorId,sessionId:value.sessionId,expectedVersion:value.version,
        clientTurnId:`turn:${++sequence}`,intentKey};
      value=await services.turn(input);
    }
    assert.equal(value.status,'completed');
    return value.sessionId;
  }
  const account=role=>economy.getAccount({...scope,accountId:config.accounts[role]});
  const stock=role=>economy.getStock({...scope,stockId:config.stocks[role]});
  function check() {
    assert.equal(db.prepare('SELECT SUM(balance) n FROM economy_accounts').get().n,0);
    assert.equal(db.prepare("SELECT SUM(balance) n FROM economy_accounts WHERE account_type<>'issuance'").get().n,3400);
    assert.equal(db.prepare('SELECT count(*) n FROM (SELECT transaction_id FROM economy_entries GROUP BY transaction_id HAVING SUM(amount)<>0)').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM economy_reservations WHERE remaining<>0').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM town_resource_stocks WHERE quantity<reserved OR reserved<0').get().n,0);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  }
  return {db,delivery,service,account,stock,check,economy,production,prepareProduction,scope,cmd,config,registry,
    orders,services,positions,clock,nextDay:()=>{time+=86400000;},advance:ms=>{time+=ms;}};
}

for(const mode of ['delivery-and-service','hoard-wages','consume-only','offline']) {
  test(`90 real business days without production: ${mode} reports unmet demand, not economic balance`,async t=>{
    const f=fixture(t),report={mode,days:90,deliveries:0,services:0,firstDeliveryFailureDay:null,
      failures:{},fundBelowNextRewardDays:0,supplierEmptyDays:0,workshopEmptyDays:0};
    async function attempt(kind,day,fn) {
      try {await fn();report[kind]++;}
      catch(error) {
        assert.ok(['INSUFFICIENT_FUNDS','INSUFFICIENT_STOCK'].includes(error.code),error.stack);
        const key=`${kind}:${error.code}`;report.failures[key]=(report.failures[key]||0)+1;
        if(kind==='deliveries')report.firstDeliveryFailureDay??=day;
      }
    }
    for(let day=1;day<=90;day++) {
      if(['delivery-and-service','hoard-wages'].includes(mode))await attempt('deliveries',day,f.delivery);
      if(['delivery-and-service','consume-only'].includes(mode))await attempt('services',day,f.service);
      report.fundBelowNextRewardDays+=Number(f.account('fund').available<30);
      report.supplierEmptyDays+=Number(f.stock('supplier').quantity===0);
      report.workshopEmptyDays+=Number(f.stock('workshop').quantity===0);
      f.check();f.nextDay();
    }
    report.balances=Object.fromEntries(['fund','player','supplier','workshop'].map(role=>[role,f.account(role).balance]));
    report.inventory={supplier:f.stock('supplier').quantity,workshop:f.stock('workshop').quantity,
      granted:f.db.prepare('SELECT count(*) n FROM backpack_items').get().n};
    t.diagnostic(JSON.stringify(report));
    if(mode==='delivery-and-service'||mode==='hoard-wages') {
      assert.equal(report.deliveries,20);assert.equal(report.firstDeliveryFailureDay,21);
      assert.equal(report.failures['deliveries:INSUFFICIENT_STOCK'],70);
      assert.equal(report.balances.fund,1400);
    }
    if(mode==='delivery-and-service') {
      assert.equal(report.services,20);assert.equal(report.inventory.granted,20);
      assert.equal(report.failures['services:INSUFFICIENT_FUNDS'],70);
      assert.equal(report.balances.workshop,1000);assert.equal(report.balances.player,0);
    }
    if(mode==='hoard-wages')assert.equal(report.balances.player,600);
    if(mode==='consume-only')assert.equal(report.failures['services:INSUFFICIENT_FUNDS'],90);
    if(mode==='offline')assert.deepEqual(report.failures,{});
  });
}

test('90 days of real delivery, paid service and two-worker production expose fund drift',async t=>{
  const f=fixture(t),report={days:90,deliveries:0,services:0,productions:0,failures:{}};
  for(let day=1;day<=90;day++) {
    f.delivery();report.deliveries++;
    const sessionId=await f.service();report.services++;
    const input=f.prepareProduction(sessionId),result=f.production.complete(input);
    assert.equal(result.production.status,'completed');report.productions++;
    assert.deepEqual(f.production.complete(input),result);
    f.check();f.nextDay();
  }
  report.balances=Object.fromEntries(['fund','player','supplier','workshop'].map(role=>[role,f.account(role).balance]));
  report.workerBalances=f.db.prepare("SELECT balance FROM economy_accounts WHERE account_type='actor' AND owner_key<>? ORDER BY balance")
    .all(`actor:${f.config.playerActorId}`).map(r=>r.balance);
  report.nodeRemaining=f.production.getResourceNode(f.scope).remaining;
  report.supplierStock=f.stock('supplier').quantity;
  t.diagnostic(JSON.stringify(report));
  assert.deepEqual(report.balances,{fund:1100,player:0,supplier:1140,workshop:400});
  assert.deepEqual(report.workerBalances,[180,180]);
  assert.equal(report.nodeRemaining,110);assert.equal(report.supplierStock,20);
  assert.equal(f.db.prepare("SELECT count(*) n FROM economy_transactions WHERE command='produceStock'").get().n,90);
});

test('90 consumption-only days after five earned wages exhaust wealth without new income',async t=>{
  const f=fixture(t);for(let i=0;i<5;i++)f.delivery();
  let successes=0,insufficientFunds=0;
  for(let day=1;day<=90;day++) {
    try {await f.service();successes++;}
    catch(error) {assert.equal(error.code,'INSUFFICIENT_FUNDS');insufficientFunds++;}
    f.check();f.nextDay();
  }
  assert.equal(successes,5);assert.equal(insufficientFunds,85);
  assert.equal(f.account('fund').balance,1850);assert.equal(f.account('workshop').balance,550);
  t.diagnostic(JSON.stringify({mode:'consume-earned-150',days:90,successes,insufficientFunds,player:0,fund:1850,workshop:550}));
});

test('single workshop stockout rejects escrow atomically despite solvent player and supplier',async t=>{
  const f=fixture(t),actorId=f.config.playerActorId;f.delivery();f.delivery();
  // Real pre-delivery cancellations consume material and charge the documented 10 fee.
  for(let i=0;i<2;i++) {
    let s=f.services.offer(f.cmd({actorId}));
    s=f.services.accept(f.cmd({actorId,sessionId:s.sessionId,expectedVersion:s.version}));
    for(const intentKey of ['choose_theme','confirm_materials','craft'])s=await f.services.turn({...f.scope,actorId,
      sessionId:s.sessionId,expectedVersion:s.version,clientTurnId:`short:${i}:${intentKey}`,intentKey});
    f.services.cancel(f.cmd({actorId,sessionId:s.sessionId,expectedVersion:s.version}));
  }
  assert.equal(f.stock('workshop').quantity,0);assert.equal(f.stock('supplier').quantity,18);
  assert.equal(f.account('player').balance,40);
  await assert.rejects(f.service(),{code:'INSUFFICIENT_STOCK'});
  assert.equal(f.account('player').balance,40);f.check();
  t.diagnostic('workshop shortage=1; player40 and supplier18 remain; failed accept leaves no escrow/reserve');
});

test('unreachable provider blocks service; unreachable production worker cannot spend reserved budget',async t=>{
  const f=fixture(t);f.delivery();f.positions.delete(f.config.npcActorIds.workshop);
  await assert.rejects(f.service(),{code:'NOT_ARRIVED'});assert.equal(f.account('player').balance,30);
  f.positions.set(f.config.npcActorIds.workshop,'workshop');
  const input=f.prepareProduction(await f.service());
  f.positions.delete(f.config.npcActorIds.supplier);
  assert.throws(()=>f.production.complete(input),{code:'NOT_ARRIVED'});
  assert.equal(f.production.getResourceNode(f.scope).remaining,200);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_production_proofs').get().n,0);
  f.production.cancel(f.cmd({productionId:input.productionId,expectedVersion:input.expectedVersion}));f.check();
  t.diagnostic('provider arrival failures=1; production arrival failures=1; cancelled batch releases30 and node1, pays no wages');
});

test('90 days offline after cargo pickup expires custody without wages or lost inventory',t=>{
  const f=fixture(t),actorId=f.config.playerActorId;
  let order=f.orders.publish(f.cmd()).order;
  for(const [method,key] of [['accept','board'],['pickup','supplier']]) {
    f.positions.set(actorId,key);order=f.orders[method](f.cmd({actorId,orderId:order.orderId,expectedVersion:order.version})).order;
  }
  f.advance(90*86400000);
  assert.equal(f.account('fund').reserved,30,'no background scheduler was executed while offline');
  const input=f.cmd({orderId:order.orderId,expectedVersion:order.version});
  assert.equal(f.orders.expire(input).order.status,'expired');f.orders.expire(input);
  assert.equal(f.stock('supplier').quantity,20);assert.equal(f.account('player').balance,0);f.check();
  t.diagnostic('offline90d: recovery expires1 unpaid order, returns1 cargo and releases30; no offline grant');
});

test('sudden 25-order demand promises only the 20 real available cargo units',t=>{
  const f=fixture(t),orders=[];let shortages=0;
  for(let i=0;i<25;i++) {
    try {orders.push(f.orders.publish(f.cmd()).order);}
    catch(error) {assert.equal(error.code,'INSUFFICIENT_STOCK');shortages++;}
  }
  assert.equal(orders.length,20);assert.equal(shortages,5);assert.equal(f.account('fund').reserved,600);
  assert.equal(f.stock('supplier').reserved,20);
  f.advance(1800000);
  for(const order of orders)f.orders.expire(f.cmd({orderId:order.orderId,expectedVersion:order.version}));
  f.check();assert.equal(f.account('fund').balance,2000);
  t.diagnostic('burst25: promised20 backed by600/20stock, rejected5 shortage, expired20 unpaid; zero empty promises');
});

test('repeated persisted events do not execute business issuance again',async t=>{
  const f=fixture(t);f.delivery();f.production.complete(f.prepareProduction(await f.service()));
  const events=createTownEventService({db:f.db,clock:f.clock,getWorldEpoch:f.registry.getWorldEpoch,
    validators:{'town.economy.changed':()=>true,'town.delivery.changed':()=>true,'town.service.settled':()=>true,
      'town.production.changed':()=>true,'town.action.changed':()=>true}});
  const rows=f.db.prepare('SELECT envelope FROM town_domain_events').all();
  const before=f.db.prepare('SELECT * FROM economy_transactions ORDER BY transaction_id').all();
  for(let repeat=0;repeat<3;repeat++)for(const row of rows)events.append(JSON.parse(row.envelope));
  assert.deepEqual(f.db.prepare('SELECT * FROM economy_transactions ORDER BY transaction_id').all(),before);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_domain_events').get().n,rows.length);
  f.check();t.diagnostic(`persisted event replay count=${rows.length*3}; new ledger entries=0 (transport replay only)`);
});

test('clock rollback retains holds; large forward jump expires production rather than awarding it',async t=>{
  const f=fixture(t);f.delivery();const input=f.prepareProduction(await f.service());
  f.advance(-600000);
  assert.throws(()=>f.production.complete(input),{code:'INVALID_WORK_PROOF'});
  assert.equal(f.account('workshop').reserved,30);
  f.advance(90*86400000);
  assert.throws(()=>f.production.complete(input),{code:'PRODUCTION_EXPIRED'});
  f.production.expire(f.cmd({productionId:input.productionId,expectedVersion:input.expectedVersion}));
  f.check();assert.equal(f.production.getResourceNode(f.scope).remaining,200);
  t.diagnostic('rollback rejects future proof; forward90d expires1 production, output0, wages0, budget30 released');
});

test('produceStock requires outer transaction and rejects missing proofs or undebited node',async t=>{
  const f=fixture(t);f.delivery();const input=f.prepareProduction(await f.service());
  const output=f.cmd({stockId:f.config.stocks.supplier,amount:1,productionId:input.productionId,reasonCode:'TEST'});
  assert.throws(()=>f.economy.produceStock(output),{code:'PRODUCTION_TRANSACTION_REQUIRED'});
  assert.throws(()=>f.db.transaction(()=>f.economy.produceStock(output))(),{code:'INVALID_PRODUCTION_OUTPUT'});
  const original=f.economy.produceStock;
  f.economy.produceStock=value=>{
    // Fault injection undoes the debit made by the real production service.
    f.db.prepare('UPDATE town_production_nodes SET remaining=remaining+1,reserved=reserved+1 WHERE world_id=?').run(f.scope.worldId);
    return original(value);
  };
  assert.throws(()=>f.production.complete(input),{code:'INVALID_PRODUCTION_OUTPUT'});
  assert.equal(f.production.getResourceNode(f.scope).remaining,200);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_production_proofs').get().n,0);
  f.economy.produceStock=original;f.production.complete(input);f.check();
});

test('production identity cannot mint twice with new request/source; conflicts and old epoch reject',async t=>{
  const f=fixture(t);f.delivery();const input=f.prepareProduction(await f.service());
  const original=f.economy.produceStock;let output,receipt;
  f.economy.produceStock=value=>{output=value;receipt=original(value);return receipt;};
  f.production.complete(input);const before=f.stock('supplier').quantity;
  const replay={...output,idempotencyKey:'new-request',sourceKey:'new-source'};
  assert.deepEqual(f.db.transaction(()=>original(replay))(),receipt);
  assert.equal(f.stock('supplier').quantity,before);
  assert.throws(()=>f.db.transaction(()=>original({...output,amount:2}))(),{code:'IDEMPOTENCY_CONFLICT'});
  assert.throws(()=>f.db.transaction(()=>original({...replay,idempotencyKey:'another',amount:2}))(),{code:'SOURCE_CONFLICT'});
  f.registry.advanceEpoch({expectedEpoch:f.scope.worldEpoch});
  assert.throws(()=>f.db.transaction(()=>original(replay))(),{code:'STALE_EPOCH'});
  assert.throws(()=>f.db.transaction(()=>original({...replay,worldEpoch:f.scope.worldEpoch+1}))(),{code:'INVALID_PRODUCTION_OUTPUT'});
});
