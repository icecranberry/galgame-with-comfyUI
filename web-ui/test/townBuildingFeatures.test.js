import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'
import { ref, computed } from 'vue'
import { quoteBuildingFeature, executeBuildingFeature, fetchBuildingFeatures } from '../src/api/townBuildingFeatures.js'
// 组件拆分后共用逻辑成为可直测的纯函数/composable，不再从 SFC 切片
import { buildSelection, shopPanelFor } from '../src/components/town/shop/useShopFeature.js'

test('feature api calls the building-scoped endpoints with read-only defaults', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null })
    return new Response(JSON.stringify({}), { status: 200 })
  }
  try {
    await fetchBuildingFeatures('cloth_shop')
    await quoteBuildingFeature('cloth_shop', { worldId: 'w', worldEpoch: 2, featureId: 'bfi:a', selection: { optionKey: 'x' } })
    await executeBuildingFeature('cloth_shop', { worldId: 'w', worldEpoch: 2, featureId: 'bfi:a',
      quoteId: 'q', quoteExpiresAt: Date.now() + 1000, idempotencyKey: 'key-1', selection: {} })
  } finally { globalThis.fetch = originalFetch }
  assert.equal(calls[0].method, 'GET', 'listing is read-only')
  assert.equal(calls[0].url, '/api/town/buildings/cloth_shop/features')
  assert.equal(calls[1].method, 'POST')
  assert.equal(calls[1].url, '/api/town/buildings/cloth_shop/features/quote')
  assert.equal(calls[2].url, '/api/town/buildings/cloth_shop/features/execute')
  assert.equal(calls[2].body.idempotencyKey, 'key-1', 'execute carries the caller idempotency key')
  assert.equal(calls[2].body.eventId, undefined)
})

test('selection is shaped by the renderer: offers, options, pair targets and items never mix', () => {
  const build = (event, overrides = {}) => buildSelection({
    event,
    optionChoices: event.options || [],
    selectedTargetA: '', selectedTargetB: '', selectedItemId: '', userNote: '',
    selectedOptionKey: '', needsTarget: false, needsItem: false,
    allowsNote: false, isPair: false,
    ...overrides,
  })

  // 商品购买：offerKey 来自所选 offer（不再是恒定的第一件）
  const purchase = build(
    { rendererKey: 'trade_offers', options: [{ key: 'old_lamp', label: '旧街灯' }, { key: 'comb', label: '木梳' }], supportedTargetKinds: [] },
    { selectedOptionKey: 'comb' })
  assert.deepEqual(purchase, { offerKey: 'comb' })

  // 外观：optionKey 来自所选选项 + 目标
  const appearance = build(
    { rendererKey: 'appearance_options', options: [{ key: 'han_fu', label: '襦裙' }, { key: 'ru_qun', label: '袄裙' }], supportedTargetKinds: ['character'] },
    { needsTarget: true, selectedTargetA: 'char:7', selectedOptionKey: 'ru_qun' })
  assert.deepEqual(appearance, { optionKey: 'ru_qun', targetActorKeys: ['char:7'] })

  // 双人合影：两个不同目标
  const pair = build(
    { rendererKey: 'portrait_themes', options: [{ key: 'mirror_pair', label: '合影' }], supportedTargetKinds: ['character_pair'] },
    { needsTarget: true, isPair: true, selectedTargetA: 'char:7', selectedTargetB: 'char:9' })
  assert.deepEqual(pair, { optionKey: 'mirror_pair', targetActorKeys: ['char:7', 'char:9'] })

  // 回收：一件物品，无选项
  const recycle = build(
    { rendererKey: 'recycle', options: [], supportedTargetKinds: [] },
    { needsItem: true, selectedItemId: '42' })
  assert.deepEqual(recycle, { itemIds: [42] })

  // 允许备注时带上；不该有的字段绝不出现
  const noted = build(
    { rendererKey: 'portrait_themes', options: [{ key: 'theme', label: '写真' }], supportedTargetKinds: ['character'] },
    { needsTarget: true, allowsNote: true, selectedTargetA: 'char:7', selectedOptionKey: 'theme', userNote: '  想要笑脸  ' })
  assert.deepEqual(noted, { optionKey: 'theme', targetActorKeys: ['char:7'], userNote: '想要笑脸' })
  assert.equal('itemIds' in noted, false)
  assert.equal('offerKey' in noted, false)

  // 签运/抽奖由服务端按种子定结果：选项维度不进入 selection
  const fortune = build(
    { rendererKey: 'fortune', options: [{ key: 'small_luck', label: '小吉签' }], supportedTargetKinds: [] })
  assert.deepEqual(fortune, {})
})

