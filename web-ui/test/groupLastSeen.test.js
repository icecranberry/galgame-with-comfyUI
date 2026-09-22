import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useGroupsStore } from '../src/stores/groups.js'

const at = seconds => new Date(Date.UTC(2026, 8, 22, 0, 0, seconds)).toISOString()
const messages = Array.from({ length: 80 }, (_, i) => ({
  id: i + 1, role: 'assistant', content: `消息 ${i + 1}`, created_at: at(i + 1),
}))

function setup(t, lastSeenAt) {
  setActivePinia(createPinia())
  const group = { id: 1, last_seen_at: lastSeenAt, members: [], unread: 79 }
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/groups') return { ok: true, json: async () => ({ groups: [{ ...group }] }) }
    if (url === '/api/groups/1/messages') {
      return { ok: true, json: async () => ({ group: { ...group }, messages }) }
    }
    assert.equal(url, '/api/groups/1/seen')
    group.last_seen_at = at(100)
    return { ok: true, json: async () => ({ ok: true }) }
  })
  return useGroupsStore()
}

test('保存清未读前的分界；上滑展开历史后标记仍在同一消息前', async t => {
  const store = setup(t, at(1))
  await store.loadGroups()
  await store.selectGroup(1)
  assert.equal(store.lastSeenDividerId, 2) // 同一秒与现有未读统计一致，不重复算新消息
  assert.equal(store.visibleMessages.some(m => m.id === 2), false)
  store.expandWindow()
  assert.equal(store.visibleMessages.some(m => m.id === 2), true)
  await store.loadGroups() // 清未读后的刷新不移动本次标记
  store.messages.push({ id: 81, created_at: at(101), role: 'assistant' })
  assert.equal(store.lastSeenDividerId, 2)
  store.leaveGroup()
  assert.equal(store.lastSeenDividerId, null)
  await store.loadGroups()
  await store.selectGroup(1) // 已缓存会话也按这次进入前的时间重新计算
  assert.equal(store.lastSeenDividerId, 81)
})

test('没有上次记录、时间无效或没有新消息时不显示标记', async t => {
  for (const lastSeenAt of [null, 'invalid', at(80)]) {
    await t.test(String(lastSeenAt), async t => {
      const store = setup(t, lastSeenAt)
      await store.loadGroups()
      await store.selectGroup(1)
      assert.equal(store.lastSeenDividerId, null)
      store.messages.push({ id: 81, created_at: at(101), role: 'assistant' })
      assert.equal(store.lastSeenDividerId, null)
    })
  }
})

test('未加载群列表时使用消息接口返回的上次已读时间', async t => {
  const store = setup(t, at(40))
  await store.selectGroup(1)
  assert.equal(store.lastSeenDividerId, 41)
})
