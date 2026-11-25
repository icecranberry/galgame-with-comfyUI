import test from "node:test"
import assert from "node:assert/strict"
import { scrollHorizontalOnWheel } from "../src/utils/horizontalScroll.js"

let frames = []
globalThis.requestAnimationFrame = (fn) => frames.push(fn)
globalThis.cancelAnimationFrame = () => { frames = [] }
function flush() { while (frames.length) frames.shift()() }

function strip(scrollLeft = 0) {
  return { scrollLeft, scrollWidth: 1000, clientWidth: 200 }
}
function wheel(element, { deltaX = 0, deltaY = 0, deltaMode = 0, ctrlKey = false } = {}) {
  const event = { currentTarget: element, deltaX, deltaY, deltaMode, ctrlKey, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true } }
  scrollHorizontalOnWheel(event)
  return event
}

test("horizontal swipes are left to the browser", () => {
  const el = strip(100)
  const event = wheel(el, { deltaX: 30, deltaY: 2 })
  assert.equal(event.defaultPrevented, false)
  assert.equal(el.scrollLeft, 100)
})

test("small vertical deltas follow immediately", () => {
  const el = strip(100)
  const event = wheel(el, { deltaY: 12 })
  assert.equal(event.defaultPrevented, true)
  assert.equal(el.scrollLeft, 112)
  assert.equal(frames.length, 0)
})

test("mouse notches ease toward an accumulated target", () => {
  const el = strip(0)
  wheel(el, { deltaY: 100 })
  wheel(el, { deltaY: 100 })
  assert.ok(el.scrollLeft < 200)
  flush()
  assert.equal(el.scrollLeft, 200)
})

test("line mode wheels are scaled and eased", () => {
  const el = strip(0)
  wheel(el, { deltaY: 3, deltaMode: 1 })
  flush()
  assert.equal(el.scrollLeft, 72)
})

test("page scroll continues once the strip hits an edge", () => {
  const el = strip(800)
  const event = wheel(el, { deltaY: 100 })
  assert.equal(event.defaultPrevented, false)
  assert.equal(wheel(strip(0), { deltaY: -100 }).defaultPrevented, false)
})

test("ctrl+wheel zoom is untouched", () => {
  const el = strip(100)
  assert.equal(wheel(el, { deltaY: 100, ctrlKey: true }).defaultPrevented, false)
  assert.equal(el.scrollLeft, 100)
})
