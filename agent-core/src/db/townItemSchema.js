/**
 * Explicit connection only; this module never opens a database.
 * db/index.js integration (owned by the main agent):
 * 1. Call after backpack_items creation, BEFORE gift_history migration/backfill and startup cleanup.
 * 2. Replace blanket generating deletion with cleanupInterruptedChestItems(db) from itemLifecycle.js.
 * 3. Scope gift_history's MAX(acquired_at) backfill to owner_key='me' AND
 *    source_type IN ('legacy_chest','chest'), preserving its existing status/time semantics.
 * New writers must specify owner_key/source_type; defaults exist only for legacy compatibility.
 * Template/version/reservation/retirement fields belong to the subsequent M4 migration.
 */
export function migrateTownItemSchema(db) {
  db.transaction(() => {
    const columns = new Set(db.prepare('PRAGMA table_info(backpack_items)').all().map(c => c.name));
    if (!columns.size) throw new Error('backpack_items must exist before town item migration');
    if (!columns.has('owner_key')) {
      db.exec("ALTER TABLE backpack_items ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'me'");
    }
    if (!columns.has('source_type')) {
      db.exec("ALTER TABLE backpack_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'legacy_chest'");
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_backpack_items_owner_source_status ON backpack_items(owner_key, source_type, status)');
  })();
}
