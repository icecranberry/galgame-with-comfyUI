import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, ref, nextTick } from 'vue'
import { useStandingGravity } from '../src/composables/useStandingGravity.js'

function setup(t, requestPermission, overrides = {}) {
  const listeners = new Map(), timers = new Map(), frames = new Map()
  let id = 0, controls
  const media = { matches: false, addEventListener() {}, removeEventListener() {} }
  const win = {
    isSecureContext: true,
    DeviceOrientationEvent: requestPermission ? { requestPermission } : {},
    matchMedia: query => query.includes('coarse') ? { ...media, matches: true } : media,
    screen: { orientation: { angle: 0, addEventListener() {}, removeEventListener() {} } },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
    setTimeout: fn => { timers.set(++id, fn); return id },
    ...overrides,
  }
  const values = {
    window: win, navigator: { maxTouchPoints: 1 }, localStorage: { getItem() { return 'off' }, setItem() { assert.fail('automatic gravity must not save a toggle preference') } },
    requestAnimationFrame: fn => { frames.set(++id, fn); return id },
    cancelAnimationFrame: key => frames.delete(key), clearTimeout: key => timers.delete(key),
  }
  for (const [key, value] of Object.entries(values)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key])
  }
  const renderer = createRenderer({
    createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {},
  })
  const suspended = ref(false), touching = ref(false)
  const app = renderer.createApp({ setup() {
    controls = useStandingGravity({ excluded: false, suspended, touching })
    return () => null
  } })
  app.mount({})
  function tick(time) {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach(fn => fn(time))
  }
  return { app, controls, suspended, touching, listeners, timers, frames, tick }
}

test('suspension removes listeners; resume recalibrates; unmount clears all work', async t => {
  const h = setup(t)
  h.listeners.get('deviceorientation')({ beta: 60, gamma: 0 })
  assert.equal(h.controls.active.value, true)
  h.suspended.value = true
  await nextTick()
  assert.equal(h.listeners.has('deviceorientation'), false)
  assert.deepEqual(h.controls.style.value, { transform: 'translate3d(0px, 0px, 0)' })
  h.suspended.value = false
  await nextTick()
  h.listeners.get('deviceorientation')({ beta: 20, gamma: 30 })
  for (const fn of h.frames.values()) fn(16)
  assert.equal(h.controls.style.value.transform, 'translate3d(0px, 0px, 0)')
  h.app.unmount()
  assert.equal(h.listeners.size, 0)
  assert.equal(h.timers.size, 0)
})

test('permission is requested only by explicit action, denial never starts sensors', async t => {
  let requests = 0
  const h = setup(t, async () => { requests++; return 'denied' })
  assert.equal(requests, 0)
  assert.equal(h.listeners.has('deviceorientation'), false)
  await h.controls.authorize()
  await nextTick()
  assert.equal(requests, 1)
  assert.equal(h.controls.permission.value, 'denied')
  assert.equal(h.listeners.has('deviceorientation'), false)
  h.app.unmount()
})

test('late permission response cannot restart an unmounted page', async t => {
  let resolve
  const h = setup(t, () => new Promise(done => { resolve = done }))
  const pending = h.controls.authorize()
  h.app.unmount()
  resolve('granted')
  await pending
  assert.equal(h.listeners.size, 0)
})

test('missing sensor readings time out and clean up the listener', t => {
  const h = setup(t)
  h.listeners.get('deviceorientation')({ beta: null, gamma: null })
  const timeout = [...h.timers.values()][0]
  timeout()
  assert.equal(h.controls.status.value, 'unavailable')
  assert.equal(h.listeners.has('deviceorientation'), false)
  h.app.unmount()
})

function nativeBridge() {
  const starts = [], stops = []
  return { starts, stops, bridge: {
    hasStandingGravity: () => true,
    startStandingGravity: session => starts.push(session),
    stopStandingGravity: session => stops.push(session),
  } }
}

