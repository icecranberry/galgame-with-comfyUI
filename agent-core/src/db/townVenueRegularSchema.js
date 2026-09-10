/** 熟客（常客）记录：只统计已正式结算的消费服务，不发放货币或道具。
 * visits 由 town_venue_regular_visits 按会话去重累加，重复结算不会重复计数。 */
export function migrateTownVenueRegularSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS town_venue_regulars (
    world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL CHECK(world_epoch > 0),
    business_key TEXT NOT NULL, player_actor_id TEXT NOT NULL,
    visits INTEGER NOT NULL DEFAULT 0 CHECK(visits >= 0),
    tier INTEGER NOT NULL DEFAULT 0 CHECK(tier >= 0),
    first_visit_at INTEGER NOT NULL, last_visit_at INTEGER NOT NULL,
    unlocked_at INTEGER, updated_at INTEGER NOT NULL,
    PRIMARY KEY(world_id, world_epoch, business_key, player_actor_id)
  );
  CREATE TABLE IF NOT EXISTS town_venue_regular_visits (
    world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL CHECK(world_epoch > 0),
    session_id TEXT NOT NULL, business_key TEXT NOT NULL, player_actor_id TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    PRIMARY KEY(world_id, world_epoch, session_id)
  );
  CREATE INDEX IF NOT EXISTS town_venue_regular_visits_owner
    ON town_venue_regular_visits(world_id, world_epoch, business_key, player_actor_id);`);
}