import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => {
  if (String(url).endsWith('/object_info')) return { ok: true,json: async () => ({}) };
  throw new Error('Network forbidden in appointment runtime fixture');
};
const { config } = await import('../src/config.js');
const { getDb,closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const runtime = await import('../src/services/town/townEconomyRuntime.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const schedules = await import('../src/services/scheduleManager.js');

async function fixture(t) {
  let now = Date.parse('2026-09-08T10:00:00+08:00');
  t.mock.method(Date,'now',() => now);
  const directory = mkdtempSync(join(tmpdir(),'town-recovery-'));
  const previousPath = config.dbPath;
  config.dbPath = join(directory,'test.sqlite');
  let db = getDb();
  config.features.town = true; config.features.townLLM = false;
  config.town.simulation = 'legacy'; config.town.economyEnabled = false;
  config.town.playerSpeed = 1; config.town.npcSpeed = 1; config.town.maxActiveEncounters = 0;
  t.after(() => { town.stopTownScheduler(); schedules.invalidateAllCache(); closeDb(); config.dbPath = previousPath; rmSync(directory,{recursive:true,force:true}); });
  const grid = () => Array.from({ length: 6 },() => Array(6).fill(null));
  const { mapId } = saveMap({ name: 'appointment fixture',cols: 6,rows: 6,
    layers: { ground: grid(),road: grid(),objects: [] },locations: [
      { key: 'board',name: '公告',x: 0,y: 0,radius: 0 },
      { key: 'supplier',name: '原料',x: 4,y: 0,radius: 0 },
      { key: 'workshop',name: '工坊',x: 4,y: 4,radius: 0 },
      { key: 'leisure',name: '庭院',x: 0,y: 4,radius: 0 },
      { key: 'nook',name: '角落',x: 1,y: 1,radius: 0 },
    ] });
  for (const name of ['公告员','供应商','预约角色','普通居民']) createNpc({ mapId,displayName: name });
  const npcs = db.prepare('SELECT * FROM town_npcs ORDER BY id').all();
  const characterId = Number(db.prepare("INSERT INTO characters(name,display_name,base_prompt) VALUES('appointment_fixture','预约角色','fixture')").run().lastInsertRowid);
  db.prepare('UPDATE town_npcs SET character_id=? WHERE id=?').run(characterId,npcs[2].id);
  db.prepare('INSERT INTO town_characters(character_id,town_enabled) VALUES(?,1)').run(characterId);
  db.prepare("INSERT INTO town_players(id,display_name,grid_x,grid_y) VALUES('me','玩家',0,0)").run();
  for (const [index,x,y,key] of [[0,0,0,'board'],[1,4,0,'supplier'],[2,4,4,'workshop'],[3,1,1,'nook']]) {
    db.prepare('UPDATE town_npcs SET routine_json=? WHERE id=?').run(JSON.stringify([
      { start: '00:00',end: '24:00',locationKey: key,activity: '固定测试作息' },
    ]),npcs[index].id);
    db.prepare('INSERT INTO town_agent_state(agent_key,grid_x,grid_y,current_location_id) VALUES(?,?,?,(SELECT id FROM town_locations WHERE key=?))')
      .run(index === 2 ? `char:${characterId}` : `npc:${npcs[index].id}`,x,y,key);
  }
  function schedule(location = '工坊',tags = ['idle']) {
    const json = JSON.stringify([{ startTime: '00:00',endTime: '24:00',activity: '原日程',location,tags,replyDelay: tags.includes('sleep') ? -1 : 0 }]);
    db.prepare(`INSERT INTO schedule_templates(character_id,schedule_json) VALUES(?,?)
      ON CONFLICT(character_id) DO UPDATE SET schedule_json=excluded.schedule_json`).run(characterId,json);
    db.prepare('UPDATE daily_schedules SET schedule_json=? WHERE character_id=?').run(json,characterId);
    schedules.invalidateCache(characterId);
  }
  schedule(); town.startTownScheduler();
  const context = runtime.getTownEconomyContext(), scope = context.scope;
  const ids = npcs.map(n => context.registry.resolveAgentKey(`npc:${n.id}`).actorId);
  const provider = ids[2];
  let sequence = 0;
  const cmd = () => ({ worldEpoch: scope.worldEpoch,idempotencyKey: `appointment-runtime:${++sequence}` });
  runtime.setupTownEconomy({ ...cmd(),npcActorIds: { commissioner: ids[0],supplier: ids[1],workshop: provider },
    locationKeys: { board: 'board',supplier: 'supplier',workshop: 'workshop' } });
  let order = runtime.executeTownOrder('publish',null,cmd()).order;
  for (const [method,x,y] of [['accept',0,0],['pickup',4,0],['complete',4,4]]) {
    if (method !== 'accept') { assert.equal(town.movePlayerTo(x,y).ok,true); now += 20000; }
    order = runtime.executeTownOrder(method,order.orderId,{ ...cmd(),expectedVersion: order.version }).order;
  }
  let service = await runtime.executeTownService('offer',null,cmd());
  service = await runtime.executeTownService('accept',service.sessionId,{ ...cmd(),expectedVersion: service.version });
  for (const intentKey of ['choose_theme','confirm_materials','craft','deliver']) service = await runtime.executeTownService('turn',service.sessionId,
    { ...cmd(),expectedVersion: service.version,intentKey });
  assert.equal(service.status,'completed');
  function reopen(at = now) {
    town.stopTownScheduler(); closeDb(); schedules.invalidateAllCache();
    now = at; db = getDb(); town.startTownScheduler();
  }
  async function delivery() {
    let value = runtime.executeTownOrder('publish',null,cmd()).order;
    for (const [method,x,y] of [['accept',0,0],['pickup',4,0],['complete',4,4]]) {
      assert.equal(town.movePlayerTo(x,y).ok,true); now += 20000;
      value = runtime.executeTownOrder(method,value.orderId,{ ...cmd(),expectedVersion: value.version }).order;
    }
    return value;
  }
  async function appointment() {
    const appointments = runtime.getTownAppointmentRuntime().appointments;
    const candidate = appointments.offerFromSettlement({scope,sourceEventId:service.settlement.eventId});
    schedule('庭院'); town.updateTownSettings({economyEnabled:false});
    for (let i=0;i<3;i++) { now+=20000; town.forceTick(); }
    const startAt = now+600000;
    const value = appointments.accept({scope,candidateId:candidate.candidateId,startAt,
      expectedVersion:candidate.version,idempotencyKey:'recovery-appointment'});
    now=startAt; town.forceTick();
    return value;
  }
  return { get db() {return db;}, scope, provider, ids, characterId, service, cmd, schedule, reopen, delivery, appointment,
    tick(ms=1) {now+=ms;town.forceTick();}, setNow(value) {now=value;}, get now(){return now;} };
}

const accounts = db => db.prepare('SELECT account_id,balance,reserved FROM economy_accounts ORDER BY account_id').all();
const claims = db => db.prepare('SELECT * FROM town_resource_claims ORDER BY action_id').all();
const snapshot = db => Object.fromEntries(db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
  AND (name LIKE 'town_%' OR name LIKE 'economy_%' OR name IN ('backpack_items','item_effects')) ORDER BY name`).all()
  .map(({name})=>[name,db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));

test('SQLite reopen mid appointment movement preserves last position; offline end retires the action and lease',async t=>{
  const f=await fixture(t), appointment=await f.appointment();
  const before=town.getTownActorPosition(f.provider);
  assert.equal(before.moving,true);
  assert.ok(!before.locationKeys.includes('workshop'));
  const action=f.db.prepare("SELECT * FROM town_actions WHERE actor_id=? AND status='running'").get(f.provider);
  assert.ok(action);
  const money=accounts(f.db);
  f.reopen(f.now+1000);
  const reloaded=town.getTownActorPosition(f.provider);
  assert.equal(reloaded.x,before.x); assert.equal(reloaded.y,before.y);
  assert.ok(!reloaded.locationKeys.includes('workshop'));
  f.reopen(appointment.endAt+1); f.tick();
  assert.equal(f.db.prepare('SELECT status FROM town_actions WHERE id=?').get(action.id).status,'cancelled');
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_resource_claims WHERE action_id=?').get(action.id).n,0);
  assert.deepEqual(runtime.getTownAppointmentRuntime().appointments.getActiveForActor({scope:f.scope,actorId:f.provider,at:f.now}),[]);
  assert.deepEqual(accounts(f.db),money);
});

test('reserved production survives SQLite reopen without offline proofs or wages, then expires once',async t=>{
  const f=await fixture(t);
  runtime.maintainTownOrders();
  const batch=runtime.getTownBusinessRuntime().production.list(f.scope).find(p=>p.status==='reserved');
  assert.ok(batch);
  const money=accounts(f.db);
  const stock=f.db.prepare('SELECT * FROM town_resource_stocks ORDER BY stock_id').all();
  f.reopen(f.now+600000);
  assert.equal(runtime.getTownBusinessRuntime().production.list(f.scope).find(p=>p.productionId===batch.productionId).status,'reserved');
  assert.deepEqual(accounts(f.db),money);
  assert.deepEqual(f.db.prepare('SELECT * FROM town_resource_stocks ORDER BY stock_id').all(),stock);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_production_proofs').get().n,0);
  // Reopen after closing hours so maintenance cannot start a replacement batch.
  f.reopen(Date.parse('2026-09-08T19:00:00+08:00'));
  runtime.maintainTownOrders();
  const expired=runtime.getTownBusinessRuntime().production.list(f.scope).find(p=>p.productionId===batch.productionId);
  assert.equal(expired.status,'expired');
  const after=accounts(f.db);
  assert.deepEqual(after.map(({account_id,balance})=>({account_id,balance})),money.map(({account_id,balance})=>({account_id,balance})));
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_production_proofs').get().n,0);
  assert.equal(runtime.getTownBusinessRuntime().production.getResourceNode(f.scope).reserved,0);
  runtime.maintainTownOrders();
  assert.deepEqual(accounts(f.db),after);
});

test('lost delivery response survives reopen: exact retry pays once and stale CAS cannot mutate',async t=>{
  const f=await fixture(t);
  let order=runtime.executeTownOrder('publish',null,f.cmd()).order;
  for (const [method,x,y] of [['accept',0,0],['pickup',4,0]]) {
    town.movePlayerTo(x,y); f.setNow(f.now+20000);
    order=runtime.executeTownOrder(method,order.orderId,{...f.cmd(),expectedVersion:order.version}).order;
  }
  town.movePlayerTo(4,4);f.setNow(f.now+20000);
  const request={...f.cmd(),expectedVersion:order.version};
  const response=runtime.executeTownOrder('complete',order.orderId,request);
  f.reopen();
  const before=snapshot(f.db);
  assert.deepEqual(runtime.executeTownOrder('complete',order.orderId,request),response);
  assert.deepEqual(snapshot(f.db),before);
  const next=runtime.executeTownOrder('publish',null,f.cmd()).order;
  const pending=snapshot(f.db);
  assert.throws(()=>runtime.executeTownOrder('accept',next.orderId,{...f.cmd(),expectedVersion:next.version+1}),{code:'VERSION_CONFLICT'});
  assert.deepEqual(snapshot(f.db),pending);
});

test('persisted resolving crash plus provider withdrawal refunds once after reopen and fences the lost response',async t=>{
  const f=await fixture(t);
  await f.delivery();
  let session=await runtime.executeTownService('offer',null,f.cmd());
  session=await runtime.executeTownService('accept',session.sessionId,{...f.cmd(),expectedVersion:session.version});
  const context=runtime.getTownBusinessRuntime(), slice=context.business.getSlice(f.scope);
  const {createTownServiceSessionService}=await import('../src/services/town/townServiceSessionService.js');
  let release,entered;
  const barrier=new Promise(resolve=>{release=resolve;}), started=new Promise(resolve=>{entered=resolve;});
  // Local async fault boundary only: no model, SDK or network call occurs.
  const crashing=createTownServiceSessionService({...context,clock:{now:Date.now},
    getWorkshop:()=>({accountId:slice.accounts.workshop,stockId:slice.stocks.workshop,actorId:f.provider,locationKey:'workshop'}),
    generate:()=>{entered();return barrier;}});
  const request={...f.scope,actorId:context.player.actorId,sessionId:session.sessionId,
    expectedVersion:session.version,clientTurnId:'lost-turn',intentKey:'choose_theme'};
  const pending=crashing.turn(request).catch(error=>error);
  try {
    await started;
    assert.equal(f.db.prepare('SELECT status FROM town_service_sessions WHERE session_id=?').get(session.sessionId).status,'resolving');
    f.reopen(f.now+20000);
    town.setTownCharacterEnabled(f.characterId,{townEnabled:false});
    const restored=runtime.getTownBusinessRuntime().services;
    restored.recover(f.scope);
    const result=restored.get({...f.scope,actorId:context.player.actorId,sessionId:session.sessionId});
    assert.equal(result.status,'failed');assert.equal(result.settlement.refund,30);assert.equal(result.settlement.payout,0);
    const after=snapshot(f.db);
    restored.recover(f.scope); restored.recover(f.scope);
    assert.deepEqual(snapshot(f.db),after);
    assert.equal(f.db.prepare('SELECT count(*) n FROM town_service_settlements WHERE session_id=?').get(session.sessionId).n,1);
    release('{}'); await pending;
    assert.deepEqual(snapshot(f.db),after);
    assert.equal(runtime.getTownWallet().balance,30);
  } finally {release('{}');await pending;}
});

test('reset fault matrix rolls back old epoch, assets and in-flight claims at every populated phase before a clean reset',async t=>{
  const f=await fixture(t);
  runtime.maintainTownOrders();
  assert.ok(runtime.getTownBusinessRuntime().production.list(f.scope).some(p=>p.status==='reserved'));
  await f.delivery();
  let service=await runtime.executeTownService('offer',null,f.cmd());
  service=await runtime.executeTownService('accept',service.sessionId,{...f.cmd(),expectedVersion:service.version});
  const appointments=runtime.getTownAppointmentRuntime().appointments;
  const candidate=appointments.offerFromSettlement({scope:f.scope,sourceEventId:f.service.settlement.eventId});
  appointments.accept({scope:f.scope,candidateId:candidate.candidateId,startAt:f.now+600000,
    expectedVersion:candidate.version,idempotencyKey:'reset-appointment'});
  let order=runtime.executeTownOrder('publish',null,f.cmd()).order;
  for (const [method,x,y] of [['accept',0,0],['pickup',4,0]]) {
    town.movePlayerTo(x,y);f.setNow(f.now+20000);
    order=runtime.executeTownOrder(method,order.orderId,{...f.cmd(),expectedVersion:order.version}).order;
  }
  // Return before the scheduler observes the player's absence from the paid session.
  town.movePlayerTo(4,4);f.setNow(f.now+20000);f.tick();
  assert.equal(f.db.prepare('SELECT status FROM town_service_sessions WHERE session_id=?').get(service.sessionId).status,'active');
  assert.ok(claims(f.db).length>0);
  assert.ok(f.db.prepare('SELECT count(*) n FROM economy_reservations WHERE remaining>0').get().n>0);
  const before=snapshot(f.db);
  const cuts=[
    ['actions','UPDATE','town_actions',"OLD.status IN ('running','reserved','validated')"],
    ['service','UPDATE','town_service_sessions',"NEW.status='settling'"],
    ['appointment','UPDATE','town_appointments',"NEW.status='cancelled'"],
    ['production','UPDATE','town_productions',"NEW.status='cancelled'"],
    ['orders','UPDATE','town_delivery_orders',"NEW.status='cancelled'"],
    ['deliveries','UPDATE','town_event_deliveries',"NEW.status='dead'"],
    ['epoch','UPDATE','town_world_state','NEW.epoch<>OLD.epoch'],
    ['scene','DELETE','town_maps','1'],
    ['identity','UPDATE','town_actors',`(SELECT epoch FROM town_world_state) > ${f.scope.worldEpoch}`],
  ];
  for (const [label,operation,table,condition] of cuts) {
    f.db.exec(`CREATE TEMP TRIGGER recovery_fault BEFORE ${operation} ON ${table} WHEN ${condition}
      BEGIN SELECT RAISE(ABORT,'RECOVERY_FAULT_${label}'); END`);
    try {
      assert.throws(()=>town.resetWorld(),new RegExp(`RECOVERY_FAULT_${label}`),label);
      assert.deepEqual(snapshot(f.db),before,`atomic rollback at ${label}`);
      assert.equal(town.getTownActorPosition(f.provider).worldEpoch,f.scope.worldEpoch);
    } finally {f.db.exec('DROP TRIGGER recovery_fault');}
  }
  const assets=f.db.prepare('SELECT * FROM backpack_items ORDER BY id').all();
  const total=f.db.prepare("SELECT sum(balance) n FROM economy_accounts WHERE account_type<>'issuance'").get().n;
  const result=town.resetWorld();
  assert.equal(result.worldEpoch,f.scope.worldEpoch+1);
  assert.equal(claims(f.db).length,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM economy_reservations WHERE remaining>0').get().n,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM town_actions WHERE status IN ('running','reserved','validated')").get().n,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM town_productions WHERE status='reserved'").get().n,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM town_appointments WHERE status='accepted'").get().n,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM town_service_sessions WHERE status IN ('active','resolving','settling')").get().n,0);
  assert.deepEqual(f.db.prepare('SELECT * FROM backpack_items ORDER BY id').all(),assets);
  assert.equal(f.db.prepare("SELECT sum(balance) n FROM economy_accounts WHERE account_type<>'issuance'").get().n,total);
  assert.equal(f.db.prepare('SELECT sum(reserved) n FROM town_production_nodes').get().n,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM town_delivery_orders WHERE status NOT IN ('completed','cancelled','expired')").get().n,0);
  assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
});

