import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import express, { Router } from 'express';
import Database from 'better-sqlite3';
import { ensureTownDialogueSchema } from '../src/db/townDialogueSchema.js';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { migrateTownServiceSessionSchema } from '../src/db/townServiceSessionSchema.js';
import * as requests from '../src/services/town/townDialogueRequests.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { findRoutineSlot } from '../src/services/town/routineSchedule.js';
import { listenLocalHttpServer as listen, closeLocalHttpServer as close } from './fixtures/localHttpServer.js';

// Compile the real service/router, replacing only import boundaries. Production DB,
// config, LLM clients and asset loaders are never imported or initialized.
function isolatedModule(path, dependencies, exports) {
  const names = [];
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g, (_, imports) => {
      names.push(...imports.split(',').map(name => name.trim()).filter(Boolean));
      return '';
    }).replace(/export (?=(?:async )?function )/g, '').replace(/export \{ router as default \};/, '');
  assert.doesNotMatch(source, /\bimport\s/);
  return compileFunction(`${source}\nreturn { ${exports.join(', ')} };`, names)(...names.map(name =>
    dependencies[name] ?? (() => { throw new Error(`Unexpected dependency: ${name}`); })));
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t, { modelTimeoutMs = 3000 } = {}) {
  const db = new Database(':memory:');
  const servers = [];
  const entered = deferred();
  const answer = deferred();
  const settled = deferred();
  t.after(async () => {
    answer.resolve('fixture cleanup');
    await Promise.all(servers.map(close));
    db.close();
  });
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE characters (id INTEGER PRIMARY KEY);
    CREATE TABLE town_characters (character_id INTEGER PRIMARY KEY, town_enabled INTEGER);
    CREATE TABLE town_npcs (id INTEGER PRIMARY KEY, map_id INTEGER, display_name TEXT,
      persona TEXT, job TEXT, home_location_id INTEGER, routine_json TEXT, traits_json TEXT,
      character_id INTEGER, town_enabled INTEGER);
    INSERT INTO town_npcs VALUES (7, 1, '咖啡店员', '友善', '店员', NULL, '[]', '{}', NULL, 1);
    CREATE TABLE town_npc_chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id INTEGER REFERENCES town_npcs(id), role TEXT NOT NULL, content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  migrateTownSchema(db);
  db.prepare('UPDATE town_world_state SET world_id = ?').run('http-world');
  migrateTownServiceSessionSchema(db);
  ensureTownDialogueSchema(db);
  let modelCalls = 0;
  const upstream = createServer(async (req, res) => {
    req.resume();
    entered.resolve();
    const text = await answer.promise;
    if (!res.destroyed) res.end(text);
  });
  servers.push(upstream);
  const upstreamUrl = await listen(upstream);
  const bubbles = [];
  const failureAttempts = [];
  const service = isolatedModule('../src/services/town/townNpcService.js', {
    getDb: () => db, createTownActorRegistry, findRoutineSlot, randomUUID, ...requests,
    failTownDialogueRequest: (connection, args) => {
      const attempt = { reason: args.error, reasonType: typeof args.error };
      failureAttempts.push(attempt);
      try { return requests.failTownDialogueRequest(connection, args); }
      catch (error) { attempt.rejectedWith = error.message; throw error; }
    },
    config: { town: { timeZone: 'Asia/Shanghai' }, features: { townLLM: true }, user: { nickname: '玩家' } },
    SPRITE_DIRECTIONS: ['down', 'up'], getAssetsByKey: () => [],
    broadcastTownBubble: event => bubbles.push(event),
    chatSync: async () => {
      modelCalls++;
      // Real local HTTP transport, short fixture-only deadline. No external model call.
      const response = await fetch(upstreamUrl, { signal: AbortSignal.timeout(modelTimeoutMs) });
      return response.text();
    },
  }, ['chatWithNpc', 'getNpcChatHistory']);
  const { router } = isolatedModule('../src/routes/town.js', {
    Router, getNpcChatHistory: service.getNpcChatHistory,
    chatWithNpc: async (...args) => {
      let error = null;
      try { return await service.chatWithNpc(...args); }
      catch (caught) { error = caught; throw caught; }
      finally { settled.resolve({ error }); }
    },
  }, ['router']);
  const app = express();
  app.use(express.json());
  app.use('/api/town', router);
  const server = createServer(app);
  servers.push(server);
  const url = await listen(server);
  const post = async (extra = {}, signal) => {
    const response = await fetch(`${url}/api/town/npcs/7/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ message: '你好', clientMessageId: 'http-m1', worldId: 'http-world', worldEpoch: 1, ...extra }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { db, entered, answer, settled, post, bubbles, failureAttempts, modelCalls: () => modelCalls,
    messages: () => db.prepare('SELECT role, content FROM town_npc_chat_messages ORDER BY id').all() };
}

test('HTTP concurrent duplicate/busy/conflict requests call model once; completed retry replays original response', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const first = f.post();
  await f.entered.promise;
  const duplicate = await f.post();
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'DIALOGUE_PROCESSING');
  const busy = await f.post({ clientMessageId: 'http-m2' });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, 'NPC_BUSY');
  const conflict = await f.post({ message: '换一条内容' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'DIALOGUE_PAYLOAD_CONFLICT');
  f.answer.resolve('欢迎光临。');
  const original = await first;
  assert.equal(original.status, 200);
  assert.equal(original.body.reply, '欢迎光临。');
  assert.deepEqual(await f.post(), original);
  assert.equal(f.modelCalls(), 1);
  assert.deepEqual(f.messages(), [{ role: 'user', content: '你好' }, { role: 'npc', content: '欢迎光临。' }]);
  assert.equal(f.bubbles.length, 1);
});

test('HTTP client disconnect after dispatch can retry completed request without another model call', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const pending = f.post({}, controller.signal);
  await f.entered.promise;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  f.answer.resolve('断网前的原回复');
  await f.settled.promise;
  const replay = await f.post();
  assert.equal(replay.status, 200);
  assert.equal(replay.body.reply, '断网前的原回复');
  assert.equal(f.modelCalls(), 1);
  assert.equal(f.messages().length, 2);
  assert.equal(f.bubbles.length, 1);
});

test('real local model transport timeout persists failed and retry never invokes model again', { timeout: 10000 }, async t => {
  const f = await fixture(t, { modelTimeoutMs: 80 });
  const initial = await f.post();
  // Wait on the real service's completion event as well as its HTTP response.
  // This event is emitted only after chatWithNpc's catch/settlement has returned.
  const settled = await f.settled.promise;
  assert.ok(initial.status >= 400);
  assert.equal(settled.error?.name, 'TimeoutError');
  assert.equal(f.db.prepare('SELECT status FROM town_dialogue_requests').get().status, 'failed',
    `Service catch already completed; failure attempts: ${JSON.stringify(f.failureAttempts)}`);
  const retry = await f.post();
  assert.equal(retry.status, 409);
  assert.equal(retry.body.code, 'DIALOGUE_FAILED');
  assert.equal(f.modelCalls(), 1);
  assert.deepEqual(f.messages(), []);
  assert.equal(f.bubbles.length, 0);
  f.answer.resolve('超时后的迟到回复');
  assert.equal((await f.post()).body.code, 'DIALOGUE_FAILED');
  assert.equal(f.modelCalls(), 1);
});

test('epoch changes during model request reject late response and roll back message pair', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const pending = f.post();
  await f.entered.promise;
  f.db.exec('UPDATE town_world_state SET epoch = 2');
  f.answer.resolve('旧世界的回复');
  assert.ok((await pending).status >= 400);
  assert.deepEqual(f.messages(), []);
  assert.equal(f.bubbles.length, 0);
  const stale = await f.post();
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'STALE_WORLD');
  assert.equal(f.modelCalls(), 1);
  const fresh = await f.post({ worldEpoch: 2 });
  assert.equal(fresh.status, 200);
  assert.equal(f.modelCalls(), 2);
  assert.equal(f.messages().length, 2);
});

test('NPC message insert fault rolls back user message and persists failed request without retry', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  f.db.exec(`CREATE TRIGGER fail_npc_message BEFORE INSERT ON town_npc_chat_messages
    WHEN NEW.role = 'npc' BEGIN SELECT RAISE(ABORT, 'fixture message fault'); END;`);
  f.answer.resolve('应当回滚');
  assert.ok((await f.post()).status >= 400);
  assert.deepEqual(f.messages(), []);
  assert.equal(f.db.prepare('SELECT status FROM town_dialogue_requests').get().status, 'failed');
  assert.equal((await f.post()).body.code, 'DIALOGUE_FAILED');
  assert.equal(f.modelCalls(), 1);
  assert.equal(f.bubbles.length, 0);
});

test('real service-session schema rejects provider busy before model invocation', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const actor = createTownActorRegistry(f.db).resolveAgentKey('npc:7');
  assert.ok(actor);
  f.db.prepare(`INSERT INTO town_service_sessions
    (session_id,world_id,world_epoch,actor_id,provider_actor_id,status,phase,
      created_at,updated_at,offer_expires_at,escrow_account_id,config_json)
    VALUES ('busy-fixture','http-world',1,'player-fixture',?,'active','opening',0,0,9999999999999,'escrow-fixture','{}')`)
    .run(actor.actorId);
  const result = await f.post();
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'NPC_BUSY');
  assert.equal(f.modelCalls(), 0);
  assert.deepEqual(f.messages(), []);
  assert.equal(f.db.prepare('SELECT status FROM town_dialogue_requests').get().status, 'failed');
  assert.equal((await f.post()).body.code, 'DIALOGUE_FAILED');
});
