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


const {createHash}=await import('node:crypto');
const {canonicalJson}=await import('../src/services/town/townEventService.js');
const definitions=await import('../src/services/town/townServiceDefinitions.js');
const {createTownServiceUnlock}=await import('../src/services/town/townServiceUnlock.js');
const bob='town.workshop.bob_cut';
const catalog=f=>runtime.getTownBusinessRuntime().services.listCatalog(f.scope);
async function unlock(f) {
  f.schedule('工坊',['work']);runtime.maintainTownOrders();
  let batch;
  for(let i=0;i<40;i++) {
    f.tick(60000);
    batch=runtime.getTownBusinessRuntime().production.list(f.scope).find(p=>p.status==='completed');
    if(batch)break;
  }
  assert.ok(batch,'real scheduler completed production');
  assert.equal(catalog(f).find(s=>s.serviceKey===bob).available,true);
  return batch;
}
async function offerBob(f) {
  await f.delivery();
  return runtime.executeTownService('offer',null,{...f.cmd(),serviceKey:bob});
}
async function turn(f,s,intentKey) {
  return runtime.executeTownService('turn',s.sessionId,{...f.cmd(),expectedVersion:s.version,intentKey});
}
function rollbackCorruption(f, mutate, check) {
  const marker=new Error('fixture rollback');
  try {f.db.transaction(()=>{
    // Deliberate isolated-store corruption; DDL and data are rolled back together.
    for(const {name} of f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all())
      f.db.exec(`DROP TRIGGER "${name.replaceAll('"','""')}"`);
    mutate();check();throw marker;
  })();} catch(error){if(error!==marker)throw error;}
}

test('definition contract preserves exact old template and accepts only two approved frozen versions',()=>{
  assert.deepEqual(definitions.WORKSHOP_SERVICE,{key:'town.workshop',version:1,price:30,processingFee:10,
    materialQuantity:1,maxTurns:8,idleMs:300000,maxDurationMs:1200000,offerMs:300000,leaseMs:15000,
    templateId:'town.mood_patch',templateVersion:1});
  const definition=definitions.getTownServiceDefinition(bob);
  assert.equal(definition.template.key,bob);assert.equal(definition.template.templateId,'town.bob_cut');
  assert.equal(definitions.resolveTownServiceDefinition({template:{...definition.template}}).outcomeKey,'bob_cut');
  assert.throws(()=>definitions.getTownServiceDefinition('town.workshop.bob_cut@1'),{code:'INVALID_SERVICE_KEY'});
  assert.throws(()=>definitions.resolveTownServiceDefinition({template:{...definition.template,price:1}}),{code:'INVALID_SERVICE_DEFINITION'});
  assert.throws(()=>definitions.resolveTownServiceDefinition({template:{...definition.template,arbitraryEffect:'x'}}),{code:'INVALID_SERVICE_DEFINITION'});
});

test('catalog is query-only and bob stays locked without genuine production; omitted old offer hash is unchanged',async t=>{
  const f=await fixture(t), context=runtime.getTownBusinessRuntime();
  f.db.pragma('query_only=ON');
  try {assert.deepEqual(catalog(f).map(s=>[s.serviceKey,s.available,s.reason]),[['town.workshop',true,null],[bob,false,'SERVICE_LOCKED']]);}
  finally {f.db.pragma('query_only=OFF');}
  const before=f.db.prepare('SELECT total_changes() n').get().n;
  await assert.rejects(runtime.executeTownService('offer',null,{...f.cmd(),serviceKey:bob}),{code:'SERVICE_LOCKED'});
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
  await f.delivery();
  const request=f.cmd();const old=await runtime.executeTownService('offer',null,request);
  const input={...f.scope,idempotencyKey:request.idempotencyKey,actorId:context.player.actorId};
  assert.equal(f.db.prepare('SELECT request_hash FROM town_service_requests WHERE request_key=?').get(request.idempotencyKey).request_hash,
    createHash('sha256').update(canonicalJson({name:'offer',input})).digest('hex'));
  assert.deepEqual(await runtime.executeTownService('offer',null,request),old);
  assert.equal(old.serviceKey,'town.workshop');
});

