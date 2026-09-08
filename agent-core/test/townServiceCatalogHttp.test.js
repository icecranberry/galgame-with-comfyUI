import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { createServer } from 'node:http';
import express, { Router } from 'express';
import { listenLocalHttpServer, closeLocalHttpServer } from './fixtures/localHttpServer.js';

// Production runtime/router source; only the underlying business context is fake.
// This checks HTTP selection/DTO/error contracts, not payment or unlock correctness.
function load(relative, dependencies, suffix) {
  const names = [];
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g, (_, imports) => {
      names.push(...imports.split(',').map(s => s.trim()).filter(Boolean)); return '';
    }).replace(/export (?=(?:async )?function )/g, '').replace(/export \{ router as default \};/, '');
  const extra = Object.keys(dependencies).filter(name => !names.includes(name));
  return compileFunction(`${source}\n${suffix}`, [...names, ...extra])(...[...names, ...extra].map(name =>
    dependencies[name] ?? (() => { throw new Error(`Unexpected dependency: ${name}`); })));
}
async function fixture(t) {
  const scope = { worldId: 'server-world', worldEpoch: 3 }, calls = [], broadcasts = [];
  const catalog = [{ serviceKey: 'town.workshop', name: '心情修复贴制作', description: '原服务', price: 30, available: true, reason: null },
    { serviceKey: 'town.workshop.bob_cut', name: '波波头发型卡制作', description: '使用后才改变发型', price: 30, available: false, reason: 'SERVICE_LOCKED' }];
  let failure;
  const perform = command => async args => { calls.push({ command, args }); if (failure) throw Object.assign(new Error(failure), { code: failure }); return { sessionId: 'existing', serviceKey: 'town.workshop' }; };
  const context = { scope, player: { actorId: 'server-player' }, db: { prepare: () => ({ all: () => [] }) },
    registry: { synchronize: () => [] }, business: { getSlice: () => ({ locationKeys: { workshop: 'shop' }, npcActorIds: { workshop: 'provider' } }) },
    orders: { list: () => [] }, production: { list: () => [], getResourceNode: () => null },
    liquidity: { getStatus: () => null }, work: { getBusinessStatus: () => ({ open: true }) },
    services: { listCatalog: received => { assert.deepEqual(received, scope); return catalog; }, list: () => [],
      offer: perform('offer'), accept: perform('accept') } };
  const runtime = load('../src/services/town/townEconomyRuntime.js', {
    fixtureContext: context, config: { town: { economyEnabled: true } }, broadcastTownStateUpdated: value => broadcasts.push(value),
  }, 'getTownBusinessRuntime = () => fixtureContext; getTownWallet = () => ({balance:30,available:30,reserved:0}); return {getTownEconomyState,executeTownService};');
  const router = load('../src/routes/town.js', { Router, ...runtime, maintainTownOrders: () => {} }, 'return router;');
  const app = express(); app.use(express.json()); app.use('/api/town', router);
  const server = createServer(app), url = await listenLocalHttpServer(server);
  t.after(() => closeLocalHttpServer(server));
  const request = async (path, body) => {
    const response = await fetch(`${url}/api/town${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    return { status: response.status, body: await response.json() };
  };
  return { scope, catalog, calls, broadcasts, request, fail: code => { failure = code; } };
}

test('economy HTTP exposes the catalog alongside original service fields', async t => {
  const f = await fixture(t), response = await f.request('/economy');
  assert.equal(response.status, 200); assert.deepEqual(response.body.service.catalog, f.catalog);
  assert.equal(response.body.service.locationKey, 'shop'); assert.equal(response.body.service.open, true);
  assert.deepEqual(response.body.service.sessions, []); assert.equal(f.calls.length, 0); assert.equal(f.broadcasts.length, 0);
});

test('offer alone passes explicit service selection; legacy and existing-session payloads stay unchanged', async t => {
  const f = await fixture(t), base = { worldEpoch: 3, idempotencyKey: 'original-request' };
  assert.equal((await f.request('/services/offer', base)).status, 200);
  assert.deepEqual(f.calls[0].args, { ...f.scope, idempotencyKey: base.idempotencyKey, actorId: 'server-player' });
  await f.request('/services/offer', { ...base, serviceKey: 'town.workshop.bob_cut', actorId: 'evil', effectKey: 'arbitrary', price: 0 });
  assert.deepEqual(f.calls[1].args, { ...f.calls[0].args, serviceKey: 'town.workshop.bob_cut' });
  await f.request('/services/existing/accept', { ...base, expectedVersion: 4, serviceKey: 'town.workshop.bob_cut' });
  assert.deepEqual(f.calls[2].args, { ...f.calls[0].args, sessionId: 'existing', expectedVersion: 4 });
});

test('locked and invalid selections have real HTTP errors without a success notification', async t => {
  const f = await fixture(t);
  for (const code of ['SERVICE_LOCKED', 'INVALID_SERVICE_KEY']) {
    f.fail(code);
    const response = await f.request('/services/offer', { worldEpoch: 3, idempotencyKey: code, serviceKey: 'town.workshop.bob_cut' });
    assert.equal(response.status, 409); assert.equal(response.body.code, code);
    assert.notEqual(response.body.error, code); assert.match(response.body.error, /工坊/);
  }
  assert.equal(f.broadcasts.length, 0);
});
