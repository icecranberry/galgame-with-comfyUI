import test from 'node:test'
import assert from 'node:assert/strict'
import { createStandingTouchSpeech } from '../src/utils/standingTouchSpeech.js'
import { createSpeechPlayback } from '../src/utils/speechPlayback.js'

const metadata = (lines, overrides = {}) => ({ enabled: true, configured: true, lines, ...overrides })
const saved = metadata({ head: [{ text: '摸摸头', audio_url: '/head.wav', status: 'completed' }] })

test('rapid replies interrupt immediately and discard unfinished playback instead of replaying it', async () => {
  const pending = [], started = []
  let audio
  const player = createSpeechPlayback(() => (audio = {
    currentTime: 0, paused: true,
    pause() { this.paused = true },
    play() { this.paused = false; started.push(this.src); return new Promise(resolve => pending.push(resolve)) },
  }))
  const speech = createStandingTouchSpeech(player)
  const lines = metadata({ head: ['a','b','c'].map(text => ({text,audio_url:`/${text}.wav`})) })
  const first = speech.play('head','a',lines)
  const firstEnded = audio.onended
  audio.currentTime = 1
  const second = speech.play('head','b',lines)
  assert.equal(audio.currentTime,0)
  const third = speech.play('head','c',lines)
  assert.deepEqual(started,['/a.wav','/b.wav','/c.wav'])
  pending[2](); assert.equal(await third,true)
  pending[0](); pending[1]()
  assert.equal(await first,false); assert.equal(await second,false)
  firstEnded()
  assert.equal(audio.src,'/c.wav'); assert.equal(audio.paused,false)
  audio.onended(); await Promise.resolve()
  assert.deepEqual(started,['/a.wav','/b.wav','/c.wav'],'discarded replies never resume')
})

function fixture(play = async () => {}) {
  const audios = []
  const player = createSpeechPlayback(() => {
    const audio = { paused: false, currentTime: 0, play() { this.paused = false; return play() }, pause() { this.paused = true } }
    audios.push(audio)
    return audio
  })
  return { player, audios, speech: createStandingTouchSpeech(player) }
}

test('exact part and selected text select the audio; silent text stops only its own voice', async () => {
  const { player, audios, speech } = fixture()
  const other = player.begin()
  await player.play('/chat.wav', other)
  assert.equal(await speech.play('face', '摸摸头', saved), false)
  assert.equal(audios[0].paused, false)
  assert.equal(await speech.play('head', '新的台词', saved), false)
  assert.equal(await speech.play('head', '摸摸头', saved), true)
  assert.equal(audios[0].paused, false)
  assert.equal(audios[0].src, '/head.wav')
  assert.equal(await speech.play('head', '无语音的台词', saved), false)
  assert.equal(audios[0].paused, true)
})

test('unconfigured or disabled speech is skipped; retained successful audio remains playable', async () => {
  const { audios, speech } = fixture()
  for (const overrides of [{ enabled: false }, { configured: false }]) {
    assert.equal(await speech.play('head', '摸摸头', { ...saved, ...overrides }), false)
  }
  assert.equal(await speech.play('head', '摸摸头', null), false)
  assert.equal(audios.length, 0)
  for (const status of ['queued', 'generating', 'failed']) {
    const speechData = metadata({ head: [{ text: '摸摸头', audio_url: '/retained.wav', status }] })
    assert.equal(await speech.play('head', '摸摸头', speechData), true)
  }
  assert.equal(audios.at(-1).src, '/retained.wav')
})

test('Audio.play runs before the gesture returns; a rejected play can be retried', async () => {
  let gesture = false, blocked = true, calls = 0
  const { speech } = fixture(() => {
    assert.equal(gesture, true, 'no asynchronous boundary before native play')
    calls++
    return blocked ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve()
  })
  gesture = true
  const first = speech.play('head', '摸摸头', saved)
  assert.equal(calls, 1)
  gesture = false
  assert.equal(await first, false)
  blocked = false
  gesture = true
  const second = speech.play('head', '摸摸头', saved)
  assert.equal(calls, 2)
  gesture = false
  assert.equal(await second, true)
})

test('clear and stale playback failure cannot stop newer audio from another owner', async () => {
  let reject
  const { player, speech, audios } = fixture(() => new Promise((_, fail) => { reject = fail }))
  const pending = speech.play('head', '摸摸头', saved)
  const external = { currentTime: 0, paused: false, pause() { this.paused = true } }
  player.adopt(external)
  assert.equal(audios[0].paused, true)
  reject(new Error('aborted'))
  assert.equal(await pending, false)
  speech.stop()
  assert.equal(external.paused, false)
})

test('ending an old audio never releases the current touch playback owner', async () => {
  const { speech, audios } = fixture()
  await speech.play('head', '摸摸头', saved)
  const oldEnded = audios[0].onended
  await speech.play('head', '摸摸头', saved)
  oldEnded()
  speech.stop()
  assert.equal(audios[0].paused, true)
})

test('refresh preserves retained audio during regeneration but stops removed or replaced audio', async () => {
  const { speech, audios } = fixture()
  await speech.play('head', '摸摸头', saved)
  speech.reconcile(metadata({ head: [{ text: '摸摸头', status: 'generating', audio_url: '/head.wav' }] }))
  assert.equal(audios[0].paused, false)
  speech.reconcile(metadata({ head: [{ text: '摸摸头', status: 'completed', audio_url: '/new.wav' }] }))
  assert.equal(audios[0].paused, true)
  await speech.play('head', '摸摸头', saved)
  speech.reconcile({ ...saved, enabled: false })
  assert.equal(audios[0].paused, true)
  await speech.play('head', '摸摸头', saved)
  speech.reconcile(metadata({ head: [{ text: '改过的台词', audio_url: '/head.wav' }] }))
  assert.equal(audios[0].paused, true)
})
