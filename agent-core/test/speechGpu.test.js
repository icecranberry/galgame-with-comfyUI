import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuQueue } from '../src/services/gpuQueue.js';
import { createSpeechGpuCoordinator } from '../src/services/speechGpu.js';

function fixture(overrides = {}) {
  const events = [];
  let lease = 'orphan-from-previous-node';
  const gpu = createSpeechGpuCoordinator({ queue: createGpuQueue(),
    policy: async () => ({ shared: false, guard: true, lease: true }),
    ensureService: async () => { events.push('ensure'); return { online: true, compatible: true, ready: true, busy: false }; },
    unload: async options => { events.push(options?.idle_only ? 'idle-unload' : 'unload'); return { unloaded: true }; },
    guard: async (route, body) => {
      events.push(route);
      if (route === 'recover') { assert.equal(body.worker_unloaded, true); lease = null; }
      if (route === 'acquire') { if (lease) return false; lease = body.token; }
      if (route === 'release') { assert.equal(body.token, lease); lease = null; }
      return true;
    }, ...overrides,
  });
  return { gpu, events };
}

test('first speech recovers the orphaned lease only after confirmed worker exit; subsequent speech reuses it', async () => {
  const { gpu, events } = fixture();
  await gpu.withSpeechGpu(async () => events.push('speech1'));
  await gpu.withSpeechGpu(async () => events.push('speech2'));
  await gpu.withImageGpu(async () => events.push('image'));
  assert.deepEqual(events, ['ensure', 'idle-unload', 'recover', 'acquire', 'speech1', 'ensure', 'speech2', 'unload', 'release', 'image']);
});

test('busy or unconfirmed workers never release an unknown lease', async () => {
  const busy = fixture({ ensureService: async () => ({ online: true, compatible: true, ready: true, busy: true }) });
  await assert.rejects(busy.gpu.withSpeechGpu(() => assert.fail('must not synthesize')), /上一任务/);
  assert.deepEqual(busy.events, []);
  for (const unload of [async () => { throw new Error('worker exit failed'); }, async () => ({})]) {
    const { gpu, events } = fixture({ unload });
    await assert.rejects(gpu.withSpeechGpu(() => assert.fail('must not synthesize')), /worker exit failed|保留显存锁/);
    assert.deepEqual(events, ['ensure']);
  }
});

test('startup failure, missing models and cancellation do not acquire GPU or synthesize', async () => {
  for (const ensureService of [async () => { throw new Error('startup failed'); }, async () => ({ online: true, ready: false, error: 'missing models' })]) {
    const { gpu, events } = fixture({ ensureService });
    await assert.rejects(gpu.withSpeechGpu(() => assert.fail('must not synthesize')), /startup failed|missing models/);
    assert.deepEqual(events, []);
  }
  let cancelled = false;
  const { gpu, events } = fixture({ ensureService: async () => { cancelled = true; return { online: true, compatible: true, ready: true }; } });
  await assert.rejects(gpu.withSpeechGpu(() => assert.fail('must not synthesize'), () => cancelled), /取消/);
  assert.deepEqual(events, []);
});

test('real image contention is bounded and does not repeatedly force recovery', async () => {
  let clock = 0;
  const calls = [];
  const { gpu } = fixture({ now: () => clock, sleep: async ms => { clock += ms; },
    guard: async route => { calls.push(route); return route !== 'acquire'; },
  });
  await assert.rejects(gpu.withSpeechGpu(() => assert.fail('must not synthesize')), /等待生图/);
  assert.equal(calls.filter(route => route === 'recover').length, 1);
  assert.ok(clock >= 120000);
});

test('uncertain inference cleanup keeps the lock and blocks subsequent image work', async () => {
  const { gpu, events } = fixture({ unload: async options => {
    if (options?.idle_only) return { unloaded: true };
    throw new Error('worker exit failed');
  } });
  await assert.rejects(gpu.withSpeechGpu(async () => { throw new Error('inference failed'); }), /worker exit failed/);
  await assert.rejects(gpu.withImageGpu(() => assert.fail('must not submit image')), /worker exit failed/);
  assert.equal(events.includes('release'), false);
});

