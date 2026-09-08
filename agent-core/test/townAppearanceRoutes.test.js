import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { createServer } from 'node:http';
import express, { Router } from 'express';
import { listenLocalHttpServer, closeLocalHttpServer } from './fixtures/localHttpServer.js';

async function fixture(t, failure = null) {
  const names = [], calls = [];
  const source = readFileSync(new URL('../src/routes/town.js', import.meta.url), 'utf8')
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g, (_, imports) => {
      names.push(...imports.split(',').map(x => x.trim()).filter(Boolean)); return '';
    }).replace(/export \{ router as default \};/, '');
  const dependencies = { Router,
    generateCharacterSprites: async (id, options) => { calls.push({ kind: 'characters', id, options }); if (failure) throw failure; return { ok: true }; },
    generateNpcSprites: async (id, options) => { calls.push({ kind: 'npcs', id, options }); if (failure) throw failure; return { ok: true }; },
  };
  const router = compileFunction(`${source}\nreturn router;`, names)(...names.map(name =>
    dependencies[name] ?? (() => { throw new Error(`Unexpected dependency: ${name}`); })));
  const app = express(); app.use(express.json()); app.use('/api/town', router);
  const server = createServer(app), url = await listenLocalHttpServer(server);
  t.after(() => closeLocalHttpServer(server));
  return { url, calls };
}

test('real sprite routes accept only boolean true for refreshAppearance and preserve NPC overrides', async t => {
  const { url, calls } = await fixture(t);
  for (const kind of ['characters', 'npcs']) {
    for (const flag of [undefined, false, 'true', 1, true]) {
      const response = await fetch(`${url}/api/town/${kind}/7/sprites`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshAppearance: flag, force: true, styleTags: 'fixture' }),
      });
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
      const call = calls.at(-1); assert.equal(call.id, 7); assert.equal(call.kind, kind);
      assert.deepEqual(call.options, kind === 'characters' ? { refreshAppearance: flag === true }
        : { refreshAppearance: flag === true, force: true, styleTags: 'fixture' });
    }
  }
});

for (const kind of ['characters', 'npcs']) test(`${kind} sprite route exposes stale as 409/code and preserves other errors as 500`, async t => {
  for (const code of ['TOWN_ASSET_STALE', 'GENERATION_FAILED']) {
    const { url, calls } = await fixture(t, Object.assign(new Error('fixture generation error'), { code }));
    const response = await fetch(`${url}/api/town/${kind}/7/sprites`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshAppearance: true }),
    });
    assert.equal(response.status, code === 'TOWN_ASSET_STALE' ? 409 : 500);
    assert.deepEqual(await response.json(), code === 'TOWN_ASSET_STALE'
      ? { error: 'fixture generation error', code } : { error: 'fixture generation error' });
    assert.equal(calls.length, 1);
  }
});
