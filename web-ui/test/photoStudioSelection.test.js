import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import * as dimensions from '../src/utils/photoStudioDimensions.js'
import { STUDIO_OUTFIT_LABELS } from '../src/utils/studioWardrobe.js'
import { usePhotoStudio as createStudio } from '../src/composables/usePhotoStudio.js'

const script = compileScript(parse(readFileSync(new URL('../src/views/PhotoStudioView.vue', import.meta.url), 'utf8')).descriptor, { id: 'studio-selection-test' })
const bindings = Object.entries(script.imports).filter(([, entry]) => entry.source !== 'vue').map(([name]) => name)
const code = script.content.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')

test('image pasting shares pose upload, preserves text paste and only handles the open library', async t => {
  const listeners = new Map(), reads = [], calls = []
  const result = { posePrompt: 'character 1 raises both arms and smiles.', personCount: 1, imageUrl: '/images/photo_studio/pose-ref-test.png' }
  const globals = {
    document: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name) } },
    sessionStorage: { getItem: () => null, setItem() {} }, localStorage: { getItem: () => null, setItem() {} },
    FileReader: class { readAsDataURL(file) { reads.push(file); this.result = 'data:image/png;base64,dGVzdA=='; this.onload() } },
  }
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name] })
  }
  let finish
  const deps = { ...dimensions, STUDIO_OUTFIT_LABELS,
    describePhotoStudioPose: (image, signal) => { calls.push({ image, signal }); return new Promise(resolve => { finish = resolve }) },
    usePhotoStudio: () => ({ catalog: Vue.ref([]), characters: Vue.ref([]), jobs: Vue.ref([]), capability: Vue.ref({ available: true }), load: async () => {}, poll: async () => {}, create: async () => {} }),
  }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
  app.mount({}); t.after(() => app.unmount())
  await Vue.nextTick()
  const paste = listeners.get('paste')
  assert.equal(typeof paste, 'function')
  const file = { type: 'image/png', size: 42 }
  const event = clipboardData => ({ clipboardData, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } })
  const picture = () => event({ items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] })
  const closed = picture()
  await paste(closed)
  assert.equal(closed.defaultPrevented, false)
  state.poseOpen.value = true
  const text = event({ items: [{ kind: 'string', type: 'text/plain' }], files: [] })
  await paste(text)
  assert.equal(text.defaultPrevented, false)
  const incoming = picture(), pending = paste(incoming)
  await Promise.resolve()
  assert.equal(incoming.defaultPrevented, true)
  assert.equal(state.describingPose.value, true)
  await paste(picture())
  assert.equal(calls.length, 1, 'repeated image pasting must not start concurrent recognition')
  finish(result); await pending
  assert.deepEqual(state.customPose.value, result)
  assert.equal(state.poseId.value, 'custom-upload')
  assert.equal(state.duoPose.value, false, 'a recognized single-person image only uses the protagonist')
  const fallback = event({ items: [], files: [file] }), next = paste(fallback)
  const pairResult = { ...result, personCount: 2, posePrompt: 'character 1 holds the hand of character 2.' }
  await Promise.resolve(); finish(pairResult); await next
  assert.equal(state.duoPose.value, true, 'a recognized pair automatically enables the partner')
  assert.equal(state.shotInput().customPose.personCount, 2)
  assert.equal(fallback.defaultPrevented, true)
  assert.deepEqual(reads, [file, file])
  app.unmount()
  assert.equal(listeners.has('paste'), false)
});

