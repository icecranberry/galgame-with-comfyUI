export function migrateTtsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_samples (
      id TEXT PRIMARY KEY, original_path TEXT NOT NULL, preview_path TEXT NOT NULL,
      reference_path TEXT, content_hash TEXT, duration REAL NOT NULL,
      start_seconds REAL, end_seconds REAL, warnings TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS voices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, sample_id TEXT NOT NULL REFERENCES voice_samples(id),
      version INTEGER NOT NULL DEFAULT 1, language TEXT NOT NULL DEFAULT 'zh',
      speed REAL NOT NULL DEFAULT 1, notes TEXT NOT NULL DEFAULT '', transcript TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS character_voices (
      character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      voice_id TEXT NOT NULL REFERENCES voices(id), enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS speech_jobs (
      id TEXT PRIMARY KEY, cache_key TEXT NOT NULL, text TEXT NOT NULL,
      voice_id TEXT NOT NULL, voice_version INTEGER NOT NULL, sample_id TEXT NOT NULL REFERENCES voice_samples(id),
      model_version TEXT NOT NULL, params TEXT NOT NULL, status TEXT NOT NULL
        CHECK(status IN ('queued','generating','completed','failed','cancelled')),
      output_path TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_speech_cache ON speech_jobs(cache_key, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_speech_active_cache ON speech_jobs(cache_key)
      WHERE status IN ('queued','generating','completed');
    CREATE TABLE IF NOT EXISTS message_speech (
      message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL REFERENCES speech_jobs(id)
    );
  `);
}

export function recoverSpeechJobs(db) {
  db.prepare("UPDATE speech_jobs SET status='failed', error='服务重启，语音任务已中断，请重试', updated_at=CURRENT_TIMESTAMP WHERE status IN ('queued','generating')").run();
}
