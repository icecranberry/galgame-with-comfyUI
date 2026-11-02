import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, shallowRef } from 'vue'
import { useGodScrollFollow } from '../src/composables/useGodScrollFollow.js'

function fixture(t, { reduced = false, integerScroll = false } = {}) {
  const globals = ['window', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver']
  const saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key))
  const frames = new Map()
  const listeners = new Map()
  const motionListeners = new Map()
  let id = 0, time = 0, top = 600, resize, disconnected = false
  const motion = { matches: reduced, addEventListener: (key, fn) => motionListeners.set(key, fn), removeEventListener: key => motionListeners.delete(key) }
  Object.assign(globalThis, {
    window: { matchMedia: () => motion },
    requestAnimationFrame: fn => { frames.set(++id, fn); return id },
    cancelAnimationFrame: key => frames.delete(key),
    ResizeObserver: class {
      constructor(fn) { resize = fn }
      observe() {}
      disconnect() { disconnected = true }
    },
  })
  const el = {
    scrollHeight: 1000, clientHeight: 400,
    get scrollTop() { return top },
    set scrollTop(value) { top = Math.max(0, Math.min(integerScroll ? Math.floor(value) : value, this.scrollHeight - this.clientHeight)) },
    addEventListener: (key, fn) => listeners.set(key, fn),
    removeEventListener: key => listeners.delete(key),
    getBoundingClientRect: () => ({ right: 800 }),
  }
  const scope = effectScope()
  const controller = scope.run(() => useGodScrollFollow(shallowRef(el), shallowRef({})))
  const event = (name, detail = {}) => listeners.get(name)?.({ target: { closest: () => null }, ...detail })
  function step() {
    time += 16
    const batch = [...frames.values()]
    frames.clear()
    batch.forEach(fn => fn(time))
    event('scroll')
  }
  function settle() {
    for (let i = 0; i < 100 && frames.size; i++) step()
    assert.equal(frames.size, 0, 'animation must settle without a permanent RAF loop')
  }
  t.after(() => {
    scope.stop()
    globals.forEach((key, i) => { if (saved[i]) Object.defineProperty(globalThis, key, saved[i]); else delete globalThis[key] })
  })
  settle()
  return { ...controller, el, event, step, settle, resize: () => resize(), frames, motion, scope,
    cleaned: () => disconnected && !listeners.size && !motionListeners.size }
}

test('stream growth follows continuously, including large chunks and rounded browser scroll positions', t => {
  const f = fixture(t, { integerScroll: true })
  f.el.scrollHeight += 600
  f.resize()
  f.step()
  assert.ok(f.el.scrollTop > 600 && f.el.scrollTop < 1200)
  assert.equal(f.atBottom.value, true)
  f.el.scrollHeight += 250
  f.resize()
  assert.equal(f.frames.size, 1, 'new chunks reuse the active animation')
  f.settle()
  assert.equal(f.el.scrollTop, 1450)
  assert.equal(f.atBottom.value, true)
})

test('scrolling up cancels follow even near the bottom; content growth preserves the reading position', t => {
  const f = fixture(t)
  f.event('wheel', { deltaY: -10 })
  f.el.scrollTop -= 10
  f.event('scroll')
  f.el.scrollHeight += 500
  f.resize()
  f.step()
  assert.equal(f.atBottom.value, false)
  assert.equal(f.el.scrollTop, 590)
  f.goBottom()
  f.settle()
  assert.equal(f.el.scrollTop, 1100)
  assert.equal(f.atBottom.value, true)
})

test('touch and keyboard interrupt animation; manually returning to the bottom resumes it', t => {
  const f = fixture(t)
  f.el.scrollHeight += 400
  f.resize()
  f.step()
  f.event('touchstart', { touches: [{ clientY: 100 }] })
  f.event('touchmove', { touches: [{ clientY: 120 }] })
  assert.equal(f.frames.size, 0)
  assert.equal(f.atBottom.value, false)
  f.goBottom()
  f.event('keydown', { key: 'PageUp' })
  assert.equal(f.frames.size, 0)
  assert.equal(f.atBottom.value, false)
  f.el.scrollTop = 1000
  f.event('scroll')
  assert.equal(f.atBottom.value, true)
  f.el.scrollHeight += 100
  f.resize()
  f.settle()
  assert.equal(f.el.scrollTop, 1100)
})

test('reduced motion and initial positioning are immediate, and disposal releases observers and pending frames', t => {
  const f = fixture(t, { reduced: true })
  f.el.scrollHeight += 300
  f.resize()
  f.step()
  assert.equal(f.el.scrollTop, 900)
  assert.equal(f.frames.size, 0)
  f.motion.matches = false
  f.el.scrollHeight += 300
  f.goBottom({ immediate: true })
  assert.equal(f.el.scrollTop, 1200)
  f.el.scrollHeight += 300
  f.resize()
  f.scope.stop()
  assert.equal(f.frames.size, 0)
  assert.equal(f.cleaned(), true)
})
