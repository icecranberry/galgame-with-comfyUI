import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/ResidentCharacterDetailModal.vue', import.meta.url), 'utf8')
const script = compileScript(parse(source).descriptor, { id: 'angel-shared-detail-test' })
const bindings = Object.entries(script.imports).filter(([, entry]) => entry.source !== 'vue').map(([name]) => name)
const code = script.content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '')
  .replace('export default', 'return')

function fixture(t, save = async body => body, apiResults = {}) {
  const calls = [], events = [], notices = []
  const residentApi = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, args]); return Promise.resolve(apiResults[name] || {}) } })
  const deps = Object.fromEntries(bindings.map(name => [name, {}]))
  Object.assign(deps, {
    api: residentApi, ttsApi: residentApi.tts,
    useChatStore: () => ({ characters: [] }),
    useImageEditTasksStore: () => Vue.reactive({ tasks: [], refresh: async () => { calls.push(['refreshImageTasks']) } }),
    overwriteBustTick: Vue.ref(0), bustUrlIfOverwritten: url => url,
  })
  let allowed = false, state
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name]))
  const props = Vue.reactive({ visible: true,
    character: { id: 'god:angel', display_name: '天使', base_prompt: '云庭信使\n\n## 你的外观\n白色羽翼\n## 其他说明\n保留尾部' },
    profileAdapter: { save, standing: { displayUrl: '/images/standing/angel.png' } },
  })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: () => null, addEventListener() {}, removeEventListener() {} } })
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { expose() {}, emit: (...args) => events.push(args) })
    return () => null
  } })
  app.provide('isMobile', Vue.ref(false))
  app.provide('confirm', async () => allowed)
  app.provide('toast', (...args) => notices.push(args))
  app.mount({})
  t.after(() => {
    app.unmount()
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
  })
  return { state, props, calls, events, notices, allowDiscard: () => { allowed = true } }
}

test('resident scene images open on the second click without a legacy standing URL and keep controls expanded', t => {
  const { state, props } = fixture(t)
  assert.equal(props.character.standing_url, undefined)
  state.standingScenes.value = [
    { scene: 'work', image_url: '/images/standing/default.png' },
    { scene: 'casual', image_url: '/images/standing/casual.png' },
  ]
  state.onStandingStageClick()
  assert.equal(state.standingFuncOpen.value, true)
  assert.equal(state.standingLightboxVisible.value, false)
  state.onStandingStageClick()
  assert.equal(state.standingLightboxVisible.value, true)
  assert.equal(state.standingDisplayUrl.value, '/images/standing/default.png')
  assert.equal(state.standingFuncOpen.value, true)
  state.standingLightboxVisible.value = false
  state.standingSceneIdx.value = 1
  state.onStandingStageClick()
  assert.equal(state.standingLightboxVisible.value, true)
  assert.equal(state.standingDisplayUrl.value, '/images/standing/casual.png')
  assert.equal(state.standingFuncOpen.value, true)
})

test('clicking an empty standing slot keeps controls expanded without opening an empty lightbox', t => {
  const { state, props } = fixture(t)
  props.character.standing_url = '/images/standing/legacy.png'
  state.standingScenes.value = [{ scene: 'sleep', image_url: '' }]
  state.onStandingStageClick()
  state.onStandingStageClick()
  assert.equal(state.standingFuncOpen.value, true)
  assert.equal(state.standingLightboxVisible.value, false)
  state.toggleStandingFunc()
  assert.equal(state.standingFuncOpen.value, false)
})

