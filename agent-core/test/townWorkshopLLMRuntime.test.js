import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { listenLocalHttpServer, closeLocalHttpServer } from './fixtures/localHttpServer.js';

const wallclockTimeout = process.env.TOWN_WORKSHOP_WALLCLOCK_TIMEOUT === '1';

// Set before importing the production config/db graph. Never persist LLM settings.
process.env.DB_PATH = ':memory:';
const nativeFetch = globalThis.fetch;
let endpoint;
globalThis.fetch = (url, options) => {
  const target = String(url?.url || url);
  if (target.endsWith('/object_info')) return Promise.resolve({ ok: true, json: async () => ({}) });
  if (endpoint && target.startsWith(`${endpoint}/`)) return nativeFetch(url, options);
  throw new Error('External network forbidden in workshop LLM fixture');
};
// The installed SDK may use node-fetch instead of global fetch. Guard that path too.
const nativeRequest = http.request;
http.request = function (url, ...args) {
  const target = typeof url === 'string' || url instanceof URL ? new URL(url) : url;
  assert.equal(target.hostname, '127.0.0.1', 'only fixture loopback requests allowed');
  assert.equal(String(target.port), new URL(endpoint).port);
  return nativeRequest.call(this, url, ...args);
};
const nativeHttpsRequest = https.request;
https.request = () => { throw new Error('HTTPS forbidden in workshop LLM fixture'); };

const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const economy = await import('../src/services/town/townEconomyRuntime.js');
const { resetClient } = await import('../src/llm/llm-client.js');

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function expression(scene) {
  return { schemaVersion: 1, narration: '师傅轻轻摆好工具。', speakerKey: scene.speakerKey,
    dialogue: '我们一起把这份心意做好。', intentKey: scene.input.intentKey,
    suggestedPhaseKey: scene.phaseKey,
    choices: [{ intentKey: scene.allowedIntents[0], label: '继续一起制作' }],
    ending: { decision: 'continue', outcomeKey: null, reason: '', evidenceTurnIds: [] }, memorySummary: '' };
}
function reply(res, content) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
}