test('panels are chosen by templateId, never by rendererKey alone', () => {
  // 14 个模板全覆盖
  assert.equal(shopPanelFor('outfit_change'), 'appearance')
  assert.equal(shopPanelFor('hairstyle_change'), 'appearance')
  assert.equal(shopPanelFor('accessory_change'), 'appearance')
  assert.equal(shopPanelFor('temporary_transform'), 'appearance')
  assert.equal(shopPanelFor('item_purchase'), 'trade')
  assert.equal(shopPanelFor('item_exchange'), 'trade')
  assert.equal(shopPanelFor('item_recycle'), 'trade')
  assert.equal(shopPanelFor('temporary_state'), 'state', 'BUFF 商店不能进衣柜面板')
  assert.equal(shopPanelFor('portrait_single'), 'portrait')
  assert.equal(shopPanelFor('portrait_pair'), 'portrait')
  assert.equal(shopPanelFor('illustrated_keepsake'), 'keepsake')
  assert.equal(shopPanelFor('gallery_display'), 'gallery')
  assert.equal(shopPanelFor('pool_draw'), 'draw')
  assert.equal(shopPanelFor('daily_fortune'), 'fortune')
  // ⚠️ temporary_state 与外观四件套共用 appearance_options 渲染器：templateId 优先级必须压过 renderer
  assert.equal(shopPanelFor('temporary_state', 'appearance_options'), 'state')
  assert.equal(shopPanelFor('outfit_change', 'appearance_options'), 'appearance')
  // 旧事件 DTO 没有 templateId 时按 renderer 兜底
  assert.equal(shopPanelFor('', 'trade_offers'), 'trade')
  assert.equal(shopPanelFor(null, 'fortune'), 'fortune')
  assert.equal(shopPanelFor(), null)
})

