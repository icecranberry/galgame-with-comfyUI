import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { createTownEventService } from '../src/services/town/townEventService.js';

function fixture(t) {
  const db=new Database(':memory:'); db.pragma('foreign_keys=ON'); t.after(()=>db.close()); migrateTownActionSchema(db);
  let now=100, epoch=1;
  const opts={db,clock:{now:()=>now},getWorldEpoch:()=>epoch,leaseMs:10,retryMs:5,maxAttempts:2,
    validators:{'test.event':p=>typeof p?.value==='number'}};
  const service=createTownEventService(opts);
  const event={eventId:'e1',worldId:'w',worldEpoch:1,type:'test.event',occurredAt:100,payload:{value:1}};
  return {db,service,event,claim:()=>service.claim({consumerKey:'c',worldId:'w',worldEpoch:epoch}),
    time:v=>{now=v;},epoch:v=>{epoch=v;},restart:()=>createTownEventService(opts)};
}

test('unique event/consumer, ordered cursor and strict payload conflict',t=>{
  const f=fixture(t); f.service.append(f.event,['c','c']); f.service.append(f.event,['c']);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_event_deliveries').get().n,1);
  assert.throws(()=>f.service.append({...f.event,payload:{value:2}}),{code:'IDEMPOTENCY_CONFLICT'});
  assert.throws(()=>f.service.append({...f.event,eventId:'bad',payload:{value:'x'}}),{code:'INVALID_EVENT_PAYLOAD'});
  const rows=f.service.list({worldId:'w',worldEpoch:1}); assert.equal(rows.length,1);
  assert.equal(f.service.list({worldId:'w',worldEpoch:1,cursor:rows[0].seq}).length,0);
});

test('lease reclaim rejects late ack; finite crash retries reach dead letter',t=>{
  const f=fixture(t); f.service.append(f.event,['c']); const first=f.claim(); assert.equal(f.claim(),null);
  f.time(110); const second=f.claim(); assert.equal(second.attempts,2);
  assert.throws(()=>f.service.ack(first),{code:'LEASE_LOST'});
  f.time(120); assert.equal(f.claim(),null);
  assert.equal(f.db.prepare('SELECT status FROM town_event_deliveries').get().status,'dead');
});

test('retry backoff, restart and exhaustion',t=>{
  const f=fixture(t); f.service.append(f.event,['c']); assert.equal(f.service.retry(f.claim(),'network'),'pending');
  assert.equal(f.claim(),null); f.time(105);
  const claim=f.restart().claim({consumerKey:'c',worldId:'w',worldEpoch:1});
  assert.equal(f.service.retry(claim,'network'),'dead'); f.time(1000); assert.equal(f.claim(),null);
});

test('consumer database effect and ack commit atomically, replay cannot duplicate result',t=>{
  const f=fixture(t); f.db.exec('CREATE TABLE effects(id TEXT PRIMARY KEY)'); f.service.append(f.event,['c']);
  const claim=f.claim();
  assert.throws(()=>f.service.consume(claim,(event,db)=>{
    db.prepare('INSERT INTO effects VALUES(?)').run(event.eventId); throw new Error('crash');
  }),/crash/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM effects').get().n,0);
  f.service.consume(claim,(event,db)=>db.prepare('INSERT INTO effects VALUES(?)').run(event.eventId));
  assert.throws(()=>f.service.ack(claim),{code:'LEASE_LOST'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM effects').get().n,1);
});

test('old epoch cannot append or consume; async effect rejected before invocation',t=>{
  const f=fixture(t); f.service.append(f.event,['c']); const claim=f.claim(); let invoked=false;
  assert.throws(()=>f.service.consume(claim,async()=>{invoked=true;}),{code:'ASYNC_EFFECT_FORBIDDEN'}); assert.equal(invoked,false);
  f.epoch(2); assert.throws(()=>f.service.ack(claim),{code:'STALE_EPOCH'});
  assert.throws(()=>f.service.append(f.event),{code:'STALE_EPOCH'}); assert.equal(f.claim(),null);
});

test('causation depth/fanout and presentation-only cannot spawn consequences',t=>{
  const f=fixture(t); f.service.append(f.event);
  for(let i=0;i<3;i++) f.service.append({...f.event,eventId:`child${i}`,rootEventId:'e1',causationId:'e1',depth:1});
  assert.throws(()=>f.service.append({...f.event,eventId:'child4',rootEventId:'e1',causationId:'e1',depth:1}),{code:'EVENT_FANOUT_LIMIT'});
  f.service.append({...f.event,eventId:'presentation',presentationOnly:true});
  assert.throws(()=>f.service.append({...f.event,eventId:'bad',rootEventId:'presentation',causationId:'presentation',depth:1}),{code:'INVALID_CAUSATION'});
});

test('omitted occurrence time is stable on replay and explicit dead letter retry retains event ID',t=>{
  const f=fixture(t); const {occurredAt,...input}=f.event;
  const original=f.service.append(input,['c']); f.time(101);
  assert.deepEqual(f.service.append(input,['c']),original);
  f.service.retry(f.claim(),'failed'); f.time(106); f.service.retry(f.claim(),'failed again');
  f.service.requeue({worldId:'w',worldEpoch:1,eventId:'e1',consumerKey:'c'});
  const claim=f.claim(); assert.equal(claim.event.eventId,'e1'); assert.equal(claim.attempts,1); f.service.ack(claim);
});
