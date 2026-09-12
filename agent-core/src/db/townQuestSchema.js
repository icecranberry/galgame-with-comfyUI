/** Requires the identity, economy, action/event and business migrations first. */
export function migrateTownQuestSchema(db) {
  return db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS town_quest_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS town_quests (
        quest_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL,
        template_id TEXT NOT NULL, template_version INTEGER NOT NULL,
        actor_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('offered','active','completed','expired','abandoned')),
        version INTEGER NOT NULL DEFAULT 1, current_step INTEGER NOT NULL DEFAULT 0,
        payer_account_id TEXT, money_reservation_id TEXT,
        location_key TEXT, offering_actor_id TEXT,
        offered_at INTEGER NOT NULL, offer_expires_at INTEGER NOT NULL,
        accepted_at INTEGER, deadline_at INTEGER, closed_at INTEGER,
        updated_at INTEGER NOT NULL,
        config TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS town_quests_actor ON town_quests(world_id,world_epoch,actor_id,status);
      CREATE INDEX IF NOT EXISTS town_quests_pool ON town_quests(world_id,world_epoch,status,offer_expires_at);
      CREATE INDEX IF NOT EXISTS town_quests_template ON town_quests(world_id,world_epoch,template_id,status);
      CREATE TABLE IF NOT EXISTS town_quest_requests (
        world_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
        response TEXT NOT NULL, PRIMARY KEY(world_id,request_key)
      );
      CREATE TABLE IF NOT EXISTS town_quest_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL,
        quest_id TEXT NOT NULL REFERENCES town_quests(quest_id), actor_id TEXT,
        event_id TEXT NOT NULL UNIQUE REFERENCES town_domain_events(event_id),
        phase TEXT NOT NULL, occurred_at INTEGER NOT NULL, result TEXT NOT NULL
      );
    `);
    const required = {
      town_quests: ['quest_id','world_id','world_epoch','template_id','template_version','actor_id','status','version',
        'current_step','payer_account_id','money_reservation_id','location_key','offering_actor_id',
        'offered_at','offer_expires_at','accepted_at','deadline_at','closed_at','updated_at','config'],
      town_quest_requests: ['world_id','request_key','request_hash','response'],
      town_quest_log: ['seq','world_id','world_epoch','quest_id','actor_id','event_id','phase','occurred_at','result'],
    };
    for (const [table, fields] of Object.entries(required)) {
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
      if (fields.some(field => !columns.has(field))) throw new Error(`Incompatible ${table} schema`);
    }
    const previous = db.prepare('SELECT version FROM town_quest_schema WHERE singleton=1').get();
    if (previous && previous.version !== 1) throw new Error('Unsupported town quest schema version');
    for (const operation of ['UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS town_quest_log_immutable_${operation.toLowerCase()}
      BEFORE ${operation} ON town_quest_log BEGIN SELECT RAISE(ABORT,'Immutable quest history'); END`);
    db.prepare('INSERT OR IGNORE INTO town_quest_schema VALUES(1,1)').run();
    return { version: 1 };
  }).immediate();
}
