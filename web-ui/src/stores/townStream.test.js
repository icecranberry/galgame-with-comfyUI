import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useTownStore } from './town.js'
import { startUnifiedStream, stopUnifiedStream } from './unifiedStream.js'

test('actual unified SSE parser forwards state invalidations to mounted town and unsubscribes on exit', async t => {
  let controller, reads = 0, epoch = 1
  const encoder = new TextEncoder()
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url === '/api/stream') return new Response(new ReadableStream({
      start(value) {
        controller = value
        options.signal.addEventListener('abort', () => controller.close(), { once: true })
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } })
    assert.equal(url, '/api/town/state')
    reads++
    return Response.json({ worldId: 'world', worldEpoch: epoch, serverTime: Date.now(),
      initialized: false, map: null, agents: [], player: null, encountersActive: [] })
  })
  setActivePinia(createPinia())
  const town = useTownStore()
  t.after(() => { town.stopTownStream(); stopUnifiedStream() })
  town.startTownStream(); startUnifiedStream()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(reads, 1)
  epoch = 2
  // Exercise chunking and the real API parser rather than directly invoking a store handler.
  controller.enqueue(encoder.encode('event: town_state_up'))
  controller.enqueue(encoder.encode('dated\ndata: {"worldId":"world","worldEpoch":2,"reason":"world_reset"}\n\n'))
  controller.enqueue(encoder.encode('event: town_state_updated\ndata: {"worldId":"world","worldEpoch":2,"reason":"service_changed"}\n\n'))
  await new Promise(resolve => setTimeout(resolve, 160))
  assert.equal(reads, 2, 'a burst of changes requires one refreshed snapshot')
  assert.equal(town.snapshot.worldEpoch, 2)
  town.stopTownStream()
  controller.enqueue(encoder.encode('event: town_state_updated\ndata: {"worldId":"world","worldEpoch":3}\n\n'))
  await new Promise(resolve => setTimeout(resolve, 160))
  assert.equal(reads, 2, 'the app stream must not refresh an unmounted town')
  assert.equal(town.connected, false)
})
