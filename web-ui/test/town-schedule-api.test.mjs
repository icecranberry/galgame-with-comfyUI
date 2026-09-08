import test from 'node:test'
import assert from 'node:assert/strict'
import { getTownScheduleOverlays, formatTownScheduleTime } from '../src/api/townSchedule.js'
test('overlay is a separate GET with cancellation and no base-schedule call', async t => {
  const signal = new AbortController().signal
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/schedule/7/overlays?limit=20'); assert.equal(init.method, undefined); assert.equal(init.signal, signal)
    return Response.json({ worldId: 'w', worldEpoch: 2, characterId: 7, timeZone: 'Asia/Shanghai', appointments: [] })
  })
  assert.equal((await getTownScheduleOverlays(7, { signal })).worldEpoch, 2)
  await assert.rejects(getTownScheduleOverlays(7, { limit: 21 }), /数量无效/)
})
test('rejects other character and unsuccessful response', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ characterId: 8, timeZone: 'Asia/Shanghai', appointments: [] }))
  await assert.rejects(getTownScheduleOverlays(7), /暂时无法读取/)
  mock.mock.mockImplementation(async () => Response.json({ error: 'private' }, { status: 503 }))
  await assert.rejects(getTownScheduleOverlays(7), /暂时无法读取/)
})
test('formats UTC with response timeZone rather than the browser zone', () => {
  const instant = Date.UTC(2026, 8, 8, 1, 30)
  assert.match(formatTownScheduleTime(instant, 'Asia/Shanghai'), /09:30/)
  assert.match(formatTownScheduleTime(instant, 'UTC'), /01:30/)
  assert.equal(formatTownScheduleTime(instant, 'invalid-zone'), '时间待确认')
})
