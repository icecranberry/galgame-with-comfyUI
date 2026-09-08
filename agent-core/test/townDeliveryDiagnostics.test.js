import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { createTownEventService } from '../src/services/town/townEventService.js';
import { createTownDeliveryDiagnostics, migrateTownDeliveryDiagnosticsSchema } from '../src/services/town/townDeliveryDiagnostics.js';

function fixture(t) {
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');migrateTownActionSchema(db);migrateTownDeliveryDiagnosticsSchema(db);
  db.exec(`CREATE TABLE money(amount INTEGER);INSERT INTO money VALUES(100);
    CREATE TABLE items(id INTEGER);INSERT INTO items VALUES(1);`);
  t.after(()=>{assert.deepEqual(db.prepare('SELECT * FROM money').all(),[{amount:100}]);
    assert.deepEqual(db.prepare('SELECT * FROM items').all(),[{id:1}]);assert.deepEqual(db.pragma('foreign_key_check'),[]);db.close();});
  let time=100,epoch=1,seq=0;
  const scope={worldId:'w',worldEpoch:1},clock={now:()=>time},registry={getWorldEpoch:w=>w==='w'?epoch:null};
  const queue=createTownEventService({db,clock,getWorldEpoch:registry.getWorldEpoch,
    validators:{'town.service.settled':()=>true,'town.delivery.changed':()=>true}});
  const create=()=>createTownDeliveryDiagnostics({db,clock,registry}),service=create();
  const seed=(status='dead',consumers=['town.appointment'],lastError='LOCATION_UNAVAILABLE')=>{
    const eventId=`e${++seq}`;
    queue.append({eventId,worldId:'w',worldEpoch:epoch,type:'town.service.settled',
      payload:{persona:'PRIVATE PERSONA',sql:'SELECT SECRET FROM secret'},occurredAt:time},consumers);
    db.prepare('UPDATE town_event_deliveries SET status=?,attempts=5,last_error=? WHERE event_id=?').run(status,lastError,eventId);
    return eventId;
  };
  const row=(eventId,consumer='town.appointment')=>db.prepare('SELECT * FROM town_event_deliveries WHERE event_id=? AND consumer_key=?').get(eventId,consumer);
  return {db,scope,service,create,queue,seed,row,setEpoch:n=>{epoch=n;},advance:ms=>{time+=ms;}};
}
const rejects=(run,code)=>assert.throws(run,e=>e.code===code&&!/SELECT|PRIVATE/.test(e.message));

test('list contains only allowlisted current nonterminal summaries and redacts raw errors/payload',t=>{
  const f=fixture(t);
  f.seed('dead',['town.appointment'],'SQLITE_ERROR SELECT PRIVATE');
  f.seed('pending',['town.experience']);f.seed('processing');f.seed('done');f.seed('dead',['evil.consumer']);
  const rows=f.service.list({scope:f.scope}).items;
  assert.equal(rows.length,3);assert.equal(rows[0].lastErrorCode,'DELIVERY_FAILED');
  assert.equal(rows[0].consumerName,'回访预约');assert.equal(rows[1].consumerName,'经历记录');
  assert.equal(rows[1].nextRetryAt,100);assert.equal(rows[2].nextRetryAt,null);
  assert.equal(rows[0].sourceType,'town.service.settled');assert.equal(rows[0].occurredAt,100);
  assert.deepEqual(Object.keys(rows[0]).sort(),['eventId','consumerKey','consumerName','status','attempts','nextRetryAt','lastErrorCode','sourceType','occurredAt'].sort());
  assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|SELECT|persona|envelope|lease_token/);
  migrateTownDeliveryDiagnosticsSchema(f.db);assert.equal(f.service.list({scope:f.scope}).items.length,3);
});

test('compound pagination does not lose second consumer on the same event; limits validate',t=>{
  const f=fixture(t);f.seed('dead',['town.experience','town.appointment']);f.seed();
  const ids=[];let cursor=null;
  do {const page=f.service.list({scope:f.scope,cursor,limit:1});ids.push(...page.items.map(x=>x.eventId+x.consumerKey));cursor=page.nextCursor;} while(cursor);
  assert.equal(new Set(ids).size,3);
  for(const limit of [0,101,1.5,'1']) rejects(()=>f.service.list({scope:f.scope,limit}),'INVALID_PAGE');
  for(const cursor of [1,{}, {seq:1,consumerKey:'evil'}, {seq:-1,consumerKey:'town.appointment'}]) {
    rejects(()=>f.service.list({scope:f.scope,cursor}),'INVALID_PAGE');
  }
});