test('supplementary descriptions expand without a request, revise the saved image and preserve drafts on failure', async t => {
  const stored = new Map(), calls = [], fetches = []
  const original = { posePrompt: 'character 1 sits on a bench.', personCount: 1, imageUrl: '/images/photo_studio/pose-ref-test.png' }
  stored.set('photo-studio-custom-pose', JSON.stringify(original))
  let failure = false, focuses = 0, genericMime = false
  const file = { type: 'image/png', size: 42 }
  const globals = {
    localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) },
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: async (url, options) => { fetches.push({ url, signal: options.signal }); return { ok: true, blob: async () => genericMime ? new Blob(['test'], { type: 'application/octet-stream' }) : file } },
    FileReader: class { readAsDataURL(value) { if (value !== file) assert.equal(value.type, 'image/avif'); this.result = 'data:image/png;base64,dGVzdA=='; this.onload() } },
  }
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name] })
  }
  const result = { ...original, posePrompt: 'character 1 raises the right hand.', personCount: 2 }
  const deps = { ...dimensions, STUDIO_OUTFIT_LABELS,
    describePhotoStudioPose: async (image, signal, direction) => { calls.push({ image, signal, direction }); if (failure) throw new Error('识别失败'); return result },
    usePhotoStudio: () => ({ catalog: Vue.ref([]), characters: Vue.ref([]), jobs: Vue.ref([]), capability: Vue.ref({ available: true }), load: async () => {}, poll: async () => {}, create: async () => {} }),
  }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
  app.mount({}); t.after(() => app.unmount()); await Vue.nextTick()
  state.poseDescriptionInput.value = { focus() { focuses++ } }
  await state.revisePose()
  assert.equal(state.poseDescriptionOpen.value, true)
  assert.equal(focuses, 1)
  assert.equal(calls.length, 0)
  state.poseDescription.value = '  右手抬高  '
  assert.equal(JSON.parse(stored.get('photo-studio-custom-pose')).description, '  右手抬高  ')
  const pending = state.revisePose()
  assert.equal(state.describingPose.value, true)
  await state.revisePose(); await pending
  assert.equal(fetches.length, 1)
  assert.equal(fetches[0].url, original.imageUrl)
  assert.equal(calls[0].direction, '右手抬高')
  assert.equal(state.customPose.value.posePrompt, result.posePrompt)
  assert.equal(state.duoPose.value, true)
  assert.equal(state.poseId.value, 'custom-upload')
  failure = true
  state.poseDescription.value = '左手保持原位'
  await state.revisePose()
  assert.equal(state.customPose.value.posePrompt, result.posePrompt)
  assert.equal(state.poseDescription.value, '左手保持原位')
  assert.equal(state.poseUploadError.value, '识别失败')
  failure = false
  genericMime = true
  state.customPose.value.imageUrl = '/images/photo_studio/pose-ref-test.avif'
  await state.revisePose()
  assert.equal(state.poseUploadError.value, '')
  assert.equal(calls.at(-1).direction, '左手保持原位')
  await state.recognizePose(file)
  assert.equal(calls.at(-1).direction, '')
  assert.equal(state.poseDescriptionOpen.value, false)
  assert.equal(state.poseDescription.value, '')
});

test('uploaded pose prompts save immediately, restore across mounts and reach only the selected pose payload', async t => {
  const stored = new Map(), session = new Map()
  for (const [key, map] of [['localStorage', stored], ['sessionStorage', session]]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value: { getItem: name => map.get(name) || null, setItem: (name, value) => map.set(name, value) } })
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key] })
  }
  const upload = { posePrompt: 'character 1 raises the left arm, smiling beside a table.', personCount: 1, imageUrl: '/images/photo_studio/pose-ref-test.png' }
  stored.set('photo-studio-custom-pose', JSON.stringify(upload))
  session.set('photo-studio-selection', JSON.stringify({ poseId: 'custom-upload', characterId: 1 }))
  const deps = { ...dimensions, STUDIO_OUTFIT_LABELS, usePhotoStudio: () => ({
    catalog: Vue.ref([{ id: 'pose', posePrompt: 'standing', system: '单人' }]), characters: Vue.ref([{ id: 1, name: 'Alice' }]), jobs: Vue.ref([]), capability: Vue.ref({ available: true }),
    load: async () => {}, poll: async () => {}, create: async () => {},
  }) }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  const mount = () => {
    let state
    const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
    app.mount({}); t.after(() => app.unmount()); return state
  }
  const state = mount()
  await Vue.nextTick()
  assert.equal(state.selectedPose.value.id, 'custom-upload', 'initial catalog loading must not reset a restored custom pose')
  assert.equal(state.shootDisabled.value, false)
  state.customPose.value.posePrompt = 'character 1 folds both arms and smiles.'
  assert.equal(JSON.parse(stored.get('photo-studio-custom-pose')).posePrompt, state.customPose.value.posePrompt)
  assert.deepEqual(state.shotInput().customPose, { posePrompt: state.customPose.value.posePrompt, personCount: 1 })
  state.customPose.value.personCount = 2
  assert.equal(state.duoPose.value, true)
  state.selectPose({ id: 'pose' })
  assert.equal(state.shotInput().customPose, undefined)
  assert.equal(state.customPose.value.personCount, 2, 'switching to a normal pose keeps the uploaded draft')
  state.poseId.value = 'custom-upload'
  state.persistSelection()
  const restored = mount()
  assert.equal(restored.customPose.value.posePrompt, 'character 1 folds both arms and smiles.')
  assert.equal(restored.poseId.value, 'custom-upload')
  restored.customPose.value.posePrompt = '   '
  assert.equal(restored.shootDisabled.value, true)
});

