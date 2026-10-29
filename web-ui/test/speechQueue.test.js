import test from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechPlayback } from '../src/utils/speechPlayback.js'
import { createSpeechQueue } from '../src/utils/speechQueue.js'

const flush = () => new Promise(resolve => setImmediate(resolve))
const job = id => ({ id, status: 'completed', audio_url: `/${id}.wav` })
function fixture(play = async () => {}) {
  const audios = [], played = [], errors = [], states = []
  const player = createSpeechPlayback(() => {
    const audio = { currentTime: 0, paused: false, pause() { this.paused = true }, play() { this.paused = false; played.push(this.src); return play(this) } }
    audios.push(audio); return audio
  }, () => queue.interrupt())
  const queue = createSpeechQueue({ player })
  const reserve = () => queue.reserve({ onError: e => errors.push(e.message), onState: s => states.push(s) })
  return { queue, player, reserve, audios, played, errors, states }
}

test('out-of-order synthesis and cache hits play in click order, advancing only on audio end', async () => {
  const f = fixture(), first = f.reserve(), second = f.reserve(), third = f.reserve()
  second.ready(job('second')); third.ready(job('cached'))
  assert.equal(f.audios.length, 0, 'later ready audio must wait for the first click')
  first.ready(job('first')); await flush()
  assert.deepEqual(f.played, ['/first.wav'])
  assert.equal(first.state, 'playing')
  f.audios[0].onended(); await flush()
  assert.deepEqual(f.played, ['/first.wav', '/second.wav'])
  f.audios[0].onended(); await flush()
  assert.equal(f.audios[0].src, '/cached.wav')
  f.audios[0].onended(); await flush()
  assert.equal(third.active, false)
  assert.equal(f.errors.length, 0)
})

test('cancelling a middle item preserves the playing item and skips only that slot', async () => {
  const f = fixture(), first = f.reserve(), second = f.reserve(), third = f.reserve()
  first.ready(job('first')); second.ready(job('second')); third.ready(job('third'))
  await second.cancel()
  assert.equal(f.audios[0].paused, false)
  f.audios[0].onended(); await flush()
  assert.deepEqual(f.played, ['/first.wav', '/third.wav'])
})

test('stopping the current item advances to the next; late media callbacks cannot stop it', async () => {
  const f = fixture(), first = f.reserve(), second = f.reserve()
  first.ready(job('first')); second.ready(job('second'))
  const { onended, onerror } = f.audios[0]
  await first.cancel(); await flush()
  assert.equal(f.audios[0].paused, false)
  assert.equal(f.audios[0].src, '/second.wav')
  onended(); onerror(); await flush()
  assert.equal(second.state, 'playing')
  assert.equal(f.errors.length, 0)
})

test('failed synthesis, rejected play and media errors skip their slots instead of blocking the queue', async () => {
  const f = fixture(async audio => { if (audio.src === '/blocked.wav') throw new Error('NotAllowedError') })
  const missing = f.reserve(), blocked = f.reserve(), broken = f.reserve(), good = f.reserve()
  blocked.ready(job('blocked')); broken.ready(job('broken')); good.ready(job('good'))
  missing.fail(new Error('未配置声音')); await flush()
  assert.equal(f.audios[0].src, '/broken.wav')
  f.audios[0].onerror(); await flush()
  assert.equal(f.audios[0].src, '/good.wav')
  assert.equal(f.errors.length, 3)
})

test('page changes and external previews clear pending slots and ignore late synthesis', async () => {
  for (const interrupt of [player => player.stop(), player => player.adopt({ pause() {}, currentTime: 0 })]) {
    const f = fixture(), first = f.reserve(), pending = f.reserve()
    first.ready(job('first'))
    interrupt(f.player); pending.ready(job('late')); await flush()
    assert.equal(first.active, false)
    assert.equal(pending.active, false)
    assert.equal(f.audios.length, 1)
    assert.equal(f.audios[0].paused, true)
  }
})

test('late play promises for the same cached job cannot remove the next owner', async () => {
  let resolve, calls = 0
  const f = fixture(() => ++calls === 1 ? new Promise(r => { resolve = r }) : Promise.resolve())
  const first = f.reserve(), second = f.reserve()
  first.ready(job('same')); second.ready(job('same'))
  await first.cancel(); await flush(); resolve(); await flush()
  assert.equal(second.active, true)
  assert.equal(second.state, 'playing')
  assert.equal(f.audios[0].paused, false)
})

test('mobile autoplay rejection retains every slot and resumes synchronously on a gesture', async () => {
  let gesture = false, permitted = false
  const f = fixture(() => {
    if (!gesture && !permitted) throw new DOMException('需要轻触', 'NotAllowedError')
    permitted = true
    return Promise.resolve()
  })
  const first = f.reserve(), second = f.reserve()
  first.ready(job('first')); second.ready(job('second')); await flush()
  assert.equal(first.active, true)
  assert.equal(first.state, 'blocked')
  assert.equal(second.state, 'ready')
  assert.equal(f.errors.length, 0)
  gesture = true
  f.queue.resume()
  gesture = false // play must already have been called, without waiting for a microtask
  await flush()
  assert.equal(first.state, 'playing')
  f.audios[0].onended(); await flush()
  assert.equal(second.state, 'playing')
  assert.deepEqual(f.played, ['/first.wav', '/first.wav', '/second.wav'])
  assert.equal(f.audios.length, 1, 'following sentences reuse the permitted audio element')
})

test('a blocked queue can be cancelled or left without resurrecting speech on the next tap', async () => {
  for (const action of [f => f.queue.clear(), (f, first) => first.cancel()]) {
    const f = fixture(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')))
    const first = f.reserve()
    first.ready(job('first')); await flush()
    await action(f, first)
    f.queue.resume(); await flush()
    assert.equal(first.active, false)
    assert.equal(f.played.length, 1)
  }
})
