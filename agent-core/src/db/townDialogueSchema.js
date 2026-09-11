/** Run after the world schema. Explicit connection only; no startup side effects. */
export function ensureTownDialogueSchema(db) {
  db.transaction(() => db.exec(`
    CREATE TABLE IF NOT EXISTS town_dialogue_requests (
      request_id TEXT PRIMARY KEY NOT NULL,
      world_id TEXT NOT NULL,
      world_epoch INTEGER NOT NULL CHECK(world_epoch >= 1),
      npc_id INTEGER NOT NULL CHECK(npc_id > 0),
      client_message_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('processing', 'completed', 'failed')),
      reply_json TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(world_id, world_epoch, npc_id, client_message_id),
      CHECK((status = 'processing' AND reply_json IS NULL AND error IS NULL)
        OR (status = 'completed' AND reply_json IS NOT NULL AND error IS NULL)
        OR (status = 'failed' AND reply_json IS NULL AND error IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS town_dialogue_npc_processing
      ON town_dialogue_requests(world_id, world_epoch, npc_id) WHERE status = 'processing';
  `))();
}
