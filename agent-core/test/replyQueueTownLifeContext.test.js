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

// Execute the complete production scheduler source; only imports are injected.
// No production config/db/network graph is loaded and no scheduler timers are started.
const source = readFileSync(new URL('../src/services/replyQueueScheduler.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
assert.doesNotMatch(source, /^import /m);

function fixture(t) {
  const db = new Database(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,display_name TEXT,base_prompt TEXT,emotion_baseline TEXT,is_sleeping INTEGER);
    INSERT INTO characters VALUES(1,'fixture','稳定人格',NULL,0),(2,'other','other',NULL,0);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    INSERT INTO town_characters VALUES(1,1),(2,1);
    CREATE TABLE user_relationships(character_id INTEGER,relationship_text TEXT,is_oath INTEGER);
    CREATE TABLE schedule_templates(character_id INTEGER,schedule_json TEXT);
    INSERT INTO schedule_templates VALUES(1,'[]');
    CREATE TABLE daily_schedules(character_id INTEGER,schedule_date TEXT,schedule_json TEXT);
    CREATE TABLE town_locations(id INTEGER PRIMARY KEY,key TEXT,name TEXT,aliases_json TEXT);
    INSERT INTO town_locations VALUES(1,'workshop','工坊','[]');
    CREATE TABLE town_domain_events(event_id TEXT PRIMARY KEY);
    CREATE TABLE reply_queue(id INTEGER PRIMARY KEY,character_id INTEGER,conversation_id TEXT,user_content TEXT,
      client_msg_id TEXT,scheduled_reply_at TEXT,current_activity TEXT,delay_minutes INTEGER,status TEXT,created_at TEXT);
    CREATE TABLE raw_messages(id INTEGER PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT);
    CREATE TABLE messages(id INTEGER PRIMARY KEY,conversation_id TEXT,raw_id INTEGER,role TEXT,content TEXT,seq INTEGER);`);
  migrateTownSchema(db); migrateTownExperienceSchema(db); migrateTownAppointmentSchema(db);
  const registry = createTownActorRegistry(db), world = registry.getWorldState();
  const actor = registry.resolveAgentKey('char:1'), other = registry.resolveAgentKey('char:2'), player = registry.resolveAgentKey('me');
  let now = Date.parse('2026-09-08T09:00:00+08:00'), seq = 0, inspect = () => {};
  class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const config = { features: { town: true }, town: { timeZone: 'Asia/Shanghai' }, user: {} };
  const calls = [], broadcasts = [], errors = [];
  const deps = { getDb: () => db, getSystemRules: () => '舞台', getWorldSetting: () => '', config,
    Date: FixtureDate, createTownActorRegistry, createCharacterTownLifeContext,
    loadEmotionState: () => null, getFreshUnsharedDream: () => null,
    splitText: text => [text], broadcast: (...args) => broadcasts.push(args),
    console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
    chatSync: async (messages, options) => { calls.push({ messages: structuredClone(messages), options }); inspect(); return '本地假回复。'; } };
  const scheduler = compileFunction(`${source}\nreturn {processReplyQueue,buildDelayedReplyContext};`, Object.keys(deps))(...Object.values(deps));
  function enqueue(text = '原始用户消息\n不要改写 <原文>') {
    db.prepare(`INSERT INTO reply_queue VALUES(?,1,'char_1',?,?,'2000-01-01 00:00:00','工作',5,'waiting','2000-01-01 00:00:00')`)
      .run(++seq, text, `client-${seq}`);
    db.prepare("INSERT INTO raw_messages(conversation_id,role,content) VALUES('char_1','user',?)").run(text);
  }
  function experience(summary, extra = {}) {
    const current = registry.getWorldState();
    const row = { actor: actor.actorId, world: current.worldId, epoch: current.epoch, at: now, ...extra };
    const id = `event-${++seq}`;
    db.prepare('INSERT INTO town_domain_events VALUES(?)').run(id);
    db.prepare('INSERT INTO town_experiences(event_id,actor_id,world_id,world_epoch,occurred_at,summary) VALUES(?,?,?,?,?,?)')
      .run(id,row.actor,row.world,row.epoch,row.at,summary);
  }
  function appointment() {
    const id = `appointment-${++seq}`, current = registry.getWorldState();
    db.prepare(`INSERT INTO town_appointment_candidates(candidate_id,world_id,world_epoch,source_event_id,session_id,
      player_actor_id,provider_actor_id,character_id,location_key,location_id,status,created_at,expires_at,updated_at)
      VALUES(?,?,?,?,?,?,?,1,'workshop',1,'accepted',?,?,?)`)
      .run(id,current.worldId,current.epoch,id,id,player.actorId,actor.actorId,now,now+60000,now);
    db.prepare(`INSERT INTO town_appointments(appointment_id,candidate_id,world_id,world_epoch,source_event_id,
      player_actor_id,provider_actor_id,character_id,location_key,location_id,start_at,end_at,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,1,'workshop',1,?,?,'accepted',?,?)`)
      .run(id,id,current.worldId,current.epoch,id,player.actorId,actor.actorId,now+60000,now+1860000,now,now);
    return id;
  }
  const entries = () => db.prepare('SELECT * FROM reply_queue ORDER BY id').all();
  const build = () => scheduler.buildDelayedReplyContext({ ...entries()[0], base_prompt: '稳定人格' }, entries(), false);
  return { db, config, calls, broadcasts, errors, actor, other, world, enqueue, experience, appointment, entries, build,
    process: scheduler.processReplyQueue, advance: ms => { now += ms; }, inspect: callback => { inspect = callback; } };
}

test('real queue prompt: empty records byte-identical to disabled gate; original messages remain intact', async t => {
  const f = fixture(t); f.enqueue();
  f.config.features.town = false; const original = JSON.stringify(f.build());
  f.config.features.town = true; assert.equal(JSON.stringify(f.build()), original);
  const before = f.entries();
  f.inspect(() => assert.deepEqual(f.entries(), before.map(row => ({ ...row, status: 'processing' }))));
  await f.process();
  assert.equal(JSON.stringify(f.calls[0].messages), original);
  assert.equal(f.db.prepare("SELECT content FROM raw_messages WHERE role='user'").get().content, before[0].user_content);
  assert.deepEqual(f.entries(), []); assert.equal(f.errors.length, 0);
  assert.equal(f.broadcasts[0][0], 'delayed_reply');
});

test('real processReplyQueue reads generation-time epoch/time and cancelled appointments, never queue snapshots', async t => {
  const f = fixture(t); f.enqueue('第一条原文'); f.enqueue('第二条\n原文');
  f.experience('入队时的旧纪元摘要'); const oldAppointment = f.appointment();
  const before = f.entries();
  f.advance(73 * 3600000);
  f.db.prepare('UPDATE town_world_state SET epoch=epoch+1').run();
  f.experience('已超72小时', { at: Date.parse('2026-09-08T09:00:00+08:00') });
  f.experience('其他角色秘密', { actor: f.other.actorId });
  f.experience('其他世界秘密', { world: 'other-world' });
  f.experience('生成前刚完成的服务');
  const cancelled = f.appointment();
  f.db.prepare("UPDATE town_appointments SET status='cancelled' WHERE appointment_id=?").run(cancelled);
  f.inspect(() => assert.deepEqual(f.entries(), before.map(row => ({ ...row, status: 'processing' }))));
  await f.process();
  assert.equal(f.calls.length, 1); assert.equal(f.errors.length, 0);
  const block = f.calls[0].messages.find(m => m.content.startsWith('<town_life_records>')).content;
  assert.match(block, /生成前刚完成的服务/);
  assert.doesNotMatch(block, /旧纪元摘要|超72小时|其他角色秘密|其他世界秘密/);
  const facts = JSON.parse(block.split('\n').slice(2,-1).join('\n'));
  assert.deepEqual(facts.appointments, []);
  assert.deepEqual(f.calls[0].messages.filter(m => m.role==='user').map(m => m.content), before.map(r => r.user_content));
  assert.equal(f.db.prepare('SELECT status FROM town_appointments WHERE appointment_id=?').get(oldAppointment).status, 'accepted');
  assert.deepEqual(f.entries(), []);
});

test('queued generation forwards timezone and reports a new schedule conflict without altering appointment', async t => {
  const f = fixture(t); f.enqueue(); f.appointment();
  f.config.town.timeZone = 'UTC';
  f.db.prepare('UPDATE schedule_templates SET schedule_json=?').run(JSON.stringify([
    { startTime: '01:00', endTime: '02:00', tags: ['work'], replyDelay: 0, location: '工坊' },
  ]));
  await f.process();
  assert.equal(f.errors.length, 0);
  const block = f.calls[0].messages.find(m => m.content.startsWith('<town_life_records>')).content;
  assert.match(block, /needs_reconfirmation/); assert.match(block, /WORKING/);
  assert.equal(f.db.prepare('SELECT status FROM town_appointments').get().status, 'accepted');
  assert.equal(f.db.prepare('SELECT count(*) n FROM daily_schedules').get().n, 0);
});