test('resident actions: the building-branch is gone; buildings go straight to the stage', () => {
  const script = parseSfc(readFileSync(new URL('../src/components/town/TownResidentActions.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
  // 建筑点击已直开店铺舞台（TownView.enterWorldSpot），居民互动面板不再服务建筑：
  // 这些旧分支逻辑必须整体移除，防止死代码复活出第二套建筑入口。
  for (const gone of ['loadBuildingFeatures', 'acceptBuildingFeature', 'buildingFeatureMenuLabel',
    'featureStatusHint', 'featuresGenerating', "emit('feature'"]) {
    assert.equal(script.includes(gone), false, `建筑分支残留: ${gone}`)
  }
  assert.equal(script.includes("startsWith('location:')") && script.includes('buildingFeatures'), false,
    '建筑分支已整体移除')
  const view = readFileSync(new URL('../src/views/TownView.vue', import.meta.url), 'utf8')
  assert.match(view, /function enterWorldSpot\(spot\) \{[\s\S]*?shopStage\.value = \{ locationKey: spot\.location\.key/s,
    'TownView 点建筑必须直开店铺舞台')
})

const configScript = parseSfc(readFileSync(new URL('../src/components/town/TownBuildingFeatureConfig.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
const configNodes = parseJs(configScript, { sourceType: 'module' }).program.body
function configFn(name, state) {
  const node = configNodes.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(node, `${name} must exist in TownBuildingFeatureConfig.vue`)
  return new Function('state', `with (state) { return (${configScript.slice(node.start, node.end)}) }`)(state)
}
function configConst(name, state) {
  const node = configNodes.find(node => node.type === 'VariableDeclaration' && node.declarations.some(d => d.id?.name === name))
  assert.ok(node, `${name} must exist in TownBuildingFeatureConfig.vue`)
  const init = node.declarations[0].init
  return new Function('state', `with (state) { return (${configScript.slice(init.start, init.end)}) }`)(state)
}

test('building admin: batch targets and force policy', async () => {
  const buildings = ref([
    { locationKey: 'a', title: '面包房', status: 'unconfigured' },
    { locationKey: 'b', title: '旧钟楼', status: 'failed' },
    { locationKey: 'c', title: '镜室', status: 'ready', manual: true },
    { locationKey: 'd', title: '茶摊', status: 'stale' },
    { locationKey: 'e', title: '歇业铺', status: 'disabled' },
  ])
  const calls = []
  const toasts = []
  const state = {
    buildings,
    BATCH_ALL: 'all', BATCH_MISSING: 'missing',
    batchMode: ref(''), batchArmed: ref(''), batchProgress: ref({ done: 0, total: 0 }),
    toast: (message, type) => { toasts.push({ message, type }) },
    generateOne: async (building, options) => { calls.push({ key: building.locationKey, ...options }) },
  }
  state.batchTargets = configFn('batchTargets', state)
  const batchTargets = state.batchTargets
  const runBatch = configFn('runBatch', state)

  assert.deepEqual(batchTargets('missing').map(b => b.locationKey), ['a', 'b'],
    '空缺只包含从未成功配置过的建筑')
  assert.deepEqual(batchTargets('all').map(b => b.locationKey), ['a', 'b', 'c', 'd'],
    '停用中的建筑不被批量悄悄重新启用')

  await runBatch('missing')
  assert.deepEqual(calls.map(c => c.key), ['a', 'b'], '补齐空缺只碰空缺的建筑')
  assert.deepEqual(calls.map(c => c.force), [false, false], '补齐空缺不强制覆盖现有配置')
  assert.ok(calls.every(c => c.silent === true), '批量不逐栋弹提示，收尾统一汇报')
  assert.equal(state.batchMode.value, '', '批量结束后解除锁定')

  calls.length = 0
  await runBatch('all')
  assert.deepEqual(calls.map(c => c.key), ['a', 'b', 'c', 'd'])
  assert.deepEqual(calls.map(c => c.force), [true, true, true, true], '全部重新生成强制覆盖')

  // 一栋失败不打断后续，失败名单由收尾汇报
  calls.length = 0; toasts.length = 0
  state.generateOne = async (building, options) => {
    calls.push({ key: building.locationKey, ...options })
    if (building.locationKey === 'a') throw new Error('boom')
  }
  await runBatch('all')
  assert.deepEqual(calls.map(c => c.key), ['a', 'b', 'c', 'd'], '一栋失败后继续处理后面的建筑')
  assert.equal(toasts.at(-1).type, 'error')
  assert.match(toasts.at(-1).message, /面包房/)
  assert.equal(state.batchMode.value, '')

  // 没有空缺时只提示，不发请求
  calls.length = 0; toasts.length = 0
  buildings.value = buildings.value.filter(b => b.status !== 'unconfigured' && b.status !== 'failed')
  await runBatch('missing')
  assert.equal(calls.length, 0, '空目标不发请求')
  assert.equal(toasts.at(-1).type, 'info')
})

test('building admin entry moved to the top bar, next to the wallet', () => {
  const view = readFileSync(new URL('../src/views/TownView.vue', import.meta.url), 'utf8')
  const admin = readFileSync(new URL('../src/components/town/TownAdminPanel.vue', import.meta.url), 'utf8')
  const config = readFileSync(new URL('../src/components/town/TownBuildingFeatureConfig.vue', import.meta.url), 'utf8')

  // 点建筑直接开店铺舞台：enterWorldSpot 里必须给 shopStage 赋值（建筑专有 UI，不再经过纸面板）
  assert.match(view, /function enterWorldSpot\(spot\) \{[\s\S]*?shopStage\.value = \{ locationKey: spot\.location\.key/s,
    '点建筑必须直开店铺舞台')

  const buildingButton = view.indexOf('@click="openBuildingFeatures"')
  const walletButton = view.indexOf('@click="openWalletPanel"')
  assert.ok(buildingButton > 0 && walletButton > buildingButton, '顶栏「建筑」排在「钱袋」左边')
  assert.ok(view.includes('@click="openBuildingFeatures">建筑</linshe-button>'), '入口名字是「建筑」')
  assert.ok(view.includes('<TownBuildingFeatureConfig v-model:open="showBuildingFeatures" />'))
  assert.equal(admin.includes('buildingFeatureOpen'), false, '管理面板不再挂特殊建筑入口')
  assert.equal(admin.includes('TownBuildingFeatureConfig'), false)
  assert.equal(admin.includes('管理特殊功能'), false)

  assert.ok(config.includes('<template #header-extra>'), '两个批量按钮放在弹窗顶部')
  assert.ok(config.indexOf('全部重新生成') < config.indexOf('补齐空缺店铺功能'))
  assert.ok(config.includes(':disabled="building.status === \'generating\' || !!batchMode"'),
    '缺描述不再禁用生成按钮')
  assert.ok(config.includes('置空就用店名当用途描述'), '缺描述提示说明留空会用店名')
  // 店名回填出来的描述不能冒充玩家手写的内容
  const label = configConst('sourceLabel', { SOURCE_LABELS: { 'location.feature_desc': '手工描述' } })
  assert.equal(label({ descriptionSource: 'location.feature_desc', description: '月影客栈', title: '月影客栈' }), '自动取店名')
  assert.equal(label({ descriptionSource: 'location.feature_desc', description: '给旅人住一晚', title: '月影客栈' }), '手工描述')
  assert.equal(label({ descriptionSource: null, title: '月影客栈' }), '缺失')
})
const pickerScript = parseSfc(readFileSync(new URL('../src/components/town/TownCharacterPicker.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
const residentScript = parseSfc(readFileSync(new URL('../src/components/town/TownResidentActions.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
const residentNodes = parseJs(residentScript, { sourceType: 'module' }).program.body
function residentFn(name, state) {
  const node = residentNodes.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(node, `${name} must exist in TownResidentActions.vue`)
  return new Function('state', `with (state) { return (${residentScript.slice(node.start, node.end)}) }`)(state)
}
function pickerFn(name, state) {
  const node = parseJs(pickerScript, { sourceType: 'module' }).program.body
    .find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(node, `${name} must exist in TownCharacterPicker.vue`)
  return new Function('state', `with (state) { return (${pickerScript.slice(node.start, node.end)}) }`)(state)
}
function pickerConst(name, state) {
  const marker = `const ${name} = `
  const start = pickerScript.indexOf(marker)
  assert.ok(start >= 0, `${name} must exist in TownCharacterPicker.vue`)
  const rest = pickerScript.slice(start + marker.length)
  const stop = rest.search(/\r?\n(const |function |async function )/)
  const src = rest.slice(0, stop < 0 ? rest.length : stop)
  return new Function('state', `with (state) { return (${src}) }`)(state)
}

test('building shops: no special-story entry, service category in front of every option', () => {
  const resident = readFileSync(new URL('../src/components/town/TownResidentActions.vue', import.meta.url), 'utf8')

  // 「特殊奇遇」只留给居民，店铺不再提供
  assert.match(resident, /<TownVnChoice v-if="!building && data\?\.capabilities\?\.includes\('service'\)/,
    '特殊奇遇入口带 !building 守卫')
  // 服务品类改由店铺舞台菜单徽章展示（stage 直接读功能视图的 categoryLabel）
  const stage = readFileSync(new URL('../src/components/town/shop/TownShopStage.vue', import.meta.url), 'utf8')
  assert.ok(stage.includes('{{ f.categoryLabel }}'), '店铺舞台菜单要展示服务品类徽章')

  const choiceLabel = residentFn('choiceLabel', {})
  assert.equal(choiceLabel({ categoryLabel: '服装', title: '租一套古装' }), '【服装】租一套古装')
  assert.equal(choiceLabel({ categoryLabel: 'BUFF', title: '讨个说法' }), '【BUFF】讨个说法')
  assert.equal(choiceLabel({ categoryLabel: null, title: '这栋建筑能做什么' }), '这栋建筑能做什么')
})

test('character picker: excludes the already-picked partner and falls back to an initial', () => {
  const targets = [
    { actorKey: 'char:1', displayName: '阿岚', avatarPath: '/avatars/1.png' },
    { actorKey: 'char:2', displayName: '青柠', avatarPath: null },
  ]
  const options = pickerConst('options', { props: { targets, exclude: 'char:1' }, computed })
  assert.deepEqual(options.value.map(o => o.actorKey), ['char:2'], '合影的第二位不会重复选到第一位')

  const all = pickerConst('options', { props: { targets, exclude: '' }, computed })
  assert.equal(all.value.length, 2, '单人不排除任何角色')

  const initialOf = pickerFn('initialOf', {})
  assert.equal(initialOf({ displayName: '阿岚' }), '阿')
  assert.equal(initialOf(null), '?')
})

test('building feature content uses the picker instead of the target dropdowns', () => {
  const content = readFileSync(new URL('../src/components/town/TownBuildingFeatureContent.vue', import.meta.url), 'utf8')
  assert.ok(content.includes('<TownCharacterPicker'), '目标用专门的选人界面')
  assert.equal(content.includes(':options="targetOptions"'), false, '目标不再是下拉框')
  assert.equal(content.includes(':options="pairTargetOptions"'), false, '合影目标也不再是下拉框')
  assert.ok(content.includes(":exclude=\"pickerSlot === 'b' ? selectedTargetA : ''\""),
    '第二位会排除已选的第一位')
})