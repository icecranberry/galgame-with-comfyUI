import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuQueue } from '../src/services/gpuQueue.js';
import { createSpeechGpuCoordinator } from '../src/services/speechGpu.js';

function fixture(overrides = {}) {
  const events = [];
  let lease = 'orphan-from-previous-node';
  const gpu = createSpeechGpuCoordinator({ queue: createGpuQueue(),
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
