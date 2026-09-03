/**
 * 角色外观系统数据层
 *
 * 两类外观来源：
 *   - global_outfits：通用限时服饰（如一套女仆装的 tag 组合）。character_id 为空 = 全员可见的
 *     全局服饰（可多套同时生效叠加）；指定角色 = 道具系统写入的该角色专属限时服饰。
 *     expires_at 为过期时间（空 = 永久生效），由 getActiveOutfits 惰性过滤。
 *   - character_outfits：角色专属外观/形态/装甲/衣服，在角色详情浮层配置；
 *     每个角色同时只启用一套（enabled=1 时同角色其余自动置 0）。道具的变身卡也会写入
 *     带 expires_at 的临时形态，到期由 itemScheduler 停用并恢复原形态。
 *
 * 生图注入优先级：限时服饰 > 角色专属形态 > 人物卡原本外观（见 characterPersona.js）。
 */

import { getDb } from '../db/index.js';

/**
 * 查询某角色当前生效的外观（统一注入入口唯一数据来源）。
 * 过期行惰性过滤：expires_at 为 SQLite UTC 时间，与 datetime('now') 同口径。
 * @param {number|string} characterId
 * @returns {{limited: Array<{id,name,description}>, exclusive: {id,name,description}|null}}
 */
export function getActiveOutfits(characterId) {
  if (!characterId) return { limited: [], exclusive: null };
  const db = getDb();
  const limited = db.prepare(
    `SELECT id, name, description FROM global_outfits
     WHERE enabled = 1
       AND (expires_at IS NULL OR expires_at > datetime('now'))
       AND (character_id IS NULL OR character_id = ?)
     ORDER BY id ASC`
  ).all(characterId);
  const exclusive = db.prepare(
    `SELECT id, name, description FROM character_outfits
     WHERE character_id = ? AND enabled = 1
       AND (expires_at IS NULL OR expires_at > datetime('now'))
     ORDER BY id ASC LIMIT 1`
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

// ── 道具来源的临时外观（由 itemService 写入、itemScheduler 清理） ──

/**
 * 写入一条道具来源的限时服饰（仅指定角色可见，到期后 getActiveOutfits 不再返回）。
 * @param {number|string} characterId
 * @param {{name: string, description: string, expiresAt: string}} param0 expiresAt 为 SQLite UTC 时间串
 * @returns {number} 新服饰行 id
 */
export function createTemporaryLimitedOutfit(characterId, { name, description, expiresAt }) {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO global_outfits (name, description, enabled, character_id, expires_at) VALUES (?, ?, 1, ?, ?)'
  ).run(name, description, characterId, expiresAt);
  return Number(result.lastInsertRowid);
}

/**
 * 写入一条道具来源的临时专属形态：按单套互斥规则顶掉当前启用形态。
 * @returns {{outfitId: number, previousOutfitId: number|null}} previousOutfitId 供到期恢复
 */
export function createTemporaryExclusiveOutfit(characterId, { name, description, expiresAt }) {
  const db = getDb();
  const prev = db.prepare(
    'SELECT id FROM character_outfits WHERE character_id = ? AND enabled = 1 ORDER BY id ASC LIMIT 1'
  ).get(characterId);
  db.prepare('UPDATE character_outfits SET enabled = 0 WHERE character_id = ?').run(characterId);
  const result = db.prepare(
    'INSERT INTO character_outfits (character_id, name, description, enabled, expires_at) VALUES (?, ?, ?, 1, ?)'
  ).run(characterId, name, description, expiresAt);
  return { outfitId: Number(result.lastInsertRowid), previousOutfitId: prev ? prev.id : null };
}

/** 列出已启用但已过期的临时专属形态（变身卡到期恢复用） */
export function listExpiredEnabledCharacterOutfits() {
  return getDb().prepare(
    `SELECT id, character_id FROM character_outfits
     WHERE enabled = 1 AND expires_at IS NOT NULL AND expires_at <= datetime('now')`
  ).all();
}

export function setCharacterOutfitEnabled(characterId, outfitId, enabled) {
  getDb().prepare(
    'UPDATE character_outfits SET enabled = ? WHERE id = ? AND character_id = ?'
  ).run(enabled ? 1 : 0, outfitId, characterId);
}

/** 删除已过期的道具限时服饰行（global_outfits 中带 character_id 的行），返回删除数 */
export function deleteExpiredItemLimitedOutfits() {
  const result = getDb().prepare(
    `DELETE FROM global_outfits
     WHERE character_id IS NOT NULL AND expires_at IS NOT NULL AND expires_at <= datetime('now')`
  ).run();
  return result.changes;
}
