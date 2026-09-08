import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateTownAppointmentSchema } from '../src/db/townAppointmentSchema.js';
import { migrateTownEconomySchema } from '../src/db/townEconomySchema.js';
import { createEconomyService } from '../src/services/town/economyService.js';
import { createItemTemplateService } from '../src/services/town/itemTemplateService.js';
import { createTownServiceSessionService } from '../src/services/town/townServiceSessionService.js';
import { TOWN_APPOINTMENT_HORIZON_MS as WEEK,
  TOWN_APPOINTMENT_DURATION_MS as HALF } from '../src/services/town/townAppointmentService.js';

import { appointmentFixture as fixture } from './fixtures/townAppointmentFixture.js';

const throws=(run,code)=>assert.throws(run,e=>e.code===code);

test('durable settlement offers exactly one candidate, no action until explicit acceptance',t=>{
  const f=fixture(t), sourceEventId=f.seed(), c=f.service.offerFromSettlement({scope:f.scope,sourceEventId});
  assert.deepEqual(f.service.offerFromSettlement({scope:f.scope,sourceEventId}),c);
  migrateTownAppointmentSchema(f.db);
  assert.deepEqual(f.service.listCandidates(f.scope),[c]); assert.equal(c.price,0);
  assert.equal(f.count('town_appointments'),0); assert.equal(f.calls.length,0);
  assert.deepEqual(f.service.getActiveForActor({scope:f.scope,actorId:'provider'}),[]);
  throws(()=>f.service.listCandidates(f.scope,'someone'),'APPOINTMENT_NOT_OWNED');
});

test('refunds, prose, inconsistent receipts and noncanonical events cannot offer appointments',async t=>{
  for (const options of [{receipt:{refund:20}},{receipt:{status:'cancelled'}},{receipt:{paid:0}},
    {receipt:{itemIds:[]}},{receipt:{settlementId:'fake'}},{event:{type:'town.dialogue'}},
    {event:{presentationOnly:true}},{event:{locationKey:'elsewhere'}},{event:{source:{system:'chat',entityId:'s1'}}}]) {
    await t.test(JSON.stringify(options),t=>{const f=fixture(t);throws(()=>f.offer(options),'APPOINTMENT_SOURCE_INVALID');
      assert.equal(f.count('town_appointment_candidates'),0);});
  }
});

test('requires existing linked provider and server resolved me owner',t=>{
  const f=fixture(t); f.flags.linked=false;
  throws(()=>f.offer(),'PROVIDER_NOT_LINKED'); assert.equal(f.count('town_appointment_candidates'),0);
  f.flags.linked=true; throws(()=>f.offer({player:'stranger'}),'APPOINTMENT_NOT_OWNED');
});

test('accept has stable replay, payload conflict and candidate CAS; fixed workshop and duration',t=>{
  const f=fixture(t),c=f.offer(),args=f.input(c),a=f.service.accept({...args,locationKey:'fake',characterId:999,endAt:999});
  assert.equal(a.locationKey,'workshop'); assert.equal(a.characterId,1); assert.equal(a.endAt-a.startAt,HALF);
  assert.deepEqual(f.service.accept(args),a); assert.equal(f.count('town_appointments'),1);
  throws(()=>f.service.accept({...args,startAt:args.startAt+1}),'IDEMPOTENCY_CONFLICT');
  throws(()=>f.service.accept(f.input(c)),'VERSION_CONFLICT');
  assert.equal(f.calls.length,2); assert.deepEqual(f.calls.map(x=>x.actorId),['player','provider']);
  assert.ok(f.calls.every(x=>x.startAt===a.startAt&&x.endAt===a.endAt));
  assert.equal(f.service.getActiveForActor({scope:f.scope,actorId:'provider'})[0].overridesBaseSchedule,false);
  assert.deepEqual(f.service.getActiveForActor({scope:f.scope,actorId:'other'}),[]);
});

test('past and beyond seven days reject; seven days is only an upper bound',t=>{
  const f=fixture(t), c=f.offer();
  for(const delta of [-1,WEEK+1]) throws(()=>f.service.accept(f.input(c,{startAt:f.clock.now()+delta})),'INVALID_APPOINTMENT_TIME');
  f.flags.free=()=>false;
  throws(()=>f.service.accept(f.input(c,{startAt:c.expiresAt-HALF})),'SCHEDULE_UNAVAILABLE');
  f.flags.free=true;
  throws(()=>f.service.accept(f.input(c,{startAt:c.expiresAt-HALF+1})),'INVALID_APPOINTMENT_TIME');
  const a=f.service.accept(f.input(c,{startAt:c.expiresAt-HALF}));
  assert.equal(a.endAt,c.expiresAt);
});

test('availability accepts only boolean true, never unknown or truthy objects',async t=>{
  for (const value of [false,undefined,null,1,'free',{available:true}, {available:false,reason:'sleep'},
    {available:false,reason:'off_town'}, {available:false,reason:'work'}]) {
    await t.test(String(JSON.stringify(value)),t=>{const f=fixture(t),c=f.offer();f.flags.free=value;
      throws(()=>f.service.accept(f.input(c)),'SCHEDULE_UNAVAILABLE');assert.equal(f.count('town_appointments'),0);
      assert.equal(f.service.listCandidates(f.scope)[0].version,1);});
  }
});

