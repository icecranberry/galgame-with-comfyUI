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


const {addClient,removeClient}=await import('../src/services/unifiedStreamBus.js');
const {createCharacterTownAppointments}=await import('../src/services/characterTownAppointments.js');
function listen(t) {
 const frames=[];const client={write:frame=>frames.push(frame)};addClient(client);t.after(()=>removeClient(client));return frames;
}
function reader(f) {return createCharacterTownAppointments({db:f.db,registry:runtime.getTownEconomyContext().registry,clock:{now:()=>f.now}});}
const updates = frames => frames.filter(frame => frame.startsWith('event: town_state_updated\n'))
  .map(frame => JSON.parse(frame.split('\ndata: ')[1].trim()));

test('legacy appointment expiry broadcasts once; subscriber GET and repeated maintenance do not self-trigger',async t=>{
  const f=await fixture(t), appointment=await f.appointment();
  assert.equal(config.town.simulation,'legacy');
  const read=reader(f);assert.equal(read(f.characterId).appointments.length,1);
  const frames=listen(t);f.setNow(appointment.endAt);f.tick();
  assert.equal(f.db.prepare('SELECT status FROM town_appointments WHERE appointment_id=?').get(appointment.appointmentId).status,'expired');
  assert.deepEqual(read(f.characterId).appointments,[]);
  assert.deepEqual(updates(frames),[{...f.scope,reason:'appointment_expired'}]);
  // A real consumer reread invokes maintenance again, followed by normal ticks.
  runtime.getTownAppointments();runtime.getTownAppointments();
  runtime.maintainTownOrders();f.tick();
  assert.deepEqual(updates(frames),[{...f.scope,reason:'appointment_expired'}]);
});

test('legacy maintenance and GET with unchanged accepted appointment emit no state notification',async t=>{
  const f=await fixture(t), appointment=await f.appointment();
  const frames=listen(t);
  runtime.maintainTownOrders();runtime.getTownAppointments();runtime.maintainTownOrders();
  assert.equal(f.db.prepare('SELECT status FROM town_appointments WHERE appointment_id=?').get(appointment.appointmentId).status,'accepted');
  assert.deepEqual(updates(frames),[]);
});

test('candidate-only expiry on GET notifies once and repeated reads emit nothing',async t=>{
  const f=await fixture(t);
  town.updateTownSettings({economyEnabled:false});runtime.maintainTownOrders();
  const before=runtime.getTownAppointments();assert.equal(before.candidates.length,1);
  const frames=listen(t);f.setNow(before.candidates[0].expiresAt);
  assert.deepEqual(runtime.getTownAppointments().candidates,[]);
  assert.deepEqual(updates(frames),[{...f.scope,reason:'appointment_expired'}]);
  runtime.getTownAppointments();runtime.maintainTownOrders();
  assert.deepEqual(updates(frames),[{...f.scope,reason:'appointment_expired'}]);
});
