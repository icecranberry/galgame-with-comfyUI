import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createResidentCarry, CARRY_PRESS_MS } from '../src/town/residentCarry.js'

const agent = { actorId: 'actor-test', agentKey: 'npc:1' }
const point = (x = 50, y = 50, pointerId = 1) => ({ x, y, pointerId })
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function fixture(t, request) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const calls = [], errors = [], results = []
  let state
  const controller = createResidentCarry({
    request: async (actorId, body) => {
      calls.push({ actorId, ...body })
      return request ? request(body) : { ok: true, position: { x: 2, y: 3 } }
    },
    scope: () => ({ mapId: 7, worldId: 'world', worldEpoch: 2 }),
    dropCell: () => ({ x: 4, y: 5 }), changed: s => { state = s },
    token: () => 'gesture-0000000001', error: e => errors.push(e), settled: r => results.push(r),
  })
  t.after(() => { controller.abort(); t.mock.timers.reset() })
  return { controller, calls, errors, results, state: () => state }
}
test('short click and early pan never send a pickup request', async t => {
  const f = fixture(t)
  f.controller.down(point(), agent)
  assert.equal(f.controller.up(point()), false)
  t.mock.timers.tick(500); await flush(); assert.equal(f.calls.length, 0)
  f.controller.down(point(), agent)
  assert.equal(f.controller.move(point(60)), false)
  t.mock.timers.tick(500); await flush(); assert.equal(f.calls.length, 0)
})
test('touch long press tolerates finger jitter within the wider slop', async t => {
  const f = fixture(t)
  f.controller.down(point(), agent, 'touch')
  assert.equal(f.controller.move(point(59)), false)
  t.mock.timers.tick(CARRY_PRESS_MS); await flush()
  assert.equal(f.state().phase, 'held')
})
test('mouse keeps the tight slop: 10px of movement kills the long press', async t => {
  const f = fixture(t)
  f.controller.down(point(), agent, 'mouse')
  assert.equal(f.controller.move(point(60)), false)
  t.mock.timers.tick(500); await flush(); assert.equal(f.calls.length, 0)
})
test('long press owns only its pointer, renews a lease and drops exactly once with captured scope', async t => {
  const f = fixture(t)
  f.controller.down(point(), agent)
  t.mock.timers.tick(CARRY_PRESS_MS); await flush()
  assert.equal(f.state().phase, 'held')
  assert.equal(f.controller.move(point(100, 100, 2)), false)
  assert.deepEqual(f.state().point, { x: 50, y: 50 })
  t.mock.timers.tick(5000); await flush()
  assert.equal(f.calls[1].operation, 'renew')
  assert.equal(f.controller.up(point(100)), true)
  f.controller.up(point(100)); await flush()
  assert.equal(f.calls.filter(c => c.operation === 'drop').length, 1)
  assert.deepEqual(f.calls.at(-1), { actorId: 'actor-test', mapId: 7, worldId: 'world', worldEpoch: 2,
    token: 'gesture-0000000001', operation: 'drop', x: 4, y: 5 })
  t.mock.timers.tick(300); assert.equal(f.state(), null)
})
test('release or map switch while pickup is in flight cancels the eventual lease', async t => {
  let resolve
  const f = fixture(t, body => body.operation === 'begin'
    ? new Promise(r => { resolve = r }) : { ok: true })
  f.controller.down(point(), agent)
  t.mock.timers.tick(CARRY_PRESS_MS); await flush()
  assert.equal(f.state().phase, 'starting')
  assert.equal(f.controller.up(point()), true)
  resolve({ ok: true, position: { x: 2, y: 3 } }); await flush()
  assert.equal(f.calls.at(-1).operation, 'cancel')
  assert.equal(f.state(), null)
  assert.equal(f.calls.some(c => c.operation === 'drop'), false)
})
test('lost connection during renewal cancels and clears timers', async t => {
  const f = fixture(t, body => {
    if (body.operation === 'renew') throw Error('disconnected')
    return { ok: true, position: { x: 2, y: 3 } }
  })
  f.controller.down(point(), agent)
  t.mock.timers.tick(CARRY_PRESS_MS); await flush()
  t.mock.timers.tick(5000); await flush()
  assert.equal(f.state(), null)
  assert.equal(f.errors.length, 1)
  const count = f.calls.length
  t.mock.timers.tick(20000); await flush(); assert.equal(f.calls.length, count)
})
