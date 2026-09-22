import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useGroupsStore } from '../src/stores/groups.js'

test('冷场额度同一天保留、跨天重置，重新进入页面不会补发额度', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 22, 23, 59).getTime() })
  setActivePinia(createPinia())
  const store = useGroupsStore()
  store.lullCount = 2
  store.resetLullOnNewDay()
  assert.equal(store.lullCount, 2)
  assert.equal(useGroupsStore().lullCount, 2)
  t.mock.timers.tick(120_000)
  store.resetLullOnNewDay()
  assert.equal(store.lullCount, 0)
  store.lullCount = 1
  store.resetLullOnNewDay()
  assert.equal(store.lullCount, 1)
})
