/** Flat, explicitly registered fact names; never traverse objects by dotted path. */
export const MISSING = Symbol('missing town fact');
const TYPES = new Set(['number', 'string', 'boolean', 'number[]', 'string[]', 'boolean[]']);
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

export function assertRefName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/.test(name)
    || name.split('.').some(part => FORBIDDEN.has(part))) throw new TypeError('Invalid ref name');
}

/** Descriptors: {type, min?, max?, values?, unit?}; ranges apply to array elements too. */
export function createFactRegistry(definitions) {
  const registry = Object.create(null);
  for (const [name, descriptor] of Object.entries(definitions)) {
    assertRefName(name);
    if (!descriptor || !TYPES.has(descriptor.type)) throw new TypeError(`Invalid type: ${name}`);
    if (Object.keys(descriptor).some(k => !['type', 'min', 'max', 'values', 'unit'].includes(k))) throw new TypeError(`Unknown descriptor field: ${name}`);
    const numeric = descriptor.type.replace('[]', '') === 'number';
    for (const bound of ['min', 'max']) {
      if (descriptor[bound] !== undefined && (!numeric || !Number.isFinite(descriptor[bound]))) throw new TypeError(`Invalid bound: ${name}`);
    }
    if (descriptor.min > descriptor.max) throw new TypeError(`Inverted range: ${name}`);
    if (descriptor.unit !== undefined && typeof descriptor.unit !== 'string') throw new TypeError(`Invalid unit: ${name}`);
    if (descriptor.values !== undefined && (!Array.isArray(descriptor.values) || !descriptor.values.length)) throw new TypeError(`Invalid domain: ${name}`);
    const copy = { ...descriptor };
    if (copy.values) {
      for (const value of copy.values) assertFactValue(value, { type: copy.type.replace('[]', ''), min: copy.min, max: copy.max }, name);
      copy.values = Object.freeze([...copy.values]);
    }
    registry[name] = Object.freeze(copy);
  }
  return Object.freeze(registry);
}

export function assertFactValue(value, descriptor, name = 'value') {
  const array = descriptor.type.endsWith('[]');
  const type = descriptor.type.replace('[]', '');
  if (array && !Array.isArray(value)) throw new TypeError(`Invalid fact: ${name}`);
  for (const item of array ? value : [value]) {
    if (typeof item !== type || (type === 'number' && (!Number.isFinite(item)
      || (descriptor.min !== undefined && item < descriptor.min)
      || (descriptor.max !== undefined && item > descriptor.max)))
      || (descriptor.values && !descriptor.values.includes(item))) throw new TypeError(`Invalid fact: ${name}`);
  }
}

/** Null/undefined means absent; all other supplied values must match the registry.
 * The caller batch-loads authoritative facts; no DB, text inference, or getters.
 */
export function createFactSnapshot(registry, values) {
  const result = Object.create(null);
  for (const name of Object.keys(values)) {
    if (!Object.hasOwn(registry, name)) throw new TypeError(`Unknown fact: ${name}`);
    const property = Object.getOwnPropertyDescriptor(values, name);
    if (!Object.hasOwn(property, 'value')) throw new TypeError('Fact getters are forbidden');
    const value = property.value;
    if (value === null || value === undefined) continue;
    assertFactValue(value, registry[name], name);
    result[name] = Array.isArray(value) ? Object.freeze([...value]) : value;
  }
  return Object.freeze(result);
}
