import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import * as layout from '../src/utils/relationshipLayout.js'

// 编译实际画布脚本，以无 DOM renderer 验证浏览器捕获转交的事件顺序。
const descriptor = parse(readFileSync(new URL('../src/components/RelationshipCanvas.vue', import.meta.url), 'utf8')).descriptor
const code = compileScript(descriptor, { id: 'relationship-gesture-test' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const {${names.replace(/\bas\b/g, ':')}} = Vue`)
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+relationshipLayout.js['"]/g, (_, names) => `const {${names}} = layout`)
  .replace('export default', 'return')
const Canvas = new Function('Vue', 'layout', code)(Vue, layout)

function fixture(t) {
  const originalObserver = globalThis.ResizeObserver
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  let state
  const events = []
  const renderer = Vue.createRenderer({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null,
  })
  const app = renderer.createApp({ setup() {
    state = Canvas.setup({ nodes: [{ id: 1, key: 'a' }, { id: 2, key: 'b' }], edges: [], groups: [],
      centerKey: 'a', focusKey: '', previewKey: '', searchKeys: [], searching: false },
    { expose() {}, emit: (...args) => events.push(args) })
    return () => null
  } })
  app.mount({})
  const avatar = { closest: () => ({ dataset: { nodeKey: 'a' } }) }
  const host = { setPointerCapture() { state.onLostCapture({ target: avatar, pointerId: 1 }) },
    getBoundingClientRect: () => ({ left: 0, top: 0 }) }
  state.host.value = host
  t.after(() => { app.unmount(); globalThis.ResizeObserver = originalObserver })
  const event = (pointerId, x, y, target = avatar) => ({ pointerId, clientX: x, clientY: y, target, button: 0, pointerType: 'touch' })
  const target = state.nodeMap.value.get('b')
  return { state, events, host, avatar, event, target }
}

test('触屏头像的隐式捕获转交给画布，冒泡 lostpointercapture 不取消连结拖拽', t => {
  const { state, events, event, target } = fixture(t)
  state.pointerDown(event(1, 0, 0))
  state.pointerMove(event(1, target.x, target.y))
  assert.equal(state.dragKey.value, 'a')
  assert.equal(state.dropTarget.value.key, 'b')
  state.pointerUp(event(1, target.x, target.y))
  assert.deepEqual(events, [['connect', 'a', 'b']])
  assert.equal(state.gesturing.value, false)
})

test('画布真正失去捕获或手势取消时不创建关系', t => {
  const { state, events, event, target } = fixture(t)
  for (const cancel of [() => state.onLostCapture({ target: state.host.value, pointerId: 1 }), () => state.cancelGesture()]) {
    state.pointerDown(event(1, 0, 0))
    state.pointerMove(event(1, target.x, target.y))
    cancel()
    state.pointerUp(event(1, target.x, target.y))
    assert.equal(state.dragKey.value, '')
  }
  assert.deepEqual(events, [])
})

test('第二根手指加入后改为缩放，不保留头像拖拽目标', t => {
  const { state, events, event } = fixture(t)
  state.pointerDown(event(1, 0, 0))
  state.pointerDown(event(2, 80, 0))
  state.pointerMove(event(2, 120, 0))
  assert.equal(state.dragKey.value, '')
  assert.ok(state.view.scale > 1)
  state.pointerUp(event(1, 0, 0))
  state.pointerUp(event(2, 120, 0))
  assert.deepEqual(events, [])
})
