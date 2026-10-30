import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { createSpeechPlayback } from '../src/utils/speechPlayback.js'

const source = readFileSync(new URL('../src/components/VoiceAudioPlayer.vue', import.meta.url), 'utf8')
const code = compileScript(parse(source).descriptor, { id: 'voice-audio-test' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')

function fixture(t, play = async () => {}) {
  const props = Vue.reactive({ src: '/voice.wav', label: '试听', preload: 'metadata' }), events = [], frames = new Map()
  let state, frameId = 0
  const deps = { Vue, LinsheButton: {}, requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId }, cancelAnimationFrame: id => frames.delete(id) }
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps))
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup(props, { expose() {}, emit: (...args) => events.push(args) }); return () => null } })
  app.mount({}); t.after(() => app.unmount())
  const audio = Vue.markRaw({ paused: true, currentTime: 0, duration: 60, volume: 1, muted: false,
    play() { this.paused = false; return play() }, pause() { this.paused = true } })
  state.media.value = audio; state.syncTime()
  return { state, audio, props, events, frames }
}

test('play and pause update immediately while native play is pending; late rejection cannot undo a newer play', async t => {
  let rejectFirst, count = 0
  const f = fixture(t, () => ++count === 1 ? new Promise((_, reject) => { rejectFirst = reject }) : Promise.resolve())
  const first = f.state.play()
  assert.equal(f.state.playing.value, true)
  f.state.pause()
  assert.equal(f.state.playing.value, false)
  await f.state.play()
  f.state.onPause({ target: f.audio }) // stale pause event queued before latest play
  rejectFirst(new DOMException('old request interrupted', 'AbortError')); await first
  assert.equal(f.state.playing.value, true)
  assert.equal(f.state.error.value, '')
})

test('blocked playback rolls back and remains retryable; ended and external pauses stop frame updates', async t => {
  let blocked = true
  const f = fixture(t, async () => { if (blocked) throw new Error('NotAllowedError') })
  await f.state.play()
  assert.equal(f.state.playing.value, false)
  assert.match(f.state.error.value, /再次点击/)
  blocked = false; await f.state.play(); f.state.onPlay({ target: f.audio })
  assert.equal(f.frames.size, 1)
  const player = createSpeechPlayback()
  player.adopt(f.audio); player.stop(); f.state.onPause({ target: f.audio })
  assert.equal(f.state.playing.value, false)
  assert.equal(f.frames.size, 0)
  assert.equal(f.state.position.value, 0)
  f.state.onEnded({ target: f.audio })
  assert.equal(f.events.at(-1)[0], 'ended')
})

test('seek updates progress immediately, clamps pointer positions and supports keyboard seeking', t => {
  const f = fixture(t)
  let focused = false, captured = false
  const currentTarget = { focus() { focused = true }, setPointerCapture() { captured = true }, getBoundingClientRect: () => ({ left: 100, width: 200 }) }
  f.state.beginSeek({ currentTarget, pointerId: 1, clientX: 150, button: 0 })
  assert.ok(focused && captured)
  assert.equal(f.audio.currentTime, 15); assert.equal(f.state.fraction.value, .25)
  f.state.moveSeek({ currentTarget, clientX: 400 }); assert.equal(f.audio.currentTime, 60)
  f.state.endSeek({ currentTarget, clientX: 50 }); assert.equal(f.audio.currentTime, 0)
  f.state.seekKey({ key: 'ArrowRight', preventDefault() {} }); assert.equal(f.audio.currentTime, 5)
  f.state.seekKey({ key: 'End', preventDefault() {} }); assert.equal(f.audio.currentTime, 60)
  assert.equal(f.state.dragging.value, false)
})

test('source replacement invalidates pending playback and resets position; mute reflects native state', async t => {
  let reject
  const f = fixture(t, () => new Promise((_, fail) => { reject = fail }))
  const pending = f.state.play()
  f.audio.currentTime = 12; f.state.syncTime()
  f.props.src = '/next.wav'
  reject(new Error('old source failed')); await pending
  assert.equal(f.state.playing.value, false)
  assert.equal(f.state.position.value, 0)
  assert.equal(f.state.error.value, '')
  f.state.toggleMute(); assert.equal(f.audio.muted, true); assert.equal(f.state.muted.value, true)
  f.state.toggleMute(); assert.equal(f.audio.muted, false)
})

test('progress follows current media time on animation frames without waiting for timeupdate', async t => {
  const f = fixture(t)
  await f.state.play(); f.state.onPlay({ target: f.audio })
  f.audio.currentTime = 23.75
  const [id, tick] = f.frames.entries().next().value; f.frames.delete(id); tick()
  assert.equal(f.state.position.value, 23.75)
  assert.equal(f.state.formatTime(f.state.position.value), '0:23')
  f.state.pause(); assert.equal(f.frames.size, 0)
})

test('local sample transport reuses player controls and yields to global playback', async t => {
  const f = fixture(t), events = new EventTarget()
  const transport = Vue.markRaw({ paused: true, currentTime: 0, duration: 8, volume: 1, muted: false,
    addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args),
    async play() { this.paused = false; events.dispatchEvent(new Event('play')) },
    pause() { this.paused = true; events.dispatchEvent(new Event('pause')) },
  })
  f.props.transport = transport
  await f.state.play()
  assert.equal(f.state.playing.value, true)
  assert.equal(f.events.at(-1)[1].target, transport)
  const owner = createSpeechPlayback(); owner.adopt(transport)
  f.state.seek(3); assert.equal(transport.currentTime, 3)
  f.state.toggleMute(); assert.equal(transport.muted, true)
  owner.begin()
  assert.equal(transport.paused, true)
  assert.equal(transport.currentTime, 0)
  assert.equal(f.state.playing.value, false)
})
