/**
 * temporary_state 执行器与受约束状态档案目录（计划 §4.3、§12）。
 *
 * 状态档案是经过审核的固定目录：注入文本来自程序档案（itemService.ITEM_EFFECTS 的
 * buff effectText），不允许模型把任意长指令写成系统人格。状态只影响角色表达，
 * 不改好感、VAD、生活需求、记忆或关系，也不触发主动聊天。
 * 新增档案必须在此登记并补测试后才能进入目录。
 *
 * 落地方式与道具 buff 同构：item_effects 需要背包行作载体（listActiveEffects 联表
 * owner='me' AND status='used'），所以先写一条「已使用」的载体物品再挂效果；
 * 到期由既有 itemScheduler / 惰性过滤回收，不需要本功能自建清理器。
 */
import { townError } from '../townEventService.js';

/**
 * 受约束状态档案：effectKey 必须是 itemService.ITEM_EFFECTS 中真实存在的 buff 档案，
 * 注入文本直接复用其 effectText（经 getActiveBuffBlock 进入聊天人格组装）。
 */
export const STATE_PROFILES = Object.freeze({
  energy: { key: 'energy', label: '元气满满', effectKey: 'energy' },
  tsundere: { key: 'tsundere', label: '傲娇上头', effectKey: 'tsundere' },
  tipsy: { key: 'tipsy', label: '微醺', effectKey: 'tipsy' },
});

export function stateProfileKeys() { return Object.keys(STATE_PROFILES); }

export function getStateProfile(key) {
  return Object.prototype.hasOwnProperty.call(STATE_PROFILES, key) ? STATE_PROFILES[key] : null;
}

/** 供生成目录使用的精简档案（只暴露 key 与中性名称） */
export function stateProfileCatalog() {
  return Object.values(STATE_PROFILES).map(p => ({ key: p.key, label: p.label }));
}

function sqliteLater(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * 应用一项限时表达状态。同项（同档案、同名称的建筑来源状态）仍在生效时抛
 * EFFECT_ALREADY_ACTIVE，禁止收费重用（计划 §4.3）；不同名称的同档案建筑状态
 * 先到期（同槽位替换，避免叠行续时），道具来源的同类效果不受影响。
 * 返回载体物品与效果引用，供操作回执记录。
 */
export function applyTemporaryState(db, characterId, profileKey, { durationHours, label, sourceRef }) {
  const profile = getStateProfile(profileKey);
  if (!profile) throw townError('TARGET_UNSUPPORTED');
  const carrierName = label || profile.label;
  // 生效判定按载体名匹配（建筑状态载体的 name 即选项/签文名），道具效果同名概率可忽略
  const active = db.prepare(
    `SELECT e.id FROM item_effects e JOIN backpack_items i ON i.id = e.item_id
     WHERE e.character_id = ? AND e.effect_key = ? AND i.name = ?
       AND i.owner_key = 'me' AND i.status = 'used' AND i.source_type = 'feature_state'
       AND e.expires_at IS NOT NULL AND e.expires_at > datetime('now')
     ORDER BY e.id DESC LIMIT 1`
  ).get(characterId, profile.effectKey, carrierName);
  if (active) throw townError('EFFECT_ALREADY_ACTIVE');
  // 同档案换了名称：把本功能此前写入的该档案建筑状态提前到期（替换而非叠加）
  db.prepare(
    `UPDATE item_effects SET expires_at = datetime('now')
     WHERE character_id = ? AND effect_key = ? AND expires_at IS NOT NULL AND expires_at > datetime('now')
       AND item_id IN (SELECT id FROM backpack_items WHERE owner_key = 'me' AND status = 'used'
         AND source_type = 'feature_state')`
  ).run(characterId, profile.effectKey);
  const expiresAt = sqliteLater(durationHours);
  const carrier = db.prepare(
    `INSERT INTO backpack_items
     (effect_key, name, description, rarity, image_url, status, payload_json, owner_key, source_type,
      world_id, source_id, source_index, collected_at, acquired_at, used_at, version)
     VALUES (?, ?, ?, 'common', NULL, 'used', '{}', 'me', 'feature_state', NULL, ?, 0,
             datetime('now'), datetime('now'), datetime('now'), 1)`
  ).run(profile.effectKey, label || profile.label, `建筑功能授予的限时状态（${label || profile.label}）`, sourceRef);
  const carrierId = Number(carrier.lastInsertRowid);
  const result = db.prepare(
    `INSERT INTO item_effects (item_id, character_id, effect_key, payload_json, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(carrierId, characterId, profile.effectKey, JSON.stringify({ sourceRef }), expiresAt);
  return { effectId: Number(result.lastInsertRowid), itemId: carrierId, expiresAt };
}
