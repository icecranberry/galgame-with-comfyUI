import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'

// Run the actual TownView handlers with controlled world dependencies.
const script = parseSfc(readFileSync(new URL('../src/views/TownView.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
const declarations = parseJs(script, { sourceType: 'module' }).program.body
function handler(name, state) {
  const node = declarations.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(node, `${name} exists in TownView`)
  return new Function('state', `with (state) { return (${script.slice(node.start, node.end)}) }`)(state)
}
const ref = value => ({ value })
function navigation() {
  const calls = [], location = { key: 'cloud-cafe', x: 3, y: 4 }
  const state = { disposed: false, lifeMoveRequest: 0, lifeMoving: ref(false), lifeMoveError: ref(''), approaching: ref(''),
    venueSpots: ref([{ displayName: '云上咖啡馆', location }]),
    town: { movePlayer: async (x, y) => { calls.push(['move', x, y]); return { ok: true } } },
    waitForSpot: async () => true, openSpotPanel: spot => calls.push(['open', spot.location.key, spot.displayName]),
  }
  state.walkToSpot = handler('walkToSpot', state)
  return { state, calls }
}

test('walking to a building arrives and opens its interaction panel', async () => {
  const { state, calls } = navigation()
  await state.walkToSpot(state.venueSpots.value[0])
  assert.deepEqual(calls, [['move', 3, 4], ['open', 'cloud-cafe', '云上咖啡馆']])
  assert.equal(state.lifeMoving.value, false)
  assert.equal(state.approaching.value, '')
})
test('failed travel reports the doorway error and never opens the panel', async () => {
  const failed = navigation()
  failed.state.town.movePlayer = async () => ({ ok: false })
  await failed.state.walkToSpot(failed.state.venueSpots.value[0])
  assert.match(failed.state.lifeMoveError.value, /走不过去/)
  assert.equal(failed.calls.filter(([kind]) => kind === 'open').length, 0, 'a refused walk never opens the panel')
})
test('a timed-out walk reports the doorway hint without opening the panel', async () => {
  const timeout = navigation()
  timeout.state.waitForSpot = async () => false
  await timeout.state.walkToSpot(timeout.state.venueSpots.value[0])
  assert.match(timeout.state.lifeMoveError.value, /还没走到云上咖啡馆门口/)
  assert.equal(timeout.calls.length, 1)
})