test('regenerated scene remains unchanged until confirmation and applies only to its own outfit', async t => {
  const h = fixture(t, undefined, { generateSceneStanding: { task_id: 'pending-image' } })
  h.props.character.standing_url = '/default.png'
  h.state.standingScenes.value = [
    { scene: 'work', image_url: '/default.png', prompt_text: 'default prompt' },
    { scene: 'casual', image_url: '/casual.png', prompt_text: 'old casual prompt' },
  ]
  h.state.nextStandingScene()
  await Vue.nextTick()
  await h.state.generateSceneStanding()
  assert.equal(h.state.standingDisplayUrl.value, '/casual.png')
  assert.equal(h.state.standingPrompt.value, 'old casual prompt')
  assert.ok(h.calls.some(([name]) => name === 'refreshImageTasks'))
  h.state.standingSceneIdx.value = 0
  h.state.onStandingOverwritten({ detail: { characterId: h.props.character.id, scene: 'casual', url: '/new-casual.png', promptText: 'new casual prompt' } })
  assert.equal(h.props.character.standing_url, '/default.png')
  assert.equal(h.state.standingDisplayUrl.value, '/default.png')
  assert.equal(h.state.standingScenes.value[1].image_url, '/new-casual.png')
  assert.equal(h.state.standingScenes.value[1].prompt_text, 'new casual prompt')
  assert.equal(h.state.standingPrompt.value, 'default prompt')
})

test('shared angel detail initializes and saves through its adapter without resident APIs or VAD fields', async t => {
  const saved = []
  let fail = true
  const h = fixture(t, async payload => { saved.push(payload); if (fail) throw new Error('offline'); return payload })
  assert.equal(h.state.detail.editPersona, '云庭信使')
  assert.equal(h.state.detail.sceneOutfits.length, 4)
  assert.equal(h.state.displayStandingPanel.value.displayUrl, '/images/standing/angel.png')
  h.state.detail.editName = '天使信使'
  h.state.detail.sceneOutfits[0].description = '金色光环与白色羽翼'
  h.state.detail.dirty = true
  await h.state.saveCharDetail()
  assert.equal(h.state.detail.dirty, true)
  assert.equal(h.notices.at(-1)[0], 'offline')
  fail = false
  await h.state.saveCharDetail()
  assert.equal(h.state.detail.dirty, false)
  assert.deepEqual({ display_name: saved[1].display_name, persona: saved[1].persona }, { display_name: '天使信使', persona: '云庭信使\n\n## 你的外观\n金色光环与白色羽翼\n## 其他说明\n保留尾部' })
  assert.deepEqual(saved[1].outfits.map(outfit => outfit.scene), ['work', 'casual', 'home', 'sleep'])
  assert.equal(h.events.at(-1)[0], 'saved')
  assert.deepEqual(h.calls, [])
})

test('background angel media refresh preserves dirty drafts and reopening loads saved data', async t => {
  const h = fixture(t)
  // Establish the watcher boundary used by subsequent media updates.
  h.props.character = { ...h.props.character }
  await Vue.nextTick()
  h.state.detail.editPersona = '未保存的人设'
  h.state.detail.dirty = true
  h.props.character = { ...h.props.character, avatar_path: '/images/avatargen/new.png', base_prompt: '已保存的人设' }
  await Vue.nextTick()
  assert.equal(h.state.detail.editPersona, '未保存的人设')
  await h.state.requestClose()
  assert.deepEqual(h.events, [])
  h.allowDiscard()
  await h.state.requestClose()
  assert.equal(h.events.at(-1)[0], 'close')
  h.props.visible = false
  await Vue.nextTick()
  h.props.visible = true
  await Vue.nextTick()
  assert.equal(h.state.detail.editPersona, '已保存的人设')
  assert.deepEqual(h.calls, [])
})

test('pending angel save blocks duplicate submission and closing', async t => {
  let release, saves = 0
  const h = fixture(t, payload => { saves++; return new Promise(resolve => { release = () => resolve(payload) }) })
  h.state.detail.dirty = true
  const pending = h.state.saveCharDetail()
  await h.state.saveCharDetail()
  await h.state.requestClose()
  assert.equal(saves, 1)
  assert.deepEqual(h.events, [])
  release()
  await pending
  assert.equal(h.state.profileSaving.value, false)
})