test('pose scrolling appends batches without losing selection, resets on filtering and stops when closed', async t => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem() {} } })
  t.after(() => { if (oldStorage) Object.defineProperty(globalThis, 'sessionStorage', oldStorage); else delete globalThis.sessionStorage })
  const poses = Array.from({ length: 530 }, (_, index) => ({ id: `pose_${index}`, name: `姿势${index}`, category: '站姿', system: '单人', angle: '正面', group: '', posePrompt: 'standing' }))
  const deps = { ...dimensions, STUDIO_OUTFIT_LABELS, usePhotoStudio: () => ({
    catalog: Vue.ref(poses), characters: Vue.ref([]), jobs: Vue.ref([]), capability: Vue.ref({ available: true }),
    load: async () => {}, poll: async () => {}, create: async () => {},
  }) }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
  app.mount({}); t.after(() => app.unmount())
  await Vue.nextTick()
  state.poseId.value = 'pose_10'
  state.poseOpen.value = true
  const root = { clientHeight: 400, scrollTop: 0, scrollHeight: 2000 }
  state.poseScrollRoot.value = root
  await Vue.nextTick()
  assert.equal(state.visiblePoses.value.length, 240)
  root.scrollTop = 1450
  state.checkPoseScroll()
  state.checkPoseScroll()
  root.scrollHeight = 4000
  await Vue.nextTick()
  assert.equal(state.visiblePoses.value.length, 480)
  assert.equal(root.scrollTop, 1450)
  assert.equal(state.poseId.value, 'pose_10')
  root.scrollTop = 3600
  state.checkPoseScroll()
  await Vue.nextTick()
  assert.equal(state.visiblePoses.value.length, 530)
  assert.equal(state.visiblePoseCount.value, 530)
  state.query.value = '姿势1'
  await Vue.nextTick()
  assert.equal(state.visiblePoseCount.value, 240)
  assert.equal(root.scrollTop, 0)
  assert.equal(state.poseId.value, 'pose_10')
  state.query.value = ''
  state.poseOpen.value = false
  await Vue.nextTick()
  root.scrollTop = 3600
  state.checkPoseScroll()
  await Vue.nextTick()
  assert.equal(state.visiblePoseCount.value, 240)
})

