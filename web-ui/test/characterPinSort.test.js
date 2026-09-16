import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'

// 侧边栏会话列表的排序契约：置顶优先（组内仍按最近消息时间降序，
// 完全没有消息的角色兜底排在组尾）。这里把 GET /api/characters 的响应 mock 掉，
// 只验证 store 拿到数据后的重排口径。

function char(id, pinned, lastMessageAt) {
  return {
    id,
    name: `char${id}`,
    display_name: `角色${id}`,
    pinned,
    last_message_at: lastMessageAt,
  }
}

let nextPayload = []
globalThis.fetch = async () => ({ ok: true, json: async () => ({ characters: nextPayload }) })

const { useChatStore } = await import('../src/stores/chat.js')
setActivePinia(createPinia())

async function orderFor(payload) {
  nextPayload = payload.map(c => ({ ...c }))
  const store = useChatStore()
  await store.loadCharacters()
  return store.characters.map(c => c.id)
}

test('置顶排在未置顶之前；组内按最近消息时间降序，无消息的兜底到组尾', async () => {
  const ids = await orderFor([
    char(1, 0, '2024-01-02T00:00:00.000Z'),
    char(2, 1, '2024-01-01T00:00:00.000Z'),
    char(3, 0, null),
    char(4, 1, null),
    char(5, 0, '2024-01-03T00:00:00.000Z'),
  ])
  assert.deepEqual(ids, [2, 4, 5, 1, 3])
})

test('没有置顶角色时，口径与旧的「按最近消息时间降序」逐位一致', async () => {
  const ids = await orderFor([
    char(1, 0, '2024-01-02T00:00:00.000Z'),
    char(2, 0, null),
    char(3, 0, '2024-01-03T00:00:00.000Z'),
  ])
  assert.deepEqual(ids, [3, 1, 2])
})

test('多个角色同时置顶：置顶组内部互不打扰，各自按时间排', async () => {
  const ids = await orderFor([
    char(1, 1, '2024-01-01T00:00:00.000Z'),
    char(2, 1, '2024-01-05T00:00:00.000Z'),
    char(3, 0, '2024-01-09T00:00:00.000Z'),
    char(4, 1, '2024-01-03T00:00:00.000Z'),
  ])
  assert.deepEqual(ids, [2, 4, 1, 3])
})
