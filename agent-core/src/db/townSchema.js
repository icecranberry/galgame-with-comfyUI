import { randomUUID, randomBytes } from 'node:crypto';
import { createTownActorRegistry } from '../services/town/townActorRegistry.js';

export const TOWN_SCHEMA_VERSION = 1;

/**
 * Run after the existing town/character schema migrations, with an explicitly
 * supplied better-sqlite3 connection. No file opening or singleton access.
 * DDL, version and identity backfill commit together; errors are not swallowed.
 */
export function migrateTownSchema(db) {
  return db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS town_world_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        world_id TEXT NOT NULL UNIQUE,
        epoch INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1),
        seed TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS town_actors (
        actor_id TEXT PRIMARY KEY NOT NULL,
        player_id TEXT,
        npc_id INTEGER,
        character_id INTEGER,
        participating INTEGER NOT NULL DEFAULT 0 CHECK (participating IN (0, 1)),
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        merged_into TEXT REFERENCES town_actors(actor_id),
        CHECK (merged_into IS NULL OR (merged_into <> actor_id AND archived = 1 AND participating = 0))
      );
    `);
    // A versioned migration must not silently accept a differently shaped table.
    // Compatible early M0 drafts may lack the additive state fields below.
    for (const [table, required, additions] of [
      ['town_world_state', ['singleton', 'world_id', 'seed'], {
        epoch: 'INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1)',
        schema_version: 'INTEGER NOT NULL DEFAULT 0',
      }],
      ['town_actors', ['actor_id', 'player_id', 'npc_id', 'character_id'], {
        participating: 'INTEGER NOT NULL DEFAULT 0 CHECK (participating IN (0, 1))',
        archived: 'INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))',
        merged_into: 'TEXT REFERENCES town_actors(actor_id)',
      }],
    ]) {
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
      for (const name of required) {
        if (!columns.has(name)) throw new Error(`Unsupported ${table} schema: missing ${name}`);
      }
      for (const [name, definition] of Object.entries(additions)) {
        if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      }
    }
    db.prepare(`INSERT OR IGNORE INTO town_world_state (singleton, world_id, seed)
      VALUES (1, ?, ?)`).run(randomUUID(), randomBytes(16).toString('hex'));
    const version = db.prepare('SELECT schema_version FROM town_world_state WHERE singleton = 1').get().schema_version;
    if (version > TOWN_SCHEMA_VERSION) throw new Error(`Unsupported town schema version ${version}`);
    // Retired identities still reserve their source IDs. Membership changes must
    // never mint a second identity. Only merge tombstones release the mapping.
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS town_actors_player_unique ON town_actors(player_id) WHERE merged_into IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS town_actors_npc_unique ON town_actors(npc_id) WHERE merged_into IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS town_actors_character_unique ON town_actors(character_id) WHERE merged_into IS NULL;
    `);
    const registry = createTownActorRegistry(db);
    registry.synchronize();
    db.prepare('UPDATE town_world_state SET schema_version = ? WHERE singleton = 1').run(TOWN_SCHEMA_VERSION);
    return registry.getWorldState();
  })();
}
