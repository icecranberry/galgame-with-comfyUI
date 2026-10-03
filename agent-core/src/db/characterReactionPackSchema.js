/**
 * 角色操作反馈 —— 短句包（M2）表结构。
 *
 * 一个角色最多一份有效短句包：保存完整 JSON、协议版本、人格指纹与来源。
 * 不保存行为流水（见计划书 §7.3 / §8.2）。
 */

export function migrateCharacterReactionPacksSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_reaction_packs (
      character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      schema_version INTEGER NOT NULL DEFAULT 1,
      pack_json TEXT NOT NULL,
      persona_fingerprint TEXT NOT NULL DEFAULT '',
      prompt_template_version TEXT NOT NULL DEFAULT '',
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('[db] character_reaction_packs schema ensured');
}
