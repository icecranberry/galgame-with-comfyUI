/**
 * 酒馆角色的「托管居民档案」标记。
 *
 * character_managed = 1 的 town_npcs 行是为角色挂服务 / 打工 / 货架而建的影子档案：
 * 不进居民名单、不参与岗位分配、不发朋友圈，角色删除时一并清理。
 * Requires the town schema (town_npcs) first.
 */
export function migrateTownCharacterProfileSchema(db) {
  return db.transaction(() => {
    const columns = new Set(db.prepare('PRAGMA table_info(town_npcs)').all().map(r => r.name));
    if (!columns.has('id')) throw new Error('Incompatible town_npcs schema');
    if (!columns.has('character_managed')) {
      db.exec('ALTER TABLE town_npcs ADD COLUMN character_managed INTEGER NOT NULL DEFAULT 0');
    }
    return { version: 1 };
  }).immediate();
}