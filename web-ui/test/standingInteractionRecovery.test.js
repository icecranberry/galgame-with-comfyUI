import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { createStandingInteractionLifetime } from '../src/utils/standingInteractionLifetime.js'
import { standingPresentationChanged, standingSelectionKey } from '../src/utils/standingInteractionRules.js'
import { createTouchReplyEngine } from '../src/utils/standingTouch.js'
import { createStandingTouchSpeech } from '../src/utils/standingTouchSpeech.js'
import { createSpeechPlayback } from '../src/utils/speechPlayback.js'
import { pointerInStanding } from '../src/utils/standingInteractionGeometry.js'
import { TOUCH_LABELS, TOUCH_ZONES, touchPartAt } from '../src/utils/standingTouch.js'

const source = readFileSync(new URL('../src/components/standing/StandingInteractionControls.vue', import.meta.url), 'utf8')
const code = compileScript(parse(source).descriptor, { id: 'standing-recovery-test' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .*from.*$/gm, '')
  .replace('export default', 'return')

function fixture(t, read = async () => ({ isSleeping: false }), createAudio = () => ({ play: async () => {}, pause() {} })) {
  const listeners = new Map(), handlers = new Map(), timers = new Map(), events = [], cleanups = []
  let serial = 0, connected = true, reads = 0, state
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  globalThis.window = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  }
  const speechPlayer = createSpeechPlayback(createAudio)
  const component = new Function('Vue', 'getStandingInteraction', 'onEvent', 'isUnifiedStreamConnected',
    'standingPresentationChanged', 'standingSelectionKey', 'createStandingInteractionLifetime', 'createTouchReplyEngine', 'createStandingTouchSpeech', 'speechPlayer', code)(
    Vue, (...args) => { reads++; return read(...args) },
    (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name) }, () => connected,
    standingPresentationChanged, standingSelectionKey,
    options => createStandingInteractionLifetime({ ...options,
      schedule: (fn, delay) => { timers.set(++serial, { fn, delay }); return serial },
      unschedule: id => timers.delete(id),
    }), createTouchReplyEngine, createStandingTouchSpeech, speechPlayer,
  )
  const props = Vue.reactive({ base: { epoch: 'test', selectionVersion: 1, characterId: 1, imageUrl: '/portrait.png', bounds: {} }, suspended: false })
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { expose() {}, emit: (...args) => events.push(args) })
    return () => null
  } })
  app.mount({})
  let mounted = true
  const unmount = () => { if (mounted) { app.unmount(); mounted = false } }
  t.after(() => {
    cleanups.forEach(fn => fn())
    unmount()
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
  })
  const flush = async () => { await Promise.resolve(); await Vue.nextTick(); await Promise.resolve(); await Vue.nextTick() }
  return { state, props, timers, events, listeners, unmount, flush, speechPlayer, cleanup: fn => cleanups.push(fn), reads: () => reads,
    async event(name, data) {
      if (name === 'connected') connected = true
      if (name === 'disconnected') connected = false
      handlers.get(name)?.(data)
      await flush()
    },
    async tick() {
      const first = [...timers].sort((a, b) => a[1].delay - b[1].delay)[0]
      assert.ok(first, 'failed configuration read must schedule recovery without an SSE reconnect')
      timers.delete(first[0]); first[1].fn(); await flush()
    },
  }
}

test('one failed configuration read recovers while SSE stays connected', async t => {
  let fail = true
  const h = fixture(t, async () => {
    if (fail) throw new Error('temporary 503')
    return { isSleeping: false, touchLines: { lines: { head: ['专属触摸台词'] } } }
  })
  await h.flush()
  assert.equal(h.state.disabled.value, true)
  assert.equal(h.events.filter(([name]) => name === 'state').at(-1)[1].speaking, true, 'status bubble must also hide the chat thought bubble')
  fail = false
  await h.tick()
  assert.equal(h.state.disabled.value, false)
  h.state.act('head', { x: .5, y: .1 })
  assert.equal(h.state.note.value, '专属触摸台词')
  assert.ok(h.events.some(([name, value]) => name === 'reaction' && value?.part === 'head'))
})

test('missing custom lines still produces both fallback speech and motion', async t => {
  const h = fixture(t)
  await h.flush()
  h.state.act('head')
  assert.match(h.state.note.value, /头顶/)
  assert.ok(h.events.some(([name, value]) => name === 'reaction' && value?.motion))
  assert.equal(h.reads(), 1, 'touch must not request a model or reload configuration')
})

