const studioJobColumns = `
    id TEXT PRIMARY KEY, character_id INTEGER, character2_id INTEGER, pose_id TEXT NOT NULL,
    character_kind TEXT NOT NULL DEFAULT 'resident', character2_kind TEXT NOT NULL DEFAULT 'resident', background_id TEXT NOT NULL DEFAULT '',
    character_name TEXT NOT NULL, character2_name TEXT, pose_name TEXT NOT NULL,
    image_task_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running',
    progress REAL NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT 'preparing',
    prompt TEXT NOT NULL, width INTEGER, height INTEGER,
    output_url TEXT, error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT`;

export function migratePhotoStudioSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS photo_studio_jobs (${studioJobColumns});`);

  const existing = new Set(db.prepare('PRAGMA table_info(photo_studio_jobs)').all().map(column => column.name));
  const additions = {
    character2_id: 'INTEGER',
    character2_name: 'TEXT',
    width: 'INTEGER',
    height: 'INTEGER',
    character_kind: "TEXT NOT NULL DEFAULT 'resident'",
    character2_kind: "TEXT NOT NULL DEFAULT 'resident'",
    background_id: "TEXT NOT NULL DEFAULT ''",
  };
  for (const [column, definition] of Object.entries(additions)) {
    if (!existing.has(column)) db.exec(`ALTER TABLE photo_studio_jobs ADD COLUMN ${column} ${definition}`);
  }
  // 天使没有居民编号；升级旧表以允许 NULL，保留所有历史任务、rowid 与排序。
  if (db.prepare('PRAGMA table_info(photo_studio_jobs)').all().find(column => column.name === 'character_id')?.notnull) {
    db.transaction(() => {
      const columns = db.prepare('PRAGMA table_info(photo_studio_jobs)').all().map(column => column.name).join(',');
      db.exec(`CREATE TABLE photo_studio_jobs_upgrade (${studioJobColumns});
        INSERT INTO photo_studio_jobs_upgrade (rowid,${columns}) SELECT rowid,${columns} FROM photo_studio_jobs;
        DROP TABLE photo_studio_jobs;
        ALTER TABLE photo_studio_jobs_upgrade RENAME TO photo_studio_jobs;`);
    })();
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_photo_studio_created ON photo_studio_jobs(created_at)');
}
