import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import * as dimensions from '../src/utils/photoStudioDimensions.js'
import { createPhotoStudioBurst } from '../src/composables/photoStudioBurst.js'
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
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name] || (name === 'createPhotoStudioBurst' ? (studio, options) => { const burst = createPhotoStudioBurst(studio, options); t.after(() => burst.dispose()); return burst } : {})))
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
    state, unmount: () => app.unmount(), get sounds() { return sounds },
    send: async (event, job) => { handlers.get(event)({ job }); await Vue.nextTick() },
    snapshot: jobs => { snapshot = jobs },
  }
}

test('studio mixes simulated and real progress with the same timing and cap as schedule peek', async t => {
  storage(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(Math, 'random', () => 0)
  const studio = await mountStudio(t)
  const running = { id: 'progress-shot', status: 'running', stage: 'queued', progress: 0 }
  await studio.send('photo_studio_progress', running)
  assert.equal(studio.state.studioProgress.value, 0)
  t.mock.timers.tick(400)
  assert.equal(studio.state.studioProgress.value, 1)
  await studio.send('photo_studio_progress', { ...running, stage: 'sampling', progress: 0.8 })
  assert.equal(studio.state.studioProgress.value, 80, 'real sampling takes over immediately')
  t.mock.timers.tick(400)
  assert.equal(studio.state.simulatedPct.value, 1, 'simulation pauses while real progress leads')
  for (const stage of ['polishing', 'queued', 'generating', 'saving']) {
    await studio.send('photo_studio_progress', { ...running, stage })
    assert.equal(studio.state.studioProgress.value, 80, `${stage} must not reset the displayed progress`)
  }
  await studio.send('photo_studio_ready', { ...running, status: 'done', stage: 'done', progress: 1, output_url: '/images/photo_studio/progress.png' })
  assert.equal(studio.state.studioProgress.value, 100)
  assert.equal(studio.state.currentPhoto.value.id, running.id)

  await studio.send('photo_studio_progress', { ...running, id: 'next-shot' })
  assert.equal(studio.state.studioProgress.value, 0, 'a new shot resets both values')
  for (let tick = 0; tick < 110; tick++) t.mock.timers.tick(400)
  assert.equal(studio.state.studioProgress.value, 95, 'simulation never completes a pending photo')
  await studio.send('photo_studio_progress', { ...running, id: 'next-shot', stage: 'sampling', progress: 0.1 })
  assert.equal(studio.state.studioProgress.value, 95, 'slow real progress does not pull the display below simulation')
  await studio.send('photo_studio_ready', { ...running, id: 'next-shot', status: 'failed', stage: 'failed', error: 'offline' })
  t.mock.timers.tick(400)
  assert.equal(studio.state.studioProgress.value, 95, 'failure stops rather than completes progress')
  await studio.send('photo_studio_progress', { ...running, id: 'failed-early' })
  t.mock.timers.tick(400)
  assert.equal(studio.state.studioProgress.value, 1)
  await studio.send('photo_studio_ready', { ...running, id: 'failed-early', status: 'failed', stage: 'failed', error: 'offline' })
  t.mock.timers.tick(400)
  assert.equal(studio.state.studioProgress.value, 1, 'failure also cancels the timer before the cap is reached')
})

test('submitting a shot starts simulation once, adopts its SSE job and cleans up on unmount', async t => {
  storage(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(Math, 'random', () => 0)
  let finishSubmit, payload
  const studio = await mountStudio(t, input => {
    payload = input
    return new Promise(resolve => { finishSubmit = resolve })
  })
  const submitted = studio.state.shoot()
  await Vue.nextTick()
  t.mock.timers.tick(400)
  assert.equal(studio.state.studioProgress.value, 1)
  const running = { id: payload.id, status: 'running', stage: 'polishing', progress: 0 }
  await studio.send('photo_studio_progress', running)
  finishSubmit({ job: running })
  await submitted
  await Vue.nextTick()
  assert.equal(studio.state.studioProgress.value, 1, 'the POST response and SSE adoption must not restart simulation')
  t.mock.timers.tick(400)
  assert.equal(studio.state.studioProgress.value, 2)
  studio.unmount()
  t.mock.timers.tick(400)
  assert.equal(studio.state.studioProgress.value, 2)
})

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
  await observer.state.studio.poll()
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