test('production workshop LLM: bounded JSON, local fallback, and reset abort fence', { timeout: wallclockTimeout ? 30000 : 15000 }, async t => {
  let now = Date.parse('2026-09-08T10:00:00+08:00');
  t.mock.method(Date, 'now', () => now);
  const requests = [];
  let mode = 'valid', arrived = deferred(), closed = deferred(), heldResponse;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const system = body.messages[0].content;
    const scene = JSON.parse(system.split('服务端事实与白名单：\n')[1].split('\n完整输出格式：')[0]);
    requests.push({ body, headers: req.headers, scene });
    res.on('close', () => closed.resolve());
    if (mode === 'hang') heldResponse = res;
    else reply(res, mode === 'invalid' ? '{broken JSON' : JSON.stringify(expression(scene)));
    arrived.resolve();
  });
  endpoint = await listenLocalHttpServer(server);
  t.after(async () => {
    town.stopTownScheduler(); resetClient(); closeDb();
    await closeLocalHttpServer(server);
    globalThis.fetch = nativeFetch; http.request = nativeRequest; https.request = nativeHttpsRequest;
  });
  const db = getDb();
  assert.equal(config.dbPath, ':memory:');
  config.features.town = true; config.features.townLLM = true;
  config.features.serializeBackgroundLLM = false; config.features.mergeMessages = false;
  config.town.simulation = 'legacy'; config.town.economyEnabled = false;
  config.town.playerSpeed = 1; config.town.maxActiveEncounters = 0;
  Object.assign(config.llm, { baseURL: `${endpoint}/v1`, apiKey: 'local-fixture-only', model: 'fixture-model',
    freeEgg: false, headers: {}, extraBody: {} });
  resetClient();
  const grid = () => Array.from({ length: 6 }, () => Array(6).fill(null));
  const { mapId } = saveMap({ name: '工坊LLM隔离', cols: 6, rows: 6,
    layers: { ground: grid(), road: grid(), objects: [] }, locations: [
      { key: 'board', name: '公告站', x: 0, y: 0, radius: 0 },
      { key: 'supplier', name: '原料点', x: 4, y: 0, radius: 0 },
      { key: 'workshop', name: '工坊', x: 4, y: 4, radius: 0 },
    ] });
  for (const name of ['公告员', '备料员', '工坊师傅']) createNpc({ mapId, displayName: name });
  db.prepare("INSERT INTO town_players (id, display_name, grid_x, grid_y) VALUES ('me', '玩家', 0, 0)").run();
  const providerId = db.prepare('SELECT id FROM town_npcs ORDER BY id DESC LIMIT 1').get().id;
  db.prepare('UPDATE town_npcs SET persona=?, home_location_id=(SELECT id FROM town_locations WHERE key=?) WHERE id=?')
    .run('本地人格标记：耐心的修补师', 'workshop', providerId);
  db.prepare('INSERT INTO town_agent_state (agent_key,grid_x,grid_y,current_location_id) VALUES (?,4,4,(SELECT id FROM town_locations WHERE key=?))')
    .run(`npc:${providerId}`, 'workshop');
  town.startTownScheduler();
  const state = economy.getTownEconomyState();
  const worldEpoch = state.worldEpoch;
  const command = idempotencyKey => ({ worldEpoch, idempotencyKey });
  const npcs = ['公告员', '备料员', '工坊师傅'].map(name => state.participants.find(a => a.displayName === name).actorId);
  economy.setupTownEconomy({ ...command('setup'), npcActorIds: { commissioner: npcs[0], supplier: npcs[1], workshop: npcs[2] },
    locationKeys: { board: 'board', supplier: 'supplier', workshop: 'workshop' } });
  async function earn(key) {
    assert.equal(town.movePlayerTo(0, 0).ok, true); now += 12000;
    let order = economy.executeTownOrder('publish', null, command(`${key}-publish`)).order;
    const act = name => economy.executeTownOrder(name, order.orderId, { ...command(`${key}-${name}`), expectedVersion: order.version }).order;
    order = act('accept');
    assert.equal(town.movePlayerTo(4, 0).ok, true); now += 4000; order = act('pickup');
    assert.equal(town.movePlayerTo(4, 4).ok, true); now += 4000; order = act('complete');
    assert.equal(order.status, 'completed'); assert.equal(economy.getTownWallet().balance, 30);
  }
  async function accept(key) {
    const offer = await economy.executeTownService('offer', null, command(`${key}-offer`));
    assert.match(offer.dialogue, /30/);
    const value = await economy.executeTownService('accept', offer.sessionId,
      { ...command(`${key}-accept`), expectedVersion: offer.version });
    assert.equal(economy.getTownWallet().balance, 0); return value;
  }
  let session;
  const turn = intentKey => economy.executeTownService('turn', session.sessionId,
    { ...command(`${session.sessionId}-${intentKey}`), expectedVersion: session.version, intentKey });

  await earn('first'); session = await accept('first');
  await t.test('valid model expression travels through real runtime and bounded chatSync', async () => {
    session = await turn('choose_theme');
    assert.deepEqual(session.turns.at(-1).response, expression(requests[0].scene));
    assert.match(requests[0].body.messages[0].content, /本地人格标记/);
    assert.equal(requests[0].body.model, 'fixture-model');
    assert.equal(requests[0].body.max_tokens, 1200);
    assert.deepEqual(requests[0].body.response_format, { type: 'json_object' });
    assert.deepEqual(requests[0].body.thinking, { type: 'disabled' });
    assert.equal(requests[0].headers['x-stainless-timeout'], '10');
    assert.equal(session.materialsConsumed, false);
    assert.equal(economy.getTownWallet().balance, 0);
  });
  await t.test('bad JSON falls back once without changing escrow or material commitment', async () => {
    mode = 'invalid'; session = await turn('confirm_materials');
    assert.equal(session.turns.at(-1).response.fallback, true);
    // confirm_materials authorizes the local consume even when model expression is invalid.
    assert.equal(session.materialsConsumed, true); assert.equal(session.status, 'active');
    assert.equal(session.settlement, null);
    assert.equal(db.prepare("SELECT count(*) n FROM backpack_items WHERE source_type='service'").get().n, 0);
    assert.equal(economy.getTownWallet().balance, 0); assert.equal(requests.length, 2);
  });
  await t.test('SDK timeout falls back without retry; local craft and settlement remain authoritative', async st => {
    mode = 'hang'; arrived = deferred(); closed = deferred();
    const nativeTimeout = globalThis.setTimeout;
    let expire;
    if (!wallclockTimeout) st.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
      const timer = nativeTimeout(callback, ms, ...args);
      if (ms === 10000) expire = () => { clearTimeout(timer); callback(...args); };
      return timer;
    });
    const started = performance.now();
    const pending = turn('craft');
    await arrived.promise;
    // The workshop generator is already captured/in flight. Gate unrelated simulation bubble LLMs
    // during this long acceptance wait; this does not change its SDK options, signal or timers.
    if (wallclockTimeout) config.features.townLLM = false;
    if (!wallclockTimeout) { assert.equal(typeof expire, 'function'); expire(); }
    session = await pending; await closed.promise;
    if (wallclockTimeout) config.features.townLLM = true;
    const elapsedMs = performance.now() - started;
    if (wallclockTimeout) {
      assert.ok(elapsedMs >= 9500 && elapsedMs <= 20000, `natural SDK timeout elapsed ${elapsedMs}ms`);
      assert.equal(heldResponse.destroyed, true);
      assert.equal(heldResponse.socket?.destroyed ?? true, true);
      assert.equal(session.status, 'active');
      assert.equal(session.leaseUntil, null);
      // Observe the public scope abort operation after completion: no generation controllers remain.
      const abort = st.mock.method(AbortController.prototype, 'abort', function () { assert.fail('generation retained after completion'); });
      try { economy.abortTownServiceGenerations(state.worldId, worldEpoch); } finally { abort.mock.restore(); }
      assert.equal(requests.at(-1).headers['x-stainless-timeout'], '10');
      const reservations = db.prepare('SELECT remaining FROM economy_reservations WHERE owner_ref=?').all(`service:${session.sessionId}`);
      assert.ok(reservations.length > 0);
      assert.ok(reservations.every(row => row.remaining === 0));
      assert.equal(session.settlement, null); // payment remains in service escrow until delivery
      assert.equal(db.prepare("SELECT count(*) n FROM backpack_items WHERE source_type='service'").get().n, 0);
      console.log(`[wallclock-timeout] elapsedMs=${elapsedMs.toFixed(1)} allowedMs=9500..20000 requests=1 socketDestroyed=true generations=0`);
    }
    assert.equal(session.turns.at(-1).response.fallback, true);
    assert.equal(session.materialsConsumed, true); assert.equal(session.crafted, true);
    assert.equal(requests.length, 3); assert.equal(economy.getTownWallet().balance, 0);
    mode = 'valid'; session = await turn('deliver');
    assert.equal(session.status, 'completed'); assert.equal(session.settlement.payout, 30);
    assert.equal(session.settlement.itemIds.length, 1);
    const item = db.prepare('SELECT * FROM backpack_items WHERE id=?').get(session.settlement.itemIds[0]);
    assert.equal(item.status, 'ready'); assert.equal(item.source_type, 'service');
    assert.equal(requests.length, 4);
  });
  await t.test('WORLD_RESET aborts inflight HTTP and fences late old-epoch expression and effects', async () => {
    await earn('second'); session = await accept('second');
    mode = 'hang'; arrived = deferred(); closed = deferred();
    const pending = turn('choose_theme').then(value => ({ value }), error => ({ error }));
    await arrived.promise;
    const reset = town.resetWorld();
    assert.equal(reset.worldEpoch, worldEpoch + 1);
    await closed.promise;
    const snapshot = () => ({
      session: db.prepare('SELECT * FROM town_service_sessions WHERE session_id=?').get(session.sessionId),
      items: db.prepare('SELECT * FROM backpack_items ORDER BY id').all(),
      turns: db.prepare('SELECT * FROM town_service_turns WHERE session_id=?').all(session.sessionId),
    });
    const afterReset = snapshot();
    assert.equal(heldResponse.destroyed, true);
    reply(heldResponse, JSON.stringify(expression(requests.at(-1).scene)));
    const result = await pending;
    assert.equal(result.error?.code, 'STALE_EPOCH');
    assert.deepEqual(snapshot(), afterReset);
    assert.equal(afterReset.session.status, 'failed');
    assert.equal(db.prepare('SELECT count(*) n FROM town_service_sessions WHERE world_epoch=?').get(reset.worldEpoch).n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM economy_reservations WHERE remaining>0').get().n, 0);
    assert.equal(requests.length, 5);
  });
});
