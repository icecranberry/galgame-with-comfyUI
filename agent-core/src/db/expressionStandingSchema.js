import { migrateStandingInteractionRegionReferences } from './standingInteractionSchema.js';

const slotColumns = ['slot_id', 'prompt', 'requirement', 'config_json', 'image_url', 'source_url', 'bounds_json', 'status', 'error', 'version'];

export function migrateExpressionStandings(db) {
  db.transaction(() => {
    if (db.pragma('table_info(expression_standings)').some(column => column.name === 'owner_type')) {
      db.exec('ALTER TABLE expression_standings RENAME TO expression_standings_legacy');
    }
    db.exec(`
    CREATE TABLE IF NOT EXISTS expression_standings (
      character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
      slot_id TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      requirement TEXT NOT NULL DEFAULT '',
      config_json TEXT NOT NULL DEFAULT '{}',
      image_url TEXT,
      source_url TEXT,
      bounds_json TEXT,
      status TEXT NOT NULL DEFAULT 'empty',
      error TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      UNIQUE(character_id, slot_id)
    );
    CREATE TABLE IF NOT EXISTS expression_standing_jobs (
      id TEXT PRIMARY KEY,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      slots_json TEXT NOT NULL,
      status TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS player_expression_standing_jobs (
      id TEXT PRIMARY KEY,
      slots_json TEXT NOT NULL,
      status TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      request_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS standing_display_selection (
      id INTEGER PRIMARY KEY CHECK(id=1),
      character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL
    );
    `);
    if (!db.pragma('table_info(expression_standing_jobs)').some(c => c.name === 'request_json')) {
      db.exec("ALTER TABLE expression_standing_jobs ADD COLUMN request_json TEXT NOT NULL DEFAULT '{}'");
    }
    const exists = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?");
    const columns = ['character_id', ...slotColumns].join(', ');
    for (const legacyTable of ['expression_standings_legacy', 'character_expression_standings']) {
      if (!exists.get(legacyTable)) continue;
      db.exec(`INSERT INTO expression_standings (${columns}) SELECT ${columns} FROM ${legacyTable}`);
      migrateStandingInteractionRegionReferences(db, legacyTable);
      db.exec(`DROP TABLE ${legacyTable}`);
    }
    if (exists.get('player_expression_standings')) {
      const oldColumns = new Set(db.pragma('table_info(player_expression_standings)').map(column => column.name));
      const copyColumns = slotColumns.filter(column => oldColumns.has(column) || column === 'status');
      const values = copyColumns.map(column => oldColumns.has(column) ? column : "CASE WHEN image_url != '' THEN 'done' ELSE 'empty' END");
      db.exec(`INSERT INTO expression_standings (${copyColumns.join(', ')})
        SELECT ${values.join(', ')} FROM player_expression_standings`);
      db.exec('DROP TABLE player_expression_standings');
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_expression_standings_player_slot
      ON expression_standings(slot_id) WHERE character_id IS NULL`);
  }).immediate();
}

export function recoverExpressionStandingJobs(db) {
  db.transaction(() => {
    db.prepare(`UPDATE expression_standings SET status='failed',error='服务重启导致生成中断，请重试' WHERE status IN ('queued','generating')`).run();
    db.prepare(`UPDATE expression_standing_jobs SET status='failed',error='服务重启导致生成中断，请重试' WHERE status IN ('queued','outfits','prompts','generating','stopping','paused')`).run();
    db.prepare(`UPDATE player_expression_standing_jobs SET status='failed',error='服务重启导致生成中断，请重试' WHERE status IN ('queued','prompts','generating','stopping','paused')`).run();
  })();
}
