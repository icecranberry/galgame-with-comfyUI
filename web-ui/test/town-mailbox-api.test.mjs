import test from 'node:test'
import assert from 'node:assert/strict'
import { getTownMailboxTasks } from '../src/api/townMailboxTasks.js'

test('task cards are a no-store GET with default limit and no command payload', async t => {
  const data = { worldId: 'world', worldEpoch: 2, items: [{ orderId: 'order', status: 'open', reward: 30 }], nextCursor: 'next' }
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++
    assert.equal(url, '/api/town/mailbox-tasks?limit=10')
    assert.equal(init.method ?? 'GET', 'GET'); assert.equal(init.body, undefined)
    assert.equal(init.cache, 'no-store'); assert.equal(init.signal, undefined)
    return new Response(JSON.stringify(data), { status: 200 })
  })
  assert.deepEqual(await getTownMailboxTasks(), data); assert.equal(calls, 1)
})

test('cursor and limit are query encoded without injecting additional command parameters', async t => {
  const cursor = { createdAt: 1788832800000, orderId: 'next /?&limit=999+中文#' }, signal = new AbortController().signal
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++
    const parsed = new URL(url, 'http://fixture.invalid')
    assert.equal(parsed.pathname, '/api/town/mailbox-tasks')
    assert.equal(parsed.searchParams.getAll('cursor').length, 1)
    assert.deepEqual(JSON.parse(parsed.searchParams.get('cursor')), cursor); assert.equal(parsed.searchParams.get('limit'), '25')
    assert.deepEqual([...parsed.searchParams.keys()].sort(), ['cursor', 'limit'])
    assert.equal(init.method ?? 'GET', 'GET'); assert.equal(init.body, undefined); assert.equal(init.signal, signal)
    return new Response('{"items":[]}', { status: 200 })
  })
  assert.deepEqual(await getTownMailboxTasks({ cursor, limit: 25, signal, actorId: 'spoof', command: 'accept' }), { items: [] })
  assert.equal(calls, 1)
})

test('null cursor is omitted while object cursor with zero createdAt is preserved', async t => {
  const urls = []
  t.mock.method(globalThis, 'fetch', async url => { urls.push(url); return new Response('{"items":[]}') })
  const cursor = { createdAt: 0, orderId: 'first-order' }
  await getTownMailboxTasks({ cursor: null }); await getTownMailboxTasks({ cursor, limit: 1 })
  assert.equal(new URL(urls[0], 'http://fixture.invalid').searchParams.has('cursor'), false)
  assert.deepEqual(JSON.parse(new URL(urls[1], 'http://fixture.invalid').searchParams.get('cursor')), cursor)
  assert.equal(new URL(urls[1], 'http://fixture.invalid').searchParams.get('limit'), '1')
})

test('in-flight and already-aborted requests propagate cancellation without retry', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => {
    calls++
    return new Promise((_resolve, reject) => {
      const abort = () => reject(signal.reason)
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    })
  })
  const controller = new AbortController(), pending = getTownMailboxTasks({ signal: controller.signal })
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(calls, 1)
  await assert.rejects(getTownMailboxTasks({ signal: controller.signal }), { name: 'AbortError' }); assert.equal(calls, 2)
})

test('abort during JSON body reading remains an AbortError and is not retried', async t => {
  let calls = 0, rejectBody
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return { ok: true, json: () => new Promise((_resolve, reject) => { rejectBody = reject }) }
  })
  const pending = getTownMailboxTasks(); await Promise.resolve()
  const error = new DOMException('body aborted', 'AbortError'); rejectBody(error)
  await assert.rejects(pending, e => e === error); assert.equal(calls, 1)
})

test('HTTP errors, server errors and malformed task envelopes reject once without automatic retry', async t => {
  for (const [status, data] of [[503, { items: [] }], [409, { code: 'STALE_EPOCH', items: [] }],
    [200, { error: 'server failure', items: [] }], [200, {}], [200, null], [200, { items: null }], [200, { items: {} }]]) {
    let calls = 0
    const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify(data), { status }) })
    try {
      await assert.rejects(getTownMailboxTasks(), /小镇委托暂时无法读取/)
      assert.equal(calls, 1)
    } finally { mock.mock.restore() }
  }
})

test('invalid JSON and transport failure do not automatically resend a read', async t => {
  let calls = 0
  const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{bad json') })
  await assert.rejects(getTownMailboxTasks(), SyntaxError); assert.equal(calls, 1); mock.mock.restore()
  const failure = new TypeError('offline')
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw failure })
  await assert.rejects(getTownMailboxTasks(), e => e === failure); assert.equal(calls, 2)
})
