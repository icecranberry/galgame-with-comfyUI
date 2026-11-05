import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';

test('history endpoints omit empty days and final-turn deletion, while state reads never save drafts', async t => {
  process.env.DB_PATH = ':memory:';
  const { config } = await import('../src/config.js');
  config.dbPath = ':memory:';
  config.features.schedule = false;
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (String(url).endsWith('/object_info')) return Promise.resolve(new Response('{}'));
    assert.ok(String(url).startsWith('http://127.0.0.1:'), 'external requests are forbidden');
    return nativeFetch(url, options);
  });
  const { getGodRuntime } = await import('../src/services/godSays/runtime.js');
  const { default: router } = await import('../src/routes/godSays.js');
  const { repo } = getGodRuntime();
  const app = express();
  app.use(express.json());
  app.use('/api/god-says', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/god-says`;
  const get = async path => {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    return response.json();
  };
  const legacy = repo.today();
  repo.db.prepare("UPDATE god_sessions SET summary='当天没有对话。',summary_status='done' WHERE id=?").run(legacy.id);
  assert.deepEqual(await get('/sessions'), []);
  assert.deepEqual(await get('/memories'), []);
  for (let i = 0; i < 2; i++) {
    const state = await get('/state');
    assert.equal(state.session.id, null);
    assert.equal(state.current, true);
    assert.deepEqual(state.runs, []);
    assert.deepEqual(state.worldEvents, []);
  }
  assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM god_sessions').get().n, 0);
  const run = repo.start('history-first-message', '第一轮对话').run;
  repo.finish(run.id, 'completed');
  assert.deepEqual((await get('/sessions')).map(s => s.id), [run.session_id]);
  const blocked = repo.start('running-new-session', '尚在回应').run;
  assert.equal((await fetch(base + '/sessions', { method: 'POST' })).status, 409);
  repo.finish(blocked.id, 'completed');
  repo.deleteTurn(blocked.id);
  for (let i = 0; i < 3; i++) {
    const response = await fetch(base + '/sessions', { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).id, null);
  }
  assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM god_sessions').get().n, 1);
  assert.equal((await fetch(`${base}/sessions/${run.session_id}/summarize`, { method: 'POST' })).status, 410);
  assert.equal((await get('/state')).session.id, null);
  assert.deepEqual((await get('/sessions')).map(s => s.id), [run.session_id]);
  assert.equal((await get(`/state?session=${run.session_id}`)).current, false);
  assert.equal((await fetch(`${base}/runs/${run.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(await get('/sessions'), []);
  assert.deepEqual(await get('/memories'), []);
  assert.equal((await get('/state')).session.id, null);
  assert.throws(() => repo.start('history-first-message', '第一轮对话'), { status: 409 });
});
