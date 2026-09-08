import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { createTownActionRunner } from '../src/services/town/townActionRunner.js';
import { createTownSimulation } from '../src/services/town/townSimulation.js';

function fixture(t, extra = {}) {
  const db = new Database(':memory:'); t.after(() => db.close());
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    INSERT INTO town_npcs VALUES(1,NULL,1),(2,NULL,1);`);
  migrateTownSchema(db); migrateTownActionSchema(db);
  const registry = createTownActorRegistry(db), world = registry.getWorldState();
  const actorId = registry.resolveAgentKey('npc:1').actorId;
  const actor2 = registry.resolveAgentKey('npc:2').actorId;
  let now = Date.parse('2026-09-08T01:00:00Z');
  const clock = { now: () => now };
  const values = { intent: 'work', scheduleKey: 'routine:09-12', target: 'workshop', targetExists: true,
    arrived: false, locationKey: null, allowsAction: true, durationMs: 60000, minDurationMs: 30000 };
  const moves = [], stops = [], batches = [];
  let movement = 'moving';
  const dependencies = { db, registry, clock, mode: 'rules',
    readActorFacts: (actor, context) => {
      batches.push({ actor, context });
      return { ...values, actorId: actor.actorId, worldEpoch: world.epoch };
    },
    moveToTarget: request => { moves.push(request); return { status: movement }; },
    stopMoving: request => stops.push(request), ...extra };
  return { db, registry, world, actorId, actor2, clock, values, moves, stops, batches, dependencies,
    build: options => createTownSimulation({ ...dependencies, ...options }),
    now: () => now, advance: ms => { now += ms; }, movement: value => { movement = value; },
    actions: () => db.prepare('SELECT * FROM town_actions ORDER BY rowid').all(),
    claims: () => db.prepare('SELECT * FROM town_resource_claims').all() };
}

test('default legacy has zero schema/state/action/movement writes; enabling starts bridge', t => {
  const f = fixture(t), sim = f.build({ mode: undefined });
  assert.equal(sim.advanceActor(f.actorId).reason, 'legacy');
  assert.deepEqual(sim.tick(), { mode: 'legacy', actors: [] });
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='town_simulation_state'").get().n, 0);
  assert.equal(f.actions().length, 0); assert.equal(f.moves.length, 0); assert.equal(f.batches.length, 0);
  sim.setMode('rules');
  assert.equal(sim.advanceActor(f.actorId).action.type, 'move_to');
});

test('real movement precedes work, arrival starts full work duration and emits no money', t => {
  const f = fixture(t), sim = f.build();
  const first = sim.advanceActor(f.actorId);
  assert.equal(first.action.type, 'move_to'); assert.equal(first.action.phase, 'running');
  assert.equal(first.action.dueAt, null); assert.equal(f.moves.length, 1);
  f.advance(90000);
  assert.equal(sim.advanceActor(f.actorId).action.type, 'move_to');
  assert.equal(f.actions().length, 1); // Time alone cannot mean arrival.
  f.values.arrived = true; f.values.locationKey = 'wrong-place';
  assert.equal(sim.advanceActor(f.actorId).action.type, 'move_to');
  f.values.locationKey = 'workshop'; f.advance(1000);
  const arrived = sim.advanceActor(f.actorId);
  assert.equal(arrived.reason, 'arrived_and_started');
  assert.equal(arrived.action.type, 'work_shift');
  assert.equal(arrived.action.startedAt, f.now());
  assert.equal(arrived.action.dueAt, f.now() + 60000);
  assert.equal(arrived.minUntil, f.now() + 30000);
  assert.equal(f.stops.at(-1).reason, 'ARRIVED');
  assert.equal(Object.values(sim.getState(f.actorId).cooldowns)[0], f.now());
  f.advance(59999); assert.equal(sim.advanceActor(f.actorId).action.phase, 'running');
  f.advance(1);
  const completed = sim.advanceActor(f.actorId);
  assert.equal(completed.action.phase, 'completed');
  assert.equal(completed.action.result.attendanceMs, 60000);
  assert.equal(completed.action.result.economicEffects, 'none');
  assert.equal(f.claims().length, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM town_activity_log WHERE reason_code='ARRIVED'").get().n, 1);
});

test('routine/schedule adapter is authoritative; off-town never becomes random roaming', t => {
  const f = fixture(t), sim = f.build();
  f.values.intent = 'off_town'; f.values.target = null;
  assert.equal(sim.advanceActor(f.actorId).reason, 'blocked');
  assert.equal(f.actions().length, 0);
  f.values.intent = 'rest'; f.values.scheduleKey = 'schedule:sleep';
  const rest = sim.advanceActor(f.actorId);
  assert.equal(rest.action.type, 'rest');
  assert.equal(f.moves.length, 0);
  assert.equal(f.batches.at(-1).context.nowUtcMs, f.now());
  assert.equal(f.batches.at(-1).actor.actorId, f.actorId);
});

test('hard schedule change cancels moving action and releases claims before replanning', t => {
  const f = fixture(t), sim = f.build();
  const first = sim.advanceActor(f.actorId);
  f.values.intent = 'rest'; f.values.scheduleKey = 'schedule:rest'; f.values.target = null;
  const changed = sim.advanceActor(f.actorId);
  assert.equal(changed.reason, 'schedule_changed');
  assert.equal(changed.action.id, first.action.id); assert.equal(changed.action.phase, 'cancelled');
  assert.equal(f.claims().length, 0); assert.equal(f.stops.at(-1).reason, 'SCHEDULE_CHANGED');
  assert.equal(sim.advanceActor(f.actorId).action.type, 'rest');
});

test('restart resumes same moving action; persisted decision/minimum duration never duplicate work', t => {
  const f = fixture(t); let sim = f.build();
  const first = sim.advanceActor(f.actorId), persisted = sim.getState(f.actorId);
  f.advance(1000); sim = f.build();
  const resumed = sim.advanceActor(f.actorId);
  assert.equal(resumed.action.id, first.action.id);
  assert.equal(resumed.decisionSequence, persisted.decisionSequence);
  assert.equal(resumed.seed, persisted.seed); assert.equal(f.actions().length, 1);
  f.values.arrived = true; f.values.locationKey = 'workshop';
  const work = sim.advanceActor(f.actorId);
  f.advance(1000); sim = f.build();
  const recovered = sim.advanceActor(f.actorId);
  assert.equal(recovered.action.id, work.action.id);
  assert.equal(recovered.action.dueAt, work.action.dueAt);
  assert.equal(recovered.minUntil, work.minUntil);
  assert.equal(f.actions().length, 2);
});

test('expired lease after offline days fails attendance and reports capped catch-up without replay', t => {
  const f = fixture(t); f.values.arrived = true; f.values.locationKey = 'workshop';
  let sim = f.build(); const started = sim.advanceActor(f.actorId);
  f.advance(3 * 86400000); sim = f.build();
  const recovered = sim.advanceActor(f.actorId);
  assert.equal(recovered.action.id, started.action.id); assert.equal(recovered.action.phase, 'failed');
  assert.equal(recovered.reason, 'LEASE_EXPIRED');
  assert.equal(recovered.catchUp.toUtcMs - recovered.catchUp.fromUtcMs, 21600000);
  assert.equal(recovered.catchUp.skippedMs, 3 * 86400000 - 21600000);
  assert.equal(f.actions().length, 1); assert.equal(f.claims().length, 0);
  assert.equal(sim.advanceActor(f.actorId).reason, 'backoff');
  assert.equal(f.db.prepare("SELECT count(*) n FROM town_actions WHERE status='completed'").get().n, 0);
});

test('unreachable path releases resources and exponential retry persists through restart/rollback', t => {
  const f = fixture(t); f.movement('unreachable'); let sim = f.build();
  const failed = sim.advanceActor(f.actorId);
  assert.equal(failed.reason, 'PATH_UNREACHABLE'); assert.equal(failed.action.phase, 'failed');
  assert.equal(failed.nextAttemptAt, f.now() + 30000); assert.equal(f.claims().length, 0);
  f.advance(-1000); sim = f.build();
  assert.equal(sim.advanceActor(f.actorId).reason, 'backoff');
  assert.equal(f.actions().length, 1);
  f.advance(31000);
  const again = sim.advanceActor(f.actorId);
  assert.equal(again.nextAttemptAt, f.now() + 60000); assert.equal(f.actions().length, 2);
});

test('disable and retirement cancel only owned actions and release station occupancy', t => {
  const f = fixture(t), sim = f.build();
  f.values.arrived = true; f.values.locationKey = 'workshop';
  sim.advanceActor(f.actorId); assert.equal(f.claims().length, 2);
  sim.setMode('legacy');
  assert.equal(sim.advanceActor(f.actorId).action.phase, 'cancelled');
  assert.equal(f.claims().length, 0);
  sim.setMode('rules'); f.values.target = null; f.values.intent = 'wait';
  sim.advanceActor(f.actor2);
  f.db.prepare('UPDATE town_npcs SET town_enabled=0 WHERE id=2').run(); f.registry.synchronize();
  const retired = sim.tick().actors.find(a => a.actorId === f.actor2);
  assert.equal(retired.reason, 'actor_unavailable'); assert.equal(retired.action.phase, 'cancelled');
});

test('station contention produces recoverable backoff, never a second owner', t => {
  const f = fixture(t), sim = f.build(); f.values.arrived = true; f.values.locationKey = 'workshop';
  const first = sim.advanceActor(f.actorId);
  const second = sim.advanceActor(f.actor2);
  assert.equal(second.reason, 'RESOURCE_BUSY'); assert.equal(second.action.phase, 'failed');
  assert.equal(f.claims().filter(c => c.resource_key === 'station:workshop')[0].action_id, first.action.id);
  assert.equal(f.db.prepare("SELECT count(*) n FROM town_actions WHERE status='running'").get().n, 1);
});

test('foreign runner action remains sole owner and is never advanced/cancelled by bridge', t => {
  const f = fixture(t), runner = createTownActionRunner({ db: f.db, clock: f.clock,
    getActor: (id, worldId) => f.registry.getActor(id, worldId), getWorldEpoch: id => f.registry.getWorldEpoch(id),
    readFacts: () => { throw new Error('must not read foreign action facts'); } });
  const other = runner.create({ worldId: f.world.worldId, worldEpoch: f.world.epoch, actorId: f.actorId,
    type: 'wait', payload: { durationMs: 1000 }, idempotencyKey: 'foreign' });
  const sim = f.build();
  assert.equal(sim.advanceActor(f.actorId).reason, 'runner_owned_elsewhere');
  sim.cancelActor(f.actorId);
  assert.equal(runner.get(other.id).phase, 'validated'); assert.equal(f.actions().length, 1);
});

test('foreign validated request cannot starve the currently running bridge action', t => {
  const f = fixture(t), sim = f.build();
  const active = sim.advanceActor(f.actorId);
  const runner = createTownActionRunner({ db: f.db, clock: f.clock,
    getActor: (id, worldId) => f.registry.getActor(id, worldId), getWorldEpoch: id => f.registry.getWorldEpoch(id),
    readFacts: () => { throw new Error('unexpected foreign facts'); } });
  const pending = runner.create({ worldId: f.world.worldId, worldEpoch: f.world.epoch, actorId: f.actorId,
    type: 'wait', payload: { durationMs: 1000 }, idempotencyKey: 'foreign-pending' });
  f.advance(30000);
  const resumed = sim.advanceActor(f.actorId);
  assert.equal(resumed.action.id, active.action.id);
  assert.equal(resumed.reason, 'active');
  assert.equal(runner.get(pending.id).phase, 'validated');
  assert.ok(f.claims().every(c => c.lease_until > f.now()));
});

test('target removal cancels work even within minimum duration and returns all leases', t => {
  const f = fixture(t), sim = f.build(); f.values.arrived = true; f.values.locationKey = 'workshop';
  const work = sim.advanceActor(f.actorId);
  f.advance(1000); assert.ok(f.now() < work.minUntil);
  f.values.targetExists = false;
  const cancelled = sim.advanceActor(f.actorId);
  assert.equal(cancelled.action.phase, 'cancelled'); assert.equal(cancelled.reason, 'blocked');
  assert.equal(f.claims().length, 0);
});

test('invalid/async/stale fact adapters roll back the entire decision and action transaction', t => {
  const f = fixture(t);
  for (const readActorFacts of [() => Promise.resolve({}), () => ({ ...f.values, actorId: f.actorId, worldEpoch: 0 }),
    () => ({ ...f.values, actorId: f.actorId, worldEpoch: f.world.epoch, arrived: 'true' })]) {
    const sim = f.build({ readActorFacts });
    assert.throws(() => sim.advanceActor(f.actorId));
    assert.equal(sim.getState(f.actorId), null); assert.equal(f.actions().length, 0);
  }
});

test('durable stop command retries after callback failure on restart', t => {
  const f = fixture(t); let sim = f.build();
  const first = sim.advanceActor(f.actorId);
  sim = f.build({ stopMoving: () => { throw new Error('adapter offline'); } });
  assert.throws(() => sim.cancelActor(f.actorId));
  assert.equal(f.actions()[0].status, 'cancelled'); assert.equal(f.claims().length, 0);
  assert.equal(sim.getState(f.actorId).pendingStop.actionId, first.action.id);
  sim = f.build({ mode: 'legacy' }); sim.advanceActor(f.actorId);
  assert.equal(f.stops.at(-1).action.id, first.action.id);
  assert.equal(sim.getState(f.actorId).pendingStop, null);
});

test('cooldown persists across short completed action and restart without rerolling a new action', t => {
  const f = fixture(t); f.values.intent = 'wait'; f.values.target = null;
  f.values.durationMs = 1000; f.values.minDurationMs = 500;
  let sim = f.build(); sim.advanceActor(f.actorId);
  f.advance(1000); assert.equal(sim.advanceActor(f.actorId).reason, 'completed');
  sim = f.build(); assert.equal(sim.advanceActor(f.actorId).reason, 'cooldown');
  assert.equal(f.actions().length, 1);
  f.advance(59000); assert.equal(sim.advanceActor(f.actorId).action.phase, 'running');
  assert.equal(f.actions().length, 2);
});
