import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'
import { useTownStore } from '../src/stores/town.js'

// 地图目录两条线：①场景刷新必须指名要玩家那张图；②出行面板行内改名。
// 回归：非首图（玩家不在 id 最小的那张图上）刷新时，客户端省略 mapId，
// 服务端按旧口径给了「id 最小的那张」，于是 NPC 换了、画布还是老镇。

function mockFetch(t, handle) {
  const calls = []
  const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', { configurable: true,
    value: async (url, options) => {
      const target = String(url)
      calls.push([target, options])
      const out = await handle(target, options)
      const status = out?.__status ?? 200
      return { ok: status < 400, status, json: async () => (out?.__status ? out.__body : out) }
    } })
  t.after(() => { if (original) Object.defineProperty(globalThis, 'fetch', original); else delete globalThis.fetch })
  return calls
}

test('scene refresh asks for the map the player is on, not the world first map', async t => {
  // 玩家在 3 号图上；服务端保留旧口径：省略 mapId 就返回 id 最小的 1 号图
  const payload = id => ({ id, version: 1, cols: 12, rows: 9, name: id === 3 ? '海边的镇' : '老镇',
    layers: {}, assets: [], locations: [] })
  const calls = mockFetch(t, url => {
    const state = url.match(/^\/api\/town\/state(?:\?mapId=(\d+))?$/)
    if (state) return { worldId: 'world-1', worldEpoch: 1, mapId: 3, serverTime: 1000, initialized: true,
      map: { id: 3, version: 1, cols: 12, rows: 9, name: '海边的镇' },
      locations: [], agents: [], player: { x: 1, y: 1 }, weather: null, encountersActive: [] }
    const map = url.match(/^\/api\/town\/map(?:\?mapId=(\d+))?$/)
    if (map) return payload(Number(map[1] || 1))
    throw new Error(`unexpected request ${url}`)
  })

  setActivePinia(createPinia())
  const town = useTownStore()
  await town.fetchState()
  await new Promise(resolve => setTimeout(resolve, 0))   // 瓦片载荷是随快照后台补拉的

  assert.equal(town.currentMapId, 3)
  assert.deepEqual(calls.filter(([url]) => url.startsWith('/api/town/map')), [['/api/town/map?mapId=3', undefined]],
    '瓦片载荷要指名玩家那张图')
  assert.equal(town.mapData.id, 3)
  assert.equal(town.renderMap.name, '海边的镇', '画布渲染的就是玩家脚下这张图')
})

// ── 出行面板行内改名：真正跑 TownView 里的那几个 handler ──

