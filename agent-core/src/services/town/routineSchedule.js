import { createTownClock, isInTimeWindow } from './townClock.js';

const clocks = new Map();
function minute(value, allowEndOfDay = false) {
  if (typeof value !== 'string' || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  if (h === 24 && m === 0 && allowEndOfDay) return 1440;
  return h >= 0 && h < 24 && m >= 0 && m < 60 ? h * 60 + m : null;
}

/** Explicit timezone and offset; malformed slots cannot become an all-day job. */
export function findRoutineSlot(routine, utcMs, { timeZone = 'Asia/Shanghai', offsetMinutes = 0 } = {}) {
  let clock = clocks.get(timeZone);
  if (!clock) { clock = createTownClock({ timeZone }); clocks.set(timeZone, clock); }
  const shifted = ((clock.at(utcMs).minuteOfDay - offsetMinutes) % 1440 + 1440) % 1440;
  for (const slot of Array.isArray(routine) ? routine : []) {
    const start = minute(slot?.start), end = minute(slot?.end, true);
    if (start === null || end === null) continue;
    if (end === 1440 ? shifted >= start : isInTimeWindow(shifted, start, end)) return slot;
  }
  return null;
}