test('a newly started adapter can clear an earlier unload failure before retrying speech', async () => {
  let broken = false, started = false;
  const { gpu, events } = fixture({
    ensureService: async () => ({ online: true, compatible: true, ready: true, started }),
    unload: async () => { if (broken) throw new Error('offline'); return { unloaded: true }; },
  });
  await assert.rejects(gpu.withSpeechGpu(async () => { broken = true; throw new Error('worker crashed'); }), /offline/);
  broken = false; started = true;
  await gpu.withSpeechGpu(async () => events.push('retried'));
  assert.ok(events.indexOf('release') < events.indexOf('retried'));
  await gpu.withImageGpu(async () => {});
});

const deferred = () => Promise.withResolvers();

for (const first of ['speech', 'image']) {
  test(`ample memory allows real overlap with ${first} started first`, { timeout: 2000 }, async () => {
    const { gpu, events } = fixture({ policy: async () => ({ shared: true, guard: true }) });
    const started = deferred(), finish = deferred();
    const initial = first === 'speech' ? gpu.withSpeechGpu : gpu.withImageGpu;
    const other = first === 'speech' ? gpu.withImageGpu : gpu.withSpeechGpu;
    const running = initial(async () => { started.resolve(); await finish.promise; });
    await started.promise;
    try {
      await other(async () => events.push('overlapped'));
      assert.ok(events.includes('overlapped'));
      assert.equal(events.includes('acquire'), false);
      assert.equal(events.includes('unload'), false);
    } finally { finish.resolve(); await running; await gpu.recoverSpeechGpu(); }
  });
}

test('remote image generation never calls a remote guard for local speech or recovery', async () => {
  const { gpu, events } = fixture({ policy: async () => ({ shared: true, guard: false }),
    guard: async () => assert.fail('remote guard must not be called'),
  });
  await gpu.withSpeechGpu(async () => events.push('speech'));
  await gpu.withImageGpu(async () => events.push('image'));
  assert.equal(events.includes('unload'), false);
  await gpu.recoverSpeechGpu();
});

test('shared mode tolerates a missing guard and retains the warm speech model', async () => {
  let recoveries = 0;
  const { gpu, events } = fixture({ policy: async () => ({ shared: true, guard: true }),
    guard: async () => { recoveries++; throw Object.assign(new Error('missing'), { code: 'GUARD_MISSING' }); },
  });
  await gpu.withSpeechGpu(async () => {});
  await gpu.withSpeechGpu(async () => {});
  assert.equal(recoveries, 1);
  assert.equal(events.filter(e => e === 'idle-unload').length, 1);
  assert.equal(events.includes('unload'), false);
  await gpu.recoverSpeechGpu();
});

