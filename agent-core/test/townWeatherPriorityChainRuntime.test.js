import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH=':memory:';
globalThis.fetch=async url=>{
  if(String(url).endsWith('/object_info'))return {ok:true,json:async()=>({})};
  throw new Error('Network forbidden in weather priority chain');
};
const {config}=await import('../src/config.js');
const {getDb,closeDb}=await import('../src/db/index.js');
const town=await import('../src/services/town/townService.js');
const runtime=await import('../src/services/town/townEconomyRuntime.js');
const {createNpc}=await import('../src/services/town/townNpcService.js');
const {saveMap}=await import('../src/services/town/townMapService.js');
const schedules=await import('../src/services/scheduleManager.js');
const {getWeatherSourceKey}=await import('../src/services/weatherSource.js');

test('known rain: paid service holds, real production earns dual proofs, accepted appointment beats shelter',async t=>{
  let now=Date.parse('2026-09-08T10:00:00+08:00');t.mock.method(Date,'now',()=>now);
  const db=getDb();assert.equal(config.dbPath,':memory:');
  Object.assign(config.features,{town:true,townLLM:false,weather:true});
  Object.assign(config.town,{simulation:'rules',economyEnabled:false,playerSpeed:1,npcSpeed:1,maxActiveEncounters:0,timeZone:'Asia/Shanghai'});
  t.after(()=>{town.stopTownScheduler();schedules.invalidateAllCache();closeDb();});
  const grid=()=>Array.from({length:6},()=>Array(6).fill(null));
  const {mapId}=saveMap({name:'rain priority fixture',cols:6,rows:6,layers:{ground:grid(),road:grid(),objects:[]},locations:[
    {key:'board',name:'公告',x:0,y:0,radius:0},{key:'supplier',name:'原料',x:4,y:0,radius:0},
    {key:'workshop',name:'工坊',x:4,y:4,radius:0},{key:'home',name:'自家',kind:'home',x:0,y:4,radius:0},
    {key:'provider-home',name:'师傅家',kind:'home',x:5,y:4,radius:0},
  ]});
  const home=db.prepare("SELECT id FROM town_locations WHERE key='home'").get().id;
  const npcs=['公告员','供应商','师傅','空闲居民'].map(displayName=>createNpc({mapId,displayName,homeLocationId:home}));
  const charId=Number(db.prepare("INSERT INTO characters(name,display_name,base_prompt) VALUES('rain_provider','师傅','fixture')").run().lastInsertRowid);
  db.prepare('UPDATE town_npcs SET character_id=? WHERE id=?').run(charId,npcs[2].id);
  const providerHome=db.prepare("SELECT id FROM town_locations WHERE key='provider-home'").get().id;
  db.prepare('INSERT INTO town_characters(character_id,town_enabled,home_location_id) VALUES(?,1,?)').run(charId,providerHome);
  db.prepare("INSERT INTO town_players(id,display_name,grid_x,grid_y) VALUES('me','玩家',0,0)").run();
  function schedule(work=true){
    const json=JSON.stringify(work?[{startTime:'00:00',endTime:'24:00',activity:'原日程',location:'工坊',tags:['work'],replyDelay:0}]:[]);
    db.prepare(`INSERT INTO schedule_templates(character_id,schedule_json) VALUES(?,?) ON CONFLICT(character_id) DO UPDATE SET schedule_json=excluded.schedule_json`).run(charId,json);
    db.prepare('UPDATE daily_schedules SET schedule_json=? WHERE character_id=?').run(json,charId);schedules.invalidateCache(charId);
  }
  schedule();
  function cache(){
    db.prepare('DELETE FROM weather_hourly').run();
    db.prepare("INSERT INTO weather_hourly(weather_time,weather_text,temperature,forecast_at,fetched_at,source_key) VALUES('10:00','小雨','温暖',?,?,?)")
      .run(Math.floor(now/3600000)*3600000,now,getWeatherSourceKey(config.weather.city));
  }
  cache();town.startTownScheduler();
  const context=runtime.getTownEconomyContext(),scope=context.scope;
  const ids=npcs.map(n=>context.registry.resolveAgentKey(`npc:${n.id}`).actorId);
  let seq=0;const cmd=()=>({worldEpoch:scope.worldEpoch,idempotencyKey:`rain-chain:${++seq}`});
  runtime.setupTownEconomy({...cmd(),npcActorIds:{commissioner:ids[0],supplier:ids[1],workshop:ids[2]},locationKeys:{board:'board',supplier:'supplier',workshop:'workshop'}});
  const tick=(ms=60000)=>{now+=ms;cache();town.forceTick();runtime.maintainTownOrders();};
  for(let i=0;i<3;i++)tick(20000);
  assert.equal(town.getTownState().weather.precipitation,'rain');
  const shelterRows=actorId=>db.prepare("SELECT * FROM town_actions WHERE actor_id=? AND rule_key LIKE 'town.weather.shelter:%'").all(actorId);
  assert.ok(shelterRows(ids[3]).some(a=>a.type==='wait'),'positive control must actually shelter at home');
  let order=runtime.executeTownOrder('publish',null,cmd()).order;
  for(const [method,x,y]of [['accept',0,0],['pickup',4,0],['complete',4,4]]){
    assert.equal(town.movePlayerTo(x,y).ok,true);now+=12000;cache();town.getTownState();
    order=runtime.executeTownOrder(method,order.orderId,{...cmd(),expectedVersion:order.version}).order;
  }
  assert.equal(order.status,'completed');assert.equal(runtime.getTownWallet().balance,30);
  let service=await runtime.executeTownService('offer',null,cmd());
  service=await runtime.executeTownService('accept',service.sessionId,{...cmd(),expectedVersion:service.version});
  assert.equal(runtime.getTownWallet().balance,0);
  const playerPosition=town.getTownActorPosition(service.actorId);
  const position=town.getTownActorPosition(ids[2]);tick();
  const after=town.getTownActorPosition(ids[2]);assert.equal(after.moving,false);assert.equal(after.x,position.x);assert.equal(after.y,position.y);
  const playerAfter=town.getTownActorPosition(service.actorId);
  assert.equal(playerAfter.moving,false);assert.equal(playerAfter.x,playerPosition.x);assert.equal(playerAfter.y,playerPosition.y);
  assert.equal(db.prepare('SELECT status FROM town_service_sessions WHERE session_id=?').get(service.sessionId).status,'active');
  assert.equal(shelterRows(ids[2]).length,0);
  for(const intentKey of ['choose_theme','confirm_materials','craft','deliver'])service=await runtime.executeTownService('turn',service.sessionId,{...cmd(),expectedVersion:service.version,intentKey});
  assert.equal(service.status,'completed');assert.equal(service.settlement.payout,30);
  let batch;for(let i=0;i<40;i++){
    tick();batch=runtime.getTownEconomyState().production.batches.find(b=>b.status==='completed');if(batch)break;
  }
  assert.ok(batch,'production must finish under rain without fabricated money/stock/proofs');
  const proofs=db.prepare('SELECT * FROM town_production_proofs WHERE production_id=?').all(batch.productionId);
  assert.deepEqual(proofs.map(p=>p.role).sort(),['supplier','workshop']);
  for(const proof of proofs){const action=db.prepare('SELECT * FROM town_actions WHERE id=?').get(proof.action_id);assert.equal(action.status,'completed');assert.equal(action.type,'work_shift');}
  assert.equal(shelterRows(ids[1]).length,0);assert.equal(shelterRows(ids[2]).length,0);
  const appointments=runtime.getTownAppointmentRuntime().appointments;
  const candidate=appointments.offerFromSettlement({scope,sourceEventId:service.settlement.eventId});
  schedule(false);
  const startAt=now+600000;
  const appointment=appointments.accept({scope,candidateId:candidate.candidateId,startAt,expectedVersion:candidate.version,idempotencyKey:'rain-appointment'});
  now=startAt;tick(1);tick(20000);tick(1000);
  const active=db.prepare("SELECT * FROM town_actions WHERE actor_id=? AND status='running'").all(ids[2]);
  assert.ok(active.some(a=>a.type==='wait'&&a.target==='workshop'));
  assert.ok(town.getTownActorPosition(ids[2]).locationKeys.includes('workshop'));
  assert.equal(shelterRows(ids[2]).length,0);
  assert.ok(appointments.getActiveForActor({scope,actorId:ids[2],at:now}).some(a=>a.appointmentId===appointment.appointmentId));
  // Removing only the accepted appointment makes this same now-idle actor eligible
  // for shelter, proving the appointment assertion was not protected by a base task.
  runtime.executeTownAppointment('cancel',appointment.appointmentId,{...cmd(),expectedVersion:appointment.version});
  for(let i=0;i<4;i++)tick(20000);
  assert.ok(shelterRows(ids[2]).some(a=>a.type==='wait'),JSON.stringify({position:town.getTownActorPosition(ids[2]),
    actions:db.prepare('SELECT type,status,target,rule_key,failure_reason FROM town_actions WHERE actor_id=? ORDER BY rowid DESC LIMIT 5').all(ids[2])}));
});