test('switching pose systems keeps system choices available and clears dependent filters', async t => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem() {} } })
  t.after(() => { if (oldStorage) Object.defineProperty(globalThis, 'sessionStorage', oldStorage); else delete globalThis.sessionStorage })
  const poses = [
    { id: 'standing', name: '站立', system: '全身', category: '站姿', angle: '正面', posePrompt: 'standing' },
    { id: 'portrait', name: '半身', system: '半身', category: '可爱系', angle: '侧面', posePrompt: 'portrait' },
  ]
  const deps = { ...dimensions, STUDIO_OUTFIT_LABELS, usePhotoStudio: () => ({
    catalog: Vue.ref(poses), characters: Vue.ref([]), jobs: Vue.ref([]), capability: Vue.ref({ available: true }),
    load: async () => {}, poll: async () => {}, create: async () => {},
  }) }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
  app.mount({}); t.after(() => app.unmount())
  await Vue.nextTick()
  assert.equal(state.systemFilter.value, '')
  state.systemFilter.value = '全身'
  await Vue.nextTick()
  assert.deepEqual(state.systemOptions.value.map(option => option.value).sort(), ['', '全身', '半身'])
  assert.deepEqual(state.categoryOptions.value.map(option => option.value), ['', '站姿'])
  state.categoryFilter.value = '站姿'; state.angleFilter.value = '正面'
  state.systemFilter.value = '半身'
  await Vue.nextTick()
  assert.equal(state.categoryFilter.value, '')
  assert.equal(state.angleFilter.value, '')
  assert.deepEqual(state.categoryOptions.value.map(option => option.value), ['', '可爱系'])
  assert.deepEqual(state.filteredPoses.value.map(pose => pose.id), ['portrait'])
  state.categoryFilter.value = '可爱系'
  state.systemFilter.value = ''
  await Vue.nextTick()
  assert.equal(state.categoryFilter.value, '')
  assert.equal(state.filteredPoses.value.length, 2)
})

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
  state.applyClothing({ slot: 'first', outfit: { tags: ['striped_shirt'], brief: '白色', customPrompt: 'white' } })
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


test('extra polish requirements persist and shutter collapses the editor without discarding the submitted draft', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const stored = new Map([['photo-studio-selection', JSON.stringify({ polishInstruction: '柔和光线' })]])
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else delete globalThis.sessionStorage })
  let finish, submitted
  const deps = { ...dimensions, STUDIO_OUTFIT_LABELS, prepareCameraShutterSound() {}, playCameraShutterSound() {}, usePhotoStudio: () => ({
    catalog: Vue.ref([{ id: 'pose', posePrompt: 'standing', system: '单人' }]), characters: Vue.ref([{ id: 1, name: 'Alice' }]), jobs: Vue.ref([]), capability: Vue.ref({ available: true }),
    load: async () => {}, poll: async () => {}, create: input => { submitted = input; return new Promise(resolve => { finish = resolve }) },
  }) }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
  app.mount({}); t.after(() => app.unmount())
  assert.equal(state.polishInstruction.value, '柔和光线')
  assert.equal(state.polishSettingsOpen.value, false)
  state.characterId.value = 1; state.poseId.value = 'pose'; state.polishPrompt.value = true
  state.polishInstruction.value = '保持服装 tag'; state.polishSettingsOpen.value = true
  await Vue.nextTick()
  assert.equal(JSON.parse(stored.get('photo-studio-selection')).polishInstruction, '保持服装 tag')
  const shooting = state.shoot()
  assert.equal(state.polishSettingsOpen.value, false)
  assert.equal(submitted.polishInstruction, '保持服装 tag')
  assert.equal(state.polishInstruction.value, '保持服装 tag')
  finish({ id: submitted.id }); await shooting
  state.polishSettingsOpen.value = true
  assert.equal(state.polishInstruction.value, '保持服装 tag')
})

test('the first shutter after enabling polish submits a new job and asynchronous failures remain visible', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem() {} } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else delete globalThis.sessionStorage })
  const jobs = Vue.ref([]), submissions = []
  const deps = { ...dimensions, STUDIO_OUTFIT_LABELS, prepareCameraShutterSound() {}, playCameraShutterSound() {}, usePhotoStudio: () => ({
    catalog: Vue.ref([{ id: 'pose', posePrompt: 'standing', system: '单人' }]), characters: Vue.ref([{ id: 1, name: 'Alice' }]), jobs, capability: Vue.ref({ available: true }),
    load: async () => {}, poll: async () => {}, create: async input => { submissions.push(input); return { id: input.id } },
  }) }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
  app.mount({}); t.after(() => app.unmount())
  state.characterId.value = 1; state.poseId.value = 'pose'; state.polishPrompt.value = false
  await state.shoot()
  state.polishPrompt.value = true
  await state.shoot()
  assert.equal(submissions.length, 2)
  assert.equal(submissions[0].polishPrompt, false)
  assert.equal(submissions[1].polishPrompt, true)
  assert.notEqual(submissions[0].id, submissions[1].id)
  jobs.value = [{ id: submissions[1].id, status: 'failed', error: 'AI 润色校验失败' }]
  await Vue.nextTick()
  assert.equal(state.lastFailure.value, 'AI 润色校验失败')
  await state.shoot()
  assert.equal(state.lastFailure.value, '')
  assert.equal(submissions.length, 3)
})

