import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { createServer } from 'node:http';
import express, { Router } from 'express';
import { appointmentFixture } from './fixtures/townAppointmentFixture.js';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { createEconomyService } from '../src/services/town/economyService.js';
import { createTownAppointmentService } from '../src/services/town/townAppointmentService.js';
import { createTownAppointmentAvailability } from '../src/services/town/townAppointmentAvailability.js';
import { buildLocationMatcher } from '../src/services/town/townLocationMatch.js';
import { createTownEventService } from '../src/services/town/townEventService.js';
import { listenLocalHttpServer, closeLocalHttpServer } from './fixtures/localHttpServer.js';

// Execute real runtime and router source with import boundaries injected. Never import
// the singleton DB, configuration, model clients, or the live movement runtime.
function isolatedModule(path, dependencies, exports) {
  const names=[];
  const source=readFileSync(new URL(path,import.meta.url),'utf8')
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g,(_,imports)=>{
      names.push(...imports.split(',').map(x=>x.trim()).filter(Boolean));return '';
    }).replace(/export (?=(?:async )?function )/g,'').replace(/export \{ router as default \};/,'');
  assert.doesNotMatch(source,/\bimport\s/);
  return compileFunction(`${source}\nreturn {${exports.join(',')}};`,[...names,'Date'])(
    ...names.map(name=>dependencies[name]??(()=>{throw new Error(`Unexpected dependency: ${name}`);})),dependencies.Date??Date);
}

