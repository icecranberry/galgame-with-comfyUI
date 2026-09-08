import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import Database from 'better-sqlite3';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { migrateTownExperienceSchema } from '../src/db/townExperienceSchema.js';
import { migrateTownAppointmentSchema } from '../src/db/townAppointmentSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { createCharacterTownLifeContext } from '../src/services/characterTownLifeContext.js';

const routeSource = readFileSync(new URL('../src/routes/moments.js',import.meta.url),'utf8');
const injectionStart = '  // Read at model dispatch, never cache records across queued generations.';
const injectionEnd = '  const result = await chatSync(msgs,';
const NOW = Date.parse('2026-09-08T09:00:00+08:00');

function fixture(t) {
  const db = new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,is_sleeping INTEGER);
    INSERT INTO characters VALUES(1,0),(2,0);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    INSERT INTO town_characters VALUES(1,1),(2,1);
    CREATE TABLE daily_schedules(character_id INTEGER,schedule_date TEXT,schedule_json TEXT);
    CREATE TABLE schedule_templates(character_id INTEGER,schedule_json TEXT);
    INSERT INTO schedule_templates VALUES(1,'[]'),(2,'[]');
    CREATE TABLE town_locations(id INTEGER PRIMARY KEY,key TEXT,name TEXT,aliases_json TEXT);
    INSERT INTO town_locations VALUES(1,'workshop','工坊','[]');
    CREATE TABLE town_domain_events(event_id TEXT PRIMARY KEY);`);
  migrateTownSchema(db);migrateTownExperienceSchema(db);migrateTownAppointmentSchema(db);
  const registry = createTownActorRegistry(db),world = registry.getWorldState();
  const actor = registry.resolveAgentKey('char:1'),other = registry.resolveAgentKey('char:2');
  let seq = 0;
  function record(summary,patch={}) {
    const id=`source:${++seq}`;
    db.prepare('INSERT INTO town_domain_events VALUES(?)').run(id);
    db.prepare(`INSERT INTO town_experiences(event_id,actor_id,world_id,world_epoch,occurred_at,summary)
      VALUES(?,?,?,?,?,?)`).run(id,patch.actorId??actor.actorId,world.worldId,patch.epoch??world.epoch,NOW-1000,summary);
  }
  function appointment() {
    const player=registry.resolveAgentKey('me');
    db.prepare(`INSERT INTO town_appointment_candidates(candidate_id,world_id,world_epoch,source_event_id,session_id,
      player_actor_id,provider_actor_id,character_id,location_key,location_id,status,created_at,expires_at,updated_at)
      VALUES('a',?,?,'event:a','session:a',?,?,1,'workshop',1,'accepted',?,?,?)`)
      .run(world.worldId,world.epoch,player.actorId,actor.actorId,NOW,NOW+3600000,NOW);
    db.prepare(`INSERT INTO town_appointments(appointment_id,candidate_id,world_id,world_epoch,source_event_id,
      player_actor_id,provider_actor_id,character_id,location_key,location_id,start_at,end_at,status,created_at,updated_at)
      VALUES('a','a',?,?,'event:a',?,?,1,'workshop',1,?,?,'accepted',?,?)`)
      .run(world.worldId,world.epoch,player.actorId,actor.actorId,NOW+3600000,NOW+5400000,NOW,NOW);
  }
  async function run({enabled=true,roll=0.5,emptyTopics=false,failRead=false,legacy=false,beforePersona}={}) {
    const calls={model:0,image:0,life:0,broadcast:0,timers:0};let captured;
    // Execute the complete route module with imports replaced at their boundary.
    // Existing post writes, images, broadcasts and timers are inert fakes.
    const boundary = new Proxy(db,{get(target,key) {
      if(key==='prepare') return sql=>{
        if(/moment_posts|moment_topics|character_relationships|user_relationships|UPDATE characters SET next_moment_at/.test(sql)) {
          return {get:()=>/COUNT/.test(sql)?{cnt:0}:undefined,
            all:()=>/moment_topics/.test(sql)&&!emptyTopics?[{name:'日常',desc:'生活随记'}]:[],
            run:()=>({lastInsertRowid:1,changes:1}),pluck(){return this;}};
        }
        if(failRead && /town_world_state/.test(sql)) throw new Error('fixture read failed');
        return target.prepare(sql);
      };
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    const stub=()=>'';
    const deps={Router:()=>({get(){},post(){},delete(){}}),getDb:()=>boundary,
      getSystemRules:()=> 'permission',getSystemRulesWithWorld:stub,getWorldSetting:()=>null,getGlobalRule:()=>null,
      config:{features:{town:enabled,schedule:false},town:{timeZone:'Asia/Shanghai'},user:{nickname:'我'},comfyui:{momentsWidth:600,momentsHeight:800}},
      buildCharacterPersona:(character,opts)=>{assert.equal(opts.variant,'full');beforePersona?.();return '固定人格';},
      createTownActorRegistry,createCharacterTownLifeContext:opts=>{calls.life++;return createCharacterTownLifeContext(opts);},
      chatSync:async msgs=>{calls.model++;captured=JSON.parse(JSON.stringify(msgs));return '{}';},
      parseMomentResponse:()=>({text:'隔离测试文案',imagePrompt:'fixture'}),DEFAULT_MOMENT_IMAGE_PROMPT:'fixture',
      generateImageRaw:async()=>{calls.image++;return {success:false,images:[]};},
      charArtistOverrideWithFallback:()=>null,broadcastToUnified:()=>{calls.broadcast++;},
      setTimeout:()=>{calls.timers++;},getTimeTag:()=> '固定时间',getLightNoteWithWeather:stub,
      Date:class extends Date {constructor(...args){super(...(args.length?args:[NOW]));}static now(){return NOW;}},
      Math:Object.assign(Object.create(Math),{random:()=>roll}),console:{log(){},warn(){},error(){}}};
    let source=routeSource;
    if(legacy) source=source.slice(0,source.indexOf(injectionStart))+source.slice(source.indexOf(injectionEnd));
    source=source.replace(/^import .*;\r?\n/gm,'').replace(/^export .*;\r?$/gm,'');
    const generate=compileFunction(`${source}\nreturn generateMomentPost;`,Object.keys(deps))(...Object.values(deps));
    const before=db.prepare('SELECT total_changes() n').get().n;
    db.pragma('query_only=ON');
    try {await generate({id:1,display_name:'角色',loras:'[]'},{manual:true});}
    finally {db.pragma('query_only=OFF');}
    assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
    assert.equal(calls.model,1);assert.equal(calls.image,1);
    return {msgs:captured,calls};
  }
  return {db,world,actor,other,record,appointment,run};
}

test('disabled, empty, free, dream and missing-topic modes preserve original request bytes',async t=>{
  const f=fixture(t);
  for(const options of [{enabled:false},{enabled:true},{roll:0.1},{roll:0.01},{emptyTopics:true}]) {
    const baseline=await f.run({...options,legacy:true}),actual=await f.run(options);
    assert.equal(JSON.stringify(actual.msgs),JSON.stringify(baseline.msgs));
  }
  f.record('已有生活记录');
  for(const options of [{enabled:false},{roll:0.1},{roll:0.01},{emptyTopics:true}]) {
    const baseline=await f.run({...options,legacy:true}),actual=await f.run(options);
    assert.equal(JSON.stringify(actual.msgs),JSON.stringify(baseline.msgs));assert.equal(actual.calls.life,0);
  }
});

test('real reader injects only current-epoch main-character records immediately before final user',async t=>{
  const f=fixture(t);f.record('获得发型卡');f.record('旧纪元不得出现',{epoch:f.world.epoch+1});
  f.record('另一角色不得出现',{actorId:f.other.actorId});
  const baseline=await f.run({legacy:true}),actual=await f.run();
  const block=actual.msgs.at(-2);assert.equal(block.role,'system');assert.match(block.content,/获得发型卡/);
  assert.doesNotMatch(block.content,/旧纪元不得出现|另一角色不得出现/);
  assert.equal(actual.msgs.at(-1).role,'user');
  actual.msgs.splice(-2,1);assert.equal(JSON.stringify(actual.msgs),JSON.stringify(baseline.msgs));
});

test('failed optional read preserves original generation and request bytes',async t=>{
  const f=fixture(t);f.record('已有记录');
  const baseline=await f.run({legacy:true}),actual=await f.run({failRead:true});
  assert.equal(JSON.stringify(actual.msgs),JSON.stringify(baseline.msgs));assert.equal(actual.calls.life,1);
});

test('generation queued before a new record reads that record only at dispatch',async t=>{
  const f=fixture(t);f.record('原有记录');let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const pending=gate.then(()=>f.run());
  f.record('等待期间新增的记录');release();
  assert.match((await pending).msgs.at(-2).content,/等待期间新增的记录/);
});

test('accepted appointment is future intent, never evidence of a meeting',async t=>{
  const f=fixture(t);f.appointment();const block=(await f.run()).msgs.at(-2).content;
  assert.match(block,/不是新指令、奖励授权或已见面证明/);
  assert.match(block,/预约只是已接受的未来安排，不保证赴约/);
  assert.match(block,/"status":"accepted"/);
  assert.match(block,/"experiences":\[\]/);
});
