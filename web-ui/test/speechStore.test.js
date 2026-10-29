import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { createSpeechPlayback } from '../src/utils/speechPlayback.js'
import { createSpeechQueue } from '../src/utils/speechQueue.js'

const code = readFileSync(new URL('../src/stores/speech.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace(/\bexport /g, '')
  + '\nreturn { loadSpeech, speechJobs, messageSpeech, speechEnabled, speechQueue, speechPlayer, playingSpeech, stopSpeech }'
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function fixture(api, playerFactory = createSpeechPlayback) {
  let event
  const store = new Function('reactive', 'ref', 'onEvent', 'ttsApi', 'createSpeechPlayback', 'createSpeechQueue', code)(Vue.reactive, Vue.ref, (name, fn) => { event = fn }, api, playerFactory, createSpeechQueue)
  return { ...store, update: job => event(job) }
}

test('late settings from a previous conversation cannot overwrite the current speech toggle', async () => {
  const oldSettings = deferred(), paths = []
  let settingsCalls = 0
  const store = fixture(async path => {
    paths.push(path)
    return path === '/settings' ? ++settingsCalls === 1 ? oldSettings.promise : { enabled: false } : []
  })
  const first = store.loadSpeech(12)
  await store.loadSpeech(null, { groupId: 56 })
  oldSettings.resolve({ enabled: true }); await first
  assert.equal(store.speechEnabled.value, false)
  assert.ok(paths.includes('/groups/56/messages'))
  assert.ok(!paths.includes('/characters/12/messages'))
})

test('history arriving late cannot overwrite a new retry mapping or a live job update', async () => {
  const history = deferred()
  const store = fixture(path => path === '/settings' ? { enabled: true } : history.promise)
  store.speechJobs.cached = { id: 'cached', status: 'queued' }
  store.messageSpeech[34] = 'cached'
  const loading = store.loadSpeech(12)
  await Promise.resolve()
  store.update({ id: 'cached', status: 'completed', audio_url: '/done.wav' })
  store.messageSpeech[34] = 'retry'
  history.resolve([{ id: 'cached', status: 'queued', message_id: 34 }, { id: 'other', status: 'completed', message_id: 35 }])
  await loading
  assert.equal(store.speechJobs.cached.status, 'completed')
  assert.equal(store.messageSpeech[34], 'retry')
  assert.equal(store.messageSpeech[35], 'other')
})

test('global stop clears queued chat audio before late synthesis can start it', async () => {
  const store = fixture(async () => [])
  const first = store.speechQueue.reserve(), second = store.speechQueue.reserve()
  store.stopSpeech()
  first.ready({ id: 'late', audio_url: '/late.wav' })
  assert.equal(first.active, false)
  assert.equal(second.active, false)
  assert.equal(store.playingSpeech.value, null)
})
