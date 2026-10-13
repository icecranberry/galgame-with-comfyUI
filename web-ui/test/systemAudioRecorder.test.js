import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSystemAudioRecorder } from '../src/utils/systemAudioRecorder.js'

function setup(extra = {}) {
  const tracks = ['audio', 'video'].map(kind => ({ kind, readyState: 'live', stopped: false, handlers: {},
    stop() { this.stopped = true; this.readyState = 'ended' },
    addEventListener(name, fn) { this.handlers[name] = fn },
  }))
  const source = { getTracks: () => tracks, getAudioTracks: () => tracks.filter(t => t.kind === 'audio') }
  const instances = [], states = [], results = [], captureRequests = []
  class Recorder {
    static isTypeSupported() { return true }
    constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; instances.push(this) }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable({ data: new Blob(['audio']) }); this.onstop() }) }
  }
  class Stream { constructor(tracks) { this.tracks = tracks } }
  const recorder = createSystemAudioRecorder({ Recorder, Stream, getDisplayMedia: async options => { captureRequests.push(options); return source },
    onState: s => states.push(s), onResult: b => results.push(b), ...extra })
  return { recorder, tracks, source, instances, states, results, captureRequests }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
test('records only audio, stops every capture track, and returns the final chunk once', async () => {
  const s = setup(); await s.recorder.start(); await s.recorder.start()
  assert.equal(s.captureRequests.length, 1)
  assert.deepEqual(s.captureRequests[0].audio, { autoGainControl: false, echoCancellation: false, noiseSuppression: false })
  assert.equal(s.captureRequests[0].systemAudio, 'include')
  assert.equal(s.instances.length, 1)
  assert.deepEqual(s.instances[0].stream.tracks.map(t => t.kind), ['audio'])
  s.recorder.stop(); s.recorder.stop()
  assert.ok(s.tracks.every(t => t.stopped))
  await flush(); assert.equal(s.results.length, 1); assert.equal(await s.results[0].text(), 'audio')
  assert.equal(s.states.at(-1).phase, 'ready'); s.recorder.cancel()
})
test('missing shared audio fails visibly and releases video capture', async () => {
  const s = setup(); s.source.getAudioTracks = () => []
  await s.recorder.start()
  assert.equal(s.states.at(-1).phase, 'error'); assert.match(s.states.at(-1).error, /未共享声音/)
  assert.ok(s.tracks.every(t => t.stopped)); assert.equal(s.instances.length, 0)
})
test('late permission grant after closing cannot start an orphan recorder', async () => {
  let grant
  const s = setup({ getDisplayMedia: () => new Promise(resolve => { grant = resolve }) })
  const pending = s.recorder.start(); s.recorder.cancel(); grant(s.source); await pending
  assert.ok(s.tracks.every(t => t.stopped)); assert.equal(s.instances.length, 0); assert.equal(s.results.length, 0)
})
test('source sharing stop finalizes recording; cancelling discards queued chunks', async () => {
  const s = setup(); await s.recorder.start(); s.tracks[1].handlers.ended(); await flush()
  assert.equal(s.results.length, 1); assert.ok(s.tracks.every(t => t.stopped))
  const other = setup(); await other.recorder.start(); other.recorder.cancel(); await flush()
  assert.equal(other.results.length, 0); assert.ok(other.tracks.every(t => t.stopped))
})
test('duration and byte limits stop capture without keeping oversized audio', async () => {
  const timed = setup({ maxDurationMs: 10 }); await timed.recorder.start()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(timed.results.length, 1); assert.ok(timed.tracks.every(t => t.stopped)); timed.recorder.cancel()
  const sized = setup({ maxBytes: 2 }); await sized.recorder.start(); sized.recorder.stop(); await flush()
  assert.equal(sized.results.length, 0); assert.equal(sized.states.at(-1).phase, 'error')
})
test('denied permission and recorder errors remain recoverable', async () => {
  const denied = setup({ getDisplayMedia: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }) } })
  await denied.recorder.start(); assert.match(denied.states.at(-1).error, /授权/)
  const failed = setup(); await failed.recorder.start(); failed.instances[0].onerror(); await flush()
  assert.equal(failed.results.length, 0); assert.equal(failed.states.at(-1).phase, 'error'); assert.ok(failed.tracks.every(t => t.stopped))
})
