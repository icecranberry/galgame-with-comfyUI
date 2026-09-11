/** Explicit connection only. No base schedule, runtime or world state mutation. */
export function migrateTownAppointmentSchema(db) {
  db.transaction(() => db.exec(`
    CREATE TABLE IF NOT EXISTS town_appointment_candidates (
      candidate_id TEXT PRIMARY KEY NOT NULL,
      world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL CHECK(world_epoch > 0),
      source_event_id TEXT NOT NULL, session_id TEXT NOT NULL,
      player_actor_id TEXT NOT NULL, provider_actor_id TEXT NOT NULL, character_id INTEGER NOT NULL,
      location_key TEXT NOT NULL, location_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('offered','accepted','expired','cancelled')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(world_id, world_epoch, source_event_id),
      UNIQUE(world_id, world_epoch, session_id)
    );
    CREATE TABLE IF NOT EXISTS town_appointments (
      appointment_id TEXT PRIMARY KEY NOT NULL,
      candidate_id TEXT NOT NULL UNIQUE REFERENCES town_appointment_candidates(candidate_id),
      world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL CHECK(world_epoch > 0),
      source_event_id TEXT NOT NULL,
      player_actor_id TEXT NOT NULL, provider_actor_id TEXT NOT NULL, character_id INTEGER NOT NULL,
      location_key TEXT NOT NULL, location_id INTEGER NOT NULL,
      start_at INTEGER NOT NULL, end_at INTEGER NOT NULL CHECK(end_at - start_at = 1800000),
      status TEXT NOT NULL CHECK(status IN ('accepted','cancelled','expired')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS town_appointments_player_window
      ON town_appointments(world_id, world_epoch, player_actor_id, status, start_at, end_at);
    CREATE INDEX IF NOT EXISTS town_appointments_character_window
      ON town_appointments(world_id, world_epoch, character_id, status, start_at, end_at);
    CREATE TABLE IF NOT EXISTS town_appointment_requests (
      world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL, request_key TEXT NOT NULL,
      request_hash TEXT NOT NULL, response_json TEXT NOT NULL,
      PRIMARY KEY(world_id, world_epoch, request_key)
    );
  `))();
}
