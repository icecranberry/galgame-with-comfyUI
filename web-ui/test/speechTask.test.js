import test from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechTask } from '../src/utils/speechTask.js'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const queued = { id: 'job-1', status: 'queued' }

test('cancel before creation responds still cancels the accepted backend job exactly once', async () => {
  const pending = deferred(), cancelled = [], updates = []
  const task = createSpeechTask({ request: () => pending.promise, wait: () => assert.fail('must not wait or play'),
    cancel: async job => { cancelled.push(job.id); return { ...job, status: 'cancelled' } }, onJob: job => updates.push(job.status) })
  const result = assert.rejects(task.run(), { name: 'AbortError' })
  await task.cancel(); await task.cancel()
  pending.resolve(queued)
  await result; await task.cancel()
  assert.deepEqual(cancelled, ['job-1'])
  assert.deepEqual(updates, ['queued', 'cancelled'])
})

test('closing while waiting aborts polling and cancels the current task', async () => {
  const waiting = deferred(), cancelled = []
  const task = createSpeechTask({ request: async () => queued,
    wait: (job, signal) => new Promise((resolve, reject) => {
      waiting.resolve(); signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
    }), cancel: async job => { cancelled.push(job.id) } })
  const result = assert.rejects(task.run(), { name: 'AbortError' })
  await waiting.promise; await task.cancel(); await result
  assert.deepEqual(cancelled, ['job-1'])
})

test('cached audio is never deleted on cancellation and successful jobs reach playback', async () => {
  const completed = { id: 'cached', status: 'completed', audio_url: '/test.wav' }
  const task = createSpeechTask({ request: async () => completed, wait: async job => job, cancel: () => assert.fail('cached audio must survive') })
  assert.deepEqual(await task.run(), completed)
  await task.cancel()
})

test('cancellation failure is visible and stale creation results cannot become playable', async () => {
  const pending = deferred()
  const task = createSpeechTask({ request: () => pending.promise, wait: () => assert.fail('must not play'), cancel: async () => { throw new Error('offline') } })
  const result = assert.rejects(task.run(), /offline/)
  await task.cancel(); pending.resolve(queued); await result
})
