import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { createSpeechTask } from '../src/utils/speechTask.js'
import { createSpeechPlayback } from '../src/utils/speechPlayback.js'
import { createSpeechQueue } from '../src/utils/speechQueue.js'
import { ttsApi } from '../src/api/tts.js'
import { chatSpeechAutoPlay } from '../src/utils/speechAutoPlay.js'

const source = readFileSync(new URL('../src/components/SpeechButton.vue', import.meta.url), 'utf8')
const code = compileScript(parse(source).descriptor, { id: 'speech-button-test' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')

function sharedPlayback() {
  const playingSpeech = Vue.ref(null), played = []
  const speechPlayer = createSpeechPlayback(() => {
    const audio = { play: async () => { played.push({ src: audio.src, onended: audio.onended }) }, pause() {}, currentTime: 0 }
    return audio
  }, () => { playingSpeech.value = null; speechQueue.interrupt() })
  const speechQueue = createSpeechQueue({ player: speechPlayer, onPlaying: job => { playingSpeech.value = job?.id || null } })
  return { playingSpeech, speechPlayer, speechQueue, played, stopSpeech: () => speechPlayer.stop(),
    speechJobs: Vue.reactive({}), messageSpeech: Vue.reactive({}) }
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

function fixture(t, groupId, api, overrides = {}, messageId = 34, autoToken, notifyErrors = false, messageIds = null) {
  let state
  const notifications = [], calls = []
  const deps = { Vue, LinsheButton: {}, createSpeechTask, chatSpeechAutoPlay, speechEnabled: Vue.ref(true), ...sharedPlayback(),
    ttsApi: async (...args) => { calls.push(args); return api(...args) }, waitSpeech: async job => job, ...overrides }
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps))
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({ characterId: 12, characterName: '测试角色', messageId, messageIds, groupId, autoToken, notifyErrors }, { expose() {} }); return () => null } })
  app.provide('toast', (...args) => notifications.push(args))
  app.mount({}); t.after(() => app.unmount())
  return { state, notifications, calls, played: deps.played, unmount: () => app.unmount() }
}

test('missing voices show a named warning toast in private and group chat and remain retryable', async t => {
  for (const groupId of [null, 56]) {
    let configured = false
    const f = fixture(t, groupId, async () => {
      if (!configured) throw Object.assign(new Error('未配置声音'), { code: 'VOICE_NOT_CONFIGURED' })
      return { id: 'ready', status: 'completed', audio_url: '/audio.wav' }
    })
    await f.state.play()
    assert.deepEqual(f.calls[0], [`${groupId ? '/groups/56' : ''}/characters/12/messages/34`, {}])
    assert.deepEqual(f.notifications, [['请先为「测试角色」配置声音：角色详情 → 声音设置', 'warning']])
    assert.equal(f.played.length, 0)
    assert.equal(f.state.error.value, '')
    assert.equal(f.state.pending.value, false)
    assert.equal(f.state.waiting.value, false)
    configured = true
    await f.state.play()
    assert.equal(f.played.length, 1)
  }
})

test('transport preserves configuration error codes for the shared button', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: '需要配置声音', code: 'VOICE_NOT_CONFIGURED' }, { status: 400 }))
  await assert.rejects(ttsApi('/characters/12/messages/34', {}), { code: 'VOICE_NOT_CONFIGURED', message: '需要配置声音' })
})

test('new private/group sentences auto-enqueue in order and never replay on remount', async t => {
  for (const groupId of [null, 56]) {
    const scope = groupId ? 'group:56' : 'chat:12'
    const leave = chatSpeechAutoPlay.enter(scope, () => true)
    const runtime = sharedPlayback(), pending = deferred()
    const token = chatSpeechAutoPlay.mark(scope, 34)
    const first = fixture(t, groupId, () => pending.promise, runtime, 34, token)
    const second = fixture(t, groupId, async () => ({ id: 'second', audio_url: '/second.wav' }), runtime, 35, chatSpeechAutoPlay.mark(scope, 35))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(first.calls.length, 1)
    assert.equal(second.state.label.value, '等待播放，点击取消')
    assert.equal(runtime.played.length, 0)
    const duplicate = fixture(t, groupId, () => assert.fail('must not replay'), runtime, 34, token)
    assert.equal(duplicate.calls.length, 0)
    pending.resolve({ id: 'first', audio_url: '/first.wav' })
    await new Promise(resolve => setImmediate(resolve))
    runtime.played[0].onended()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(runtime.played.map(audio => audio.src), ['/first.wav', '/second.wav'])
    leave()
  }
})

test('private and group buttons retain click order when later synthesis finishes first', async t => {
  for (const groupId of [null, 56]) {
    const runtime = sharedPlayback(), pending = deferred()
    const first = fixture(t, groupId, () => pending.promise, runtime)
    const second = fixture(t, groupId, async () => ({ id: 'second', status: 'completed', audio_url: '/second.wav' }), runtime, 35)
    const firstRun = first.state.play()
    await second.state.play()
    assert.equal(runtime.played.length, 0)
    assert.equal(second.state.label.value, '等待播放，点击取消')
    pending.resolve({ id: 'first', status: 'completed', audio_url: '/first.wav' })
    await firstRun
    assert.equal(first.state.isPlaying.value, true)
    assert.equal(second.state.isPlaying.value, false)
    runtime.played[0].onended()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(first.state.isPlaying.value, false)
    assert.equal(second.state.isPlaying.value, true)
    assert.deepEqual(runtime.played.map(audio => audio.src), ['/first.wav', '/second.wav'])
  }
})

