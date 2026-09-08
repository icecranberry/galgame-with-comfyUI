import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('ScheduleView selection ignores the previous character success/error/finally', async () => {
  // Execute the actual callback source, isolated from unrelated page startup requests.
  const source = await readFile(new URL('../src/views/ScheduleView.vue', import.meta.url), 'utf8')
  const callback = source.match(/async function onSelectChar\(id: number\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(callback)
  for (const rejectOld of [false, true]) {
    const selectedCharId = { value: null }, drawerOpen = { value: false }, detailLoading = { value: false }, detailActs = { value: [] }
    const pending = new Map()
    const store = { fetchCharacterSchedule: id => new Promise((resolve, reject) => pending.set(id, { resolve, reject })) }
    const select = new Function('store', 'selectedCharId', 'drawerOpen', 'detailLoading', 'detailActs', `let detailRequestSequence = 0; return ${callback.replace('(id: number)', '(id)')}`)(store, selectedCharId, drawerOpen, detailLoading, detailActs)
    const a = select(1), b = select(2)
    if (rejectOld) pending.get(1).reject(new Error('old failure'))
    else pending.get(1).resolve({ activities: ['old A'] })
    await a
    assert.equal(detailLoading.value, true, 'A must not stop the pending B loading state')
    pending.get(2).resolve({ activities: ['new B'] }); await b
    assert.deepEqual(detailActs.value, ['new B'])
    const c = select(3), d = select(4)
    pending.get(4).resolve({ activities: ['new D'] }); await d
    pending.get(3).resolve({ activities: ['old C'] }); await c
    assert.deepEqual(detailActs.value, ['new D'], 'late C must not replace D activities')
  }
})
