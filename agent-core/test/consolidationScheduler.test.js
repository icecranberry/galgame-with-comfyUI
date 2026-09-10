import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRunGates, readDailyUsage, shanghaiDateKey } from '../src/services/memory/consolidationScheduler.js';

const NOW = new Date('2026-09-10T12:00:00Z');
const cfg = { minIntervalMinutes: 60, llmCallsPerRun: 3, dailyLlmCalls: 60 };

function isoMinutesAgo(minutes) {
  return new Date(NOW.getTime() - minutes * 60000).toISOString();
}

test('evaluateRunGates：空闲且距上次实干够久 → 放行', () => {
  const gate = evaluateRunGates({ state: { lastWorkedAt: isoMinutesAgo(90) }, cfg, idle: true, now: NOW.getTime() });
  assert.deepEqual(gate, { run: true });
});

test('evaluateRunGates：空闲但未到最小间隔 → min-interval（修复前会每 5 分钟跑一整轮）', () => {
  // 用户已离开（idle=true），上一次实干在 10 分钟前：旧逻辑会立刻再跑一轮
  const gate = evaluateRunGates({ state: { lastWorkedAt: isoMinutesAgo(10) }, cfg, idle: true, now: NOW.getTime() });
  assert.deepEqual(gate, { run: false, skipped: 'min-interval' });
});

test('evaluateRunGates：不空闲且距上次实干 < 22h → not-idle；≥ 22h → 兜底放行', () => {
  const recent = evaluateRunGates({ state: { lastWorkedAt: isoMinutesAgo(120) }, cfg, idle: false, now: NOW.getTime() });
  assert.deepEqual(recent, { run: false, skipped: 'not-idle' });
  const fallback = evaluateRunGates({ state: { lastWorkedAt: isoMinutesAgo(23 * 60) }, cfg, idle: false, now: NOW.getTime() });
  assert.deepEqual(fallback, { run: true });
});

test('evaluateRunGates：空转轮不再刷新兜底锚点（lastFinishedAt 不参与判定）', () => {
  // 只有 lastFinishedAt 被每轮刷新、lastWorkedAt 是很久以前 → 22h 兜底应当生效
  const gate = evaluateRunGates({
    state: { lastFinishedAt: isoMinutesAgo(1), lastWorkedAt: isoMinutesAgo(23 * 60) },
    cfg,
    idle: false,
    now: NOW.getTime(),
  });
  assert.deepEqual(gate, { run: true });
});

test('evaluateRunGates：上一轮空手而归 → scan-backoff', () => {
  const gate = evaluateRunGates({
    state: { lastWorkedAt: isoMinutesAgo(600), lastEmptyScanAt: isoMinutesAgo(5) },
    cfg,
    idle: true,
    now: NOW.getTime(),
  });
  assert.deepEqual(gate, { run: false, skipped: 'scan-backoff' });
  const later = evaluateRunGates({
    state: { lastWorkedAt: isoMinutesAgo(600), lastEmptyScanAt: isoMinutesAgo(31) },
    cfg,
    idle: true,
    now: NOW.getTime(),
  });
  assert.deepEqual(later, { run: true });
});

test('readDailyUsage：跨上海日期归零，同日内累计', () => {
  const date = shanghaiDateKey(NOW);
  assert.equal(readDailyUsage({ daily: { date, used: 17 } }, NOW).used, 17);
  assert.equal(readDailyUsage({ daily: { date: '2026-09-09', used: 17 } }, NOW).used, 0);
  assert.equal(readDailyUsage({}, NOW).used, 0);
});
