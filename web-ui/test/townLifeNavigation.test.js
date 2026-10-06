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
  const state = { disposed: false, lifeMoveRequest: 0, lifeMoving: ref(false), lifeMoveError: ref(''),
    venueSpots: ref([{ displayName: '云上咖啡馆', location }]),
    town: { currentMapId: 7, movePlayer: async (x, y) => { calls.push(['move', x, y]); return { ok: true } } },
    shopStage: ref(null),
    playerAtLocation: () => false,
    editing: ref(false), showAdmin: ref(false), showWizard: ref(false), dialogueInputBlocked: ref(false),
  }
  state.walkToSpot = handler('walkToSpot', state)
  state.enterWorldSpot = handler('enterWorldSpot', state)
  return { state, calls }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('clicking a building opens its shop stage first and only then walks over', async () => {
  const { state, calls } = navigation()
  state.enterWorldSpot(state.venueSpots.value[0])
  assert.equal(state.shopStage.value.locationKey, 'cloud-cafe', '舞台不等走到门口')
  assert.equal(state.shopStage.value.buildingName, '云上咖啡馆')
  assert.equal(state.shopStage.value.mapId, 7)
  assert.deepEqual(calls[0], ['move', 3, 4], '角色照旧走过去，经营者服务才办得了')
  await tick()
  assert.equal(state.lifeMoveError.value, '', '顺利走到就不该有提示')
})

test('clicking a building you already stand at opens the stage without moving', () => {
  const { state, calls } = navigation()
  state.playerAtLocation = () => true
  state.enterWorldSpot(state.venueSpots.value[0])
  assert.equal(state.shopStage.value.buildingName, '云上咖啡馆')
  assert.deepEqual(calls, [])
})

test('a refused walk keeps the stage open and reports the doorway error', async () => {
  const { state, calls } = navigation()
  state.town.movePlayer = async () => ({ ok: false })
  state.enterWorldSpot(state.venueSpots.value[0])
  await tick()
  assert.equal(calls.filter(([kind]) => kind === 'open').length, 0, '面板已被舞台取代')
  assert.ok(state.shopStage.value, '走不过去也不收回舞台')
  assert.match(state.lifeMoveError.value, /走不过去/)
})

test('a superseded walk stays silent: an older click never gets to report anything', async () => {
  const { state } = navigation()
  // 走的过程中又被点了别处（lifeMoveRequest 前进），旧请求迟到的失败不该冒出来
  state.town.movePlayer = async () => { state.lifeMoveRequest += 1; throw new Error('这个门口暂时走不过去，请稍后再试。') }
  await state.walkToSpot(state.venueSpots.value[0])
  assert.equal(state.lifeMoveError.value, '', '被顶掉的旧请求不再写提示')
})

test('walkToSpot itself never opens the panel: opening belongs to the click handler', async () => {
  const { state, calls } = navigation()
  await state.walkToSpot(state.venueSpots.value[0])
  assert.deepEqual(calls, [['move', 3, 4]])
  assert.equal(state.shopStage.value, null, '舞台只由点击处理器打开')
})
