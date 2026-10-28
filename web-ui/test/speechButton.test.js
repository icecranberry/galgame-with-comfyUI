import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { createSpeechTask } from '../src/utils/speechTask.js'
import { createSpeechPlayback } from '../src/utils/speechPlayback.js'
import { ttsApi } from '../src/api/tts.js'

const source = readFileSync(new URL('../src/components/SpeechButton.vue', import.meta.url), 'utf8')
const code = compileScript(parse(source).descriptor, { id: 'speech-button-test' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')

function sharedPlayback() {
  const playingSpeech = Vue.ref(null)
  const speechPlayer = createSpeechPlayback(() => ({ play: async () => {}, pause() {}, currentTime: 0 }), () => { playingSpeech.value = null })
  return { playingSpeech, speechPlayer, stopSpeech: () => speechPlayer.stop(),
    speechJobs: Vue.reactive({}), messageSpeech: Vue.reactive({}),
    playSpeechJob: async (job, ticket) => { playingSpeech.value = job.id; await speechPlayer.play(job.audio_url, ticket) } }
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

function fixture(t, groupId, api, overrides = {}, messageId = 34) {
  let state
  const notifications = [], calls = [], played = []
  const deps = { Vue, LinsheButton: {}, createSpeechTask, speechEnabled: Vue.ref(true), speechJobs: Vue.reactive({}), messageSpeech: Vue.reactive({}),
    playingSpeech: Vue.ref(null), speechPlayer: { begin: () => 1, current: () => true }, stopSpeech() {},
    ttsApi: async (...args) => { calls.push(args); return api(...args) }, waitSpeech: async job => job, playSpeechJob: async job => played.push(job), ...overrides }
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps))
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({ characterId: 12, characterName: '测试角色', messageId, groupId }, { expose() {} }); return () => null } })
  app.provide('toast', (...args) => notifications.push(args))
  app.mount({}); t.after(() => app.unmount())
  return { state, notifications, calls, played, unmount: () => app.unmount() }
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

test('connection failures are not mislabeled as missing voice configuration', async t => {
  const f = fixture(t, 56, async () => { throw new Error('无法连接语音服务') })
  await f.state.play()
  assert.equal(f.notifications.length, 0)
  assert.equal(f.state.error.value, '无法连接语音服务')
  assert.equal(f.played.length, 0)
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

test('unmounting a bubble sharing cached audio does not stop its current owner', async t => {
  const runtime = sharedPlayback(), job = { id: 'cached', status: 'completed', audio_url: '/cached.wav' }
  const first = fixture(t, null, async () => job, runtime)
  const second = fixture(t, 56, async () => job, runtime, 35)
  await first.state.play(); await second.state.play()
  assert.equal(first.state.isPlaying.value, false)
  assert.equal(second.state.isPlaying.value, true)
  first.unmount()
  assert.equal(runtime.playingSpeech.value, 'cached')
  second.unmount()
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
