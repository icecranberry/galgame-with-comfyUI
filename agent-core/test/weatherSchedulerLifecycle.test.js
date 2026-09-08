import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

// Compile the actual service with isolated dependencies, never importing config,
// database, jose, or credentials. Scheduler/tick bodies are not rewritten.
function harness(t) {
  const original = readFileSync(new URL('../src/services/weatherService.js', import.meta.url), 'utf8');
  const hash = createHash('sha256').update(original).digest('hex');
  let source = original.replace(/^import .*;\r?\n/gm, '');
  const privateStart = source.indexOf('const _a =');
  const privateEnd = source.indexOf('const _z =');
  assert(privateStart >= 0 && privateEnd > privateStart, 'private constants boundary must be recognized');
  source = source.slice(0, privateStart)
    + "const _u = 'fixture-geo', _v = 'fixture-hourly', _w = 'fixture-city';\n"
    + source.slice(privateEnd);
  const networkStart = source.indexOf('async function fetchQWeather(');
  const networkEnd = source.indexOf('async function getLocationQuery(', networkStart);
  assert(networkStart >= 0 && networkEnd > networkStart, 'private request boundary must be recognized');
  source = source.slice(0, networkStart)
    + 'async function fetchQWeather() { return fakePrivateRequest(); }\n'
    + source.slice(networkEnd);
  source = source.replace(/^export /gm, '');

  let now = 0, nextId = 0, scheduledIntervals = 0, privateRequests = 0, forbiddenCalls = 0;
  const pending = new Map();
  const schedule = (fn, delay, interval) => {
    const id = ++nextId;
    pending.set(id, { fn, at: now + Number(delay), delay: Number(delay), interval });
    if (interval) scheduledIntervals++;
    return id;
  };
  const forbidden = () => { forbiddenCalls++; throw new Error('Forbidden external boundary in scheduler fixture'); };
  const db = { prepare: () => ({ get: () => undefined, run: () => ({}), pluck() { return this; } }) };
  const context = vm.createContext({
    config: { features: { weather: true }, weather: { city: 'fixture-city' } },
    getDb: () => db, replaceWeatherHourlyCache: forbidden, getTimeLight: forbidden,
    // The concurrent source-fence integration sees one stable fixture source.
    // Its race behavior is outside this scheduler-only test.
    captureWeatherSource: () => ({ sourceKey: 'fixture-city', revision: 1 }),
    beginWeatherForecastRequest: () => ({ sourceKey: 'fixture-city', revision: 1 }),
    assertWeatherSourceCurrent() {}, assertWeatherForecastCurrent() {},
    fakePrivateRequest: async () => { privateRequests++; return null; },
    fetch: forbidden, jose: new Proxy({}, { get: forbidden }),
    console: { log() {}, warn() {}, error() { forbiddenCalls++; } },
    setTimeout: (fn, delay) => schedule(fn, delay, false),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearTimeout: id => pending.delete(id), clearInterval: id => pending.delete(id),
  });
  new vm.Script(source + '\n;globalThis.scheduler = { startWeatherScheduler, stopWeatherScheduler, restartWeatherScheduler };',
    { filename: 'weatherService.lifecycle-isolated.js' }).runInContext(context);
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const advance = async ms => {
    const end = now + ms;
    await flush();
    for (let safety = 0; ; safety++) {
      assert(safety < 1000, 'virtual timer runaway');
      const due = [...pending].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      const [id, task] = due; now = task.at;
      if (task.interval) task.at += task.delay; else pending.delete(id);
      task.fn(); await flush();
    }
    now = end; await flush();
  };
  const snapshot = () => ({ at: now, intervals: [...pending.values()].filter(v => v.interval).length,
    timeouts: [...pending.values()].filter(v => !v.interval).length, scheduledIntervals, privateRequests });
  t.diagnostic(`actual source sha256=${hash}`);
  t.after(() => { pending.clear(); assert.equal(forbiddenCalls, 0, 'no JWT/network/database boundary may execute'); });
  return { ...context.scheduler, advance, snapshot, pendingCallbacks: () => [...pending.values()].map(task => task.fn) };
}

