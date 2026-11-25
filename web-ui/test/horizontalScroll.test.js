import test from "node:test"
import assert from "node:assert/strict"
import { scrollHorizontalOnWheel, pageOnWheel } from "../src/utils/horizontalScroll.js"

let frames = new Map()
let nextFrame = 1
let clock = 0
let reduce = false
globalThis.performance = { now: () => clock }
globalThis.matchMedia = () => ({ matches: reduce })
globalThis.requestAnimationFrame = (fn) => { const id = nextFrame++; frames.set(id, fn); return id }
globalThis.cancelAnimationFrame = (id) => { frames.delete(id) }
function step(frameMs = 16) {
  clock += frameMs
  const due = [...frames.values()]
  frames = new Map()
  due.forEach((fn) => fn(clock))
}
function flush(frameMs = 16, limit = 500) {
  let n = 0
  while (frames.size && n++ < limit) step(frameMs)
  return n
}

// A strip that behaves like the browser: scrollLeft is rounded to whole pixels and clamped to the scroll range.
function strip(scrollLeft = 0, scrollWidth = 1000) {
  let left = scrollLeft
  return {
    isConnected: true, scrollWidth, clientWidth: 200,
    get scrollLeft() { return left },
    set scrollLeft(v) { left = Math.max(0, Math.min(this.scrollWidth - this.clientWidth, Math.round(v))) },
  }
}
function wheel(target, { deltaX = 0, deltaY = 0, deltaMode = 0, ctrlKey = false } = {}) {
  const event = { currentTarget: target, deltaX, deltaY, deltaMode, ctrlKey, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true } }
  ;(target.handler || scrollHorizontalOnWheel)(event)
  return event
}

test.beforeEach(() => { frames = new Map(); reduce = false })

test("horizontal swipes are left to the browser", () => {
  const el = strip(100)
  const event = wheel(el, { deltaX: 30, deltaY: 2 })
  assert.equal(event.defaultPrevented, false)
  assert.equal(el.scrollLeft, 100)
})

test("a horizontal swipe cancels an easing mouse scroll", () => {
  const el = strip(0)
  wheel(el, { deltaY: 100 })
  step()
  const stopped = el.scrollLeft
  wheel(el, { deltaX: 20 })
  flush()
  assert.equal(el.scrollLeft, stopped)
})

test("small vertical deltas follow immediately", () => {
  const el = strip(100)
  const event = wheel(el, { deltaY: 12 })
  assert.equal(event.defaultPrevented, true)
  assert.equal(el.scrollLeft, 112)
  assert.equal(frames.size, 0)
})

test("mouse notches ease over several frames toward an accumulated target", () => {
  const el = strip(0)
  wheel(el, { deltaY: 100 })
  wheel(el, { deltaY: 100 })
  step()
  assert.ok(el.scrollLeft > 0 && el.scrollLeft < 200, `after one frame: ${el.scrollLeft}`)
  flush()
  assert.equal(el.scrollLeft, 200)
})

test("easing finishes in about the same time at a low frame rate", () => {
  const timeAt = (frameMs) => {
    const el = strip(0)
    wheel(el, { deltaY: 300 })
    const start = clock
    flush(frameMs)
    assert.equal(el.scrollLeft, 300)
    return clock - start
  }
  const fast = timeAt(16)
  const slow = timeAt(100)
  assert.ok(fast >= 200, `60fps took only ${fast}ms`)
  assert.ok(slow <= fast + 200, `${slow}ms at 10fps vs ${fast}ms at 60fps`)
})

test("easing stops when the strip shrinks below the target", () => {
  const el = strip(0)
  wheel(el, { deltaY: 700 })
  step()
  el.scrollWidth = 400
  assert.ok(flush() < 50)
  assert.equal(frames.size, 0)
  assert.equal(el.scrollLeft, 200)
})

test("easing stops when the strip is removed from the page", () => {
  const el = strip(0)
  wheel(el, { deltaY: 300 })
  step()
  el.isConnected = false
  step()
  assert.equal(frames.size, 0)
})

test("reduced motion jumps straight to the target", () => {
  reduce = true
  const el = strip(0)
  wheel(el, { deltaY: 100 })
  assert.equal(el.scrollLeft, 100)
  assert.equal(frames.size, 0)
})

test("line mode wheels are scaled to pixels", () => {
  const el = strip(0)
  wheel(el, { deltaY: 3, deltaMode: 1 })
  flush()
  assert.equal(el.scrollLeft, 72)
})

test("page scroll continues once the strip hits an edge", () => {
  assert.equal(wheel(strip(800), { deltaY: 100 }).defaultPrevented, false)
  assert.equal(wheel(strip(0), { deltaY: -100 }).defaultPrevented, false)
})

test("a strip that fits is left alone", () => {
  assert.equal(wheel(strip(0, 200), { deltaY: 100 }).defaultPrevented, false)
})

test("ctrl+wheel zoom is untouched", () => {
  const el = strip(100)
  assert.equal(wheel(el, { deltaY: 100, ctrlKey: true }).defaultPrevented, false)
  assert.equal(el.scrollLeft, 100)
})

function pager() {
  const pages = []
  const target = { handler: pageOnWheel((d) => pages.push(d)) }
  const send = (deltas, gapMs = 12, extra = {}) => deltas.forEach((deltaY) => { clock += gapMs; wheel(target, { deltaY, ...extra }) })
  return { pages, send, target }
}

test("each mouse notch pages once", () => {
  const { pages, send } = pager()
  send([100, 100, -100], 80)
  assert.deepEqual(pages, [1, 1, -1])
})

test("line mode notches page once each", () => {
  const { pages, send } = pager()
  send([3, 3], 80, { deltaMode: 1 })
  assert.deepEqual(pages, [1, 1])
})

test("a fast touchpad flick with large samples pages once", () => {
  const { pages, send } = pager()
  send([30, 55, 90, 120, 90, 55, 30, ...Array(30).fill(6)])
  assert.deepEqual(pages, [1])
})

test("a touchpad swipe with its momentum tail pages exactly once", () => {
  const { pages, send } = pager()
  send([...Array(60).fill(8), ...Array.from({ length: 40 }, (_, i) => 8 * (1 - i / 40))])
  assert.deepEqual(pages, [1])
})

test("a second swipe after a pause pages again", () => {
  const { pages, send } = pager()
  send(Array(30).fill(8))
  clock += 400
  send(Array(30).fill(-8))
  assert.deepEqual(pages, [1, -1])
})

test("a large sample at the start of a swipe still gives one page", () => {
  const { pages, send } = pager()
  send([55, 55, ...Array(10).fill(12)])
  assert.deepEqual(pages, [1])
})

test("a short nudge does not page", () => {
  const { pages, send } = pager()
  send(Array(8).fill(12))
  assert.deepEqual(pages, [])
})

test("the pager leaves sideways swipes and ctrl+wheel alone", () => {
  const { pages, target } = pager()
  assert.equal(wheel(target, { deltaX: 30 }).defaultPrevented, false)
  assert.equal(wheel(target, { deltaY: 100, ctrlKey: true }).defaultPrevented, false)
  assert.deepEqual(pages, [])
})
