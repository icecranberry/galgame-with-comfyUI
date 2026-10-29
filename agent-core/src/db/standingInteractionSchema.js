export function migrateStandingInteractions(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_standing_touch_lines (
      character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'generating',
      lines_json TEXT,
      error TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS character_standing_interactions (
      character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      config_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS standing_touch_speech (
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      part TEXT NOT NULL,
      line_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      voice_key TEXT NOT NULL,
      job_id TEXT,
      previous_job_id TEXT,
      error TEXT,
      PRIMARY KEY (character_id, part, line_index)
    );
    CREATE INDEX IF NOT EXISTS idx_standing_touch_speech_job ON standing_touch_speech(job_id);
    CREATE TABLE IF NOT EXISTS standing_interaction_regions (
      character_id INTEGER NOT NULL,
      slot_id TEXT NOT NULL,
      image_version INTEGER NOT NULL,
      regions_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (character_id, slot_id),
      FOREIGN KEY (character_id, slot_id) REFERENCES character_expression_standings(character_id, slot_id) ON DELETE CASCADE
    );
  `);
  db.prepare("UPDATE character_standing_touch_lines SET status='failed', error='服务重启，台词生成中断；下次生成整套立绘时重试' WHERE status='generating'").run();
}