test('real work unlocks bob, four paid stages grant one fixed card once and do not grant freevisit',async t=>{
  const f=await fixture(t);await unlock(f);
  let s=await offerBob(f);assert.equal(s.serviceKey,bob);
  s=await runtime.executeTownService('accept',s.sessionId,{...f.cmd(),expectedVersion:s.version});
  assert.equal(runtime.getTownWallet().balance,0);
  for(const intent of ['choose_theme','confirm_materials','craft'])s=await turn(f,s,intent);
  const input={...f.cmd(),expectedVersion:s.version,intentKey:'deliver'};
  s=await runtime.executeTownService('turn',s.sessionId,input);
  assert.equal(s.status,'completed');assert.equal(s.settlement.outcomeKey,'bob_cut');
  assert.deepEqual(await runtime.executeTownService('turn',s.sessionId,input),s);
  const item=f.db.prepare('SELECT * FROM backpack_items WHERE id=?').get(s.settlement.itemIds[0]);
  assert.equal(item.effect_key,'bob_cut');assert.equal(item.template_id,'town.bob_cut');assert.equal(item.status,'ready');
  assert.equal(item.source_id,`service:${s.sessionId}:outcome:bob_cut`);
  assert.deepEqual(JSON.parse(item.payload_json),{outfit_name:'波波头发型',outfit_description:'利落波波头：齐下巴的内扣纯色短发、圆润发尾、空气刘海'});
  assert.throws(()=>runtime.getTownAppointmentRuntime().appointments.offerFromSettlement({scope:f.scope,sourceEventId:s.settlement.eventId}),{code:'APPOINTMENT_SOURCE_INVALID'});
});

test('unlock rejects damaged production evidence and stale epoch; accept rechecks before taking payment',async t=>{
  const f=await fixture(t), batch=await unlock(f);
  const s=await offerBob(f), read=createTownServiceUnlock({db:f.db,registry:runtime.getTownEconomyContext().registry,clock:{now:()=>f.now}});
  const serviceId=batch.sessionId;
  const cases=[
    ()=>f.db.prepare("UPDATE town_domain_events SET envelope=json_set(envelope,'$.actorIds','bad-array') WHERE event_id=?").run(`production:${batch.productionId}:${batch.version}`),
    ()=>f.db.prepare("UPDATE town_domain_events SET envelope=json_set(envelope,'$.actorIds',json('{}')) WHERE event_id=?").run(`production:${batch.productionId}:${batch.version}`),
    ()=>f.db.prepare("UPDATE town_domain_events SET envelope=json_set(envelope,'$.actorIds',json('[]')) WHERE event_id=?").run(`service:${serviceId}:settled`),
    ()=>f.db.prepare("UPDATE town_domain_events SET envelope=json_set(envelope,'$.locationKey','wrong') WHERE event_id=?").run(`service:${serviceId}:settled`),
    ()=>f.db.prepare('DELETE FROM town_production_proofs WHERE production_id=? AND role=?').run(batch.productionId,'supplier'),
    ()=>f.db.prepare('DELETE FROM town_production_log WHERE production_id=?').run(batch.productionId),
    ()=>f.db.prepare("UPDATE town_actions SET result='{}' WHERE id=(SELECT action_id FROM town_production_proofs WHERE production_id=? LIMIT 1)").run(batch.productionId),
    ()=>f.db.prepare('DELETE FROM town_service_settlements WHERE session_id=?').run(serviceId),
    ()=>f.db.prepare("UPDATE town_resource_entries SET quantity_delta=0 WHERE transaction_id=(SELECT transaction_id FROM economy_transactions WHERE source_key=?)").run(`production:stock:${batch.productionId}`),
    ()=>f.db.prepare('UPDATE town_productions SET world_epoch=world_epoch+1 WHERE production_id=?').run(batch.productionId),
  ];
  for(const damage of cases)rollbackCorruption(f,damage,()=>assert.equal(read(f.scope),false));
  const context=runtime.getTownBusinessRuntime();
  rollbackCorruption(f,cases[0],()=>{
    const before=f.db.prepare('SELECT balance FROM economy_accounts WHERE account_type=? ORDER BY account_id').all('escrow');
    assert.throws(()=>context.services.accept({...f.scope,actorId:context.player.actorId,sessionId:s.sessionId,
      expectedVersion:s.version,idempotencyKey:'damaged-accept'}),{code:'SERVICE_LOCKED'});
    assert.deepEqual(f.db.prepare('SELECT balance FROM economy_accounts WHERE account_type=? ORDER BY account_id').all('escrow'),before);
  });
  assert.throws(()=>read({...f.scope,worldEpoch:f.scope.worldEpoch+1}),{code:'STALE_EPOCH'});
});