test('checks provider as well as player; changed original schedule suppresses accepted facts',t=>{
  const f=fixture(t),c=f.offer();f.flags.free=args=>args.actorId==='player';
  throws(()=>f.service.accept(f.input(c)),'SCHEDULE_UNAVAILABLE');
  f.flags.free=true; f.service.accept(f.input(c)); f.flags.free=false;
  assert.deepEqual(f.service.getActiveForActor({scope:f.scope,actorId:'player'}),[]);
  assert.equal(f.db.prepare('SELECT status FROM town_appointments').get().status,'accepted');
});

test('same player across providers conflicts; adjacent half-open intervals are allowed',t=>{
  const f=fixture(t),a=f.service.accept(f.input(f.offer())),c=f.offer({provider:'other'});
  throws(()=>f.service.accept(f.input(c,{startAt:a.endAt-1})),'APPOINTMENT_CONFLICT');
  assert.equal(f.service.accept(f.input(c,{startAt:a.endAt})).startAt,a.endAt);
  assert.deepEqual(f.service.getActiveForActor({scope:f.scope,actorId:'provider',at:a.endAt}),[]);
});

test('cancel is CAS and idempotent, frees interval without reoffering consumed candidate',t=>{
  const f=fixture(t),a=f.service.accept(f.input(f.offer()));
  const args={scope:f.scope,appointmentId:a.appointmentId,expectedVersion:a.version,idempotencyKey:'cancel'};
  throws(()=>f.service.cancel({...args,expectedVersion:9}),'VERSION_CONFLICT');
  const cancelled=f.service.cancel(args);assert.equal(cancelled.status,'cancelled');
  assert.deepEqual(f.service.cancel(args),cancelled);
  throws(()=>f.service.cancel({...args,idempotencyKey:'next'}),'VERSION_CONFLICT');
  assert.equal(f.service.accept(f.input(f.offer())).status,'accepted');
});

test('deleted or recreated original workshop and lost character link cannot activate',t=>{
  const f=fixture(t),c=f.offer();
  for(const id of [null,2]) {f.flags.locationId=id;throws(()=>f.service.accept(f.input(c)),'LOCATION_UNAVAILABLE');}
  f.flags.locationId=1;f.flags.linked=false;throws(()=>f.service.accept(f.input(c)),'PROVIDER_NOT_LINKED');
  f.flags.linked=true;f.service.accept(f.input(c));f.flags.locationId=2;
  assert.deepEqual(f.service.getActiveForActor({scope:f.scope,actorId:'provider'}),[]);
});

test('expire removes facts at end and candidates at deadline, repeat cleanup is a no-op',t=>{
  const f=fixture(t);f.service.accept(f.input(f.offer()));const c=f.offer();f.advance(HALF);
  assert.deepEqual(f.service.getActiveForActor({scope:f.scope,actorId:'player'}),[]);
  assert.deepEqual(f.service.expire({scope:f.scope}),{candidates:0,appointments:1});
  f.advance(WEEK-HALF);throws(()=>f.service.accept(f.input(c)),'CANDIDATE_EXPIRED');
  assert.deepEqual(f.service.listCandidates(f.scope),[]);
  assert.deepEqual(f.service.expire({scope:f.scope}),{candidates:1,appointments:0});
  assert.deepEqual(f.service.expire({scope:f.scope}),{candidates:0,appointments:0});
});

test('rebuild cancels old overlays; old epoch and other world never replay or activate',t=>{
  const f=fixture(t),c=f.offer(),args=f.input(c);f.service.accept(args);f.offer();
  assert.deepEqual(f.service.cancelForRebuild({scope:f.scope}),{candidates:1,appointments:1});
  assert.deepEqual(f.service.cancelForRebuild({scope:f.scope}),{candidates:0,appointments:0});
  f.setEpoch(2);throws(()=>f.service.accept(args),'STALE_EPOCH');
  const scope={worldId:'w',worldEpoch:2};throws(()=>f.service.accept({...args,scope}),'CANDIDATE_NOT_FOUND');
  assert.deepEqual(f.service.getActiveForActor({scope,actorId:'player'}),[]);
  throws(()=>f.service.listCandidates({worldId:'other',worldEpoch:2}),'STALE_EPOCH');
});

test('overlay failure rolls candidate CAS and idempotency record back atomically',t=>{
  const f=fixture(t),c=f.offer(),args=f.input(c);
  f.db.exec("CREATE TRIGGER reject_overlay BEFORE INSERT ON town_appointments BEGIN SELECT RAISE(ABORT,'fixture fault'); END;");
  assert.throws(()=>f.service.accept(args),/fixture fault/);
  assert.equal(f.service.listCandidates(f.scope)[0].version,1);assert.equal(f.count('town_appointment_requests'),0);
  f.db.exec('DROP TRIGGER reject_overlay'); assert.equal(f.service.accept(args).status,'accepted');
});

