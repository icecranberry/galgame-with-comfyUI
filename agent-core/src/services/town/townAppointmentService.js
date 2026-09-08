import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson, requireText, townError } from './townEventService.js';

export const TOWN_APPOINTMENT_DURATION_MS = 30 * 60000;
export const TOWN_APPOINTMENT_HORIZON_MS = 7 * 86400000;
const sync = value => {
  if (value?.then) throw townError('ASYNC_ADAPTER_FORBIDDEN');
  return value;
};

/**
 * Server-only synchronous API; never changes base schedules or invokes a model.
 * scope = {worldId, worldEpoch}; clock.now() and all timestamps are UTC milliseconds.
 * getLocation({scope, locationKey}) => {locationKey, locationId} (id also accepted).
 * availability({scope, actorId, characterId, playerId, startAt, endAt, locationKey})
 *   => true ONLY for a verified free interval; every other value is denied.
 * Unknown future schedules must be denied. Never use today's cached activity for future dates.
 * Adapters are read-only and synchronous. getActiveForActor rechecks both base schedules;
 * its DTO is a limited-priority fact, not authorization to override work/sleep/off_town.
 */
export function createTownAppointmentService({ db, clock, registry, getLocation, availability }) {
  if (!db?.transaction || typeof clock?.now !== 'function' || typeof registry?.getWorldEpoch !== 'function'
    || typeof registry?.getActor !== 'function' || typeof registry?.resolveAgentKey !== 'function'
    || typeof getLocation !== 'function' || typeof availability !== 'function') throw townError('MISSING_DEPENDENCY');
  function now() {
    const value = sync(clock.now());
    if (!Number.isSafeInteger(value) || value < 0
      || value > 8640000000000000 - TOWN_APPOINTMENT_HORIZON_MS - TOWN_APPOINTMENT_DURATION_MS) throw townError('INVALID_CLOCK');
    return value;
  }
  function epoch(scope) {
    requireText(scope?.worldId);
    if (!Number.isSafeInteger(scope.worldEpoch) || scope.worldEpoch < 1
      || sync(registry.getWorldEpoch(scope.worldId)) !== scope.worldEpoch) throw townError('STALE_EPOCH');
  }
  function actor(scope, id) {
    const value = sync(registry.getActor(id, scope.worldId, { followMerged: false }));
    if (!value || value.actorId !== id || value.archived || value.mergedInto || !value.participating) {
      throw townError('ACTOR_UNAVAILABLE');
    }
    return value;
  }
  function owner(scope) {
    const resolved = sync(registry.resolveAgentKey('me'));
    if (!resolved || resolved.playerId !== 'me') throw townError('PLAYER_UNAVAILABLE');
    const value = actor(scope, resolved.actorId);
    if (value.playerId !== 'me') throw townError('PLAYER_UNAVAILABLE');
    return value;
  }
  function provider(scope, id, characterId = null) {
    const value = actor(scope, id);
    if (!value.characterExists || !Number.isSafeInteger(value.characterId) || value.characterId < 1
      || (characterId !== null && value.characterId !== characterId)) throw townError('PROVIDER_NOT_LINKED');
    return value;
  }
  function location(scope, key, expectedId = null) {
    const value = sync(getLocation({ scope, locationKey: key }));
    const id = value?.locationId ?? value?.id;
    if (!value || value.locationKey !== key || !Number.isSafeInteger(id) || id < 1
      || (expectedId !== null && expectedId !== id)) throw townError('LOCATION_UNAVAILABLE');
    return id;
  }
  const parse = text => {
    try { return JSON.parse(text); } catch { throw townError('APPOINTMENT_SOURCE_INVALID'); }
  };
  function source(scope, sourceEventId) {
    requireText(sourceEventId);
    const record = db.prepare(`SELECT * FROM town_domain_events WHERE event_id=? AND world_id=? AND world_epoch=?`)
      .get(sourceEventId, scope.worldId, scope.worldEpoch);
    if (!record || record.type !== 'town.service.settled') throw townError('APPOINTMENT_SOURCE_INVALID');
    const event = parse(record.envelope);
    if (event.type !== record.type || event.eventId !== sourceEventId || event.worldId !== scope.worldId
      || event.worldEpoch !== scope.worldEpoch || event.presentationOnly !== false || event.schemaVersion !== 1
      || event.source?.system !== 'town.service' || event.payload?.status !== 'completed') throw townError('APPOINTMENT_SOURCE_INVALID');
    const session = db.prepare(`SELECT s.*, r.receipt_json FROM town_service_sessions s
      JOIN town_service_settlements r USING(session_id)
      WHERE s.session_id=? AND s.world_id=? AND s.world_epoch=? AND s.status='completed'`)
      .get(event.payload.sessionId, scope.worldId, scope.worldEpoch);
    if (!session) throw townError('APPOINTMENT_SOURCE_INVALID');
    const receipt = parse(session.receipt_json), config = parse(session.config_json);
    if (sourceEventId !== `service:${session.session_id}:settled` || event.source.entityId !== session.session_id
      || event.payload.settlementId !== session.session_id || event.payload.outcomeKey !== 'mood_patch'
      || receipt.sessionId !== session.session_id || receipt.settlementId !== session.session_id
      || receipt.eventId !== sourceEventId || receipt.status !== 'completed' || receipt.outcomeKey !== 'mood_patch'
      || receipt.refund !== 0 || receipt.paid !== 30 || receipt.payout !== receipt.paid || !session.escrow_account_id
      || !session.consumed || !session.crafted || config.template?.key !== 'town.workshop'
      || config.template?.version !== 1 || config.actorId !== session.provider_actor_id
      || event.locationKey !== config.locationKey || !config.locationKey
      || !Number.isSafeInteger(receipt.settledAt) || receipt.settledAt < 0 || receipt.settledAt !== event.occurredAt
      || receipt.settledAt > now() || !Array.isArray(receipt.itemIds) || receipt.itemIds.length !== 1
      || !Number.isSafeInteger(receipt.itemIds[0]) || receipt.itemIds[0] < 1
      || !Array.isArray(event.actorIds)
      || canonicalJson([...new Set(event.actorIds)].sort()) !== canonicalJson([session.actor_id, session.provider_actor_id].sort())) {
      throw townError('APPOINTMENT_SOURCE_INVALID');
    }
    if (session.actor_id !== owner(scope).actorId) throw townError('APPOINTMENT_NOT_OWNED');
    const granted = db.prepare(`SELECT id FROM backpack_items WHERE id=? AND world_id=? AND source_type='service'
      AND source_id=? AND template_id='town.mood_patch' AND template_version=1`)
      .get(receipt.itemIds[0], scope.worldId, `service:${session.session_id}:outcome:${receipt.outcomeKey}`);
    if (!granted) throw townError('APPOINTMENT_SOURCE_INVALID');
    return { session, receipt, config };
  }
  const candidateDto = row => ({ candidateId: row.candidate_id, sourceEventId: row.source_event_id,
    sessionId: row.session_id, scope: { worldId: row.world_id, worldEpoch: row.world_epoch },
    playerId: 'me', playerActorId: row.player_actor_id, providerActorId: row.provider_actor_id,
    characterId: row.character_id, locationKey: row.location_key, locationId: row.location_id,
    status: row.status, version: row.version, expiresAt: row.expires_at,
    kind: 'free_workshop_followup', price: 0, durationMs: TOWN_APPOINTMENT_DURATION_MS });
  const appointmentDto = row => ({ appointmentId: row.appointment_id, candidateId: row.candidate_id,
    sourceEventId: row.source_event_id, scope: { worldId: row.world_id, worldEpoch: row.world_epoch },
    playerId: 'me', playerActorId: row.player_actor_id, providerActorId: row.provider_actor_id,
    characterId: row.character_id, locationKey: row.location_key, locationId: row.location_id,
    status: row.status, version: row.version, startAt: row.start_at, endAt: row.end_at,
    kind: 'free_workshop_followup', price: 0, overridesBaseSchedule: false });
  function offerFromSettlement({ scope, sourceEventId }) {
    return db.transaction(() => {
      epoch(scope);
      const facts = source(scope, sourceEventId);
      const linked = provider(scope, facts.session.provider_actor_id);
      const locationId = location(scope, facts.config.locationKey);
      const old = db.prepare(`SELECT * FROM town_appointment_candidates WHERE world_id=? AND world_epoch=? AND source_event_id=?`)
        .get(scope.worldId, scope.worldEpoch, sourceEventId);
      if (old) return candidateDto(old);
      const time = now(), expires = facts.receipt.settledAt + TOWN_APPOINTMENT_HORIZON_MS;
      if (expires <= time) throw townError('CANDIDATE_EXPIRED');
      const id = randomUUID();
      db.prepare(`INSERT INTO town_appointment_candidates
        (candidate_id,world_id,world_epoch,source_event_id,session_id,player_actor_id,provider_actor_id,character_id,
          location_key,location_id,status,created_at,expires_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'offered',?,?,?)`).run(id, scope.worldId, scope.worldEpoch, sourceEventId,
          facts.session.session_id, facts.session.actor_id, linked.actorId, linked.characterId,
          facts.config.locationKey, locationId, time, expires, time);
      return candidateDto(db.prepare('SELECT * FROM town_appointment_candidates WHERE candidate_id=?').get(id));
    }).immediate();
  }
  function listCandidates(scope, playerId = 'me') {
    epoch(scope);
    if (playerId !== 'me') throw townError('APPOINTMENT_NOT_OWNED');
    const player = owner(scope);
    return db.prepare(`SELECT * FROM town_appointment_candidates WHERE world_id=? AND world_epoch=?
      AND player_actor_id=? AND status='offered' AND expires_at>? ORDER BY created_at,candidate_id`)
      .all(scope.worldId, scope.worldEpoch, player.actorId, now()).map(candidateDto);
  }
  /** Current/future accepted appointments followed by the latest 20 closed records. */
  function listAppointments(scope, playerId = 'me') {
    epoch(scope);
    if (playerId !== 'me') throw townError('APPOINTMENT_NOT_OWNED');
    const player = owner(scope);
    const active = db.prepare(`SELECT * FROM town_appointments WHERE world_id=? AND world_epoch=?
      AND player_actor_id=? AND status='accepted' AND end_at>? ORDER BY start_at,appointment_id`)
      .all(scope.worldId, scope.worldEpoch, player.actorId, now());
    const closed = db.prepare(`SELECT * FROM town_appointments WHERE world_id=? AND world_epoch=?
      AND player_actor_id=? AND status IN ('cancelled','expired') ORDER BY updated_at DESC,appointment_id DESC LIMIT 20`)
      .all(scope.worldId, scope.worldEpoch, player.actorId);
    return [...active, ...closed].map(appointmentDto);
  }
  function command(scope, key, payload, run) {
    requireText(key);
    return db.transaction(() => {
      epoch(scope); const player = owner(scope);
      const hash = createHash('sha256').update(canonicalJson({ ...payload, playerActorId: player.actorId })).digest('hex');
      const prior = db.prepare('SELECT * FROM town_appointment_requests WHERE world_id=? AND world_epoch=? AND request_key=?')
        .get(scope.worldId, scope.worldEpoch, key);
      if (prior) {
        if (prior.request_hash !== hash) throw townError('IDEMPOTENCY_CONFLICT');
        return JSON.parse(prior.response_json);
      }
      const result = run(player);
      epoch(scope);
      db.prepare('INSERT INTO town_appointment_requests VALUES(?,?,?,?,?)')
        .run(scope.worldId, scope.worldEpoch, key, hash, canonicalJson(result));
      return result;
    }).immediate();
  }
  function available(scope, row, startAt, endAt) {
    for (const [actorId, characterId, playerId] of [[row.player_actor_id, null, 'me'],
      [row.provider_actor_id, row.character_id, null]]) {
      const result = sync(availability({ scope, actorId, characterId, playerId, startAt, endAt, locationKey: row.location_key }));
      if (result !== true) {
        const error = townError('SCHEDULE_UNAVAILABLE');
        error.reason = typeof result?.reason === 'string' ? result.reason : 'UNKNOWN';
        throw error;
      }
    }
  }
  function accept({ scope, candidateId, startAt, expectedVersion, idempotencyKey }) {
    requireText(candidateId);
    return command(scope, idempotencyKey, { command: 'accept', candidateId, startAt, expectedVersion }, player => {
      const row = db.prepare(`SELECT * FROM town_appointment_candidates WHERE candidate_id=? AND world_id=? AND world_epoch=?`)
        .get(candidateId, scope.worldId, scope.worldEpoch);
      if (!row) throw townError('CANDIDATE_NOT_FOUND');
      if (row.player_actor_id !== player.actorId) throw townError('APPOINTMENT_NOT_OWNED');
      if (!Number.isSafeInteger(expectedVersion) || row.version !== expectedVersion) throw townError('VERSION_CONFLICT');
      if (row.status !== 'offered') throw townError('CANDIDATE_CLOSED');
      const time = now();
      if (row.expires_at <= time) throw townError('CANDIDATE_EXPIRED');
      if (!Number.isSafeInteger(startAt) || startAt < time || startAt > time + TOWN_APPOINTMENT_HORIZON_MS) {
        throw townError('INVALID_APPOINTMENT_TIME');
      }
      const endAt = startAt + TOWN_APPOINTMENT_DURATION_MS;
      if (endAt > row.expires_at) throw townError('INVALID_APPOINTMENT_TIME');
      source(scope, row.source_event_id);
      provider(scope, row.provider_actor_id, row.character_id);
      location(scope, row.location_key, row.location_id);
      const conflict = db.prepare(`SELECT 1 FROM town_appointments WHERE world_id=? AND world_epoch=? AND status='accepted'
        AND (player_actor_id=? OR character_id=?) AND start_at<? AND end_at>? LIMIT 1`)
        .get(scope.worldId, scope.worldEpoch, player.actorId, row.character_id, endAt, startAt);
      if (conflict) throw townError('APPOINTMENT_CONFLICT');
      available(scope, row, startAt, endAt);
      const updated = db.prepare(`UPDATE town_appointment_candidates SET status='accepted',version=version+1,updated_at=?
        WHERE candidate_id=? AND version=? AND status='offered'`).run(time, candidateId, expectedVersion);
      if (updated.changes !== 1) throw townError('VERSION_CONFLICT');
      const id = randomUUID();
      db.prepare(`INSERT INTO town_appointments (appointment_id,candidate_id,world_id,world_epoch,source_event_id,
        player_actor_id,provider_actor_id,character_id,location_key,location_id,start_at,end_at,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'accepted',?,?)`).run(id, candidateId, scope.worldId, scope.worldEpoch, row.source_event_id,
          player.actorId, row.provider_actor_id, row.character_id, row.location_key, row.location_id, startAt, endAt, time, time);
      return appointmentDto(db.prepare('SELECT * FROM town_appointments WHERE appointment_id=?').get(id));
    });
  }
  function cancel({ scope, appointmentId, expectedVersion, idempotencyKey }) {
    requireText(appointmentId);
    return command(scope, idempotencyKey, { command: 'cancel', appointmentId, expectedVersion }, player => {
      const row = db.prepare('SELECT * FROM town_appointments WHERE appointment_id=? AND world_id=? AND world_epoch=?')
        .get(appointmentId, scope.worldId, scope.worldEpoch);
      if (!row) throw townError('APPOINTMENT_NOT_FOUND');
      if (row.player_actor_id !== player.actorId) throw townError('APPOINTMENT_NOT_OWNED');
      if (!Number.isSafeInteger(expectedVersion) || row.version !== expectedVersion) throw townError('VERSION_CONFLICT');
      if (row.status !== 'accepted' || row.end_at <= now()) throw townError('APPOINTMENT_CLOSED');
      const result = db.prepare(`UPDATE town_appointments SET status='cancelled',version=version+1,updated_at=?
        WHERE appointment_id=? AND version=? AND status='accepted'`).run(now(), appointmentId, expectedVersion);
      if (result.changes !== 1) throw townError('VERSION_CONFLICT');
      return appointmentDto(db.prepare('SELECT * FROM town_appointments WHERE appointment_id=?').get(appointmentId));
    });
  }
  function getActiveForActor({ scope, actorId, at = now() }) {
    epoch(scope); requireText(actorId);
    if (!Number.isSafeInteger(at) || at < 0) throw townError('INVALID_APPOINTMENT_TIME');
    const player = owner(scope);
    const rows = db.prepare(`SELECT * FROM town_appointments WHERE world_id=? AND world_epoch=? AND player_actor_id=?
      AND (player_actor_id=? OR provider_actor_id=?) AND status='accepted' AND start_at<=? AND end_at>?
      ORDER BY start_at,appointment_id`).all(scope.worldId, scope.worldEpoch, player.actorId, actorId, actorId, at, at);
    return rows.filter(row => {
      try {
        provider(scope, row.provider_actor_id, row.character_id);
        location(scope, row.location_key, row.location_id);
        available(scope, row, at, row.end_at);
        return true;
      } catch (error) {
        if (['PROVIDER_NOT_LINKED','ACTOR_UNAVAILABLE','LOCATION_UNAVAILABLE','SCHEDULE_UNAVAILABLE'].includes(error.code)) return false;
        throw error;
      }
    }).map(appointmentDto);
  }
  function expire({ scope }) {
    return db.transaction(() => {
      epoch(scope); const time = now();
      const candidates = db.prepare(`UPDATE town_appointment_candidates SET status='expired',version=version+1,updated_at=?
        WHERE world_id=? AND world_epoch=? AND status='offered' AND expires_at<=?`).run(time, scope.worldId, scope.worldEpoch, time).changes;
      const appointments = db.prepare(`UPDATE town_appointments SET status='expired',version=version+1,updated_at=?
        WHERE world_id=? AND world_epoch=? AND status='accepted' AND end_at<=?`).run(time, scope.worldId, scope.worldEpoch, time).changes;
      return { candidates, appointments };
    }).immediate();
  }
  /** Call with the still-current old scope before advancing world epoch. */
  function cancelForRebuild({ scope }) {
    return db.transaction(() => {
      epoch(scope); const time = now();
      const candidates = db.prepare(`UPDATE town_appointment_candidates SET status='cancelled',version=version+1,updated_at=?
        WHERE world_id=? AND world_epoch=? AND status='offered'`).run(time, scope.worldId, scope.worldEpoch).changes;
      const appointments = db.prepare(`UPDATE town_appointments SET status='cancelled',version=version+1,updated_at=?
        WHERE world_id=? AND world_epoch=? AND status='accepted'`).run(time, scope.worldId, scope.worldEpoch).changes;
      return { candidates, appointments };
    }).immediate();
  }
  return { offerFromSettlement, listCandidates, listAppointments, accept, cancel, getActiveForActor, expire, cancelForRebuild };
}
