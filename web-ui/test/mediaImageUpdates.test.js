import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive, computed } from 'vue'
import { applyMediaImageUpdate, applyMediaPortalReady } from '../src/utils/mediaImageUpdates.js'
import { onEvent, startUnifiedStream, stopUnifiedStream } from '../src/stores/unifiedStream.js'

test('cover completion clears generating/error state and ignores other posts', () => {
  const post = { id: 1, image_status: 'generating', image_error: 'old error' }
  applyMediaImageUpdate(post, { postId: 2, image: '/wrong.png' })
  assert.equal(post.image, undefined)
  applyMediaImageUpdate(post, { postId: 1, image: '/cover.png' })
  assert.equal(post.image, '/cover.png')
  assert.equal(post.image_status, 'done')
  assert.equal(post.image_error, null)
})

test('portal updates are reactive, preserve body, and finish only on portal-ready', () => {
  const post = reactive({ id: 1, image_status: 'pending', payload: {
    sections: [{ key: 'a', image: null, body: [{ type: 'p', text: 'cached' }] }, { key: 'b', image: null }],
  } })
  const visibleImage = computed(() => post.payload.sections[0].image)
  assert.equal(visibleImage.value, null)
  applyMediaImageUpdate(post, { postId: 1, sectionKey: 'a', image: '/a.png' })
  assert.equal(visibleImage.value, '/a.png')
  assert.equal(post.payload.sections[0].body[0].text, 'cached')
  assert.equal(post.payload.sections[1].image, null)
  assert.equal(post.image_status, 'pending')
  applyMediaPortalReady(post, { postId: 1 })
  assert.equal(post.image, '/a.png')
  assert.equal(post.image_status, 'done')
})

test('poster panel event updates only its panel, never the cover', () => {
  const post = { id: 1, image: '/cover.png', payload: { panels: [{}, {}] } }
  applyMediaImageUpdate(post, { postId: 1, panel: true, panelIndex: 1, image: '/panel.png' })
  assert.equal(post.image, '/cover.png')
  assert.equal(post.payload.panels[0].image, undefined)
  assert.equal(post.payload.panels[1].image, '/panel.png')
})

test('unified SSE forwards every media event to subscribers', async () => {
  const events = ['media_new_posts', 'media_image_ready', 'media_portal_ready']
  const received = []
  const originalFetch = globalThis.fetch
  const unsubscribers = events.map(name => onEvent(name, data => received.push([name, data])))
  let controller
  globalThis.fetch = async () => new Response(new ReadableStream({ start(c) {
    controller = c
    c.enqueue(new TextEncoder().encode(events.map(name => `event: ${name}\ndata: {"postId":1}\n\n`).join('')))
  } }))
  try {
    startUnifiedStream()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(received, events.map(name => [name, { postId: 1 }]))
  } finally {
    stopUnifiedStream()
    controller?.close()
    unsubscribers.forEach(unsubscribe => unsubscribe())
    globalThis.fetch = originalFetch
  }
})
