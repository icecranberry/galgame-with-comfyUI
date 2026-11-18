export function migrateGameSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS installed_games (
      id TEXT PRIMARY KEY, source TEXT NOT NULL CHECK(source IN ('official','github','zip')),
      name TEXT NOT NULL, version TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', repo_url TEXT, zip_fingerprint TEXT,
      install_path TEXT NOT NULL, manifest_json TEXT NOT NULL,
      installed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      installed INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS game_sessions (
      session_id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES installed_games(id) ON DELETE CASCADE,
      title TEXT NOT NULL, state_json TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_game_sessions_game ON game_sessions(game_id, updated_at DESC);
  `);
  if (!db.prepare('PRAGMA table_info(installed_games)').all().some(column => column.name === 'zip_fingerprint')) {
    db.exec('ALTER TABLE installed_games ADD COLUMN zip_fingerprint TEXT');
  }
}
