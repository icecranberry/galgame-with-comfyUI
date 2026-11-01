import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

function fixture(t, file, initial, dependencies = {}) {
  const script = compileScript(parse(readFileSync(new URL(`../src/components/${file}.vue`, import.meta.url), 'utf8')).descriptor, { id: 'appearance-refine-test' })
  const bindings = Object.entries(script.imports).filter(([, item]) => item.source !== 'vue').map(([name]) => name)
  const code = script.content.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
    .replace(/^import .* from .*$/gm, '').replace('export default', 'return')
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => dependencies[name] || {}))
  const previous = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of ['window', 'document']) Object.defineProperty(globalThis, key, { configurable: true, value: { addEventListener() {}, removeEventListener() {} } })
  const props = Vue.reactive(initial), events = [], notices = []
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { expose() {}, emit: (...args) => events.push(args) })
    return () => null
  } })
  app.provide('toast', (...args) => notices.push(args))
  app.mount({})
  t.after(() => {
    app.unmount()
    for (const key of ['window', 'document']) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key])
      else delete globalThis[key]
    }
  })
  return { props, state, events, notices }
}
const initial = () => ({ modelValue: false, characterId: 'god:angel', displayName: '天使', sceneLabel: '睡衣', basePrompt: '天使人设\n\n## 你的外观\n旧睡衣', recentImagesLoader: async () => ({ images: [] }) })

test('shared image analysis receives angel draft and scene without a resident id and applies edited appearance', async t => {
  const calls = []
  const h = fixture(t, 'AppearanceRefineModal', initial(), { api: { refineAppearanceDraft: async payload => {
    calls.push(payload)
    return { appearance: 'blue nightdress, barefoot', prompt_before: '天使人设\n\n', prompt_after: '\n## 其他\n保留' }
  } } })
  h.props.modelValue = true; await Vue.nextTick()
  h.state.refineImage.value = 'data:image/png;base64,fixture'
  await h.state.startRefineAnalysis()
  assert.equal(calls[0].sceneLabel, '睡衣')
  assert.equal(calls[0].basePrompt, h.props.basePrompt)
  assert.equal(calls[0].characterId, undefined)
  h.state.refineResult.value = 'edited ivory nightdress, barefoot'
  h.state.applyRefineResult()
  assert.deepEqual(h.events.at(-1), ['applied', { basePrompt: '天使人设\n\n## 你的外观\nedited ivory nightdress, barefoot\n## 其他\n保留' }])
})

test('closing analysis aborts its request and reopening cannot receive the old image result', async t => {
  let release, signal
  const h = fixture(t, 'AppearanceRefineModal', initial(), { api: { refineAppearanceDraft: payload => {
    signal = payload.signal; return new Promise(resolve => { release = resolve })
  } } })
  h.props.modelValue = true; await Vue.nextTick()
  h.state.refineImage.value = 'data:image/png;base64,fixture'
  const pending = h.state.startRefineAnalysis()
  h.props.modelValue = false; await Vue.nextTick()
  assert.equal(signal.aborted, true)
  h.props.modelValue = true; await Vue.nextTick()
  release({ appearance: 'stale', prompt_before: '', prompt_after: '' })
  await pending
  assert.equal(h.state.refineResult.value, '')
  assert.equal(h.state.refineImage.value, '')
  assert.equal(h.state.refineAnalyzing.value, false)
})

test('Escape closes only the recent-image picker and retains it mounted for the exit transition', async t => {
  const h = fixture(t, 'AppearanceRefineModal', initial())
  h.props.modelValue = true; await Vue.nextTick()
  h.state.openRecentPicker()
  let stopped = false
  h.state.onNestedEscape({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() { stopped = true } })
  assert.equal(stopped, true)
  assert.equal(h.state.showRefinePicker.value, false)
  assert.equal(h.state.pickerMounted.value, true)
  assert.deepEqual(h.events, [])
})

test('angel recent images use the supplied loader and late responses cannot populate a closed picker', async t => {
  let release, residentCalls = 0
  const h = fixture(t, 'RecentImageCropper', { characterId: 'god:angel', visible: true, imagesLoader: () => new Promise(resolve => { release = resolve }) },
    { getRecentImages: async () => { residentCalls++; return { images: [] } } })
  h.props.visible = false; await Vue.nextTick()
  release({ images: ['/images/standing/old.png'] }); await Vue.nextTick(); await Vue.nextTick()
  assert.deepEqual(h.state.images.value, [])
  h.props.imagesLoader = async () => ({ images: ['/images/standing/angel.png'] })
  h.props.visible = true; await Vue.nextTick(); await Vue.nextTick()
  assert.deepEqual(h.state.images.value, ['/images/standing/angel.png'])
  assert.equal(residentCalls, 0)
})


test('ordinary resident recent-image loading retains the original API path', async t => {
  const ids = []
  const h = fixture(t, 'RecentImageCropper', { characterId: 42, visible: true, imagesLoader: null },
    { getRecentImages: async id => { ids.push(id); return { images: ['/images/chat/resident.png'] } } })
  await Vue.nextTick(); await Vue.nextTick()
  assert.deepEqual(ids, [42])
  assert.deepEqual(h.state.images.value, ['/images/chat/resident.png'])
})
