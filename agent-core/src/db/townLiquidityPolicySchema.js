/** Isolated policy journal, lifetime limits are world-scoped and survive epochs. */
export function migrateTownLiquidityPolicySchema(db) {
  return db.transaction(()=>{
    db.exec(`
      CREATE TABLE IF NOT EXISTS town_liquidity_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS town_liquidity_state (
        world_id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
        enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),last_observed_at INTEGER NOT NULL CHECK(last_observed_at>=0)
      );
      CREATE TABLE IF NOT EXISTS town_liquidity_authorizations (
        authorization_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,world_epoch INTEGER NOT NULL,
        order_id TEXT NOT NULL UNIQUE REFERENCES town_delivery_orders(order_id),
        actor_id TEXT NOT NULL,fund_id TEXT NOT NULL REFERENCES economy_accounts(account_id),
        amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 30),before_available INTEGER NOT NULL CHECK(before_available BETWEEN 60 AND 89),
        fund_version INTEGER NOT NULL,state_version INTEGER NOT NULL,occurred_at INTEGER NOT NULL,
        CHECK(amount=90-before_available)
      );
      CREATE TABLE IF NOT EXISTS town_liquidity_issues (
        authorization_id TEXT PRIMARY KEY REFERENCES town_liquidity_authorizations(authorization_id),
        transaction_id TEXT NOT NULL UNIQUE REFERENCES economy_transactions(transaction_id) DEFERRABLE INITIALLY DEFERRED,
        world_id TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 30),occurred_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS town_liquidity_issues_window ON town_liquidity_issues(world_id,occurred_at);
      CREATE TABLE IF NOT EXISTS town_liquidity_requests (
        world_id TEXT NOT NULL,request_key TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL,
        PRIMARY KEY(world_id,request_key)
      );
    `);
    const version=db.prepare('SELECT version FROM town_liquidity_schema WHERE singleton=1').get();
    if(version&&version.version!==1)throw Error('Unsupported town liquidity schema version');
    for(const [table,fields] of Object.entries({
      town_liquidity_state:['world_id','version','enabled','last_observed_at'],
      town_liquidity_authorizations:['authorization_id','world_id','world_epoch','order_id','actor_id','fund_id','amount','before_available','fund_version','state_version','occurred_at'],
      town_liquidity_issues:['authorization_id','transaction_id','world_id','amount','occurred_at'],
      town_liquidity_requests:['world_id','request_key','request_hash','response'],
    })) {
      const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r=>r.name));
      if(fields.some(field=>!columns.has(field)))throw Error(`Incompatible ${table} schema`);
    }
    for(const table of ['town_liquidity_authorizations','town_liquidity_issues','town_liquidity_requests']) {
      for(const op of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_immutable_${op}
        BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable liquidity journal'); END`);
    }
    db.exec(`CREATE TRIGGER IF NOT EXISTS town_liquidity_clock_monotonic BEFORE UPDATE ON town_liquidity_state
      WHEN NEW.last_observed_at<OLD.last_observed_at OR NEW.version<=OLD.version
      BEGIN SELECT RAISE(ABORT,'Invalid liquidity state version/time'); END;
      CREATE TRIGGER IF NOT EXISTS town_liquidity_state_permanent BEFORE DELETE ON town_liquidity_state
      BEGIN SELECT RAISE(ABORT,'Permanent liquidity state'); END;`);
    db.prepare('INSERT OR IGNORE INTO town_liquidity_schema VALUES(1,1)').run();
    return {version:1};
  }).immediate();
}
