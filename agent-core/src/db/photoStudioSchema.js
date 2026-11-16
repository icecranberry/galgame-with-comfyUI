const studioJobColumns = `
    id TEXT PRIMARY KEY, character_id INTEGER, character2_id INTEGER, pose_id TEXT NOT NULL,
    character_kind TEXT NOT NULL DEFAULT 'resident', character2_kind TEXT NOT NULL DEFAULT 'resident', background_id TEXT NOT NULL DEFAULT '',
    character_name TEXT NOT NULL, character2_name TEXT, pose_name TEXT NOT NULL,
    image_task_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running',
    progress REAL NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT 'preparing',
    prompt TEXT NOT NULL, width INTEGER, height INTEGER,
    output_url TEXT, error TEXT, finish_recipe TEXT, finish_error TEXT, batch_id TEXT, batch_index INTEGER,
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
    finish_recipe: 'TEXT',
    finish_error: 'TEXT',
    batch_id: 'TEXT',
    batch_index: 'INTEGER',
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
  db.exec(`CREATE TABLE IF NOT EXISTS photo_studio_batches (
    id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'running', total INTEGER NOT NULL CHECK(total BETWEEN 1 AND 10),
    input_json TEXT NOT NULL, finish_recipe TEXT, next_index INTEGER NOT NULL DEFAULT 0,
    current_job_id TEXT, error TEXT, revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_studio_active_batch ON photo_studio_batches((1)) WHERE status IN ('running','stopping');
  CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_studio_batch_shot ON photo_studio_jobs(batch_id,batch_index) WHERE batch_id IS NOT NULL;`);
  db.exec(`CREATE TABLE IF NOT EXISTS photo_studio_finishes (
    job_id TEXT PRIMARY KEY REFERENCES photo_studio_jobs(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL, output_url TEXT NOT NULL, recipe TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const finishColumns = new Set(db.prepare('PRAGMA table_info(photo_studio_finishes)').all().map(column => column.name));
  for (const column of ['width', 'height']) {
    if (!finishColumns.has(column)) db.exec(`ALTER TABLE photo_studio_finishes ADD COLUMN ${column} INTEGER`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS photo_studio_finish_defaults (
    id INTEGER PRIMARY KEY CHECK(id = 1), recipe TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  if (!db.prepare('PRAGMA table_info(photo_studio_finish_defaults)').all().some(column => column.name === 'enabled')) {
    db.exec('ALTER TABLE photo_studio_finish_defaults ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
  }
}

export function recoverPhotoStudioFinishes(db) {
  const interrupted = db.prepare("SELECT * FROM photo_studio_jobs WHERE stage = 'finishing' AND output_url IS NOT NULL").all();
  db.transaction(() => {
    for (const job of interrupted) {
      const completed = db.prepare('SELECT 1 FROM photo_studio_finishes WHERE job_id = ?').get(job.id);
      db.prepare(`UPDATE photo_studio_jobs SET status='done', stage='done', progress=1, error=NULL,
        finish_error=?, finished_at=COALESCE(finished_at, datetime('now')) WHERE id=?`)
        .run(completed ? null : '服务重启导致装裱中断，原片已保留，请重试装裱', job.id);
      db.prepare(`UPDATE image_tasks SET status='done', prompt_refined=?, output_paths=?,
        finished_at=COALESCE(finished_at, datetime('now')), error_message=NULL WHERE id=?`)
        .run(job.prompt, JSON.stringify([job.output_url]), job.image_task_id);
    }
  })();
}
