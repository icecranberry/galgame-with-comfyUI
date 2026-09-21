import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'

const script = parseSfc(readFileSync(new URL('../src/components/town/TownAssetManager.vue', import.meta.url), 'utf8'))
  .descriptor.scriptSetup.content
const nodes = parseJs(script, { sourceType: 'module' }).program.body

function handler(name, state) {
  const node = nodes.find(item => item.type === 'FunctionDeclaration' && item.id.name === name)
  assert.ok(node, `${name} 应存在`)
  return new Function('state', `with (state) { return (${script.slice(node.start, node.end)}) }`)(state)
}

/** 组装 regenerateAsset 依赖的响应式状态与 api 替身，记录调用顺序 */
function makeFixture({ asset, regenerate = null, promptResult = '', promptError = null }) {
  const calls = []
  const state = {
    displayAsset: { value: asset },
    localAsset: { value: null },
    regenBusy: { value: false },
    regenStatus: { value: '' },
    error: { value: '' },
    props: { regenerate },
    emit: () => {},
    flushGenerationConfigSave: async () => {},
    refreshAsset: async () => null,
    api: {
      async regenerateTownAssetPrompt(id, requirement) {
        calls.push(['rewrite-prompt', id, requirement])
        if (promptError) throw promptError
        return { prompt: promptResult }
      },
      async regenerateTownAsset(id, overrides) {
        calls.push(['regenerate', id, overrides])
        return { asset: { id, name: '新图' } }
      },
    },
  }
  state.rewriteAssetPrompt = handler('rewriteAssetPrompt', state)
  return { state, calls, run: () => handler('regenerateAsset', state)() }
}

test('小镇管理里的「重新生成」先让 LLM 重写提示词，再按新提示词出图', async () => {
  const { state, calls, run } = makeFixture({
    asset: { id: 7, source_prompt: 'old prompt' },
    promptResult: 'new prompt',
  })
  await run()
  assert.deepEqual(calls, [
    ['rewrite-prompt', 7, ''],
    ['regenerate', 7, { prompt: 'new prompt', verbatim: true }],
  ])
  assert.equal(state.regenBusy.value, false)
  assert.equal(state.error.value, '')
  assert.equal(state.localAsset.value?.name, '新图')
})

test('向导传入的 regenerate 走调用方逻辑，不改写提示词', async () => {
  const calls = []
  const { state, run } = makeFixture({
    asset: { id: 8, source_prompt: 'old prompt' },
    regenerate: async (asset) => {
      calls.push(['custom-regenerate', asset.id])
      return { id: asset.id, name: '向导重绘' }
    },
  })
  await run()
  assert.deepEqual(calls, [['custom-regenerate', 8]])
  assert.equal(state.localAsset.value?.name, '向导重绘')
})

test('素材还没有提示词时退回按当前配置出图', async () => {
  const { state, calls, run } = makeFixture({ asset: { id: 9 } })
  await run()
  assert.deepEqual(calls, [['regenerate', 9, {}]])
  assert.equal(state.error.value, '')
})

test('后端判定缺少提示词时同样退回按当前配置出图', async () => {
  const { state, calls, run } = makeFixture({
    asset: { id: 10, source_prompt: 'old prompt' },
    promptError: new Error('当前素材缺少提示词'),
  })
  await run()
  assert.deepEqual(calls, [
    ['rewrite-prompt', 10, ''],
    ['regenerate', 10, {}],
  ])
  assert.equal(state.error.value, '')
})

test('提示词改写失败时报错，不会拿原提示词偷偷出图', async () => {
  const { state, calls, run } = makeFixture({
    asset: { id: 11, source_prompt: 'old prompt' },
    promptError: new Error('LLM 改写的提示词不完整'),
  })
  await run()
  assert.deepEqual(calls, [['rewrite-prompt', 11, '']])
  assert.equal(state.error.value, 'LLM 改写的提示词不完整')
  assert.equal(state.regenBusy.value, false)
  assert.equal(state.regenStatus.value, '')
})