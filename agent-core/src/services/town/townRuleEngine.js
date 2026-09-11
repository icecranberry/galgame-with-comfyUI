import { createHash } from 'node:crypto';
import { assertUtcMs } from './townClock.js';
import { MISSING, createFactRegistry, createFactSnapshot, assertFactValue } from './townFacts.js';

const numeric = new Set(['add', 'sub', 'mul', 'div', 'min', 'max', 'clamp']);
const compare = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in']);
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = message => { throw new TypeError(message); };
function fields(object, allowed) {
  if (Object.keys(object).some(k => !allowed.includes(k))) fail('Unknown AST/rule/action field');
}

/**
 * Pure compiler/selector. refs is a fact descriptor map. actions is an explicit
 * capability map, e.g. {produce: {recipeKey:{type:'string'},
 * stationRef:{type:'string',ref:true}}}. All action fields are required;
 * ref:true resolves an allowlisted fact and keeps the original parameter name.
 * No action runner is invoked. Returned compiled objects are immutable closures.
 */
export function createTownRuleEngine({ refs = {}, actions = {}, maxDepth = 12, maxNodes = 128 } = {}) {
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 64
    || !Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 4096) fail('Invalid AST limits');
  const registry = createFactRegistry(refs);
  const actionSchemas = Object.create(null);
  for (const [type, schema] of Object.entries(actions)) {
    const parameters = Object.create(null);
    for (const [key, descriptor] of Object.entries(schema)) {
      if (key === 'type') fail('Reserved action field');
      const { ref = false, ...valueDescriptor } = descriptor;
      if (typeof ref !== 'boolean') fail('Invalid action ref flag');
      parameters[key] = Object.freeze({ ...createFactRegistry({ [key]: valueDescriptor })[key], ref });
    }
    actionSchemas[type] = Object.freeze(parameters);
  }

  function build(ast, budget, depth = 1) {
    if (++budget.nodes > maxNodes || depth > maxDepth) fail('AST depth/node limit exceeded');
    const child = value => build(value, budget, depth + 1);
    const literalType = typeof ast;
    if (['number', 'string', 'boolean'].includes(literalType)) {
      if (literalType === 'number' && !Number.isFinite(ast)) fail('Non-finite literal');
      return { type: literalType, read: () => ast };
    }
    if (Array.isArray(ast)) {
      if (!ast.length) fail('Empty array has no type');
      const items = ast.map(child);
      const type = items[0].type;
      if (!['number', 'string', 'boolean'].includes(type)
        || items.some((item, i) => item.type !== type || typeof ast[i] !== type)) fail('Arrays must contain homogeneous literals');
      const value = Object.freeze([...ast]);
      return { type: `${type}[]`, read: () => value };
    }
    if (!ast || typeof ast !== 'object') fail('Invalid AST node');
    if (Object.hasOwn(ast, 'ref')) {
      fields(ast, ['ref']);
      if (typeof ast.ref !== 'string' || !Object.hasOwn(registry, ast.ref)) fail('Unknown ref');
      const name = ast.ref;
      return { type: registry[name].type, read: facts => Object.hasOwn(facts, name) ? facts[name] : MISSING };
    }
    fields(ast, ['op', 'args']);
    const { op, args } = ast;
    if (!['all', 'any', 'not', 'exists', 'default', ...numeric, ...compare].includes(op)) fail('Unknown operator');
    if (!Array.isArray(args)) fail('args must be an array');
    const arity = ['not', 'exists'].includes(op) ? 1 : op === 'clamp' ? 3
      : ['all', 'any', 'add', 'mul', 'min', 'max'].includes(op) ? null : 2;
    if (arity === null ? !args.length : args.length !== arity) fail('Invalid arity');
    if (op === 'exists' && (!args[0] || !Object.hasOwn(args[0], 'ref'))) fail('exists requires ref');
    const nodes = args.map(child);
    const types = nodes.map(n => n.type);
    let type = 'boolean';
    if (numeric.has(op)) {
      if (types.some(t => t !== 'number')) fail('Arithmetic requires numbers');
      type = 'number';
    } else if (['all', 'any', 'not'].includes(op)) {
      if (types.some(t => t !== 'boolean')) fail('Logic requires booleans');
    } else if (op === 'default') {
      if (types[0] !== types[1]) fail('default type mismatch');
      type = types[0];
    } else if (compare.has(op)) {
      if (op === 'in' ? types[1] !== `${types[0]}[]`
        : ['eq', 'ne'].includes(op) ? types[0] !== types[1] || types[0].endsWith('[]')
          : types.some(t => t !== 'number')) fail('Comparison type mismatch');
    }
    return { type, read(facts) {
      if (op === 'exists') return nodes[0].read(facts) !== MISSING;
      if (op === 'default') { const v = nodes[0].read(facts); return v === MISSING ? nodes[1].read(facts) : v; }
      // Three-valued short circuit: not(missing) is still missing, never true.
      if (op === 'all' || op === 'any') {
        let missing = false;
        for (const node of nodes) {
          const v = node.read(facts);
          if (op === 'all' && v === false) return false;
          if (op === 'any' && v === true) return true;
          missing ||= v === MISSING;
        }
        return missing ? MISSING : op === 'all';
      }
      const values = nodes.map(n => n.read(facts));
      if (values.includes(MISSING)) return MISSING;
      const [a, b, c] = values;
      let value;
      switch (op) {
        case 'not': return !a;
        case 'eq': return a === b;
        case 'ne': return a !== b;
        case 'gt': return a > b;
        case 'gte': return a >= b;
        case 'lt': return a < b;
        case 'lte': return a <= b;
        case 'in': return b.includes(a);
        case 'add': value = values.reduce((x, y) => x + y, 0); break;
        case 'sub': value = a - b; break;
        case 'mul': value = values.reduce((x, y) => x * y, 1); break;
        case 'div': if (b === 0) fail('Division by zero'); value = a / b; break;
        case 'min': value = Math.min(...values); break;
        case 'max': value = Math.max(...values); break;
        case 'clamp': if (b > c) fail('Inverted clamp range'); value = Math.min(c, Math.max(b, a)); break;
      }
      if (!Number.isFinite(value)) fail('Non-finite result');
      return value;
    } };
  }

  function compileExpression(ast) {
    const node = build(ast, { nodes: 0 });
    return Object.freeze({ type: node.type, evaluate: values => {
      const value = node.read(createFactSnapshot(registry, values));
      return value === MISSING ? Object.freeze({ missing: true }) : Object.freeze({ missing: false, value });
    } });
  }

  function compileRule(rule) {
    fields(rule, ['key', 'version', 'trigger', 'priority', 'when', 'score', 'cooldownSeconds', 'action']);
    if (typeof rule.key !== 'string' || !rule.key.length || !Number.isSafeInteger(rule.version) || rule.version < 1
      || !Number.isSafeInteger(rule.priority) || !Number.isSafeInteger(rule.cooldownSeconds)
      || rule.cooldownSeconds < 0 || !Number.isSafeInteger(rule.cooldownSeconds * 1000)) fail('Invalid rule metadata');
    if (!Array.isArray(rule.trigger) || !rule.trigger.length || rule.trigger.some(t => typeof t !== 'string' || !t)) fail('Invalid triggers');
    const budget = { nodes: 0 };
    const when = build(rule.when, budget), score = build(rule.score, budget);
    if (when.type !== 'boolean' || score.type !== 'number') fail('Rule requires boolean when and numeric score');
    const action = rule.action;
    if (!action || !Object.hasOwn(actionSchemas, action.type)) fail('Unregistered action');
    const schema = actionSchemas[action.type];
    fields(action, ['type', ...Object.keys(schema)]);
    const parameters = Object.entries(schema).map(([key, descriptor]) => {
      if (!Object.hasOwn(action, key)) fail('Missing action parameter');
      const value = action[key];
      if (descriptor.ref) {
        if (typeof value !== 'string' || !Object.hasOwn(registry, value) || registry[value].type !== descriptor.type) fail('Invalid typed action ref');
      } else assertFactValue(value, descriptor, key);
      return [key, descriptor, Array.isArray(value) ? Object.freeze([...value]) : value];
    });
    const actionType = action.type;
    return Object.freeze({ key: rule.key, version: rule.version, priority: rule.priority,
      cooldownMs: rule.cooldownSeconds * 1000, trigger: Object.freeze([...rule.trigger]),
      evaluate(values) {
        const facts = createFactSnapshot(registry, values);
        const condition = when.read(facts);
        if (condition !== true) return { eligible: false, reason: condition === MISSING ? 'missing_fact' : 'condition_false' };
        const utility = score.read(facts);
        if (utility === MISSING) return { eligible: false, reason: 'missing_score' };
        if (utility < 0 || utility > 100) fail('Score outside 0..100');
        const resolved = { type: actionType };
        for (const [key, descriptor, source] of parameters) {
          const value = descriptor.ref ? (Object.hasOwn(facts, source) ? facts[source] : MISSING) : source;
          if (value === MISSING) return { eligible: false, reason: 'missing_action_ref' };
          assertFactValue(value, descriptor, key);
          resolved[key] = value;
        }
        return { eligible: true, score: utility, action: Object.freeze(resolved) };
      } });
  }
  return Object.freeze({ registry, compileExpression, compileRule });
}

