/** Explicit fixture/runtime connection; no singleton access or migration side effects on import. */
export function migrateTownServiceSessionSchema(db) {
  db.transaction(() => db.exec(`
    CREATE TABLE IF NOT EXISTS town_service_sessions (
      session_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL,
      actor_id TEXT NOT NULL, provider_actor_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('offered','active','resolving','settling','completed','cancelled','failed','expired')),
      phase TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      turn_count INTEGER NOT NULL DEFAULT 0 CHECK(turn_count BETWEEN 0 AND 8), no_progress INTEGER NOT NULL DEFAULT 0,
      consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)), crafted INTEGER NOT NULL DEFAULT 0 CHECK(crafted IN (0,1)),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, offer_expires_at INTEGER NOT NULL,
      idle_at INTEGER, deadline_at INTEGER, lease_token TEXT, lease_until INTEGER, pending_turn_id TEXT,
      escrow_account_id TEXT, material_reservation_id TEXT, config_json TEXT NOT NULL, plan_json TEXT
    );
    DROP INDEX IF EXISTS town_service_provider_busy;
    DROP INDEX IF EXISTS town_service_player_busy;
    CREATE UNIQUE INDEX town_service_provider_busy ON town_service_sessions(world_id,provider_actor_id)
      WHERE escrow_account_id IS NOT NULL AND status IN ('active','resolving','settling');
    CREATE UNIQUE INDEX town_service_player_busy ON town_service_sessions(world_id,actor_id)
      WHERE escrow_account_id IS NOT NULL AND status IN ('active','resolving','settling');
    CREATE TABLE IF NOT EXISTS town_service_turns (
      session_id TEXT NOT NULL REFERENCES town_service_sessions(session_id), client_turn_id TEXT NOT NULL,
      request_hash TEXT NOT NULL, input_json TEXT NOT NULL, response_json TEXT,
      PRIMARY KEY(session_id,client_turn_id)
    );
    CREATE TABLE IF NOT EXISTS town_service_requests (
      world_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL,
      PRIMARY KEY(world_id,request_key)
    );
    CREATE TABLE IF NOT EXISTS town_service_settlements (
      session_id TEXT PRIMARY KEY REFERENCES town_service_sessions(session_id), receipt_json TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS town_service_terminal_update BEFORE UPDATE ON town_service_sessions
      WHEN OLD.status IN ('completed','cancelled','failed','expired')
      BEGIN SELECT RAISE(ABORT,'SESSION_CLOSED'); END;
    CREATE TRIGGER IF NOT EXISTS town_service_no_delete BEFORE DELETE ON town_service_sessions
      BEGIN SELECT RAISE(ABORT,'SERVICE_HISTORY_PERMANENT'); END;
    CREATE TRIGGER IF NOT EXISTS town_service_receipt_update BEFORE UPDATE ON town_service_settlements
      BEGIN SELECT RAISE(ABORT,'SERVICE_RECEIPT_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS town_service_receipt_delete BEFORE DELETE ON town_service_settlements
      BEGIN SELECT RAISE(ABORT,'SERVICE_RECEIPT_IMMUTABLE'); END;
  `))();
}
