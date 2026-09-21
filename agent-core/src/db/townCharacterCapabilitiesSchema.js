/**
 * 入住角色的职能权限（打工 / 服务 / 交易）。
 *
 * 单独建表而不是往 town_characters 加列：配职能不该动入住状态，
 * 表里没有行 = 角色没单独配过，运行时回退到关联居民的权限。
 * Requires the characters table first.
 */
export function migrateTownCharacterCapabilitiesSchema(db) {
  return db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS town_character_capabilities (
        character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        capabilities_json TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    return { version: 1 };
  }).immediate();
}