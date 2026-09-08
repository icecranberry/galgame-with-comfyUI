import test from 'node:test';
import assert from 'node:assert/strict';
import { createTownRuleEngine, selectTownCandidate, cooldownKey } from '../src/services/town/townRuleEngine.js';

const ref = name => ({ ref: name });
const op = (name, ...args) => ({ op: name, args });
const refs = { 'actor.busy': { type: 'boolean' }, 'actor.sleeping': { type: 'boolean' },
  'schedule.allowsWork': { type: 'boolean' }, 'actor.fatigue': { type: 'number', min: 0, max: 100 },
  'shop.availableStock': { type: 'number', min: 0 }, 'shop.materialUnits': { type: 'number', min: 0 },
  'shop.workstation': { type: 'string' } };
const engine = createTownRuleEngine({ refs, actions: { produce: {
  recipeKey: { type: 'string', values: ['workshop.basic_accessory'] }, stationRef: { type: 'string', ref: true },
} } });
const definition = (overrides = {}) => ({ key: 'workshop.restock', version: 1,
  trigger: ['stock.changed', 'work.window.started'], priority: 50,
  when: op('all', op('eq', ref('actor.sleeping'), false), ref('schedule.allowsWork'),
    op('not', ref('actor.busy')), op('lt', ref('shop.availableStock'), 3), op('gte', ref('shop.materialUnits'), 2)),
  score: op('clamp', op('sub', 80, ref('actor.fatigue')), 0, 100), cooldownSeconds: 1800,
  action: { type: 'produce', recipeKey: 'workshop.basic_accessory', stationRef: 'shop.workstation' }, ...overrides });
const facts = { 'actor.sleeping': false, 'schedule.allowsWork': true, 'actor.busy': false,
  'shop.availableStock': 2, 'shop.materialUnits': 2, 'actor.fatigue': 10, 'shop.workstation': 'station-1' };
const options = rules => ({ rules, facts, worldId: 'world-1', actorId: 'actor-1', decisionSequence: 3, nowUtcMs: 100000 });

test('chapter 8 restock rule resolves typed station and explains real constraints', () => {
  const rule = engine.compileRule(definition());
  assert.deepEqual(rule.evaluate(facts), { eligible: true, score: 70,
    action: { type: 'produce', recipeKey: 'workshop.basic_accessory', stationRef: 'station-1' } });
  for (const change of [{ 'actor.sleeping': true }, { 'schedule.allowsWork': false },
    { 'actor.busy': true }, { 'shop.availableStock': 3 }, { 'shop.materialUnits': 1 }]) {
    assert.equal(rule.evaluate({ ...facts, ...change }).eligible, false);
  }
  assert.equal(rule.evaluate({ ...facts, 'shop.workstation': null }).reason, 'missing_action_ref');
});

test('missing facts use three-valued logic and explicit exists/default, with no coercion', () => {
  const evaluate = ast => engine.compileExpression(ast).evaluate({});
  assert.deepEqual(evaluate(op('not', op('gte', ref('shop.availableStock'), 0))), { missing: true });
  assert.deepEqual(evaluate(op('exists', ref('shop.availableStock'))), { missing: false, value: false });
  assert.deepEqual(evaluate(op('default', ref('shop.availableStock'), 7)), { missing: false, value: 7 });
  assert.deepEqual(evaluate(op('all', false, op('gt', op('div', 1, 0), 0))), { missing: false, value: false });
  assert.deepEqual(evaluate(op('any', ref('actor.busy'), true)), { missing: false, value: true });
  assert.deepEqual(evaluate(op('all', ref('actor.busy'), false)), { missing: false, value: false });
  assert.equal(engine.compileRule(definition({ when: op('not', ref('actor.busy')) })).evaluate({}).reason, 'missing_fact');
});

test('arithmetic/comparison vocabulary has strict numeric semantics', () => {
  const cases = [[op('add', 2, 3, 4), 9], [op('sub', 2, 3), -1], [op('mul', 2, 3, 4), 24],
    [op('div', 9, 2), 4.5], [op('min', 9, 2), 2], [op('max', 9, 2), 9],
    [op('clamp', -2, 0, 100), 0], [op('clamp', 200, 0, 100), 100],
    [op('eq', 'a', 'a'), true], [op('ne', false, true), true], [op('gt', 2, 1), true],
    [op('gte', 2, 2), true], [op('lt', 1, 2), true], [op('lte', 2, 2), true], [op('in', 'a', ['a', 'b']), true]];
  for (const [ast, expected] of cases) assert.equal(engine.compileExpression(ast).evaluate({}).value, expected);
  for (const ast of [op('div', 1, 0), op('mul', 1e308, 10), op('clamp', 0, 10, 1)]) {
    assert.throws(() => engine.compileExpression(ast).evaluate({}));
  }
});

