import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'
import { fetchTownMaps, travelTown, fetchTownState, fetchTownMap } from '../src/api/index.js'
import { useTownStore } from '../src/stores/town.js'

// 多地图出行：接口作用域、store 换场时序、TownView.startTravel 的过场编排。
// 换场只能在双帘完全盖住的那一帧发生；失败不清理原图任何状态。

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

test('travel endpoints carry the map scope in the query string and the body', async t => {
  const calls = mockFetch(t, () => ({}))
  await fetchTownMaps()
  await travelTown(3, { expectedPlayerRevision: 8, worldId: 'world-1', worldEpoch: 2 })
  await fetchTownState(3)
  await fetchTownMap(3)
  assert.deepEqual(calls.map(([url]) => url), [
    '/api/town/maps',
    '/api/town/travel',
    '/api/town/state?mapId=3',
    '/api/town/map?mapId=3',
  ])
  assert.deepEqual(JSON.parse(calls[1][1].body), { targetMapId: 3, expectedPlayerRevision: 8, worldId: 'world-1', worldEpoch: 2 })
})

// 两个小镇的假服务端：玩家在 server.mapId 上，出行会把他搬到 3
function mapServer(t) {
  const server = {
    mapId: 1, revision: 8, travelFails: false,
    snapshotFor: mapId => ({ worldId: 'world-1', worldEpoch: 1, mapId, serverTime: 1000, initialized: true,
      map: { id: mapId, version: 1, cols: 12, rows: 9, name: mapId === 3 ? '海边小镇' : '邻舍小镇' },
      locations: [], agents: [], player: { x: 1, y: 1 }, weather: null, encountersActive: [] }),
    payloadFor: mapId => ({ id: mapId, version: 1, cols: 12, rows: 9, name: '海边小镇', layers: {}, assets: [], locations: [] }),
  }
  mockFetch(t, url => {
    if (url === '/api/town/maps') {
      return { maps: [
        { id: 1, name: '邻舍小镇', status: 'ready', cols: 20, rows: 20, residentCount: 6 },
        { id: 3, name: '海边小镇', status: 'ready', cols: 12, rows: 9, residentCount: 4 },
      ], currentMapId: server.mapId, playerRevision: server.revision }
    }
    if (url === '/api/town/travel') {
      if (server.travelFails) return { __status: 409, __body: { code: 'PLAYER_SCENE_CHANGED', error: '场景已变化，请重试', mapId: server.mapId } }
      server.mapId = 3; server.revision = 9
      return { ok: true, mapId: 3, playerRevision: 9, map: { id: 3, name: '海边小镇' } }
    }
    const state = url.match(/^\/api\/town\/state(?:\?mapId=(\d+))?$/)
    if (state) return server.snapshotFor(state[1] ? Number(state[1]) : server.mapId)
    const map = url.match(/^\/api\/town\/map(?:\?mapId=(\d+))?$/)
    if (map) return server.payloadFor(Number(map[1] || server.mapId))
    throw new Error(`unexpected request ${url}`)
  })
  return server
}

test('a trip only swaps the local scene at commit time', async t => {
  const server = mapServer(t)
  setActivePinia(createPinia())
  const town = useTownStore()
  await town.fetchMaps()
  await town.fetchState()
  assert.equal(town.currentMapId, 1)
  assert.equal(town.maps.length, 2)

  const prep = await town.prepareTravel(3)
  assert.equal(prep.targetMapId, 3)
  assert.equal(prep.result.mapId, 3)
  assert.equal(prep.payload.id, 3, '目标图载荷在合帘之前就预载好')
  assert.equal(town.currentMapId, 1, '订票阶段不动本端场景')
  assert.equal(town.playerRevision, 8)
  assert.equal(server.mapId, 3, '服务端的玩家已经搬到目标图了，本端还在等遮罩合上')

  // 订票之后、遮罩合上之前：服务端推来的换图事件与这段时间读到的快照都不许把场景掀开
  assert.equal(await town.applyServerMapChanged({ mapId: 5, playerRevision: 99 }), false)
  assert.equal(town.currentMapId, 1)
  await town.fetchState()
  assert.equal(town.currentMapId, 1, '过场期间不采用「已经搬到新图」的快照')
  assert.equal(town.snapshot.mapId, 1)

  assert.equal(await town.commitTravel(prep), true)
  assert.equal(town.currentMapId, 3)
  assert.equal(town.playerRevision, 9)
  assert.equal(town.snapshot.mapId, 3, '换场后的快照就是目标图')
  assert.equal(town.mapData.id, 3)
  assert.equal(town.travelBusy, false)

  // 过场结束：服务端再推换图事件就照常跟随（别的标签页出行）
  server.mapId = 5
  assert.equal(await town.applyServerMapChanged({ mapId: 5, playerRevision: 10 }), true)
  assert.equal(town.currentMapId, 5)
})

