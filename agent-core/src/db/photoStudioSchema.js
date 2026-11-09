export function migratePhotoStudioSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS photo_studio_jobs (
    id TEXT PRIMARY KEY, character_id INTEGER NOT NULL, character2_id INTEGER, pose_id TEXT NOT NULL,
    character_name TEXT NOT NULL, character2_name TEXT, pose_name TEXT NOT NULL,
    image_task_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running',
    progress REAL NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT 'preparing',
    prompt TEXT NOT NULL, width INTEGER, height INTEGER,
    output_url TEXT, error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_photo_studio_created ON photo_studio_jobs(created_at);`);

  const existing = new Set(db.prepare('PRAGMA table_info(photo_studio_jobs)').all().map(column => column.name));
  const additions = {
    character2_id: 'INTEGER',
    character2_name: 'TEXT',
    width: 'INTEGER',
    height: 'INTEGER',
  };
  for (const [column, definition] of Object.entries(additions)) {
    if (!existing.has(column)) db.exec(`ALTER TABLE photo_studio_jobs ADD COLUMN ${column} ${definition}`);
  }
}