test('shooting slots migrate saved outfits and keep clothes and drafts across actor changes and remounts', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const stored = new Map()
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else delete globalThis.sessionStorage })
  const actors = [{ id: 1, name: 'Alice', outfitScenes: ['work', 'casual'] }, { id: 2, name: 'Bella', outfitScenes: ['work', 'home'] }]
  const deps = { ...dimensions, STUDIO_OUTFIT_LABELS, usePhotoStudio: () => ({
    catalog: Vue.ref([{ id: 'pair', posePrompt: 'standing', system: '双人' }]), characters: Vue.ref(actors), jobs: Vue.ref([]), capability: Vue.ref({ available: true }),
    load: async () => {}, poll: async () => {}, create: async () => {},
  }) }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  const mount = () => {
    let state
    const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
    app.mount({})
    let mounted = true
    const unmount = () => { if (mounted) { app.unmount(); mounted = false } }
    t.after(unmount); return { state, unmount }
  }
  stored.set('photo-studio-selection', JSON.stringify({
    characterId: 1, secondCharacterId: 2, poseId: 'pair',
    characterOutfits: { 1: 'casual', 2: 'home', 3: 'sleep' },
    customOutfits: { 1: { tags: ['shirt'], brief: '', customPrompt: '' }, 2: { tags: ['skirt'], brief: '', customPrompt: '' } },
    clothingDrafts: { 1: { tags: [], brief: '旧草稿', customPrompt: '' } },
  }))
  const first = mount()
  await Vue.nextTick()
  assert.deepEqual(first.state.slotOutfits.value, { first: 'casual', second: 'home' })
  assert.deepEqual(first.state.customOutfits.value.first.tags, ['shirt'])
  assert.deepEqual(first.state.customOutfits.value.second.tags, ['skirt'])
  assert.equal(first.state.clothingDrafts.value.first.brief, '旧草稿')
  first.state.persistSelection()
  assert.equal(JSON.parse(stored.get('photo-studio-selection')).clothingBinding, 'slot')
  first.state.characterId.value = 1; first.state.secondCharacterId.value = 2; first.state.poseId.value = 'pair'
  first.state.slotOutfits.value = { first: 'casual', second: 'home' }
  const main = { tags: ['striped_shirt'], brief: '蓝色外套', customPrompt: 'blue coat' }
  const partner = { tags: ['skirt'], brief: '', customPrompt: '' }
  first.state.applyClothing({ slot: 'first', outfit: main })
  first.state.applyClothing({ slot: 'second', outfit: partner })
  assert.deepEqual(JSON.parse(stored.get('photo-studio-selection')).customOutfits, { first: main, second: partner })
  first.state.saveClothingDraft({ slot: 'first', outfit: { tags: [], brief: '还没翻译', customPrompt: '' } })
  first.state.saveClothingDraft({ slot: 'second', outfit: { tags: [], brief: '', customPrompt: '' } })
  first.state.selectOutfit(actors[0], 'casual')
  first.state.characterSlot.value = 'second'
  first.state.selectOutfit(actors[1], 'work')
  first.state.selectOutfit(actors[1], 'home')
  assert.deepEqual(first.state.customOutfits.value, { first: main, second: partner })
  first.unmount()
  const second = mount()
  await Vue.nextTick()
  assert.deepEqual(second.state.customOutfits.value, { first: main, second: partner })
  assert.deepEqual(second.state.clothingDrafts.value, {
    first: { tags: [], brief: '还没翻译', customPrompt: '' },
    second: { tags: [], brief: '', customPrompt: '' },
  })
  second.state.characterId.value = 1; second.state.secondCharacterId.value = 2
  assert.equal(second.state.shotInput().outfitScene, 'casual')
  assert.equal(second.state.shotInput().secondOutfitScene, 'home')
  assert.equal(second.state.shotInput().customClothingPrompt, 'blue coat')
  assert.deepEqual(second.state.shotInput().secondClothingTags, ['skirt'])
  // Promote the partner, then choose the former protagonist as partner: clothes stay put.
  second.state.characterSlot.value = 'first'
  second.state.selectOutfitCharacter(actors[1])
  assert.equal(second.state.secondCharacterId.value, '')
  assert.equal(second.state.shotInput().customClothingPrompt, 'blue coat')
  assert.deepEqual(second.state.shotInput().secondClothingTags, ['skirt'], 'random partner keeps the partner outfit')
  assert.equal(second.state.shotInput().outfitScene, 'work', 'missing wardrobe scene temporarily falls back')
  assert.equal(second.state.slotOutfits.value.first, 'casual', 'fallback preserves the slot preference')
  second.state.characterSlot.value = 'second'
  second.state.selectOutfitCharacter(actors[0])
  assert.deepEqual(second.state.shotInput().clothingTags, ['striped_shirt'])
  assert.deepEqual(second.state.shotInput().secondClothingTags, ['skirt'])
  assert.equal(second.state.clothingDrafts.value.first.brief, '还没翻译')
  second.state.characterSlot.value = 'first'
  second.state.selectOutfitCharacter(actors[0])
  assert.equal(second.state.shotInput().outfitScene, 'casual')
  second.state.applyClothing({ slot: 'first', outfit: null })
  assert.deepEqual(JSON.parse(stored.get('photo-studio-selection')).customOutfits, { second: partner })
  assert.equal(Object.hasOwn(JSON.parse(stored.get('photo-studio-selection')).clothingDrafts, 'first'), false)
  assert.equal(second.state.characterOutfit({ id: 1, outfitScenes: ['work'] }), 'work')
})

