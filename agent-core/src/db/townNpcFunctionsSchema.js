/** NPC 功能点：functions_json 落在 town_npcs 上；赠礼冷却状态单独建表。
 * Requires the town schema (town_npcs) first. */
export function migrateTownNpcFunctionsSchema(db) {
  return db.transaction(() => {
    const columns = new Set(db.prepare('PRAGMA table_info(town_npcs)').all().map(r => r.name));
    if (columns.has('functions_json') && !columns.has('id')) throw new Error('Incompatible town_npcs schema');
    if (!columns.has('functions_json')) db.exec('ALTER TABLE town_npcs ADD COLUMN functions_json TEXT');
    if (!columns.has('capabilities_json')) db.exec('ALTER TABLE town_npcs ADD COLUMN capabilities_json TEXT');
    db.exec(`
      CREATE TABLE IF NOT EXISTS town_npc_gifts (
        world_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        last_gift_at INTEGER NOT NULL, last_template_id TEXT, last_item_id INTEGER,
        PRIMARY KEY(world_id, actor_id)
      );
      CREATE TABLE IF NOT EXISTS town_npc_trade_receipts (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL,
        actor_id TEXT NOT NULL, direction TEXT NOT NULL, template_id TEXT NOT NULL,
        price INTEGER NOT NULL, item_id INTEGER, occurred_at INTEGER NOT NULL, result TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS town_interaction_offers (
        request_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL,
        actor_id TEXT NOT NULL, player_actor_id TEXT NOT NULL, kind TEXT NOT NULL,
        character_id INTEGER, status TEXT NOT NULL, spec_json TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        event_id INTEGER, result_json TEXT
      );
      CREATE INDEX IF NOT EXISTS town_interaction_actor ON town_interaction_offers(world_id,world_epoch,actor_id,created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS town_interaction_story_generating ON town_interaction_offers(character_id)
        WHERE kind='story' AND status='generating';
    `);
    if (!db.prepare('PRAGMA table_info(town_interaction_offers)').all().some(c => c.name === 'source_key')) {
      db.exec("ALTER TABLE town_interaction_offers ADD COLUMN source_key TEXT NOT NULL DEFAULT ''");
    }
    return { version: 2 };
  }).immediate();
}
