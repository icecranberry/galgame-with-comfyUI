import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scrollHorizontalOnWheel } from '../src/utils/horizontalScroll.js'

function wheel({ left = 0, width = 300, total = 900, ...options } = {}) {
  let prevented = false
  const event = {
    currentTarget: { scrollLeft: left, clientWidth: width, scrollWidth: total },
    deltaX: 0, deltaY: 100, deltaMode: 0,
    preventDefault() { prevented = true }, ...options,
  }
  scrollHorizontalOnWheel(event)
  return [event.currentTarget.scrollLeft, prevented]
}

test('vertical wheel scrolls channels and normalizes line/page units', () => {
  assert.deepEqual(wheel(), [100, true])
  assert.deepEqual(wheel({ deltaY: 2, deltaMode: 1 }), [48, true])
  assert.deepEqual(wheel({ deltaY: 1, deltaMode: 2 }), [300, true])
  assert.deepEqual(wheel({ left: 200, deltaY: -100 }), [100, true])
})
test('trackpad uses the dominant axis without double scrolling', () => {
  assert.deepEqual(wheel({ deltaX: 120, deltaY: 15 }), [120, true])
  assert.deepEqual(wheel({ deltaX: 15, deltaY: 120 }), [120, true])
})
test('no overflow and outward scrolling at boundaries leave page scrolling available', () => {
  assert.deepEqual(wheel({ total: 300 }), [0, false])
  assert.deepEqual(wheel({ deltaY: -100 }), [0, false])
  assert.deepEqual(wheel({ left: 600 }), [600, false])
  assert.deepEqual(wheel({ left: 590 }), [600, true])
})
test('preserves browser pinch/ctrl zoom and previously handled events', () => {
  assert.deepEqual(wheel({ ctrlKey: true }), [0, false])
  assert.deepEqual(wheel({ defaultPrevented: true }), [0, false])
})
