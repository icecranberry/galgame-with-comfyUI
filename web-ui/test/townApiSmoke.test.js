import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchTownInteractions, respondTownInteraction, getTownWallet, fetchTownNpcFunctions, receiveTownNpcGift } from '../src/api/townLife.js'

// 冒烟：模块级请求路径真实执行（mock fetch），防止路径常量/模板串断裂回归。
test('town life api module builds real requests against /api/town', async t => {
  const calls = []
  const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  const response = body => ({ ok: true, status: 200, json: async () => body })
  Object.defineProperty(globalThis, 'fetch', { configurable: true,
    value: async (url, options) => { calls.push([String(url), options]); return response({}) } })
  t.after(() => { if (original) Object.defineProperty(globalThis, 'fetch', original); else delete globalThis.fetch })

  await fetchTownInteractions('npc:56')
  await respondTownInteraction('npc:56', 'req-1', 'accept', { worldId: 'town', worldEpoch: 7 })
  await getTownWallet()
  await fetchTownNpcFunctions(48)
  await receiveTownNpcGift(48, { worldEpoch: 7 })
  assert.deepEqual(calls.map(([url]) => url), [
    '/api/town/npcs/56/interactions',
    '/api/town/npcs/56/interactions/req-1',
    '/api/town/wallet',
    '/api/town/npcs/48/functions',
    '/api/town/npcs/48/gift',
  ])
  assert.deepEqual(calls[1][1] && JSON.parse(calls[1][1].body), { worldId: 'town', worldEpoch: 7, decision: 'accept' })
  assert.match(calls[4][1] && calls[4][1].body, /"idempotencyKey"/)
})
