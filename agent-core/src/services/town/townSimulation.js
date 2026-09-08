import { createTownActionRunner } from './townActionRunner.js';
import { assertUtcMs, planCatchUp } from './townClock.js';
import { createFactSnapshot } from './townFacts.js';
import { createTownRuleEngine, selectTownCandidate } from './townRuleEngine.js';
import { SHELTER_WAIT_MS, shelterRuleKey } from './townWeatherShelter.js';

export const TOWN_SIMULATION_RULE_VERSION = 1;
const terminal = new Set(['completed', 'failed', 'cancelled']);
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 256;
const error = code => Object.assign(new Error(code), { code });
function sync(value) {
  if (value?.then) throw error('ASYNC_ADAPTER_NOT_SUPPORTED');
  return value;
}

/** Own table only. Actor/action migrations must already be applied by the host. */
export function migrateTownSimulationSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS town_simulation_state (
    world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL, actor_id TEXT NOT NULL,
    state_json TEXT NOT NULL, PRIMARY KEY(world_id,world_epoch,actor_id)
  )`);
}

/**
 * Synchronous simulation bridge; default mode='legacy' performs no writes/movement.
 * registry: createTownActorRegistry(db), already synchronized by the host.
 * readActorFacts(actor,{worldId,worldEpoch,nowUtcMs,action}) returns a batch:
 * {actorId,worldEpoch,intent:'work'|'rest'|'wait'|'off_town',scheduleKey,
 *  target:string|null,targetExists:boolean,arrived:boolean,locationKey:string|null,
 *  allowsAction:boolean,durationMs,minDurationMs}. Host derives intent/target from
 * existing routine/schedule and authoritative position, never activityText/LLM.
 * The host advances authoritative movement to context.nowUtcMs before returning.
 * durationMs: 1..6h, minDurationMs: 0..durationMs. Work requires a target.
 * moveToTarget({actor,action,target,nowUtcMs}) => {status:'moving'|'unreachable'}.
 * Movement and stopMoving({actor,action,reason,nowUtcMs}) MUST be idempotent by
 * action.id, synchronous, and epoch fenced. They run after DB commit. Arrival
 * is acknowledged only by the next authoritative fact batch, never the callback.
 *
 * API: tick({actorIds?}), advanceActor(actorId), getState(actorId), setMode(mode),
 * cancelActor(actorId,reason='SIMULATION_CANCELLED'). tick defaults to canonical
 * non-player actors (including retirees, so their owned actions can be cancelled).
 * legacy stops new decisions but still cancels tracked actions on explicit ticks.
 * No timers, LLM, wages, items, or replay of offline attendance. Catch-up metadata
 * reports bounded elapsed windows; only current observed arrival starts work.
 */
export function createTownSimulation({ db, clock, registry, readActorFacts, moveToTarget,
  stopMoving = () => {}, mode = 'legacy', leaseMs = 120000, cooldownSeconds = 60,
  retryMs = 30000, maxRetryMs = 600000, maxCatchUpMs = 21600000 } = {}) {
  if (!db?.transaction || !clock?.now || !registry?.getWorldState || !registry?.getActor
    || typeof readActorFacts !== 'function' || typeof moveToTarget !== 'function'
    || typeof stopMoving !== 'function') throw error('MISSING_SIMULATION_DEPENDENCY');
  for (const n of [retryMs, maxRetryMs, maxCatchUpMs]) if (!Number.isSafeInteger(n) || n < 1) throw error('INVALID_SIMULATION_LIMIT');
  if (maxRetryMs < retryMs) throw error('INVALID_SIMULATION_LIMIT');
  if (!['legacy', 'rules'].includes(mode)) throw error('INVALID_SIMULATION_MODE');
  let initialized = false, executing = false, activeFacts = null, executionNow = null, executionSequence = null;
  const recovered = new Set();
  const ensure = () => { if (!initialized) { migrateTownSimulationSchema(db); initialized = true; } };
  const engine = createTownRuleEngine({
    refs: { 'schedule.intent': { type: 'string', values: ['work', 'rest', 'wait', 'off_town'] },
      'schedule.allowed': { type: 'boolean' } },
    actions: { work_shift: {}, rest: {}, wait: {} },
  });
  const rules = [['work', 'work_shift', 50], ['rest', 'rest', 60], ['wait', 'wait', 10]].map(([intent, type, priority]) =>
    engine.compileRule({ key: `town.routine.${intent}`, version: TOWN_SIMULATION_RULE_VERSION,
      trigger: ['simulation.tick'], priority, cooldownSeconds,
      when: { op: 'all', args: [{ ref: 'schedule.allowed' },
        { op: 'eq', args: [{ ref: 'schedule.intent' }, intent] }] },
      score: 80, action: { type } }));
  const runner = createTownActionRunner({ db, clock: { now: () => executionNow ?? assertUtcMs(clock.now()) },
    getWorldEpoch: worldId => registry.getWorldEpoch(worldId),
    getActor: (actorId, worldId) => registry.getActor(actorId, worldId),
    readFacts: () => activeFacts, leaseMs });
  function hasTable() {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='town_simulation_state'").get();
  }
  function load(world, actorId) {
    return JSON.parse(db.prepare('SELECT state_json FROM town_simulation_state WHERE world_id=? AND world_epoch=? AND actor_id=?')
      .get(world.worldId, world.epoch, actorId)?.state_json ?? 'null');
  }
  function save(world, actorId, state) {
    db.prepare(`INSERT INTO town_simulation_state VALUES(?,?,?,?) ON CONFLICT(world_id,world_epoch,actor_id)
      DO UPDATE SET state_json=excluded.state_json`).run(world.worldId, world.epoch, actorId, JSON.stringify(state));
  }
  function getState(actorId) { return hasTable() ? load(registry.getWorldState(), actorId) : null; }
  function command(method, action, reasonCode) {
    return runner[method]({ worldId: action.worldId, worldEpoch: action.worldEpoch, actionId: action.id,
      expectedVersion: action.version,
      idempotencyKey: `sim:${action.id}:${method}:${action.version}:${executionSequence}`,
      ...(reasonCode ? { reasonCode } : {}) });
  }
  function validateFacts(value, actor, world) {
    if (!value || value.actorId !== actor.actorId || value.worldEpoch !== world.epoch) throw error('STALE_SIMULATION_FACTS');
    if (!['work', 'rest', 'wait', 'off_town'].includes(value.intent) || !text(value.scheduleKey)
      || ![value.targetExists, value.arrived, value.allowsAction].every(v => typeof v === 'boolean')
      || !(value.target === null || text(value.target)) || !(value.locationKey === null || text(value.locationKey))
      || !Number.isSafeInteger(value.durationMs) || value.durationMs < 1 || value.durationMs > 21600000
      || !Number.isSafeInteger(value.minDurationMs) || value.minDurationMs < 0 || value.minDurationMs > value.durationMs
      || (value.intent === 'work' && !text(value.target))) throw error('INVALID_SIMULATION_FACTS');
    if (value.shelterForecastAt !== undefined && (!Number.isSafeInteger(value.shelterForecastAt)
        || value.shelterForecastAt < 0 || value.intent !== 'wait' || !text(value.target)
        || value.durationMs > SHELTER_WAIT_MS || value.minDurationMs !== 0)) throw error('INVALID_SIMULATION_FACTS');
    // Copy primitives only: later adapter mutations cannot alter this decision batch.
    return Object.freeze(Object.fromEntries(['actorId', 'worldEpoch', 'intent', 'scheduleKey', 'target',
      'targetExists', 'arrived', 'locationKey', 'allowsAction', 'durationMs', 'minDurationMs',
      'shelterForecastAt'].map(k => [k, value[k]])));
  }
  function backoff(state) {
    state.failures = Math.min(30, state.failures + 1);
    state.nextAttemptAt = executionNow + Math.min(maxRetryMs, retryMs * 2 ** (state.failures - 1));
    state.plan = null; state.actionId = null; state.minUntil = null;
  }
  function createAction(world, actorId, state, type) {
    const plan = state.plan;
    let action = runner.create({ worldId: world.worldId, worldEpoch: world.epoch, actorId, type,
      target: plan.target, payload: type === 'move_to' ? {} : { durationMs: plan.durationMs },
      ruleKey: plan.ruleKey, ruleVersion: TOWN_SIMULATION_RULE_VERSION,
      idempotencyKey: `sim:create:${actorId}:${state.decisionSequence}:${type}` });
    state.actionId = action.id;
    action = command('reserve', action);
    action = command('start', action);
    recovered.add(action.id);
    if (action.phase === 'running' && type !== 'move_to') {
      state.cooldowns[plan.cooldownKey] = executionNow;
      state.minUntil = executionNow + plan.minDurationMs;
      state.failures = 0; state.nextAttemptAt = 0;
    }
    return action;
  }
  function advanceActor(actorId, cancelReason = null) {
    if (!text(actorId)) throw error('INVALID_ACTOR_ID');
    if (executing) throw error('REENTRANT_SIMULATION');
    if (mode === 'legacy' && !hasTable()) return { actorId, reason: 'legacy', action: null };
    ensure(); executing = true;
    const effects = [];
    let result;
    try {
      result = db.transaction(() => {
        const world = registry.getWorldState();
        const actor = registry.getActor(actorId, world.worldId, { followMerged: false });
        let state = load(world, actorId);
        if (mode === 'legacy' && !state) return { actorId, reason: 'legacy', action: null };
        const now = assertUtcMs(clock.now());
        executionNow = Math.max(now, state?.cursorUtcMs ?? now);
        const catchUp = planCatchUp({ cursorUtcMs: state?.cursorUtcMs ?? executionNow, nowUtcMs: executionNow, maxCatchUpMs });
        state ??= { cursorUtcMs: executionNow, decisionSequence: 0, cooldowns: {}, minUntil: null,
          nextAttemptAt: 0, failures: 0, actionId: null, plan: null, seed: null, pendingStop: null };
        state.advanceSequence = (state.advanceSequence ?? 0) + 1;
        executionSequence = state.advanceSequence;
        state.cursorUtcMs = executionNow;
        let action = state.actionId ? runner.get(state.actionId) : null;
        if (state.actionId && (!action || action.worldId !== world.worldId || action.worldEpoch !== world.epoch
          || action.actorId !== actorId)) throw error('STALE_SIMULATION_ACTION');
        const finish = reason => {
          if (state.pendingStop) effects.push({ kind: 'stop', actor, action: runner.get(state.pendingStop.actionId), reason: state.pendingStop.reason });
          if (action?.type === 'move_to' && action.phase === 'running') effects.push({ kind: 'move', actor, action });
          save(world, actorId, state);
          return { actorId, reason, action, decisionSequence: state.decisionSequence, seed: state.seed,
            nextAttemptAt: state.nextAttemptAt, minUntil: state.minUntil, catchUp };
        };
        const end = (method, reason) => {
          if (action && !terminal.has(action.phase)) action = command(method, action, reason);
          if (action?.type === 'move_to') state.pendingStop = { actionId: action.id, reason };
          state.actionId = null; state.plan = null; state.minUntil = null;
        };
        if (cancelReason || mode === 'legacy' || !actor || actor.archived || !actor.participating || actor.mergedInto || actor.playerId) {
          const reason = cancelReason || (mode === 'legacy' ? 'legacy' : 'actor_unavailable');
          end('cancel', reason); return finish(reason);
        }
        // Runner is the sole owner. Do not commandeer player services or other callers' actions.
        const other = db.prepare(`SELECT id FROM town_actions WHERE world_id=? AND world_epoch=? AND actor_id=?
          AND status IN ('validated','reserved','running') AND id<>? LIMIT 1`)
          .get(world.worldId, world.epoch, actorId, action?.id ?? '');
        if (other && (!action || terminal.has(action.phase))) return finish('runner_owned_elsewhere');
        activeFacts = validateFacts(sync(readActorFacts(actor, { worldId: world.worldId, worldEpoch: world.epoch,
          nowUtcMs: executionNow, action })), actor, world);
        const f = activeFacts;
        if (!f.allowsAction || f.intent === 'off_town' || (f.target && !f.targetExists)) {
          end('cancel', f.intent === 'off_town' ? 'off_town' : 'schedule_or_target_blocked');
          return finish('blocked');
        }
        if (state.plan && (state.plan.scheduleKey !== f.scheduleKey || state.plan.target !== f.target
          || state.plan.intent !== f.intent)) {
          end('cancel', 'SCHEDULE_CHANGED'); return finish('schedule_changed');
        }
        try {
          if (action && !terminal.has(action.phase)) {
            if (action.phase === 'validated') action = command('reserve', action);
            if (!recovered.has(action.id)) {
              action = command('recover', action); recovered.add(action.id);
            }
            if (action.phase === 'reserved') action = command('start', action);
            else if (action.phase === 'running') action = command('advance', action);
          }
          if (action?.phase === 'failed') {
            if (action.type === 'move_to') state.pendingStop = { actionId: action.id, reason: action.failureReason };
            backoff(state); return finish(action.failureReason);
          }
          if (action?.phase === 'cancelled') { state.actionId = null; state.plan = null; return finish('cancelled'); }
          if (action?.phase === 'completed') {
            if (action.type !== 'move_to') {
              state.actionId = null; state.plan = null; state.minUntil = null; return finish('completed');
            }
            state.pendingStop = { actionId: action.id, reason: 'ARRIVED' };
            state.actionId = null;
            // Observed arrival only; work clock starts now, never at departure/dueAt.
            if (f.shelterForecastAt !== undefined) state.plan.durationMs = f.durationMs;
            action = createAction(world, actorId, state, state.plan.type);
            return finish('arrived_and_started');
          }
          if (action) return finish('active');
          if (executionNow < state.nextAttemptAt) return finish('backoff');
          const batch = createFactSnapshot(engine.registry, { 'schedule.intent': f.intent, 'schedule.allowed': f.allowsAction });
          const decision = selectTownCandidate({ rules, facts: batch, worldId: world.worldId, actorId,
            decisionSequence: state.decisionSequence, nowUtcMs: executionNow,
            cooldowns: new Map(Object.entries(state.cooldowns)), targetKey: f.target ?? '' });
          state.decisionSequence += 1; state.seed = decision.seed;
          if (!decision.selected) return finish('cooldown');
          state.plan = { intent: f.intent, scheduleKey: f.scheduleKey, target: f.target,
            type: decision.selected.action.type, ruleKey: f.shelterForecastAt !== undefined
              ? shelterRuleKey(f.shelterForecastAt) : decision.selected.key,
            durationMs: f.durationMs, minDurationMs: f.minDurationMs, cooldownKey: decision.cooldownUpdate.key };
          action = createAction(world, actorId, state,
            f.target && !(f.arrived && f.locationKey === f.target) ? 'move_to' : state.plan.type);
          return finish('started');
        } catch (e) {
          if (!['RESOURCE_BUSY', 'LEASE_LOST', 'NOT_ARRIVED'].includes(e.code)) throw e;
          action = state.actionId ? runner.get(state.actionId) : action;
          end('fail', e.code); backoff(state); return finish(e.code);
        }
      })();
      // Durable action pointer permits crash/restart to retry movement commands.
      for (const effect of effects) {
        const { action, actor } = effect;
        if (!action || action.actorId !== actorId || registry.getWorldEpoch(action.worldId) !== action.worldEpoch) continue;
        if (effect.kind === 'stop') {
          sync(stopMoving({ actor, action, reason: effect.reason, nowUtcMs: executionNow }));
          db.transaction(() => {
            const world = registry.getWorldState();
            if (world.worldId !== action.worldId || world.epoch !== action.worldEpoch) return;
            const state = load(world, actorId);
            if (state?.pendingStop?.actionId === action.id) { state.pendingStop = null; save(world, actorId, state); }
          })();
        } else {
          let movement;
          try {
            movement = sync(moveToTarget({ actor, action, target: action.target, nowUtcMs: executionNow }));
            if (!['moving', 'unreachable'].includes(movement?.status)) throw error('INVALID_MOVEMENT_RESULT');
          } catch (e) { movement = { status: 'unreachable', detail: e.code ?? e.message }; }
          if (movement.status === 'unreachable') {
            db.transaction(() => {
              const world = registry.getWorldState();
              if (world.worldId !== action.worldId || world.epoch !== action.worldEpoch) return;
              const state = load(world, actorId), latest = runner.get(action.id);
              if (state?.actionId !== action.id || terminal.has(latest.phase)) return;
              const failed = command('fail', latest, 'PATH_UNREACHABLE');
              backoff(state); state.pendingStop = { actionId: action.id, reason: 'PATH_UNREACHABLE' };
              save(world, actorId, state);
              result = { ...result, action: failed, reason: 'PATH_UNREACHABLE', nextAttemptAt: state.nextAttemptAt };
            })();
            sync(stopMoving({ actor, action, reason: 'PATH_UNREACHABLE', nowUtcMs: executionNow }));
          }
        }
      }
      return result;
    } finally { executing = false; executionNow = null; executionSequence = null; activeFacts = null; }
  }
  function tick({ actorIds } = {}) {
    if (mode === 'legacy' && !hasTable()) return { mode, actors: [] };
    const ids = actorIds ?? db.prepare('SELECT actor_id FROM town_actors WHERE player_id IS NULL ORDER BY actor_id').all().map(r => r.actor_id);
    return { mode, actors: [...new Set(ids)].sort().map(id => {
      try { return advanceActor(id); } catch (e) { return { actorId: id, reason: 'error', error: e.code ?? e.message }; }
    }) };
  }
  function setMode(next) {
    if (!['legacy', 'rules'].includes(next)) throw error('INVALID_SIMULATION_MODE');
    mode = next;
  }
  return { tick, advanceActor, getState, setMode,
    cancelActor: (actorId, reason = 'SIMULATION_CANCELLED') => advanceActor(actorId, reason) };
}
