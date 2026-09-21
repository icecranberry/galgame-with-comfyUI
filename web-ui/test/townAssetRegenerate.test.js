import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'

const script = parseSfc(readFileSync(new URL('../src/components/town/TownAssetManager.vue', import.meta.url), 'utf8'))
  .descriptor.scriptSetup.content
const nodes = parseJs(script, { sourceType: 'module' }).program.body

function handler (name, state) {
  const node = nodes.find(item => item.type === 'FunctionDeclaration' && item.id.name === name)
  assert.ok(node, name + ' 应存在')
  return new Function('state', `with (state) { return (${script.slice(node.start, node.end)}) }`)(state)
}

/** 组装 regenerateAsset 依赖的状态与 api 替身，按调用顺序记录 */
function makeFixture ({ asset = { id: 7, meta: { desc: '靠河的面包房' } }, regenerate = null, hasSnapshot = true, promptResult = 'new prompt', promptError = null } = {}) {
  const calls = []
  const state = {
    displayAsset: { value: asset },
    localAsset: { value: null },
    regenBusy: { value: false },
    regenStatus: { value: '' },
    error: { value: '' },
    hasRequestSnapshot: { value: hasSnapshot },
    props: { regenerate },
    emit: () => {},
    flushGenerationConfigSave: async () => {},
    refreshAsset: async () => null,
    api: {
      async regenerateTownAssetPrompt (id, requirement, options) {
        calls.push(['rewrite-prompt', id, requirement, options])
        if (promptError) throw promptError
        return { prompt: promptResult }
      },
      async regenerateTownAsset (id, overrides) {
        calls.push(['regenerate', id, overrides])
        return { asset: { id, name: '新图' } }
      },
    },
  }
  state.rewritePromptFromRequest = handler('rewritePromptFromRequest', state)
  return { state, calls, run: () => handler('regenerateAsset', state)() }
}

test('图片管理里的「重新生成」纯按原始需求重写提示词，再按新提示词出图', async () => {
  const { state, calls, run } = makeFixture()
  await run()
  assert.deepEqual(calls, [
    ['rewrite-prompt', 7, '', { fromRequestOnly: true }],
    ['regenerate', 7, { prompt: 'new prompt', verbatim: true }],
  ])
  assert.equal(state.regenBusy.value, false)
  assert.equal(state.error.value, '')
  assert.equal(state.regenStatus.value, '已按原始需求重写出图')
  assert.equal(state.localAsset.value?.name, '新图')
})

test('没有原始需求快照时跳过重写，退回当前提示词出图', async () => {
  const { state, calls, run } = makeFixture({ hasSnapshot: false })
  await run()
  assert.deepEqual(calls, [['regenerate', 7, {}]])
  assert.equal(state.error.value, '')
  assert.equal(state.regenStatus.value, '已重新出图')
})

test('后端判定没有可依据的原始需求时，同样退回当前提示词出图', async () => {
  const { state, calls, run } = makeFixture({
    promptError: new Error('这张素材没有可依据的原始需求，无法重写提示词'),
  })
  await run()
  assert.deepEqual(calls, [
    ['rewrite-prompt', 7, '', { fromRequestOnly: true }],
    ['regenerate', 7, {}],
  ])
  assert.equal(state.error.value, '')
})

test('提示词重写失败时报错，不会拿原提示词偷偷出图', async () => {
  const { state, calls, run } = makeFixture({ promptError: new Error('LLM 改写的提示词不完整') })
  await run()
  assert.deepEqual(calls, [['rewrite-prompt', 7, '', { fromRequestOnly: true }]])
  assert.equal(state.error.value, 'LLM 改写的提示词不完整')
  assert.equal(state.regenStatus.value, '')
  assert.equal(state.regenBusy.value, false)
})

test('向导传入的 regenerate 走调用方逻辑，不改写提示词', async () => {
  const seen = []
  const { state, calls, run } = makeFixture({
    regenerate: async (asset) => {
      seen.push(['custom-regenerate', asset.id])
      return { id: asset.id, name: '向导重绘' }
    },
  })
  await run()
  assert.deepEqual(seen, [['custom-regenerate', 7]])
  assert.deepEqual(calls, [])
  assert.equal(state.localAsset.value?.name, '向导重绘')
})