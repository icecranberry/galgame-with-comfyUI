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
  const props = Vue.reactive({ modelValue: false, slotKey: 'first', character: { id: 1, name: 'Alice' }, outfit: null, draft: null })
  let state
  const emitted = []
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup(props, { expose() {}, emit: (...event) => emitted.push(event) }); return () => null } })
  app.mount({})
  t.after(() => app.unmount())
  return { state, props, emitted }
}

test('preset tags apply immediately without AI and changing the actor preserves the slot draft', async t => {
  const { state, props, emitted } = fixture(t, async () => { throw new Error('AI must not run') })
  props.modelValue = true; await Vue.nextTick()
  state.tags.value = ['striped_shirt', 'wet_shirt']; state.query.value = 'shirt'
  props.character = { id: 2, name: 'Bella', outfitScenes: ['work'] }; await Vue.nextTick()
  assert.equal(state.query.value, 'shirt')
  assert.equal(state.promptText.value, 'striped_shirt, wet_shirt')
  await state.apply()
  assert.deepEqual(emitted.find(([event]) => event === 'applied'), ['applied', { slot: 'first', outfit: { tags: ['striped_shirt', 'wet_shirt'], brief: '', customPrompt: '' } }])
  props.slotKey = 'second'; await Vue.nextTick()
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
  const outfit = emitted.find(([event]) => event === 'applied')[1].outfit
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
  assert.deepEqual(emitted.filter(([event]) => event === 'applied'), [])
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
  assert.deepEqual(emitted.filter(([event]) => event === 'applied'), [])
})

test('clearing an outfit removes tags, custom text and translation without closing or resaving a draft', async t => {
  const { state, props, emitted } = fixture(t)
  props.outfit = { tags: ['shirt'], brief: '蓝色外套', customPrompt: 'blue coat' }
  props.modelValue = true; await Vue.nextTick()
  state.error.value = '旧错误'
  state.query.value = 'shirt'
  state.clearOutfit()
  assert.deepEqual(state.tags.value, [])
  assert.equal(state.brief.value, '')
  assert.equal(state.translatedBrief.value, '')
  assert.equal(state.customPrompt.value, '')
  assert.equal(state.promptText.value, '')
  assert.equal(state.error.value, '')
  assert.equal(state.visible.value, true)
  assert.equal(state.query.value, 'shirt')
  assert.deepEqual(emitted, [['applied', { slot: 'first', outfit: null }]])

  props.outfit = null; props.draft = null
  props.modelValue = false; await Vue.nextTick()
  props.modelValue = true; await Vue.nextTick()
  assert.deepEqual(state.tags.value, [])
  assert.equal(state.brief.value, '')
  assert.equal(state.promptText.value, '')
  state.toggle('skirt')
  assert.deepEqual(emitted.at(-1), ['draft-change', { slot: 'first', outfit: { tags: ['skirt'], brief: '', customPrompt: '' } }])
})

test('clearing a custom-only partner draft affects that slot and does not reuse its old translation', async t => {
  const calls = []
  const { state, props, emitted } = fixture(t, async input => { calls.push(input); return { prompt: 'new translation' } })
  props.slotKey = 'second'
  props.draft = { tags: [], brief: '白色外套', customPrompt: 'white coat' }
  props.modelValue = true; await Vue.nextTick()
  state.clearOutfit()
  assert.deepEqual(emitted, [['applied', { slot: 'second', outfit: null }]])
  assert.equal(state.visible.value, true)
  assert.equal(state.promptText.value, '')
  state.brief.value = '白色外套'
  await state.apply()
  assert.equal(calls.length, 1)
  assert.equal(emitted.filter(([event]) => event === 'applied').at(-1)[1].outfit.customPrompt, 'new translation')
})

test('clearing remains blocked while translating or when the library is closed', async t => {
  const { state, props, emitted } = fixture(t)
  state.clearOutfit()
  assert.deepEqual(emitted, [])
  props.outfit = { tags: ['shirt'], brief: '', customPrompt: '' }
  props.modelValue = true; await Vue.nextTick()
  state.busy.value = true
  state.clearOutfit()
  assert.deepEqual(state.tags.value, ['shirt'])
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


test('edits emit synchronously and reopening restores unapplied text without stale translation', async t => {
  const calls = []
  const { state, props, emitted } = fixture(t, async input => { calls.push(input); return { prompt: 'red coat' } })
  props.outfit = { tags: ['shirt'], brief: '蓝色外套', customPrompt: 'blue coat' }
  props.modelValue = true; await Vue.nextTick()
  assert.equal(emitted.length, 0, 'restoring must not overwrite stored drafts')
  state.toggle('skirt')
  assert.deepEqual(emitted.at(-1)[1].outfit.tags, ['shirt', 'skirt'])
  state.brief.value = '红色外套'
  const draft = emitted.at(-1)[1].outfit
  assert.deepEqual(draft, { tags: ['shirt', 'skirt'], brief: '红色外套', customPrompt: '' })
  props.modelValue = false; await Vue.nextTick()
  props.draft = draft; props.modelValue = true; await Vue.nextTick()
  assert.equal(state.brief.value, '红色外套')
  assert.equal(state.promptText.value, 'shirt, skirt')
  await state.apply()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].brief, '红色外套')
  assert.equal(emitted.find(([event]) => event === 'applied')[1].outfit.customPrompt, 'red coat')
})

test('empty drafts override applied outfits and slot hydration never saves to another slot', async t => {
  const { state, props, emitted } = fixture(t)
  props.outfit = { tags: ['shirt'], brief: '', customPrompt: '' }
  props.draft = { tags: [], brief: '', customPrompt: '' }
  props.modelValue = true; await Vue.nextTick()
  assert.deepEqual(state.tags.value, [])
  state.brief.value = '未翻译的衣服'
  assert.equal(emitted.at(-1)[1].slot, 'first')
  const count = emitted.length
  props.slotKey = 'second'; props.draft = { tags: ['skirt'], brief: '', customPrompt: '' }
  await Vue.nextTick()
  assert.equal(emitted.length, count)
  assert.deepEqual(state.tags.value, ['skirt'])
  state.toggle('hat')
  assert.equal(emitted.at(-1)[1].slot, 'second')
})


test('switching slots during translation preserves the original draft and ignores the late result', async t => {
  let resolve, signal
  const { state, props, emitted } = fixture(t, input => {
    signal = input.signal
    return new Promise(done => { resolve = done })
  })
  props.modelValue = true; await Vue.nextTick()
  state.brief.value = '白衬衫'
  const pending = state.apply()
  props.slotKey = 'second'; props.draft = { tags: ['skirt'], brief: '', customPrompt: '' }
  await Vue.nextTick()
  assert.equal(signal.aborted, true)
  resolve({ prompt: 'white shirt' }); await pending
  assert.deepEqual(emitted.filter(([event]) => event === 'applied'), [])
  assert.deepEqual(state.tags.value, ['skirt'])
  assert.equal(emitted.find(([event]) => event === 'draft-change')[1].slot, 'first')
})
