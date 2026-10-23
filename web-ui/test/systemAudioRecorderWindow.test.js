import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/SystemAudioRecorder.vue', import.meta.url), 'utf8')
const code = compileScript(parse(source).descriptor, { id: 'recorder-window-test' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')

function fixture(t, requestWindow) {
  const props = Vue.reactive({ modelValue: true }), events = [], timers = []
  let state, cancelled = 0, recordingOptions
  const deps = {
    Vue, window: { isSecureContext: true, MediaRecorder() {}, documentPictureInPicture: { requestWindow } },
    navigator: { mediaDevices: { getDisplayMedia() {} } },
    document: { documentElement: { dataset: { theme: 'dark' } }, querySelectorAll: () => [] },
    URL: { createObjectURL: () => 'blob:recording', revokeObjectURL() {} },
    createSystemAudioRecorder: options => {
      recordingOptions = options
      return { start() {}, stop() {}, cancel() { cancelled++ } }
    },
    stopSpeech() {}, speechPlayer: {}, LinsheButton: {}, SystemAudioRecorderControls: {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length }, clearTimeout() {},
  }
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps))
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { expose() {}, emit: (...args) => events.push(args) })
    return () => null
  } })
  app.mount({}); t.after(() => app.unmount())
  return { state, props, events, timers, result: value => recordingOptions.onResult(value), cancelled: () => cancelled }
}
function pipWindow() {
  const listeners = {}, win = {
    document: { documentElement: { dataset: {} }, head: { appendChild() {} }, body: { style: {} } },
    closed: false, close() { this.closed = true }, focus() {},
    addEventListener: (event, fn) => { listeners[event] = fn },
  }
  return { win, listeners }
}

test('opens the pinned window directly and finishes the exit animation before closing it', async t => {
  const { win } = pipWindow()
  let requested = false
  const f = fixture(t, () => { requested = true; return Promise.resolve(win) })
  const opening = f.state.open()
  assert.equal(requested, true, 'requestWindow runs in the click call stack')
  await opening
  assert.equal(f.state.pipBody.value, win.document.body)
  f.result(new Blob(['audio']))
  f.state.useRecording()
  assert.equal(f.events[0][0], 'recorded')
  assert.ok(f.cancelled() > 0, 'capture stops before the fade')
  assert.equal(win.closed, false)
  assert.equal(f.timers[0].ms, 300)
  f.timers[0].fn()
  assert.equal(win.closed, true)
  assert.deepEqual(f.events.at(-1), ['update:modelValue', false])
})

test('closing the native pinned window cancels capture and returns to voice settings', async t => {
  const { win, listeners } = pipWindow()
  const f = fixture(t, async () => win)
  await f.state.open()
  f.result(new Blob(['audio']))
  listeners.pagehide()
  assert.equal(f.state.pipBody.value, null)
  assert.equal(f.state.audioUrl.value, '')
  assert.ok(f.cancelled() > 0)
  assert.deepEqual(f.events, [['update:modelValue', false]])
})

test('an unavailable pinned window reports failure without opening an in-page recorder', async t => {
  const f = fixture(t, async () => { throw new Error('blocked') })
  await f.state.open()
  assert.equal(f.state.pipBody.value, null)
  assert.equal(f.events[0][0], 'error')
  assert.match(f.events[0][1], /上传音频文件/)
  assert.deepEqual(f.events.at(-1), ['update:modelValue', false])
})

test('a late pinned window is closed when the voice settings were already dismissed', async t => {
  let resolve
  const { win } = pipWindow()
  const f = fixture(t, () => new Promise(done => { resolve = done }))
  const opening = f.state.open()
  f.props.modelValue = false
  await Vue.nextTick()
  resolve(win); await opening
  assert.equal(win.closed, true)
  assert.equal(f.state.pipBody.value, null)
})
