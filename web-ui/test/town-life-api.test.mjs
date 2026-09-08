import test from 'node:test'
import assert from 'node:assert/strict'
import { createTownLifeCommand, executeTownLifeCommand, getTownEconomy, getPendingTownLifeCommand, savePendingTownLifeCommand } from '../src/api/townLife.js'

test('workshop turn and delivery retain separate pending requests', () => {
  const delivery = createTownLifeCommand('publish', { worldId: 'w', worldEpoch: 1 })
  const turn = createTownLifeCommand('service_turn', { worldId: 'w', worldEpoch: 1, sessionId: 's', expectedVersion: 4, intentKey: 'clarify', text: '雨后主题' })
  assert.equal(turn.path, '/services/s/turn'); assert.equal(turn.body.text, '雨后主题')
  assert.equal(turn.body.intentKey, 'clarify'); assert.equal(turn.body.expectedVersion, 4)
  savePendingTownLifeCommand(delivery); savePendingTownLifeCommand(turn, 'workshop')
  assert.equal(getPendingTownLifeCommand().kind, 'publish')
  assert.equal(getPendingTownLifeCommand('workshop').body.idempotencyKey, turn.body.idempotencyKey)
  savePendingTownLifeCommand(null, 'workshop'); assert.equal(getPendingTownLifeCommand().kind, 'publish')
  savePendingTownLifeCommand(null)
  assert.throws(() => createTownLifeCommand('service_turn', { worldId: 'w', worldEpoch: 1, sessionId: 's', expectedVersion: 4, intentKey: 'grant_item' }))
})

test('life commands snapshot version/epoch and retry identical payload without player identity', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init }); return new Response('{"ok":true}', { status: 200 }) })
  const setup = { worldId: 'world', worldEpoch: 2, npcActorIds: { commissioner: 'a', supplier: 'b', workshop: 'c' },
    locationKeys: { board: 'board', supplier: 'supplier', workshop: 'workshop' } }
  const command = createTownLifeCommand('setup', setup)
  setup.npcActorIds.supplier = 'changed'
  assert.equal(command.body.npcActorIds.supplier, 'b')
  const delivery = createTownLifeCommand('complete', { worldId: 'world', worldEpoch: 2, orderId: 'order/a', expectedVersion: 3, actorId: 'spoof' })
  assert.equal(delivery.path, '/orders/order%2Fa/complete')
  await executeTownLifeCommand(delivery); await executeTownLifeCommand(delivery)
  assert.equal(calls[0].init.body, calls[1].init.body)
  assert.deepEqual(Object.keys(delivery.body).sort(), ['expectedVersion', 'idempotencyKey', 'worldEpoch'])
  assert.throws(() => createTownLifeCommand('pay', setup))
  assert.throws(() => createTownLifeCommand('pickup', { ...setup, orderId: 'o' }))
})

test('failure does not resend; reads use GET and carry no command payload', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('lost ack') })
  const command = createTownLifeCommand('publish', { worldId: 'world', worldEpoch: 2 })
  await assert.rejects(executeTownLifeCommand(command), e => e.uncertain === true)
  assert.equal(calls, 1)
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/town/economy'); assert.equal(init.method, undefined); assert.equal(init.body, undefined)
    return new Response('{"enabled":true}', { status: 200 })
  })
  assert.deepEqual(await getTownEconomy(), { enabled: true })
})

test('server rejection is distinguished from uncertain completion and pending survives reopening', async t => {
  const command = createTownLifeCommand('accept', { worldId: 'world', worldEpoch: 2, orderId: 'o', expectedVersion: 1 })
  t.mock.method(globalThis, 'fetch', async () => new Response('{"code":"NOT_ARRIVED","error":"请先到达"}', { status: 409 }))
  await assert.rejects(executeTownLifeCommand(command), e => e.code === 'NOT_ARRIVED' && e.uncertain === false)
  savePendingTownLifeCommand(command)
  assert.equal(getPendingTownLifeCommand().body.idempotencyKey, command.body.idempotencyKey)
  savePendingTownLifeCommand(null)
  assert.equal(getPendingTownLifeCommand(), null)
})


test('fixed bob offer retains its key on retry while legacy offers keep their original body', async t => {
  const scope = { worldId: 'w', worldEpoch: 2 }
  for (const serviceKey of [undefined, 'town.workshop']) {
    const command = createTownLifeCommand('service_offer', { ...scope, serviceKey })
    assert.deepEqual(Object.keys(command.body).sort(), ['idempotencyKey', 'worldEpoch'])
  }
  const command = createTownLifeCommand('service_offer', { ...scope, serviceKey: 'town.workshop.bob_cut' })
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { bodies.push(init.body); return new Response('{}') })
  savePendingTownLifeCommand(command, 'workshop')
  await executeTownLifeCommand(command)
  await executeTownLifeCommand(getPendingTownLifeCommand('workshop'))
  assert.equal(bodies[0], bodies[1])
  assert.equal(JSON.parse(bodies[0]).serviceKey, 'town.workshop.bob_cut')
  const accept = createTownLifeCommand('service_accept', { ...scope, sessionId: 'frozen', expectedVersion: 1, serviceKey: 'town.workshop.bob_cut' })
  assert.equal('serviceKey' in accept.body, false)
  assert.throws(() => createTownLifeCommand('service_offer', { ...scope, serviceKey: 'town.workshop.bob_cut@1' }))
  savePendingTownLifeCommand(null, 'workshop')
})
