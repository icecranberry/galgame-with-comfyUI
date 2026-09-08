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

// Complete production module source, import boundaries injected; no copied prompt/parser.
const source = readFileSync(new URL('../src/services/mailboxScheduler.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
assert.doesNotMatch(source, /^import /m);
const reply = { text: '原回信正文', paperPrompt: 'paper fixture', portraitPrompt: 'portrait fixture', illustrationPrompt: 'illustration fixture' };
function fixture(t) {
  const db = new Database(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,is_sleeping INTEGER);
    INSERT INTO characters VALUES(1,0),(2,0);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    INSERT INTO town_characters VALUES(1,1),(2,1);
    CREATE TABLE town_domain_events(event_id TEXT PRIMARY KEY);
    CREATE TABLE moment_posts(character_id INTEGER,content TEXT,created_at TEXT,status TEXT);
    CREATE TABLE raw_messages(id INTEGER PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT);
    CREATE TABLE rolling_summaries(id INTEGER PRIMARY KEY,conversation_id TEXT,summary TEXT);
    CREATE TABLE memory_fragments(conversation_id TEXT,judgment TEXT,status TEXT,updated_at TEXT,created_at TEXT);
    CREATE TABLE user_relationships(character_id INTEGER,relationship_text TEXT,affinity INTEGER,is_oath INTEGER);
    CREATE TABLE user_portraits(id INTEGER PRIMARY KEY,character_id INTEGER,trait_type TEXT,content TEXT);
    CREATE TABLE mailbox_letters(character_id INTEGER,direction TEXT,status TEXT,content TEXT,reply_content TEXT,replied_at TEXT);`);
  migrateTownSchema(db); migrateTownExperienceSchema(db); migrateTownAppointmentSchema(db);
  const registry = createTownActorRegistry(db), world = registry.getWorldState();
  const actor = registry.resolveAgentKey('char:1'), other = registry.resolveAgentKey('char:2');
  const config = { features: { town: true }, town: { timeZone: 'Asia/Shanghai' }, user: { nickname: '用户' } };
  let now = Date.parse('2026-09-08T09:00:00+08:00'), seq = 0, search = async () => [];
  const calls = [], warnings = [];
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const forbid = () => assert.fail('scheduler/image/persistence side effect forbidden');
  const deps = { getDb: () => db, config, Date: FixedDate, createTownActorRegistry, createCharacterTownLifeContext,
    getSystemRulesWithWorld: () => '原舞台', getGlobalRule: () => null, appendOathRing: value => value,
    hybridSearch: (...args) => search(...args), loadEmotionState: () => null, stateToPrompt: () => '',
    formatScheduleContext: () => '', getTimeLight: () => null,
    chatSync: async (msgs, opts) => { calls.push({ msgs: structuredClone(msgs), opts }); return JSON.stringify(reply); },
    console: { log() {}, warn: (...args) => warnings.push(args), error: forbid },
    generateImage: forbid, ensureFontForCharacter: forbid, broadcast: forbid, setInterval: forbid, setTimeout: forbid,
    buildCharacterPersona: forbid, recordCompletedImageTask: forbid, saveBase64Image: forbid };
  const generate = compileFunction(`${source}\nreturn generateReplyData;`, Object.keys(deps))(...Object.values(deps));
  function seed(summary, extra = {}) {
    const current = registry.getWorldState();
    const row = { actor: actor.actorId, world: current.worldId, epoch: current.epoch, at: now, ...extra };
    const id = `event${++seq}`; db.prepare('INSERT INTO town_domain_events VALUES(?)').run(id);
    db.prepare('INSERT INTO town_experiences(event_id,actor_id,world_id,world_epoch,occurred_at,summary) VALUES(?,?,?,?,?,?)')
      .run(id,row.actor,row.world,row.epoch,row.at,summary);
  }
  function run() {
    db.pragma('query_only=ON');
    return generate(1,'角色','原完整人格','原来信\n逐字保留',null);
  }
  return { db, actor, other, world, config, calls, warnings, seed, run,
    setSearch: fn => { search = fn; }, advance: ms => { now += ms; } };
}

test('actual generateReplyData adds bounded current canonical facts; original JSON/task/persona and one call preserved', async t => {
  const f=fixture(t); f.seed('已结算的可信生活记录');
  f.seed('另一角色秘密',{actor:f.other.actorId});f.seed('旧纪元秘密',{epoch:2});f.seed('别的世界秘密',{world:'other'});
  assert.deepEqual(await f.run(),reply);assert.equal(f.calls.length,1);
  const {msgs,opts}=f.calls[0], block=msgs.find(m=>m.content.startsWith('<town_life_records>'));
  assert.ok(block.content.length<=1800);assert.match(block.content,/可信生活记录/);
  assert.doesNotMatch(JSON.stringify(msgs),/另一角色秘密|旧纪元秘密|别的世界秘密/);
  assert.ok(msgs.some(m=>m.content==='原完整人格'));
  assert.equal(msgs.at(-1).role,'user');assert.match(msgs.at(-1).content,/原来信\n逐字保留/);
  for(const field of Object.keys(reply))assert.ok(msgs.at(-1).content.includes(`"${field}"`));
  assert.deepEqual(opts,{temperature:0.7,max_tokens:4096,response_format:{type:'json_object'},label:'信箱回信助手'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM mailbox_letters').get().n,0);
});

test('disabled, nonboolean gate and unrelated-only records keep original prompt byte identical', async t => {
  const f=fixture(t); f.seed('其他角色',{actor:f.other.actorId});f.seed('旧纪元',{epoch:2});
  f.config.features.town=false;await f.run();const baseline=JSON.stringify(f.calls[0]);
  f.config.features.town=true;await f.run();assert.equal(JSON.stringify(f.calls[1]),baseline);
  f.db.pragma('query_only=OFF');f.seed('当前角色记录');f.config.features.town='true';await f.run();
  assert.equal(JSON.stringify(f.calls[2]),baseline);
  f.config.features.town=false;await f.run();assert.equal(JSON.stringify(f.calls[3]),baseline);
  assert.equal(f.calls.length,4);
});

test('world/time changes during hybridSearch await are read immediately before chatSync', async t => {
  const f=fixture(t);f.seed('检索前旧世界记录');
  let release;f.setSearch(()=>new Promise(resolve=>{release=resolve;}));
  const pending=f.run();assert.equal(f.calls.length,0);
  f.db.pragma('query_only=OFF');
  f.db.prepare('UPDATE town_world_state SET epoch=epoch+1').run();f.advance(73*3600000);
  f.seed('检索后当前记录');f.db.pragma('query_only=ON');release([]);
  assert.deepEqual(await pending,reply);assert.equal(f.calls.length,1);
  assert.match(JSON.stringify(f.calls[0].msgs),/检索后当前记录/);
  assert.doesNotMatch(JSON.stringify(f.calls[0].msgs),/检索前旧世界记录/);
});

test('life read failure does not block original reply or add model calls', async t => {
  const f=fixture(t);f.config.features.town=false;await f.run();const baseline=JSON.stringify(f.calls[0]);
  f.db.pragma('query_only=OFF');f.db.exec('DROP TABLE town_experiences');f.config.features.town=true;
  assert.deepEqual(await f.run(),reply);assert.equal(JSON.stringify(f.calls[1]),baseline);
  assert.equal(f.calls.length,2);assert.equal(f.warnings.length,1);
});
