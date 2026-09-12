export function migrateTownResponsibilitySchema(db) {
  db.transaction(() => {
    for (const [table, column] of [['town_locations', 'business_kind'], ['town_npcs', 'workplace_key'],
      ['town_locations', 'capabilities_json'], ['town_npcs', 'capabilities_json']]) {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
      }
    }
    if (!db.prepare('PRAGMA table_info(town_npcs)').all().some(c => c.name === 'capabilities_explicit')) {
      db.exec('ALTER TABLE town_npcs ADD COLUMN capabilities_explicit INTEGER NOT NULL DEFAULT 0');
    }
  }).immediate();
}
