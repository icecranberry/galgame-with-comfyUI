import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {Worker} from 'node:worker_threads';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {migrateTownSchema} from '../src/db/townSchema.js';
import {migrateTownActionSchema} from '../src/db/townActionSchema.js';
import {migrateTownEconomySchema} from '../src/db/townEconomySchema.js';
import {migrateTownBusinessSchema} from '../src/db/townBusinessSchema.js';
import {migrateTownLiquidityPolicySchema} from '../src/db/townLiquidityPolicySchema.js';
import {createTownActorRegistry} from '../src/services/town/townActorRegistry.js';
import {createEconomyService} from '../src/services/town/economyService.js';
import {createTownBusinessService} from '../src/services/town/townBusinessService.js';
import {createTownOrderService} from '../src/services/town/townOrderService.js';
import {createTownLiquidityPolicy} from '../src/services/town/townLiquidityPolicy.js';

function fixture(t,filename=':memory:') {
  t.mock.method(globalThis,'fetch',()=>{throw Error('Network forbidden');});
  const db=new Database(filename);db.pragma('foreign_keys=ON');t.after(()=>{if(db.open)db.close();});
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY);CREATE TABLE town_characters(character_id INTEGER,town_enabled INTEGER);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER);
    INSERT INTO town_npcs VALUES(1,NULL,1),(2,NULL,1),(3,NULL,1);`);
  for(const migrate of [migrateTownSchema,migrateTownActionSchema,migrateTownEconomySchema,migrateTownBusinessSchema,migrateTownLiquidityPolicySchema])migrate(db);
  const registry=createTownActorRegistry(db),world=registry.getWorldState(),scope={worldId:world.worldId,worldEpoch:world.epoch};
  let time=Date.UTC(2026,8,8,2),seq=0;const clock={now:()=>time},locations=new Set(['board','supplier','workshop']);
  const position={getLocation:({locationKey})=>locations.has(locationKey)?{locationKey}:null,hasArrived:()=>true};
  const economy=createEconomyService({db,clock,getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor});
  const deps={db,clock,registry,economy,position};const business=createTownBusinessService(deps),orders=createTownOrderService(deps);
  const cmd=extra=>({...scope,idempotencyKey:`request:${++seq}`,sourceKey:`source:${seq}`,reasonCode:'TEST',...extra});
  const setup=()=>business.setup(cmd({npcActorIds:{commissioner:registry.resolveAgentKey('npc:1').actorId,
    supplier:registry.resolveAgentKey('npc:2').actorId,workshop:registry.resolveAgentKey('npc:3').actorId},
    locationKeys:{board:'board',supplier:'supplier',workshop:'workshop'}}));
  const config=setup();
  const create=(enabled=false)=>createTownLiquidityPolicy({...deps,enabled});
  const input=extra=>({...scope,actorId:config.playerActorId,idempotencyKey:`publish:${++seq}`,...extra});
  const fund=()=>economy.getAccount({...scope,accountId:config.accounts.fund});
  // Boundary fixture funds are transferred through the real ledger, never patched by SQL.
  const drainTo=amount=>economy.transfer(cmd({fromAccountId:config.accounts.fund,toAccountId:config.accounts.player,amount:fund().available-amount}));
  function expire(result) {time+=1800000;orders.expire(cmd({orderId:result.order.orderId,expectedVersion:result.order.version}));}
  const tables=['economy_accounts','town_resource_stocks','economy_transactions','economy_entries','economy_requests',
    'economy_reservations','town_resource_entries','town_delivery_orders','town_business_log','town_business_receipts',
    'town_business_requests','town_domain_events','town_liquidity_state','town_liquidity_authorizations','town_liquidity_issues','town_liquidity_requests'];
  const snapshot=()=>tables.map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
  return {db,economy,registry,scope,config,create,input,cmd,fund,drainTo,expire,snapshot,locations,setup,
    advance:ms=>{time+=ms;}};
}

test('default off never issues; enabled bridge preserves reserve and real stock/money holds',t=>{
  const f=fixture(t);f.drainTo(60);
  const off=f.create().publish(f.input());assert.equal(off.liquidity.issued,0);assert.equal(f.fund().available,30);
  f.expire(off);const result=f.create(true).publish(f.input());
  assert.equal(result.liquidity.issued,30);assert.equal(f.fund().available,60);assert.equal(f.fund().reserved,30);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_liquidity_issues').get().n,1);
  assert.equal(f.db.prepare('SELECT SUM(balance) n FROM economy_accounts').get().n,0);
  assert.equal(f.db.prepare("SELECT SUM(balance) n FROM economy_accounts WHERE account_type<>'issuance'").get().n,3430);
  assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
});

test('funds above target publish without issuance; max30 cannot rescue below60',t=>{
  const f=fixture(t),policy=f.create(true);f.drainTo(90);
  const result=policy.publish(f.input());assert.equal(result.liquidity.issued,0);assert.equal(f.fund().available,60);
  f.expire(result);f.drainTo(59);const before=f.snapshot();
  assert.throws(()=>policy.publish(f.input()),{code:'LIQUIDITY_RESERVE_REQUIRED'});assert.deepEqual(f.snapshot(),before);
});

test('late activation fails with explicit minimum60 code; default-off still publishes at30',t=>{
  const f=fixture(t);f.drainTo(30);const policy=f.create(true),before=f.snapshot();
  assert.deepEqual(policy.checkActivation(f.scope),{allowed:false,reason:'LIQUIDITY_ACTIVATION_RESERVE_REQUIRED',
    available:30,minimumAvailable:60,fundVersion:f.fund().version,policyVersion:0});
  assert.throws(()=>policy.publish(f.input()),{code:'LIQUIDITY_ACTIVATION_RESERVE_REQUIRED',available:30,minimumAvailable:60});
  assert.deepEqual(f.snapshot(),before);
  assert.equal(f.create().publish(f.input()).liquidity.issued,0);
});

test('getStatus is read-only, shares enforcement windows and uses live server switch',t=>{
  const f=fixture(t);f.drainTo(60);const policy=f.create(true),before=f.snapshot();
  f.db.pragma('query_only=ON');let status=policy.getStatus(f.scope);
  assert.equal(status.enabled,true);assert.equal(status.grossIssued,0);assert.equal(status.remainingWorldBudget,600);
  assert.equal(status.availableFund,60);assert.equal(status.activationAllowed,true);assert.equal(status.lastObservedAt,null);
  assert.deepEqual(f.snapshot(),before);f.db.pragma('query_only=OFF');
  policy.publish(f.input());status=policy.getStatus(f.scope);
  assert.equal(status.grossIssued,30);assert.equal(status.issued24h,30);assert.equal(status.issued7d,30);
  assert.equal(status.remainingWorldBudget,570);assert.equal(status.availableFund,60);
  assert.equal(f.create(false).getStatus(f.scope).enabled,false,'DTO reflects current config, not last stored observation');
  f.advance(-1);assert.equal(policy.getStatus(f.scope).issued24h,30);
  f.advance(86400001);assert.equal(policy.getStatus(f.scope).issued24h,0);assert.equal(policy.getStatus(f.scope).issued7d,30);
  f.advance(6*86400000);assert.equal(policy.getStatus(f.scope).issued7d,0);assert.equal(policy.getStatus(f.scope).grossIssued,30);
  f.registry.advanceEpoch({expectedEpoch:f.scope.worldEpoch});f.scope.worldEpoch++;
  status=policy.getStatus(f.scope);assert.equal(status.availableFund,null);assert.equal(status.activationAllowed,false);
  assert.equal(status.remainingWorldBudget,570);
});

test('request replay survives restart, conflicting payload and stale CAS cannot issue',t=>{
  const f=fixture(t);f.drainTo(70);const input=f.input({expectedFundVersion:f.fund().version,expectedPolicyVersion:0});
  const result=f.create(true).publish(input);assert.equal(result.liquidity.issued,20);const before=f.snapshot();
  assert.deepEqual(f.create(true).publish(input),result);assert.deepEqual(f.snapshot(),before);
  assert.throws(()=>f.create(true).publish({...input,expectedFundVersion:999}),{code:'IDEMPOTENCY_CONFLICT'});
  assert.throws(()=>f.create(true).publish(f.input({expectedFundVersion:1})),{code:'VERSION_CONFLICT'});
  assert.throws(()=>f.create(true).publish(f.input({expectedPolicyVersion:0})),{code:'VERSION_CONFLICT'});
  assert.deepEqual(f.snapshot(),before);
});

test('stock shortage, missing location and late policy receipt failure roll back publish and issuance',t=>{
  const f=fixture(t);f.drainTo(60);const policy=f.create(true);
  const hold=f.economy.reserveStock(f.cmd({stockId:f.config.stocks.supplier,amount:20,ownerRef:'test:scarcity'})).reservation;
  let before=f.snapshot();assert.throws(()=>policy.publish(f.input()),{code:'INSUFFICIENT_STOCK'});assert.deepEqual(f.snapshot(),before);
  f.economy.releaseStock(f.cmd({reservationId:hold.reservationId,expectedVersion:hold.version}));
  f.locations.delete('supplier');before=f.snapshot();assert.throws(()=>policy.publish(f.input()),{code:'LOCATION_UNAVAILABLE'});assert.deepEqual(f.snapshot(),before);
  f.locations.add('supplier');f.db.exec("CREATE TRIGGER fail_policy BEFORE INSERT ON town_liquidity_requests BEGIN SELECT RAISE(ABORT,'injected receipt failure');END");
  before=f.snapshot();assert.throws(()=>policy.publish(f.input()),/injected receipt failure/);assert.deepEqual(f.snapshot(),before);
  f.db.exec('DROP TRIGGER fail_policy');assert.equal(policy.publish(f.input()).liquidity.issued,30);
});

test('clock rollback pauses, elapsed24h resumes, long offline jump never catches up issuance',t=>{
  const f=fixture(t),policy=f.create(true);f.drainTo(60);
  const first=policy.publish(f.input());f.expire(first);f.drainTo(60);
  f.advance(-3600000);let before=f.snapshot();assert.throws(()=>policy.publish(f.input()),{code:'LIQUIDITY_CLOCK_ROLLBACK'});assert.deepEqual(f.snapshot(),before);
  f.advance(3600000);before=f.snapshot();assert.throws(()=>policy.publish(f.input()),{code:'LIQUIDITY_COOLDOWN'});assert.deepEqual(f.snapshot(),before);
  f.advance(86400000-1800000);const second=policy.publish(f.input());assert.equal(second.liquidity.issued,30);
  f.expire(second);f.drainTo(60);f.advance(90*86400000);
  assert.equal(policy.publish(f.input()).liquidity.issued,30);
  assert.equal(f.db.prepare('SELECT SUM(amount) n FROM town_liquidity_issues').get().n,90);
});

test('grossworld600 never resets across epochs and cooldown survives schema reapplication',t=>{
  const f=fixture(t);f.drainTo(60);
  for(let i=0;i<20;i++) {
    const result=f.create(true).publish(f.input());assert.equal(result.liquidity.issued,30);
    f.expire(result);f.drainTo(60);f.advance(86400000-1800000);
    if(i===6)assert.equal(f.db.prepare('SELECT SUM(amount) n FROM town_liquidity_issues').get().n,210);
  }
  assert.equal(f.db.prepare('SELECT SUM(amount) n FROM town_liquidity_issues').get().n,600);
  migrateTownLiquidityPolicySchema(f.db);const oldScope={...f.scope};
  f.registry.advanceEpoch({expectedEpoch:f.scope.worldEpoch});f.scope.worldEpoch++;f.setup();
  const before=f.snapshot();
  assert.throws(()=>f.create(true).publish(f.input({...oldScope})),{code:'STALE_EPOCH'});
  assert.throws(()=>f.create(true).publish(f.input()),{code:'LIQUIDITY_CAP'});assert.deepEqual(f.snapshot(),before);
});

test('epoch change and reinitialization do not reset the last issuance cooldown',t=>{
  const f=fixture(t);f.drainTo(60);f.expire(f.create(true).publish(f.input()));f.drainTo(60);
  f.registry.advanceEpoch({expectedEpoch:f.scope.worldEpoch});f.scope.worldEpoch++;f.setup();migrateTownLiquidityPolicySchema(f.db);
  const before=f.snapshot();assert.throws(()=>f.create(true).publish(f.input()),{code:'LIQUIDITY_COOLDOWN'});assert.deepEqual(f.snapshot(),before);
});

test('circulation includes all ordinary and escrow wallets, issuance stops at4000',t=>{
  const f=fixture(t);f.drainTo(60);
  f.economy.seed(f.cmd({accountId:f.config.accounts.player,amount:590,seedVersion:77}));
  const before=f.snapshot();assert.throws(()=>f.create(true).publish(f.input()),{code:'LIQUIDITY_CIRCULATION_CAP'});assert.deepEqual(f.snapshot(),before);
});

test('trusted issuer rejects missing transaction/proof and altered real holds, replay cannot mint twice',t=>{
  const f=fixture(t);f.drainTo(60);
  assert.throws(()=>f.economy.issueLiquidity(f.cmd({authorizationId:'fake'})),{code:'LIQUIDITY_TRANSACTION_REQUIRED'});
  assert.throws(()=>f.db.transaction(()=>f.economy.issueLiquidity(f.cmd({authorizationId:'fake'})))(),{code:'LIQUIDITY_PROOF_INVALID'});
  const original=f.economy.issueLiquidity;let issueInput;
  f.economy.issueLiquidity=input=>{
    issueInput=input;
    f.economy.transfer(f.cmd({fromAccountId:f.config.accounts.fund,toAccountId:f.config.accounts.player,amount:1}));
    return original(input);
  };
  const before=f.snapshot();assert.throws(()=>f.create(true).publish(f.input()),{code:'LIQUIDITY_PROOF_INVALID'});assert.deepEqual(f.snapshot(),before);
  f.economy.issueLiquidity=input=>{issueInput=input;return original(input);};
  const result=f.create(true).publish(f.input());const balance=f.fund().balance;
  const replay=f.db.transaction(()=>original({...issueInput,idempotencyKey:'new-request',sourceKey:'new-source'}))();
  assert.equal(replay.transactionId,result.liquidity.receipt.transactionId);assert.equal(f.fund().balance,balance);
});

test('two SQLite WAL workers contend for last daily grant, then same request replays once',async t=>{
  const tempRoot=resolve(tmpdir()),dir=mkdtempSync(join(tempRoot,'town-liquidity-'));
  const filename=join(dir,'policy.sqlite');
  const f=fixture(t,filename);f.db.pragma('journal_mode=WAL');f.drainTo(60);
  const scope={...f.scope},actorId=f.config.playerActorId;f.db.close();
  const urls={registry:new URL('../src/services/town/townActorRegistry.js',import.meta.url).href,
    economy:new URL('../src/services/town/economyService.js',import.meta.url).href,
    policy:new URL('../src/services/town/townLiquidityPolicy.js',import.meta.url).href};
  const source=`const {parentPort,workerData:d}=require('node:worker_threads');
    (async()=>{const Database=require('better-sqlite3');const db=new Database(d.filename);db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000');
    const {createTownActorRegistry}=await import(d.urls.registry);const {createEconomyService}=await import(d.urls.economy);
    const {createTownLiquidityPolicy}=await import(d.urls.policy);const registry=createTownActorRegistry(db),clock={now:()=>Date.UTC(2026,8,8,2)};
    const economy=createEconomyService({db,clock,getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor});
    const position={getLocation:({locationKey})=>({locationKey}),hasArrived:()=>true};
    const policy=createTownLiquidityPolicy({db,clock,registry,economy,position,enabled:true});
    const gate=new Int32Array(d.gate);parentPort.postMessage({ready:true});Atomics.wait(gate,0,0);
    try {parentPort.postMessage({ok:true,result:policy.publish({...d.scope,actorId:d.actorId,idempotencyKey:d.key})});}
    catch(e){parentPort.postMessage({ok:false,code:e.code,message:e.message});}finally{db.close();}
    })().catch(e=>{parentPort.postMessage({fatal:e.stack});});`;
  const workers=[];
  async function race(keys) {
    const gate=new SharedArrayBuffer(4);let ready=0;
    const results=keys.map(key=>new Promise((resolveResult,reject)=>{
      const worker=new Worker(source,{eval:true,workerData:{filename,scope,actorId,urls,key,gate}});workers.push(worker);
      worker.on('error',reject);worker.on('message',message=>{
        if(message.ready){if(++ready===keys.length){Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0);}}
        else if(message.fatal)reject(Error(message.fatal));else resolveResult(message);
      });
    }));
    return Promise.all(results);
  }
  try {
    const first=await race(['race-a','race-b']);assert.equal(first.filter(r=>r.ok).length,1);
    assert.equal(first.find(r=>!r.ok).code,'LIQUIDITY_COOLDOWN');
    const winningKey=first[0].ok?'race-a':'race-b';
    const replay=await race([winningKey,winningKey]);assert.ok(replay.every(r=>r.ok));
    assert.equal(replay[0].result.order.orderId,replay[1].result.order.orderId);
    const db=new Database(filename);
    try {assert.equal(db.prepare('SELECT SUM(amount) n FROM town_liquidity_issues').get().n,30);
      assert.equal(db.prepare('SELECT count(*) n FROM town_delivery_orders').get().n,1);assert.deepEqual(db.pragma('foreign_key_check'),[]);}
    finally {db.close();}
  } finally {
    await Promise.all(workers.map(w=>w.terminate()));
    if(!resolve(dir).startsWith(tempRoot+sep)||!resolve(filename).startsWith(resolve(dir)+sep))throw Error('Unsafe fixture cleanup');
    rmSync(dir,{recursive:true,force:true});
  }
});
