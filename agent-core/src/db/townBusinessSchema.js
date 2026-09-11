/** Requires the identity, economy and action/event migrations first. */
export function migrateTownBusinessSchema(db) {
  return db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS town_business_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS town_business_slices (
        world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL, config TEXT NOT NULL,
        PRIMARY KEY(world_id,world_epoch)
      );
      CREATE TABLE IF NOT EXISTS town_delivery_orders (
        order_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('open','accepted','picked_up','completed','cancelled','expired')),
        version INTEGER NOT NULL DEFAULT 1, actor_id TEXT,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
        money_reservation_id TEXT NOT NULL, material_reservation_id TEXT NOT NULL,
        cargo_stock_id TEXT, cargo_reservation_id TEXT,
        config TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS town_delivery_due ON town_delivery_orders(world_id,world_epoch,status,expires_at);
      CREATE TABLE IF NOT EXISTS town_business_receipts (
        receipt_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, source_key TEXT NOT NULL,
        source_hash TEXT NOT NULL, response TEXT NOT NULL, UNIQUE(world_id,source_key)
      );
      CREATE TABLE IF NOT EXISTS town_business_requests (
        world_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
        receipt_id TEXT NOT NULL REFERENCES town_business_receipts(receipt_id), PRIMARY KEY(world_id,request_key)
      );
      CREATE TABLE IF NOT EXISTS town_business_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL,
        order_id TEXT NOT NULL REFERENCES town_delivery_orders(order_id), actor_id TEXT,
        event_id TEXT NOT NULL UNIQUE REFERENCES town_domain_events(event_id),
        phase TEXT NOT NULL, occurred_at INTEGER NOT NULL, result TEXT NOT NULL
      );
    `);
    const required = {
      town_business_slices: ['world_id','world_epoch','config'],
      town_delivery_orders: ['order_id','world_id','world_epoch','status','version','actor_id','expires_at','created_at',
        'money_reservation_id','material_reservation_id','cargo_stock_id','cargo_reservation_id','config'],
      town_business_receipts: ['receipt_id','world_id','source_key','source_hash','response'],
      town_business_requests: ['world_id','request_key','request_hash','receipt_id'],
      town_business_log: ['seq','world_id','world_epoch','order_id','actor_id','event_id','phase','occurred_at','result'],
    };
    for (const [table, fields] of Object.entries(required)) {
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
      if (fields.some(field => !columns.has(field))) throw new Error(`Incompatible ${table} schema`);
    }
    const previous = db.prepare('SELECT version FROM town_business_schema WHERE singleton=1').get();
    if (previous && previous.version !== 1) throw new Error('Unsupported town business schema version');
    for (const table of ['town_business_log', 'town_business_receipts']) {
      for (const operation of ['UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_immutable_${operation.toLowerCase()}
        BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable business history'); END`);
    }
    db.prepare('INSERT OR IGNORE INTO town_business_schema VALUES(1,1)').run();
    return { version: 1 };
  }).immediate();
}
