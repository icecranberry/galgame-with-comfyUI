/**
 * 角色日记表结构。
 *
 * 一个角色每个自然日最多一篇日记（UNIQUE(character_id, diary_date)）：
 * 同一天多次生成走 INSERT ... ON CONFLICT DO UPDATE 覆盖，历史日期行原样保留，
 * 供日记本里往前翻阅。
 *
 * 图片：images 是 URL 数组（口径同 moments/mailbox），resolutions 同步保存每张图的
 * "WxH"（朋友圈参数下横竖随机，逐图不同，重绘时要能还原）。
 */

export function migrateCharacterDiarySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_diaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      diary_date TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      mood TEXT NOT NULL DEFAULT '',
      weather TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      images TEXT NOT NULL DEFAULT '[]',
      image_prompts TEXT NOT NULL DEFAULT '[]',
      resolutions TEXT NOT NULL DEFAULT '[]',
      handwriting_font TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','generating','completed','failed')),
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(character_id, diary_date)
    );
    CREATE INDEX IF NOT EXISTS idx_character_diaries_char ON character_diaries(character_id, diary_date DESC);
  `);
  console.log('[db] character_diaries schema ensured');
}