test('stop during startup delay schedules no later interval or request', async t => {
  const h = harness(t);
  h.startWeatherScheduler(); await h.advance(1000); h.stopWeatherScheduler();
  const stopped = h.snapshot(); await h.advance(10_000); const later = h.snapshot();
  t.diagnostic(JSON.stringify({ stopped, later }));
  assert.equal(later.scheduledIntervals - stopped.scheduledIntervals, 0, 'stopped startup timeout must not create an interval');
  assert.equal(later.privateRequests, stopped.privateRequests, 'stopped startup timeout must not poll');
  assert.equal(later.intervals, 0); assert.equal(later.timeouts, 0);
});

test('restart during startup keeps one scheduler and final stop removes all polling', async t => {
  const h = harness(t);
  h.startWeatherScheduler(); await h.advance(1000); h.restartWeatherScheduler();
  await h.advance(10_000); const restarted = h.snapshot();
  h.stopWeatherScheduler(); const stopped = h.snapshot();
  await h.advance(60 * 60 * 1000); const later = h.snapshot();
  t.diagnostic(JSON.stringify({ restarted, stopped, later }));
  assert.equal(restarted.intervals, 1, 'restart must replace the pending startup, not add a second interval');
  assert.equal(stopped.intervals, 0, 'stop must remove every owned interval');
  assert.equal(later.privateRequests, stopped.privateRequests, 'no polling after final stop');
  assert.equal(later.intervals, 0); assert.equal(later.timeouts, 0);
});

test('ordinary startup then stop clears its established interval', async t => {
  const h = harness(t);
  h.startWeatherScheduler(); await h.advance(10_000);
  assert.equal(h.snapshot().intervals, 1);
  h.stopWeatherScheduler(); const stopped = h.snapshot(); await h.advance(60 * 60 * 1000);
  assert.equal(h.snapshot().intervals, 0);
  assert.equal(h.snapshot().privateRequests, stopped.privateRequests);
});

test('repeated start is idempotent during delay and after interval establishment', async t => {
  const h = harness(t);
  h.startWeatherScheduler(); h.startWeatherScheduler(); h.startWeatherScheduler();
  assert.equal(h.snapshot().timeouts, 1);
  await h.advance(10_000);
  const started = h.snapshot();
  assert.equal(started.intervals, 1); assert.equal(started.privateRequests, 1);
  h.startWeatherScheduler(); await h.advance(10_000);
  assert.equal(h.snapshot().timeouts, 0); assert.equal(h.snapshot().scheduledIntervals, 1);
  assert.equal(h.snapshot().privateRequests, started.privateRequests);
  h.stopWeatherScheduler(); h.stopWeatherScheduler();
  assert.equal(h.snapshot().intervals, 0);
});

test('consecutive restarts preserve immediate tick and reset the single ten-second delay', async t => {
  const h = harness(t);
  h.startWeatherScheduler();
  for (let i = 0; i < 3; i++) {
    await h.advance(1000);
    const before = h.snapshot().privateRequests;
    h.restartWeatherScheduler(); await h.advance(0);
    assert.equal(h.snapshot().privateRequests, before + 1, 'restart still polls immediately');
    assert.equal(h.snapshot().timeouts, 1); assert.equal(h.snapshot().intervals, 0);
  }
  const requests = h.snapshot().privateRequests;
  await h.advance(9999); assert.equal(h.snapshot().privateRequests, requests);
  await h.advance(1);
  assert.equal(h.snapshot().privateRequests, requests + 1);
  assert.equal(h.snapshot().intervals, 1); assert.equal(h.snapshot().scheduledIntervals, 1);
  h.stopWeatherScheduler(); await h.advance(3_600_000);
  assert.equal(h.snapshot().intervals, 0); assert.equal(h.snapshot().timeouts, 0);
  assert.equal(h.snapshot().privateRequests, requests + 1);
});

test('stale dispatched delay and interval callbacks cannot poll or replace current ownership', async t => {
  const h = harness(t);
  h.startWeatherScheduler(); const [staleDelay] = h.pendingCallbacks();
  h.restartWeatherScheduler(); await h.advance(0);
  const before = h.snapshot();
  staleDelay(); await h.advance(0);
  assert.deepEqual(h.snapshot(), before, 'old delay cannot create an interval or clear the current delay');
  await h.advance(10_000); const [staleInterval] = h.pendingCallbacks();
  h.stopWeatherScheduler(); const stopped = h.snapshot();
  staleInterval(); staleDelay(); await h.advance(0);
  assert.deepEqual(h.snapshot(), stopped, 'already-dispatched callbacks must obey the generation fence');
});
