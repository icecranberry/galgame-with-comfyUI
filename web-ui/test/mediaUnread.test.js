import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useMediaStore } from '../src/stores/media.js'
import { startUnifiedStream, stopUnifiedStream } from '../src/stores/unifiedStream.js'

const result = (digital, social) => ({ categories: { digital: { count: digital }, social: { count: social } } })
const response = data => new Response(JSON.stringify(data))
const tick = () => new Promise(resolve => setImmediate(resolve))

test('restores persisted cursors and discards stale counts when reading during a request', async () => {
  const originalFetch = globalThis.fetch
  const originalStorage = globalThis.localStorage
  let saved = '{"digital":10,"social":20}'
  globalThis.localStorage = { getItem: () => saved, setItem: (_, value) => { saved = value } }
  setActivePinia(createPinia())
  const store = useMediaStore()
  let release
  const urls = []
  globalThis.fetch = async url => {
    urls.push(url)
    if (urls.length === 1) return new Promise(resolve => { release = () => resolve(response(result(5, 3))) })
    return response(result(1, 3))
  }
  try {
    const refresh = store.refreshUnreadCount()
    const read = store.markSeen('digital', 15)
    release()
    await Promise.all([refresh, read])
    assert.equal(urls.length, 2)
    assert.match(urls[0], /digital=10&social=20/)
    assert.match(urls[1], /digital=15&social=20/)
    assert.equal(store.newPostCount, 4, 'new post beyond read cursor remains unread')
    assert.deepEqual(JSON.parse(saved), { digital: 15, social: 20 })
    globalThis.fetch = async () => { throw Error('offline') }
    await store.refreshUnreadCount()
    assert.equal(store.newPostCount, 4, 'failure does not clear badge')
  } finally {
    globalThis.fetch = originalFetch
    globalThis.localStorage = originalStorage
  }
})

test('uses one shared stream and coalesces duplicate events into authoritative counts', async () => {
  const originals = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document }
  globalThis.window = new EventTarget()
  globalThis.document = new EventTarget()
  setActivePinia(createPinia())
  const store = useMediaStore()
  let controller
  let streams = 0
  let queries = 0
  globalThis.fetch = async url => {
    if (url === '/api/stream') {
      streams++
      return new Response(new ReadableStream({ start(c) { controller = c } }))
    }
    queries++
    return response(result(2, 6))
  }
  try {
    store.connectSSE()
    store.connectSSE()
    startUnifiedStream()
    await tick()
    controller.enqueue(new TextEncoder().encode([
      'connected', 'media_new_posts', 'media_new_posts', 'media_post_deleted',
    ].map(name => `event: ${name}\ndata: {"count":6}\n\n`).join('')))
    await new Promise(resolve => setTimeout(resolve, 220))
    assert.equal(streams, 1)
    assert.equal(queries, 1)
    assert.equal(store.newPostCount, 8)
    store.disconnectSSE()
    controller.enqueue(new TextEncoder().encode('event: media_new_posts\ndata: {"count":9}\n\n'))
    await new Promise(resolve => setTimeout(resolve, 220))
    assert.equal(queries, 1, 'unmount removes subscriptions')
  } finally {
    store.disconnectSSE()
    stopUnifiedStream()
    controller?.close()
    Object.assign(globalThis, originals)
  }
})
