import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'
import { ref, computed } from 'vue'
import { createTownTargetTradeCommand } from '../src/api/townLife.js'

const script = parseSfc(readFileSync(new URL('../src/components/town/TownResidentActions.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
const nodes = parseJs(script, { sourceType: 'module' }).program.body
function handler(name, state) {
  const node = nodes.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  return new Function('state', `with (state) { return (${script.slice(node.start, node.end)}) }`)(state)
}

test('trade opens only through the trade gate (capability plus actual goods), and never while locked', () => {
  const state = { locked: ref(false), data: ref({ capabilities:['service'] }), tradeOpen: ref(false), canTrade: ref(false) }
  const openTrade = handler('openTrade', state)
  openTrade(); assert.equal(state.tradeOpen.value, false)
  state.canTrade.value = true
  openTrade(); assert.equal(state.tradeOpen.value, true)
  state.tradeOpen.value = false; state.locked.value = true
  openTrade(); assert.equal(state.tradeOpen.value, false)
})

test('trade commands use the resolved resident or location and carry scope plus an idempotency key', () => {
  for (const [actorKey, path] of [
    ['npc:3', '/npcs/3/trade'],
    ['char:4', '/characters/4/trade'],
    ['location:cloth_shop', '/locations/cloth_shop/trade'],
  ]) {
    const command = createTownTargetTradeCommand(actorKey, { worldId: 'town', worldEpoch: 7, templateId: 'town.mood_patch' })
    assert.equal(command.path, path)
    assert.equal(command.worldId, 'town')
    assert.ok(command.body.idempotencyKey)
    assert.deepEqual(command.body, {
      worldEpoch: 7, templateId: 'town.mood_patch', idempotencyKey: command.body.idempotencyKey,
    })
  }
})
function flow() {
  const events = []
  const state = { generation: 1, reads: 0, props: { actorKey: 'npc:1', worldId: 'town', worldEpoch: 1 },
    data: ref(null), invitation: ref({ requestId: 'saved-invite', status: 'offered' }), menu: ref(''), error: ref(''),
    loading: ref(false), busy: ref(false), emit: (...args) => events.push(args) }
  state.locked = computed(() => state.loading.value || state.busy.value)
  state.scope = () => ({ worldId: state.props.worldId, worldEpoch: state.props.worldEpoch })
  state.showError = handler('showError', state)
  return { state, events, respond: handler('respond', state), refresh: handler('refresh', state) }
}
test('uncertain confirmation keeps the same invitation, prevents double submission and retries without a new purchase', async () => {
  const { state, respond, events } = flow()
  const calls = []; let reject
  state.respondTownInteraction = (...args) => { calls.push(args); return new Promise((_, fail) => { reject = fail }) }
  const first = respond('accept')
  await respond('accept')
  assert.equal(calls.length, 1)
  reject({ uncertain: true }); await first
  assert.equal(state.invitation.value.requestId, 'saved-invite')
  assert.match(state.error.value, /尚未确认/)
  state.respondTownInteraction = async (...args) => { calls.push(args); return { requestId: args[1], status: 'accepted', result: { kind: 'trade' } } }
  await respond('accept')
  assert.equal(calls[0][1], calls[1][1])
  assert.equal(state.invitation.value.status, 'accepted')
  assert.ok(!events.some(([kind]) => kind === 'story'))
})
test('a late response for another resident cannot open a story or replace the new resident invitation', async () => {
  const { state, respond, events } = flow(); let finish
  state.respondTownInteraction = () => new Promise(resolve => { finish = resolve })
  const request = respond('accept')
  state.generation++; state.props.actorKey = 'npc:2'; state.invitation.value = { requestId: 'new-resident' }
  finish({ status: 'accepted', result: { kind: 'story', eventId: 99 } }); await request
  assert.equal(state.invitation.value.requestId, 'new-resident')
  assert.ok(!events.some(([kind]) => kind === 'story'))
})
test('reopening reads a saved accepted invitation and emits the exact external story id on confirmation', async () => {
  const { state, refresh, respond, events } = flow()
  const receipt = { requestId: 'saved-invite', status: 'accepted', result: { kind: 'story', eventId: 73 } }
  state.fetchTownInteractions = async () => ({ worldId: 'town', worldEpoch: 1, requests: [receipt], catalog: [] })
  await refresh(); assert.deepEqual(state.invitation.value, receipt)
  state.respondTownInteraction = async () => receipt
  await respond('accept')
  assert.ok(events.some(([name, id]) => name === 'story' && id === 73))
})

function computedOf(name, state) {
  const decl = nodes.find(node => node.type === 'VariableDeclaration' && node.declarations.some(d => d.id?.name === name))
  const init = decl.declarations.find(d => d.id?.name === name).init
  return new Function('state', `with (state) { return (${script.slice(init.start, init.end)}) }`)(state)
}

test('buildings no longer surface catalog service leads; residents keep their offers', () => {
  // 店铺服务全部由建筑功能面板承载：即使 catalog 里仍有 service 条目（后端目录继续下发），
  // 面板也不得再把它们拾取成走奇遇的服务线索，「店里能办什么」入口必须消失。
  assert.ok(!script.includes('店里能办什么'), 'building service menu label must be gone')
  const buildingServices = computedOf('services', {
    computed, ref,
    building: computed(() => true),
    data: ref({ catalog: [
      { key: 'service:massage', kind: 'service', capability: 'service', title: '肩颈按摩' },
      { key: 'trade:buy:comb', kind: 'trade', capability: 'trade', title: '买一把木梳' },
    ], offers: [] }),
  }).value
  assert.deepEqual(buildingServices, [], 'buildings must have no service leads')

  const residentState = {
    computed, ref,
    building: computed(() => false),
    data: ref({ catalog: [], offers: [
      { key: 'service:offer:1', kind: 'service', title: '剪头发', price: 12 },
      { key: 'work:offer:2', kind: 'work', title: '帮忙喂马', wage: 5 },
    ] }),
  }
  const residentServices = computedOf('services', residentState).value
  assert.equal(residentServices.length, 1, 'resident service offers must be preserved')
  assert.equal(residentServices[0].key, 'service:offer:1')
})