test('sleep pauses feedback and a wake event restores it', async t => {
  let sleeping = true
  const h = fixture(t, async () => ({ isSleeping: sleeping }))
  await h.flush()
  h.state.act('head')
  assert.equal(h.state.note.value, '')
  assert.match(h.state.message.value, /休息/)
  sleeping = false
  await h.event('schedule_state_change', { character_id: 1 })
  h.state.act('head')
  assert.match(h.state.note.value, /头顶/)
})

test('returning to the window refreshes sleep state even if a wake event was missed', async t => {
  let sleeping = true
  const h = fixture(t, async () => ({ isSleeping: sleeping }))
  await h.flush()
  sleeping = false
  h.listeners.get('focus')?.()
  await h.flush()
  assert.equal(h.state.disabled.value, false)
})

test('suspension cancels recovery and resume reloads; unmount leaves no timers', async t => {
  const h = fixture(t, async () => { throw new Error('temporary failure') })
  await h.flush()
  assert.ok(h.timers.size)
  h.props.suspended = true
  await h.flush()
  assert.equal(h.timers.size, 0)
  h.props.suspended = false
  await h.flush()
  assert.equal(h.reads(), 2)
  h.unmount()
  assert.equal(h.timers.size, 0)
  assert.equal(h.listeners.size, 0)
})

test('late character reads cannot restore the previous character or disable the new one', async t => {
  let rejectOld
  const h = fixture(t, id => id === 1 ? new Promise((_, reject) => { rejectOld = reject }) : Promise.resolve({ isSleeping: false }))
  h.props.base = { ...h.props.base, characterId: 2, selectionVersion: 2 }
  await h.flush()
  rejectOld(new Error('late failure'))
  await h.flush()
  assert.equal(h.state.disabled.value, false)
  assert.equal(h.timers.size, 0)
})

test('a stalled read times out and retries instead of staying disabled forever', async t => {
  let stalled = true
  const h = fixture(t, (_, { signal }) => stalled ? new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }) : Promise.resolve({ isSleeping: false }))
  assert.equal([...h.timers.values()][0].delay, 10000)
  await h.tick()
  assert.match(h.state.message.value, /重试/)
  stalled = false
  await h.tick()
  assert.equal(h.state.disabled.value, false)
})

test('retries back off, survive feedback clearing, and stop on disconnect', async t => {
  const h = fixture(t, async () => { throw new Error('503') })
  await h.flush()
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    h.listeners.get('blur')()
    assert.equal(h.timers.size, 1)
    assert.equal([...h.timers.values()][0].delay, delay)
    await h.tick()
  }
  await h.event('disconnected')
  assert.equal(h.timers.size, 0)
  assert.match(h.state.message.value, /连接/)
  await h.event('connected')
  assert.equal([...h.timers.values()][0].delay, 1000)
})

test('reconnect waits for fresh sleep state before enabling touch', async t => {
  let resolveRead
  const h = fixture(t, () => new Promise(resolve => { resolveRead = resolve }))
  resolveRead({ isSleeping: false })
  await h.flush()
  assert.equal(h.state.disabled.value, false)
  await h.event('disconnected')
  await h.event('connected')
  assert.equal(h.state.disabled.value, true)
  resolveRead({ isSleeping: true })
  await h.flush()
  assert.equal(h.state.disabled.value, true)
  assert.match(h.state.message.value, /休息/)
})

const spokenTouch = { isSleeping: false, touchLines: { lines: { head: ['摸摸头'] }, speech: {
  enabled: true, configured: true, lines: { head: [{ text: '摸摸头', status: 'completed', audio_url: '/head.wav' }] },
} } }

