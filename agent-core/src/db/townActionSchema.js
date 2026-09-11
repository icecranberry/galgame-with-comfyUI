/** Explicit, repeatable migration. Does not open a database or own world/actor tables. */
export function migrateTownActionSchema(db) {
  db.transaction(() => db.exec(`
    CREATE TABLE IF NOT EXISTS town_actions (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL,
      actor_id TEXT NOT NULL, type TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('validated','reserved','running','completed','cancelled','failed')),
      version INTEGER NOT NULL DEFAULT 1, target TEXT, payload TEXT NOT NULL,
      rule_key TEXT, rule_version INTEGER, started_at INTEGER, due_at INTEGER,
      updated_at INTEGER NOT NULL, failure_reason TEXT, result TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS town_actions_actor_active
      ON town_actions(world_id, world_epoch, actor_id) WHERE status IN ('reserved','running');
    CREATE INDEX IF NOT EXISTS town_actions_due ON town_actions(status, due_at);
    CREATE INDEX IF NOT EXISTS town_actions_actor_rule_type
      ON town_actions(world_id, world_epoch, actor_id, rule_key, type);
    CREATE INDEX IF NOT EXISTS town_actions_actor_current ON town_actions(world_id, world_epoch, actor_id, updated_at DESC)
      WHERE status IN ('validated','reserved','running');
    CREATE TABLE IF NOT EXISTS town_action_requests (
      world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL, request_key TEXT NOT NULL,
      payload TEXT NOT NULL, response TEXT NOT NULL,
      PRIMARY KEY(world_id, world_epoch, request_key)
    );
    CREATE TABLE IF NOT EXISTS town_resource_claims (
      world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL, resource_key TEXT NOT NULL,
      action_id TEXT NOT NULL REFERENCES town_actions(id), lease_until INTEGER NOT NULL,
      PRIMARY KEY(world_id, world_epoch, resource_key)
    );
    CREATE INDEX IF NOT EXISTS town_claims_owner ON town_resource_claims(action_id);
    CREATE TABLE IF NOT EXISTS town_domain_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
      world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL, type TEXT NOT NULL,
      root_event_id TEXT NOT NULL, depth INTEGER NOT NULL, envelope TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS town_event_deliveries (
      event_id TEXT NOT NULL REFERENCES town_domain_events(event_id), consumer_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','processing','done','dead')),
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
      lease_until INTEGER, lease_token TEXT, last_error TEXT,
      PRIMARY KEY(event_id, consumer_key)
    );
    CREATE INDEX IF NOT EXISTS town_delivery_due ON town_event_deliveries(status, next_attempt_at);
    CREATE TABLE IF NOT EXISTS town_activity_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL,
      actor_id TEXT NOT NULL, action_id TEXT NOT NULL REFERENCES town_actions(id),
      event_id TEXT NOT NULL UNIQUE REFERENCES town_domain_events(event_id), phase TEXT NOT NULL,
      reason_code TEXT NOT NULL, rule_key TEXT, rule_version INTEGER, location_key TEXT,
      occurred_at INTEGER NOT NULL, result TEXT
    );
    CREATE INDEX IF NOT EXISTS town_activity_actor_time ON town_activity_log(actor_id, occurred_at);
  `))();
}