/** Stable persistent key; version upgrades do not reset the same action cooldown. */
export function cooldownKey({ worldId, actorId, ruleKey, targetKey = '' }) {
  for (const v of [worldId, actorId, ruleKey, targetKey]) if (typeof v !== 'string') fail('Cooldown identifiers must be strings');
  return JSON.stringify([worldId, actorId, ruleKey, targetKey]);
}

/**
 * Rules must come from compileRule. Cooldowns is a Map<cooldownKey,lastStartedUtcMs>.
 * Caller supplies a persisted decisionSequence and commits cooldownUpdate only
 * when ActionRunner successfully starts. blockedReason applies hard constraints.
 * Current action minimum duration wins until elapsed; switchPenalty reduces other
 * candidates' scores but never overrides a higher rule priority.
 */
export function selectTownCandidate({ rules, facts, worldId, actorId, decisionSequence,
  nowUtcMs, cooldowns = new Map(), targetKey = '', trigger = null, nearScore = 0,
  blockedReason = null, current = null, switchPenalty = 0 }) {
  assertUtcMs(nowUtcMs);
  if (!Number.isSafeInteger(decisionSequence) || decisionSequence < 0
    || !Number.isFinite(nearScore) || nearScore < 0 || nearScore > 100
    || !Number.isFinite(switchPenalty) || switchPenalty < 0 || switchPenalty > 100) fail('Invalid selector options');
  cooldownKey({ worldId, actorId, ruleKey: '', targetKey });
  if (!(cooldowns instanceof Map)) fail('cooldowns must be a Map');
  const sorted = [...rules].sort((a, b) => lexical(a.key, b.key));
  if (new Set(sorted.map(r => r.key)).size !== sorted.length) fail('Duplicate rule key');
  const seed = JSON.stringify([worldId, actorId, decisionSequence, sorted.map(r => [r.key, r.version])]);
  const rejected = [];
  if (blockedReason) return { selected: null, seed, reason: blockedReason, rejected };
  if (current) {
    assertUtcMs(current.startedAtUtcMs);
    if (typeof current.ruleKey !== 'string' || !Number.isSafeInteger(current.minDurationMs) || current.minDurationMs < 0) fail('Invalid current action');
    if (Math.max(0, nowUtcMs - current.startedAtUtcMs) < current.minDurationMs) {
      return { selected: null, seed, reason: 'minimum_duration', retainCurrent: true, rejected };
    }
  }
  const candidates = [];
  for (const rule of sorted) {
    const key = cooldownKey({ worldId, actorId, ruleKey: rule.key, targetKey });
    if (trigger !== null && !rule.trigger.includes(trigger)) { rejected.push({ key: rule.key, reason: 'trigger' }); continue; }
    if (cooldowns.has(key)) {
      const last = assertUtcMs(cooldowns.get(key));
      if (Math.max(0, nowUtcMs - last) < rule.cooldownMs) { rejected.push({ key: rule.key, reason: 'cooldown' }); continue; }
    }
    try {
      const result = rule.evaluate(facts);
      if (!result.eligible) { rejected.push({ key: rule.key, reason: result.reason }); continue; }
      candidates.push({ key: rule.key, version: rule.version, priority: rule.priority,
        score: Math.max(0, result.score - (current && current.ruleKey !== rule.key ? switchPenalty : 0)),
        action: result.action, cooldownKey: key });
    } catch (error) { rejected.push({ key: rule.key, reason: 'evaluation_error', detail: error.message }); }
  }
  candidates.sort((a, b) => b.priority - a.priority || b.score - a.score || lexical(a.key, b.key));
  if (!candidates.length) return { selected: null, seed, reason: 'no_candidate', rejected };
  const best = candidates[0];
  const pool = candidates.filter(c => c.priority === best.priority && best.score - c.score <= nearScore)
    .sort((a, b) => lexical(a.key, b.key));
  // SHA-derived seed + Mulberry32, independent of process PRNG and input ordering.
  let state = (createHash('sha256').update(seed).digest().readUInt32LE(0) + 0x6D2B79F5) | 0;
  state = Math.imul(state ^ state >>> 15, state | 1);
  state ^= state + Math.imul(state ^ state >>> 7, state | 61);
  const random = ((state ^ state >>> 14) >>> 0) / 4294967296;
  const selected = pool[Math.floor(random * pool.length)];
  return { selected, seed, reason: 'selected', rejected,
    cooldownUpdate: { key: selected.cooldownKey, lastStartedUtcMs: nowUtcMs } };
}
