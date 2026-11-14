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
  const originalRaf = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame
  const frames = new Map(); let nextFrame = 0
  globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame }
  globalThis.cancelAnimationFrame = id => frames.delete(id)
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  let state
  const events = []
  const renderer = Vue.createRenderer({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null,
  })
  const app = renderer.createApp({ setup() {
    state = Canvas.setup(Vue.reactive({ nodes: [{ id: 1, key: 'a' }, { id: 2, key: 'b' }, { id: 3, key: 'c' }], edges: [], groups: [],
      centerKey: 'a', focusKey: '', previewKey: '', searchKeys: [], searching: false }),
    { expose() {}, emit: (...args) => events.push(args) })
    return () => null
  } })
  app.mount({})
  const avatar = { closest: () => ({ dataset: { nodeKey: 'a' } }) }
  const host = { setPointerCapture() { state.onLostCapture({ target: avatar, pointerId: 1 }) },
    getBoundingClientRect: () => ({ left: 0, top: 0 }) }
  state.host.value = host
  t.after(() => { app.unmount(); globalThis.ResizeObserver = originalObserver; globalThis.requestAnimationFrame = originalRaf; globalThis.cancelAnimationFrame = originalCancel })
  const event = (pointerId, x, y, target = avatar) => ({ pointerId, clientX: x, clientY: y, target, button: 0, pointerType: 'touch' })
  const target = state.nodeMap.value.get('b')
  return { state, events, host, avatar, event, target, frames }
}

test('触屏头像的隐式捕获转交给画布，冒泡 lostpointercapture 不取消连结拖拽', t => {
  const { state, events, event, target } = fixture(t)
  state.pointerDown(event(1, 0, 0))
  state.pointerMove(event(1, target.x, target.y))
  assert.equal(state.dragKey.value, 'a')
  state.flushFrame()
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
  state.flushFrame()
  assert.ok(state.view.scale > 1)
  state.pointerUp(event(1, 0, 0))
  state.pointerUp(event(2, 120, 0))
  assert.deepEqual(events, [])
})

test('高频拖动合并为一帧，松开前自动应用最后位置', t => {
  const { state, events, event, target, frames } = fixture(t)
  state.pointerDown(event(1, 0, 0))
  for (let i = 1; i <= 100; i++) state.pointerMove(event(1, target.x * i / 100, target.y * i / 100))
  assert.equal(frames.size, 1)
  assert.equal(state.dragOffset.x, 0)
  state.pointerUp(event(1, target.x, target.y))
  assert.deepEqual(events, [['connect', 'a', 'b']])
  assert.equal(frames.size, 0)
})

test('取消未提交的缩放后不残留下一帧修改', t => {
  const { state, frames } = fixture(t)
  state.zoom(1.5)
  assert.equal(frames.size, 1)
  state.cancelGesture()
  assert.equal(frames.size, 0)
  assert.equal(state.view.scale, 1)
})

test('拖动节点复用不相关连线的几何，平移不重算任何连线', t => {
  const { state, event } = fixture(t)
  state.props.edges.push({ key: 'ab', source: 'a', target: 'b' }, { key: 'bc', source: 'b', target: 'c' })
  state.enterHover('a')
  const initial = new Map(state.drawnEdges.value.map(edge => [edge.key, edge]))
  state.pointerDown(event(1, 0, 0))
  state.pointerMove(event(1, 10, 0))
  state.flushFrame()
  const dragged = new Map(state.drawnEdges.value.map(edge => [edge.key, edge]))
  assert.notEqual(dragged.get('ab'), initial.get('ab'))
  assert.equal(dragged.get('bc'), initial.get('bc'))
  const beforePan = state.drawnEdges.value
  state.view.x += 100; state.view.y += 50
  assert.equal(state.drawnEdges.value, beforePan)
})

test('名册选中持续高亮，头像/连线/名册悬停与清除预览均不会覆盖', async t => {
  const { state } = fixture(t)
  const ab = { key: 'ab', source: 'a', target: 'b', relationship_text: '朋友' }
  const bc = { key: 'bc', source: 'b', target: 'c', relationship_text: '邻居' }
  state.props.edges.push(ab, bc)
  state.props.focusKey = 'a'
  const assertPinned = () => {
    assert.equal(state.activeKey.value, 'a')
    assert.equal(state.isRelated(ab), true)
    assert.equal(state.isRelated(bc), false)
  }
  assertPinned()
  state.enterHover('c')
  assert.equal(state.peekKey.value, 'c')
  assertPinned()
  state.enterEdge(bc)
  assert.deepEqual(state.peekEdges.value[0], bc)
  assertPinned()
  state.props.previewKey = 'b'
  await Vue.nextTick()
  assertPinned()
  state.props.previewKey = ''
  await Vue.nextTick()
  state.clearHover()
  assert.equal(state.peekKey.value, 'a')
  assertPinned()
  state.props.focusKey = ''
  state.enterHover('c')
  assert.equal(state.activeKey.value, 'c')
  state.clearHover()
  assert.equal(state.activeKey.value, '')
})

test('平移、缩放和拖动其他头像保持名册的选中范围', t => {
  const { state, event } = fixture(t)
  state.props.focusKey = 'b'
  state.pointerDown(event(1, 0, 0))
  state.pointerMove(event(1, 20, 20))
  state.flushFrame()
  assert.equal(state.dragKey.value, 'a')
  assert.equal(state.activeKey.value, 'b')
  state.cancelGesture()
  state.zoom(1.5)
  state.flushFrame()
  state.view.x += 100
  assert.equal(state.activeKey.value, 'b')
})