test('connection failures are not mislabeled as missing voice configuration', async t => {
  const f = fixture(t, 56, async () => { throw new Error('无法连接语音服务') })
  await f.state.play()
  assert.equal(f.notifications.length, 0)
  assert.equal(f.state.error.value, '无法连接语音服务')
  assert.equal(f.played.length, 0)
})

test('Galgame surfaces synthesis failures even when standard chat bubbles are hidden', async t => {
  const f = fixture(t, null, async () => { throw new Error('无法连接语音服务') }, {}, 34, undefined, true)
  await f.state.play()
  assert.deepEqual(f.notifications, [['无法连接语音服务', 'error']])
})

test('cancelling an old request cannot stop a newer private/group playback or cancel its shared job', async t => {
  const runtime = sharedPlayback(), pending = deferred()
  const old = fixture(t, null, async path => path.endsWith('/cancel') ? assert.fail('superseded request must not cancel a shared job') : pending.promise, runtime)
  const newer = fixture(t, 56, async () => ({ id: 'shared', status: 'completed', audio_url: '/shared.wav' }), runtime, 35)
  const oldRun = old.state.play()
  await newer.state.play()
  await old.state.cancel()
  assert.equal(runtime.playingSpeech.value, 'shared')
  pending.resolve({ id: 'shared', status: 'queued' })
  await oldRun
  assert.equal(runtime.playingSpeech.value, 'shared')
  assert.equal(old.state.isPlaying.value, false)
  assert.equal(newer.state.isPlaying.value, true)
})

test('unmounting a queued bubble sharing cached audio does not stop the current owner', async t => {
  const runtime = sharedPlayback(), job = { id: 'cached', status: 'completed', audio_url: '/cached.wav' }
  const first = fixture(t, null, async () => job, runtime)
  const second = fixture(t, 56, async () => job, runtime, 35)
  await first.state.play(); await second.state.play()
  assert.equal(first.state.isPlaying.value, true)
  assert.equal(second.state.waiting.value, true)
  second.unmount()
  assert.equal(runtime.playingSpeech.value, 'cached')
  first.unmount()
  assert.equal(runtime.playingSpeech.value, null)
})

test('late errors from cancelled requests do not show a misleading configuration toast', async t => {
  const runtime = sharedPlayback(), pending = deferred()
  const f = fixture(t, null, () => pending.promise, runtime)
  const run = f.state.play()
  await f.state.cancel()
  pending.reject(Object.assign(new Error('未配置声音'), { code: 'VOICE_NOT_CONFIGURED' }))
  await run
  assert.equal(f.notifications.length, 0)
  assert.equal(f.state.error.value, '')
})

test('cancellation before the creation response still cancels the owned backend job', async t => {
  const runtime = sharedPlayback(), pending = deferred()
  const f = fixture(t, 56, path => path.endsWith('/cancel') ? { id: 'own', status: 'cancelled' } : pending.promise, runtime)
  const run = f.state.play()
  await f.state.cancel()
  pending.resolve({ id: 'own', status: 'queued' })
  await run
  assert.equal(f.calls.filter(([path]) => path === '/jobs/own/cancel').length, 1)
  assert.equal(runtime.playingSpeech.value, null)
})


test('main dialogue reserves page sentences together and plays them in order', async t => {
  const runtime = sharedPlayback(), first = deferred()
  const f = fixture(t, null, path => path.endsWith('/101') ? first.promise : {id:'second',status:'completed',audio_url:'/second.wav'}, runtime, null, undefined, true, [101,102,101])
  const running = f.state.play()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.calls.map(([path]) => path), ['/characters/12/messages/101','/characters/12/messages/102'])
  assert.equal(runtime.played.length,0)
  first.resolve({id:'first',status:'completed',audio_url:'/first.wav'}); await running
  assert.equal(f.state.isPlaying.value,true)
  assert.deepEqual(runtime.played.map(audio=>audio.src),['/first.wav'])
  runtime.played[0].onended(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.state.isPlaying.value,true)
  assert.deepEqual(runtime.played.map(audio=>audio.src),['/first.wav','/second.wav'])
  await f.state.play() // The same button stops the page instead of queuing it again.
  assert.equal(runtime.playingSpeech.value,null)
  assert.equal(f.state.waiting.value,false)
})

test('leaving a dialogue page cancels every pending sentence and ignores late responses', async t => {
  const runtime = sharedPlayback(), response = deferred()
  const f = fixture(t, null, () => response.promise, runtime, null, undefined, true, [101,102])
  const running = f.state.play()
  f.unmount()
  response.resolve({id:'late',status:'completed',audio_url:'/late.wav'}); await running
  assert.equal(runtime.played.length,0)
  assert.equal(f.state.waiting.value,false)
})

test('a page with several sentences reports missing voice configuration only once', async t => {
  const f = fixture(t, null, async () => { throw Object.assign(new Error('未配置声音'), {code:'VOICE_NOT_CONFIGURED'}) }, {}, null, undefined, true, [101,102])
  await f.state.play()
  assert.equal(f.notifications.length,1)
  assert.match(f.notifications[0][0],/测试角色/)
  assert.equal(f.state.waiting.value,false)
})