test('memory pressure waits for shared speech to finish before unloading for an image', { timeout: 2000 }, async () => {
  let shared = true;
  const { gpu, events } = fixture({ policy: async () => ({ shared, guard: true }) });
  const started = deferred(), finish = deferred();
  const speech = gpu.withSpeechGpu(async () => { started.resolve(); await finish.promise; events.push('finished'); });
  await started.promise;
  shared = false;
  const image = gpu.withImageGpu(async () => events.push('image'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.includes('image'), false);
  assert.equal(events.includes('unload'), false);
  finish.resolve();
  await Promise.all([speech, image]);
  assert.ok(events.indexOf('finished') < events.indexOf('unload'));
  assert.ok(events.indexOf('unload') < events.indexOf('image'));
});

test('exclusive speech waits for a running image before acquiring the lease', { timeout: 2000 }, async () => {
  const { gpu, events } = fixture();
  const started = deferred(), finish = deferred();
  const image = gpu.withImageGpu(async () => { started.resolve(); await finish.promise; events.push('image-finished'); });
  await started.promise;
  const speech = gpu.withSpeechGpu(async () => events.push('speech'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.includes('acquire'), false);
  finish.resolve();
  await Promise.all([image, speech]);
  assert.ok(events.indexOf('image-finished') < events.indexOf('acquire'));
  await gpu.recoverSpeechGpu();
});

test('recovery accepts a stale lease token after confirming worker exit', async () => {
  const { gpu, events } = fixture({ guard: async route => { events.push(route); return route !== 'release'; } });
  await gpu.withSpeechGpu(async () => {});
  await gpu.recoverSpeechGpu();
  assert.equal(events.includes('release'), false);
  await gpu.withImageGpu(async () => events.push('image'));
  assert.ok(events.includes('image'));
});

test('maintenance waits for shared speech and speech jobs remain serialized', { timeout: 2000 }, async () => {
  const { gpu, events } = fixture({ policy: async () => ({ shared: true, guard: false }) });
  const started = deferred(), finish = deferred();
  const first = gpu.withSpeechGpu(async () => { started.resolve(); await finish.promise; events.push('first-finished'); });
  await started.promise;
  const second = gpu.withSpeechGpu(async () => events.push('second'));
  const restart = gpu.restartSpeechGpu(async () => events.push('restart'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.includes('second'), false);
  assert.equal(events.includes('restart'), false);
  finish.resolve();
  await Promise.all([first, second, restart]);
  assert.ok(events.indexOf('first-finished') < events.indexOf('second'));
  assert.ok(events.indexOf('second') < events.indexOf('restart'));
});

test('a missing guard node degrades to local sequencing instead of failing', async () => {
  const { gpu, events } = fixture({
    guard: async () => { events.push('guard'); throw Object.assign(new Error('missing guard'), { code: 'GUARD_MISSING' }); },
  });
  await gpu.withSpeechGpu(async () => events.push('speech1'));
  assert.ok(events.includes('speech1'));
  await gpu.withImageGpu(async () => events.push('image1'));
  assert.ok(events.indexOf('unload') < events.indexOf('image1'));
  // The absent node is detected once; later calls stop asking it.
  const asked = events.filter(route => route === 'guard').length;
  await gpu.withSpeechGpu(async () => events.push('speech2'));
  await gpu.withImageGpu(async () => events.push('image2'));
  assert.equal(events.filter(route => route === 'guard').length, asked);
  await gpu.recoverSpeechGpu();
});

test('a card that admits both models still sequences when the guard node is missing', async () => {
  const { gpu, events } = fixture({
    policy: async () => ({ shared: true, guard: true, lease: false }),
    guard: async () => { throw Object.assign(new Error('missing guard'), { code: 'GUARD_MISSING' }); },
  });
  await gpu.withSpeechGpu(async () => events.push('speech'));
  await gpu.withImageGpu(async () => events.push('image'));
  assert.ok(events.indexOf('unload') < events.indexOf('image'));
});

test('cancelled queued speech preserves idle cleanup for an already warm shared model', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { gpu, events } = fixture({ policy: async () => ({ shared: true, guard: false }) });
  await gpu.withSpeechGpu(async () => {});
  await assert.rejects(gpu.withSpeechGpu(() => assert.fail('cancelled work'), () => true), /取消/);
  t.mock.timers.tick(10 * 60 * 1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.filter(e => e === 'unload').length, 1);
  assert.equal(events.includes('release'), false);
});

test('startup memory admission measures free memory after unloading the orphan worker', async () => {
  let unloaded = false;
  const { gpu, events } = fixture({
    unload: async () => { unloaded = true; return { unloaded: true }; },
    policy: async () => ({ shared: unloaded, guard: true }),
  });
  await gpu.withSpeechGpu(async () => {});
  assert.equal(events.includes('acquire'), false);
  await gpu.recoverSpeechGpu();
});
