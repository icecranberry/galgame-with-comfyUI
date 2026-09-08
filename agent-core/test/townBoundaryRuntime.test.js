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

// Same actual-runtime arrangement as townAppointmentRuntimeMovement / RecoveryMatrix.
// Keep local because those fixtures are not exported; importing their test files
// would register unrelated tests. No handcrafted settlement or action proofs.
async function fixture(t) {
  let now = Date.parse('2026-09-08T10:00:00+08:00');
  t.mock.method(Date,'now',() => now);
  const db = getDb();
  config.features.town = true; config.features.townLLM = false;
  config.town.simulation = 'legacy'; config.town.economyEnabled = false;
  config.town.playerSpeed = 1; config.town.npcSpeed = 1; config.town.maxActiveEncounters = 0;
  t.after(() => { town.stopTownScheduler(); schedules.invalidateAllCache(); closeDb(); });
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
  return { get db() {return db;}, scope, provider, ids, characterId, service, cmd, schedule, delivery, appointment,
    tick(ms=1) {now+=ms;town.forceTick();}, setNow(value) {now=value;}, get now(){return now;} };
}

const snapshot = db => Object.fromEntries(db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
  AND (name LIKE 'town_%' OR name LIKE 'economy_%' OR name IN ('backpack_items','item_effects')) ORDER BY name`).all()
  .map(({name})=>[name,db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));


async function paid(f) {
 await f.delivery();
 let s=await runtime.executeTownService('offer',null,f.cmd());
 return runtime.executeTownService('accept',s.sessionId,{...f.cmd(),expectedVersion:s.version});
}
function removeWorkshop(f) {
 const row=f.db.prepare('SELECT * FROM town_maps LIMIT 1').get();
 const locations=f.db.prepare("SELECT key,name,grid_x x,grid_y y,radius FROM town_locations WHERE key<>'workshop'").all();
 saveMap({name:row.name,cols:row.grid_cols,rows:row.grid_rows,layers:JSON.parse(row.layers_json),locations});
 town.reloadTown();
}
test('disabled economy and LLM permit finishing accepted service and release busy',async t=>{
 const f=await fixture(t);
 town.updateTownSettings({simulation:'rules'});
 let s=await paid(f);
 town.updateTownSettings({simulation:'legacy',economyEnabled:false});
 assert.equal(config.features.townLLM,false);
 await assert.rejects(runtime.executeTownService('offer',null,f.cmd()),{code:'ECONOMY_DISABLED'});
 for(const intentKey of ['choose_theme','confirm_materials','craft','deliver'])
 s=await runtime.executeTownService('turn',s.sessionId,{...f.cmd(),expectedVersion:s.version,intentKey});
 assert.equal(s.status,'completed');assert.equal(runtime.isTownActorServing(f.provider),false);
});
test('POI removal recovers paid service and does not strand busy or material reservation',async t=>{
 const f=await fixture(t);const s=await paid(f);
 const reservation=f.db.prepare('SELECT material_reservation_id id FROM town_service_sessions WHERE session_id=?').get(s.sessionId).id;
 assert.equal(f.db.prepare('SELECT remaining FROM economy_reservations WHERE reservation_id=?').get(reservation).remaining,1);
 removeWorkshop(f);f.tick();
 const restored=runtime.getTownService(s.sessionId);
 assert.equal(restored.status,'failed');assert.equal(restored.settlement.refund,30);
 assert.equal(f.db.prepare('SELECT remaining FROM economy_reservations WHERE reservation_id=?').get(reservation).remaining,0);
 const before=snapshot(f.db);
 runtime.getTownService(s.sessionId);
 assert.deepEqual(snapshot(f.db),before);
 assert.equal(runtime.isTownActorServing(f.provider),false);
});
test('withdrawal while serving is recovered by service GET, followed by safe reentry',async t=>{
 const f=await fixture(t);const s=await paid(f);
 town.setTownCharacterEnabled(f.characterId,{townEnabled:false});
 const restored=runtime.getTownService(s.sessionId);
 assert.equal(restored.status,'failed');
 assert.equal(restored.settlement.refund,30);
 const before=snapshot(f.db);
 runtime.getTownService(s.sessionId);
 assert.deepEqual(snapshot(f.db),before);
 assert.equal(runtime.isTownActorServing(f.provider),false);
 town.setTownCharacterEnabled(f.characterId,{townEnabled:true});f.tick();
 assert.equal(runtime.isTownActorServing(f.provider),false);
});
test('POI removal during appointment cancels its move and releases lease',async t=>{
 const f=await fixture(t);await f.appointment();
 const action=f.db.prepare("SELECT id FROM town_actions WHERE actor_id=? AND status='running'").get(f.provider);
 assert.ok(action);removeWorkshop(f);f.tick();
 assert.equal(f.db.prepare('SELECT count(*) n FROM town_resource_claims WHERE action_id=?').get(action.id).n,0);
 assert.equal(f.db.prepare('SELECT status FROM town_actions WHERE id=?').get(action.id).status,'cancelled');
 assert.deepEqual(runtime.getTownAppointmentRuntime().appointments.getActiveForActor({scope:f.scope,actorId:f.provider,at:f.now}),[]);
});

test('repeated appointment GET maintenance is idempotent; cancellation releases owned action',async t=>{
 const f=await fixture(t), appt=await f.appointment();
 runtime.getTownAppointments();
 const before=snapshot(f.db);
 const writes=f.db.prepare('SELECT total_changes() n').get().n;
 runtime.getTownAppointments();runtime.getTownAppointments();
 assert.equal(f.db.prepare('SELECT total_changes() n').get().n,writes);
 assert.deepEqual(snapshot(f.db),before);
 runtime.executeTownAppointment('cancel',appt.appointmentId,{...f.cmd(),expectedVersion:appt.version});
 f.tick();
 assert.equal(f.db.prepare("SELECT count(*) n FROM town_actions WHERE actor_id=? AND status IN ('running','reserved')").get(f.provider).n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM town_resource_claims c JOIN town_actions a ON a.id=c.action_id WHERE a.actor_id=?').get(f.provider).n,0);
});
