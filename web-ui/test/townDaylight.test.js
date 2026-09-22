import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daylightHour, daylightLook } from '../src/town/renderers/sceneLook.js'

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)
const shadowLength = look => Math.hypot(look.offset.x, look.offset.z) / look.offset.y

test('light follows the sampled town clock between refreshes, through midnight and resampling', () => {
  const sampledAt = Date.parse('2026-09-22T15:59:30.500Z')
  const weather = { hour: 23, minuteOfDay: 1439, sampledAt }
  close(daylightHour(weather, sampledAt), 23 + 59 / 60 + 30.5 / 3600)
  close(daylightHour(weather, sampledAt + 60000), 30.5 / 3600)
  const refreshed = { hour: 0, minuteOfDay: 0, sampledAt: sampledAt + 60000 }
  close(daylightHour(refreshed, sampledAt + 90000), daylightHour(weather, sampledAt + 90000))
  // Kathmandu's quarter-hour offset must survive a browser in another time zone.
  close(daylightHour({ minuteOfDay: 345, sampledAt: 0 }, 30000), 5.75 + 30 / 3600)
})

test('explicit preview hours and a missing weather snapshot remain usable', () => {
  close(daylightHour({ hour: 18.5 }, 0), 18.5)
  close(daylightHour({ hour: 24 }, 0), 0)
  const now = new Date(2026, 8, 22, 10, 30, 15, 500)
  close(daylightHour(null, now.getTime()), 10.5 + 15.5 / 3600)
})

test('shadows turn across the day and lengthen at dawn/dusk without unbounded projections', () => {
  const morning = daylightLook(6), noon = daylightLook(12), evening = daylightLook(18)
  assert.ok(morning.offset.x * evening.offset.x + morning.offset.z * evening.offset.z < 0)
  assert.ok(shadowLength(morning) > shadowLength(noon) * 2)
  assert.ok(shadowLength(evening) > shadowLength(noon) * 2)
  for (let minute = 0; minute < 1440; minute++) {
    const look = daylightLook(minute / 60)
    assert.ok(look.offset.y > 0 && shadowLength(look) < 2.5)
    assert.ok(look.offset.toArray().every(Number.isFinite))
  }
  assert.ok(daylightLook(12).offset.distanceTo(daylightLook(12 + 1 / 3600).offset) > 0)
})

test('dawn, dusk and midnight have no angle, intensity, color or glow jumps in clear/overcast weather', () => {
  for (const rainy of [false, true]) for (const hour of [0, 5, 8, 17, 20, 24]) {
    const before = daylightLook(hour - 1e-5, rainy), after = daylightLook(hour + 1e-5, rainy)
    assert.ok(before.offset.distanceTo(after.offset) < .001)
    for (const field of ['sun', 'ambient', 'glow', 'daylight', 'shadowOpacity']) {
      assert.ok(Math.abs(before[field] - after[field]) < .001, `${field} jumps at ${hour}`)
    }
    for (const field of ['color', 'sky', 'fillGround', 'fog']) {
      before[field].toArray().forEach((value, i) => assert.ok(Math.abs(value - after[field].toArray()[i]) < .001))
    }
  }
})

test('weather softens shadows without changing their bearing or dimming authored daytime colors', () => {
  const clear = daylightLook(12), rain = daylightLook(12, true), night = daylightLook(0)
  assert.deepEqual(clear.offset, rain.offset)
  assert.equal(clear.daylight, 1)
  assert.equal(rain.daylight, 1)
  assert.ok(rain.shadowOpacity < clear.shadowOpacity)
  assert.ok(rain.glow > clear.glow)
  assert.ok(night.sun < clear.sun && night.ambient < clear.ambient)
})
