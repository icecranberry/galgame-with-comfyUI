import test from 'node:test'
import assert from 'node:assert/strict'
import { ref, effectScope } from 'vue'
import { useGodThinking } from '../src/composables/useGodThinking.js'

function fixture(t) {
  const snapshot = ref({ session: { id: 1 }, runs: [{ id: 'old', status: 'completed' }] })
  const scope = effectScope()
  const thinking = scope.run(() => useGodThinking(() => snapshot.value))
  t.after(() => scope.stop())
  const message = (run, id = run) => ({ id, run_id: run, reasoning: '服务商返回的思考', content: '', status: 'streaming' })
  return { snapshot, thinking, message }
}

test('current turn remains expanded through body streaming, tool continuations and completion', t => {
  const { snapshot, thinking, message } = fixture(t)
  thinking.activateThinking()
  snapshot.value.runs.push({ id: 'current', status: 'running' })
  const first = message('current', 1)
  assert.equal(thinking.thinkingVisible(first), true)
  first.content = '开始回复'; first.status = 'done'
  assert.equal(thinking.thinkingVisible(first), true)
  assert.equal(thinking.thinkingVisible(message('current', 2)), true)
  snapshot.value.runs[1].status = 'completed'
  assert.equal(thinking.thinkingVisible(first), true)
  assert.equal(thinking.thinkingVisible(message('old')), false)
})

test('next accepted turn folds previous thinking and manual expansions without folding when no new run is created', t => {
  const { snapshot, thinking, message } = fixture(t)
  thinking.activateThinking()
  snapshot.value.runs.push({ id: 'first' })
  thinking.toggleThinking(message('old'))
  snapshot.value = { ...snapshot.value, runs: [...snapshot.value.runs] }
  assert.equal(thinking.thinkingVisible(message('first')), true)
  assert.equal(thinking.thinkingVisible(message('old')), true)
  snapshot.value.runs.push({ id: 'next' })
  assert.equal(thinking.thinkingVisible(message('first')), false)
  assert.equal(thinking.thinkingVisible(message('old')), false)
  assert.equal(thinking.thinkingVisible(message('next')), true)
})

test('manual collapse survives streaming snapshots; leaving and returning starts with all existing thinking folded', t => {
  const { snapshot, thinking, message } = fixture(t)
  thinking.activateThinking()
  snapshot.value.runs.push({ id: 'current' })
  const current = message('current')
  thinking.toggleThinking(current)
  snapshot.value = { ...snapshot.value, runs: [...snapshot.value.runs] }
  assert.equal(thinking.thinkingVisible(current), false)
  thinking.toggleThinking(current)
  assert.equal(thinking.thinkingVisible(current), true)
  thinking.leaveThinking()
  thinking.activateThinking()
  assert.equal(thinking.thinkingVisible(current), false)
  assert.equal(thinking.thinkingVisible(message('old')), false)
})

test('initial replay of an active turn and switching dates never automatically expands old thinking', t => {
  const { snapshot, thinking, message } = fixture(t)
  snapshot.value.runs.push({ id: 'already-running', status: 'running' })
  thinking.activateThinking()
  assert.equal(thinking.thinkingVisible(message('already-running')), false)
  snapshot.value.runs.push({ id: 'new' })
  assert.equal(thinking.thinkingVisible(message('new')), true)
  snapshot.value = { session: { id: 2 }, runs: [{ id: 'archive' }] }
  assert.equal(thinking.thinkingVisible(message('archive')), false)
  snapshot.value.runs.push({ id: 'later' })
  assert.equal(thinking.thinkingVisible(message('later')), true)
})

test('accepted midnight message expands its turn even when sending changes the daily session', t => {
  const { snapshot, thinking, message } = fixture(t)
  thinking.activateThinking()
  snapshot.value = { session: { id: 2 }, runs: [{ id: 'midnight' }] }
  assert.equal(thinking.thinkingVisible(message('midnight')), false)
  thinking.acceptThinking('midnight')
  assert.equal(thinking.thinkingVisible(message('midnight')), true)
  thinking.toggleThinking(message('midnight'))
  thinking.acceptThinking('midnight')
  assert.equal(thinking.thinkingVisible(message('midnight')), false, 'the same receipt must not undo a manual collapse')
  thinking.leaveThinking()
  thinking.acceptThinking('midnight')
  assert.equal(thinking.thinkingVisible(message('midnight')), false)
})
