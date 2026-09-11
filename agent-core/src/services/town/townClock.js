/** UTC milliseconds at every public boundary. No timers or business side effects. */
export function assertUtcMs(value) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > 8640000000000000) {
    throw new TypeError('Expected valid UTC milliseconds');
  }
  return value;
}

/** A rollback is clamped to the last observed instant (persist lastNow across restarts). */
export function createTownClock({ now = Date.now, timeZone = 'UTC', lastNow = null } = {}) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  let previous = lastNow === null ? null : assertUtcMs(lastNow);
  function read() {
    const current = assertUtcMs(now());
    previous = previous === null ? current : Math.max(previous, current);
    return previous;
  }
  function at(utcMs) {
    assertUtcMs(utcMs);
    const parts = Object.fromEntries(formatter.formatToParts(utcMs).map(p => [p.type, p.value]));
    return Object.freeze({ utcMs, timeZone, date: `${parts.year}-${parts.month}-${parts.day}`,
      minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute) });
  }
  return Object.freeze({ now: read, at, snapshot: () => at(read()) });
}

/** Half-open [start,end); equal endpoints mean empty, not all day. */
export function isInTimeWindow(minuteOfDay, startMinute, endMinute) {
  for (const value of [minuteOfDay, startMinute, endMinute]) {
    if (!Number.isInteger(value) || value < 0 || value >= 1440) throw new RangeError('Invalid minute of day');
  }
  return startMinute <= endMinute
    ? minuteOfDay >= startMinute && minuteOfDay < endMinute
    : minuteOfDay >= startMinute || minuteOfDay < endMinute;
}

/**
 * Ordinary simulation only: retain the newest bounded interval, aggregate into
 * <= maxSteps contiguous steps. Persist cursor only after work commits. This does
 * not settle wages or expire commitments; recover orders/escrow separately.
 */
export function planCatchUp({ cursorUtcMs, nowUtcMs, maxCatchUpMs = 6 * 3600000,
  stepMs = 60000, maxSteps = 360 }) {
  assertUtcMs(cursorUtcMs);
  assertUtcMs(nowUtcMs);
  for (const value of [maxCatchUpMs, stepMs, maxSteps]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('Catch-up limits must be positive integers');
  }
  if (maxSteps > 10000) throw new RangeError('maxSteps exceeds hard limit');
  const end = Math.max(cursorUtcMs, nowUtcMs);
  const start = Math.max(cursorUtcMs, end - maxCatchUpMs);
  const duration = end - start;
  const count = Math.min(maxSteps, Math.ceil(duration / stepMs));
  const steps = Array.from({ length: count }, (_, i) => Object.freeze({
    fromUtcMs: start + Math.floor(duration * i / count),
    toUtcMs: start + Math.floor(duration * (i + 1) / count),
  }));
  return Object.freeze({ fromUtcMs: start, toUtcMs: end, cursorUtcMs: end,
    skippedMs: start - cursorUtcMs, steps: Object.freeze(steps) });
}
