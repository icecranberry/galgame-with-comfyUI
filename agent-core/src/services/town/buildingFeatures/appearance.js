/**
 * 外观四模板执行器：outfit_change / hairstyle_change / accessory_change / temporary_transform
 * （计划 §4.1、§12）。统一走 outfitService 的现有外观服务：
 *   - 服装/发型/配饰 → createTemporaryLimitedOutfit（global_outfits，到期惰性过滤）；
 *     三个槽位各自互斥：应用新项时把本功能此前写入的同槽位临时外观提前到期。
 *   - 形态 → createTemporaryExclusiveOutfit（character_outfits 单套互斥 + previousOutfitId
 *     恢复链），到期恢复复用 itemService.restoreExpiredTransforms 的既有机制。
 * 不覆盖 base_prompt、不清空非本功能持有的外观、到期恢复不需要 LLM。
 */
import { townError } from '../townEventService.js';
import {
  createTemporaryLimitedOutfit, createTemporaryExclusiveOutfit,
} from '../../outfitService.js';

/** 模板 → 冲突槽位（item_effects.effect_key 标记，便于查询本功能持有的生效外观） */
export const APPEARANCE_SLOTS = {
  outfit_change: 'building_outfit',
  hairstyle_change: 'building_hairstyle',
  accessory_change: 'building_accessory',
  temporary_transform: 'building_transform',
};

