import { randomUUID } from 'node:crypto';

/**
 * M0 identity registry. Call migrateTownSchema(db) once before constructing.
 * All methods are synchronous. Read methods never synchronize implicitly.
 *
 * npc_id/character_id are historical references, deliberately not cascading
 * foreign keys: source deletion must not delete identity/history. DTO existence
 * flags distinguish a historical reference from a live association. Legacy IDs
 * use AUTOINCREMENT; callers must not manually recycle deleted source IDs.
 * A merged actor remains readable via getActor(id, { followMerged: false }).
 * Source membership is authoritative; synchronize after source writes/deletes.
 */
export function createTownActorRegistry(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('An explicit better-sqlite3 db connection is required');
  }
  const row = id => db.prepare('SELECT * FROM town_actors WHERE actor_id = ?').get(id);
  const source = (table, id) => id == null ? undefined : db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  const byRef = (column, id) => db.prepare(`SELECT * FROM town_actors WHERE ${column} = ? AND merged_into IS NULL`).get(id);
  const ensure = (column, id) => {
    const existing = byRef(column, id);
    if (existing) return existing;
    const actorId = randomUUID();
    db.prepare(`INSERT INTO town_actors (actor_id, ${column}) VALUES (?, ?)`).run(actorId, id);
    return row(actorId);
  };
  function dto(actor) {
    if (!actor) return null;
    const npcExists = !!source('town_npcs', actor.npc_id);
    const characterExists = !!source('characters', actor.character_id);
    return {
      actorId: actor.actor_id, playerId: actor.player_id,
      npcId: actor.npc_id, characterId: actor.character_id,
      npcExists, characterExists,
      participating: !!actor.participating, archived: !!actor.archived,
      mergedInto: actor.merged_into,
      agentKey: actor.player_id === 'me' ? 'me'
        : characterExists ? `char:${actor.character_id}`
          : npcExists ? `npc:${actor.npc_id}` : null,
    };
  }
  function getActor(actorId, worldIdOrOptions, options = {}) {
    const worldId = typeof worldIdOrOptions === 'string' ? worldIdOrOptions : null;
    if (worldId !== null && getWorldState().worldId !== worldId) return null;
    const { followMerged = true } = (typeof worldIdOrOptions === 'object' && worldIdOrOptions !== null)
      ? worldIdOrOptions : options;
    let actor = row(actorId);
    const seen = new Set();
    while (followMerged && actor?.merged_into) {
      if (seen.has(actor.actor_id)) throw new Error('Actor merge cycle');
      seen.add(actor.actor_id);
      actor = row(actor.merged_into);
      if (!actor) throw new Error('Missing actor merge target');
    }
    return dto(actor);
  }
  function getWorldState() {
    const state = db.prepare('SELECT * FROM town_world_state WHERE singleton = 1').get();
    if (!state) throw new Error('Town schema has not been migrated');
    return { worldId: state.world_id, epoch: state.epoch, seed: state.seed, schemaVersion: state.schema_version };
  }
  function getWorldEpoch(worldId) {
    const world = getWorldState();
    return world.worldId === worldId ? world.epoch : null;
  }
  function assertEpoch(expectedEpoch) {
    if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 1) throw new TypeError('expectedEpoch must be a positive safe integer');
    const world = getWorldState();
    if (world.epoch !== expectedEpoch) {
      const error = new Error(`Stale town epoch: expected ${expectedEpoch}, current ${world.epoch}`);
      error.code = 'TOWN_STALE_EPOCH';
      throw error;
    }
    return world;
  }
  function refresh() {
    const npcs = new Map(db.prepare('SELECT * FROM town_npcs').all().map(n => [n.id, n]));
    const characters = new Set(db.prepare('SELECT id FROM characters').all().map(c => c.id));
    const members = new Map(db.prepare('SELECT character_id, town_enabled FROM town_characters').all().map(c => [c.character_id, c.town_enabled]));
    const update = db.prepare('UPDATE town_actors SET participating = ?, archived = ? WHERE actor_id = ?');
    for (const actor of db.prepare('SELECT * FROM town_actors WHERE merged_into IS NULL').all()) {
      const npc = npcs.get(actor.npc_id);
      const hasCharacter = characters.has(actor.character_id);
      const alive = actor.player_id === 'me' || !!npc || hasCharacter;
      // An invited NPC stays resident until a character membership choice exists.
      // Once present, even an explicit opt-out overrides NPC's old enabled flag.
      const enabled = actor.player_id === 'me' || (hasCharacter && members.has(actor.character_id)
        ? members.get(actor.character_id) === 1 : npc?.town_enabled === 1);
      update.run(Number(alive && enabled), Number(!alive), actor.actor_id);
    }
  }
  function merge(npcId, characterId) {
    const npcActor = ensure('npc_id', npcId);
    const charActor = byRef('character_id', characterId);
    if (npcActor.character_id != null && npcActor.character_id !== characterId
        && source('characters', npcActor.character_id)) {
      throw new Error(`NPC ${npcId} already linked to character ${npcActor.character_id}`);
    }
    if (charActor && charActor.actor_id !== npcActor.actor_id) {
      if (charActor.npc_id != null && charActor.npc_id !== npcId) {
        throw new Error(`Character ${characterId} already linked to NPC ${charActor.npc_id}`);
      }
      db.prepare('UPDATE town_actors SET archived = 1, participating = 0, merged_into = ? WHERE actor_id = ?')
        .run(npcActor.actor_id, charActor.actor_id);
    }
    if (npcActor.character_id != null && npcActor.character_id !== characterId) {
      // Keep the deleted character's encounter key resolvable after re-inviting.
      db.prepare(`INSERT INTO town_actors (actor_id, character_id, archived, merged_into)
        VALUES (?, ?, 1, ?)`).run(randomUUID(), npcActor.character_id, npcActor.actor_id);
    }
    db.prepare('UPDATE town_actors SET character_id = ? WHERE actor_id = ?').run(characterId, npcActor.actor_id);
    return npcActor.actor_id;
  }
  const synchronize = db.transaction(() => {
    ensure('player_id', 'me'); // Identity exists before a map or player sprite does.
    const npcs = db.prepare('SELECT * FROM town_npcs ORDER BY id').all();
    for (const npc of npcs) ensure('npc_id', npc.id);
    for (const character of db.prepare('SELECT id FROM characters ORDER BY id').all()) ensure('character_id', character.id);
    for (const npc of npcs) {
      if (source('characters', npc.character_id)) merge(npc.id, npc.character_id);
    }
    refresh();
    return db.prepare('SELECT actor_id FROM town_actors WHERE merged_into IS NULL ORDER BY actor_id').all()
      .map(a => getActor(a.actor_id));
  });
  /** Atomically persist the legacy invitation link and merge registry identities.
   * Does not create a character, move assets or change residency. Safe to repeat.
   * May be nested in the caller's invitation transaction.
   */
  const linkNpcCharacter = db.transaction((npcId, characterId) => {
    if (!Number.isSafeInteger(npcId) || !Number.isSafeInteger(characterId) || npcId < 1 || characterId < 1) {
      throw new TypeError('NPC and character IDs must be positive safe integers');
    }
    const npc = source('town_npcs', npcId);
    if (!npc || !source('characters', characterId)) throw new Error('NPC or character does not exist');
    if (npc.character_id != null && npc.character_id !== characterId && source('characters', npc.character_id)) {
      throw new Error(`NPC ${npcId} already linked to character ${npc.character_id}`);
    }
    const other = db.prepare('SELECT id FROM town_npcs WHERE character_id = ? AND id <> ?').get(characterId, npcId);
    if (other) throw new Error(`Character ${characterId} already linked to NPC ${other.id}`);
    const actorId = merge(npcId, characterId);
    db.prepare('UPDATE town_npcs SET character_id = ? WHERE id = ?').run(characterId, npcId);
    refresh();
    return getActor(actorId);
  });
  /** Accept 'me', 'npc:N', 'char:N', or historical signed encounter IDs.
   * Returns the canonical actor DTO (including retired identities), or null.
   */
  function resolveAgentKey(key) {
    if (key === 'me') return dto(byRef('player_id', 'me'));
    if (typeof key === 'number') {
      if (!Number.isSafeInteger(key) || key === 0) return null;
      key = key < 0 ? `npc:${-key}` : `char:${key}`;
    }
    if (typeof key !== 'string') return null;
    const match = /^(npc|char):([1-9]\d*)$/.exec(key);
    if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
    const column = match[1] === 'npc' ? 'npc_id' : 'character_id';
    const actor = byRef(column, Number(match[2])) || db.prepare(
      `SELECT * FROM town_actors WHERE ${column} = ? AND merged_into IS NOT NULL ORDER BY actor_id LIMIT 1`,
    ).get(Number(match[2]));
    return actor ? getActor(actor.actor_id) : null;
  }
  /** Epoch fence only: preserve seed, worldId and identities. The caller owns
   * stopping work/clearing the scene and can wrap both in the same transaction.
   * To guard a callback, call assertEpoch inside its DB write transaction.
   */
  const advanceEpoch = db.transaction(({ expectedEpoch } = {}) => {
    assertEpoch(expectedEpoch);
    if (expectedEpoch === Number.MAX_SAFE_INTEGER) throw new RangeError('Town epoch exhausted');
    db.prepare('UPDATE town_world_state SET epoch = epoch + 1 WHERE singleton = 1').run();
    return getWorldState();
  });
  return { synchronize, resolveAgentKey, getActor, linkNpcCharacter, getWorldState, getWorldEpoch, assertEpoch, advanceEpoch };
}
