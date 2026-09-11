import { randomUUID } from 'node:crypto';

export function townError(code) { return Object.assign(new Error(code), { code }); }
export function canonicalJson(value) {
  function sorted(v) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map(sorted);
    if (v && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])]));
    }
    throw townError('INVALID_JSON');
  }
  return JSON.stringify(sorted(value));
}
export function requireText(value) {
  if (typeof value !== 'string' || !value.length || value.length > 256) throw townError('INVALID_TEXT');
  return value;
}

/** All callbacks must be synchronous. External effects require a durable idempotent job adapter. */
export function createTownEventService({ db, clock, getWorldEpoch, validators = {},
  maxAttempts = 5, leaseMs = 30000, retryMs = 1000 }) {
  if (!db || !clock?.now || typeof getWorldEpoch !== 'function') throw townError('MISSING_DEPENDENCY');
  for (const n of [maxAttempts, leaseMs, retryMs]) if (!Number.isSafeInteger(n) || n < 1) throw townError('INVALID_LIMIT');
  function epoch(worldId, worldEpoch) {
    requireText(worldId);
    if (!Number.isSafeInteger(worldEpoch) || getWorldEpoch(worldId) !== worldEpoch) throw townError('STALE_EPOCH');
  }
  const get = id => {
    const row = db.prepare('SELECT envelope FROM town_domain_events WHERE event_id=?').get(id);
    return row ? JSON.parse(row.envelope) : null;
  };
  function append(input, consumers = []) {
    return db.transaction(() => {
      epoch(input.worldId, input.worldEpoch);
      requireText(input.eventId); requireText(input.type);
      const previous = get(input.eventId);
      const event = { schemaVersion: 1, actorIds: [], locationKey: null, occurredAt: previous?.occurredAt ?? clock.now(),
        source: { system: 'town', entityId: input.eventId }, causationId: null, correlationId: null,
        rootEventId: input.eventId, depth: 0, visibility: 'participants', presentationOnly: false, ...input };
      if (event.schemaVersion !== 1 || !Number.isSafeInteger(event.occurredAt) ||
          !Array.isArray(event.actorIds) || event.actorIds.length > 100 ||
          typeof event.presentationOnly !== 'boolean' || !['participants','private','public'].includes(event.visibility) ||
          !Number.isInteger(event.depth) || event.depth < 0 || event.depth > 2)
        throw townError('INVALID_EVENT');
      event.actorIds.forEach(requireText);
      requireText(event.source?.system); requireText(event.source?.entityId);
      if (event.locationKey !== null) requireText(event.locationKey);
      if (event.correlationId !== null) requireText(event.correlationId);
      const serialized = canonicalJson(event);
      if (Buffer.byteLength(serialized) > 32768) throw townError('EVENT_TOO_LARGE');
      if (previous) {
        if (canonicalJson(previous) !== serialized) throw townError('IDEMPOTENCY_CONFLICT');
      } else {
        if (event.depth > 0) {
          const parent = get(event.causationId);
          if (!parent || parent.worldId !== event.worldId || parent.worldEpoch !== event.worldEpoch ||
              parent.rootEventId !== event.rootEventId || parent.depth + 1 !== event.depth || parent.presentationOnly)
            throw townError('INVALID_CAUSATION');
          const { n } = db.prepare('SELECT count(*) n FROM town_domain_events WHERE root_event_id=? AND depth=?')
            .get(event.rootEventId, event.depth);
          if (n >= 3) throw townError('EVENT_FANOUT_LIMIT');
        } else if (event.rootEventId !== event.eventId || event.causationId !== null) throw townError('INVALID_CAUSATION');
        const validator = validators[event.type];
        if (!validator || validator(event.payload) !== true) throw townError('INVALID_EVENT_PAYLOAD');
        db.prepare(`INSERT INTO town_domain_events(event_id,world_id,world_epoch,type,root_event_id,depth,envelope)
          VALUES(?,?,?,?,?,?,?)`).run(event.eventId, event.worldId, event.worldEpoch, event.type, event.rootEventId, event.depth, serialized);
      }
      for (const consumer of consumers) {
        requireText(consumer);
        db.prepare(`INSERT OR IGNORE INTO town_event_deliveries(event_id,consumer_key,status,next_attempt_at)
          VALUES(?,?,'pending',?)`).run(event.eventId, consumer, clock.now());
      }
      return event;
    })();
  }
  function claim({ consumerKey, worldId, worldEpoch }) {
    return db.transaction(() => {
      epoch(worldId, worldEpoch); requireText(consumerKey);
      const now = clock.now();
      db.prepare(`UPDATE town_event_deliveries SET status='dead',last_error='LEASE_RETRIES_EXHAUSTED',lease_token=NULL
        WHERE consumer_key=? AND status='processing' AND lease_until<=? AND attempts>=?
        AND event_id IN (SELECT event_id FROM town_domain_events WHERE world_id=? AND world_epoch=?)`)
        .run(consumerKey, now, maxAttempts, worldId, worldEpoch);
      const row = db.prepare(`SELECT d.* FROM town_event_deliveries d JOIN town_domain_events e USING(event_id)
        WHERE d.consumer_key=? AND e.world_id=? AND e.world_epoch=? AND d.attempts<? AND
        ((d.status='pending' AND d.next_attempt_at<=?) OR (d.status='processing' AND d.lease_until<=?))
        ORDER BY e.seq LIMIT 1`).get(consumerKey, worldId, worldEpoch, maxAttempts, now, now);
      if (!row) return null;
      const token = randomUUID();
      db.prepare(`UPDATE town_event_deliveries SET status='processing',attempts=attempts+1,lease_token=?,lease_until=?
        WHERE event_id=? AND consumer_key=?`).run(token, now + leaseMs, row.event_id, consumerKey);
      return { event: get(row.event_id), consumerKey, token, attempts: row.attempts + 1, leaseUntil: now + leaseMs };
    })();
  }
  function owned(claimed) {
    const event = get(claimed.event.eventId);
    if (!event) throw townError('EVENT_NOT_FOUND');
    epoch(event.worldId, event.worldEpoch);
    const row = db.prepare(`SELECT * FROM town_event_deliveries WHERE event_id=? AND consumer_key=?
      AND status='processing' AND lease_token=? AND lease_until>?`)
      .get(event.eventId, claimed.consumerKey, claimed.token, clock.now());
    if (!row) throw townError('LEASE_LOST');
    return { row, event };
  }
  function consume(claimed, effect = () => undefined) {
    return db.transaction(() => {
      const { event } = owned(claimed);
      if (effect.constructor.name === 'AsyncFunction') throw townError('ASYNC_EFFECT_FORBIDDEN');
      const result = effect(event, db);
      if (result?.then) throw townError('ASYNC_EFFECT_FORBIDDEN');
      owned(claimed);
      db.prepare(`UPDATE town_event_deliveries SET status='done',lease_token=NULL,lease_until=NULL
        WHERE event_id=? AND consumer_key=?`).run(event.eventId, claimed.consumerKey);
      return result;
    })();
  }
  function retry(claimed, reason) {
    return db.transaction(() => {
      const { row, event } = owned(claimed);
      const status = row.attempts >= maxAttempts ? 'dead' : 'pending';
      db.prepare(`UPDATE town_event_deliveries SET status=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,last_error=?
        WHERE event_id=? AND consumer_key=?`).run(status, clock.now() + Math.min(3600000, retryMs * 2 ** Math.min(row.attempts - 1, 20)),
        String(reason).slice(0,1000), event.eventId, claimed.consumerKey);
      return status;
    })();
  }
  /** Explicit operator retry, retaining event identity. Never called automatically. */
  function requeue({ eventId, consumerKey, worldId, worldEpoch }) {
    return db.transaction(() => {
      epoch(worldId, worldEpoch); requireText(consumerKey);
      const event = get(eventId);
      if (!event || event.worldId !== worldId || event.worldEpoch !== worldEpoch) throw townError('EVENT_NOT_FOUND');
      const update = db.prepare(`UPDATE town_event_deliveries SET status='pending',attempts=0,next_attempt_at=?,
        lease_token=NULL,lease_until=NULL WHERE event_id=? AND consumer_key=? AND status='dead'`)
        .run(clock.now(),eventId,consumerKey);
      if (update.changes !== 1) throw townError('NOT_DEAD_LETTER');
      return event;
    })();
  }
  return { append, get, claim, consume, ack: claimed => consume(claimed), retry, requeue,
    list: ({ worldId, worldEpoch, cursor = 0, limit = 100 }) => {
      epoch(worldId, worldEpoch);
      if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw townError('INVALID_PAGE');
      return db.prepare('SELECT seq,envelope FROM town_domain_events WHERE world_id=? AND world_epoch=? AND seq>? ORDER BY seq LIMIT ?')
        .all(worldId, worldEpoch, cursor, limit).map(r => ({ seq: r.seq, ...JSON.parse(r.envelope) }));
    } };
}
