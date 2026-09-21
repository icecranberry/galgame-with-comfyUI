import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse as parseSfc, compileTemplate } from '@vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'

const sfcPath = new URL('../src/components/town/TownAdminPanel.vue', import.meta.url)
const descriptor = parseSfc(readFileSync(sfcPath, 'utf8')).descriptor
const script = descriptor.scriptSetup.content
const nodes = parseJs(script, { sourceType: 'module' }).program.body
function handler(name, state) {
  const node = nodes.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  return new Function('state', `with (state) { return (${script.slice(node.start, node.end)}) }`)(state)
}

test('入住开关只在角色自己的大立绘 + 正/背小人都就绪时可用', () => {
  const charAssetsReady = handler('charAssetsReady', {})
  const ready = { status: 'ready' }
  assert.equal(charAssetsReady({ portrait: ready, spriteAssets: { down: ready, up: ready } }), true)
  assert.equal(charAssetsReady({ portrait: ready, spriteAssets: { down: ready, up: { status: 'generating' } } }), false)
  assert.equal(charAssetsReady({ portrait: { status: 'generating' }, spriteAssets: { down: ready, up: ready } }), false)
  assert.equal(charAssetsReady({ portrait: ready, spriteAssets: { down: ready } }), false)
  assert.equal(charAssetsReady({ portrait: ready, spriteAssets: {} }), false)
  assert.equal(charAssetsReady(null), false)
})

test('角色详情模板：入住开关受素材就绪约束，并带职能选择器', () => {
  const template = descriptor.template.content
  const compiled = compileTemplate({ source: template, filename: 'TownAdminPanel.vue', id: 'town-admin-panel' })
  assert.deepEqual(compiled.errors, [])
  assert.match(template, /:disabled="!!busyFlags\[`chartoggle\$\{detailChar\.id\}`\] \|\| \(!charAssetsReady\(detailChar\) && !detailChar\.townEnabled\)"/)
  assert.match(template, /<TownCapabilityPicker[\s\S]{0,240}:model-value="detailChar\.capabilities"/)
  assert.match(template, /@update:model-value="value => saveCharCapabilities\(detailChar, value\)"/)
})
function makeGenFixture ({ result = { ok: true, ready: true } } = {}) {
  const calls = []
  const state = {
    assetScope: 'scope-a',
    alive: true,
    props: { open: true },
    spriteErrors: {},
    busyFlags: {},
    loadChars: async () => {},
    api: {
      async ensureTownCharacterAssets (id, options) {
        calls.push([id, options])
        return result
      },
    },
  }
  state.generateCharAssets = handler('generateCharAssets', state)
  return { state, calls }
}

test('素材按钮常显：缺素材时是「生成角色素材」，齐了变「重新生成角色素材」并整套重绘', async () => {
  const template = descriptor.template.content
  assert.match(template, /\{\{ charAssetsReady\(detailChar\) \? '重新生成角色素材' : '生成角色素材' \}\}/)
  assert.match(template, /@click="generateCharAssets\(detailChar, \{ force: charAssetsReady\(detailChar\) \}\)"/)
  assert.doesNotMatch(template, /charMissingAssets\(detailChar\)" class="ap-btn-row"/)

  const { state, calls } = makeGenFixture()
  await state.generateCharAssets({ id: 42 }, { force: true })
  assert.deepEqual(calls, [[42, { force: true }]])
  assert.equal(state.busyFlags['charassets42'], false)
  assert.equal(state.spriteErrors['char:42'], '')
})
test('重新生成时部分素材没成功：保留旧图并给出提示', async () => {
  const { state } = makeGenFixture({ result: { ok: true, ready: true, steps: { portrait: 'failed', sprites: 'regenerated' } } })
  await state.generateCharAssets({ id: 7 }, { force: true })
  assert.match(state.spriteErrors['char:7'], /旧图仍在使用/)
})