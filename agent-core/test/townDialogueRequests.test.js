import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { ensureTownDialogueSchema } from '../src/db/townDialogueSchema.js';
import { beginTownDialogueRequest as begin, finishTownDialogueRequest as finish,
  failTownDialogueRequest as fail, cleanupTownDialogueRequests as cleanup } from '../src/services/town/townDialogueRequests.js';

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE town_world_state (singleton INTEGER PRIMARY KEY, world_id TEXT, epoch INTEGER);
    INSERT INTO town_world_state VALUES (1, 'world-a', 1);
    CREATE TABLE messages (request_id TEXT, role TEXT, content TEXT);`);
  ensureTownDialogueSchema(db);
  return db;
}
const request = (extra = {}) => ({ worldId: 'world-a', epoch: 1, npcId: 7, clientMessageId: 'm1', payload: { message: '你好' }, ...extra });
const terminal = (begun, extra = {}) => ({ worldId: 'world-a', epoch: 1, npcId: 7, requestId: begun.requestId, ...extra });
const code = expected => error => error.code === expected;

test('repeatable schema; same payload reordered keys reuses processing claim without another LLM', t => {
  const db = fixture(t);
  const a = request({ payload: { message: '你好', options: { b: 2, a: 1 } } });
  const first = begin(db, a);
  ensureTownDialogueSchema(db);
  const second = begin(db, { ...a, payload: { options: { a: 1, b: 2 }, message: '你好' } });
  assert.equal(first.started, true);
  assert.equal(first.status, 'processing');
  assert.deepEqual(second, { ...first, started: false });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM town_dialogue_requests').get().n, 1);
});

test('same key different payload rejected in every state; only one processing request per NPC', t => {
  const db = fixture(t);
  const first = begin(db, request());
  assert.throws(() => begin(db, request({ payload: { message: '变更' } })), code('DIALOGUE_PAYLOAD_CONFLICT'));
  assert.throws(() => begin(db, request({ clientMessageId: 'm2' })), code('NPC_BUSY'));
  assert.equal(begin(db, request({ npcId: 8 })).started, true);
  finish(db, terminal(first, { reply: { text: '原回复', messageId: 10 } }));
  assert.throws(() => begin(db, request({ payload: { message: '变更' } })), code('DIALOGUE_PAYLOAD_CONFLICT'));
  const next = begin(db, request({ clientMessageId: 'm2' }));
  fail(db, terminal(next, { error: 'LLM_TIMEOUT' }));
  assert.throws(() => begin(db, request({ clientMessageId: 'm2', payload: { message: '变更' } })), code('DIALOGUE_PAYLOAD_CONFLICT'));
});

test('completed replay returns original reply; failed replay never restarts; both are irreversible', t => {
  const db = fixture(t);
  const first = begin(db, request());
  const reply = { reply: '欢迎\n你好', history: [{ id: 3, role: 'npc' }], flag: false };
  finish(db, terminal(first, { reply }));
  reply.reply = '调用方后续修改';
  const replay = begin(db, request());
  assert.equal(replay.started, false);
  assert.equal(replay.reply.reply, '欢迎\n你好');
  assert.deepEqual(replay.reply.history, [{ id: 3, role: 'npc' }]);
  assert.throws(() => finish(db, terminal(first, { reply: '覆盖' })), code('DIALOGUE_REQUEST_NOT_PROCESSING'));
  assert.throws(() => fail(db, terminal(first, { error: '覆盖' })), code('DIALOGUE_REQUEST_NOT_PROCESSING'));
  const next = begin(db, request({ clientMessageId: 'm2' }));
  fail(db, terminal(next, { error: 'GENERATION_FAILED' }));
  assert.deepEqual(begin(db, request({ clientMessageId: 'm2' })), {
    started: false, requestId: next.requestId, status: 'failed', reply: null, error: 'GENERATION_FAILED',
  });
  assert.throws(() => finish(db, terminal(next, { reply: '迟到回包' })), code('DIALOGUE_REQUEST_NOT_PROCESSING'));
  assert.equal(begin(db, request({ clientMessageId: 'm3' })).started, true);
});

test('world/epoch isolation rejects stale begin and settlement, old claims cannot lock new world', t => {
  const db = fixture(t);
  const old = begin(db, request());
  db.exec('UPDATE town_world_state SET epoch = 2');
  assert.throws(() => begin(db, request()), code('STALE_WORLD'));
  assert.throws(() => finish(db, terminal(old, { reply: '迟到' })), code('STALE_WORLD'));
  assert.throws(() => fail(db, terminal(old, { error: '迟到' })), code('STALE_WORLD'));
  const current = begin(db, request({ epoch: 2 }));
  assert.notEqual(current.requestId, old.requestId);
  assert.throws(() => finish(db, terminal(old, { epoch: 2, reply: '串世界' })), code('DIALOGUE_REQUEST_NOT_FOUND'));
  assert.throws(() => finish(db, terminal(current, { epoch: 2, npcId: 8, reply: '串 NPC' })), code('DIALOGUE_REQUEST_NOT_FOUND'));
  db.exec("UPDATE town_world_state SET world_id = 'world-b', epoch = 1");
  assert.equal(begin(db, request({ worldId: 'world-b' })).started, true);
  assert.throws(() => begin(db, request({ epoch: 2 })), code('STALE_WORLD'));
});

test('caller transaction atomically commits/rolls back messages and completion, duplicate finish rolls back inserts', t => {
  const db = fixture(t);
  const first = begin(db, request());
  const saveMessages = () => {
    db.prepare('INSERT INTO messages VALUES (?, ?, ?)').run(first.requestId, 'npc', '你好');
    finish(db, terminal(first, { reply: '你好' }));
  };
  assert.throws(() => db.transaction(() => { saveMessages(); throw new Error('fault after finish'); })(), /fault/);
  assert.equal(begin(db, request()).status, 'processing');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);
  db.transaction(saveMessages)();
  assert.equal(begin(db, request()).reply, '你好');
  assert.throws(() => db.transaction(saveMessages)(), code('DIALOGUE_REQUEST_NOT_PROCESSING'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
});

test('caller transaction can roll back failure or begin without leaking state', t => {
  const db = fixture(t);
  assert.throws(() => db.transaction(() => { begin(db, request()); throw new Error('abort'); })());
  const first = begin(db, request());
  assert.equal(first.started, true);
  assert.throws(() => db.transaction(() => {
    db.prepare('INSERT INTO messages VALUES (?, ?, ?)').run(first.requestId, 'user', '你好');
    fail(db, terminal(first, { error: 'LLM_FAILED' }));
    throw new Error('abort');
  })());
  assert.equal(begin(db, request()).status, 'processing');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);
});

test('startup cleanup fails only abandoned processing rows, is repeatable, rejects late completions', t => {
  const db = fixture(t);
  const completed = begin(db, request());
  finish(db, terminal(completed, { reply: '保留' }));
  const abandoned = begin(db, request({ clientMessageId: 'm2' }));
  begin(db, request({ npcId: 8 }));
  assert.deepEqual(cleanup(db), { failedCount: 2 });
  assert.deepEqual(cleanup(db), { failedCount: 0 });
  assert.equal(begin(db, request()).reply, '保留');
  assert.equal(begin(db, request({ clientMessageId: 'm2' })).error, 'PROCESS_INTERRUPTED');
  assert.equal(begin(db, request({ clientMessageId: 'm2' })).started, false);
  assert.throws(() => finish(db, terminal(abandoned, { reply: '迟到' })), code('DIALOGUE_REQUEST_NOT_PROCESSING'));
  assert.equal(begin(db, request({ clientMessageId: 'm3' })).started, true);
});

test('invalid identity and non-JSON payload rejected before inserting a claim', t => {
  const db = fixture(t);
  const cyclic = {}; cyclic.self = cyclic;
  for (const override of [
    { worldId: '' }, { epoch: 0 }, { npcId: '7' }, { clientMessageId: ' ' },
    { payload: undefined }, { payload: { bad: undefined } }, { payload: [NaN] },
    { payload: cyclic }, { payload: new Date() }, { payload: 1n }, { payload: new Array(2) },
  ]) assert.throws(() => begin(db, request(override)), TypeError);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM town_dialogue_requests').get().n, 0);
});

test('two independent connections racing for one NPC admit exactly one request', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'town-dialogue-fixture-'));
  const dbPath = join(directory, 'fixture.db');
  const db = new Database(dbPath);
  const workers = [];
  t.after(async () => {
    await Promise.all(workers.map(worker => worker.terminate()));
    db.close();
    // Only the directory returned by mkdtemp above; never a configured production path.
    rmSync(directory, { recursive: true, force: true });
  });
  db.exec(`CREATE TABLE town_world_state (singleton INTEGER PRIMARY KEY, world_id TEXT, epoch INTEGER);
    INSERT INTO town_world_state VALUES (1, 'world-a', 1);`);
  ensureTownDialogueSchema(db);
  const workerCode = `
    const { parentPort, workerData } = require('node:worker_threads');
    const Database = require(workerData.sqlite);
    (async () => {
      const { beginTownDialogueRequest } = await import(workerData.service);
      const db = new Database(workerData.path);
      parentPort.once('message', () => {
        try { parentPort.postMessage({ result: beginTownDialogueRequest(db, workerData.request) }); }
        catch (error) { parentPort.postMessage({ code: error.code, message: error.message }); }
        finally { db.close(); parentPort.close(); }
      });
      parentPort.postMessage({ ready: true });
    })();
  `;
  const pending = ['race-a', 'race-b'].map(clientMessageId => {
    const worker = new Worker(workerCode, { eval: true, workerData: {
      sqlite: createRequire(import.meta.url).resolve('better-sqlite3'), path: dbPath,
      service: new URL('../src/services/town/townDialogueRequests.js', import.meta.url).href,
      request: request({ clientMessageId }),
    } });
    workers.push(worker);
    const ready = new Promise((resolve, reject) => {
      worker.once('message', resolve); worker.once('error', reject);
    });
    const result = new Promise((resolve, reject) => {
      worker.on('message', message => { if (!message.ready) resolve(message); });
      worker.once('error', reject);
      worker.once('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}`)); });
    });
    return { ready, result };
  });
  await Promise.all(pending.map(item => item.ready));
  workers.forEach(worker => worker.postMessage('go'));
  const results = await Promise.all(pending.map(item => item.result));
  assert.equal(results.filter(item => item.result?.started).length, 1);
  assert.equal(results.filter(item => item.code === 'NPC_BUSY').length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM town_dialogue_requests').get().n, 1);
});
