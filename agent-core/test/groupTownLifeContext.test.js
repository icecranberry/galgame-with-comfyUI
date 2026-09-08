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

const source = readFileSync(new URL('../src/services/groupChatEngine.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
assert.doesNotMatch(source, /^import /m);
function fixture(t, count = 2) {
  const db = new Database(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,name,display_name,short_prompt,base_prompt,avatar_path,loras,custom_workflow,artist_override,is_sleeping);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id,town_enabled);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled);
    CREATE TABLE town_domain_events(event_id TEXT PRIMARY KEY);
    CREATE TABLE group_chats(id INTEGER PRIMARY KEY,name,topic,last_message_at);
    INSERT INTO group_chats(id,name) VALUES(99,'隔离群');
    CREATE TABLE group_members(id INTEGER PRIMARY KEY,group_id,character_id);
    CREATE TABLE character_relationships(id INTEGER PRIMARY KEY,from_character_id,to_character_id,relationship_text);
    CREATE TABLE user_relationships(character_id,relationship_text);
    CREATE TABLE rolling_summaries(id INTEGER PRIMARY KEY,conversation_id,end_msg_id,summary,checkpoint_version);
    CREATE TABLE raw_messages(id INTEGER PRIMARY KEY,conversation_id,role,content);
    CREATE TABLE messages(id INTEGER PRIMARY KEY,conversation_id,raw_id,role,content,images,seq,speaker_character_id);`);
  for (let id=1;id<=count+1;id++) {
    db.prepare('INSERT INTO characters(id,name,display_name,short_prompt,is_sleeping) VALUES(?,?,?,?,0)').run(id,`c${id}`,`角色${id}`,'原人格');
    db.prepare('INSERT INTO town_characters VALUES(?,1)').run(id);
    if(id<=count)db.prepare('INSERT INTO group_members VALUES(?,99,?)').run(100+id,id);
  }
  migrateTownSchema(db);migrateTownExperienceSchema(db);migrateTownAppointmentSchema(db);
  const registry=createTownActorRegistry(db), world=registry.getWorldState();
  const actors=Array.from({length:count+1},(_,i)=>registry.resolveAgentKey(`char:${i+1}`));
  let now=Date.parse('2026-09-08T09:00:00+08:00'),seq=0,search=async()=>[];
  const calls=[],reads=[],warnings=[],emitted=[],deferred=[];
  const config={features:{town:true,memory:false},town:{timeZone:'Asia/Shanghai'},user:{nickname:'用户'}};
  const failIds=new Set();
  const forbid=()=>assert.fail('real network/image/scheduler forbidden');
  class FixedDate extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }
  const deps={getDb:()=>db,config,Date:FixedDate,Math:Object.assign(Object.create(Math),{random:()=>1}),
    createTownActorRegistry,createCharacterTownLifeContext: opts=>{
      const real=createCharacterTownLifeContext(opts);
      return id=>{reads.push({id,now:opts.clock.now(),timeZone:opts.timeZone});
        if(failIds.has(id))throw new Error('fixture read failure');
        db.pragma('query_only=ON');try{return real(id);}finally{db.pragma('query_only=OFF');}
      };
    },
    getSystemRules:()=>'',getWorldSetting:()=>'',getGlobalRule:()=>null,
    buildCharacterPersona:c=>c.short_prompt,buildGroupEmojiNote:()=>'',getRecentSummaries:()=>[],
    countCompletedGroupRounds:()=>0,getTimeTag:()=> '固定时刻',getEmojiCategories:()=>[],getCharacterEmojiMap:()=>new Map(),
    hybridSearch:(...args)=>search(...args),RAG_TIMEOUT_FAST_MS:1000,setTimeout:()=>0,
    chatStream:async function*(msgs,opts){calls.push(structuredClone({msgs,opts}));yield '角色1: 原回复\n[END]\n';},
    parseGroupEmojiText:()=>({invalidEmoji:false}),parseEmojiText:content=>({content,images:[]}),splitText:text=>[text],
    stripImagePromptLines:text=>text,generateImage:forbid,setInterval:forbid,
    setImmediate:fn=>deferred.push(fn),console:{log(){},error:forbid,warn:(...args)=>warnings.push(args)}};
  const run=compileFunction(`${source}\nreturn runGroupRound;`,Object.keys(deps))(...Object.values(deps));
  function seed(id,summary,extra={}) {
    const scope=registry.getWorldState(),event=`event${++seq}`;
    db.prepare('INSERT INTO town_domain_events VALUES(?)').run(event);
    db.prepare('INSERT INTO town_experiences(event_id,actor_id,world_id,world_epoch,occurred_at,summary) VALUES(?,?,?,?,?,?)')
      .run(event,actors[id-1].actorId,extra.worldId??scope.worldId,extra.epoch??scope.epoch,now,summary);
  }
  return {db,config,calls,reads,warnings,actors,world,registry,seed,failIds,deferred,
    advance:()=>{now+=3600000;},setSearch:fn=>{search=fn;},
    run:()=>run(99,{trigger:'user',userMessage:'原用户文本',emit:(...args)=>emitted.push(args)}),
    clearHistory:()=>db.exec('DELETE FROM messages; DELETE FROM raw_messages;')};
}
function block(call){return call.msgs.find(m=>m.content.startsWith('<group_town_life_records>'))?.content;}
function records(content){return JSON.parse(content.split('\n')[2]);}

test('real pipeline attributes real character IDs, preserves reply protocol and makes one fake stream call',async t=>{
  const f=fixture(t);f.seed(1,'一号独有经历');f.seed(2,'二号独有经历');f.seed(3,'非群成员秘密');
  f.seed(1,'旧纪元秘密',{epoch:77});f.seed(1,'其他世界秘密',{worldId:'other'});
  const result=await f.run();assert.equal(f.calls.length,1);
  assert.equal(result.messages[0].speaker_character_id,1);assert.equal(result.messages[0].content,'原回复');
  const text=block(f.calls[0]),data=records(text);assert.ok(text.length<=6000);
  assert.deepEqual(data.map(r=>r.characterId),[1,2]);
  assert.match(data[0].content,/一号独有经历/);assert.doesNotMatch(data[0].content,/二号独有经历/);
  assert.match(data[1].content,/二号独有经历/);assert.doesNotMatch(text,/非群成员秘密|旧纪元秘密|其他世界秘密/);
  assert.match(text,/各成员只能认领自己的记录/);assert.equal(new Set(f.reads.map(r=>r.now)).size,1);
  assert.equal(f.reads[0].timeZone,'Asia/Shanghai');
  assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM raw_messages').all()),/独有经历/);
});

test('disabled/nonboolean/empty facts preserve complete original messages and options byte for byte',async t=>{
  const f=fixture(t);f.config.features.town=false;await f.run();const base=JSON.stringify(f.calls[0]);
  f.clearHistory();f.config.features.town=true;f.seed(3,'无关');await f.run();assert.equal(JSON.stringify(f.calls[1]),base);
  f.clearHistory();f.seed(1,'已有');f.config.features.town='true';await f.run();assert.equal(JSON.stringify(f.calls[2]),base);
});

test('world changed during RAG is read only after await with current time',async t=>{
  const f=fixture(t);f.seed(1,'旧世界');f.config.features.memory=true;
  let release;f.setSearch(()=>new Promise(resolve=>{release=resolve;}));const pending=f.run();
  assert.equal(f.calls.length,0);assert.equal(f.reads.length,0);
  f.db.prepare('UPDATE town_world_state SET epoch=epoch+1').run();f.advance();f.seed(1,'新世界');release([]);
  await pending;assert.match(block(f.calls[0]),/新世界/);assert.doesNotMatch(block(f.calls[0]),/旧世界/);
  assert.equal(f.calls.length,1);
});

test('one member read failure retains other facts; all failures still produce original reply',async t=>{
  const f=fixture(t);f.seed(1,'第一位');f.seed(2,'第二位');f.failIds.add(1);
  await f.run();assert.deepEqual(records(block(f.calls[0])).map(r=>r.characterId),[2]);
  f.clearHistory();f.failIds.add(2);const result=await f.run();assert.equal(block(f.calls[1]),undefined);
  assert.equal(result.messages[0].content,'原回复');assert.equal(f.calls.length,2);assert.equal(f.warnings.length,3);
});

test('aggregate escaped budget includes framing; skips oversized member and continues with intact real blocks',async t=>{
  const f=fixture(t,8);
  // A huge display name cannot consume the budget or prevent later members being considered.
  f.db.prepare('UPDATE characters SET display_name=? WHERE id=1').run('</tag>&'.repeat(1500));
  for(let id=1;id<=8;id++)for(let j=0;j<3;j++)f.seed(id,`记录${id}:`+'甲'.repeat(150));
  await f.run();const text=block(f.calls[0]),data=records(text);
  assert.ok(text.length<=6000);assert.ok(data.length>0&&data.length<7);assert.ok(!data.some(r=>r.characterId===1));
  assert.ok(data.some(r=>r.characterId===2));assert.equal(f.reads.length,8);
  const real=createCharacterTownLifeContext({db:f.db,registry:f.registry,clock:{now:()=>f.reads[0].now}});
  for(const row of data)assert.equal(row.content,real(row.characterId));
  assert.doesNotMatch(text,/<town_life_records>/);
});