test('async availability is rejected before any appointment write',t=>{
  const f=fixture(t),c=f.offer();f.flags.free=()=>Promise.resolve(true);
  throws(()=>f.service.accept(f.input(c)),'ASYNC_ADAPTER_FORBIDDEN');assert.equal(f.count('town_appointments'),0);
});

test('receipt requires matching durable item grant; used or retired items remain valid evidence',async t=>{
  for(const mutation of ["source_id='unrelated'","world_id='other'","template_id='other'","template_version=2",
    "source_type='gift'"]) await t.test(mutation,t=>{
    const f=fixture(t),sourceEventId=f.seed();f.db.exec(`UPDATE backpack_items SET ${mutation}`);
    throws(()=>f.service.offerFromSettlement({scope:f.scope,sourceEventId}),'APPOINTMENT_SOURCE_INVALID');
  });
  for(const status of ['used','retired']) await t.test(status,t=>{
    const f=fixture(t),sourceEventId=f.seed();
    f.db.prepare("UPDATE backpack_items SET status=?,retired_at='2026-09-08'").run(status);
    const c=f.service.offerFromSettlement({scope:f.scope,sourceEventId});
    assert.equal(f.service.accept(f.input(c)).status,'accepted');
  });
});

test('late acceptance cannot extend attendance to fourteen days after settlement',t=>{
  const f=fixture(t),c=f.offer();f.advance(WEEK-HALF);
  throws(()=>f.service.accept(f.input(c,{startAt:f.clock.now()+1})),'INVALID_APPOINTMENT_TIME');
  assert.equal(f.service.accept(f.input(c)).endAt,c.expiresAt);
});

test('listAppointments returns current/future DTOs plus only latest 20 closed, scoped to me',t=>{
  const f=fixture(t);
  for(let i=0;i<22;i++) {
    const a=f.service.accept(f.input(f.offer()));
    f.service.cancel({scope:f.scope,appointmentId:a.appointmentId,expectedVersion:1,idempotencyKey:`close${i}`});
    f.advance(1);
  }
  const active=f.service.accept(f.input(f.offer()));
  const future=f.service.accept(f.input(f.offer(),{startAt:active.endAt}));
  const before=f.count('town_appointment_requests'), rows=f.service.listAppointments(f.scope);
  assert.equal(rows.length,22);assert.deepEqual(rows.slice(0,2),[active,future]);
  assert.ok(rows.slice(2).every(x=>x.status==='cancelled'&&x.version===2));
  assert.equal(f.count('town_appointment_requests'),before);
  throws(()=>f.service.listAppointments(f.scope,'other'),'APPOINTMENT_NOT_OWNED');
  f.setEpoch(2);throws(()=>f.service.listAppointments(f.scope),'STALE_EPOCH');
  assert.deepEqual(f.service.listAppointments({worldId:'w',worldEpoch:2}),[]);
});

test('real workshop settlement receipt produces a free overlay without new money or item operations',async t=>{
  const f=fixture(t),{db,clock,registry,scope}=f;
  migrateTownEconomySchema(db);
  const economy=createEconomyService({db,clock,getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor});
  const player=economy.ensureAccount({...scope,ownerKey:'actor:player',actorId:'player',accountType:'actor'});
  const shop=economy.ensureAccount({...scope,ownerKey:'workshop',accountType:'business'});
  const stock=economy.ensureStock({...scope,ownerKey:'workshop',resourceKey:'delivery:raw_material'});
  economy.seed({...scope,accountId:player.accountId,amount:100,idempotencyKey:'money',sourceKey:'money',reasonCode:'FIXTURE'});
  economy.seedStock({...scope,stockId:stock.stockId,amount:10,idempotencyKey:'stock',sourceKey:'stock',reasonCode:'FIXTURE'});
  const itemTemplates=createItemTemplateService({db,clock,getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor,
    effectRegistry:{mood_fix:{kind:'mood'},energy:{kind:'buff'}}});
  const workshop=createTownServiceSessionService({db,clock,registry,economy,itemTemplates,
    position:{getLocation:({locationKey})=>({locationKey}),hasArrived:()=>true,isServiceOpen:()=>true},
    getWorkshop:()=>({accountId:shop.accountId,stockId:stock.stockId,actorId:'provider',locationKey:'workshop'})});
  let value=workshop.offer({...scope,actorId:'player',idempotencyKey:'offer'});
  value=workshop.accept({...scope,actorId:'player',idempotencyKey:'accept',sessionId:value.sessionId,expectedVersion:value.version});
  for(const intentKey of ['choose_theme','confirm_materials','craft','deliver']) value=await workshop.turn({
    ...scope,actorId:'player',sessionId:value.sessionId,expectedVersion:value.version,clientTurnId:intentKey,intentKey});
  assert.equal(value.status,'completed');
  const before={transactions:f.count('economy_transactions'),items:f.count('backpack_items')};
  const c=f.service.offerFromSettlement({scope,sourceEventId:value.settlement.eventId});
  assert.equal(f.service.accept(f.input(c)).price,0);
  assert.deepEqual({transactions:f.count('economy_transactions'),items:f.count('backpack_items')},before);
});
