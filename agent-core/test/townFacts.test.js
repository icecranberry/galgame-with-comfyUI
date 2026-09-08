import test from 'node:test';
import assert from 'node:assert/strict';
import { createFactRegistry, createFactSnapshot } from '../src/services/town/townFacts.js';

test('fact snapshots detach and freeze batches; null is absent but zero/false survive', () => {
  const registry = createFactRegistry({ 'actor.fatigue': { type: 'number', min: 0, max: 100 },
    'actor.tags': { type: 'string[]' }, 'actor.busy': { type: 'boolean' }, 'actor.place': { type: 'string' } });
  const values = { 'actor.fatigue': 0, 'actor.busy': false, 'actor.tags': ['worker'], 'actor.place': null };
  const facts = createFactSnapshot(registry, values);
  values['actor.tags'].push('visitor');
  values['actor.fatigue'] = 10;
  assert.equal(facts['actor.fatigue'], 0);
  assert.equal(facts['actor.busy'], false);
  assert.deepEqual(facts['actor.tags'], ['worker']);
  assert.equal(Object.hasOwn(facts, 'actor.place'), false);
  assert.throws(() => facts['actor.tags'].push('admin'));
  assert.throws(() => { facts['actor.busy'] = true; });
});

test('registry enforces types, finite ranges, domains and disallows hidden access', () => {
  const registry = createFactRegistry({ stock: { type: 'number', min: 0, max: 10 },
    weather: { type: 'string', values: ['rain', 'sun'] } });
  for (const stock of ['0', false, NaN, Infinity, -1, 11]) assert.throws(() => createFactSnapshot(registry, { stock }));
  assert.throws(() => createFactSnapshot(registry, { weather: 'snow' }));
  assert.throws(() => createFactSnapshot(registry, { secret: 1 }));
  let called = false;
  assert.throws(() => createFactSnapshot(registry, { get stock() { called = true; return 1; } }));
  assert.equal(called, false);
  for (const definitions of [{ 'actor.constructor.name': { type: 'string' } },
    { stock: { type: 'number', min: 3, max: 1 } }, { x: { type: 'object' } },
    { x: { type: 'string', values: [1] } }, { x: { type: 'string', query: 'anything' } }]) {
    assert.throws(() => createFactRegistry(definitions));
  }
});
