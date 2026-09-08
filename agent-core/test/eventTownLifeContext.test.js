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

// Execute the complete production module with import boundaries injected, not a copied prompt/parser.
const source = readFileSync(new URL('../src/services/eventGenerator.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
assert.doesNotMatch(source, /^import /m);
const reply={title:'窗边片刻',description:'角色放下手里的杯子。',prompt:'fixture scene',choiceA:'看向窗外',choiceB:'继续读书',choiceCLabel:'自由行动'};
function fixture(t) {
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,display_name,base_prompt,short_prompt,loras,artist_override,is_sleeping);
    INSERT INTO characters VALUES(7,'主角色','原人格','原简述',NULL,NULL,0),(8,'关系角色','另一人格','另一简述',NULL,NULL,0);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id,town_enabled);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled);
    INSERT INTO town_characters VALUES(7,1),(8,1);
    CREATE TABLE town_domain_events(event_id TEXT PRIMARY KEY);
    CREATE TABLE event_types(id INTEGER PRIMARY KEY,key,name,duration_min,urgency,fun_from,desc,is_active);
    INSERT INTO event_types VALUES(1,'on_break','休息',60,1,'[]','安静休息',1);
    CREATE TABLE character_relationships(from_character_id,to_character_id,relationship_text);
    INSERT INTO character_relationships VALUES(7,8,'朋友');
    CREATE TABLE moment_posts(character_id,status,created_at,content);
    CREATE TABLE character_events(id INTEGER PRIMARY KEY,character_id,event_type_key,status,title,description,image,prompt,style,resolution,
      choice_a,choice_b,choice_c_label,current_branch,max_branches,choice_history,expires_at,created_at DEFAULT '2026-09-08 01:00:00');`);
  migrateTownSchema(db);migrateTownExperienceSchema(db);migrateTownAppointmentSchema(db);
  const registry=createTownActorRegistry(db),world=registry.getWorldState();
  const actors=[registry.resolveAgentKey('char:7'),registry.resolveAgentKey('char:8')];
  let now=Date.parse('2026-09-08T09:00:00+08:00'),seq=0,failRead=false;
  const calls=[],images=[],broadcasts=[],reads=[],warnings=[];
  const config={features:{town:true,schedule:true},town:{timeZone:'Asia/Shanghai'},user:{nickname:'用户'},comfyui:{eventArtist:'fixture',eventWidth:64,eventHeight:64}};
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const forbid=()=>assert.fail('real network/file/scheduler side effect forbidden');
  const deps={getDb:()=>db,config,Date:FixedDate,Math:Object.assign(Object.create(Math),{random:()=>0}),
    createTownActorRegistry,createCharacterTownLifeContext:opts=>{
      const real=createCharacterTownLifeContext(opts);
      return id=>{reads.push({id,now:opts.clock.now(),timeZone:opts.timeZone});if(failRead)throw new Error('fixture read failed');
        db.pragma('query_only=ON');try{return real(id);}finally{db.pragma('query_only=OFF');}};
    },
    getSystemRules:()=> '原规则',getSystemRulesWithWorld:()=> '原规则',getWorldSetting:()=>'',getGlobalRule:()=>null,
    buildCharacterPersona:c=>c.base_prompt||c.short_prompt,appendOathRing:v=>v,
    getCurrentActivity:()=>({location:'书房',activity:'阅读',description:'原日程'}),getTimeTag:()=> '固定时刻',getLightNoteWithWeather:()=>'',
    chatSync:async(msgs,opts)=>{calls.push(structuredClone({msgs,opts}));return JSON.stringify(reply);},
    charArtistOverrideWithFallback:()=>null,
    generateImageRaw:async(...args)=>{images.push(args);return {success:true,images:[{filename:'fake.png',base64:'fixture'}]};},
    saveBase64Image:()=>'/fixture/event.png',recordCompletedImageTask:()=>{},
    broadcastNewEvent:event=>broadcasts.push(event),broadcastEventUpdate:forbid,broadcastEventConclusion:forbid,
    setInterval:forbid,fetch:forbid,console:{log(){},warn:(...args)=>warnings.push(args),error:forbid}};
  const generate=compileFunction(`${source}\nreturn generateEvent;`,Object.keys(deps))(...Object.values(deps));
  const character=db.prepare('SELECT * FROM characters WHERE id=7').get();
  function seed(summary,extra={}) {
    const current=registry.getWorldState(),event=`e${++seq}`;db.prepare('INSERT INTO town_domain_events VALUES(?)').run(event);
    db.prepare('INSERT INTO town_experiences(event_id,actor_id,world_id,world_epoch,occurred_at,summary) VALUES(?,?,?,?,?,?)')
      .run(event,extra.actor??actors[0].actorId,extra.world??current.worldId,extra.epoch??current.epoch,now,summary);
  }
  return {db,registry,world,actors,config,calls,images,broadcasts,reads,warnings,seed,
    fail:()=>{failRead=true;},advance:()=>{now+=3600000;},clear:()=>db.exec('DELETE FROM character_events'),
    run:(opts={eventTypeKey:'on_break'})=>generate(character,opts)};
}
const block=call=>call.msgs.find(m=>m.content.startsWith('【角色此前生活记录'))?.content;

test('actual initial pipeline uses only canonical main-character background and preserves event/image/broadcast fields',async t=>{
  const f=fixture(t);f.seed('已结算配送独有记录');f.seed('关系角色秘密',{actor:f.actors[1].actorId});
  f.seed('旧epoch秘密',{epoch:99});f.seed('其他world秘密',{world:'other'});
  const event=await f.run();assert.equal(f.calls.length,1);assert.equal(f.images.length,1);assert.equal(f.broadcasts.length,1);
  const text=block(f.calls[0]);assert.match(text,/已结算配送独有记录/);
  assert.doesNotMatch(text,/关系角色秘密|旧epoch秘密|其他world秘密/);
  assert.match(text,/不要求引用或复演/);assert.match(text,/不得据此新增约定/);
  assert.deepEqual(f.reads.map(r=>r.id),[7]);assert.equal(f.reads[0].timeZone,'Asia/Shanghai');
  assert.ok(f.calls[0].msgs.some(m=>m.content.includes('另一人格')),'original multi-person selection is retained');
  assert.match(JSON.stringify(f.calls[0].msgs),/书房|阅读/);
  const actual=createCharacterTownLifeContext({db:f.db,registry:f.registry,clock:{now:()=>f.reads[0].now}})(7);
  assert.ok(actual.length<=1800);assert.ok(text.endsWith(actual));
  assert.equal(event.character_id,7);assert.equal(event.event_type_key,'on_break');
  assert.equal(event.title,reply.title);assert.equal(event.description,reply.description);assert.equal(event.prompt,reply.prompt);
  assert.equal(event.choice_a,reply.choiceA);assert.equal(event.choice_b,reply.choiceB);assert.equal(event.image,'/fixture/event.png');
  assert.doesNotMatch(JSON.stringify([event,f.broadcasts,f.images]),/已结算配送独有记录|town_life_records/);
  assert.equal(f.calls[0].opts.label,'奇遇生成');
});

test('empty, disabled and nonboolean gates preserve full original msgs/options byte identity',async t=>{
  const f=fixture(t);f.config.features.town=false;await f.run();const baseline=JSON.stringify(f.calls[0]);
  f.clear();f.config.features.town=true;f.seed('无关',{actor:f.actors[1].actorId});await f.run();assert.equal(JSON.stringify(f.calls[1]),baseline);
  f.clear();f.seed('本角色记录');f.config.features.town='true';await f.run();assert.equal(JSON.stringify(f.calls[2]),baseline);
  f.clear();f.config.features.town=false;await f.run();assert.equal(JSON.stringify(f.calls[3]),baseline);
});

test('reads current epoch/time per actual generation, without cached prior facts',async t=>{
  const f=fixture(t);f.seed('之前的记录');await f.run();assert.match(block(f.calls[0]),/之前的记录/);
  f.clear();f.db.prepare('UPDATE town_world_state SET epoch=epoch+1').run();f.advance();f.seed('现在的记录');
  await f.run();assert.match(block(f.calls[1]),/现在的记录/);assert.doesNotMatch(block(f.calls[1]),/之前的记录/);
  assert.equal(f.reads[1].now-f.reads[0].now,3600000);
});

test('reader failure leaves original prompt and generation working; custom direction is unchanged',async t=>{
  const f=fixture(t);const opts={customPrompt:'坐在书房折纸',manual:true};
  f.config.features.town=false;await f.run(opts);const baseline=JSON.stringify(f.calls[0]);
  f.clear();f.config.features.town=true;f.fail();const event=await f.run(opts);
  assert.equal(JSON.stringify(f.calls[1]),baseline);assert.equal(event.event_type_key,'custom');
  assert.equal(f.warnings.length,1);assert.equal(f.calls.length,2);assert.equal(f.images.length,2);
  assert.equal(f.images[1][1].priority,'high');assert.equal(f.broadcasts.length,2);
});

test('existing active-event guard rejects before any life read or additional model/image/broadcast',async t=>{
  const f=fixture(t);await f.run();await assert.rejects(f.run(),/ALREADY_ACTIVE_EVENT/);
  assert.equal(f.reads.length,1);assert.equal(f.calls.length,1);assert.equal(f.images.length,1);assert.equal(f.broadcasts.length,1);
});
