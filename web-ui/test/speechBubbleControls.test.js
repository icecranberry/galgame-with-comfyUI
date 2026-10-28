import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref } from 'vue'
import { useSpeechBubbleControls } from '../src/composables/useSpeechBubbleControls.js'

function fixture(t) {
  const scope = effectScope(), route = ref('private:12')
  const state = scope.run(() => useSpeechBubbleControls(() => route.value))
  t.after(() => scope.stop())
  return { ...state, route }
}
const pointer = (options = {}) => ({ pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 100, clientY: 100, timeStamp: 0,
  target: { closest: () => null }, ...options })

test('light touch reveals only the selected bubble; button touches preserve it and outside touches dismiss it', t => {
  const f = fixture(t)
  f.onSpeechPointerDown(pointer()); f.revealSpeechBubble(pointer({ timeStamp: 150 }), 34)
  assert.equal(f.touchedSpeechBubble.value, 34)
  f.onSpeechPointerDown(pointer({ target: { closest: () => ({}) } }))
  assert.equal(f.touchedSpeechBubble.value, 34)
  f.onSpeechPointerDown(pointer({ pointerType: 'mouse' }))
  assert.equal(f.touchedSpeechBubble.value, null)
})

test('scroll, drag returning to its origin, long press, mouse and multitouch do not reveal controls', t => {
  const f = fixture(t)
  f.onSpeechPointerDown(pointer()); f.onSpeechPointerMove(pointer({ clientY: 120 }))
  f.revealSpeechBubble(pointer({ timeStamp: 150 }), 34)
  assert.equal(f.touchedSpeechBubble.value, null)
  f.onSpeechPointerDown(pointer()); f.clearSpeechBubble(); f.revealSpeechBubble(pointer({ timeStamp: 150 }), 34)
  assert.equal(f.touchedSpeechBubble.value, null)
  f.onSpeechPointerDown(pointer()); f.revealSpeechBubble(pointer({ timeStamp: 600 }), 34)
  assert.equal(f.touchedSpeechBubble.value, null)
  for (const event of [pointer({ pointerType: 'mouse' }), pointer({ isPrimary: false })]) {
    f.onSpeechPointerDown(event); f.revealSpeechBubble({ ...event, timeStamp: 150 }, 34)
    assert.equal(f.touchedSpeechBubble.value, null)
  }
})

test('changing between group and private conversations clears the selected bubble and pending gesture', async t => {
  const f = fixture(t)
  f.onSpeechPointerDown(pointer()); f.revealSpeechBubble(pointer({ timeStamp: 150 }), 34)
  f.route.value = 'group:56'; await nextTick()
  assert.equal(f.touchedSpeechBubble.value, null)
  f.onSpeechPointerDown(pointer()); f.route.value = 'private:12'; await nextTick()
  f.revealSpeechBubble(pointer({ timeStamp: 150 }), 34)
  assert.equal(f.touchedSpeechBubble.value, null)
})
