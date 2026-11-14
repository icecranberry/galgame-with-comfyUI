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
  const flashesAtSound = []
  const phasesAtSound = []
  const deps = {
    ...dimensions, STUDIO_OUTFIT_LABELS,
    prepareCameraShutterSound() {},
    playCameraShutterSound() { sounds++; flashesAtSound.push(state.photoFlash.value); phasesAtSound.push(state.revealPhase.value) },
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
    state, flashesAtSound, phasesAtSound, unmount: () => app.unmount(), get sounds() { return sounds },
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
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let running
  const main = await mountStudio(t, async input => {
    running = { id: input.id, status: 'running', stage: 'polishing' }
    return { job: running }
  })
  const observer = await mountStudio(t)
  main.state.polishPrompt.value = true
  await main.state.shoot()
  await Vue.nextTick()
  assert.equal(main.sounds, 0, 'the task-start curtain is silent')
  await observer.send('photo_studio_progress', running)
  const done = { ...running, status: 'done', stage: 'done', output_url: '/images/photo_studio/shot.png' }
  await main.send('photo_studio_ready', done)
  main.state.revealCurtainEnded({ animationName: 'studio-result-close-scope' })
  await main.state.revealPhoto(done.id)
  main.state.revealCurtainEnded({ animationName: 'studio-result-open-scope' })
  await Vue.nextTick()
  assert.equal(main.sounds, 1)
  await observer.send('photo_studio_ready', done)
  assert.equal(observer.sounds, 0, 'a later delivery to another page must not produce a second shutter')
  assert.equal(observer.state.photoFlash.value, false)
  observer.snapshot([done])
  await observer.state.studio.poll()
  await Vue.nextTick()
  assert.equal(observer.sounds, 0)
  assert.equal(observer.state.currentPhoto.value.id, done.id, 'other pages still receive the photo')
  await main.send('photo_studio_ready', done)
  assert.equal(main.sounds, 1)
})

test('task start only pulses the button and a print gets one curtain reveal with flash and sound on opening', async t => {
  storage(t)
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let running
  const studio = await mountStudio(t, async input => {
    running = { id: input.id, status: 'running', stage: 'polishing' }
    return { job: running }
  })
  await studio.state.shoot()
  await Vue.nextTick()
  assert.equal(studio.state.shutterPulse.value, true)
  assert.equal(studio.state.revealPhase.value, '', 'starting a task must not close the photo curtain')
  t.mock.timers.tick(2000)
  assert.equal(studio.sounds, 0, 'the initial curtain must stay silent for its entire animation')
  assert.equal(studio.state.photoFlash.value, false)
  const done = { ...running, status: 'done', stage: 'done', output_url: '/images/photo_studio/slow-download.png' }
  await studio.send('photo_studio_ready', done)
  assert.equal(studio.state.revealPhase.value, 'closing')
  assert.ok(!studio.state.presentedPhotos.value.some(photo => photo.id === done.id), 'the photo cannot appear before closure')
  await studio.state.revealPhoto(done.id)
  assert.equal(studio.sounds, 0, 'an early image load cannot reveal or flash before closure')
  studio.state.revealCurtainEnded({ animationName: 'studio-result-close-test-scope' })
  assert.equal(studio.state.revealPhase.value, 'closed')
  assert.equal(studio.state.presentedPhotos.value[0].id, done.id)
  t.mock.timers.tick(2000)
  assert.equal(studio.state.revealPhase.value, 'closed', 'slow downloads keep the curtain fully closed')
  assert.equal(studio.sounds, 0)
  assert.equal(studio.state.photoFlash.value, false)
  await studio.state.revealPhoto(done.id)
  assert.equal(studio.state.revealPhase.value, 'opening')
  assert.equal(studio.sounds, 1)
  assert.deepEqual(studio.flashesAtSound, [true])
  assert.deepEqual(studio.phasesAtSound, ['opening'])
  assert.equal(studio.state.photoFlash.value, true)
  t.mock.timers.tick(160)
  assert.equal(studio.state.photoFlash.value, false)
  studio.state.revealCurtainEnded({ animationName: 'studio-result-open-test-scope' })
  await Vue.nextTick()
  await studio.send('photo_studio_ready', done)
  await studio.state.revealPhoto(done.id)
  assert.equal(studio.sounds, 1, 'duplicate completions and image loads cannot replay the reveal')
  assert.equal(studio.state.revealPhase.value, '')
})

test('a submitted shot completing before any running update still sounds exactly once', async t => {
  storage(t)
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let done
  const studio = await mountStudio(t, async input => {
    done = { id: input.id, status: 'done', stage: 'done', output_url: '/images/photo_studio/fast.png' }
    return { job: done }
  })
  await studio.state.shoot()
  await Vue.nextTick()
  assert.equal(studio.sounds, 0, 'even an immediate response must wait for the result reveal')
  studio.state.revealCurtainEnded({ animationName: 'studio-result-close-scope' })
  await studio.state.revealPhoto(done.id)
  studio.state.revealCurtainEnded({ animationName: 'studio-result-open-scope' })
  await Vue.nextTick()
  assert.equal(studio.sounds, 1)
  assert.deepEqual(studio.flashesAtSound, [true])
  await studio.send('photo_studio_ready', done)
  assert.equal(studio.sounds, 1)
})

test('a burst waits for image loading and curtain opening to finish before starting its next silent task', async t => {
  storage(t)
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let submitted = 0, running
  const studio = await mountStudio(t, async input => {
    submitted++
    running = { id: input.id, status: 'running', stage: 'generating' }
    return { job: running }
  })
  studio.state.burstCount.value = 2
  await studio.state.shoot()
  const done = { ...running, status: 'done', stage: 'done', output_url: '/images/photo_studio/burst-first.png' }
  await studio.send('photo_studio_ready', done)
  t.mock.timers.tick(5000)
  await Vue.nextTick()
  assert.equal(submitted, 1)
  studio.state.revealCurtainEnded({ animationName: 'studio-result-close-scope' })
  await studio.state.revealPhoto(done.id)
  t.mock.timers.tick(5000)
  await Vue.nextTick()
  assert.equal(submitted, 1, 'completion alone must not advance past the presentation')
  studio.state.revealCurtainEnded({ animationName: 'studio-result-open-scope' })
  await Promise.resolve()
  await Vue.nextTick()
  await Vue.nextTick()
  t.mock.timers.tick(799)
  await Vue.nextTick()
  assert.equal(submitted, 1)
  t.mock.timers.tick(1)
  await Vue.nextTick()
  assert.equal(submitted, 2)
  assert.equal(studio.sounds, 1, 'the second task-start curtain must not add a sound')
});

test('reduced motion reveals a loaded print once without waiting for hidden curtain animation events', async t => {
  storage(t)
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: () => ({ matches: true }) } })
  t.after(() => { if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window })
  let done
  const studio = await mountStudio(t, async input => {
    done = { id: input.id, status: 'done', stage: 'done', output_url: '/images/photo_studio/reduced.png' }
    return { job: done }
  })
  await studio.state.shoot()
  await Vue.nextTick()
  assert.equal(studio.state.revealPhase.value, 'closed')
  assert.equal(studio.sounds, 0)
  await studio.state.revealPhoto(done.id)
  assert.equal(studio.state.revealPhase.value, '')
  assert.equal(studio.state.photoFlash.value, false)
  assert.equal(studio.sounds, 1)
});