test('compiler rejects unknown permissions, malformed AST and type confusion', () => {
  for (const ast of [op('eval', 'x'), { ref: 'actor.secret' }, { ref: 'constructor' },
    { ref: 'actor.busy', extra: true }, { op: 'not', args: [true], extra: 1 },
    op('eq', 0, false), op('gte', null, 0), op('add', '2', 1), op('default', ref('actor.busy'), 0),
    op('in', 1, ['1']), op('not', true, false), op('exists', true), Infinity, ['a', 1]]) {
    assert.throws(() => engine.compileExpression(ast));
  }
  for (const change of [{ priority: NaN }, { cooldownSeconds: -1 }, { when: 2 }, { score: true }, { typo: 1 },
    { action: { type: 'transferMoney' } },
    { action: { ...definition().action, stationRef: 'actor.busy' } },
    { action: { ...definition().action, recipeKey: 'unregistered' } },
    { action: { ...definition().action, arbitrary: 1 } }]) assert.throws(() => engine.compileRule(definition(change)));
});

test('depth and node budgets include literals and both rule expressions', () => {
  let ast = true;
  for (let i = 0; i < 11; i++) ast = op('not', ast);
  engine.compileExpression(ast);
  assert.throws(() => engine.compileExpression(op('not', ast)), /limit/);
  engine.compileExpression(op('all', ...Array(127).fill(true)));
  assert.throws(() => engine.compileExpression(op('all', ...Array(128).fill(true))), /limit/);
  assert.throws(() => engine.compileRule(definition({ when: op('all', ...Array(127).fill(true)), score: 1 })), /limit/);
  const cycle = op('not'); cycle.args.push(cycle);
  assert.throws(() => engine.compileExpression(cycle), /limit/);
});

test('compiled rules detach source mutations and invalid runtime facts fail closed', () => {
  const source = definition();
  const rule = engine.compileRule(source);
  source.when.args.length = 0; source.action.stationRef = 'secret'; source.priority = 999;
  assert.equal(rule.priority, 50);
  assert.equal(rule.evaluate(facts).action.stationRef, 'station-1');
  const result = selectTownCandidate({ ...options([rule]), facts: { ...facts, 'shop.availableStock': '0' } });
  assert.equal(result.selected, null);
  assert.equal(result.rejected[0].reason, 'evaluation_error');
});

test('seed replay ignores input ordering and only samples highest priority near-score pool', () => {
  const rules = [['a', 50, 80], ['b', 50, 79], ['c', 50, 70], ['d', 49, 100]]
    .map(([key, priority, score]) => engine.compileRule(definition({ key, priority, score })));
  const seen = new Set();
  for (let decisionSequence = 0; decisionSequence < 1000; decisionSequence++) {
    const input = { ...options(rules), decisionSequence, nearScore: 1 };
    const first = selectTownCandidate(input);
    assert.deepEqual(first, selectTownCandidate({ ...input, rules: [...rules].reverse() }));
    assert.ok(['a', 'b'].includes(first.selected.key)); seen.add(first.selected.key);
  }
  assert.equal(seen.size, 2);
  assert.equal(selectTownCandidate(options(rules)).selected.key, 'a');
  assert.throws(() => selectTownCandidate(options([rules[0], rules[0]])), /Duplicate/);
});

test('cooldown survives midnight, rollback and rule version changes; selection never mutates history', () => {
  const rule = engine.compileRule(definition({ when: true, score: 80, version: 2 }));
  const last = Date.parse('2026-09-08T23:50:00Z');
  const key = cooldownKey({ worldId: 'world-1', actorId: 'actor-1', ruleKey: rule.key });
  const cooldowns = new Map([[key, last]]);
  for (const nowUtcMs of [last - 60000, last + 20 * 60000, last + 30 * 60000 - 1]) {
    assert.equal(selectTownCandidate({ ...options([rule]), cooldowns, nowUtcMs }).rejected[0].reason, 'cooldown');
  }
  const result = selectTownCandidate({ ...options([rule]), cooldowns, nowUtcMs: last + 30 * 60000 });
  assert.equal(result.selected.key, rule.key);
  assert.deepEqual(result.cooldownUpdate, { key, lastStartedUtcMs: last + 30 * 60000 });
  assert.equal(cooldowns.get(key), last);
  assert.ok(selectTownCandidate({ ...options([rule]), cooldowns, actorId: 'actor-2', nowUtcMs: last }).selected);
});

test('hard constraints, minimum duration, switch cost and triggers gate decisions', () => {
  const rules = [engine.compileRule(definition({ key: 'work', score: 80 })),
    engine.compileRule(definition({ key: 'rest', score: 85 }))];
  const input = { ...options(rules), current: { ruleKey: 'work', startedAtUtcMs: 90000, minDurationMs: 20000 } };
  assert.equal(selectTownCandidate(input).reason, 'minimum_duration');
  assert.equal(selectTownCandidate({ ...input, blockedReason: 'off_town' }).reason, 'off_town');
  assert.equal(selectTownCandidate({ ...input, nowUtcMs: 110000, switchPenalty: 10 }).selected.key, 'work');
  assert.equal(selectTownCandidate({ ...options(rules), trigger: 'unrelated' }).selected, null);
  const broken = engine.compileRule(definition({ key: 'broken', score: op('div', 1, 0) }));
  const result = selectTownCandidate(options([...rules, broken]));
  assert.equal(result.selected.key, 'rest');
  assert.equal(result.rejected[0].reason, 'evaluation_error');
});
