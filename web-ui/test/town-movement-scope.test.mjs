import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileFunction } from 'node:vm'
import { ref, computed } from 'vue'

function apiFixture() {
  const source = readFileSync(new URL('../src/api/index.js', import.meta.url), 'utf8')
  const functions = ['moveTownPlayer', 'moveTownPlayerDir'].map(name => {
    const match = source.match(new RegExp(`export function ${name}\\([\\s\\S]*?^}`, 'm'))
    assert.ok(match, name); return match[0].replace('export ', '')
  })
  const calls = []
  const api = compileFunction(`${functions.join('\n')}\nreturn {moveTownPlayer,moveTownPlayerDir}`, ['BASE', 'jsonRequest', 'townJson'])(
    '/api', (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return Promise.resolve({ ok: true }) },
    (method, body) => ({ method, body: JSON.stringify(body) }),
  )
  return { api, calls }
}

test('both real API functions preserve legacy shape and whitelist optional scope', async () => {
  const { api, calls } = apiFixture()
  for (const [name, coords, path] of [['moveTownPlayer', { x: 1, y: 2 }, 'move'], ['moveTownPlayerDir', { dx: 1, dy: 2 }, 'dir']]) {
    await api[name](1, 2); assert.deepEqual(calls.at(-1), { url: `/api/town/player/${path}`, body: coords })
    const scope = { worldId: 'world', worldEpoch: 2, playerId: 'evil' }
    await api[name](1, 2, scope)
    assert.deepEqual(calls.at(-1).body, { ...coords, worldId: 'world', worldEpoch: 2 })
    assert.deepEqual(scope, { worldId: 'world', worldEpoch: 2, playerId: 'evil' })
    await api[name](1, 2, { worldEpoch: '2' })
    assert.equal(calls.at(-1).body.worldEpoch, '2', 'invalid supplied scope is not silently converted or dropped')
  }
})

function storeFixture(api) {
  const source = readFileSync(new URL('../src/stores/town.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace('export const useTownStore', 'const useTownStore')
  const setup = compileFunction(`${source}\nreturn useTownStore`, ['defineStore', 'ref', 'computed', 'api', 'onEvent'])(
    (_name, setup) => setup, ref, computed, api, () => () => {},
  )
  return setup()
}

for (const name of ['movePlayer', 'movePlayerDir']) test(`${name} snapshots scope before waiting and cannot send unscoped from a new store`, async () => {
  const { api, calls } = apiFixture()
  let release, captured
  const apiName = name === 'movePlayer' ? 'moveTownPlayer' : 'moveTownPlayerDir'
  const store = storeFixture({ ...api, [apiName]: async (...args) => {
    captured = args
    await new Promise(resolve => { release = resolve })
    return api[apiName](...args)
  } })
  await assert.rejects(store[name](1, 2), { code: 'INVALID_WORLD_SCOPE' }); assert.equal(captured, undefined)
  store.snapshot.value = { worldId: 'world', worldEpoch: 2 }
  const pending = store[name](1, 2)
  store.snapshot.value.worldEpoch = 3
  assert.deepEqual(captured[2], { worldId: 'world', worldEpoch: 2 })
  release(); await pending
  assert.equal(calls[0].body.worldEpoch, 2)
  assert.equal(calls.length, 1)
})