test('bob cancellation keeps original 30/20 refunds and locks new catalog after reset',async t=>{
  const f=await fixture(t);await unlock(f);
  let s=await offerBob(f);
  s=await runtime.executeTownService('accept',s.sessionId,{...f.cmd(),expectedVersion:s.version});
  s=await runtime.executeTownService('cancel',s.sessionId,{...f.cmd(),expectedVersion:s.version});
  assert.equal(s.settlement.refund,30);
  let next=await runtime.executeTownService('offer',null,{...f.cmd(),serviceKey:bob});
  next=await runtime.executeTownService('accept',next.sessionId,{...f.cmd(),expectedVersion:next.version});
  next=await turn(f,next,'choose_theme');next=await turn(f,next,'confirm_materials');
  next=await runtime.executeTownService('cancel',next.sessionId,{...f.cmd(),expectedVersion:next.version});
  assert.equal(next.settlement.refund,20);assert.equal(next.settlement.payout,10);
  town.resetWorld();
  const context=runtime.getTownEconomyContext();
  assert.equal(createTownServiceUnlock({db:f.db,registry:context.registry,clock:{now:()=>f.now}})(context.scope),false);
});

test('bob frozen outcome survives engine recreation; provider loss after consumption refunds all once',async t=>{
  const f=await fixture(t);await unlock(f);await f.delivery();
  // Extra client economics/effect suggestions cannot change the approved offer.
  let s=await runtime.executeTownService('offer',null,{...f.cmd(),serviceKey:bob,price:1,
    templateId:'arbitrary',outcomeKey:'energy',payload:{durationHours:999}});
  assert.equal(s.template.price,30);assert.equal(s.template.templateId,'town.bob_cut');
  const frozen=f.db.prepare('SELECT config_json FROM town_service_sessions WHERE session_id=?').get(s.sessionId).config_json;
  assert.deepEqual(JSON.parse(frozen).template,definitions.getTownServiceDefinition(bob).template);
  s=await runtime.executeTownService('accept',s.sessionId,{...f.cmd(),expectedVersion:s.version});
  s=await turn(f,s,'choose_theme');s=await turn(f,s,'confirm_materials');
  const context=runtime.getTownBusinessRuntime(); // Fresh engine resolves the saved definition.
  assert.equal(context.services.get({...f.scope,actorId:context.player.actorId,sessionId:s.sessionId}).serviceKey,bob);
  town.setTownCharacterEnabled(f.characterId,{townEnabled:false});
  const recovered=runtime.getTownService(s.sessionId);
  assert.equal(recovered.status,'failed');assert.equal(recovered.settlement.refund,30);
  assert.equal(recovered.settlement.payout,0);assert.deepEqual(recovered.settlement.itemIds,[]);
  assert.deepEqual(runtime.getTownService(s.sessionId),recovered);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_service_settlements WHERE session_id=?').get(s.sessionId).n,1);
});
