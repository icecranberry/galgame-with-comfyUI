import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import * as dimensions from '../src/utils/photoStudioDimensions.js'
import { STUDIO_OUTFIT_LABELS } from '../src/utils/studioWardrobe.js'
import { usePhotoStudio } from '../src/composables/usePhotoStudio.js'

const script = compileScript(parse(readFileSync(new URL('../src/views/PhotoStudioView.vue', import.meta.url), 'utf8')).descriptor, { id: 'studio-shutter-test' })
const bindings = Object.entries(script.imports).filter(([, entry]) => entry.source !== 'vue').map(([name]) => name)
const code = script.content.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')

function storage(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem() {} } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else delete globalThis.sessionStorage })
}

async function mountStudio(t, submit) {
  const handlers = new Map()
  let sounds = 0, snapshot = []
  const deps = {
    ...dimensions, STUDIO_OUTFIT_LABELS,
    prepareCameraShutterSound() {},
    playCameraShutterSound() { sounds++ },
    usePhotoStudio: () => usePhotoStudio({
      subscribe: (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name) },
      apiClient: {
        getPhotoStudioCatalog: async () => ({ poses: [{ id: 'pose', posePrompt: 'standing', system: '单人' }] }),
        getPhotoStudioCharacters: async () => ({ characters: [{ id: 1, name: 'Alice' }] }),
        getPhotoStudioCapability: async () => ({ available: true }),
        getPhotoStudioJobs: async () => ({ jobs: snapshot }),
        getPhotoStudioJob: async id => ({ job: snapshot.find(job => job.id === id) }),
        createPhotoStudioJob: submit,
      },
    }),
  }
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || {}))
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
  app.mount({})
  t.after(() => app.unmount())
  await state.load()
  await Vue.nextTick()
  state.characterId.value = 1
  state.poseId.value = 'pose'
  return {
    state, get sounds() { return sounds },
    send: async (event, job) => { handlers.get(event)({ job }); await Vue.nextTick() },
    snapshot: jobs => { snapshot = jobs },
  }
}

test('only the page that pressed the shutter sounds; another studio receiving delayed SSE or recovery stays silent', async t => {
  storage(t)
  let running
  const main = await mountStudio(t, async input => {
    running = { id: input.id, status: 'running', stage: 'polishing' }
    return { job: running }
  })
  const observer = await mountStudio(t)
  main.state.polishPrompt.value = true
  await main.state.shoot()
  await Vue.nextTick()
  await observer.send('photo_studio_progress', running)
  const done = { ...running, status: 'done', stage: 'done', output_url: '/images/photo_studio/shot.png' }
  await main.send('photo_studio_ready', done)
  assert.equal(main.sounds, 1)
  await observer.send('photo_studio_ready', done)
  assert.equal(observer.sounds, 0, 'a later delivery to another page must not produce a second shutter')
  observer.snapshot([done])
  await observer.state.poll()
  await Vue.nextTick()
  assert.equal(observer.sounds, 0)
  assert.equal(observer.state.currentPhoto.value.id, done.id, 'other pages still receive the photo')
  await main.send('photo_studio_ready', done)
  assert.equal(main.sounds, 1)
})

test('a submitted shot completing before any running update still sounds exactly once', async t => {
  storage(t)
  let done
  const studio = await mountStudio(t, async input => {
    done = { id: input.id, status: 'done', stage: 'done', output_url: '/images/photo_studio/fast.png' }
    return { job: done }
  })
  await studio.state.shoot()
  await Vue.nextTick()
  assert.equal(studio.sounds, 1)
  await studio.send('photo_studio_ready', done)
  assert.equal(studio.sounds, 1)
})
