import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const script = compileScript(parse(readFileSync(new URL('../src/components/photoStudio/StudioBackgroundLibrary.vue', import.meta.url), 'utf8')).descriptor, { id: 'studio-background-test' })
const bindings = Object.entries(script.imports).filter(([, entry]) => entry.source !== 'vue').map(([name]) => name)
const code = script.content.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')
const scene = { id: 'bg-001', label: '晨雾松林', description: '薄雾笼罩的松林', prompt: 'A pine forest with morning mist.', category: '自然山野' }

function fixture(t, generate = async () => ({ prompt: 'A quiet street after the rain, with warm reflections on the pavement.' })) {
  const deps = { getPhotoStudioBackgrounds: async () => ({ entries: [scene], categories: [{ value: scene.category, label: scene.category }] }), generatePhotoStudioBackground: generate }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  const props = Vue.reactive({ modelValue: false, value: null })
  let state
  const emitted = []
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup(props, { expose() {}, emit: (...event) => emitted.push(event) }); return () => null } })
  app.mount({}); t.after(() => app.unmount())
  return { state, props, emitted }
}

test('selecting a scene is a draft until confirmed; cancel preserves the current background', async t => {
  const { state, props, emitted } = fixture(t)
  props.modelValue = true; await Vue.nextTick(); await Vue.nextTick()
  state.selectedId.value = scene.id
  assert.deepEqual(emitted, [])
  state.visible.value = false
  assert.deepEqual(emitted, [['update:modelValue', false]])
  props.modelValue = false; await Vue.nextTick()
  emitted.length = 0
  await state.apply()
  assert.deepEqual(emitted, [])
  props.modelValue = true; await Vue.nextTick()
  state.selectedId.value = scene.id
  await state.apply()
  assert.deepEqual(emitted[0], ['applied', { ...scene, source: 'library' }])
  props.value = { ...scene, source: 'library' }
  emitted.length = 0
  state.clear()
  assert.deepEqual(emitted[0], ['applied', null])
})

test('random background spans all categories, reveals its category and remains a draft', async t => {
  const { state, props, emitted } = fixture(t)
  props.modelValue = true; await Vue.nextTick(); await Vue.nextTick()
  state.catalog.value.entries = [scene, { ...scene, id: 'bg-002', label: '教室', category: '学校' }]
  state.category.value = scene.category
  state.selectedId.value = scene.id
  assert.equal(state.filtered.value.length, 1)
  state.randomize()
  assert.equal(state.selectedId.value, 'bg-002')
  assert.equal(state.category.value, '学校')
  assert.equal(state.filtered.value[0].id, 'bg-002')
  state.mode.value = 'custom'
  state.description.value = '自定义内容仍然保留'
  state.randomize()
  assert.equal(state.mode.value, 'library')
  assert.equal(state.selectedId.value, scene.id)
  assert.equal(state.category.value, scene.category)
  assert.equal(state.description.value, '自定义内容仍然保留')
  state.catalog.value.entries = []
  state.randomize()
  assert.equal(state.selectedId.value, scene.id)
  assert.equal(state.randomCandidates.value.length, 0)
  assert.deepEqual(emitted, [])
})

test('confirming without a selected background applies the default white background', async t => {
  const { state, props, emitted } = fixture(t)
  props.modelValue = true; await Vue.nextTick(); await Vue.nextTick()
  await state.apply()
  assert.deepEqual(emitted, [['applied', null], ['update:modelValue', false]])
})

test('custom text is converted once; an unchanged saved background reuses its English prompt', async t => {
  let calls = 0
  const { state, props, emitted } = fixture(t, async ({ description }) => { calls++; assert.equal(description, '雨后的旧街'); return { prompt: 'A rain-washed old street.' } })
  props.modelValue = true; await Vue.nextTick()
  state.mode.value = 'custom'; state.description.value = ' 雨后的旧街 '
  await state.apply()
  const value = emitted.find(event => event[0] === 'applied')[1]
  assert.equal(value.description, '雨后的旧街')
  assert.equal(value.prompt, 'A rain-washed old street.')
  assert.equal(state.busy.value, false)
  props.modelValue = false; props.value = value; await Vue.nextTick()
  props.modelValue = true; await Vue.nextTick()
  assert.equal(state.mode.value, 'custom')
  await state.apply()
  assert.equal(calls, 1)
})

test('closing during conversion aborts the request and discards a late response after reopening', async t => {
  let resolve, signal
  const { state, props, emitted } = fixture(t, input => { signal = input.signal; return new Promise(done => { resolve = done }) })
  props.modelValue = true; await Vue.nextTick()
  state.mode.value = 'custom'; state.description.value = '雪山湖畔'
  const pending = state.apply()
  state.visible.value = false
  assert.equal(signal.aborted, true)
  props.modelValue = false; await Vue.nextTick()
  props.modelValue = true; await Vue.nextTick()
  resolve({ prompt: 'A late result.' }); await pending
  assert.equal(emitted.filter(event => event[0] === 'applied').length, 0)
  assert.equal(state.busy.value, false)
})

test('failed conversion keeps the draft available for retry and never applies an empty result', async t => {
  const { state, props, emitted } = fixture(t, async () => { throw new Error('模型离线') })
  props.modelValue = true; await Vue.nextTick()
  state.mode.value = 'custom'; state.description.value = '雪山湖畔'
  await state.apply()
  assert.equal(state.description.value, '雪山湖畔')
  assert.equal(state.error.value, '模型离线')
  assert.equal(state.busy.value, false)
  assert.deepEqual(emitted, [])
})