function sqliteLater(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/** 找到目标角色（必须是正式角色）；轻量 NPC 与玩家自身没有外观适配 */
export function resolveCharacterTarget(db, targetActorKeys) {
  if (!Array.isArray(targetActorKeys) || targetActorKeys.length !== 1) throw townError('INVALID_SELECTION');
  const match = /^char:([1-9]\d*)$/.exec(String(targetActorKeys[0] || ''));
  if (!match) throw townError('TARGET_UNSUPPORTED');
  const character = db.prepare('SELECT id, display_name FROM characters WHERE id = ?').get(Number(match[1]));
  if (!character) throw townError('TARGET_UNSUPPORTED');
  return { characterId: character.id, displayName: character.display_name };
}

/** 把本功能此前写入的同槽位生效外观提前到期（槽位互斥；不碰其他来源的外观） */
function expireSameSlot(db, characterId, slot) {
  // 形态走 item_effects 的 'transform' 效果键（复用 itemScheduler 到期恢复链），
  // 用 payload.buildingSlot 标记区分建筑来源，绝不碰道具变身的恢复链
  const effectKey = slot === 'building_transform' ? 'transform' : slot;
  const marker = slot === 'building_transform' ? '%"buildingSlot":"transform"%' : null;
  const rows = db.prepare(
    `SELECT e.id, e.payload_json FROM item_effects e JOIN backpack_items i ON i.id = e.item_id
     WHERE e.character_id = ? AND e.effect_key = ?
       ${marker ? 'AND e.payload_json LIKE ?' : "AND e.effect_key != 'transform'"}
       AND i.owner_key = 'me' AND i.status = 'used'
       AND e.expires_at IS NOT NULL AND e.expires_at > datetime('now')`)
    .all(...(marker ? [characterId, effectKey, marker] : [characterId, effectKey]));
  for (const row of rows) {
    const payload = JSON.parse(row.payload_json || '{}');
    if (slot === 'building_transform') {
      if (payload.outfitId) {
        db.prepare("UPDATE character_outfits SET expires_at = datetime('now') WHERE id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))")
          .run(payload.outfitId);
      }
    } else if (payload.outfitRowId) {
      db.prepare("UPDATE global_outfits SET expires_at = datetime('now') WHERE id = ? AND character_id = ?")
        .run(payload.outfitRowId, characterId);
    }
    db.prepare("UPDATE item_effects SET expires_at = datetime('now') WHERE id = ?").run(row.id);
  }
}

/**
 * 应用一项外观选项。同项（同槽位同选项 key）仍生效时抛 EFFECT_ALREADY_ACTIVE，
 * 不收费不续时（计划 §4.1「相同服务、相同选项仍生效时返回现有结果」）。
 */
export function applyAppearance(db, { templateId, option, durationHours, characterId, displayName, sourceRef, expireSlot = true }) {
  const slot = APPEARANCE_SLOTS[templateId];
  if (!slot) throw townError('TEMPLATE_UNAVAILABLE');
  // 形态在 item_effects 中必须用 'transform' 键（到期恢复链 restoreExpiredTransforms 只认它）
  const effectKey = slot === 'building_transform' ? 'transform' : slot;
  // 同项判定按选项 key：LIKE 以收尾引号定界，不会被「key 前缀相同」的其它选项误命中
  const existing = db.prepare(
    `SELECT e.id FROM item_effects e JOIN backpack_items i ON i.id = e.item_id
     WHERE e.character_id = ? AND e.effect_key = ? AND i.owner_key = 'me' AND i.status = 'used'
       AND e.payload_json LIKE ? AND e.expires_at IS NOT NULL AND e.expires_at > datetime('now')
     ORDER BY e.id DESC LIMIT 1`)
    .get(characterId, effectKey, `%"optionKey":"${option.key}"%`);
  if (existing) throw townError('EFFECT_ALREADY_ACTIVE');
  if (expireSlot) expireSameSlot(db, characterId, slot);
  const expiresAt = sqliteLater(durationHours);
  let effectPayload;
  if (slot === 'building_transform') {
    // 恢复链修正：previousOutfitId 指向被顶掉形态的「原始形态」，避免到期恢复出上一副临时形态
    let previousOutfitId = null;
    const prev = db.prepare(
      'SELECT id FROM character_outfits WHERE character_id = ? AND enabled = 1 ORDER BY id ASC LIMIT 1').get(characterId);
    if (prev) {
      previousOutfitId = prev.id;
      // 精确比较 payload.outfitId === prev.id（LIKE 前缀会误命中 outfitId:1 与 12/123）
      const candidates = db.prepare(
        `SELECT payload_json FROM item_effects WHERE character_id = ? AND effect_key = 'transform'
           AND payload_json LIKE '%"outfitId"%' ORDER BY id DESC`).all(characterId);
      const prevPayload = candidates.map(row => JSON.parse(row.payload_json || '{}'))
        .find(payload => payload.outfitId === prev.id) || null;
      if (prevPayload?.previousOutfitId != null) previousOutfitId = prevPayload.previousOutfitId;
    }
    const { outfitId } = createTemporaryExclusiveOutfit(characterId,
      { name: option.label, description: option.appearance, expiresAt });
    effectPayload = { outfitId, previousOutfitId, buildingSlot: 'transform', optionKey: option.key };
  } else {
    const outfitRowId = createTemporaryLimitedOutfit(characterId,
      { name: option.label, description: option.appearance, expiresAt });
    effectPayload = { outfitRowId, optionKey: option.key };
  }
  // 载体物品与道具使用同构（status='used'，不进背包列表），effect_key 承担槽位语义
  const carrier = db.prepare(
    `INSERT INTO backpack_items
     (effect_key, name, description, rarity, image_url, status, payload_json, owner_key, source_type,
      world_id, source_id, source_index, collected_at, acquired_at, used_at, version)
     VALUES (?, ?, ?, 'common', NULL, 'used', '{}', 'me', 'feature_appearance', NULL, ?, 0,
             datetime('now'), datetime('now'), datetime('now'), 1)`
  ).run(effectKey, option.label, `${displayName} 的限时外观（${option.label}）`, sourceRef);
  const carrierId = Number(carrier.lastInsertRowid);
  const effect = db.prepare(
    `INSERT INTO item_effects (item_id, character_id, effect_key, payload_json, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(carrierId, characterId, effectKey, JSON.stringify(effectPayload), expiresAt);
  return { effectId: Number(effect.lastInsertRowid), itemId: carrierId, slot, expiresAt };
}

export { expireSameSlot };
