/**
 * 角色外观系统数据层
 *
 * 两类外观来源：
 *   - global_outfits：通用限时服饰（如一套女仆装的 tag 组合），不属于任何角色，谁都能用，
 *     可多套同时生效叠加。注入数据库的管理方式暂未定，本期只建表 + 读取（enabled 即生效条件，
 *     condition_json 预留未来更复杂的注入条件：时间范围/触发指令等，当前不解析）。
 *   - character_outfits：角色专属外观/形态/装甲/衣服，在角色详情浮层配置；
 *     每个角色同时只启用一套（enabled=1 时同角色其余自动置 0）。
 *
 * 生图注入优先级：限时服饰 > 角色专属形态 > 人物卡原本外观（见 characterPersona.js）。
 */

import { getDb } from '../db/index.js';

/**
 * 查询某角色当前生效的外观（统一注入入口唯一数据来源）。
 * @param {number|string} characterId
 * @returns {{limited: Array<{id,name,description}>, exclusive: {id,name,description}|null}}
 */
export function getActiveOutfits(characterId) {
  if (!characterId) return { limited: [], exclusive: null };
  const db = getDb();
  const limited = db.prepare(
    'SELECT id, name, description FROM global_outfits WHERE enabled = 1 ORDER BY id ASC'
  ).all();
  const exclusive = db.prepare(
    'SELECT id, name, description FROM character_outfits WHERE character_id = ? AND enabled = 1 ORDER BY id ASC LIMIT 1'
  ).get(characterId) || null;
  return { limited, exclusive };
}

export function listCharacterOutfits(characterId) {
  return getDb().prepare(
    'SELECT id, name, description, enabled, created_at FROM character_outfits WHERE character_id = ? ORDER BY id ASC'
  ).all(characterId);
}

export function createCharacterOutfit(characterId, { name, description }) {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO character_outfits (character_id, name, description) VALUES (?, ?, ?)'
  ).run(characterId, name, description);
  return db.prepare('SELECT * FROM character_outfits WHERE id = ?').get(result.lastInsertRowid);
}

/**
 * 更新专属外观；enabled 置 1 时同角色其余外观自动取消启用（单套互斥）。
 */
export function updateCharacterOutfit(characterId, outfitId, { name, description, enabled } = {}) {
  const db = getDb();
  const outfit = db.prepare(
    'SELECT * FROM character_outfits WHERE id = ? AND character_id = ?'
  ).get(outfitId, characterId);
  if (!outfit) return null;

  const nextName = name !== undefined ? name : outfit.name;
  const nextDesc = description !== undefined ? description : outfit.description;
  const nextEnabled = enabled !== undefined ? (enabled ? 1 : 0) : outfit.enabled;
  if (nextEnabled) {
    db.prepare('UPDATE character_outfits SET enabled = 0 WHERE character_id = ? AND id != ?')
      .run(characterId, outfitId);
  }
  db.prepare('UPDATE character_outfits SET name = ?, description = ?, enabled = ? WHERE id = ?')
    .run(nextName, nextDesc, nextEnabled, outfitId);
  return db.prepare('SELECT * FROM character_outfits WHERE id = ?').get(outfitId);
}

export function deleteCharacterOutfit(characterId, outfitId) {
  const result = getDb().prepare(
    'DELETE FROM character_outfits WHERE id = ? AND character_id = ?'
  ).run(outfitId, characterId);
  return result.changes > 0;
}
