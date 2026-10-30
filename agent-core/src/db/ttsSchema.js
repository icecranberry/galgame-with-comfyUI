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
    CREATE TABLE IF NOT EXISTS character_api_voices (
      character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      params TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS api_voice_samples (
      id TEXT PRIMARY KEY, character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      name TEXT NOT NULL, original_path TEXT NOT NULL, preview_path TEXT NOT NULL,
      content_hash TEXT NOT NULL, duration REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS api_voice_clones (
      id TEXT PRIMARY KEY, sample_id TEXT NOT NULL REFERENCES api_voice_samples(id) ON DELETE CASCADE,
      name TEXT NOT NULL, transcript TEXT NOT NULL, voice TEXT NOT NULL,
      endpoint TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS speech_jobs (
      id TEXT PRIMARY KEY, cache_key TEXT NOT NULL, text TEXT NOT NULL,
      voice_id TEXT NOT NULL, voice_version INTEGER NOT NULL, sample_id TEXT REFERENCES voice_samples(id),
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
  for (const [name, declaration] of [['source', "TEXT NOT NULL DEFAULT 'upload'"], ['transcript', "TEXT NOT NULL DEFAULT ''"]]) {
    if (!db.prepare('PRAGMA table_info(api_voice_samples)').all().some(c => c.name === name)) db.exec(`ALTER TABLE api_voice_samples ADD COLUMN ${name} ${declaration}`);
  }
  // API synthesis has no reference sample. Rebuild without changing job IDs or
  // message bindings; the old local voices and their assets are left intact.
  if (db.prepare('PRAGMA table_info(speech_jobs)').all().find(c => c.name === 'sample_id')?.notnull) {
    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(`CREATE TABLE speech_jobs_new (
          id TEXT PRIMARY KEY, cache_key TEXT NOT NULL, text TEXT NOT NULL,
          voice_id TEXT NOT NULL, voice_version INTEGER NOT NULL, sample_id TEXT REFERENCES voice_samples(id),
          model_version TEXT NOT NULL, params TEXT NOT NULL, status TEXT NOT NULL
            CHECK(status IN ('queued','generating','completed','failed','cancelled')),
          output_path TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO speech_jobs_new SELECT * FROM speech_jobs;
        DROP TABLE speech_jobs;
        ALTER TABLE speech_jobs_new RENAME TO speech_jobs;
        CREATE INDEX idx_speech_cache ON speech_jobs(cache_key, created_at);
        CREATE UNIQUE INDEX idx_speech_active_cache ON speech_jobs(cache_key)
          WHERE status IN ('queued','generating','completed');`);
        // Check the rebuilt table and its inbound message links only. Existing
        // orphaned rows in unrelated modules must not block this migration.
        for (const table of ['speech_jobs', 'message_speech']) {
          if (db.pragma(`foreign_key_check(${table})`).length) {
            throw new Error(`语音数据库迁移完整性检查失败：${table}`);
          }
        }
      })();
    } finally { if (foreignKeys) db.pragma('foreign_keys = ON'); }
  }
  if (!db.prepare('PRAGMA table_info(voices)').all().some(column => column.name === 'generation_params')) {
    db.exec("ALTER TABLE voices ADD COLUMN generation_params TEXT NOT NULL DEFAULT '{}'");
  }
  if (!db.prepare('PRAGMA table_info(voice_samples)').all().some(column => column.name === 'base_sample_id')) {
    db.exec('ALTER TABLE voice_samples ADD COLUMN base_sample_id TEXT REFERENCES voice_samples(id)');
  }
  if (!db.prepare('PRAGMA table_info(voices)').all().some(column => column.name === 'voice_effects')) {
    db.exec("ALTER TABLE voices ADD COLUMN voice_effects TEXT NOT NULL DEFAULT '{}'");
  }
  if (!db.prepare('PRAGMA table_info(voices)').all().some(column => column.name === 'character_id')) {
    db.transaction(() => {
      db.exec('ALTER TABLE voices ADD COLUMN character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL');
      const characters = db.prepare('SELECT * FROM characters').all();
      const bindings = db.prepare('SELECT character_id FROM character_voices WHERE voice_id=? ORDER BY character_id');
      const assign = db.prepare('UPDATE voices SET character_id=? WHERE id=?');
      for (const voice of db.prepare('SELECT id,name FROM voices').all()) {
        // Legacy assets did not retain their creator. Recover the default name's
        // unique owner, otherwise retain the existing binding. Ambiguous unused
        // assets stay in the management library, never in a character's picker.
        const named = characters.filter(character => [character.display_name, character.name].some(name =>
          name && voice.name.startsWith(`${name} · `)));
        const owner = named.length === 1 ? named[0].id : bindings.all(voice.id)[0]?.character_id;
        if (owner) assign.run(owner, voice.id);
      }
      db.exec(`DELETE FROM character_voices WHERE NOT EXISTS (
        SELECT 1 FROM voices v WHERE v.id=character_voices.voice_id AND v.character_id=character_voices.character_id
      )`);
    })();
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_voices_character ON voices(character_id, created_at)');
  // Every character with saved voices has a current voice; no separate setup step.
  db.exec(`INSERT INTO character_voices(character_id,voice_id,enabled)
    SELECT c.id,(SELECT v.id FROM voices v WHERE v.character_id=c.id ORDER BY v.created_at DESC,v.rowid DESC LIMIT 1),1
    FROM characters c WHERE EXISTS (SELECT 1 FROM voices v WHERE v.character_id=c.id)
      AND NOT EXISTS (SELECT 1 FROM character_voices cv WHERE cv.character_id=c.id)`);
}

export function recoverSpeechJobs(db) {
  db.prepare("UPDATE speech_jobs SET status='failed', error='服务重启，语音任务已中断，请重试', updated_at=CURRENT_TIMESTAMP WHERE status IN ('queued','generating')").run();
}
