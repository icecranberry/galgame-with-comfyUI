import test from 'node:test';
import assert from 'node:assert/strict';
import { backfillDay, planBackfillTimes, activityAt } from '../src/services/momentBackfillPlan.js';

test('补发时间分散在启动当日过去的时间，数量为两条或三条', () => {
  const now = new Date(2026, 9, 7, 18, 30);
  for (const value of [0, 0.49, 0.5, 0.999]) {
    const times = planBackfillTimes(now, () => value);
    assert.equal(times.length, value < 0.5 ? 2 : 3);
    times.forEach((time, i) => {
      assert.ok(time >= backfillDay(now).start && time <= now);
      if (i) assert.ok(time > times[i - 1]);
    });
  }
});

test('午夜不会倒填昨日或生成未来时间', () => {
  const midnight = new Date(2026, 9, 7);
  assert.ok(planBackfillTimes(midnight).every(time => +time === +midnight));
  assert.equal(backfillDay(midnight).end.getDate(), 8);
});

test('选定时间正确读取活动，支持跨午夜睡眠和时间边界', () => {
  const schedule = [
    { startTime: '22:00', endTime: '08:00', activity: '睡觉' },
    { startTime: '08:00', endTime: '22:00', activity: '工作' },
  ];
  for (const [hour, expected] of [[0, '睡觉'], [7, '睡觉'], [8, '工作'], [21, '工作'], [22, '睡觉']]) {
    assert.equal(activityAt(schedule, new Date(2026, 9, 7, hour)).activity, expected);
  }
  assert.equal(activityAt(null, new Date()), null);
});
