import test from 'node:test';
import assert from 'node:assert/strict';
import { createTownClock, isInTimeWindow, planCatchUp } from '../src/services/town/townClock.js';

test('injected clock uses explicit timezone and survives rollback/restart', () => {
  let instant = Date.parse('2026-09-08T15:59:00Z');
  const clock = createTownClock({ now: () => instant, timeZone: 'Asia/Shanghai' });
  assert.deepEqual(clock.snapshot(), { utcMs: instant, timeZone: 'Asia/Shanghai', date: '2026-09-08', minuteOfDay: 1439 });
  instant += 60000;
  const midnight = clock.snapshot();
  assert.equal(midnight.date, '2026-09-09');
  assert.equal(midnight.minuteOfDay, 0);
  instant -= 3600000;
  assert.equal(clock.now(), midnight.utcMs);
  assert.equal(createTownClock({ now: () => instant, lastNow: midnight.utcMs }).now(), midnight.utcMs);
  assert.throws(() => createTownClock({ now: () => NaN }).now());
  assert.throws(() => createTownClock({ timeZone: 'not/a-zone' }));
});

test('23:00–02:00 and ordinary windows have exact half-open boundaries', () => {
  for (const [minute, expected] of [[1379, false], [1380, true], [1439, true], [0, true], [119, true], [120, false]]) {
    assert.equal(isInTimeWindow(minute, 1380, 120), expected);
  }
  assert.equal(isInTimeWindow(540, 540, 1020), true);
  assert.equal(isInTimeWindow(1020, 540, 1020), false);
  assert.equal(isInTimeWindow(540, 540, 540), false);
  assert.throws(() => isInTimeWindow(1440, 0, 10));
});

test('timezone conversion handles DST repeated/skipped local hours using UTC instants', () => {
  const clock = createTownClock({ timeZone: 'America/New_York' });
  assert.equal(clock.at(Date.parse('2026-03-08T06:59:00Z')).minuteOfDay, 119);
  assert.equal(clock.at(Date.parse('2026-03-08T07:00:00Z')).minuteOfDay, 180);
  assert.equal(clock.at(Date.parse('2026-11-01T05:30:00Z')).minuteOfDay, 90);
  assert.equal(clock.at(Date.parse('2026-11-01T06:30:00Z')).minuteOfDay, 90);
});

test('offline days retain only six hours; step cap aggregates without gaps or lost remainder', () => {
  const now = Date.parse('2026-09-08T00:00:00Z');
  const plan = planCatchUp({ cursorUtcMs: now - 3 * 86400000, nowUtcMs: now, maxSteps: 7 });
  assert.equal(plan.skippedMs, 3 * 86400000 - 6 * 3600000);
  assert.equal(plan.steps.length, 7);
  assert.equal(plan.steps[0].fromUtcMs, now - 6 * 3600000);
  assert.equal(plan.steps.at(-1).toUtcMs, now);
  assert.equal(plan.steps.reduce((sum, step, i) => {
    if (i) assert.equal(step.fromUtcMs, plan.steps[i - 1].toUtcMs);
    assert.ok(step.toUtcMs > step.fromUtcMs);
    return sum + step.toUtcMs - step.fromUtcMs;
  }, 0), 6 * 3600000);
  assert.equal(plan.cursorUtcMs, now);
  assert.deepEqual(planCatchUp({ cursorUtcMs: now, nowUtcMs: now - 1 }).steps, []);
  assert.equal(planCatchUp({ cursorUtcMs: now, nowUtcMs: now - 1 }).cursorUtcMs, now);
  assert.equal(planCatchUp({ cursorUtcMs: 0, nowUtcMs: 60001 }).steps.at(-1).toUtcMs, 60001);
  for (const option of [{ stepMs: 0 }, { maxSteps: 10001 }, { maxCatchUpMs: Infinity }]) {
    assert.throws(() => planCatchUp({ cursorUtcMs: 0, nowUtcMs: now, ...option }));
  }
});
