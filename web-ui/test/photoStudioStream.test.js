import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope } from 'vue'
import { usePhotoStudio } from '../src/composables/usePhotoStudio.js'

const pending = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const running = { id: 'shot-1', status: 'running', stage: 'generating', progress: 0.3 }
const done = { ...running, status: 'done', stage: 'done', progress: 1, output_url: '/images/photo_studio/shot-1.png' }

function fixture(t, overrides = {}) {
  const handlers = new Map()
  const apiClient = {
    getPhotoStudioCatalog: async () => ({ poses: [] }),
    getPhotoStudioCharacters: async () => ({ characters: [] }),
    getPhotoStudioCapability: async () => ({ available: true }),
    getPhotoStudioJobs: async () => ({ jobs: [] }),
    ...overrides,
  }
  const scope = effectScope()
  const state = scope.run(() => usePhotoStudio({ apiClient, subscribe: (event, handler) => {
    handlers.set(event, handler)
    return () => handlers.delete(event)
  } }))
  t.after(() => scope.stop())
  return { state, handlers, scope, send: (event, job) => handlers.get(event)?.({ job }) }
}

test('SSE updates progress, completion and errors without a status request', t => {
  const f = fixture(t)
  f.send('photo_studio_progress', running)
  assert.equal(f.state.jobs.value[0].progress, 0.3)
  f.send('photo_studio_ready', done)
  assert.equal(f.state.jobs.value[0].output_url, done.output_url)
  f.send('photo_studio_progress', running)
  assert.equal(f.state.jobs.value[0].status, 'done')
  f.send('photo_studio_ready', { id: 'shot-2', status: 'failed', error: 'offline' })
  assert.equal(f.state.jobs.value[0].error, 'offline')
})

test('completion before the POST response cannot be rolled back by that response', async t => {
  const post = pending()
  const f = fixture(t, { createPhotoStudioJob: () => post.promise })
  const created = f.state.create({ id: running.id })
  f.send('photo_studio_ready', done)
  post.resolve({ job: running })
  assert.equal((await created).status, 'done')
  assert.equal(f.state.jobs.value[0].status, 'done')
})

test('a completed job cannot become running again after a list refresh has removed it', async t => {
  let snapshot = [done]
  const f = fixture(t, { getPhotoStudioJobs: async () => ({ jobs: snapshot }), createPhotoStudioJob: async () => ({ job: running }) })
  f.send('photo_studio_ready', done)
  snapshot = []
  await f.state.poll()
  assert.equal(f.state.jobs.value.length, 0)
  f.send('photo_studio_progress', running)
  assert.equal(f.state.jobs.value.length, 0, 'late progress must not revive a completed task or its completion effects')
  assert.equal((await f.state.create({ id: running.id })).status, 'done')
  assert.equal(f.state.jobs.value.length, 0)
  snapshot = [running]
  await f.state.poll()
  assert.deepEqual(f.state.jobs.value, [done], 'a stale history response must restore the known terminal state, not an empty row')
})

test('an older poll cannot overwrite newer SSE progress or completion', async t => {
  const poll = pending()
  const f = fixture(t, { getPhotoStudioJob: () => poll.promise })
  f.send('photo_studio_progress', running)
  const checked = f.state.poll()
  f.send('photo_studio_progress', { ...running, progress: 0.8 })
  poll.resolve({ job: running })
  await checked
  assert.equal(f.state.jobs.value[0].progress, 0.8)
})

test('initial history keeps a live completion first and does not wait for slow catalog loading', async t => {
  const list = pending(), catalog = pending()
  const f = fixture(t, { getPhotoStudioJobs: () => list.promise, getPhotoStudioCatalog: () => catalog.promise })
  const loaded = f.state.load()
  f.send('photo_studio_ready', done)
  list.resolve({ jobs: Array.from({ length: 30 }, (_, i) => ({ ...done, id: `old-${i}` })) })
  await list.promise
  assert.equal(f.state.jobs.value.length, 30)
  assert.equal(f.state.jobs.value[0].id, done.id)
  assert.equal(f.state.jobs.value[1].id, 'old-0')
  catalog.resolve({ poses: [] })
  await loaded
})

test('reconnect fetches missed jobs; disposal removes subscriptions and ignores in-flight responses', async t => {
  const response = pending()
  let requests = 0
  const f = fixture(t, { getPhotoStudioJobs: () => { requests++; return response.promise } })
  f.send('connected')
  assert.equal(requests, 1)
  response.resolve({ jobs: [done] })
  await response.promise
  assert.equal(f.state.jobs.value[0].status, 'done')
  const g = fixture(t, { getPhotoStudioJobs: () => response.promise })
  const loaded = g.state.load()
  g.scope.stop()
  await loaded
  assert.equal(g.handlers.size, 0)
  assert.equal(g.state.jobs.value.length, 0)
})
