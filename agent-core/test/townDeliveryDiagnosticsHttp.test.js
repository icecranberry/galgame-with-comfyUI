import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { createServer } from 'node:http';
import express, { Router } from 'express';
import Database from 'better-sqlite3';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { createEconomyService } from '../src/services/town/economyService.js';
import { createTownEventService } from '../src/services/town/townEventService.js';
import { createTownDeliveryDiagnostics, migrateTownDeliveryDiagnosticsSchema } from '../src/services/town/townDeliveryDiagnostics.js';
import { listenLocalHttpServer, closeLocalHttpServer } from './fixtures/localHttpServer.js';

// Real runtime/router source, only imports injected; no production singleton initialization.
function isolatedModule(path,dependencies,exports) {
  const names=[];
  const source=readFileSync(new URL(path,import.meta.url),'utf8')
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g,(_,imports)=>{
      names.push(...imports.split(',').map(x=>x.trim()).filter(Boolean));return '';
    }).replace(/export (?=(?:async )?function )/g,'').replace(/export \{ router as default \};/,'');
  assert.doesNotMatch(source,/\bimport\s/);
  return compileFunction(`${source}\nreturn {${exports.join(',')}};`,names)(...names.map(name=>
    dependencies[name]??(()=>{throw new Error(`Unexpected dependency: ${name}`);})));
}

