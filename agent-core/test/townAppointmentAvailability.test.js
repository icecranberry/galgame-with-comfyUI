import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createTownAppointmentAvailability } from '../src/services/town/townAppointmentAvailability.js';

function fixture(t, timeZone = 'Asia/Shanghai') {
  const queries = [];
  const db = new Database(':memory:', { verbose: sql => queries.push(sql) }); t.after(() => db.close());
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,is_sleeping INTEGER);
    CREATE TABLE daily_schedules(character_id INTEGER,schedule_date TEXT,schedule_json TEXT);
    CREATE TABLE schedule_templates(character_id INTEGER,schedule_json TEXT);
    INSERT INTO characters VALUES(1,0)`);
  const actor = { actorId: 'char', characterId: 1, characterExists: true, participating: true };
  const scope = { worldId: 'world', worldEpoch: 1, actorId: 'char' };
  const read = createTownAppointmentAvailability({ db, timeZone,
    registry: { getWorldEpoch: () => 1, getActor: () => actor },
    clock: { now: () => Date.parse('2026-09-08T09:00:00+08:00') },
    isTownLocation: name => name === '工坊' });
  const set = (date, schedule) => db.prepare('INSERT INTO daily_schedules VALUES(1,?,?)').run(date, JSON.stringify(schedule));
  const check = (start = '2026-09-09T09:00:00+08:00', end = '2026-09-09T09:30:00+08:00', extra = {}) =>
    read({ ...scope, startAt: Date.parse(start), endAt: Date.parse(end), ...extra });
  return { db, actor, set, check, queries };
}
const free = { startTime: '00:00', endTime: '24:00', tags: ['idle'], replyDelay: 0, location: '工坊' };

test('previous local date remains correct after a daylight-saving transition', t => {
  const f = fixture(t, 'America/New_York');
  f.set('2026-03-08', [{ ...free, startTime: '23:00', endTime: '01:00', tags: ['sleep'] }]);
  f.set('2026-03-09', []);
  assert.equal(f.check('2026-03-09T00:10:00-04:00', '2026-03-09T00:40:00-04:00').reason, 'SLEEPING_OR_REST');
});

test('future day reads its own snapshot, does not create daily schedules or use today cache', t => {
  const f = fixture(t); f.set('2026-09-08', [{ ...free, tags: ['work'] }]); f.set('2026-09-09', [free]);
  assert.equal(f.check().available, true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM daily_schedules').get().n, 2);
  assert.equal(f.check('2026-09-10T09:00:00+08:00','2026-09-10T09:30:00+08:00').reason, 'SCHEDULE_UNKNOWN');
  assert.equal(f.db.prepare('SELECT count(*) n FROM daily_schedules').get().n, 2);
});

test('known template fallback and explicit schedule gaps are free; malformed schedules fail closed', t => {
  const f = fixture(t);
  f.db.prepare('INSERT INTO schedule_templates VALUES(1,?)').run(JSON.stringify([free]));
  assert.equal(f.check().available, true);
  f.set('2026-09-09', []); assert.equal(f.check().available, true);
  f.db.prepare('UPDATE daily_schedules SET schedule_json=?').run(JSON.stringify([{ ...free, startTime: '9:00', endTime: '09:00' }]));
  assert.equal(f.check().reason, 'SCHEDULE_UNKNOWN');
  f.db.prepare('UPDATE daily_schedules SET schedule_json=?').run('{');
  assert.equal(f.check().reason, 'SCHEDULE_UNKNOWN');
});

test('checks entire half-open interval, including subminute tail and overlapping busy slot', t => {
  const f = fixture(t); f.set('2026-09-09', [free, { ...free, startTime: '09:30', endTime: '10:00', tags: ['work'] }]);
  assert.equal(f.check().available, true);
  assert.equal(f.check('2026-09-09T09:00:30+08:00','2026-09-09T09:30:30+08:00').reason, 'WORKING');
  assert.equal(f.check('2026-09-09T09:29:59+08:00','2026-09-09T09:30:01+08:00').reason, 'WORKING');
});

test('midnight checks next calendar day independently, including overnight sleep block', t => {
  const f = fixture(t); f.set('2026-09-09', [free]);
  f.set('2026-09-10', [{ ...free, startTime: '23:00', endTime: '07:00', replyDelay: -1 }]);
  assert.equal(f.check('2026-09-09T23:45:00+08:00','2026-09-10T00:15:00+08:00').reason, 'SLEEPING_OR_REST');
  assert.equal(f.check('2026-09-09T23:30:00+08:00','2026-09-10T00:00:00+08:00').available, true);
});

test('rest, focused activities, and out of town locations cannot be overridden', t => {
  const f = fixture(t); f.set('2026-09-09', [free]);
  for (const [changes, reason] of [[{ tags: ['rest'] }, 'SLEEPING_OR_REST'], [{ replyDelay: 10 }, 'SCHEDULE_BUSY'],
    [{ location: '外地' }, 'OFF_TOWN'], [{ tags: ['unknown'] }, 'SCHEDULE_BUSY']]) {
    f.db.prepare('UPDATE daily_schedules SET schedule_json=?').run(JSON.stringify([{ ...free, ...changes }]));
    assert.equal(f.check().reason, reason);
  }
});

test('previous day overnight commitment continues into an otherwise empty next-day snapshot', t => {
  const f = fixture(t); f.set('2026-09-08', [{ ...free, startTime: '23:00', endTime: '01:00', tags: ['sleep'] }]);
  f.set('2026-09-09', []);
  assert.equal(f.check('2026-09-09T00:10:00+08:00','2026-09-09T00:40:00+08:00').reason, 'SLEEPING_OR_REST');
  assert.equal(f.check('2026-09-09T01:00:00+08:00','2026-09-09T01:30:00+08:00').available, true);
});

test('epoch, canonical actor identity, linked character, and current sleep remain authoritative', t => {
  const f = fixture(t); f.set('2026-09-08', [free]); f.set('2026-09-09', [free]);
  assert.equal(f.check(undefined, undefined, { worldEpoch: 2 }).reason, 'STALE_EPOCH');
  assert.equal(f.check(undefined, undefined, { actorId: 'alias' }).reason, 'ACTOR_UNAVAILABLE');
  f.actor.characterExists = false; assert.equal(f.check().reason, 'CHARACTER_REQUIRED'); f.actor.characterExists = true;
  f.db.prepare('UPDATE characters SET is_sleeping=1').run();
  assert.equal(f.check('2026-09-08T09:00:00+08:00','2026-09-08T09:30:00+08:00').reason, 'SLEEPING');
  assert.equal(f.check().available, true);
});

test('malformed prior-day slots fail closed instead of silently dropping overnight commitments', t => {
  const f = fixture(t); f.set('2026-09-09', []); f.set('2026-09-08', []);
  for (const bad of [null, [], { ...free, startTime: '25:00' }, { ...free, endTime: 'oops' },
    { ...free, startTime: '9:00', endTime: '09:00' }, { ...free, replyDelay: '0' },
    { ...free, replyDelay: -2 }, { ...free, tags: { idle: true } }]) {
    f.db.prepare('UPDATE daily_schedules SET schedule_json=? WHERE schedule_date=?').run(JSON.stringify([bad]), '2026-09-08');
    assert.equal(f.check().reason, 'SCHEDULE_UNKNOWN');
  }
  f.db.prepare('UPDATE daily_schedules SET schedule_json=? WHERE schedule_date=?').run(JSON.stringify([free]), '2026-09-08');
  assert.equal(f.check().available, true, 'valid 24:00 is not an overnight tail');
});

test('read-only midnight scan loads each persisted date once and does not cache across calls', t => {
  const f = fixture(t); f.set('2026-09-08', [free]); f.set('2026-09-09', [free]); f.set('2026-09-10', [free]);
  f.db.pragma('query_only=ON'); f.queries.length = 0;
  assert.equal(f.check('2026-09-09T23:45:00+08:00','2026-09-10T00:15:00+08:00').available, true);
  const reads = f.queries.filter(sql => sql.includes('SELECT schedule_json FROM daily_schedules'));
  assert.equal(reads.length, 3, 'previous/current/next date are each loaded once');
  assert.equal(f.queries.filter(sql => sql.includes('SELECT schedule_json FROM schedule_templates')).length, 0);
  f.db.pragma('query_only=OFF');
  f.db.prepare('UPDATE daily_schedules SET schedule_json=? WHERE schedule_date=?')
    .run(JSON.stringify([{ ...free, tags: ['work'] }]), '2026-09-10');
  assert.equal(f.check('2026-09-09T23:45:00+08:00','2026-09-10T00:15:00+08:00').reason, 'WORKING');
});

test('template fallback is decoded once per read across midnight without creating snapshots', t => {
  const f = fixture(t); f.db.prepare('INSERT INTO schedule_templates VALUES(1,?)').run(JSON.stringify([free]));
  f.db.pragma('query_only=ON'); f.queries.length = 0;
  assert.equal(f.check('2026-09-09T23:45:00+08:00','2026-09-10T00:15:00+08:00').available, true);
  assert.equal(f.queries.filter(sql => sql.includes('SELECT schedule_json FROM schedule_templates')).length, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM daily_schedules').get().n, 0);
});