for (const input of ['mouse', 'touch', 'keyboard']) {
  test(`${input} hit layer preserves the gesture through controls into native audio.play`, async t => {
    let gesture = false, played = 0, layer
    const h = fixture(t, async () => spokenTouch, () => ({ pause() {}, play() {
      assert.equal(gesture, true)
      played++
      return Promise.resolve()
    } }))
    await h.flush()
    const layerSource = readFileSync(new URL('../src/components/standing/StandingInteractionLayer.vue', import.meta.url), 'utf8')
    const layerCode = compileScript(parse(layerSource).descriptor, { id: 'touch-speech-layer' }).content
      .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
      .replace(/^import .*from.*$/gm, '')
      .replace('export default', 'return')
    const component = new Function('Vue', 'pointerInStanding', 'zones', 'labels', 'touchPartAt', layerCode)(
      Vue, pointerInStanding, TOUCH_ZONES, TOUCH_LABELS, touchPartAt,
    )
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    globalThis.document = { addEventListener() {}, removeEventListener() {} }
    const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    const app = renderer.createApp({ setup() {
      layer = component.setup({ bounds: { x: 0, y: 0, width: 100, height: 200, imageWidth: 100, imageHeight: 200 } }, {
        expose() {}, emit(name, ...args) { if (name === 'action') h.state.act(...args) },
      })
      return () => null
    } })
    app.mount({})
    h.cleanup(() => {
      app.unmount()
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
      else delete globalThis.document
    })
    layer.surface.value = {
      getScreenCTM: () => ({ inverse: () => ({}) }),
      createSVGPoint: () => ({ matrixTransform() { return { x: this.x, y: this.y } } }),
      setPointerCapture() {}, hasPointerCapture: () => false,
    }
    if (input === 'keyboard') {
      gesture = true
      layer.keyboard(TOUCH_ZONES[0])
    } else {
      const event = { pointerType: input, pointerId: 1, button: 0, isPrimary: true, clientX: 50, clientY: 10, preventDefault() {} }
      layer.down(event)
      assert.equal(played, 0, 'press does not prematurely start speech')
      gesture = true
      layer.up(event)
    }
    assert.equal(played, 1)
    gesture = false
    assert.equal(h.state.note.value, '摸摸头')
    assert.equal(h.reads(), 1, 'the gesture never needs a network request')
  })
}

test('suspend, clear and character change stop touch speech without stopping another player', async t => {
  const audios = []
  let plays = 0
  const h = fixture(t, async () => spokenTouch, () => {
    const audio = { currentTime: 0, paused: false, async play() { plays++; this.paused = false }, pause() { this.paused = true } }
    audios.push(audio)
    return audio
  })
  await h.flush()
  h.state.act('head')
  h.props.suspended = true
  await h.flush()
  assert.equal(audios[0].paused, true)
  h.props.suspended = false
  h.props.base = { ...h.props.base, characterId: 2, selectionVersion: 2 }
  await h.flush()
  h.state.act('head')
  assert.equal(plays, 2)
  assert.equal(audios[0].paused, false)
  h.props.base = { ...h.props.base, characterId: 3, selectionVersion: 3 }
  await h.flush()
  assert.equal(audios[0].paused, true)
  h.state.act('head')
  const external = { currentTime: 0, paused: false, pause() { this.paused = true } }
  h.speechPlayer.adopt(external)
  h.state.clear()
  h.unmount()
  assert.equal(external.paused, false)
})

test('voice configuration changes invalidate cached audio before refresh resolves', async t => {
  let resolveRead, changed = false
  const audios = []
  const h = fixture(t, () => changed ? new Promise(resolve => { resolveRead = resolve }) : Promise.resolve(spokenTouch), () => {
    const audio = { paused: false, play: async () => {}, pause() { this.paused = true } }
    audios.push(audio)
    return audio
  })
  await h.flush()
  h.state.act('head')
  changed = true
  await h.event('expression_standings_updated', { characterId: 1, voiceChanged: true })
  assert.equal(audios[0].paused, true)
  assert.equal(h.state.data.value.touchLines.speech, null)
  h.state.engine.reset()
  h.state.act('head')
  assert.equal(h.state.note.value, '摸摸头', 'text remains usable during voice refresh')
  assert.equal(audios.length, 1, 'the stale URL cannot be played while refreshing')
  resolveRead({ ...spokenTouch, touchLines: { ...spokenTouch.touchLines, speech: { enabled: true, configured: true, lines: {} } } })
  await h.flush()
  h.state.engine.reset()
  h.state.act('head')
  assert.equal(audios.length, 1)
})

test('unrelated generation updates preserve the current valid audio', async t => {
  let paused = false
  const h = fixture(t, async () => spokenTouch, () => ({ play: async () => {}, pause() { paused = true } }))
  await h.flush()
  h.state.act('head')
  await h.event('expression_standings_updated', { characterId: 1, scope: 'touch-lines-speech' })
  assert.equal(paused, false)
  await h.event('expression_standings_updated', { characterId: 2, voiceChanged: true })
  assert.equal(paused, false)
})
