import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneOutfitBatchRunner } from '../src/services/sceneOutfitBatch.js';

const scenes = ['casual', 'home', 'sleep'];
const outfits = scenes.map(scene => ({ scene, name: scene, description: `${scene} clothes` }));
function fixture(overrides = {}) {
  const calls = [], progress = [];
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  const options = {
    character: { id: 7, display_name: '测试角色' }, scenes,
    design: async () => { calls.push('design'); return outfits; },
    save: async rows => { assert.deepEqual(rows, outfits); calls.push('save'); },
    render: async scene => { calls.push(scene); return `/images/${scene}.png`; },
    startTask: spec => {
      calls.push('start');
      assert.equal(spec.action, 'scene_outfits');
      assert.equal(spec.meta.characterId, 7);
      return { id: 'batch-7', onProgress: p => progress.push(p),
        succeed: result => complete({ result }), fail: error => complete({ error }) };
    }, ...overrides,
  };
  return { options, calls, progress, done };
}
test('saves all designs before rendering in scene order and reports completion', async () => {
  const f = fixture();
  const task = createSceneOutfitBatchRunner()(f.options);
  assert.equal(task.id, 'batch-7');
  const { result } = await f.done;
  assert.deepEqual(f.calls, ['start', 'design', 'save', ...scenes]);
  assert.equal(result.completed.length, 3);
  assert.equal(f.progress[0].phase, 'design');
  assert.deepEqual(f.progress.slice(1).map(p => p.progress), [0.25, 0.5, 0.75]);
});
test('incomplete design fails without saving or rendering', async () => {
  const f = fixture({ design: async () => outfits.slice(0, 2) });
  createSceneOutfitBatchRunner()(f.options);
  const { error } = await f.done;
  assert.match(error.message, /设计不完整/);
  assert.deepEqual(f.calls, ['start']);
});
test('save failure prevents rendering', async () => {
  const f = fixture({ save: async () => { throw new Error('write failed'); } });
  createSceneOutfitBatchRunner()(f.options);
  const { error } = await f.done;
  assert.match(error.message, /write failed/);
  assert.deepEqual(f.calls, ['start', 'design']);
});
test('one image failure preserves successes and continues remaining scenes', async () => {
  const rendered = [];
  const f = fixture({ render: async scene => {
    rendered.push(scene);
    if (scene === 'home') throw new Error('image service unavailable');
    return `/images/${scene}.png`;
  } });
  createSceneOutfitBatchRunner()(f.options);
  const { error } = await f.done;
  assert.deepEqual(rendered, scenes);
  assert.match(error.message, /完成 2\/3/);
  assert.match(error.message, /居家：image service unavailable/);
});
test('duplicate submissions reuse running task; lock releases after completion', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ design: async () => { await gate; return outfits; } });
  const start = createSceneOutfitBatchRunner();
  const first = start(f.options);
  assert.equal(start(f.options), first);
  assert.deepEqual(f.calls, ['start']);
  release();
  await f.done;
  await new Promise(resolve => setImmediate(resolve));
  const next = fixture();
  assert.notEqual(start(next.options), first);
  await next.done;
});
