/** Finite natural capacity is not an economy seed or an automatic daily grant. */
export function migrateTownProductionSchema(db) {
  return db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS town_production_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS town_production_nodes (
        world_id TEXT PRIMARY KEY, capacity INTEGER NOT NULL CHECK(capacity=200),
        remaining INTEGER NOT NULL CHECK(remaining BETWEEN 0 AND capacity),
        reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved BETWEEN 0 AND remaining)
      );
      CREATE TABLE IF NOT EXISTS town_productions (
        production_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,world_epoch INTEGER NOT NULL,
        session_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('reserved','completed','cancelled','expired')),
        version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
        money_reservation_id TEXT NOT NULL,config TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS town_production_service_once ON town_productions(world_id,session_id)
        WHERE status IN ('reserved','completed');
      CREATE TABLE IF NOT EXISTS town_production_proofs (
        action_id TEXT PRIMARY KEY REFERENCES town_actions(id),production_id TEXT NOT NULL REFERENCES town_productions(production_id),
        role TEXT NOT NULL CHECK(role IN ('supplier','workshop')),UNIQUE(production_id,role)
      );
      CREATE TABLE IF NOT EXISTS town_production_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,production_id TEXT NOT NULL REFERENCES town_productions(production_id),
        event_id TEXT NOT NULL UNIQUE REFERENCES town_domain_events(event_id),phase TEXT NOT NULL,occurred_at INTEGER NOT NULL,result TEXT NOT NULL
      );
    `);
    for (const [table, required] of Object.entries({
      town_production_nodes: ['world_id','capacity','remaining','reserved'],
      town_productions: ['production_id','world_id','world_epoch','session_id','status','version','created_at','expires_at','money_reservation_id','config'],
      town_production_proofs: ['action_id','production_id','role'],
      town_production_log: ['seq','production_id','event_id','phase','occurred_at','result'],
    })) {
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
      if (required.some(field => !columns.has(field))) throw new Error(`Incompatible ${table} schema`);
    }
    const version = db.prepare('SELECT version FROM town_production_schema WHERE singleton=1').get();
    if (version && version.version !== 1) throw new Error('Unsupported town production schema version');
    for (const table of ['town_production_proofs','town_production_log']) {
      for (const op of ['UPDATE','DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_immutable_${op.toLowerCase()}
        BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable production history'); END`);
    }
    db.exec(`CREATE TRIGGER IF NOT EXISTS town_production_terminal_update BEFORE UPDATE ON town_productions
      WHEN OLD.status IN ('completed','cancelled','expired') BEGIN SELECT RAISE(ABORT,'PRODUCTION_CLOSED'); END;
      CREATE TRIGGER IF NOT EXISTS town_production_no_delete BEFORE DELETE ON town_productions
      BEGIN SELECT RAISE(ABORT,'PRODUCTION_HISTORY_PERMANENT'); END;`);
    db.prepare('INSERT OR IGNORE INTO town_production_schema VALUES(1,1)').run();
    return { version: 1 };
  }).immediate();
}
