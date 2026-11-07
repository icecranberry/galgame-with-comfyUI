import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const descriptor = parse(readFileSync(new URL('../src/components/LibraryModal.vue', import.meta.url), 'utf8')).descriptor
const script = compileScript(descriptor, { id: 'library-scene-draft-test' })
const bindings = Object.entries(script.imports).filter(([, entry]) => entry.source !== 'vue').map(([name]) => name)
const code = script.content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '')
  .replace('export default', 'return')

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const api = {
    describeLibraryImage: async () => ({ direction: '识别得到的场景' }),
    createTopic: async payload => {
      calls.push(payload)
      return { ...payload, id: 12, source: 'custom' }
    },
    listTopics: async () => [],
  }
  const deps = Object.fromEntries(bindings.map(name => [name, name === 'api' ? api : {}]))
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name]))
  const props = Vue.reactive({ modelValue: true, type: 'topics' })
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { expose() {}, emit() {} })
    return () => null
  } })
  app.provide('toast', () => {})
  app.provide('confirm', async () => true)
  app.mount({})
  t.after(() => app.unmount())
  const previousReader = globalThis.FileReader
  globalThis.FileReader = class {
    readAsDataURL() { this.result = 'data:image/png;base64,test'; this.onload() }
  }
  t.after(() => {
    if (previousReader) globalThis.FileReader = previousReader
    else delete globalThis.FileReader
  })
  return { state, props, calls, api, image: { type: 'image/png', size: 10 } }
}

test('recognized scene becomes an editable draft of the CURRENT text; only Save persists it', async t => {
  const { state, calls, image } = fixture(t)
  await state.recognizeSceneImage(image)
  assert.equal(state.sceneImageReady.value, true)
  state.direction.value = '用户修改后的场景\n保留换行'
  state.customOpen.value = false
  await state.addSceneDraft()
  const draft = state.customItems.value[0]
  assert.equal(draft.name, '自定义事件')
  assert.equal(draft.desc, state.direction.value)
  assert.equal(draft._editing, true)
  assert.equal(draft.id, undefined)
  assert.equal(state.customOpen.value, true)
  assert.deepEqual(calls, [])
  let focused = 0
  state.setCustomCardRef(draft._tempKey, { focusEditor: () => focused++ })
  await state.addSceneDraft()
  assert.equal(state.customItems.value.length, 1, 'double click during entry must not duplicate the draft')
  t.mock.timers.tick(300)
  assert.equal(focused, 1)
  draft.name = '修改后的标题'
  await state.saveItem(draft)
  assert.deepEqual(calls, [{ name: '修改后的标题', desc: '用户修改后的场景\n保留换行' }])
  assert.equal(state.customItems.value[0].id, 12)
  assert.equal(state.customItems.value[0]._editing, undefined)
})

test('cancel removes the draft without saving and keeps the input available', async t => {
  const { state, calls, image } = fixture(t)
  await state.recognizeSceneImage(image)
  await state.addSceneDraft()
  state.cancelEdit(state.customItems.value[0])
  t.mock.timers.tick(300)
  assert.equal(state.customItems.value.length, 0)
  assert.equal(state.direction.value, '识别得到的场景')
  assert.deepEqual(calls, [])
})

test('unrecognized, empty, busy and event-library states cannot create a scene draft', async t => {
  const { state, props, api, image } = fixture(t)
  api.describeLibraryImage = async () => { throw new Error('识别失败') }
  await state.recognizeSceneImage(image)
  state.direction.value = '普通输入'
  await state.addSceneDraft()
  assert.equal(state.sceneImageReady.value, false)
  state.sceneImageReady.value = true
  for (const busy of [state.loading, state.generating, state.saving, state.describingImage]) {
    busy.value = true
    await state.addSceneDraft()
    busy.value = false
  }
  state.direction.value = '  '
  await state.addSceneDraft()
  state.direction.value = '场景'
  props.type = 'event-types'
  await state.addSceneDraft()
  assert.equal(state.customItems.value.length, 0)
})

test('closing clears image readiness and cancels pending card focus', async t => {
  const { state, props, image } = fixture(t)
  await state.recognizeSceneImage(image)
  await state.addSceneDraft()
  let focused = false
  state.setCustomCardRef(state.customItems.value[0]._tempKey, { focusEditor: () => { focused = true } })
  props.modelValue = false
  await Vue.nextTick()
  t.mock.timers.tick(300)
  assert.equal(focused, false)
  assert.equal(state.sceneImageReady.value, false)
  assert.equal(state.addingSceneDraft.value, false)
})
