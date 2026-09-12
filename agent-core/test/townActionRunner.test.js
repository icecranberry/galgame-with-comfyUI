import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { createTownActionRunner, QUIET_ACTIVITY_REASONS } from '../src/services/town/townActionRunner.js';

const WORLD = 'world-1', EPOCH = 1, ACTOR = 'npc:1';
const actor = { actorId: ACTOR, participating: true, archived: false, mergedInto: null };

function buildRunner(db, nowRef) {
  // leaseMs 拉长到 1 小时：单元测试的一步时间跳跃不会像真实 tick 那样沿途续租。
  return createTownActionRunner({ db, clock: { now: () => nowRef.now }, leaseMs: 3600000,
    getWorldEpoch: () => EPOCH, getActor: id => (id === ACTOR ? actor : null),
    readFacts: () => ({ worldEpoch: EPOCH, actorId: ACTOR, targetExists: true,
      arrived: true, locationKey: 'cloud-cafe', allowsAction: true }) });
}

const logged = db => db.prepare('SELECT phase, reason_code AS reason FROM town_activity_log ORDER BY seq').all();

test('action lifecycle keeps only resident-visible transitions in the activity feed', () => {
  const db = new Database(':memory:');
  migrateTownActionSchema(db);
  const nowRef = { now: 1760000000000 };
  const runner = buildRunner(db, nowRef);
  assert.deepEqual([...QUIET_ACTIVITY_REASONS].sort(), ['RECOVER', 'RESERVE', 'VALIDATED']);

  const scope = { worldId: WORLD, worldEpoch: EPOCH, actorId: ACTOR };
  const created = runner.create({ ...scope, type: 'work_shift', target: 'cloud-cafe',
    payload: { durationMs: 300000 }, idempotencyKey: 'create:1' });
  const reserved = runner.reserve({ ...scope, actionId: created.id, expectedVersion: created.version, idempotencyKey: 'reserve:1' });
  const started = runner.start({ ...scope, actionId: reserved.id, expectedVersion: reserved.version, idempotencyKey: 'start:1' });
  assert.equal(started.phase, 'running');
  // 每次进程重启后的首个 tick 会对进行中动作补 recover；状态未变时不得产生新记录。
  const recovered = runner.recover({ ...scope, actionId: started.id, expectedVersion: started.version, idempotencyKey: 'recover:1' });
  assert.equal(recovered.phase, 'running');
  runner.advance({ ...scope, actionId: recovered.id, expectedVersion: recovered.version, idempotencyKey: 'advance:early' });
  nowRef.now += 300001;
  const completed = runner.advance({ ...scope, actionId: recovered.id, expectedVersion: recovered.version, idempotencyKey: 'advance:done' });
  assert.equal(completed.phase, 'completed');
  assert.equal(completed.result.attendanceMs, 300000);

  assert.deepEqual(logged(db), [
    { phase: 'running', reason: 'START' },
    { phase: 'completed', reason: 'DURATION_ELAPSED' },
  ]);
  assert.equal(db.prepare("SELECT count(*) n FROM town_domain_events WHERE type='town.action.changed'").get().n, 2);
});

test('recover that loses its lease still records the failure', () => {
  const db = new Database(':memory:');
  migrateTownActionSchema(db);
  const nowRef = { now: 1760000000000 };
  const runner = buildRunner(db, nowRef);
  const scope = { worldId: WORLD, worldEpoch: EPOCH, actorId: ACTOR };
  const created = runner.create({ ...scope, type: 'rest', payload: { durationMs: 300000 }, idempotencyKey: 'create:1' });
  const reserved = runner.reserve({ ...scope, actionId: created.id, expectedVersion: created.version, idempotencyKey: 'reserve:1' });
  const started = runner.start({ ...scope, actionId: reserved.id, expectedVersion: reserved.version, idempotencyKey: 'start:1' });
  // 租约（1 小时）到期后 recover 必须以 LEASE_EXPIRED 落记录，而不是被静音吞掉。
  nowRef.now += 3600001;
  const failed = runner.recover({ ...scope, actionId: started.id, expectedVersion: started.version, idempotencyKey: 'recover:expired' });
  assert.equal(failed.phase, 'failed');
  assert.deepEqual(logged(db), [
    { phase: 'running', reason: 'START' },
    { phase: 'failed', reason: 'LEASE_EXPIRED' },
  ]);
});

test('cancellations keep their specific reason in the feed', () => {
  const db = new Database(':memory:');
  migrateTownActionSchema(db);
  const nowRef = { now: 1760000000000 };
  const runner = buildRunner(db, nowRef);
  const scope = { worldId: WORLD, worldEpoch: EPOCH, actorId: ACTOR };
  const created = runner.create({ ...scope, type: 'rest', payload: { durationMs: 300000 }, idempotencyKey: 'create:1' });
  runner.cancel({ ...scope, actionId: created.id, expectedVersion: created.version,
    reasonCode: 'SCHEDULE_CHANGED', idempotencyKey: 'cancel:1' });
  assert.deepEqual(logged(db), [{ phase: 'cancelled', reason: 'SCHEDULE_CHANGED' }]);
});
