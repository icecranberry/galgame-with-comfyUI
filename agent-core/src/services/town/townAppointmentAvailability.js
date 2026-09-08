import { createTownClock, assertUtcMs } from './townClock.js';

/** Read only. Future availability never goes through the current-activity cache or writes a daily snapshot. */
export function createTownAppointmentAvailability({ db, registry, clock, timeZone = 'Asia/Shanghai', isTownLocation = () => false }) {
  const calendar = createTownClock({ timeZone });
  function tags(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim());
    if (typeof value !== 'string') return [];
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return tags(parsed); } catch {}
    return value.split(/[,，、\n]/).map(v => v.trim()).filter(Boolean);
  }
  return function readAvailability({ worldId, worldEpoch, actorId, startAt, endAt }) {
    assertUtcMs(startAt); assertUtcMs(endAt);
    if (endAt <= startAt || endAt - startAt > 3600000) return { available: false, reason: 'INVALID_WINDOW' };
    if (registry.getWorldEpoch(worldId) !== worldEpoch) return { available: false, reason: 'STALE_EPOCH' };
    const actor = registry.getActor(actorId, worldId);
    if (!actor || actor.actorId !== actorId || !actor.participating || actor.archived || actor.mergedInto) return { available: false, reason: 'ACTOR_UNAVAILABLE' };
    if (actor.playerId === 'me') return { available: true, reason: 'PLAYER' };
    if (!actor.characterExists) return { available: false, reason: 'CHARACTER_REQUIRED' };
    const character = db.prepare('SELECT is_sleeping FROM characters WHERE id = ?').get(actor.characterId);
    if (!character) return { available: false, reason: 'ACTOR_UNAVAILABLE' };
    const now = assertUtcMs(clock.now());
    if (startAt <= now && now < endAt && character.is_sleeping) return { available: false, reason: 'SLEEPING' };
    // Cache within this read only: later calls must see changed base schedules.
    const daily = new Map();
    let template, templateLoaded = false;
    const dailyQuery = db.prepare('SELECT schedule_json FROM daily_schedules WHERE character_id = ? AND schedule_date = ?');
    const templateQuery = db.prepare('SELECT schedule_json FROM schedule_templates WHERE character_id = ?');
    function decode(row) {
      let values;
      try { values = JSON.parse(row?.schedule_json); } catch { return null; }
      if (!Array.isArray(values)) return null;
      const result = [];
      for (const item of values) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const minute = (value, end = false) => {
          if (end && value === '24:00') return 1440;
          if (typeof value !== 'string' || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(value)) return null;
          const [h, m] = value.split(':').map(Number);
          return h * 60 + m;
        };
        const start = minute(item.startTime), end = minute(item.endTime, true);
        if (start === null || end === null || start === end
          || (item.replyDelay != null && (typeof item.replyDelay !== 'number' || !Number.isFinite(item.replyDelay)
            || item.replyDelay < -1))
          || (item.tags != null && typeof item.tags !== 'string'
            && (!Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string')))) return null;
        result.push({ ...item, start, end, labels: tags(item.tags) });
      }
      return result;
    }
    function persisted(date) {
      if (!daily.has(date)) {
        const row = dailyQuery.get(actor.characterId, date);
        // undefined means absent, null means present but malformed.
        daily.set(date, row ? decode(row) : undefined);
      }
      return daily.get(date);
    }
    function schedule(date) {
      const value = persisted(date);
      if (value !== undefined) return value;
      if (!templateLoaded) {
        template = decode(templateQuery.get(actor.characterId));
        templateLoaded = true;
      }
      return template;
    }
    const instants = new Set([startAt, endAt - 1]);
    for (let instant = Math.ceil(startAt / 60000) * 60000; instant < endAt; instant += 60000) instants.add(instant);
    for (const instant of [...instants].sort((a, b) => a - b)) {
      const { date, minuteOfDay } = calendar.at(instant);
      const current = schedule(date);
      // Subtract a calendar date, not 24 elapsed hours: DST days can be 23/25 hours.
      // Only a persisted prior snapshot contributes an inherited overnight tail.
      const previousDate = new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      const previous = persisted(previousDate);
      if (current === null || previous === null) return { available: false, reason: 'SCHEDULE_UNKNOWN' };
      const active = current.filter(slot => slot.start < slot.end
        ? minuteOfDay >= slot.start && minuteOfDay < slot.end
        : minuteOfDay >= slot.start || minuteOfDay < slot.end);
      const inherited = (previous || []).filter(slot => slot.start > slot.end && minuteOfDay < slot.end);
      // Check every overlapping block; free time cannot hide a commitment.
      for (const slot of [...active, ...inherited]) {
        const labels = slot.labels;
        if (slot.replyDelay === -1 || labels.some(tag => ['sleep', 'rest', '睡眠', '休息'].includes(tag))) return { available: false, reason: 'SLEEPING_OR_REST' };
        if (labels.some(tag => ['work', '工作'].includes(tag))) return { available: false, reason: 'WORKING' };
        if (!labels.some(tag => ['idle', 'free', 'leisure', '空闲', '休闲'].includes(tag)) || slot.replyDelay > 0) return { available: false, reason: 'SCHEDULE_BUSY' };
        if (isTownLocation(slot.location) !== true) return { available: false, reason: 'OFF_TOWN' };
      }
    }
    return { available: true, reason: 'FREE_WINDOW' };
  };
}
