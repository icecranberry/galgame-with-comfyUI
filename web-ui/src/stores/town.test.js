import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileFunction } from 'node:vm'
import { ref, computed } from 'vue'

function fixture(api) {
  const listeners = new Map()
  const source = readFileSync(new URL('./town.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace('export const useTownStore', 'const useTownStore')
  const setup = compileFunction(`${source}\nreturn useTownStore`, ['defineStore', 'ref', 'computed', 'api', 'onEvent'])(
    (_name, setup) => setup, ref, computed,
    { fetchTownMap: async () => null, ...api },
    (name, callback) => { listeners.set(name, callback); return () => listeners.delete(name) },
  )
  return { store: setup(), emit: (name, data) => listeners.get(name)?.(data) }
}
const snapshot = (epoch = 2) => ({ worldId: 'world', worldEpoch: epoch, serverTime: Date.now(), map: null,
  player: { agentKey: 'me', x: 0, y: 0 }, encountersActive: [],
  agents: [{ agentKey: 'npc:1', x: 1, y: 1, path: [], encounterId: null }] })

test('late HTTP snapshot cannot overwrite a newer completed request', async () => {
  const pending = []
  const { store } = fixture({ fetchTownState: () => new Promise(resolve => pending.push(resolve)) })
  const older = store.fetchState(), newer = store.fetchState()
  pending[1](snapshot(3)); await newer
  pending[0](snapshot(2)); await older
  assert.equal(store.snapshot.value.worldEpoch, 3)
})

test('old epoch movement/bubbles ignored, removed actor disappears, state notice refreshes', async () => {
  let reads = 0
  const { store, emit } = fixture({ fetchTownState: async () => { reads++; return snapshot() } })
  store.startTownStream()
  await new Promise(resolve => setTimeout(resolve, 0))
  const old = { worldId: 'world', worldEpoch: 1, charId: 'npc:1', from: { x: 9, y: 9 }, path: [], text: '旧场景' }
  emit('town_move', old); emit('town_bubble', old)
  assert.equal(store.agents.value[0].x, 1)
  assert.equal(store.agents.value[0].bubble, undefined)
  emit('town_encounter_end', { worldId: 'world', worldEpoch: 2, id: -1, removed: 'npc:1' })
  assert.equal(store.agents.value.length, 0)
  emit('town_state_updated', { worldId: 'world', worldEpoch: 2 })
  emit('town_state_updated', { worldId: 'world', worldEpoch: 2 })
  await new Promise(resolve => setTimeout(resolve, 140))
  assert.equal(reads, 2)
  assert.equal(store.agents.value.length, 1)
  store.stopTownStream()
})

test('old map/assets requests cannot populate a rebuilt world and stopped stream ignores pending state', async () => {
  let epoch = 1, mapResolve, assetResolve, stateResolve
  const { store } = fixture({ fetchTownState: async () => snapshot(epoch),
    fetchTownMap: () => new Promise(resolve => { mapResolve = resolve }),
    fetchTownAssets: () => new Promise(resolve => { assetResolve = resolve }) })
  await store.fetchState()
  const mapRead = store.fetchMap(), assetRead = store.fetchAssets()
  epoch = 2
  await store.fetchState()
  mapResolve({ id: 1, version: 1 }); assetResolve({ assets: [{ id: 1 }] })
  await Promise.all([mapRead, assetRead])
  assert.equal(store.mapData.value, null)
  assert.deepEqual(store.assets.value, [])
  const other = fixture({ fetchTownState: () => new Promise(resolve => { stateResolve = resolve }) }).store
  other.startTownStream()
  other.stopTownStream()
  stateResolve(snapshot(9))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(other.snapshot.value, null)
  assert.equal(other.connected.value, false)
})

test('an older HTTP player revision cannot undo a newer movement event', async () => {
  let resolveState, reads = 0
  const { store, emit } = fixture({ fetchTownState: () => ++reads === 1 ? Promise.resolve(snapshot())
    : new Promise(resolve => { resolveState = resolve }) })
  store.startTownStream()
  await new Promise(resolve => setTimeout(resolve, 0))
  const read = store.fetchState()
  emit('town_move', { worldId: 'world', worldEpoch: 2, charId: 'me', revision: 3,
    from: { x: 4, y: 4 }, path: [{ x: 5, y: 4 }], speed: 1, startedAt: Date.now() })
  resolveState(snapshot())
  await read
  assert.equal(store.player.value.moveRevision, 3)
  assert.equal(store.player.value.x, 4)
  store.stopTownStream()
})

test('NPC move and stop received during HTTP survive stale snapshot even in the same millisecond', async () => {
  const pending = []
  let reads = 0
  const { store, emit } = fixture({ fetchTownState: () => ++reads === 1 ? Promise.resolve(snapshot())
    : new Promise(resolve => pending.push(resolve)) })
  store.startTownStream(); await new Promise(resolve => setTimeout(resolve, 0))
  const first = store.fetchState(), second = store.fetchState()
  const startedAt = Date.now()
  emit('town_move', { worldId: 'world', worldEpoch: 2, charId: 'npc:1', from: { x: 8, y: 8 },
    path: [{ x: 9, y: 8 }], speed: 2, startedAt })
  const freshMetadata = snapshot(); freshMetadata.agents[0].displayName = 'fresh metadata'
  pending[1](freshMetadata); await second
  assert.equal(store.agents.value[0].x, 8)
  assert.equal(store.agents.value[0].displayName, 'fresh metadata')
  pending[0](snapshot()); await first
  assert.equal(store.agents.value[0].x, 8)
  const third = store.fetchState()
  emit('town_move', { worldId: 'world', worldEpoch: 2, charId: 'npc:1', from: { x: 9, y: 8 }, path: [], speed: 2, startedAt })
  const staleMoving = snapshot(); staleMoving.agents[0].path = [{ x: 2, y: 1 }]
  pending[2](staleMoving); await third
  assert.equal(store.agents.value[0].x, 9); assert.deepEqual(store.agents.value[0].path, [])
  // The next read, with no intervening SSE, accepts authoritative position again.
  const fourth = store.fetchState(); pending[3](snapshot()); await fourth
  assert.equal(store.agents.value[0].x, 1)
  store.stopTownStream()
})

test('NPC HTTP protection cannot carry movement into a rebuilt world or a replacement actor', async () => {
  let resolveState, reads = 0
  const { store, emit } = fixture({ fetchTownState: () => ++reads === 1 ? Promise.resolve(snapshot())
    : new Promise(resolve => { resolveState = resolve }) })
  store.startTownStream(); await new Promise(resolve => setTimeout(resolve, 0))
  store.agents.value[0].actorId = 'old-actor'
  let request = store.fetchState()
  emit('town_move', { worldId: 'world', worldEpoch: 2, charId: 'npc:1', from: { x: 8, y: 8 }, path: [] })
  const replacement = snapshot(); replacement.agents[0].actorId = 'replacement'
  resolveState(replacement); await request; assert.equal(store.agents.value[0].x, 1)
  request = store.fetchState()
  emit('town_move', { worldId: 'world', worldEpoch: 2, charId: 'npc:1', from: { x: 9, y: 9 }, path: [] })
  resolveState(snapshot(3)); await request
  assert.equal(store.snapshot.value.worldEpoch, 3); assert.equal(store.agents.value[0].x, 1)
  store.stopTownStream()
})

test('preview and init state reject late requests after stop and remount', async () => {
  const previews = [], inits = []
  const { store } = fixture({ fetchTownState: async () => snapshot(),
    fetchTownInitPreview: () => new Promise(resolve => previews.push(resolve)),
    fetchTownInitState: () => new Promise(resolve => inits.push(resolve)) })
  store.startTownStream(); await new Promise(resolve => setTimeout(resolve, 0))
  const oldPreview = store.refreshDraftPreview(), oldInit = store.fetchInitState()
  store.stopTownStream(); store.startTownStream(); await new Promise(resolve => setTimeout(resolve, 0))
  const newPreview = store.refreshDraftPreview(), newInit = store.fetchInitState()
  previews[1]({ id: 'new' }); inits[1]({ status: 'new' }); await Promise.all([newPreview, newInit])
  previews[0]({ id: 'old' }); inits[0]({ status: 'old' }); await Promise.all([oldPreview, oldInit])
  assert.equal(store.renderMap.value.id, 'new'); assert.equal(store.initState.value.status, 'new')
  store.stopTownStream()
})

test('clear and world change fence pending preview/init reads so the official map cannot be replaced', async () => {
  const previews = [], inits = []; let epoch = 2
  const { store } = fixture({ fetchTownState: async () => snapshot(epoch),
    fetchTownInitPreview: () => new Promise(resolve => previews.push(resolve)),
    fetchTownInitState: () => new Promise(resolve => inits.push(resolve)) })
  await store.fetchState()
  let preview = store.refreshDraftPreview(), init = store.fetchInitState()
  store.clearDraftPreview(); store.mapData.value = { id: 'official' }
  previews[0]({ id: 'old-draft' }); inits[0]({ status: 'old' }); await Promise.all([preview, init])
  assert.equal(store.renderMap.value.id, 'official'); assert.equal(store.initState.value, null)
  preview = store.refreshDraftPreview(); init = store.fetchInitState(); epoch = 3; await store.fetchState()
  previews[1]({ id: 'old-world' }); inits[1]({ status: 'old-world' }); await Promise.all([preview, init])
  assert.equal(store.draftPreview.value, null); assert.equal(store.initState.value, null)
})

test('latest preview/init request wins within the same mounted world', async () => {
  const previews = [], inits = []
  const { store } = fixture({ fetchTownState: async () => snapshot(),
    fetchTownInitPreview: () => new Promise(resolve => previews.push(resolve)),
    fetchTownInitState: () => new Promise(resolve => inits.push(resolve)) })
  await store.fetchState()
  const oldPreview = store.refreshDraftPreview(), oldInit = store.fetchInitState()
  const newPreview = store.refreshDraftPreview(), newInit = store.fetchInitState()
  previews[1]({ id: 2 }); inits[1]({ status: 2 }); await Promise.all([newPreview, newInit])
  previews[0]({ id: 1 }); inits[0]({ status: 1 }); await Promise.all([oldPreview, oldInit])
  assert.equal(store.draftPreview.value.id, 2); assert.equal(store.initState.value.status, 2)
})
