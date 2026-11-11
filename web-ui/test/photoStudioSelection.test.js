import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import * as dimensions from '../src/utils/photoStudioDimensions.js'
import { STUDIO_OUTFIT_LABELS } from '../src/utils/studioWardrobe.js'

const script = compileScript(parse(readFileSync(new URL('../src/views/PhotoStudioView.vue', import.meta.url), 'utf8')).descriptor, { id: 'studio-selection-test' })
const bindings = Object.entries(script.imports).filter(([, entry]) => entry.source !== 'vue').map(([name]) => name)
const code = script.content.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')

test('both avatar and outfit entry points promote the selected partner to protagonist', async t => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem() {} } })
  t.after(() => { if (oldStorage) Object.defineProperty(globalThis, 'sessionStorage', oldStorage); else delete globalThis.sessionStorage })
  const first = { id: 1, name: 'Alice' }, partner = { id: 2, name: 'Bella' }
  const deps = { ...dimensions, STUDIO_OUTFIT_LABELS, usePhotoStudio: () => ({
    catalog: Vue.ref([]), characters: Vue.ref([first, partner]), jobs: Vue.ref([]), capability: Vue.ref({ available: true }),
    load: async () => {}, poll: async () => {}, create: async () => {},
  }) }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
  app.mount({})
  t.after(() => app.unmount())
  await Vue.nextTick()
  for (const choose of [() => state.selectOutfitCharacter(partner), () => state.selectOutfit(partner, 'casual')]) {
    state.characterId.value = first.id
    state.secondCharacterId.value = partner.id
    state.characterSlot.value = 'first'
    choose()
    assert.equal(state.characterId.value, partner.id)
    assert.equal(state.secondCharacterId.value, '')
    assert.equal(state.characterSlotNumber(partner), 1)
    assert.equal(state.characterSlotNumber(first), 0)
  }
})

test('background selection persists and sends only the preset ID or the frozen custom prompt', async t => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const stored = new Map([['photo-studio-selection', JSON.stringify({ background: { source: 'library', id: 'bg-001', label: '晨雾松林' } })]])
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) } })
  t.after(() => { if (oldStorage) Object.defineProperty(globalThis, 'sessionStorage', oldStorage); else delete globalThis.sessionStorage })
  const deps = { ...dimensions, STUDIO_OUTFIT_LABELS, getPhotoStudioBackgrounds: async () => ({ entries: [{ id: 'bg-001', label: '包豪斯三原色', description: '红黄蓝色块', prompt: 'Bauhaus shapes' }] }), usePhotoStudio: () => ({
    catalog: Vue.ref([]), characters: Vue.ref([]), jobs: Vue.ref([]), capability: Vue.ref({ available: true }),
    load: async () => {}, poll: async () => {}, create: async () => {},
  }) }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
  app.mount({}); t.after(() => app.unmount())
  await state.refreshSavedBackground()
  assert.equal(state.background.value.label, '包豪斯三原色')
  state.characterId.value = 1
  state.applyClothing({ characterId: 1, outfit: { tags: ['striped_shirt'], brief: '白色', customPrompt: 'white' } })
  assert.deepEqual(state.shotInput().clothingTags, ['striped_shirt'])
  assert.equal(state.shotInput().customClothingPrompt, 'white')
  assert.equal(Object.hasOwn(state.shotInput(), 'appearanceOverride'), false)
  assert.equal(state.shotInput().backgroundId, 'bg-001')
  assert.equal(state.shotInput().customBackgroundPrompt, '')
  state.background.value = { source: 'custom', label: '自定义背景', description: '雨夜', prompt: 'An old street on a rainy night.' }
  await Vue.nextTick()
  assert.equal(state.shotInput().backgroundId, '')
  assert.equal(state.shotInput().customBackgroundPrompt, 'An old street on a rainy night.')
  assert.deepEqual(JSON.parse(stored.get('photo-studio-selection')).background, state.background.value)
  state.background.value = null
  await Vue.nextTick()
  assert.equal(state.shotInput().backgroundId, '')
  assert.equal(state.shotInput().customBackgroundPrompt, '')
  assert.equal(JSON.parse(stored.get('photo-studio-selection')).background, null)
})


test('AI polishing defaults off and remembers either explicit choice across page mounts and fresh sessions', async t => {
  const oldSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const oldLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  t.after(() => {
    if (oldSession) Object.defineProperty(globalThis, 'sessionStorage', oldSession); else delete globalThis.sessionStorage
    if (oldLocal) Object.defineProperty(globalThis, 'localStorage', oldLocal); else delete globalThis.localStorage
  })
  const local = new Map()
  const session = new Map([['photo-studio-selection', JSON.stringify({ polishPrompt: true })]])
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value) } })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => session.get(key) || null, setItem: (key, value) => session.set(key, value) } })
  const deps = { ...dimensions, STUDIO_OUTFIT_LABELS, usePhotoStudio: () => ({
    catalog: Vue.ref([]), characters: Vue.ref([]), jobs: Vue.ref([]), capability: Vue.ref({ available: true }),
    load: async () => {}, poll: async () => {}, create: async () => {},
  }) }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  const mount = () => {
    let state
    const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
    app.mount({})
    return { state, app }
  }
  for (const [initial, next] of [[false, true], [true, false], [false, true]]) {
    const { state, app } = mount()
    try {
      assert.equal(state.polishPrompt.value, initial)
      assert.equal(state.shotInput().polishPrompt, initial)
      state.polishPrompt.value = next
      // Save synchronously, even if the window closes immediately after toggling.
      assert.equal(local.get('photo-studio-polish-enabled'), String(next))
      assert.equal(state.shotInput().polishPrompt, next)
      state.persistSelection()
      assert.equal(Object.hasOwn(JSON.parse(session.get('photo-studio-selection')), 'polishPrompt'), false)
    } finally { app.unmount() }
    session.clear()
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw new Error('unavailable') }, setItem() { throw new Error('unavailable') } } })
  const { state, app } = mount()
  try {
    assert.equal(state.polishPrompt.value, false)
    assert.doesNotThrow(() => { state.polishPrompt.value = true })
  } finally { app.unmount() }
})