test('requeue uses original event, persists duplicate-click idempotency across service recreation',t=>{
  const f=fixture(t),eventId=f.seed(),before=f.db.prepare('SELECT * FROM town_domain_events').all();
  const args={scope:f.scope,eventId,consumerKey:'town.appointment',idempotencyKey:'click1'};
  const result=f.service.requeue(args);assert.equal(result.requeued,true);
  assert.equal(f.row(eventId).status,'pending');assert.equal(f.row(eventId).attempts,0);
  f.advance(1);assert.deepEqual(f.create().requeue(args),result);assert.equal(f.row(eventId).next_attempt_at,100);
  assert.deepEqual(f.db.prepare('SELECT * FROM town_domain_events').all(),before);
  const second=f.seed();rejects(()=>f.service.requeue({...args,eventId:second}),'IDEMPOTENCY_CONFLICT');
});

test('optional key deduplicates; a later dead cycle requires a new explicit key',t=>{
  const f=fixture(t),eventId=f.seed(),args={scope:f.scope,eventId,consumerKey:'town.appointment'};
  const result=f.service.requeue(args);assert.deepEqual(f.service.requeue(args),result);
  f.db.prepare("UPDATE town_event_deliveries SET status='dead',attempts=5 WHERE event_id=?").run(eventId);
  assert.deepEqual(f.create().requeue(args),result);assert.equal(f.row(eventId).status,'dead');
  f.service.requeue({...args,idempotencyKey:'new-cycle'});assert.equal(f.row(eventId).status,'pending');
});

test('new keys reject active/done; original key always replays without changing current delivery state',t=>{
  const f=fixture(t),dead=f.seed();
  rejects(()=>f.service.requeue({scope:f.scope,eventId:dead,consumerKey:'evil.consumer'}),'CONSUMER_NOT_ALLOWED');
  for(const status of ['pending','processing','done']) {
    const eventId=f.seed(status);rejects(()=>f.service.requeue({scope:f.scope,eventId,consumerKey:'town.appointment'}),status==='done'?'DELIVERY_DONE':'DELIVERY_ACTIVE');
  }
  const args={scope:f.scope,eventId:dead,consumerKey:'town.appointment',idempotencyKey:'retry'};const original=f.service.requeue(args);
  const claim=f.queue.claim({...f.scope,consumerKey:'town.appointment'});assert.equal(claim.event.eventId,dead);
  const processing=f.row(dead);assert.deepEqual(f.create().requeue(args),original);assert.deepEqual(f.row(dead),processing);
  rejects(()=>f.service.requeue({...args,idempotencyKey:'new'}),'DELIVERY_ACTIVE');f.queue.ack(claim);
  const done=f.row(dead);assert.deepEqual(f.create().requeue(args),original);assert.deepEqual(f.row(dead),done);
  rejects(()=>f.service.requeue({...args,idempotencyKey:'new'}),'DELIVERY_DONE');assert.equal(f.row(dead).status,'done');
});

test('actual completed delivery source keeps its canonical type without exposing envelope payload',t=>{
  const f=fixture(t);f.queue.append({eventId:'delivery',...f.scope,type:'town.delivery.changed',
    payload:{status:'completed',persona:'PRIVATE'},occurredAt:100},['town.experience']);
  const item=f.service.list({scope:f.scope}).items[0];
  assert.equal(item.sourceType,'town.delivery.changed');assert.equal(item.occurredAt,100);
  assert.doesNotMatch(JSON.stringify(item),/PRIVATE|payload|envelope|persona/);
});

test('old worlds and epochs neither list nor requeue; old event ID cannot cross scope',t=>{
  const f=fixture(t),eventId=f.seed(),args={scope:f.scope,eventId,consumerKey:'town.appointment'};
  const foreign={worldId:'other',worldEpoch:1};rejects(()=>f.service.list({scope:foreign}),'STALE_EPOCH');
  rejects(()=>f.service.requeue({...args,scope:foreign}),'STALE_EPOCH');
  f.setEpoch(2);rejects(()=>f.service.list({scope:f.scope}),'STALE_EPOCH');rejects(()=>f.service.requeue(args),'STALE_EPOCH');
  const scope={worldId:'w',worldEpoch:2};assert.deepEqual(f.service.list({scope}).items,[]);
  rejects(()=>f.service.requeue({...args,scope}),'DELIVERY_NOT_FOUND');assert.equal(f.row(eventId).status,'dead');
});

test('request-record failure rolls requeue back and returns no SQL details',t=>{
  const f=fixture(t),eventId=f.seed(),args={scope:f.scope,eventId,consumerKey:'town.appointment'};
  f.db.exec("CREATE TRIGGER reject_retry BEFORE INSERT ON town_delivery_retry_requests BEGIN SELECT RAISE(ABORT,'SELECT PRIVATE'); END;");
  rejects(()=>f.service.requeue(args),'DELIVERY_UNAVAILABLE');assert.equal(f.row(eventId).status,'dead');
  assert.equal(f.row(eventId).attempts,5);f.db.exec('DROP TRIGGER reject_retry');assert.equal(f.service.requeue(args).requeued,true);
});
