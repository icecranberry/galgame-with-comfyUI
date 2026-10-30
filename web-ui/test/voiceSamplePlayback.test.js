import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSpeechPlayback } from '../src/utils/speechPlayback.js'

const code = readFileSync(new URL('../src/audio/voiceSamplePlayback.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace('export function', 'function') + '\nreturn createVoiceSamplePlayback'
const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture(t, { fetchSource } = {}) {
  const requests = [], messages = [], contexts = [], nodes = [], filters = []
  const parameter = () => ({ value: 0, setTargetAtTime(value) { this.value = value } })
  const effect = () => ({ gain: parameter(), frequency: parameter(), Q: parameter(), connect(next) { return next }, disconnect() {} })
  class Context {
    constructor() { this.state = 'suspended'; this.currentTime = 0; contexts.push(this); this.audioWorklet = { addModule: async () => {} }; this.destination = {} }
    async resume() { this.state = 'running' }
    async close() { this.state = 'closed' }
    createGain() { return effect() } createBiquadFilter() { const filter = effect(); filters.push(filter); return filter } createWaveShaper() { return effect() }
    async decodeAudioData() { return { length: 48000 * 12, duration: 12, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => new Float32Array(48000 * 12) } }
  }
  class Node {
    constructor() {
      nodes.push(this)
      this.port = { postMessage: data => { messages.push(data); if (data.type === 'init') queueMicrotask(() => this.port.onmessage?.({ data: { type: 'ready' } })) } }
    }
    connect(next) { return next } disconnect() {}
  }
  const fetch = async (url, options) => {
    requests.push(url)
    if (url === '/sample.wav' && fetchSource) return fetchSource(options)
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }
  }
  const create = new Function('processorUrl', 'wasmUrl', 'fetch', 'AudioContext', 'AudioWorkletNode', 'WebAssembly', code)('processor', 'wasm', fetch, Context, Node, { compile: async () => ({}) })
  const transport = create({ src: '/sample.wav', start: 2, end: 7 })
  t.after(() => transport.dispose())
  return { transport, requests, messages, contexts, nodes, filters }
}

test('sample playback loads lazily, crops locally and changes all parameters without another request', async t => {
  const f = fixture(t)
  assert.equal(f.requests.length, 0)
  await f.transport.play()
  assert.equal(f.transport.paused, false)
  assert.equal(f.transport.duration, 5)
  assert.equal(f.messages.find(data => data.type === 'init').samples.length, 48000 * 5)
  const requests = f.requests.length
  f.transport.setParameters({ pitch: 2, resonance: -5, brightness: 3, thickness: 2, clarity: -1.5, air: 3.5 })
  assert.equal(f.requests.length, requests)
  assert.equal(f.messages.at(-1).parameters.pitch, 2)
  assert.deepEqual(f.filters.slice(2).map(filter => [filter.type, filter.frequency.value, filter.gain.value]), [
    ['lowshelf', 180, 2], ['peaking', 2800, -1.5], ['highshelf', 8000, 3.5],
  ])
  assert.equal(f.filters[3].Q.value, .9)
  assert.equal(f.transport.paused, false)
  f.nodes[0].port.onmessage({ data: { type: 'position', seconds: 1.5 } })
  assert.equal(f.transport.currentTime, 1.5)
  f.transport.currentTime = 3
  assert.deepEqual(f.messages.at(-1), { type: 'seek', seconds: 3 })
})

test('a newer player cancels a pending first load and cannot be interrupted by its late completion', async t => {
  let release
  const f = fixture(t, { fetchSource: () => new Promise(resolve => { release = () => resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }) }) })
  const owner = createSpeechPlayback()
  f.transport.addEventListener('play', () => owner.adopt(f.transport))
  const pending = f.transport.play()
  owner.begin()
  f.transport.setParameters({ pitch: -2 })
  release(); await pending
  assert.equal(f.transport.paused, true)
  assert.equal(f.messages.some(data => data.type === 'play'), false)
  assert.equal(f.messages.filter(data => data.type === 'parameters').at(-1).parameters.pitch, -2)
  await f.transport.play()
  assert.equal(f.messages.at(-1).type, 'play')
  f.transport.dispose(); await flush()
  assert.equal(f.contexts[0].state, 'closed')
  await assert.rejects(f.transport.play(), { name: 'AbortError' })
})

test('failed loading closes the audio context and can be retried', async t => {
  let fail = true
  const f = fixture(t, { fetchSource: async () => { if (fail) throw new Error('offline'); return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) } } })
  await assert.rejects(f.transport.play(), /offline/)
  assert.equal(f.transport.paused, true)
  assert.equal(f.contexts[0].state, 'closed')
  fail = false; await f.transport.play()
  assert.equal(f.contexts.length, 2)
  assert.equal(f.transport.paused, false)
})
