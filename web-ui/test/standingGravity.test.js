import test from 'node:test'
import assert from 'node:assert/strict'
import { gravityOffset } from '../src/utils/standingGravity.js'

const baseline = { beta: 60, gamma: 0 }
test('gravity calibrates to the held pose and ignores tiny hand tremors', () => {
  const result = gravityOffset({ beta: 60.3, gamma: 0.2 }, baseline)
  assert.ok(Math.abs(result.x) === 0 && Math.abs(result.y) === 0)
})
test('gravity is bounded even during large tilts', () => {
  assert.deepEqual(gravityOffset({ beta: 130, gamma: 70 }, baseline), { x: -12, y: -6 })
})
test('landscape rotates the axes in both orientations', () => {
  const right = gravityOffset({ beta: 75, gamma: 0 }, baseline, 90)
  const left = gravityOffset({ beta: 75, gamma: 0 }, baseline, 270)
  assert.equal(right.x, -12)
  assert.equal(left.x, 12)
  assert.ok(Math.abs(right.y) === 0 && Math.abs(left.y) === 0)
})
test('crossing the angle boundary does not cause a maximum displacement', () => {
  const result = gravityOffset({ beta: -179, gamma: 0 }, { beta: 179, gamma: 0 })
  assert.ok(Math.abs(result.y) < 1)
})