test('APK automatically starts on HTTP despite a legacy off preference and stops when suspended', async t => {
  const n = nativeBridge()
  const h = setup(t, () => assert.fail('native path must not request browser permission'), {
    isSecureContext: false, AndroidBridge: n.bridge,
  })
  assert.equal(h.controls.available.value, true)
  assert.equal(n.starts.length, 1)
  assert.equal(h.listeners.has('deviceorientation'), false)
  h.listeners.get('linshe-gravity')({ detail: { session: n.starts[0], beta: 60, gamma: 0, angle: 0 } })
  assert.equal(h.controls.active.value, true)
  h.suspended.value = true
  await nextTick()
  assert.deepEqual(n.stops, n.starts)
  assert.equal(h.listeners.has('linshe-gravity'), false)
  h.app.unmount()
  assert.equal(h.listeners.size, 0)
})

test('native Activity pause/resume stops and recalibrates, ignoring previous-session events', async t => {
  const n = nativeBridge()
  const h = setup(t, undefined, { isSecureContext: false, AndroidBridge: n.bridge })
  const old = n.starts[0]
  h.listeners.get('linshe-gravity-lifecycle')({ detail: { active: false } })
  await nextTick()
  assert.equal(h.listeners.has('linshe-gravity'), false)
  assert.equal(n.stops[0], old)
  h.listeners.get('linshe-gravity-lifecycle')({ detail: { active: true } })
  await nextTick()
  const receive = h.listeners.get('linshe-gravity')
  receive({ detail: { session: old, beta: 40, gamma: 20 } })
  assert.equal(h.controls.active.value, false)
  receive({ detail: { session: n.starts.at(-1), beta: 40, gamma: 20 } })
  assert.equal(h.controls.active.value, true)
  h.app.unmount()
  assert.equal(h.listeners.size, 0)
})

test('native sensor failure falls back to a static portrait and cleans up', t => {
  const n = nativeBridge()
  const h = setup(t, undefined, { isSecureContext: false, AndroidBridge: n.bridge })
  h.listeners.get('linshe-gravity')({ detail: { session: n.starts[0], error: 'unavailable' } })
  assert.equal(h.controls.status.value, 'unavailable')
  assert.equal(h.controls.active.value, false)
  assert.deepEqual(n.stops, n.starts)
  h.app.unmount()
})

test('old APK and ordinary HTTP browser do not attempt unsupported sensor access', t => {
  const h = setup(t, undefined, { isSecureContext: false, AndroidBridge: { saveImage() {} } })
  assert.equal(h.controls.available.value, false)
  assert.equal(h.listeners.has('deviceorientation'), false)
  assert.equal(h.listeners.has('linshe-gravity'), false)
  h.app.unmount()
})

test('native motion freezes while touching and resumes smoothly after release', async t => {
  const n = nativeBridge()
  const h = setup(t, undefined, { isSecureContext: false, AndroidBridge: n.bridge })
  const emit = gamma => h.listeners.get('linshe-gravity')({ detail: {
    session: n.starts[0], beta: 60, gamma, angle: 0,
  } })
  emit(0)
  h.tick(16)
  h.touching.value = true
  await nextTick()
  emit(15)
  h.tick(32)
  assert.equal(h.controls.style.value.transform, 'translate3d(0px, 0px, 0)')
  h.touching.value = false
  await nextTick()
  h.tick(48)
  assert.notEqual(h.controls.style.value.transform, 'translate3d(0px, 0px, 0)')
  assert.notEqual(h.controls.style.value.transform, 'translate3d(-12px, 0px, 0)')
  h.app.unmount()
  assert.equal(h.frames.size, 0)
})

test('native display rotation recalibrates even when WebView has no orientation event', t => {
  const n = nativeBridge()
  const h = setup(t, undefined, { isSecureContext: false, AndroidBridge: n.bridge })
  const emit = (beta, gamma, angle) => h.listeners.get('linshe-gravity')({ detail: {
    session: n.starts[0], beta, gamma, angle,
  } })
  emit(60, 0, 0)
  h.tick(16)
  emit(0, 60, 90)
  h.tick(32)
  assert.equal(h.controls.style.value.transform, 'translate3d(0px, 0px, 0)')
  h.app.unmount()
})
