import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const descriptor = parse(readFileSync(new URL('../src/components/photoStudio/StudioClothingLibrary.vue', import.meta.url), 'utf8')).descriptor
const script = compileScript(descriptor, { id: 'studio-clothing-test' })
const bindings = Object.entries(script.imports).filter(([, entry]) => entry.source !== 'vue').map(([name]) => name)
const code = script.content.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')

function fixture(t, generate = async () => ({ prompt: 'white silk shirt' })) {
  const deps = { generateStudioClothingDraft: generate, getClothingLibrary: async () => ({ entries: [], categories: [] }) }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  const props = Vue.reactive({ modelValue: false, character: { id: 1, name: 'Alice' }, outfit: null })
  let state
  const emitted = []
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup(props, { expose() {}, emit: (...event) => emitted.push(event) }); return () => null } })
  app.mount({})
  t.after(() => app.unmount())
  return { state, props, emitted }
}

test('preset tags apply immediately without AI and a same-character refresh preserves the draft', async t => {
  const { state, props, emitted } = fixture(t, async () => { throw new Error('AI must not run') })
  props.modelValue = true; await Vue.nextTick()
  state.tags.value = ['striped_shirt', 'wet_shirt']; state.query.value = 'shirt'
  props.character = { id: 1, name: 'Alice', outfitScenes: ['work'] }; await Vue.nextTick()
  assert.equal(state.query.value, 'shirt')
  assert.equal(state.promptText.value, 'striped_shirt, wet_shirt')
  await state.apply()
  assert.deepEqual(emitted[0], ['applied', { characterId: 1, outfit: { tags: ['striped_shirt', 'wet_shirt'], brief: '', customPrompt: '' } }])
  props.character = { id: 2, name: 'Bella' }; await Vue.nextTick()
  assert.deepEqual(state.tags.value, [])
})

test('custom-only outfits translate just the text and reuse the translation when tags change', async t => {
  const calls = []
  const { state, props, emitted } = fixture(t, async input => { calls.push(input); return { prompt: 'white silk shirt' } })
  props.modelValue = true; await Vue.nextTick()
  state.brief.value = '白色丝绸衬衫'
  await state.apply()
  assert.equal(calls.length, 1)
  assert.deepEqual(Object.keys(calls[0]).sort(), ['brief', 'signal'])
  const outfit = emitted[0][1].outfit
  assert.deepEqual(outfit, { tags: [], brief: '白色丝绸衬衫', customPrompt: 'white silk shirt' })
  props.modelValue = false; props.outfit = outfit; await Vue.nextTick()
  props.modelValue = true; await Vue.nextTick()
  state.toggle('skirt'); await state.apply()
  assert.equal(calls.length, 1)
  assert.equal(state.promptText.value, 'skirt, white silk shirt')
})

test('closing cancels translation and discards late results', async t => {
  let resolve, signal
  const { state, props, emitted } = fixture(t, input => { signal = input.signal; return new Promise(done => { resolve = done }) })
  props.modelValue = true; await Vue.nextTick()
  state.brief.value = '丝绸衬衫'
  const pending = state.apply()
  props.modelValue = false; await Vue.nextTick()
  assert.equal(signal.aborted, true)
  resolve({ prompt: 'silk shirt' }); await pending
  assert.deepEqual(emitted, [])
})

test('translation failure preserves selected tags and custom text for retry', async t => {
  const { state, props, emitted } = fixture(t, async () => { throw new Error('离线') })
  props.modelValue = true; await Vue.nextTick()
  state.tags.value = ['shirt']; state.brief.value = '白色'
  await state.apply()
  assert.equal(state.error.value, '离线')
  assert.deepEqual(state.tags.value, ['shirt'])
  assert.equal(state.brief.value, '白色')
  assert.equal(state.busy.value, false)
  assert.deepEqual(emitted, [])
})

test('clothing auto-pagination appends near the bottom, preserves selections, and resets on filtering or reopening', async t => {
  const { state, props } = fixture(t)
  props.modelValue = true; await Vue.nextTick(); await Vue.nextTick()
  state.catalog.value.entries = Array.from({ length: 135 }, (_, index) => ({ kind: 'outfit', tag: `tag_${index}`, label: `衣服${index}`, description: '', categories: ['衣服'], subcategories: [] }))
  state.tags.value = ['tag_1']
  const root = { clientHeight: 400, scrollTop: 0, scrollHeight: 2000 }
  state.scrollRoot.value = root
  state.checkScroll(); await Vue.nextTick()
  assert.equal(state.visibleEntries.value.length, 60)
  root.scrollTop = 1450
  state.checkScroll()
  root.scrollHeight = 4000
  await Vue.nextTick()
  assert.equal(state.visibleEntries.value.length, 120)
  assert.deepEqual(state.tags.value, ['tag_1'])
  await state.loadMore()
  assert.equal(state.visibleEntries.value.length, 135)
  state.query.value = '衣服1'; await Vue.nextTick()
  assert.equal(state.limit.value, 60)
  assert.equal(root.scrollTop, 0)
  state.query.value = ''; await Vue.nextTick()
  props.modelValue = false; await Vue.nextTick()
  await state.loadMore()
  assert.equal(state.limit.value, 60)
  props.modelValue = true; await Vue.nextTick()
  assert.equal(state.limit.value, 60)
})
