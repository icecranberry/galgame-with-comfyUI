import { townError } from './townEventService.js';

// These are permissions, not professions or shop catalogue kinds. They are nonexclusive.
// `service` = NPC 出面服务，玩家付钱；`trade` = 开店卖货；`work` = 玩家出力帮 NPC 干活，NPC 付钱。
export const TOWN_CAPABILITIES = Object.freeze(['service', 'trade', 'work']);
// 打工只给「有具体活可干」的岗位，免得掌柜 / 先生这类只动嘴的角色也冒出打工入口。
const TOWN_WORK_JOB_PATTERN = /学徒|帮工|杂役|跑腿|搬运|苦力|矿工|渔夫|农夫|农妇|佃农|庄稼|耕作|樵夫|马夫|仆役|侍从|伙计|小二|打杂|园丁|花匠|木工|铁匠|工匠|匠人|织|磨坊|厨|洗衣|洒扫|挑水|护院|更夫|船夫|车夫/;
export function normalizeTownCapabilities(value) {
  if (!Array.isArray(value) || !value.length || value.some(type => !TOWN_CAPABILITIES.includes(type))) {
    throw townError('INVALID_TOWN_CAPABILITIES');
  }
  return TOWN_CAPABILITIES.filter(type => value.includes(type));
}
export function defaultTownCapabilities(kind, job = '') {
  if (['clothing_shop', 'tavern', 'workshop'].includes(kind)) return withWorkPermission(['service', 'trade'], job);
  if (kind === 'supplier' || ((!kind || kind === 'none') && /商|杂货|货郎|售货|卖货|摊主/.test(job))) return withWorkPermission(['trade'], job);
  return withWorkPermission(['service'], job);
}
export function shouldHaveWorkPermission(job) {
  return TOWN_WORK_JOB_PATTERN.test(String(job || ''));
}
function withWorkPermission(list, job) {
  return shouldHaveWorkPermission(job) ? [...list, 'work'] : list;
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
/** 给已有 NPC 补授权限（仅非手工维护的档案）。
 * capabilities_explicit 的权限由玩家手工定，永远不被自动改写。
 * 已含全部 extra 或无法解析时返回 null，不写入。 */
export function upgradeTownNpcCapabilities(db, npc, extra = []) {
  if (!npc || npc.id == null || !extra.length) return null;
  if (npc.capabilities_explicit) return null;
  if (npc.capabilities_json == null) return null;
  let current;
  try { current = normalizeTownCapabilities(JSON.parse(npc.capabilities_json)); }
  catch { return null; } // 坏数据不猜，保持原样。
  const merged = normalizeTownCapabilities([...current, ...extra]);
  if (merged.length === current.length) return null;
  npc.capabilities_json = JSON.stringify(merged);
  db.prepare('UPDATE town_npcs SET capabilities_json=? WHERE id=?').run(npc.capabilities_json, npc.id);
  return merged;
}
export function capabilityForTownService(serviceKey) {
  return /\.(buy_ready|buy_meal)$/.test(serviceKey || '') ? 'trade' : 'service';
}


/**
 * 入住角色显式配置的职能权限。
 * 没配置、空数组或坏数据都返回 null，由调用方回退（关联居民、再到默认值）。
 * 免得一份坏档案把角色锁成「什么都不能做」。
 */
export function parseCharacterCapabilities(raw) {
  if (raw == null) return null;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) && value.length ? normalizeTownCapabilities(value) : null;
  } catch { return null; }
}

export function readCharacterCapabilities(db, characterId) {
  if (characterId == null) return null;
  const row = db.prepare('SELECT capabilities_json FROM town_character_capabilities WHERE character_id = ?').get(characterId);
  return parseCharacterCapabilities(row?.capabilities_json ?? null);
}

/**
 * 写入入住角色的职能权限（至少一项，否则抛 INVALID_TOWN_CAPABILITIES）。
 * 只动职能表，不碰 town_characters：配职能不该改变角色的入住状态。
 */
export function setCharacterCapabilities(db, characterId, capabilities) {
  const list = normalizeTownCapabilities(capabilities);
  db.prepare(`INSERT INTO town_character_capabilities (character_id, capabilities_json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(character_id) DO UPDATE SET capabilities_json = excluded.capabilities_json,
      updated_at = CURRENT_TIMESTAMP`).run(characterId, JSON.stringify(list));
  return list;
}