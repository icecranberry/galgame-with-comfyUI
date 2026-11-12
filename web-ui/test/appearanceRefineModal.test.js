import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const descriptor = parse(readFileSync(new URL('../src/components/AppearanceRefineModal.vue', import.meta.url), 'utf8')).descriptor
const script = compileScript(descriptor, { id: 'appearance-refine-test' })
const bindings = Object.entries(script.imports).filter(([, entry]) => entry.source !== 'vue').map(([name]) => name)
const code = script.content.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')
const image = 'data:image/png;base64,cG9ydHJhaXQ='
const response = { appearance: 'Angel has white hair.', prompt_before: '身份\n', prompt_after: '\n## 其他\n保留' }

function fixture(t, refine) {
  t.mock.method(console, 'error', () => {})
  const events = { addEventListener() {}, removeEventListener() {} }
  const component = new Function('Vue', 'document', 'window', ...bindings, code)(Vue, events, events,
    ...bindings.map(name => name === 'api' ? { refineAppearanceDraft: refine } : {}))
  const props = Vue.reactive({ modelValue: false, basePrompt: '原始人格卡', displayName: '天使', initialImage: image, autoApply: true })
  let state
  const emitted = []
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { expose() {}, emit: (...event) => { emitted.push(event); if (event[0] === 'update:modelValue') props.modelValue = event[1] } })
    return () => null
  } })
  app.provide('toast', () => {})
  app.mount({})
  t.after(() => app.unmount())
  return { state, props, emitted }
}

test('prefilled infobox image starts analysis and automatically returns the corrected card', async t => {
  let finish
  const calls = []
  const { state, props, emitted } = fixture(t, input => { calls.push(input); return new Promise(resolve => { finish = resolve }) })
  props.modelValue = true; await Vue.nextTick()
  assert.equal(state.refineAnalyzing.value, true)
  assert.equal(state.refineImage.value, image)
  assert.equal(calls[0].basePrompt, '原始人格卡')
  assert.equal(calls[0].image, image)
  finish(response); await Vue.nextTick(); await Vue.nextTick()
  assert.equal(props.modelValue, false)
  assert.deepEqual(emitted.find(([event]) => event === 'applied'), ['applied', { basePrompt: '身份\n## 你的外观\nAngel has white hair.\n## 其他\n保留' }])
})

test('failed automatic analysis retains the card and image, and retry can complete', async t => {
  let failed = true
  const { state, props, emitted } = fixture(t, async () => { if (failed) throw new Error('视觉模型不可用'); return response })
  props.modelValue = true; await Vue.nextTick(); await Vue.nextTick()
  assert.equal(props.modelValue, true)
  assert.equal(props.basePrompt, '原始人格卡')
  assert.equal(state.refineImage.value, image)
  assert.equal(state.refineError.value, '视觉模型不可用')
  assert.equal(emitted.length, 0)
  failed = false
  await state.startRefineAnalysis()
  assert.equal(props.modelValue, false)
})

test('closing cancels analysis and a late result cannot overwrite another draft', async t => {
  let finish, signal
  const { props, emitted } = fixture(t, input => { signal = input.signal; return new Promise(resolve => { finish = resolve }) })
  props.modelValue = true; await Vue.nextTick()
  props.modelValue = false; await Vue.nextTick()
  assert.equal(signal.aborted, true)
  props.basePrompt = '另一张卡片'
  finish(response); await Vue.nextTick(); await Vue.nextTick()
  assert.equal(emitted.length, 0)
})

test('manual correction still requires applying the preview', async t => {
  const { state, props, emitted } = fixture(t, async () => response)
  props.autoApply = false
  props.modelValue = true; await Vue.nextTick(); await Vue.nextTick()
  assert.equal(props.modelValue, true)
  assert.equal(state.refineResult.value, response.appearance)
  assert.equal(emitted.length, 0)
  state.refineResult.value = 'Edited appearance.'
  state.applyRefineResult()
  assert.match(emitted.find(([event]) => event === 'applied')[1].basePrompt, /Edited appearance/)
})
