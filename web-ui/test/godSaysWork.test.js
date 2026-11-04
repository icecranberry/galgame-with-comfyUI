import test from 'node:test'
import assert from 'node:assert/strict'
import { godMessageWork } from '../src/utils/godSaysWork.js'

test('cards stay with their creating reply between preceding and following prose, including repeated tool references', () => {
  const messages = [
    { id: 1, role: 'assistant', content: '先准备修改', tool_calls: [{ id: 'prepare' }] },
    { id: 2, role: 'tool', tool_call_id: 'prepare', content: JSON.stringify({ ok: true, value: { change_id: 'draft' } }) },
    { id: 3, role: 'assistant', content: '请在上面的卡片确认', tool_calls: [{ id: 'repeat' }] },
    { id: 4, role: 'tool', tool_call_id: 'repeat', content: JSON.stringify({ ok: true, value: { change_id: 'draft' } }) },
  ]
  const draft = { id: 'draft', status: 'pending' }
  const turn = { status: 'completed', messages, work: [draft], calls: [] }
  assert.deepEqual(godMessageWork(turn, messages[0]), [draft])
  assert.deepEqual(godMessageWork(turn, messages[2]), [])
  draft.status = 'done'
  assert.equal(godMessageWork(turn, messages[0])[0].status, 'done')
})

test('streaming ledger attaches cards before tool history arrives; old history falls back inside final prose', () => {
  const first = { id: 1, role: 'assistant', tool_calls: [{ id: 'batch' }] }
  const last = { id: 2, role: 'assistant', content: '稍后查看进度' }
  const work = { id: 'job' }
  const turn = { status: 'running', messages: [first, last], work: [work], calls: [{ id: 'run:0:batch', result: { ok: true, value: { batch_id: 'job' } } }] }
  assert.deepEqual(godMessageWork(turn, first), [work])
  assert.deepEqual(godMessageWork(turn, last), [])
  turn.calls = []
  assert.deepEqual(godMessageWork(turn, last), [])
  turn.status = 'completed'
  assert.deepEqual(godMessageWork(turn, last), [work])
})