async function fixture(t) {
  const f=appointmentFixture(t),{db}=f;
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,is_sleeping INTEGER);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER);
    CREATE TABLE town_locations(id INTEGER PRIMARY KEY,key TEXT,name TEXT,aliases_json TEXT);
    CREATE TABLE daily_schedules(character_id INTEGER,schedule_date TEXT,schedule_json TEXT);
    CREATE TABLE schedule_templates(character_id INTEGER,schedule_json TEXT);
    INSERT INTO characters VALUES(1,0); INSERT INTO town_characters VALUES(1,1);
    INSERT INTO town_locations VALUES(1,'workshop','工坊','[]');
    INSERT INTO schedule_templates VALUES(1,'[]');`);
  migrateTownSchema(db);
  db.exec("UPDATE town_world_state SET world_id='w'; UPDATE town_actors SET actor_id='player' WHERE player_id='me'; UPDATE town_actors SET actor_id='provider' WHERE character_id=1;");
  const broadcasts=[];
  const runtime=isolatedModule('../src/services/town/townEconomyRuntime.js',{
    getDb:()=>db,createTownActorRegistry,createEconomyService,createTownAppointmentService,createTownAppointmentAvailability,createTownEventService,
    buildLocationMatcher,config:{town:{timeZone:'Asia/Shanghai'}},
    broadcastTownStateUpdated:e=>broadcasts.push(e),Date:class extends Date {static now(){return f.clock.now();}}
  },['getTownAppointments','executeTownAppointment','getTownAppointmentRuntime','maintainTownAppointments']);
  const {router}=isolatedModule('../src/routes/town.js',{Router,...runtime},['router']);
  const app=express();app.use(express.json());app.use('/api/town',router);
  const server=createServer(app);
  const url=await listenLocalHttpServer(server);
  t.after(()=>closeLocalHttpServer(server));
  const base=`${url}/api/town/appointments`;
  async function request(path='',body) {
    const response=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  async function candidate() {f.seed();const response=await request();assert.equal(response.status,200);return response.body.candidates.at(-1);}
  const acceptBody=(c,extra={})=>({worldEpoch:1,idempotencyKey:'accept',expectedVersion:c.version,startAt:f.clock.now()+60000,...extra});
  return {...f,request,candidate,acceptBody,broadcasts,runtime};
}

test('real GET creates canonical candidates only; server ownership and true POST accept/retry/cancel',async t=>{
  const f=await fixture(t),c=await f.candidate();
  assert.equal(f.count('town_appointments'),0);
  const body=f.acceptBody(c,{actorId:'intruder',playerId:'someone',worldId:'evil',scope:{worldId:'evil',worldEpoch:999},locationKey:'fake'});
  const path=`/candidates/${c.candidateId}/accept`,accepted=await f.request(path,body);
  assert.equal(accepted.status,200);assert.equal(accepted.body.playerActorId,'player');assert.equal(accepted.body.scope.worldId,'w');
  assert.equal(accepted.body.locationKey,'workshop');assert.deepEqual(await f.request(path,body),accepted);
  const conflict=await f.request(path,{...body,startAt:body.startAt+1});assert.equal(conflict.status,409);assert.equal(conflict.body.code,'IDEMPOTENCY_CONFLICT');
  assert.equal(f.count('town_appointments'),1);
  const listed=await f.request('?playerId=intruder&worldEpoch=999');assert.equal(listed.status,200);
  assert.deepEqual(listed.body.appointments,[accepted.body]);
  const cancel={worldEpoch:1,expectedVersion:1,idempotencyKey:'cancel',actorId:'intruder'};
  const cancelled=await f.request(`/${accepted.body.appointmentId}/cancel`,cancel);
  assert.equal(cancelled.status,200);assert.equal(cancelled.body.status,'cancelled');
  assert.deepEqual(await f.request(`/${accepted.body.appointmentId}/cancel`,cancel),cancelled);
});

test('real POST rejects stale/missing epoch, invalid key/body and obsolete candidate IDs without writes',async t=>{
  const f=await fixture(t),c=await f.candidate(),path=`/candidates/${c.candidateId}/accept`;
  for(const changes of [{worldEpoch:0},{worldEpoch:'1'},{worldEpoch:undefined},{idempotencyKey:''},
    {idempotencyKey:' '.repeat(3)},{expectedVersion:99},{startAt:'tomorrow'}]) {
    const result=await f.request(path,f.acceptBody(c,changes));assert.ok([400,409].includes(result.status),JSON.stringify(result));
  }
  assert.equal(f.count('town_appointments'),0);assert.equal(f.count('town_appointment_requests'),0);
  const args=f.acceptBody(c);assert.equal((await f.request(path,args)).status,200);
  f.db.exec('UPDATE town_world_state SET epoch=2');
  assert.equal((await f.request(path,args)).body.code,'STALE_EPOCH');
  assert.equal((await f.request(path,{...args,worldEpoch:2})).body.code,'CANDIDATE_NOT_FOUND');
  const current=await f.request();assert.equal(current.status,200);assert.deepEqual(current.body.appointments,[]);
});

test('runtime availability uses future schedule and returns no false-free overlay',async t=>{
  const f=await fixture(t),c=await f.candidate();
  f.db.prepare('UPDATE schedule_templates SET schedule_json=?').run(JSON.stringify([
    {startTime:'00:00',endTime:'24:00',tags:['work'],location:'工坊',replyDelay:0}]));
  const result=await f.request(`/candidates/${c.candidateId}/accept`,f.acceptBody(c));
  assert.equal(result.status,409);assert.equal(result.body.code,'SCHEDULE_UNAVAILABLE');
  assert.equal(f.count('town_appointments'),0);assert.equal(f.count('daily_schedules'),0);
});

test('maintenance skips a refunded receipt and still offers the subsequent valid settlement',async t=>{
  const f=await fixture(t);f.seed({receipt:{refund:20}});const valid=f.seed();
  const response=await f.request();assert.equal(response.status,200);
  assert.deepEqual(response.body.candidates.map(c=>c.sourceEventId),[valid]);
});

test('invalid settlements cannot permanently starve the next valid candidate behind the maintenance batch limit',async t=>{
  const f=await fixture(t);
  for(let i=0;i<30;i++) f.seed({receipt:{refund:20}});
  const valid=f.seed();
  let response;
  for(let i=0;i<3;i++) response=await f.request();
  assert.equal(response.status,200);
  assert.ok(response.body.candidates.some(c=>c.sourceEventId===valid),'valid event behind 30 invalid receipts must be reachable');
  const skipped=f.db.prepare("SELECT * FROM town_event_deliveries WHERE consumer_key='town.appointment' AND last_error='APPOINTMENT_SOURCE_INVALID'").all();
  assert.equal(skipped.length,30);assert.ok(skipped.every(d=>d.status==='done'&&d.attempts===1));
  assert.equal(f.count('town_appointment_candidates'),1);assert.equal(f.count('town_appointments'),0);
});

const delivery=(f,eventId)=>f.db.prepare("SELECT * FROM town_event_deliveries WHERE event_id=? AND consumer_key='town.appointment'").get(eventId);

test('temporary location failure backs off, then creates exactly one candidate after recovery',async t=>{
  const f=await fixture(t),eventId=f.seed();f.db.exec('DELETE FROM town_locations');
  assert.equal((await f.request()).status,200);
  const pending=delivery(f,eventId);assert.equal(pending.status,'pending');assert.equal(pending.last_error,'LOCATION_UNAVAILABLE');
  assert.equal(pending.attempts,1);assert.equal(f.count('town_appointment_candidates'),0);
  await f.request();assert.equal(delivery(f,eventId).attempts,1);
  f.db.exec("INSERT INTO town_locations VALUES(1,'workshop','工坊','[]')");
  f.advance(pending.next_attempt_at-f.clock.now());
  const recovered=await f.request();assert.equal(recovered.status,200);assert.equal(recovered.body.candidates.length,1);
  assert.equal(delivery(f,eventId).status,'done');assert.equal(delivery(f,eventId).attempts,2);
  await f.request();assert.equal(f.count('town_appointment_candidates'),1);
});

test('temporary failures stop at the retry cap and are not automatically re-enqueued',async t=>{
  const f=await fixture(t),eventId=f.seed();f.db.exec('DELETE FROM town_locations');
  for(let attempt=1;attempt<=5;attempt++) {
    assert.equal((await f.request()).status,200);
    const row=delivery(f,eventId);assert.equal(row.attempts,attempt);
    if(attempt<5) {assert.equal(row.status,'pending');f.advance(row.next_attempt_at-f.clock.now());}
    else assert.equal(row.status,'dead');
  }
  f.db.exec("INSERT INTO town_locations VALUES(1,'workshop','工坊','[]')");f.advance(3600000);
  await f.request();assert.equal(delivery(f,eventId).status,'dead');assert.equal(f.count('town_appointment_candidates'),0);
});

test('expired queued source is terminal without candidate or overlay side effects',async t=>{
  const f=await fixture(t),eventId=f.seed();
  f.db.prepare("INSERT INTO town_event_deliveries(event_id,consumer_key,status,next_attempt_at) VALUES(?,'town.appointment','pending',0)").run(eventId);
  f.advance(7*86400000);
  assert.equal((await f.request()).status,200);
  assert.equal(delivery(f,eventId).status,'done');assert.equal(delivery(f,eventId).last_error,'CANDIDATE_EXPIRED');
  assert.equal(f.count('town_appointment_candidates'),0);assert.equal(f.count('town_appointments'),0);
});

test('reset isolates old pending and leased deliveries; old claim cannot publish in new epoch',async t=>{
  const f=await fixture(t),old=f.seed();f.db.exec('DELETE FROM town_locations');await f.request();
  const pending=delivery(f,old);f.advance(pending.next_attempt_at-f.clock.now());
  const registry=createTownActorRegistry(f.db),queue=createTownEventService({db:f.db,clock:f.clock,getWorldEpoch:registry.getWorldEpoch});
  const claim=queue.claim({...f.scope,consumerKey:'town.appointment'});assert.ok(claim);
  const snapshot=delivery(f,old);
  f.db.exec("UPDATE town_world_state SET epoch=2; INSERT INTO town_locations VALUES(1,'workshop','工坊','[]')");f.setEpoch(2);
  const fresh=f.seed();let called=false;
  assert.throws(()=>queue.consume(claim,()=>{called=true;}),e=>e.code==='STALE_EPOCH');assert.equal(called,false);
  const result=await f.request();assert.equal(result.status,200);
  assert.deepEqual(result.body.candidates.map(c=>c.sourceEventId),[fresh]);assert.deepEqual(delivery(f,old),snapshot);
  f.advance(60000);await f.request();assert.deepEqual(delivery(f,old),snapshot);
});

test('outbox completion and candidate creation share one transaction',async t=>{
  const f=await fixture(t),eventId=f.seed();
  f.db.exec("CREATE TRIGGER reject_appointment_ack BEFORE UPDATE ON town_event_deliveries WHEN NEW.consumer_key='town.appointment' AND NEW.status='done' BEGIN SELECT RAISE(ABORT,'ack fault'); END;");
  assert.equal((await f.request()).status,200);assert.equal(delivery(f,eventId).status,'pending');
  assert.equal(f.count('town_appointment_candidates'),0);
  f.db.exec('DROP TRIGGER reject_appointment_ack');f.advance(delivery(f,eventId).next_attempt_at-f.clock.now());
  assert.equal((await f.request()).body.candidates.length,1);assert.equal(delivery(f,eventId).status,'done');
});
