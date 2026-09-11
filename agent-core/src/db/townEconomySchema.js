const MAX = '9007199254740991';

/** Additive isolated migration; incompatible existing drafts fail rather than silently diverge. */
export function migrateTownEconomySchema(db) {
  return db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS town_economy_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS economy_accounts (
        account_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, owner_key TEXT NOT NULL,
        actor_id TEXT, account_type TEXT NOT NULL CHECK(account_type IN ('actor','business','fund','escrow','issuance')),
        currency TEXT NOT NULL DEFAULT 'LIN' CHECK(currency='LIN'),
        balance INTEGER NOT NULL DEFAULT 0 CHECK(typeof(balance)='integer' AND balance BETWEEN -${MAX} AND ${MAX}),
        reserved INTEGER NOT NULL DEFAULT 0 CHECK(typeof(reserved)='integer' AND reserved BETWEEN 0 AND ${MAX}),
        version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
        CHECK((account_type='issuance' AND balance<=0 AND reserved=0) OR (account_type<>'issuance' AND balance>=reserved)),
        UNIQUE(world_id,owner_key)
      );
      CREATE TABLE IF NOT EXISTS town_resource_stocks (
        stock_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, owner_key TEXT NOT NULL, resource_key TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK(typeof(quantity)='integer' AND quantity BETWEEN 0 AND ${MAX}),
        reserved INTEGER NOT NULL DEFAULT 0 CHECK(typeof(reserved)='integer' AND reserved BETWEEN 0 AND quantity),
        version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), UNIQUE(world_id,owner_key,resource_key)
      );
      CREATE TABLE IF NOT EXISTS economy_transactions (
        transaction_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL,
        source_key TEXT NOT NULL, request_hash TEXT NOT NULL, command TEXT NOT NULL,
        reason_code TEXT NOT NULL, source_event_id TEXT, occurred_at INTEGER NOT NULL, response TEXT NOT NULL,
        UNIQUE(world_id,source_key)
      );
      CREATE TABLE IF NOT EXISTS economy_requests (
        world_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
        transaction_id TEXT NOT NULL REFERENCES economy_transactions(transaction_id), PRIMARY KEY(world_id,request_key)
      );
      CREATE TABLE IF NOT EXISTS economy_entries (
        transaction_id TEXT NOT NULL REFERENCES economy_transactions(transaction_id) DEFERRABLE INITIALLY DEFERRED,
        account_id TEXT NOT NULL REFERENCES economy_accounts(account_id),
        amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN -${MAX} AND ${MAX}),
        reserved_delta INTEGER NOT NULL CHECK(typeof(reserved_delta)='integer' AND reserved_delta BETWEEN -${MAX} AND ${MAX}),
        PRIMARY KEY(transaction_id,account_id)
      );
      CREATE TABLE IF NOT EXISTS town_resource_entries (
        transaction_id TEXT NOT NULL REFERENCES economy_transactions(transaction_id) DEFERRABLE INITIALLY DEFERRED,
        stock_id TEXT NOT NULL REFERENCES town_resource_stocks(stock_id),
        quantity_delta INTEGER NOT NULL CHECK(typeof(quantity_delta)='integer' AND quantity_delta BETWEEN -${MAX} AND ${MAX}),
        reserved_delta INTEGER NOT NULL CHECK(typeof(reserved_delta)='integer' AND reserved_delta BETWEEN -${MAX} AND ${MAX}),
        PRIMARY KEY(transaction_id,stock_id)
      );
      CREATE TABLE IF NOT EXISTS economy_reservations (
        reservation_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL,
        asset_type TEXT NOT NULL CHECK(asset_type IN ('money','stock')), asset_id TEXT NOT NULL,
        owner_ref TEXT NOT NULL, amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 1 AND ${MAX}),
        captured INTEGER NOT NULL DEFAULT 0 CHECK(typeof(captured)='integer' AND captured>=0),
        released INTEGER NOT NULL DEFAULT 0 CHECK(typeof(released)='integer' AND released>=0),
        remaining INTEGER NOT NULL CHECK(typeof(remaining)='integer' AND remaining>=0),
        version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
        CHECK(captured+released+remaining=amount), UNIQUE(world_id,asset_type,asset_id,owner_ref)
      );
      CREATE INDEX IF NOT EXISTS economy_entries_account ON economy_entries(account_id,transaction_id);
      CREATE INDEX IF NOT EXISTS economy_reservations_owner ON economy_reservations(world_id,owner_ref);
    `);
    const required = {
      economy_accounts: ['account_id','world_id','owner_key','actor_id','account_type','currency','balance','reserved','version'],
      town_resource_stocks: ['stock_id','world_id','owner_key','resource_key','quantity','reserved','version'],
      economy_transactions: ['transaction_id','world_id','world_epoch','source_key','request_hash','command','reason_code','source_event_id','occurred_at','response'],
      economy_requests: ['world_id','request_key','request_hash','transaction_id'],
      economy_entries: ['transaction_id','account_id','amount','reserved_delta'],
      town_resource_entries: ['transaction_id','stock_id','quantity_delta','reserved_delta'],
      economy_reservations: ['reservation_id','world_id','world_epoch','asset_type','asset_id','owner_ref','amount','captured','released','remaining','version'],
    };
    for (const [table, fields] of Object.entries(required)) {
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
      if (fields.some(f => !columns.has(f))) throw new Error(`Incompatible ${table} schema; explicit migration required`);
    }
    const existing = db.prepare('SELECT version FROM town_economy_schema WHERE singleton=1').get();
    if (existing && existing.version !== 1) throw new Error('Unsupported town economy schema version');
    for (const table of ['economy_transactions','economy_entries','town_resource_entries']) {
      for (const operation of ['UPDATE','DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_immutable_${operation.toLowerCase()}
        BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable economy ledger'); END`);
    }
    for (const table of ['economy_entries','town_resource_entries']) db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${table}_sealed_insert BEFORE INSERT ON ${table}
      WHEN EXISTS(SELECT 1 FROM economy_transactions WHERE transaction_id=NEW.transaction_id)
      BEGIN SELECT RAISE(ABORT,'Sealed economy transaction'); END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS economy_transactions_balanced BEFORE INSERT ON economy_transactions
      WHEN (SELECT COALESCE(SUM(amount),0) FROM economy_entries WHERE transaction_id=NEW.transaction_id)<>0
      BEGIN SELECT RAISE(ABORT,'Unbalanced economy transaction'); END`);
    db.prepare('INSERT OR IGNORE INTO town_economy_schema VALUES(1,1)').run();
    return { version: 1 };
  }).immediate();
}
