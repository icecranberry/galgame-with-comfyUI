import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateStandingInteractions } from '../src/db/standingInteractionSchema.js';
import { saveTouchLines } from '../src/services/standingTouchLines.js';
import { createStandingTouchSpeechService } from '../src/services/standingTouchSpeech.js';

function fixture(t) {
  const db = new Database(':memory:'); t.after(() => db.close());
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY); INSERT INTO characters VALUES(1),(2),(3);
    CREATE TABLE speech_jobs(id TEXT PRIMARY KEY,status TEXT,output_path TEXT,error TEXT);`);
  migrateStandingInteractions(db);
  for (const id of [1, 2, 3]) saveTouchLines({ db, id, expectedVersion: null, lines: { head: ['摸摸头真舒服', '轻一点就好啦'], face: ['脸有些热呢'] } });
  const profiles = new Map([1, 2, 3].map(id => [id, { key: `voice-${id}`, enabled: true, configured: id !== 2 }]));
  const calls = [], files = new Set(), events = [];
  let reject = false;
  const service = createStandingTouchSpeechService({ db, profile: id => profiles.get(id) || {},
    fileExists: value => files.has(value), audioUrl: value => `/audio/${value}`, emit: (...event) => events.push(event),
    requestSpeech: input => {
      calls.push(input); if (reject) throw new Error('测试生成失败');
      const id = `job-${calls.length}`; db.prepare("INSERT INTO speech_jobs(id,status) VALUES(?,'queued')").run(id); return { id };
    } });
  const generate = (id = 1, options = {}) => service.generate(id, { expectedVersion: service.read(id).version, ...options });
  const complete = (id, status = 'completed') => {
    db.prepare('UPDATE speech_jobs SET status=?,output_path=?,error=? WHERE id=?').run(status, `${id}.wav`, status === 'failed' ? '合成失败' : null, id);
    if (status === 'completed') files.add(`${id}.wav`);
  };
  return { db, service, profiles, calls, files, events, generate, complete, reject: () => { reject = true; } };
}

test('one-click fill skips unconfigured characters and deduplicates active/complete lines', t => {
  const f = fixture(t);
  assert.deepEqual(f.service.fill(), { started: 6, skipped: 1, failed: 0 });
  assert.deepEqual(f.service.fill(), { started: 0, skipped: 3, failed: 0 });
  assert.equal(f.calls.length, 6);
  for (const { id } of f.db.prepare('SELECT id FROM speech_jobs').all()) f.complete(id);
  assert.equal(f.service.read(1).speech.lines.head[0].status, 'completed');
  assert.deepEqual(f.generate().summary, { started: 0, skipped: 3, failed: 0 });
  assert.equal(f.service.read(2).speech.lines.head[0].audio_url, null);
  f.profiles.get(1).enabled = false;
  assert.equal(f.generate(1, { force: true }).summary.started, 0);
});

test('regeneration preserves last good audio through pending, failed and repeated failed attempts', t => {
  const f = fixture(t);
  const options = { part: 'head', index: 0, force: true };
  let line = f.generate(1, options).speech.lines.head[0]; f.complete(line.job_id);
  const first = f.service.read(1).speech.lines.head[0];
  line = f.generate(1, options).speech.lines.head[0];
  assert.notEqual(line.job_id, first.job_id); assert.equal(line.audio_url, first.audio_url);
  assert.equal(f.generate(1, options).summary.started, 0);
  f.complete(line.job_id, 'failed');
  line = f.service.read(1).speech.lines.head[0];
  assert.equal(line.status, 'failed'); assert.equal(line.audio_url, first.audio_url);
  f.reject(); line = f.generate(1, options).speech.lines.head[0];
  assert.equal(line.status, 'failed'); assert.equal(line.audio_url, first.audio_url);
  assert.match(line.error, /测试生成失败/);
});

test('line edits, voice changes, missing files and stale versions cannot play outdated audio', t => {
  const f = fixture(t);
  let state = f.generate();
  for (const line of Object.values(state.speech.lines).flat()) f.complete(line.job_id);
  const original = f.service.read(1);
  f.files.delete(original.speech.lines.head[0].job_id + '.wav');
  assert.equal(f.service.read(1).speech.lines.head[0].status, 'failed');
  assert.equal(f.service.read(1).speech.lines.head[0].audio_url, null);
  state = saveTouchLines({ db: f.db, id: 1, expectedVersion: state.version, lines: { ...state.lines, head: ['换了新的台词', state.lines.head[1]] } });
  assert.equal(f.service.read(1).speech.lines.head[0].status, 'empty');
  assert.equal(f.service.read(1).speech.lines.head[1].status, 'completed');
  assert.throws(() => f.service.generate(1, { expectedVersion: original.version }), { status: 409 });
  f.profiles.get(1).key = 'new-voice';
  assert.equal(f.service.read(1).speech.lines.head[1].audio_url, null);
  assert.equal(f.generate().summary.started, 3);
  f.db.prepare("UPDATE character_standing_touch_lines SET status='generating' WHERE character_id=1").run();
  assert.throws(() => f.generate(), { status: 409 });
});

test('validates line selection and deleting a character removes only its mappings', t => {
  const f = fixture(t);
  for (const options of [{ part: 'missing', index: 0 }, { part: 'head', index: -1 }, { part: 'head' }, { index: 0 }, { force: 'true' }]) {
    assert.throws(() => f.generate(1, options), { status: 400 });
  }
  f.generate();
  f.db.prepare('DELETE FROM characters WHERE id=1').run();
  assert.equal(f.db.prepare('SELECT count(*) FROM standing_touch_speech').pluck().get(), 0);
  assert.equal(f.db.prepare('SELECT count(*) FROM speech_jobs').pluck().get(), 3);
  assert.throws(() => f.service.generate(1), { status: 404 });
  assert.deepEqual(f.db.pragma('foreign_key_check'), []);
});
