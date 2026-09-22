import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref, computed } from 'vue'
import { createPinia, defineStore } from 'pinia'

// Run the real store with isolated API/event dependencies, including its debounce.
const source = readFileSync(new URL('../src/stores/town.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace('export const useTownStore =', 'return')

async function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const events = new Map()
  let standingUrl = '/old.png', reads = 0
  const api = {
    fetchTownState: async () => {
      reads++
      return { worldId: 'world', worldEpoch: 1, mapId: 1,
        agents: [{ agentKey: 'char:1', standingUrl }], player: null }
    },
    fetchTownMaps: async () => ({ maps: [], currentMapId: 1 }),
    townViewerHeartbeat: async () => ({}),
  }
  const onEvent = (name, callback) => {
    events.set(name, callback)
    return () => events.delete(name)
  }
  const useStore = new Function('defineStore', 'ref', 'computed', 'api', 'onEvent', source)(
    defineStore, ref, computed, api, onEvent)
  const store = useStore(createPinia())
  store.startTownStream()
  t.after(() => store.stopTownStream())
  await settle()
  return { store, events, setUrl: url => { standingUrl = url }, reads: () => reads }
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

for (const kind of ['portrait', 'npc', 'player']) {
  test(`${kind} save refreshes resident visuals without reloading the page`, async t => {
    const h = await harness(t)
    assert.equal(h.store.agents[0].standingUrl, '/old.png')
    h.setUrl('/edited.png')
    const before = h.reads()
    const asset = { id: 1, kind, key: 'char_1_portrait', status: 'ready', image_path: '/edited.png' }
    h.events.get('town_assets_updated')({ asset })
    h.events.get('town_assets_updated')({ asset })
    t.mock.timers.tick(120)
    await settle()
    assert.equal(h.reads(), before + 1, 'burst updates share one snapshot refresh')
    assert.equal(h.store.agents[0].standingUrl, '/edited.png')
  })
}

test('deleting a portrait refreshes the resident fallback', async t => {
  const h = await harness(t)
  h.store.assets = [{ id: 1, kind: 'portrait', key: 'char_1_portrait' }]
  h.setUrl('/fallback.png')
  h.events.get('town_assets_updated')({ deleted: 1 })
  t.mock.timers.tick(120)
  await settle()
  assert.equal(h.store.agents[0].standingUrl, '/fallback.png')
  assert.equal(h.store.assets.length, 0)
})

test('non-character assets do not refresh resident snapshots', async t => {
  const h = await harness(t)
  const before = h.reads()
  h.events.get('town_assets_updated')({ asset: { id: 2, kind: 'ground', key: 'grass' } })
  t.mock.timers.tick(120)
  await settle()
  assert.equal(h.reads(), before)
})
