import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useShopFeature, shopFeatureErrorText } from '../src/components/town/shop/useShopFeature.js'

// 拆分后共用逻辑在 useShopFeature composable 里：直接装配真实实现 + 注入式 API 断言行为，
// 不再从 SFC 里切片（切片口径已随组件拆分失效）。
function mountShop({ event: eventOverrides = {}, api: apiOverrides = {} } = {}) {
  const emits = []
  const calls = []
  const event = ref({
    id: 'bfeat:1', featureId: 'bfi:a', buildingInstanceId: '1:shop', mapId: 1,
    status: 'open', price: 15, rendererKey: 'appearance_options', templateId: 'outfit_change',
    options: [{ key: 'han_fu', label: '襦裙' }], supportedTargetKinds: ['character'],
    opening: '欢迎光临。', description: '挑一件穿上一天。',
    ...eventOverrides,
  })
  const api = {
    quoteBuildingFeature: async (locationKey, body) => {
      calls.push({ kind: 'quote', locationKey, body })
      return { quoteId: 'q1', price: 15, revision: 4, summary: '租一套古装 · 襦裙', expiresAt: Date.now() + 60000 }
    },
    executeBuildingFeature: async (locationKey, body) => {
      calls.push({ kind: 'execute', locationKey, body })
      return { templateId: event.value.templateId, status: 'committed', result: { summary: '青柠换上了「襦裙」' } }
    },
    fetchBuildingFeatureOperation: async operationId => {
      calls.push({ kind: 'poll', operationId })
      return { status: 'committed', result: { imageUrl: '/x.png', caption: '好照片' } }
    },
    fetchBuildingFeatures: async () => ({ features: [] }),
    ...apiOverrides,
  }
  const shop = useShopFeature({
    event,
    scope: { worldId: 'town', worldEpoch: 3 },
    emit: (...args) => emits.push(args),
    api,
  })
  return { shop, emits, calls, event, api }
}

test('execute flows through quote then execute and finishes with the committed receipt', async () => {
  const { shop, emits, calls } = mountShop()
  shop.selectedTargetA.value = 'char:7'
  await shop.confirmExecute()
  assert.equal(calls[0].kind, 'quote', 'quote is always taken before execute')
  assert.equal(calls[1].kind, 'execute')
  assert.equal(calls[0].body.selection.optionKey, 'han_fu', '选项进入 selection')
  assert.deepEqual(calls[0].body.selection.targetActorKeys, ['char:7'])
  assert.equal(calls[0].body.worldEpoch, 3)
  assert.equal(calls[1].body.quoteId, 'q1', 'execute 绑定报价收据')
  assert.equal(shop.quote.value.quoteId, 'q1')
  const completed = emits.find(args => args[0] === 'completed')
  assert.ok(completed, 'committed operation emitted as completed')
  assert.equal(completed[1].result.summary, '青柠换上了「襦裙」')
  assert.equal(shop.busy.value, false, 'busy flag released')
})

test('a generative operation keeps the card open until polling sees a terminal state', async () => {
  const { shop, emits, calls } = mountShop({
    event: {
      id: 'bfeat:2', featureId: 'bfi:p', rendererKey: 'portrait_themes', templateId: 'portrait_single',
      options: [{ key: 'theme', label: '写真' }], supportedTargetKinds: ['character'], price: 0,
    },
    api: {
      executeBuildingFeature: async (locationKey, body) => {
        calls.push({ kind: 'execute', body })
        return { templateId: 'portrait_single', status: 'generating', operationId: 'op-1' }
      },
      fetchBuildingFeatureOperation: async () => {
        calls.push({ kind: 'poll' })
        return { status: 'committed', result: { imageUrl: '/x.png', caption: '好照片' } }
      },
    },
  })
  shop.selectedTargetA.value = 'char:7'
  await shop.confirmExecute()
  const completed = emits.find(args => args[0] === 'completed')
  assert.ok(completed, 'media completion emits once the operation settles')
  assert.equal(completed[1].result.imageUrl, '/x.png')
  assert.equal(calls.at(-1).kind, 'poll', '轮询到终态为止')
})

test('failures map to player-facing reasons and never claim success', async () => {
  const { shop, emits } = mountShop({
    api: {
      quoteBuildingFeature: async () => { throw Object.assign(new Error('x'), { code: 'INSUFFICIENT_FUNDS' }) },
    },
  })
  shop.selectedTargetA.value = 'char:7'
  await shop.confirmExecute()
  assert.match(shop.error.value, /金币不足/)
  assert.equal(shop.busy.value, false)
  assert.equal(emits.some(args => args[0] === 'completed'), false, '失败的报价不产生假回执')
  assert.equal(shop.quote.value, null)
})

test('operation error codes surface their reason; retry path is exposed for players', () => {
  for (const [code, expected] of [
    ['DAILY_LIMIT', '今天已经用过这次机会了'], ['EFFECT_ALREADY_ACTIVE', '还在生效中'],
    ['OUT_OF_STOCK', '货已经空了'], ['NOT_ARRIVED', '走到这家门口'],
  ]) {
    const text = shopFeatureErrorText({ code })
    assert.ok(text.includes(expected), `${code} -> ${expected}: ${text}`)
  }
  assert.match(shopFeatureErrorText({ uncertain: true }), /尚未确认/)
})
