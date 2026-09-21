import { townError } from './townEventService.js';
import { townCapabilities, defaultTownCapabilities, ensureTownCapabilities, readCharacterCapabilities } from './townCapabilities.js';
import { inferTownBusinessKind } from './townResponsibilityDefinitions.js';

export function resolveTownInteractionTarget(context, target) {
  const { db, registry, scope, player } = context;
  const building = typeof target === 'string' && target.startsWith('location:');
  const location = building ? db.prepare('SELECT * FROM town_locations WHERE key=?').get(target.slice(9)) : null;
  if (building && !location) throw townError('LOCATION_NOT_FOUND');
  let actor = building ? null : registry.resolveAgentKey(target);
  if (building) {
    const employee = db.prepare('SELECT id FROM town_npcs WHERE map_id=? AND workplace_key=? AND town_enabled=1 ORDER BY id LIMIT 1').get(location.map_id, location.key);
    actor = employee ? registry.resolveAgentKey(`npc:${employee.id}`) : null;
  }
  if (!building && (!actor?.participating || actor.archived || actor.mergedInto)) throw townError('ACTOR_UNAVAILABLE');
  if (building && actor && (!actor.participating || actor.archived || actor.mergedInto)) actor = null;
  const npc = actor?.npcId ? db.prepare('SELECT * FROM town_npcs WHERE id=?').get(actor.npcId) : null;
  // 建筑档案直接来自地点本身；kind 是服务线索目录的键。
  const venue = building ? { businessKey: location.key, kind: location.business_kind,
    locationKey: location.key, actorId: actor?.actorId ?? null } : null;
  // 入住角色可以单独定职能（打工 / 服务 / 交易）：角色自己配过就以角色为准，
  // 没配过才回退到关联居民的权限，再回退到默认（服务）。
  const ownCapabilities = !building && actor?.characterId ? readCharacterCapabilities(db, actor.characterId) : null;
  let capabilities;
  if (building) capabilities = ensureTownCapabilities(db, 'town_locations', location, defaultTownCapabilities(location.business_kind));
  else capabilities = ownCapabilities ?? (npc
    ? ensureTownCapabilities(db, 'town_npcs', npc, defaultTownCapabilities(inferTownBusinessKind(npc.job), npc.job))
    : defaultTownCapabilities(null));
  const name = building ? location.name : npc?.display_name
    || (actor?.characterId && db.prepare('SELECT display_name FROM characters WHERE id=?').get(actor.characterId)?.display_name) || '邻居';
  return { building, location, venue, npc, capabilities, name, actor,
    locationKey: location?.key || null,
    // An unstaffed location may still introduce a story. Source identity is persisted separately.
    input: { ...scope, actorId: actor?.actorId || player.actorId, playerActorId: player.actorId,
      ...(building ? { sourceKey: target, sourceLocationKey: location.key } : {}) } };
}

export function sourceTradeCapabilities(db, npc, input) {
  if (!input.sourceLocationKey) return ensureTownCapabilities(db, 'town_npcs', npc,
    defaultTownCapabilities(inferTownBusinessKind(npc.job), npc.job));
  const location = db.prepare('SELECT * FROM town_locations WHERE key=?').get(input.sourceLocationKey);
  if (!location || location.map_id !== npc.map_id || npc.workplace_key !== location.key) throw townError('NOT_A_TRADER');
  return townCapabilities(location, defaultTownCapabilities(location.business_kind));
}
