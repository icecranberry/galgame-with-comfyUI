import { createTownAppointmentAvailability } from './town/townAppointmentAvailability.js';
import { buildLocationMatcher } from './town/townLocationMatch.js';
import { assertUtcMs } from './town/townClock.js';

const HORIZON = 7 * 86400000;
const clip = value => [...String(value ?? '')].slice(0, 50).join('');

/** Recorded commitments only. Never synchronizes identity, creates schedules,
 * expires records, advances movement or asserts that a meeting has happened.
 * Returns read(characterId, {limit=20}); timestamps are UTC milliseconds.
 */
export function createCharacterTownAppointments({ db, registry, clock, timeZone = 'Asia/Shanghai' }) {
  new Intl.DateTimeFormat('en', { timeZone }); // Fail early on invalid configuration.
  const participating = actor => !!actor && actor.participating === true
    && actor.archived === false && !actor.mergedInto;
  function canonical(key, worldId) {
    const resolved = registry.resolveAgentKey(key);
    if (!resolved) return null;
    const actor = registry.getActor(resolved.actorId, worldId, { followMerged: false });
    return participating(actor) && actor.actorId === resolved.actorId ? actor : null;
  }
  const readSnapshot = db.transaction((characterId, limit) => {
    const world = registry.getWorldState();
    const result = { worldId: world.worldId, worldEpoch: world.epoch, characterId, timeZone, appointments: [] };
    if (!Number.isSafeInteger(characterId) || characterId < 1) return result;
    const actor = canonical(`char:${characterId}`, world.worldId);
    const player = canonical('me', world.worldId);
    if (!actor || actor.characterId !== characterId || !actor.characterExists || !player || player.playerId !== 'me') return result;
    const now = assertUtcMs(clock.now());
    assertUtcMs(now + HORIZON);
    const rows = db.prepare(`SELECT appointment_id,start_at,end_at,location_id,location_key FROM town_appointments
      WHERE world_id=? AND world_epoch=? AND provider_actor_id=? AND character_id=? AND player_actor_id=?
        AND status='accepted' AND end_at>? AND end_at<=?
      ORDER BY start_at,appointment_id LIMIT ?`)
      .all(world.worldId, world.epoch, actor.actorId, characterId, player.actorId, now, now + HORIZON, limit);
    if (!rows.length) return result;
    const locations = db.prepare('SELECT id,key,name,aliases_json FROM town_locations').all().map(row => {
      let aliases = []; try { aliases = JSON.parse(row.aliases_json || '[]'); } catch {}
      return { ...row, aliases: Array.isArray(aliases) ? aliases.filter(a => typeof a === 'string') : [] };
    });
    const match = buildLocationMatcher(locations);
    const availability = createTownAppointmentAvailability({ db, registry, clock: { now: () => now }, timeZone,
      isTownLocation: name => !!match(name) });
    result.appointments = rows.map(row => {
      const location = locations.find(place => place.id === row.location_id && place.key === row.location_key);
      const check = location ? availability({ worldId: world.worldId, worldEpoch: world.epoch,
        actorId: actor.actorId, startAt: Math.max(now, row.start_at), endAt: row.end_at })
        : { available: false, reason: 'LOCATION_UNAVAILABLE' };
      return { appointmentId: row.appointment_id, startAt: row.start_at, endAt: row.end_at,
        location: clip(location?.name || row.location_key), status: 'accepted',
        availability: check.available ? 'currently_free' : 'needs_reconfirmation', reason: check.reason };
    });
    return result;
  });
  return function read(characterId, { limit = 20 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new RangeError('limit must be an integer between 1 and 20');
    return readSnapshot.deferred(characterId, limit);
  };
}
