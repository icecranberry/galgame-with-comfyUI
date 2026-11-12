import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'

const descriptor = parse(readFileSync(new URL('../src/components/photoStudio/StudioPhotoDeck.vue', import.meta.url), 'utf8')).descriptor
const script = compileScript(descriptor, { id: 'studio-deck-test' })
const component = new Function(script.content.replace('export default', 'return'))()
function deck(count = 3) {
  const props = { photos: Array.from({ length: count }, (_, i) => ({ id: `photo-${i}`, output_url: `/${i}.png`, width: 900, height: 1200 })), index: 0 }
  const previews = []
  const state = component.setup(props, { expose() {}, emit: (name, value) => { if (name === 'update:index') props.index = value; else if (name === 'preview') previews.push(value) } })
  return { state, props, previews }
}

test('photo wheel wraps the current group, throttles rapid events and leaves single photos and pinch zoom alone', t => {
  t.mock.method(Date, 'now', () => 1000)
  const { state, props } = deck()
  let prevented = 0
  const event = { deltaY: 100, deltaX: 0, preventDefault() { prevented++ }, stopPropagation() {} }
  state.wheel(event)
  assert.equal(props.index, 1)
  state.wheel(event)
  assert.equal(props.index, 1)
  Date.now.mock.mockImplementation(() => 1400)
  state.wheel({ ...event, deltaY: -100 })
  assert.equal(props.index, 0)
  state.flip(-1)
  assert.equal(props.index, 2)
  assert.equal(prevented, 3)
  state.wheel({ ...event, ctrlKey: true })
  deck(1).state.wheel(event)
  assert.equal(prevented, 3)
})

test('horizontal swipes turn photos without opening the lightbox; vertical scrolling remains available', t => {
  t.mock.method(Date, 'now', () => 2000)
  const { state, props, previews } = deck()
  state.touchStart({ touches: [{ clientX: 200, clientY: 100 }] })
  state.touchEnd({ changedTouches: [{ clientX: 100, clientY: 110 }] })
  assert.equal(props.index, 1)
  state.preview(props.photos[1])
  assert.equal(previews.length, 0)
  Date.now.mock.mockImplementation(() => 2400)
  state.preview(props.photos[1])
  assert.deepEqual(previews, ['/1.png'])
  state.touchStart({ touches: [{ clientX: 100, clientY: 100 }] })
  state.touchEnd({ changedTouches: [{ clientX: 110, clientY: 200 }] })
  assert.equal(props.index, 1)
  state.touchStart({ touches: [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }] })
  state.touchEnd({ changedTouches: [{ clientX: 210, clientY: 100 }] })
  assert.equal(props.index, 1)
})
