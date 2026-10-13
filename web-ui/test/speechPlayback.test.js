import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechPlayback } from '../src/utils/speechPlayback.js'

test('one audio at a time; switching pages invalidates pending synthesis playback', async () => {
  const audios = []
  const player = createSpeechPlayback(() => {
    const audio = { currentTime: 0, paused: false, play: async () => {}, pause() { this.paused = true } }
    audios.push(audio); return audio
  })
  const first = player.begin()
  await player.play('/one.wav', first)
  const second = player.begin()
  assert.equal(audios[0].paused, true)
  assert.equal(await player.play('/late.wav', first), false)
  await player.play('/two.wav', second)
  player.stop()
  assert.equal(audios[1].paused, true)
  assert.equal(await player.play('/late2.wav', second), false)
})
test('original audio joins the same player; blocked autoplay can be retried', async () => {
  let fail = true
  const player = createSpeechPlayback(() => ({ currentTime: 0, pause() {}, async play() { if (fail) throw new Error('NotAllowedError') } }))
  await assert.rejects(player.play('/one.wav', player.begin()), /NotAllowed/)
  fail = false
  assert.equal(await player.play('/one.wav', player.begin()), true)
  let paused = false
  player.adopt({ currentTime: 1, pause() { paused = true } })
  player.stop()
  assert.equal(paused, true)
})
