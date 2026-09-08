import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { Router } from 'express';
import Database from 'better-sqlite3';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { validateCharacterTownContext, createCharacterTownChatGuard, buildCharacterTownSceneBlock } from '../src/services/characterChatTownContext.js';
import { buildChatContext } from '../src/services/contextAssembler.js';

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE characters (id INTEGER PRIMARY KEY, display_name TEXT, sleep_until TEXT);
    INSERT INTO characters VALUES (1, 'fixture', NULL), (2, 'other', NULL);
    CREATE TABLE town_npcs (id INTEGER PRIMARY KEY, character_id INTEGER, town_enabled INTEGER);
    CREATE TABLE town_characters (character_id INTEGER PRIMARY KEY, town_enabled INTEGER);
    INSERT INTO town_characters VALUES (1, 1), (2, 1);
    CREATE TABLE raw_messages (id INTEGER PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, client_msg_id TEXT);
    CREATE TABLE messages (id INTEGER PRIMARY KEY, conversation_id TEXT, raw_id INTEGER, role TEXT, content TEXT, images TEXT, seq INTEGER);
    CREATE TABLE reply_queue (id INTEGER PRIMARY KEY, character_id INTEGER, conversation_id TEXT, user_raw_msg_id INTEGER,
      user_msg_id INTEGER, user_content TEXT, client_msg_id TEXT, scheduled_reply_at TEXT, current_activity TEXT,
      delay_minutes INTEGER, status TEXT DEFAULT 'waiting');
  `);
  migrateTownSchema(db);
  const registry = createTownActorRegistry(db);
  const world = registry.getWorldState();
  const actor = registry.resolveAgentKey('char:1');
  const snapshot = { enabled: true, initialized: true, worldId: world.worldId, worldEpoch: world.epoch,
    serverTime: 10000, map: { cols: 20, rows: 20 },
    player: { actorId: registry.resolveAgentKey('me').actorId, x: 1, y: 1, path: [] },
    agents: [{ actorId: actor.actorId, characterId: 1, x: 2, y: 1, path: [] }],
  };
  const townContext = { worldId: world.worldId, worldEpoch: world.epoch, actorId: actor.actorId };
  const getTownState = () => structuredClone(snapshot);
  const validate = (patch = {}, characterId = '1') => validateCharacterTownContext({
    db, characterId, townContext: { ...townContext, ...patch }, getTownState,
  });
  return { db, registry, snapshot, townContext, getTownState, validate };
}

test('valid admission uses canonical character/player identities and server cells without changing client context', t => {
  const f = fixture(t);
  const before = JSON.stringify(f.townContext);
  const result = f.validate();
  assert.deepEqual(result.playerCell, { x: 1, y: 1 });
  assert.deepEqual(result.characterCell, { x: 2, y: 1 });
  assert.equal(result.characterId, 1);
  assert.equal(JSON.stringify(f.townContext), before);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM raw_messages').get().n, 0);
});

test('rejects stale world/epoch, wrong character, retired identity, opt-out and missing source', t => {
  const f = fixture(t);
  const code = (call, expected) => assert.throws(call, error => error.code === expected);
  code(() => f.validate({ worldId: 'foreign' }), 'TOWN_CHAT_STALE_WORLD');
  code(() => f.validate({ worldEpoch: 2 }), 'TOWN_CHAT_STALE_WORLD');
  code(() => f.validate({}, '2'), 'TOWN_CHAT_ACTOR_UNAVAILABLE');
  code(() => f.validate({}, '1suffix'), 'TOWN_CHAT_CHARACTER_INVALID');
  const actorId = f.townContext.actorId;
  f.db.prepare('UPDATE town_actors SET participating = 0 WHERE actor_id = ?').run(actorId);
  code(() => f.validate(), 'TOWN_CHAT_ACTOR_UNAVAILABLE');
  f.db.prepare('UPDATE town_actors SET participating = 1, archived = 1 WHERE actor_id = ?').run(actorId);
  code(() => f.validate(), 'TOWN_CHAT_ACTOR_UNAVAILABLE');
  f.db.prepare('UPDATE town_actors SET archived = 0 WHERE actor_id = ?').run(actorId);
  f.db.exec('DELETE FROM characters WHERE id = 1');
  code(() => f.validate(), 'TOWN_CHAT_ACTOR_UNAVAILABLE');
});

test('structured input rejects client prompt/location/coordinates and malformed context', t => {
  const f = fixture(t);
  for (const context of [null, [], 'text', {}, { ...f.townContext, worldEpoch: '1' },
    { ...f.townContext, prompt: 'pretend nearby' }, { ...f.townContext, x: 1 },
    { ...f.townContext, locationName: 'nearby' }]) {
    assert.throws(() => validateCharacterTownContext({ db: f.db, characterId: '1', townContext: context,
      getTownState: () => assert.fail('malformed context must fail before snapshot') }),
    error => error.code === 'TOWN_CHAT_CONTEXT_INVALID');
  }
});

test('town chat cannot interrupt a paid service participant', t => {
  const f = fixture(t);
  f.snapshot.agents[0].busyReason = 'SERVICE_BUSY';
  assert.throws(() => f.validate(), { code: 'TOWN_CHAT_BUSY' });
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n, 0);
});

test('scene prompt uses the observed place and preserves ordinary chat context byte for byte', t => {
  const f = fixture(t);
  f.snapshot.locations = [{ name: '已到达的广场', x: 2, y: 1, radius: 0 }, { name: '尚未到达的工坊', x: 9, y: 9, radius: 0 }];
  f.snapshot.agents[0].locationName = '尚未到达的工坊';
  const block = buildCharacterTownSceneBlock(f.validate());
  assert.match(block, /已到达的广场/);
  assert.ok(!block.includes('尚未到达的工坊'));
  assert.match(block, /消息发出时/);
  const input = { stableBlocks: ['原人格'], history: [{ role: 'user', content: '你好' }], dynamicBlocks: ['原现场'] };
  assert.deepEqual(buildChatContext({ ...input, dynamicBlocks: [...input.dynamicBlocks, buildCharacterTownSceneBlock(null)] }), buildChatContext(input));
});

test('checks server world, residency, duplicate entities and player identity', t => {
  const f = fixture(t);
  const baseline = structuredClone(f.snapshot);
  for (const patch of [
    { enabled: false }, { initialized: false }, { player: null }, { worldEpoch: 2 },
    { agents: [] }, { agents: [baseline.agents[0], baseline.agents[0]] },
    { player: { ...baseline.player, actorId: 'wrong' } },
  ]) {
    Object.assign(f.snapshot, baseline, patch);
    assert.throws(() => f.validate(), error => error.status === 409);
  }
});

test('completed path edges determine proximity; neither render origin nor destination grants admission', t => {
  const f = fixture(t);
  f.snapshot.player = { ...f.snapshot.player, x: 0, y: 1, path: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], speed: 1, startedAt: 8000 };
  f.snapshot.agents[0].x = 4;
  assert.deepEqual(f.validate().playerCell, { x: 2, y: 1 });
  f.snapshot.serverTime = 8999;
  assert.throws(() => f.validate(), error => error.code === 'TOWN_CHAT_TOO_FAR');
  f.snapshot.serverTime = 10000;
  f.snapshot.agents[0] = { ...f.snapshot.agents[0], x: 4, path: [{ x: 5, y: 1 }], speed: 1, startedAt: 9000 };
  assert.throws(() => f.validate(), error => error.code === 'TOWN_CHAT_TOO_FAR');
  f.snapshot.agents[0].speed = NaN;
  assert.throws(() => f.validate(), error => error.code === 'TOWN_CHAT_POSITION_UNAVAILABLE');
});

test('legacy middleware is an exact bypass without accessing DB or town runtime', () => {
  const guard = createCharacterTownChatGuard({ getDb: () => assert.fail('DB access'), getTownState: () => assert.fail('town access') });
  const req = { body: { message: 'original' } };
  let passed = 0;
  guard(req, {}, () => passed++);
  assert.equal(passed, 1);
  assert.deepEqual(req.body, { message: 'original' });
});

test('invited NPC uses canonical linked actor and original character history identity; merge tombstone is rejected', t => {
  const f = fixture(t);
  const previousActorId = f.townContext.actorId;
  f.db.exec('INSERT INTO town_npcs VALUES (7, NULL, 1)');
  f.registry.synchronize();
  const linked = f.registry.linkNpcCharacter(7, 1);
  f.snapshot.agents[0].actorId = linked.actorId;
  f.snapshot.agents[0].npcId = 7;
  assert.equal(f.validate({ actorId: linked.actorId }).characterId, 1);
  assert.throws(() => f.validate({ actorId: previousActorId }), error => error.code === 'TOWN_CHAT_ACTOR_UNAVAILABLE');
});

// Real route registration + body, replacing import boundaries only. No production module graph.
function routeFixture(f) {
  const names = [];
  const source = readFileSync(new URL('../src/routes/chat.js', import.meta.url), 'utf8')
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g, (_, imports) => {
      names.push(...imports.split(',').map(n => n.trim()).filter(Boolean)); return '';
    }).replace(/export function /g, 'function ').replace('export default router;', '');
  assert.doesNotMatch(source, /\bimport\s/);
  let delayReads = 0;
  const deps = { Router, getDb: () => f.db, getTownState: f.getTownState, createCharacterTownChatGuard,
    config: { features: { schedule: true } }, getCharacterEmojiMap: () => new Map(), buildEmojiNote: () => '',
    parseEmojiText: message => ({ content: message, images: [] }),
    getReplyDelay: () => { delayReads++; return { delay: 5, activity: 'fixture activity' }; },
    resetUnansweredStreak: () => {},
  };
  const router = compileFunction(`${source}\nreturn router;`, names)(...names.map(name => deps[name] ?? (() => assert.fail(`Unexpected dependency ${name}`))));
  const route = router.stack.find(layer => layer.route?.path === '/characters/:id/chat').route;
  assert.equal(route.stack.length, 2, 'one admission guard followed by original handler');
  async function request(body) {
    const req = { params: { id: '1' }, body };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await route.stack[0].handle(req, res, error => {
      if (error) throw error;
      return route.stack[1].handle(req, res);
    });
    return res;
  }
  return { request, delayReads: () => delayReads };
}

test('real chat route rejects town context before messages, reply queue, schedule or model access', async t => {
  const f = fixture(t);
  const route = routeFixture(f);
  const response = await route.request({ message: 'original text', townContext: { ...f.townContext, worldEpoch: 2 } });
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, 'TOWN_CHAT_STALE_WORLD');
  assert.equal(route.delayReads(), 0);
  for (const table of ['raw_messages', 'messages', 'reply_queue']) assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
});

test('real queued route preserves conversation, verbatim user text, delay and client message idempotency', async t => {
  const f = fixture(t);
  const route = routeFixture(f);
  const body = { message: '原始用户文本', client_msg_id: 'fixture-one', townContext: f.townContext };
  for (let i = 0; i < 2; i++) {
    const response = await route.request(body);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.queued, true);
    assert.equal(response.body.delayMinutes, 5);
  }
  assert.deepEqual(f.db.prepare('SELECT conversation_id, content, client_msg_id FROM raw_messages').all(),
    [{ conversation_id: 'char_1', content: '原始用户文本', client_msg_id: 'fixture-one' }]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
  assert.deepEqual(f.db.prepare('SELECT conversation_id, user_content FROM reply_queue').all(),
    [{ conversation_id: 'char_1', user_content: '原始用户文本' }]);
  const legacy = await route.request({ message: '普通聊天', client_msg_id: 'fixture-two' });
  assert.equal(legacy.body.queued, true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM reply_queue').get().n, 2);
});
