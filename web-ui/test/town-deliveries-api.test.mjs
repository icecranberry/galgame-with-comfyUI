import test from 'node:test'
import assert from 'node:assert/strict'
import { getTownDeliveries, createTownDeliveryRetry, executeTownDeliveryRetry, savePendingTownDeliveryRetry, loadPendingTownDeliveryRetry } from '../src/api/townDeliveries.js'
import { checkPendingStorage } from './town-pending-storage-check.mjs'
test('pending delivery survives failed writes and clears without resurrecting stale storage', t => {
  checkPendingStorage(t, savePendingTownDeliveryRetry, loadPendingTownDeliveryRetry, createTownDeliveryRetry({ worldId: 'w', worldEpoch: 1 }, { eventId: 'e', consumerKey: 'town.experience', status: 'dead' }))
})
test('cursor preserves both sequence and consumer; read never posts', async t => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const query = new URL(url, 'http://fixture').searchParams
    assert.equal(query.get('cursorSeq'), '23'); assert.equal(query.get('cursorConsumer'), 'town.appointment'); assert.equal(query.get('limit'), '20')
    assert.equal(init.method, undefined); return Response.json({ worldId: 'w', worldEpoch: 1, items: [], nextCursor: null })
  })
  assert.deepEqual((await getTownDeliveries({ cursor: { seq: 23, consumerKey: 'town.appointment' } })).items, [])
})
test('retry snapshots identity and reuses exact body; only dead supported records', async t => {
  const world = { worldId: 'w', worldEpoch: 1 }, item = { eventId: 'event-secret', consumerKey: 'town.experience', status: 'dead' }
  const command = createTownDeliveryRetry(world, item); item.eventId = 'changed'; world.worldEpoch++
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { assert.equal(url, '/api/town/deliveries/retry'); bodies.push(init.body); return Response.json({ requeued: true }) })
  await executeTownDeliveryRetry(command); await executeTownDeliveryRetry(command)
  assert.equal(bodies[0], bodies[1]); assert.equal(command.body.eventId, 'event-secret'); assert.equal(command.body.worldEpoch, 1)
  for (const status of ['pending', 'processing', 'done']) assert.throws(() => createTownDeliveryRetry(world, { ...item, status }))
  assert.throws(() => createTownDeliveryRetry(world, { ...item, consumerKey: 'ledger' }))
})
test('network failure is uncertain; server rejection never exposes SQL', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline') })
  await assert.rejects(getTownDeliveries(), error => error.uncertain)
  fetch.mock.mockImplementation(async () => Response.json({ code: 'DELIVERY_ACTIVE', error: 'SELECT secret' }, { status: 409 }))
  await assert.rejects(getTownDeliveries(), error => !error.uncertain && /等待或处理中/.test(error.message) && !/SELECT/.test(error.message))
})