const script = parseSfc(readFileSync(new URL('../src/views/TownView.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
const declarations = parseJs(script, { sourceType: 'module' }).program.body
function handler(name, state) {
  const node = declarations.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(node, `${name} exists in TownView`)
  return new Function('state', `with (state) { return (${script.slice(node.start, node.end)}) }`)(state)
}

function renamePanel({ mapId = 3, draft = '  海边的镇  ', fails = null } = {}) {
  const calls = []
  const state = {
    RENAME_MAX: 24,
    renamingMapId: ref(mapId), renameDraft: ref(draft), renameBusy: ref(false), renameError: ref(''),
    api: { renameTownMap: async (id, name) => {
      calls.push(['rename', id, name])
      if (fails) throw new Error(fails)
    } },
    town: { fetchMaps: async () => calls.push(['maps']) },
  }
  state.submitRename = handler('submitRename', state)
  return { state, calls }
}

test('renaming a town submits the trimmed name and refreshes the directory', async () => {
  const { state, calls } = renamePanel()
  await state.submitRename()
  assert.deepEqual(calls, [['rename', 3, '海边的镇'], ['maps']])
  assert.equal(state.renamingMapId.value, null, '改完就收起输入框')
  assert.equal(state.renameDraft.value, '')
  assert.equal(state.renameError.value, '')
  assert.equal(state.renameBusy.value, false)
})

test('a blank name never reaches the server', async () => {
  const { state, calls } = renamePanel({ draft: '   ' })
  await state.submitRename()
  assert.deepEqual(calls, [])
  assert.match(state.renameError.value, /名字/)
  assert.equal(state.renamingMapId.value, 3, '出错时留在编辑态，别把用户输入清掉')
})

test('a refused rename keeps the row in edit mode and reports why', async () => {
  const { state, calls } = renamePanel({ fails: '地图不存在' })
  await state.submitRename()
  assert.deepEqual(calls, [['rename', 3, '海边的镇']], '失败就不刷新目录')
  assert.match(state.renameError.value, /地图不存在/)
  assert.equal(state.renamingMapId.value, 3)
  assert.equal(state.renameBusy.value, false)
})

// ── 危险区「重新初始化」：真正跑 TownAdminPanel 里的 doReset ──
// 回归：这一按曾经打 DELETE /town/world（整世界清空），世界里别的小镇一起没了；
// 现在必须只针对玩家脚下那一张图。

const adminScript = parseSfc(readFileSync(new URL('../src/components/town/TownAdminPanel.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
function adminHandler(name, state) {
  const node = parseJs(adminScript, { sourceType: 'module' }).program.body
    .find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(node, `${name} exists in TownAdminPanel`)
  return new Function('state', `with (state) { return (${adminScript.slice(node.start, node.end)}) }`)(state)
}

function resetPanel(currentMapId, { fail } = {}) {
  const calls = []
  const state = {
    resetting: ref(true), detail: ref({ npcId: 1 }),
    resetBusy: ref(false), resetError: ref(''), resetDone: ref(false), resetDoneName: ref(''),
    resetTargetName: { value: '海边的镇' },
    api: { resetTownMap: async id => {
      calls.push(['reset', id])
      calls.push(['busy-during-request', state.resetBusy.value])
      if (fail) throw new Error('地图不存在')
    } },
    town: { currentMapId,
      fetchState: async () => calls.push(['state']),
      fetchMaps: async () => calls.push(['maps']) },
  }
  state.doReset = adminHandler('doReset', state)
  return { state, calls }
}

test('the danger-zone reset targets the map the player is on', async () => {
  const { state, calls } = resetPanel(3)
  await state.doReset()
  assert.deepEqual(calls.filter(([name]) => name !== 'busy-during-request'),
    [['reset', 3], ['state'], ['maps']], '只重置玩家所在地图，并重拉状态与目录')
  assert.deepEqual(calls.find(([name]) => name === 'busy-during-request'),
    ['busy-during-request', true], '请求在途时确认清除要转圈，别让玩家以为没点上')
  assert.equal(state.resetting.value, false)
  assert.equal(state.resetBusy.value, false, '跑完收起 loading')
  assert.equal(state.resetDone.value, true)
  assert.equal(state.resetDoneName.value, '海边的镇', '结果提示报出被清的是哪一座')
  assert.equal(state.detail.value, null, '选中的人已经不在了，清掉详情')
})

test('the danger-zone reset sends nothing when there is no current map', async () => {
  const { state, calls } = resetPanel(null)
  await state.doReset()
  assert.deepEqual(calls, [], '没有当前地图就别发请求')
  assert.equal(state.resetting.value, false)
})

test('the danger-zone reset keeps the confirm row when the request fails', async () => {
  const { state } = resetPanel(3, { fail: true })
  await state.doReset()
  assert.equal(state.resetBusy.value, false, '失败也要收起 loading，不然按钮一直转圈')
  assert.equal(state.resetting.value, true, '失败保留确认条，可以直接再按一次')
  assert.match(state.resetError.value, /地图不存在/)
  assert.equal(state.resetDone.value, false)
})

test('danger-zone copy only claims the town underfoot', async () => {
  const tpl = parseSfc(readFileSync(new URL('../src/components/town/TownAdminPanel.vue', import.meta.url), 'utf8')).descriptor.template.content
  const desc = tpl.match(/<p class="ap-danger-desc">([\s\S]*?)<\/p>/)[1]
  assert.match(desc, /只清你脚下的这一个小镇/, '文案要说清只动脚下这一座')
  assert.match(desc, /别的小镇照常过日子/, '别的小镇不受影响要写明')
})

test('map reset is a DELETE on the map resource', async t => {
  const calls = mockFetch(t, () => ({}))
  const api = await import('../src/api/index.js')
  await api.resetTownMap(7)
  assert.equal(calls[0][0], '/api/town/maps/7')
  assert.equal(calls[0][1].method, 'DELETE')
})