test('a refused ticket drops the trip and follows the server', async t => {
  const server = mapServer(t)
  setActivePinia(createPinia())
  const town = useTownStore()
  await town.fetchMaps()
  await town.fetchState()

  // 另一个标签页先出行了：本端这张票被拒
  server.mapId = 5
  server.travelFails = true
  await assert.rejects(() => town.prepareTravel(3), err => err.code === 'PLAYER_SCENE_CHANGED')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(town.currentMapId, 5, '订票被拒后以服务端为准，不留在旧图')

  // 被拒之后还能重新出行
  server.mapId = 5
  server.travelFails = false
  const again = await town.prepareTravel(3)
  assert.equal(await town.commitTravel(again), true)
  assert.equal(town.currentMapId, 3)
})

// ── TownView.startTravel：时序编排（真跑 SFC 里的那个函数，只把世界依赖换成假的） ──

const script = parseSfc(readFileSync(new URL('../src/views/TownView.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
const declarations = parseJs(script, { sourceType: 'module' }).program.body
function handler(name, state) {
  const node = declarations.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(node, `${name} exists in TownView`)
  return new Function('state', `with (state) { return (${script.slice(node.start, node.end)}) }`)(state)
}

// 时序常量与过场组件里的 CSS 时长必须同源，否则 JS 等的时间与帘子走的时间会各说各话
const timingMatch = script.match(/const TRAVEL_DEPART_MS = (\d+), TRAVEL_COVER_MS = (\d+), TRAVEL_REVEAL_MS = (\d+), TRAVEL_REDUCED_MS = (\d+)/)
assert.ok(timingMatch, 'TownView declares the travel timings')
const [DEPART_MS, COVER_MS, REVEAL_MS, REDUCED_MS] = timingMatch.slice(1).map(Number)
// startTravel 还引用这条模块级文案（用来清掉上一次出行留下的「场景还在准备」提示）
const SCENE_SLOW = script.match(/const TRAVEL_SCENE_SLOW = '([^']+)'/)?.[1] ?? ''
const overlaySource = readFileSync(new URL('../src/components/town/TownTravelOverlay.vue', import.meta.url), 'utf8')

test('the travel timings in TownView match the overlay animations', () => {
  const transform = duration => `transition: transform ${duration}ms var(--ease-emph)`
  assert.ok(overlaySource.includes(transform(COVER_MS)), '合帘时长与过场 CSS 一致')
  assert.ok(overlaySource.includes(transform(REVEAL_MS)), '拉帘时长与过场 CSS 一致')
  assert.ok(overlaySource.includes(`animation: travel-fade ${REDUCED_MS}ms`), '减少动态的淡入时长一致')
})

function travelHarness({ reduced = false, switchOk = true, prepareThrows = false, alreadyThere = false } = {}) {
  const log = [], waits = [], phaseLog = []
  const state = {
    TRAVEL_DEPART_MS: DEPART_MS, TRAVEL_COVER_MS: COVER_MS, TRAVEL_REVEAL_MS: REVEAL_MS, TRAVEL_REDUCED_MS: REDUCED_MS,
    TRAVEL_SCENE_SLOW: SCENE_SLOW,
    disposed: false, travelRun: 0, travelWaitDone: null, travelNoticeTimer: null,
    travelPhase: { get value() { return phaseLog.at(-1) ?? '' }, set value(next) { phaseLog.push(next) } },
    traveling: ref(false), showTravelPanel: ref(true), travelError: ref(''), travelNotice: ref(''),
    travelArrival: ref(''), travelAnnouncement: ref(''), travelWeather: ref(''), rendererNotice: ref(''),
    prefersReducedMotion: ref(reduced), followPlayer: true, cam: { zoom: 1 },
    travelTarget: ref({ id: 3, name: '海边小镇', status: 'ready', cols: 12, rows: 9, residentCount: 4 }),
    travelCanDepart: ref(true), travelTargetId: ref(3),
    town: {
      currentMapId: 1,
      prepareTravel: async id => {
        log.push(['prepare', id])
        if (prepareThrows) throw Object.assign(new Error('那座小镇还没建成。'), { code: 'MAP_NOT_READY' })
        return { token: state.travelRun, targetMapId: id, payload: { id, assets: [] }, preview: null,
          result: { ok: true, mapId: id, playerRevision: 9, alreadyThere } }
      },
      commitTravel: async () => { log.push(['commit', state.travelPhase.value]); return switchOk },
      fetchState: async () => { log.push(['fetchState']) },
      fetchMaps: async () => { log.push(['fetchMaps']) },
      endTravel: () => log.push(['endTravel']),
    },
    clearMovementKeys: () => log.push(['clearKeys']),
    clearTravelNotice: () => { state.travelNotice.value = '' },
    showTravelNotice: text => { state.travelNotice.value = text },
    travelWait: ms => { waits.push(ms); return Promise.resolve() },
    travelAborted: token => state.disposed || token !== state.travelRun,
    destinationWeatherText: () => '晴 20°',
    collectWorldResourceUrls: () => [],
    preloadImage: () => Promise.resolve(),
    waitForRenderMap: timeout => { waits.push(timeout); return Promise.resolve(true) },
    nextFrames: () => Promise.resolve(),
    centerCamera: () => log.push(['center']),
    travelErrorMessage: err => err?.message || '请稍后再试',
  }
  state.startTravel = handler('startTravel', state)
  return { state, log, waits, phaseLog }
}

test('a successful trip covers the screen before the scene is swapped', async () => {
  const { state, log, waits, phaseLog } = travelHarness()
  await state.startTravel()
  assert.deepEqual(log, [['clearKeys'], ['prepare', 3], ['commit', 'cover'], ['center'], ['endTravel']],
    '换场发生在 cover 阶段，镜头在拉帘之前就已经对准新图')
  assert.deepEqual(phaseLog, ['depart', 'cover', 'reveal', ''])
  assert.deepEqual(waits, [DEPART_MS, COVER_MS, 800, REVEAL_MS], '时序与过场动画对齐，等场景最多 800ms')
  assert.equal(state.traveling.value, false)
  assert.equal(state.followPlayer, true)
  assert.equal(state.travelError.value, '')
  assert.equal(state.travelNotice.value, '已抵达海边小镇')
})

test('reduced motion keeps the same order but drops the travel waits', async () => {
  const { state, waits, phaseLog } = travelHarness({ reduced: true })
  await state.startTravel()
  assert.deepEqual(waits, [0, 0, 1600, REDUCED_MS])
  assert.deepEqual(phaseLog, ['depart', 'cover', 'reveal', ''])
})

test('a failed trip rolls back and never reports an arrival', async () => {
  const { state, log, phaseLog } = travelHarness({ switchOk: false })
  await state.startTravel()
  assert.deepEqual(log, [['clearKeys'], ['prepare', 3], ['commit', 'cover'], ['endTravel']], '换场没成功就不动镜头')
  assert.equal(phaseLog.at(-1), '')
  assert.equal(phaseLog.includes('reveal'), false)
  assert.equal(phaseLog.includes('failed'), true)
  assert.equal(state.travelError.value, '没能换到那座小镇')
  assert.equal(state.travelNotice.value, '没能换到那座小镇')
  assert.equal(state.traveling.value, false)
  assert.equal(state.followPlayer, true)
})

test('a refused ticket never opens the curtain', async () => {
  const { state, log, phaseLog } = travelHarness({ prepareThrows: true })
  await state.startTravel()
  assert.deepEqual(log, [['clearKeys'], ['prepare', 3], ['endTravel']], '订票失败就不该调用换场')
  assert.equal(phaseLog.includes('cover'), false)
  assert.equal(state.travelError.value, '那座小镇还没建成。')
})

test('a trip the server already completed skips the animation', async () => {
  const { state, log, phaseLog } = travelHarness({ alreadyThere: true })
  await state.startTravel()
  assert.deepEqual(log, [['clearKeys'], ['prepare', 3], ['fetchState'], ['fetchMaps'], ['endTravel']], '已经在那张图上就不走过场，只对齐一次')
  assert.equal(phaseLog.at(-1), '')
  assert.equal(phaseLog.includes('cover'), false)
  assert.equal(state.travelNotice.value, '你已经在海边小镇了')
})

/**
 * 换图是 player 级事件（不带 mapId 过滤），`town_player_map_changed` 就是别的标签页/设备
 * 出行时本端换场的唯一入口。SSE 客户端只派发 `unifiedStream.js` 里列出的那几个事件名，
 * 漏一个订阅就变成永远不会触发的死代码（服务端照推、前端静默丢弃），所以这里逐个对齐。
 */
test('town store 订阅的事件都在 unifiedStream 的派发表里，且派发名与订阅名一致', () => {
  const storeSrc = readFileSync(new URL('../src/stores/town.js', import.meta.url), 'utf8')
  const streamSrc = readFileSync(new URL('../src/stores/unifiedStream.js', import.meta.url), 'utf8')
  const subscribed = [...storeSrc.matchAll(/onEvent\(\s*'([^']+)'/g)].map(match => match[1])
  assert.ok(subscribed.includes('town_player_map_changed'), '换图事件必须有订阅者')
  const dispatched = new Map([...streamSrc.matchAll(/^\s*([A-Za-z_]\w*):\s*(?:\(\)|d)\s*=>\s*\{?\s*_dispatch\('([^']+)'/gm)]
    .map(match => [match[1], match[2]]))
  const missing = subscribed.filter(name => dispatched.get(name) !== name)
  assert.deepEqual(missing, [], `这些事件没有被 unifiedStream 正确转发：${missing.join(', ')}`)
})