test('polish-to-render SSE updates and late HTTP responses produce one completion effect per shot', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem() {} } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else delete globalThis.sessionStorage })
  const handlers = new Map()
  let submitted, finishPost, sounds = 0, posts = 0
  const deps = { ...dimensions, STUDIO_OUTFIT_LABELS, prepareCameraShutterSound() {}, playCameraShutterSound() { sounds++ }, usePhotoStudio: () => createStudio({
    subscribe: (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name) },
    apiClient: {
      getPhotoStudioCatalog: async () => ({ poses: [{ id: 'pose', posePrompt: 'standing', system: '单人' }] }),
      getPhotoStudioCharacters: async () => ({ characters: [{ id: 1, name: 'Alice' }] }),
      getPhotoStudioCapability: async () => ({ available: true }), getPhotoStudioJobs: async () => ({ jobs: [] }),
      createPhotoStudioJob: input => { submitted = input; posts++; return new Promise(resolve => { finishPost = resolve }) },
    },
  }) }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
  app.mount({}); t.after(() => app.unmount())
  await state.load(); await Vue.nextTick()
  state.characterId.value = 1; state.poseId.value = 'pose'; state.polishPrompt.value = true
  const shot = state.shoot()
  for (const stage of ['polishing', 'polishing_retry', 'queued', 'generating', 'saving']) {
    handlers.get('photo_studio_progress')({ job: { id: submitted.id, status: 'running', stage } })
    await Vue.nextTick()
    assert.equal(state.activeJob.value.stage, stage)
    assert.equal(sounds, 0)
  }
  const done = { id: submitted.id, status: 'done', stage: 'done', output_url: '/images/photo_studio/result.png' }
  handlers.get('photo_studio_ready')({ job: done }); await Vue.nextTick()
  assert.equal(sounds, 1)
  finishPost({ job: { ...done, status: 'running', stage: 'polishing' } }); await shot; await Vue.nextTick()
  handlers.get('photo_studio_ready')({ job: done }); await Vue.nextTick()
  handlers.get('photo_studio_progress')({ job: { ...done, status: 'running', stage: 'generating' } }); await Vue.nextTick()
  handlers.get('photo_studio_ready')({ job: done }); await Vue.nextTick()
  assert.equal(sounds, 1)
  assert.equal(posts, 1)
  assert.equal(state.currentPhoto.value.id, submitted.id)
})
