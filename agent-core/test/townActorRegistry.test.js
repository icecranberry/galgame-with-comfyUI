import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';

// Read DDL as text; never import db/index.js (it opens the application's DB).
// Use actual post-migration NPC DDL, including nullable map_id and character_id.
const legacySchema = readFileSync(new URL('../src/db/index.js', import.meta.url), 'utf8');
function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.pragma('foreign_keys = ON');
  for (const table of ['characters', 'town_maps', 'town_locations', 'town_characters', 'town_players', 'town_npcs_new']) {
    const ddl = legacySchema.match(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table} \\([\\s\\S]*?\\n\\s*\\);`))?.[0];
    assert.ok(ddl, `Actual schema fixture missing ${table}`);
    db.exec(ddl.replace('town_npcs_new', 'town_npcs'));
  }
  return db;
}
function character(db, id) {
  db.prepare('INSERT INTO characters (id, name, display_name, base_prompt) VALUES (?, ?, ?, ?)')
    .run(id, `character_${id}`, `角色${id}`, 'persona');
}
function npc(db, id, characterId = null) {
  db.prepare('INSERT INTO town_npcs (id, display_name, character_id) VALUES (?, ?, ?)').run(id, `NPC${id}`, characterId);
}
function membership(db, id, enabled) {
  db.prepare(`INSERT INTO town_characters (character_id, town_enabled) VALUES (?, ?)
    ON CONFLICT(character_id) DO UPDATE SET town_enabled = excluded.town_enabled`).run(id, enabled);
}
const dump = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();

test('migration is idempotent without a map, backfills UUIDs and leaves legacy data untouched', t => {
  const db = fixture(t);
  character(db, 11);
  npc(db, 7);
  npc(db, 8, 11);
  const before = ['characters', 'town_npcs', 'town_characters', 'town_maps'].map(table => dump(db, table));
  const world = migrateTownSchema(db);
  const registry = createTownActorRegistry(db);
  const actors = dump(db, 'town_actors');
  assert.match(world.worldId, /^[0-9a-f-]{36}$/);
  assert.equal(world.epoch, 1);
  assert.ok(world.seed);
  assert.equal(world.schemaVersion, 1);
  for (const actor of actors) assert.match(actor.actor_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(registry.resolveAgentKey('npc:8').actorId, registry.resolveAgentKey('char:11').actorId);
  assert.equal(registry.resolveAgentKey('me').playerId, 'me');
  for (let i = 0; i < 3; i++) assert.deepEqual(migrateTownSchema(db), world);
  assert.deepEqual(dump(db, 'town_actors'), actors);
  assert.deepEqual(['characters', 'town_npcs', 'town_characters', 'town_maps'].map(table => dump(db, table)), before);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_maps').get().n, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('empty source tables produce only the stable player, with no map dependency', t => {
  const db = fixture(t);
  migrateTownSchema(db);
  const registry = createTownActorRegistry(db);
  assert.equal(registry.synchronize().length, 1);
  const id = registry.resolveAgentKey('me').actorId;
  migrateTownSchema(db);
  assert.equal(createTownActorRegistry(db).resolveAgentKey('me').actorId, id);
});

test('invitation preserves NPC UUID, merges an existing character UUID and survives repeated sync', t => {
  const db = fixture(t);
  npc(db, 3);
  character(db, 12);
  membership(db, 12, 1);
  migrateTownSchema(db);
  const registry = createTownActorRegistry(db);
  const npcId = registry.resolveAgentKey('npc:3').actorId;
  const charId = registry.resolveAgentKey('char:12').actorId;
  const result = registry.linkNpcCharacter(3, 12);
  assert.equal(result.actorId, npcId);
  assert.equal(result.agentKey, 'char:12');
  assert.equal(registry.getActor(charId).actorId, npcId);
  const tombstone = registry.getActor(charId, { followMerged: false });
  assert.equal(tombstone.mergedInto, npcId);
  assert.equal(tombstone.archived, true);
  assert.equal(tombstone.participating, false);
  const rows = dump(db, 'town_actors');
  registry.linkNpcCharacter(3, 12);
  registry.synchronize();
  assert.deepEqual(dump(db, 'town_actors'), rows);
  assert.equal(registry.resolveAgentKey(-3).actorId, npcId);
  assert.equal(registry.resolveAgentKey(12).actorId, npcId);
  assert.equal(registry.synchronize().filter(a => a.participating && a.playerId == null).length, 1);
});

test('membership opt-out overrides linked NPC and re-entry does not mint an identity', t => {
  const db = fixture(t);
  npc(db, 3, 12);
  character(db, 12);
  migrateTownSchema(db);
  const registry = createTownActorRegistry(db);
  const id = registry.resolveAgentKey(-3).actorId;
  assert.equal(registry.getActor(id).participating, true);
  membership(db, 12, 0);
  registry.synchronize();
  assert.equal(registry.getActor(id).participating, false);
  assert.equal(registry.getActor(id).archived, false);
  membership(db, 12, 1);
  registry.synchronize();
  assert.equal(registry.resolveAgentKey(12).actorId, id);
  assert.equal(registry.getActor(id).participating, true);
  db.prepare('DELETE FROM town_characters WHERE character_id = 12').run();
  registry.synchronize();
  assert.equal(registry.getActor(id).actorId, id);
});

test('deleting linked character preserves NPC identity; re-invite preserves historical keys', t => {
  const db = fixture(t);
  npc(db, 3, 12);
  character(db, 12);
  membership(db, 12, 1);
  migrateTownSchema(db);
  const registry = createTownActorRegistry(db);
  const id = registry.resolveAgentKey(-3).actorId;
  db.prepare('DELETE FROM characters WHERE id = 12').run();
  registry.synchronize();
  assert.equal(registry.getActor(id).characterExists, false);
  assert.equal(registry.getActor(id).agentKey, 'npc:3');
  assert.equal(registry.getActor(id).archived, false);
  character(db, 13);
  assert.equal(registry.linkNpcCharacter(3, 13).actorId, id);
  registry.synchronize();
  assert.equal(registry.resolveAgentKey(12).actorId, id);
  assert.equal(registry.resolveAgentKey(13).actorId, id);
  db.prepare('DELETE FROM town_npcs WHERE id = 3').run();
  registry.synchronize();
  assert.equal(registry.getActor(id).npcExists, false);
  assert.equal(registry.getActor(id).archived, false);
  db.prepare('DELETE FROM characters WHERE id = 13').run();
  registry.synchronize();
  assert.equal(registry.getActor(id).archived, true);
  assert.equal(registry.getActor(id).participating, false);
  assert.equal(registry.resolveAgentKey(-3).actorId, id);
});

test('epoch fencing preserves world seed and actor IDs and rejects a stale callback transaction', t => {
  const db = fixture(t);
  npc(db, 3);
  const world = migrateTownSchema(db);
  const registry = createTownActorRegistry(db);
  const actors = dump(db, 'town_actors');
  const next = registry.advanceEpoch({ expectedEpoch: world.epoch });
  assert.deepEqual(next, { ...world, epoch: world.epoch + 1 });
  assert.equal(registry.getWorldEpoch(world.worldId), next.epoch);
  assert.equal(registry.getWorldEpoch('another-world'), null);
  assert.equal(registry.getActor(actors[0].actor_id, 'another-world'), null);
  assert.equal(registry.getActor(actors[0].actor_id, world.worldId).actorId, actors[0].actor_id);
  assert.throws(() => registry.advanceEpoch({ expectedEpoch: world.epoch }), { code: 'TOWN_STALE_EPOCH' });
  assert.throws(() => db.transaction(() => {
    db.prepare('UPDATE town_npcs SET town_enabled = 0').run();
    registry.assertEpoch(world.epoch);
  })(), { code: 'TOWN_STALE_EPOCH' });
  assert.equal(db.prepare('SELECT town_enabled FROM town_npcs').get().town_enabled, 1);
  assert.deepEqual(dump(db, 'town_actors'), actors);
  assert.deepEqual(migrateTownSchema(db), next);
  assert.throws(() => registry.advanceEpoch(), /expectedEpoch/);
});

test('map reset archives removed NPCs but preserves player/character identities through re-entry', t => {
  const db = fixture(t);
  npc(db, 3);
  character(db, 12);
  membership(db, 12, 1);
  db.exec("INSERT INTO town_maps (name, grid_cols, grid_rows) VALUES ('old map', 20, 20)");
  const world = migrateTownSchema(db);
  const registry = createTownActorRegistry(db);
  const playerId = registry.resolveAgentKey('me').actorId;
  const npcId = registry.resolveAgentKey(-3).actorId;
  const charId = registry.resolveAgentKey(12).actorId;
  db.prepare('UPDATE town_npcs SET town_enabled = 0 WHERE id = 3').run();
  registry.synchronize();
  assert.equal(registry.getActor(npcId).participating, false);
  db.prepare('UPDATE town_npcs SET town_enabled = 1 WHERE id = 3').run();
  registry.synchronize();
  assert.equal(registry.resolveAgentKey(-3).actorId, npcId);
  assert.equal(registry.getActor(npcId).participating, true);
  db.transaction(() => {
    registry.advanceEpoch({ expectedEpoch: world.epoch });
    db.exec('DELETE FROM town_characters; DELETE FROM town_npcs; DELETE FROM town_maps;');
    registry.synchronize();
  })();
  assert.equal(registry.getActor(npcId).archived, true);
  assert.equal(registry.getActor(charId).archived, false);
  assert.equal(registry.getActor(charId).participating, false);
  assert.equal(registry.resolveAgentKey('me').actorId, playerId);
  membership(db, 12, 1);
  registry.synchronize();
  assert.equal(registry.resolveAgentKey(12).actorId, charId);
  assert.equal(registry.getActor(charId).participating, true);
  assert.equal(registry.getWorldState().seed, world.seed);
  assert.equal(registry.getWorldState().worldId, world.worldId);
});

test('conflicting invitations and source corruption fail atomically', t => {
  const db = fixture(t);
  npc(db, 3, 12);
  npc(db, 4);
  character(db, 12);
  character(db, 13);
  migrateTownSchema(db);
  const registry = createTownActorRegistry(db);
  const before = dump(db, 'town_actors');
  assert.throws(() => registry.linkNpcCharacter(4, 12), /already linked/);
  assert.throws(() => registry.linkNpcCharacter(3, 13), /already linked/);
  assert.throws(() => registry.linkNpcCharacter(4, 99), /does not exist/);
  assert.deepEqual(dump(db, 'town_actors'), before);
  assert.equal(db.prepare('SELECT character_id FROM town_npcs WHERE id = 4').get().character_id, null);
  db.prepare('UPDATE town_npcs SET character_id = 12 WHERE id = 4').run();
  assert.throws(() => registry.synchronize(), /already linked/);
  assert.deepEqual(dump(db, 'town_actors'), before);
});

test('source mappings are unique even during retirement; only merge tombstones release them', t => {
  const db = fixture(t);
  npc(db, 3);
  character(db, 12);
  migrateTownSchema(db);
  for (const [column, value] of [['npc_id', 3], ['character_id', 12], ['player_id', 'me']]) {
    assert.throws(() => db.prepare(`INSERT INTO town_actors (actor_id, ${column}, archived) VALUES (?, ?, 1)`)
      .run(`duplicate-${column}`, value), /UNIQUE/);
  }
});

test('compatible early schemas receive missing columns, unknown layouts/versions roll back', t => {
  const db = fixture(t);
  db.exec(`CREATE TABLE town_world_state (singleton INTEGER PRIMARY KEY, world_id TEXT NOT NULL, seed TEXT NOT NULL);
    INSERT INTO town_world_state VALUES (1, 'existing-world', 'existing-seed');
    CREATE TABLE town_actors (actor_id TEXT PRIMARY KEY, player_id TEXT, npc_id INTEGER, character_id INTEGER);`);
  const world = migrateTownSchema(db);
  assert.equal(world.worldId, 'existing-world');
  assert.equal(world.seed, 'existing-seed');
  assert.equal(world.schemaVersion, 1);
  db.prepare('UPDATE town_world_state SET schema_version = 99').run();
  assert.throws(() => migrateTownSchema(db), /Unsupported town schema version/);
  assert.equal(db.prepare('SELECT schema_version FROM town_world_state').get().schema_version, 99);
  const invalid = fixture(t);
  invalid.exec('CREATE TABLE town_actors (id TEXT PRIMARY KEY)');
  assert.throws(() => migrateTownSchema(invalid), /missing actor_id/);
  assert.equal(invalid.prepare("SELECT name FROM sqlite_master WHERE name = 'town_world_state'").get(), undefined);
});

test('failed identity backfill rolls back migration DDL and version', t => {
  const db = fixture(t);
  character(db, 12);
  npc(db, 3, 12);
  npc(db, 4, 12);
  assert.throws(() => migrateTownSchema(db), /already linked/);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('town_world_state','town_actors')").all(), []);
});

test('registry requires injection and refuses malformed legacy keys', t => {
  assert.throws(() => createTownActorRegistry(), /explicit/);
  const db = fixture(t);
  migrateTownSchema(db);
  const registry = createTownActorRegistry(db);
  for (const key of [0, NaN, 1.5, {}, null, '', 'npc:0', 'npc:-1', 'char:01', 'npc:1x', 'char:9007199254740992']) {
    assert.equal(registry.resolveAgentKey(key), null);
  }
  assert.equal(registry.getActor('missing'), null);
});
