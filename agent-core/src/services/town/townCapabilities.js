import { townError } from './townEventService.js';

// These are permissions, not professions or shop catalogue kinds. They are nonexclusive.
export const TOWN_CAPABILITIES = Object.freeze(['service', 'trade']);
export function normalizeTownCapabilities(value) {
  if (!Array.isArray(value) || !value.length || value.some(type => !TOWN_CAPABILITIES.includes(type))) {
    throw townError('INVALID_TOWN_CAPABILITIES');
  }
  return TOWN_CAPABILITIES.filter(type => value.includes(type));
}
export function defaultTownCapabilities(kind, job = '') {
  if (['clothing_shop', 'tavern', 'workshop'].includes(kind)) return ['service', 'trade'];
  if (kind === 'supplier' || ((!kind || kind === 'none') && /商|杂货|货郎|售货|卖货|摊主/.test(job))) return ['trade'];
  return ['service'];
}
export function townCapabilities(entity = {}, defaults = ['service']) {
  const explicit = entity.capabilities ?? entity.meta?.capabilities;
  if (explicit !== undefined) return normalizeTownCapabilities(explicit);
  if (entity.capabilities_json != null) {
    try { return normalizeTownCapabilities(JSON.parse(entity.capabilities_json)); }
    catch { return []; } // Corrupt saved permissions fail closed.
  }
  return [...defaults];
}
export function ensureTownCapabilities(db, table, entity, defaults) {
  if (!['town_npcs', 'town_locations'].includes(table)) throw new Error('Invalid capability owner');
  const capabilities = townCapabilities(entity, defaults);
  if (entity.capabilities_json == null) {
    entity.capabilities_json = JSON.stringify(capabilities);
    db.prepare(`UPDATE ${table} SET capabilities_json=? WHERE id=?`).run(entity.capabilities_json, entity.id);
  }
  return capabilities;
}
export function capabilityForTownService(serviceKey) {
  return /\.(buy_ready|buy_meal)$/.test(serviceKey || '') ? 'trade' : 'service';
}
