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
  const appointments = runtime.getTownAppointmentRuntime().appointments;
  const candidate = appointments.offerFromSettlement({ scope,sourceEventId: service.settlement.eventId });
  schedule('庭院');
  // Disable economy so the appointment is the sole reason this provider joins
  // rules simulation; other residents must remain on the legacy path.
  town.updateTownSettings({ economyEnabled: false });
  for (let i = 0; i < 3; i++) { now += 20000; town.forceTick(); }
  assert.ok(town.getTownActorPosition(provider).locationKeys.includes('leisure'));
  const startAt = now + 10 * 60000;
  const appointment = appointments.accept({ scope,candidateId: candidate.candidateId,startAt,
    expectedVersion: candidate.version,idempotencyKey: 'accept-followup' });
  const baseSchedule = db.prepare('SELECT schedule_json FROM schedule_templates WHERE character_id=?').get(characterId).schedule_json;
  const activeActions = () => db.prepare("SELECT * FROM town_actions WHERE actor_id=? AND status IN ('reserved','running') ORDER BY updated_at").all(provider);
  const setNow = value => { now = value; };
  const tick = (ms = 1) => { now += ms; town.forceTick(); };
  async function openPaidService() {
    town.updateTownSettings({ economyEnabled: true });
    let delivery = runtime.executeTownOrder('publish',null,cmd()).order;
    for (const [method,x,y] of [['accept',0,0],['pickup',4,0],['complete',4,4]]) {
      assert.equal(town.movePlayerTo(x,y).ok,true); now += 20000;
      delivery = runtime.executeTownOrder(method,delivery.orderId,{ ...cmd(),expectedVersion: delivery.version }).order;
    }
    const offer = await runtime.executeTownService('offer',null,cmd());
    return runtime.executeTownService('accept',offer.sessionId,{ ...cmd(),expectedVersion: offer.version });
  }
  return { db,scope,provider,ids,appointments,appointment,startAt,setNow,tick,schedule,characterId,baseSchedule,activeActions,
    openPaidService,position: () => town.getTownActorPosition(provider),get now() { return now; } };
}

test('accepted followup joins local rules, physically walks, waits without wages, then returns to legacy', async t => {
  const f = await fixture(t);
  const beforeMoney = f.db.prepare('SELECT account_id,balance,reserved FROM economy_accounts ORDER BY account_id').all();
  const beforeOther = f.db.prepare('SELECT COUNT(*) n FROM town_actions WHERE actor_id=?').get(f.ids[3]).n;
  f.setNow(f.startAt); f.tick();
  assert.equal(f.position().moving,true);
  assert.ok(!f.position().locationKeys.includes('workshop'));
  assert.equal(f.activeActions()[0].type,'move_to');
  f.tick(20000);
  assert.ok(f.position().locationKeys.includes('workshop'));
  assert.equal(f.activeActions()[0].type,'wait');
  f.tick(60000);
  assert.equal(f.position().moving,false);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM town_actions WHERE actor_id=?').get(f.ids[3]).n,beforeOther);
  assert.deepEqual(f.db.prepare('SELECT account_id,balance,reserved FROM economy_accounts ORDER BY account_id').all(),beforeMoney);
  f.setNow(f.appointment.endAt); f.tick();
  assert.equal(f.activeActions().length,0);
  assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM town_resource_claims c JOIN town_actions a ON a.id=c.action_id WHERE a.actor_id=?`).get(f.provider).n,0);
  f.tick(20000);
  assert.ok(f.position().locationKeys.includes('leisure'));
  assert.equal(f.db.prepare('SELECT schedule_json FROM schedule_templates WHERE character_id=?').get(f.characterId).schedule_json,f.baseSchedule);
});

test('new original work/rest/off-town commitments invalidate the appointment override', async t => {
  const f = await fixture(t);
  for (const [location,tags] of [['庭院',['work']],['庭院',['sleep']],['镇外出差',['work']]]) {
    f.schedule(location,tags);
    f.setNow(f.startAt); f.tick();
    assert.deepEqual(f.appointments.getActiveForActor({ scope: f.scope,actorId: f.provider,at: f.now }),[]);
    assert.equal(f.activeActions().length,0);
  }
});

test('cancelling while walking cancels only owned appointment action and leaves no lease', async t => {
  const f = await fixture(t);
  f.setNow(f.startAt); f.tick();
  const action = f.activeActions()[0]; assert.equal(action.type,'move_to');
  f.appointments.cancel({ scope: f.scope,appointmentId: f.appointment.appointmentId,expectedVersion: f.appointment.version,
    idempotencyKey: 'cancel-followup' });
  f.tick();
  assert.equal(f.db.prepare('SELECT status FROM town_actions WHERE id=?').get(action.id).status,'cancelled');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM town_resource_claims WHERE action_id=?').get(action.id).n,0);
  assert.equal(f.activeActions().length,0);
});

test('reset cancels accepted appointments in the old epoch before clearing the scene', async t => {
  const f = await fixture(t);
  f.setNow(f.startAt); f.tick();
  const reset = town.resetWorld();
  assert.equal(reset.worldEpoch,f.scope.worldEpoch+1);
  assert.equal(f.db.prepare('SELECT status FROM town_appointments WHERE appointment_id=?').get(f.appointment.appointmentId).status,'cancelled');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM town_resource_claims').get().n,0);
  assert.equal(f.db.prepare('SELECT schedule_json FROM schedule_templates WHERE character_id=?').get(f.characterId).schedule_json,f.baseSchedule);
});

test('global rules still schedules unrelated residents while an appointment is active', async t => {
  const f = await fixture(t);
  town.updateTownSettings({ simulation: 'rules' });
  f.setNow(f.startAt); f.tick();
  assert.ok(f.db.prepare('SELECT COUNT(*) n FROM town_actions WHERE actor_id=?').get(f.ids[3]).n > 0);
  assert.ok(f.activeActions().some(action => action.target === 'workshop' && action.type === 'move_to'));
});

test('an appointment ending while scheduler is stopped relinquishes its persisted action on reload', async t => {
  const f = await fixture(t);
  f.setNow(f.startAt); f.tick();
  const action = f.activeActions()[0];
  town.stopTownScheduler();
  f.setNow(f.appointment.endAt+1);
  town.startTownScheduler(); f.tick();
  assert.equal(f.db.prepare('SELECT status FROM town_actions WHERE id=?').get(action.id).status,'cancelled');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM town_resource_claims WHERE action_id=?').get(action.id).n,0);
  assert.equal(f.activeActions().length,0);
});

test('an accepted paid service takes priority over appointment movement and waiting', async t => {
  const f = await fixture(t);
  f.setNow(f.startAt); f.tick(); f.tick(20000);
  assert.equal(f.activeActions()[0].type,'wait');
  const service = await f.openPaidService();
  assert.equal(service.status,'active');
  f.tick();
  assert.equal(runtime.isTownActorServing(f.provider),true);
  assert.equal(f.activeActions().length,0);
  assert.equal(f.position().moving,false);
  assert.ok(f.position().locationKeys.includes('workshop'));
});
