import test from 'node:test'
import assert from 'node:assert/strict'
import { getTownActorActivities } from '../src/api/townActivity.js'
test('encodes actor and pagination; forwards cancellation and never posts', async t => {
  const signal = new AbortController().signal
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/town/actors/a%2Fb/activities?cursor=23&limit=10')
    assert.equal(init.signal, signal); assert.equal(init.cache, 'no-store'); assert.equal(init.method, undefined)
    return Response.json({ actorId: 'a/b', worldId: 'w', worldEpoch: 1, activities: [], experiences: [], nextCursor: null })
  })
  assert.equal((await getTownActorActivities('a/b', { cursor: 23, signal })).actorId, 'a/b')
})
test('rejects other actor, malformed response and server errors without exposing internals', async t => {
  for (const response of [Response.json({ actorId: 'b' }), Response.json({ error: 'SQL secret' }, { status: 500 }), new Response('broken')]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => response)
    await assert.rejects(getTownActorActivities('a'), /暂时无法读取/); mock.mock.restore()
  }
})
test('preserves AbortError so scoped requests can be ignored', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('aborted', 'AbortError') })
  await assert.rejects(getTownActorActivities('a'), { name: 'AbortError' })
})
