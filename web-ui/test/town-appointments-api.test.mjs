import test from 'node:test'
import assert from 'node:assert/strict'
import { checkPendingStorage } from './town-pending-storage-check.mjs'
import { parseTownAppointmentBeijingTime, createTownAppointmentCommand, executeTownAppointmentCommand, getTownAppointments, savePendingTownAppointment, loadPendingTownAppointment } from '../src/api/townAppointments.js'
test('pending appointment survives failed writes and clears without resurrecting stale storage', t => {
  checkPendingStorage(t, savePendingTownAppointment, loadPendingTownAppointment, createTownAppointmentCommand('accept', { candidateId: 'c', scope: { worldId: 'w', worldEpoch: 1 }, version: 1 }, Date.UTC(2026, 8, 8)))
})
test('Beijing calendar input converts explicitly to UTC and rejects invalid calendar dates', () => {
  assert.equal(parseTownAppointmentBeijingTime('2026-09-08T09:30'), Date.UTC(2026, 8, 8, 1, 30))
  assert.equal(parseTownAppointmentBeijingTime('2026-09-08T00:00'), Date.UTC(2026, 8, 7, 16))
  for (const invalid of ['2026-02-30T10:00', '2026-09-08T24:00', '', '2026-09-08T09:30Z']) assert.equal(parseTownAppointmentBeijingTime(invalid), null)
})
test('commands snapshot scope/version/time and persisted retry uses the same request', async t => {
  const dto = { candidateId: 'a/b', scope: { worldId: 'w', worldEpoch: 2 }, version: 3 }
  const command = createTownAppointmentCommand('accept', dto, Date.UTC(2026, 8, 8))
  dto.version++; dto.scope.worldEpoch++
  const storage = new Map()
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } })
  t.after(() => { if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage); else delete globalThis.sessionStorage })
  savePendingTownAppointment(command)
  const restored = loadPendingTownAppointment(); assert.deepEqual(restored, command)
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/town/appointments/candidates/a%2Fb/accept'); assert.equal(init.method, 'POST')
    bodies.push(init.body); return Response.json({ status: 'accepted' })
  })
  await executeTownAppointmentCommand(command); await executeTownAppointmentCommand(restored)
  assert.equal(bodies[0], bodies[1]); assert.equal(restored.body.worldEpoch, 2); assert.equal(restored.body.expectedVersion, 3)
  assert.deepEqual(Object.keys(restored.body).sort(), ['expectedVersion', 'idempotencyKey', 'startAt', 'worldEpoch'])
  savePendingTownAppointment(null); assert.equal(loadPendingTownAppointment(), null)
  const cancel = createTownAppointmentCommand('cancel', { ...dto, appointmentId: 'appointment' })
  assert.equal('startAt' in cancel.body, false)
})
test('network failure is uncertain; known rejection translates without exposing internals; GET never posts', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('network') })
  await assert.rejects(getTownAppointments(), error => error.uncertain === true)
  mock.mock.mockImplementation(async () => Response.json({ code: 'SCHEDULE_UNAVAILABLE', error: 'SQL secret' }, { status: 409 }))
  await assert.rejects(getTownAppointments(), error => !error.uncertain && /日程|时段/.test(error.message) && !/secret/.test(error.message))
  mock.mock.mockImplementation(async (url, init) => { assert.equal(init.method, undefined); return Response.json({ worldId: 'w', worldEpoch: 1, candidates: [], appointments: [] }) })
  assert.equal((await getTownAppointments()).worldId, 'w')
})