test('angel uses all four outfit editors, its own batch generator and clothing-library draft application', async t => {
  const h = fixture(t)
  const batches = []
  h.props.profileAdapter.generateOutfits = async (...args) => { batches.push(args); return { id: 'outfit-job' } }
  await h.state.generateOtherSceneOutfits()
  assert.deepEqual(batches, [['白色羽翼', ['casual', 'home', 'sleep']]])
  h.state.detail.sceneTab = 3
  h.state.openClothingLibrary()
  assert.equal(h.state.showClothingLibrary.value, true)
  h.state.applyClothingLibrary({ characterId: 'god:angel', scene: 'sleep', appearance: 'Angel wearing a soft blue nightdress, barefoot.' })
  assert.equal(h.state.detail.sceneOutfits[3].description, 'Angel wearing a soft blue nightdress, barefoot.')
  assert.equal(h.state.detail.dirty, true)
  h.props.profileAdapter.batchRunning = true
  await h.state.saveCharDetail()
  assert.deepEqual(h.events, [])
  assert.deepEqual(h.calls, [])
})

test('completed batch fills untouched outfit slots while preserving a separately edited outfit draft', async t => {
  const h = fixture(t)
  h.state.detail.sceneOutfits[3].description = '用户尚未保存的睡衣'
  h.state.detail.dirty = true
  h.props.character = { ...h.props.character, outfits: [
    { scene: 'casual', description: '新生成的私服', name: '私服' },
    { scene: 'sleep', description: '模型生成的睡衣', name: '睡衣' },
  ] }
  await Vue.nextTick()
  assert.equal(h.state.detail.sceneOutfits[1].description, '新生成的私服')
  assert.equal(h.state.detail.sceneOutfits[3].description, '用户尚未保存的睡衣')
  assert.equal(h.state.detail.dirty, true)
})

test('media and wardrobe refreshes preserve the currently open outfit editor and selected scene', async t => {
  const h = fixture(t)
  h.state.editorSection.value = 'outfits'
  h.state.detail.sceneTab = 3
  h.props.character = { ...h.props.character, outfits: [{ scene: 'sleep', name: '睡衣', description: 'fresh pajamas' }] }
  await Vue.nextTick()
  assert.equal(h.state.editorSection.value, 'outfits')
  assert.equal(h.state.detail.sceneTab, 3)
  assert.equal(h.state.detail.sceneOutfits[3].description, 'fresh pajamas')
})


test('angel appearance correction targets the selected outfit and retains the draft when automatic save fails', async t => {
  const saved = []; let fail = true
  const h = fixture(t, async payload => { saved.push(payload); if (fail) throw new Error('offline'); return payload })
  h.state.detail.sceneTab = 3
  h.state.detail.sceneOutfits[3].description = 'original pajamas'
  h.state.openRefineModal()
  assert.equal(h.state.showRefineModal.value, true)
  assert.equal(h.state.refineSceneLabel.value, '睡衣')
  assert.match(h.state.refineBasePrompt.value, /original pajamas/)
  h.state.detail.sceneTab = 1
  await h.state.onAppearanceRefined({ basePrompt: '不得替换原人设\n\n## 你的外观\nAngel wearing a blue cotton nightdress, barefoot.' })
  assert.equal(saved[0].outfits[3].description, 'Angel wearing a blue cotton nightdress, barefoot.')
  assert.equal(saved[0].outfits[1].description, '')
  assert.match(saved[0].persona, /^云庭信使[\s\S]*白色羽翼[\s\S]*保留尾部$/)
  assert.equal(h.state.detail.dirty, true)
  assert.ok(h.notices.some(([text]) => text.includes('自动保存未成功')))
  assert.ok(!h.notices.some(([text]) => text.includes('外观已修正并保存')))
  fail = false
  await h.state.saveCharDetail()
  assert.equal(h.state.detail.dirty, false)
  assert.equal(h.events.at(-1)[0], 'saved')
  assert.deepEqual(h.calls, [])
})

test('default angel appearance correction updates the persona while preserving other outfits', async t => {
  let saved
  const h = fixture(t, async payload => { saved = payload; return payload })
  h.state.detail.sceneOutfits[1].description = 'keep casual clothing'
  h.state.openRefineModal()
  await h.state.onAppearanceRefined({ basePrompt: 'ignored identity\n## 你的外观\ngolden eyes and white wings' })
  assert.match(saved.persona, /^云庭信使\n\n## 你的外观\ngolden eyes and white wings\n## 其他说明\n保留尾部$/)
  assert.equal(saved.outfits[1].description, 'keep casual clothing')
  assert.ok(h.notices.some(([text]) => text === '「默认」外观已修正并保存'))
})