async function fixture(t) {
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER);
    CREATE TABLE fixture_money(amount INTEGER);INSERT INTO fixture_money VALUES(100);
    CREATE TABLE fixture_items(id INTEGER);INSERT INTO fixture_items VALUES(1);`);
  migrateTownSchema(db);migrateTownActionSchema(db);migrateTownDeliveryDiagnosticsSchema(db);
  db.exec("UPDATE town_world_state SET world_id='w'");
  const registry=createTownActorRegistry(db),scope={worldId:'w',worldEpoch:1};
  const queue=createTownEventService({db,clock:{now:Date.now},getWorldEpoch:registry.getWorldEpoch,
    validators:{'town.delivery.changed':()=>true}});
  const runtime=isolatedModule('../src/services/town/townEconomyRuntime.js',{
    getDb:()=>db,createTownActorRegistry,createEconomyService,createTownDeliveryDiagnostics,
    broadcastTownStateUpdated:()=>{},
  },['getTownDeliveryDiagnostics','retryTownDelivery']);
  const {router}=isolatedModule('../src/routes/town.js',{Router,...runtime},['router']);
  const app=express();app.use(express.json());app.use('/api/town',router);
  const server=createServer(app);const url=await listenLocalHttpServer(server);
  t.after(async()=>{await closeLocalHttpServer(server);
    assert.deepEqual(db.prepare('SELECT * FROM fixture_money').all(),[{amount:100}]);
    assert.deepEqual(db.prepare('SELECT * FROM fixture_items').all(),[{id:1}]);db.close();});
  const base=`${url}/api/town/deliveries`;
  let seq=0;
  function seed(status='dead',consumers=['town.appointment']) {
    const eventId=`event-${++seq}`;
    queue.append({...scope,worldEpoch:registry.getWorldState().epoch,eventId,type:'town.delivery.changed',
      payload:{status:'completed',persona:'SECRET PERSONA'}},consumers);
    db.prepare("UPDATE town_event_deliveries SET status=?,attempts=5,last_error='SQLITE_ERROR SELECT SECRET' WHERE event_id=?").run(status,eventId);
    return eventId;
  }
  async function request(path='',body) {
    const response=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  const args=(eventId,extra={})=>({worldEpoch:1,eventId,consumerKey:'town.appointment',idempotencyKey:'retry',...extra});
  const row=id=>db.prepare("SELECT * FROM town_event_deliveries WHERE event_id=? AND consumer_key='town.appointment'").get(id);
  return {db,scope,queue,seed,request,args,row};
}

test('GET summaries redact errors and payload; compound route cursor retains both consumers',async t=>{
  const f=await fixture(t);f.seed('dead',['town.experience','town.appointment']);f.seed('done');f.seed('pending',['evil']);
  const first=await f.request('?limit=1&worldId=evil&worldEpoch=999');assert.equal(first.status,200);
  assert.equal(first.body.worldId,'w');assert.equal(first.body.worldEpoch,1);assert.equal(first.body.items.length,1);
  const item=first.body.items[0];assert.equal(item.sourceType,'town.delivery.changed');assert.equal(item.lastErrorCode,'DELIVERY_FAILED');
  assert.doesNotMatch(JSON.stringify(first.body),/SECRET|SELECT|envelope|persona|lease_token/);
  const {seq,consumerKey}=first.body.nextCursor;
  const next=await f.request(`?limit=1&cursorSeq=${seq}&cursorConsumer=${encodeURIComponent(consumerKey)}`);
  assert.equal(next.status,200);assert.equal(next.body.items[0].eventId,item.eventId);
  assert.notEqual(next.body.items[0].consumerKey,item.consumerKey);assert.equal(next.body.nextCursor,null);
});

test('HTTP validates pagination, mandatory stable key, consumer and epoch without requeue',async t=>{
  const f=await fixture(t),id=f.seed();
  for(const query of ['?limit=0','?limit=101','?limit=no','?cursorSeq=1','?cursorConsumer=town.appointment','?cursorSeq=1&cursorConsumer=evil']) {
    const r=await f.request(query);assert.equal(r.status,400);assert.equal(r.body.code,'INVALID_PAGE');
  }
  for(const extra of [{idempotencyKey:undefined},{idempotencyKey:''},{idempotencyKey:' '},{consumerKey:'evil'},
    {worldEpoch:undefined},{worldEpoch:0},{worldEpoch:'1'}]) {
    const r=await f.request('/retry',f.args(id,extra));assert.ok([400,409].includes(r.status),JSON.stringify(r));
  }
  assert.equal(f.row(id).status,'dead');assert.equal(f.row(id).attempts,5);
});

test('same HTTP key remains stable after processing and done, new keys cannot replay business',async t=>{
  const f=await fixture(t),id=f.seed(),args=f.args(id,{worldId:'evil',scope:{worldId:'evil',worldEpoch:999}});
  const before=f.db.prepare('SELECT * FROM town_domain_events').all();
  const original=await f.request('/retry',args);assert.equal(original.status,200);assert.equal(original.body.worldId,'w');
  assert.deepEqual(await f.request('/retry',args),original);assert.equal(f.row(id).attempts,0);
  const claim=f.queue.claim({...f.scope,consumerKey:'town.appointment'});assert.ok(claim);
  const processing=f.row(id);assert.deepEqual(await f.request('/retry',args),original);assert.deepEqual(f.row(id),processing);
  assert.equal((await f.request('/retry',{...args,idempotencyKey:'new'})).body.code,'DELIVERY_ACTIVE');
  f.queue.ack(claim);const done=f.row(id);assert.deepEqual(await f.request('/retry',args),original);assert.deepEqual(f.row(id),done);
  assert.equal((await f.request('/retry',{...args,idempotencyKey:'new'})).body.code,'DELIVERY_DONE');
  assert.deepEqual(f.db.prepare('SELECT * FROM town_domain_events').all(),before);
  const other=f.seed();assert.equal((await f.request('/retry',{...args,eventId:other})).body.code,'IDEMPOTENCY_CONFLICT');
});

test('reset hides old deliveries and refuses old-key replay or old-event requeue under new epoch',async t=>{
  const f=await fixture(t),id=f.seed(),args=f.args(id);assert.equal((await f.request('/retry',args)).status,200);
  f.db.exec('UPDATE town_world_state SET epoch=2');
  assert.equal((await f.request('/retry',args)).body.code,'STALE_EPOCH');
  assert.equal((await f.request('/retry',{...args,worldEpoch:2})).body.code,'DELIVERY_NOT_FOUND');
  const listed=await f.request();assert.equal(listed.status,200);assert.deepEqual(listed.body.items,[]);
  assert.equal(f.row(id).status,'pending');
});

test('HTTP hides raw SQL errors and rolls back failed diagnostic request persistence',async t=>{
  const f=await fixture(t),id=f.seed();
  f.db.exec("CREATE TRIGGER reject_diagnostic BEFORE INSERT ON town_delivery_retry_requests BEGIN SELECT RAISE(ABORT,'SELECT SECRET FROM private'); END;");
  const result=await f.request('/retry',f.args(id));assert.equal(result.body.code,'DELIVERY_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result.body),/SELECT|SECRET|private/);assert.equal(f.row(id).status,'dead');
});
