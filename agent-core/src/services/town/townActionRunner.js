import { randomUUID } from 'node:crypto';
import { canonicalJson, createTownEventService, requireText, townError } from './townEventService.js';

const terminal = new Set(['completed', 'cancelled', 'failed']);
const types = new Set(['move_to', 'wait', 'rest', 'work_shift']);
const decode = row => row && ({ id: row.id, worldId: row.world_id, worldEpoch: row.world_epoch,
  actorId: row.actor_id, type: row.type, phase: row.status, version: row.version,
  target: row.target, payload: JSON.parse(row.payload), ruleKey: row.rule_key, ruleVersion: row.rule_version,
  startedAt: row.started_at, dueAt: row.due_at, updatedAt: row.updated_at,
  failureReason: row.failure_reason, result: row.result && JSON.parse(row.result) });

/**
 * Explicit better-sqlite3 and synchronous authoritative adapters; never imports db/index.
 * readFacts(action) => { worldEpoch, actorId, targetExists, arrived, locationKey,
 *   allowsAction, failureReason? }. Arrival must come from server movement state.
 * work_shift completes only a timed attendance record: no wages/items are settled.
 */
export function createTownActionRunner({ db, clock, getWorldEpoch, getActor, readFacts,
  leaseMs = 180000, consumers = [] }) {
  if (!db || !clock?.now || !getWorldEpoch || !getActor || !readFacts) throw townError('MISSING_DEPENDENCY');
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) throw townError('INVALID_LEASE');
  const events = createTownEventService({ db, clock, getWorldEpoch,
    validators: { 'town.action.changed': p => typeof p?.actionId === 'string' && Number.isInteger(p.version) } });
  const get = id => decode(db.prepare('SELECT * FROM town_actions WHERE id=?').get(id));
  function epoch(a) {
    requireText(a.worldId);
    if (!Number.isSafeInteger(a.worldEpoch) || getWorldEpoch(a.worldId) !== a.worldEpoch) throw townError('STALE_EPOCH');
  }
  function activeActor(a) {
    const actor = getActor(a.actorId, a.worldId);
    // Registry follows merge aliases. Reject an alias instead of reserving a
    // second actor resource under the retired ID.
    return actor && actor.actorId === a.actorId && actor.participating === true &&
      actor.archived === false && !actor.mergedInto;
  }
  function validate(input) {
    epoch(input); requireText(input.actorId);
    if (!activeActor(input)) throw townError('ACTOR_UNAVAILABLE');
    if (!types.has(input.type)) throw townError('UNSUPPORTED_ACTION');
    const payload = input.payload ?? {};
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw townError('INVALID_PAYLOAD');
    if (Object.keys(payload).some(k => !['durationMs','resources'].includes(k))) throw townError('UNKNOWN_PAYLOAD_FIELD');
    if (input.type !== 'move_to' && (!Number.isSafeInteger(payload.durationMs) || payload.durationMs < 1 || payload.durationMs > 21600000))
      throw townError('INVALID_DURATION');
    if (input.type === 'move_to' || input.type === 'work_shift') requireText(input.target);
    if (input.target != null) requireText(input.target);
    if (payload.resources !== undefined && (!Array.isArray(payload.resources) || payload.resources.length > 32)) throw townError('INVALID_RESOURCES');
    (payload.resources ?? []).forEach(requireText);
    if (input.ruleKey != null) requireText(input.ruleKey);
    if (input.ruleVersion != null && (!Number.isSafeInteger(input.ruleVersion) || input.ruleVersion < 1)) throw townError('INVALID_RULE_VERSION');
    if (Buffer.byteLength(canonicalJson(payload)) > 8192) throw townError('PAYLOAD_TOO_LARGE');
    return { ...input, target: input.target ?? null, payload,
      ruleKey: input.ruleKey ?? null, ruleVersion: input.ruleVersion ?? null };
  }
  function record(a, reason) {
    const eventId = `action:${a.id}:${a.version}`;
    events.append({ eventId, type: 'town.action.changed', worldId: a.worldId, worldEpoch: a.worldEpoch,
      actorIds: [a.actorId], locationKey: a.target, occurredAt: a.updatedAt,
      source: { system: 'town', entityId: a.id }, payload: { actionId: a.id, type: a.type,
        phase: a.phase, version: a.version, reasonCode: reason, result: a.result } }, consumers);
    db.prepare(`INSERT INTO town_activity_log(world_id,world_epoch,actor_id,action_id,event_id,phase,
      reason_code,rule_key,rule_version,location_key,occurred_at,result) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(a.worldId,a.worldEpoch,a.actorId,a.id,eventId,a.phase,reason,a.ruleKey,a.ruleVersion,a.target,a.updatedAt,
        a.result === null ? null : canonicalJson(a.result));
  }
  function request(command, input, fn) {
    return db.transaction(() => {
      epoch(input); requireText(input.idempotencyKey);
      const serialized = canonicalJson({ command, input });
      const previous = db.prepare('SELECT * FROM town_action_requests WHERE world_id=? AND world_epoch=? AND request_key=?')
        .get(input.worldId,input.worldEpoch,input.idempotencyKey);
      if (previous) {
        if (previous.payload !== serialized) throw townError('IDEMPOTENCY_CONFLICT');
        return JSON.parse(previous.response);
      }
      const result = fn();
      db.prepare('INSERT INTO town_action_requests VALUES(?,?,?,?,?)')
        .run(input.worldId,input.worldEpoch,input.idempotencyKey,serialized,canonicalJson(result));
      return result;
    })();
  }
  function create(input) {
    return request('create', input, () => {
      const a = validate(input); const id = randomUUID();
      db.prepare(`INSERT INTO town_actions(id,world_id,world_epoch,actor_id,type,status,target,payload,rule_key,rule_version,updated_at)
        VALUES(?,?,?,?,?,'validated',?,?,?,?,?)`).run(id,a.worldId,a.worldEpoch,a.actorId,a.type,a.target,
        canonicalJson(a.payload),a.ruleKey,a.ruleVersion,clock.now());
      const result = get(id); record(result,'VALIDATED'); return result;
    });
  }
  function resources(a) {
    return [...new Set([`actor:${a.actorId}`, ...(a.payload.resources ?? []).map(r => `resource:${r}`),
      ...(a.type === 'work_shift' ? [`station:${a.target}`] : [])])].sort();
  }
  function acquire(a, now) {
    for (const key of resources(a)) {
      const row = db.prepare('SELECT * FROM town_resource_claims WHERE world_id=? AND world_epoch=? AND resource_key=?')
        .get(a.worldId,a.worldEpoch,key);
      if (row && row.action_id !== a.id && row.lease_until > now) throw townError('RESOURCE_BUSY');
      db.prepare(`INSERT INTO town_resource_claims VALUES(?,?,?,?,?) ON CONFLICT(world_id,world_epoch,resource_key)
        DO UPDATE SET action_id=excluded.action_id,lease_until=excluded.lease_until`)
        .run(a.worldId,a.worldEpoch,key,a.id,now+leaseMs);
    }
  }
  function hasLease(a, now) {
    return resources(a).every(key => db.prepare(`SELECT 1 FROM town_resource_claims
      WHERE world_id=? AND world_epoch=? AND resource_key=? AND action_id=? AND lease_until>?`)
      .get(a.worldId,a.worldEpoch,key,a.id,now));
  }
  function facts(a) {
    const f = readFacts(a);
    if (!f || f.worldEpoch !== a.worldEpoch || f.actorId !== a.actorId) throw townError('STALE_FACTS');
    return f;
  }
  function change(command, input) {
    return request(command,input,() => {
      const a = get(input.actionId);
      if (!a || a.worldId !== input.worldId || a.worldEpoch !== input.worldEpoch) throw townError('ACTION_NOT_FOUND');
      if (!Number.isInteger(input.expectedVersion) || a.version !== input.expectedVersion) throw townError('VERSION_CONFLICT');
      if (terminal.has(a.phase)) throw townError('TERMINAL_ACTION');
      const now = Math.max(clock.now(),a.updatedAt);
      let phase = a.phase, reason = command.toUpperCase(), failure = null, result = null;
      let started = a.startedAt, due = a.dueAt;
      if (command === 'cancel' || command === 'fail') {
        requireText(input.reasonCode); phase = command === 'cancel' ? 'cancelled' : 'failed'; reason = input.reasonCode;
        failure = command === 'fail' ? reason : null;
      } else if (command === 'reserve') {
        if (a.phase !== 'validated') throw townError('INVALID_PHASE');
        if (!activeActor(a)) throw townError('ACTOR_UNAVAILABLE');
        acquire(a,now); phase = 'reserved';
      } else {
        if (!['reserved','running'].includes(a.phase)) throw townError('INVALID_PHASE');
        if (command === 'start' && a.phase !== 'reserved') throw townError('INVALID_PHASE');
        if (command === 'advance' && a.phase !== 'running') throw townError('INVALID_PHASE');
        if (command === 'recover') {
          // Never credit unattended time or silently reacquire stolen resources.
          if (!hasLease(a,now)) { phase = 'failed'; failure = reason = 'LEASE_EXPIRED'; }
        } else if (!hasLease(a,now)) throw townError('LEASE_LOST');
        if (!failure) {
          const f = facts(a);
          if (!activeActor(a) || f.allowsAction !== true || (a.target && f.targetExists !== true) || f.failureReason) {
            phase = 'failed'; failure = reason = f.failureReason || (f.allowsAction !== true ? 'SCHEDULE_BLOCKED' : 'TARGET_OR_ACTOR_MISSING');
          } else {
            if (command === 'start') {
              if (a.type !== 'move_to' && a.target && !(f.arrived === true && f.locationKey === a.target)) throw townError('NOT_ARRIVED');
              phase = 'running'; started = now; due = a.type === 'move_to' ? null : now + a.payload.durationMs;
            } else if (a.phase === 'running') {
              if (a.type !== 'move_to' && a.target && !(f.arrived === true && f.locationKey === a.target)) {
                phase = 'failed'; failure = reason = 'LEFT_TARGET';
              } else if (a.type === 'move_to' ? f.arrived === true && f.locationKey === a.target : now >= due) {
                phase = 'completed'; reason = a.type === 'move_to' ? 'ARRIVED' : 'DURATION_ELAPSED';
                result = { completedAt: now, economicEffects: 'none', ...(a.type === 'work_shift' ? { attendanceMs: a.payload.durationMs, settlement: 'not_implemented' } : {}) };
              }
            }
            if (!terminal.has(phase)) acquire(a,now);
          }
        }
      }
      // Lease renewal alone has no activity/event/version churn.
      if (phase === a.phase && command !== 'recover') return a;
      const updated = db.prepare(`UPDATE town_actions SET status=?,version=version+1,started_at=?,due_at=?,updated_at=?,failure_reason=?,result=?
        WHERE id=? AND version=?`).run(phase,started,due,now,failure,result && canonicalJson(result),a.id,a.version);
      if (updated.changes !== 1) throw townError('VERSION_CONFLICT');
      if (terminal.has(phase)) db.prepare('DELETE FROM town_resource_claims WHERE action_id=?').run(a.id);
      const next = get(a.id); record(next,reason); return next;
    });
  }
  function cancelActive(input) {
    return request('cancelActive',input,() => {
      requireText(input.reasonCode);
      const actions = db.prepare(`SELECT id,version FROM town_actions WHERE world_id=? AND world_epoch=?
        AND status IN ('validated','reserved','running') ORDER BY id`).all(input.worldId,input.worldEpoch)
        .map(a => change('cancel',{ worldId: input.worldId, worldEpoch: input.worldEpoch,
          actionId: a.id, expectedVersion: a.version, reasonCode: input.reasonCode, idempotencyKey: randomUUID() }));
      return { count: actions.length, actions };
    });
  }
  return { validate, create, get, events, cancelActive,
    ...Object.fromEntries(['reserve','start','advance','cancel','fail','recover'].map(command => [command,input => change(command,input)])),
    activities: ({ worldId, worldEpoch, actorId, cursor = 0, limit = 10 }) => {
      epoch({worldId,worldEpoch}); requireText(actorId);
      if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw townError('INVALID_PAGE');
      return db.prepare(`SELECT * FROM town_activity_log WHERE world_id=? AND world_epoch=? AND actor_id=? AND seq>?
        ORDER BY seq LIMIT ?`).all(worldId,worldEpoch,actorId,cursor,limit);
    } };
}
