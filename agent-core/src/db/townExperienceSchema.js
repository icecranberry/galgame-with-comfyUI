export function migrateTownExperienceSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS town_experiences (
    event_id TEXT NOT NULL REFERENCES town_domain_events(event_id),
    actor_id TEXT NOT NULL, world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL,
    occurred_at INTEGER NOT NULL, summary TEXT NOT NULL, character_id INTEGER,
    memory_ids TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(event_id, actor_id)
  );
  CREATE INDEX IF NOT EXISTS town_experience_actor_time ON town_experiences(actor_id, occurred_at);`);
}
