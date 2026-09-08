import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { migrateTownAppointmentSchema } from '../src/db/townAppointmentSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { createCharacterTownAppointments } from '../src/services/characterTownAppointments.js';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { Router } from 'express';

const HOUR = 3600000;
function fixture(t, options = {}) {
  const db = new Database(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY, is_sleeping INTEGER);
    INSERT INTO characters VALUES(1,0),(2,0),(3,0);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    INSERT INTO town_characters VALUES(1,1),(2,1);
    CREATE TABLE daily_schedules(character_id INTEGER,schedule_date TEXT,schedule_json TEXT);
    CREATE TABLE schedule_templates(character_id INTEGER,schedule_json TEXT);
    INSERT INTO schedule_templates VALUES(1,'[]'),(2,'[]');
    CREATE TABLE town_locations(id INTEGER PRIMARY KEY,key TEXT,name TEXT,aliases_json TEXT);
    INSERT INTO town_locations VALUES(1,'workshop','工坊','["修补屋"]');
    CREATE TABLE town_domain_events(event_id TEXT PRIMARY KEY);`);
  migrateTownSchema(db); migrateTownAppointmentSchema(db);
  db.pragma('foreign_keys=ON');
  const registry = createTownActorRegistry(db), world = registry.getWorldState();
  const actor = registry.resolveAgentKey('char:1'), other = registry.resolveAgentKey('char:2');
  const player = registry.resolveAgentKey('me');
  let now = options.now ?? Date.parse('2026-09-08T09:00:00+08:00');
  const build = createCharacterTownAppointments({ db, registry, clock: { now: () => now }, ...options });
  let seq = 0;
  function appointment(extra = {}) {
    const row = { id: `a${++seq}`, actor: actor.actorId, character: 1, player: player.actorId,
      world: world.worldId, epoch: world.epoch, start: now + HOUR, status: 'accepted', ...extra };
    db.prepare(`INSERT INTO town_appointment_candidates(candidate_id,world_id,world_epoch,source_event_id,session_id,
      player_actor_id,provider_actor_id,character_id,location_key,location_id,status,created_at,expires_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'workshop',1,'accepted',?,?,?)`)
      .run(row.id,row.world,row.epoch,row.id,row.id,row.player,row.actor,row.character,now,now+HOUR,now);
    db.prepare(`INSERT INTO town_appointments(appointment_id,candidate_id,world_id,world_epoch,source_event_id,
      player_actor_id,provider_actor_id,character_id,location_key,location_id,start_at,end_at,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'workshop',1,?,?,?,?,?)`)
      .run(row.id,row.id,row.world,row.epoch,row.id,row.player,row.actor,row.character,row.start,row.start+HOUR/2,row.status,now,now);
  }
  function read(id = 1, options) {
    db.pragma('query_only=ON');
    try {
      assert.throws(() => db.prepare('UPDATE characters SET is_sleeping=1').run(), /readonly/);
      return build(id, options);
    } finally { db.pragma('query_only=OFF'); }
  }
  return { db, registry, world, actor, other, now, appointment, read, advance: ms => { now += ms; } };
}


const free = { startTime: '00:00', endTime: '24:00', tags: ['idle'], replyDelay: 0, location: '修补屋' };
const daily = (f,date,slots) => f.db.prepare('INSERT INTO daily_schedules VALUES(1,?,?)').run(date,JSON.stringify(slots));

test('query_only scopes accepted records to canonical player/character and current epoch; bounds and order', t => {
  const f=fixture(t);
  for (const wrong of [{actor:f.other.actorId},{character:2},{player:f.other.actorId},{world:'other'},
    {epoch:99},{status:'cancelled'},{status:'expired'},{start:f.now-HOUR},{start:f.now+7*24*HOUR}]) f.appointment(wrong);
  assert.deepEqual(f.read(),{worldId:f.world.worldId,worldEpoch:f.world.epoch,characterId:1,timeZone:'Asia/Shanghai',appointments:[]});
  for(let n=23;n>=1;n--) f.appointment({start:f.now+n*HOUR});
  assert.equal(f.read().appointments.length,20);
  const result=f.read(1,{limit:1});
  assert.equal(result.appointments.length,1);assert.equal(result.appointments[0].startAt,f.now+HOUR);
  assert.deepEqual(Object.keys(result.appointments[0]).sort(),['appointmentId','startAt','endAt','location','status','availability','reason'].sort());
  for(const limit of [0,21,1.5,'2',NaN]) assert.throws(()=>f.read(1,{limit}),RangeError);
  f.registry.advanceEpoch({expectedEpoch:f.world.epoch});
  assert.equal(f.read().worldEpoch,f.world.epoch+1);assert.deepEqual(f.read().appointments,[]);
});

test('query_only returns empty for absent, withdrawn, archived or invalid character and unavailable player',t=>{
  const f=fixture(t);f.appointment();
  for(const id of [3,99,0,-1,'1',NaN]) assert.deepEqual(f.read(id).appointments,[]);
  f.db.prepare('UPDATE town_characters SET town_enabled=0 WHERE character_id=1').run();f.registry.synchronize();
  assert.deepEqual(f.read().appointments,[]);
  f.db.prepare('UPDATE town_characters SET town_enabled=1 WHERE character_id=1').run();f.registry.synchronize();
  assert.equal(f.read().appointments.length,1);
  f.db.prepare('UPDATE town_actors SET archived=1 WHERE actor_id=?').run(f.actor.actorId);
  assert.deepEqual(f.read().appointments,[]);f.registry.synchronize();
  const player=f.registry.resolveAgentKey('me');
  f.db.prepare('UPDATE town_actors SET participating=0 WHERE actor_id=?').run(player.actorId);
  assert.deepEqual(f.read().appointments,[]);
});

test('query_only reads future persisted schedule, preserves conflict records and never creates snapshots',t=>{
  const f=fixture(t);f.appointment({start:f.now+24*HOUR});
  daily(f,'2026-09-08',[{...free,tags:['work']}]);daily(f,'2026-09-09',[free]);
  assert.equal(f.read().appointments[0].availability,'currently_free');
  f.db.prepare("UPDATE daily_schedules SET schedule_json=? WHERE schedule_date='2026-09-09'").run(JSON.stringify([{...free,tags:['work']}]));
  assert.equal(f.read().appointments[0].reason,'WORKING');
  assert.equal(f.read().appointments[0].availability,'needs_reconfirmation');
  assert.equal(f.db.prepare('SELECT count(*) n FROM daily_schedules').get().n,2);
  assert.equal(f.db.prepare('SELECT status FROM town_appointments').get().status,'accepted');
});

test('query_only missing and replaced POI retain accepted record needing reconfirmation',t=>{
  const f=fixture(t);f.appointment();
  f.db.prepare('DELETE FROM town_locations').run();
  assert.equal(f.read().appointments[0].reason,'LOCATION_UNAVAILABLE');
  assert.equal(f.read().appointments[0].location,'workshop');
  f.db.prepare("INSERT INTO town_locations VALUES(2,'workshop','重建工坊','[]')").run();
  assert.equal(f.read().appointments[0].availability,'needs_reconfirmation');
  f.db.prepare("UPDATE town_locations SET id=1,key='replacement'").run();
  assert.equal(f.read().appointments[0].reason,'LOCATION_UNAVAILABLE');
});

test('query_only end boundary and seven-day endpoint are exact, ongoing checks remaining interval',t=>{
  const f=fixture(t);f.appointment({start:f.now-HOUR/4});
  daily(f,'2026-09-08',[{...free,startTime:'08:45',endTime:'09:00',tags:['work']}]);
  assert.equal(f.read().appointments[0].availability,'currently_free');
  f.advance(HOUR/4);assert.deepEqual(f.read().appointments,[]);
  const g=fixture(t);g.appointment({start:g.now+7*24*HOUR-HOUR/2});
  assert.equal(g.read().appointments.length,1);
});

test('query_only DST uses calendar dates and caller timezone without changing UTC timestamps',t=>{
  const now=Date.parse('2026-03-08T12:00:00-04:00');
  const start=Date.parse('2026-03-09T00:10:00-04:00');
  const f=fixture(t,{now,timeZone:'America/New_York'});f.appointment({start});
  daily(f,'2026-03-08',[{...free,startTime:'23:00',endTime:'01:00',tags:['sleep']}]);daily(f,'2026-03-09',[]);
  const result=f.read();
  assert.equal(result.timeZone,'America/New_York');assert.equal(result.appointments[0].startAt,start);
  assert.equal(result.appointments[0].reason,'SLEEPING_OR_REST');
  const utc=createCharacterTownAppointments({db:f.db,registry:f.registry,clock:{now:()=>now},timeZone:'UTC'});
  f.db.pragma('query_only=ON');
  try {assert.equal(utc(1).appointments[0].availability,'currently_free');} finally {f.db.pragma('query_only=OFF');}
});

// Real route source/registration, only import boundaries replaced. No application
// initialization, scheduler, model, network or singleton database is imported.
function httpFixture(f,{enabled=true,features={town:enabled}}={}) {
  const names=[];
  const source=readFileSync(new URL('../src/routes/schedule.js',import.meta.url),'utf8')
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g,(_,imports)=>{
      names.push(...imports.split(',').map(n=>n.trim()).filter(Boolean));return '';
    }).replace(/export function /g,'function ').replace('export default router;','');
  assert.doesNotMatch(source,/\bimport\s/);
  const deps={Router,getDb:()=>f.db,createTownActorRegistry,createCharacterTownAppointments,
    config:{features,town:{timeZone:'Asia/Shanghai'}}};
  const router=compileFunction(`${source}\nreturn router;`,names)(...names.map(name=>deps[name]??(()=>assert.fail(`Unexpected dependency ${name}`))));
  const route=router.stack.find(layer=>layer.route?.path==='/:characterId/overlays'&&layer.route.methods.get).route;
  return (id='1',query={})=>{
    const response={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
    f.db.pragma('query_only=ON');
    try {route.stack[0].handle({params:{characterId:id},query},response);return response;}
    finally {f.db.pragma('query_only=OFF');}
  };
}

test('HTTP source fixture returns real read-only DTO and ignores client identity/epoch overrides',t=>{
  const f=fixture(t);f.appointment();t.mock.method(Date,'now',()=>f.now);
  const get=httpFixture(f);
  const result=get('1',{limit:'1',worldId:'other',worldEpoch:'999',actorId:f.other.actorId});
  assert.equal(result.statusCode,200);assert.deepEqual(result.body,f.read(1,{limit:1}));
  assert.equal(get('99').body.appointments.length,0);
  for(const id of ['1x','0','-1','1.5','9007199254740992']) assert.equal(get(id).statusCode,400);
  for(const limit of ['0','21','1.5',['1'],{},'NaN']) assert.equal(get('1',{limit}).statusCode,400);
  assert.deepEqual(get('1',{limit:'21'}).body,
    {error:'角色或记录数量无效，请重新选择。',code:'INVALID_OVERLAY_QUERY'});
});

test('HTTP source fixture town disabled returns scoped empty without appointment/schedule reads or maintenance',t=>{
  const f=fixture(t);f.appointment();t.mock.method(Date,'now',()=>f.now);
  const get=httpFixture(f,{enabled:false});
  // Tables deliberately absent: the disabled branch must only read world scope.
  f.db.exec('DROP TABLE town_appointments; DROP TABLE daily_schedules; DROP TABLE schedule_templates;');
  const result=get();
  assert.equal(result.statusCode,200);
  assert.deepEqual(result.body,{worldId:f.world.worldId,worldEpoch:f.world.epoch,characterId:1,timeZone:'Asia/Shanghai',appointments:[]});
});

test('HTTP source fixture undefined town feature returns scoped empty without overlay reads',t=>{
  const f=fixture(t);f.appointment();
  f.db.exec('DROP TABLE town_appointments; DROP TABLE daily_schedules; DROP TABLE schedule_templates;');
  for(const features of [{},{town:undefined}]) {
    const result=httpFixture(f,{features})();
    assert.equal(result.statusCode,200);
    assert.deepEqual(result.body,{worldId:f.world.worldId,worldEpoch:f.world.epoch,
      characterId:1,timeZone:'Asia/Shanghai',appointments:[]});
  }
});

test('HTTP source fixture database failure returns generic error without SQL details, retaining server diagnostics',t=>{
  const f=fixture(t);f.appointment();t.mock.method(Date,'now',()=>f.now);
  const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
  const get=httpFixture(f);
  // A real SQLite prepare failure, rather than a hand-authored route response.
  f.db.exec('DROP TABLE town_appointments');
  const result=get();
  assert.equal(result.statusCode,500);
  assert.deepEqual(result.body,{error:'回访安排暂时无法读取，请稍后再试。',code:'OVERLAY_READ_FAILED'});
  assert.doesNotMatch(JSON.stringify(result.body),/SELECT|SQLITE|no such table|town_appointments|stack/i);
  assert.equal(logs.length,1);
  assert.match(logs[0].join(' '),/no such table: town_appointments/);
});
