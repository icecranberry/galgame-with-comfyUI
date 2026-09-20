import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'

// 朋友圈「我发的」筛选契约：点发布框头像后只留用户自己发的帖子。
// 用户帖的 character_id / npc_id 都是 NULL，靠 authorOf() 无法与「无筛选」区分，
// 所以判定以接口返回的 author_type 为准（缺字段的旧数据再走无作者兜底）。

globalThis.fetch = async () => { throw new Error('本测试不应发起网络请求') }

const { useMomentsStore } = await import('../src/stores/moments.js')
setActivePinia(createPinia())

function post(id, extra = {}) {
  return { id, content: `post${id}`, created_at: '2024-01-01T00:00:00.000Z', ...extra }
}

test('filterUser 只保留 author_type 为 user 的帖子', () => {
  const store = useMomentsStore()
  store.posts = [
    post(1, { author_type: 'user', character_id: null, npc_id: null }),
    post(2, { author_type: 'character', character_id: 7, display_name: '琪亚娜' }),
    post(3, { author_type: 'npc', npc_id: 3, display_name: '面包店老板' }),
    post(4, { author_type: 'user', character_id: null, npc_id: null }),
  ]

  assert.equal(store.filteredPosts.length, 4)
  store.toggleFilterUser()
  assert.deepEqual(store.filteredPosts.map(p => p.id), [1, 4])
  store.toggleFilterUser()
  assert.equal(store.filteredPosts.length, 4)
})

test('缺 author_type 的旧数据按「无角色 / 无镇民」兜底判定', () => {
  const store = useMomentsStore()
  store.posts = [
    post(1, { character_id: null, npc_id: null }),
    post(2, { character_id: 7 }),
    post(3, { npc_id: 3 }),
  ]
  store.toggleFilterUser()
  assert.deepEqual(store.filteredPosts.map(p => p.id), [1])
})

test('「我发的」与角色筛选互斥，与「赞过」可叠加', () => {
  const store = useMomentsStore()
  store.posts = [
    post(1, { author_type: 'user', liked: 1 }),
    post(2, { author_type: 'user', liked: 0 }),
    post(3, { author_type: 'character', character_id: 7, liked: 1 }),
  ]

  store.setFilter(7)
  assert.deepEqual(store.filteredPosts.map(p => p.id), [3])

  store.toggleFilterUser()                    // 打开「我发的」→ 让出角色筛选
  assert.equal(store.filterCharacterId, null)
  assert.deepEqual(store.filteredPosts.map(p => p.id), [1, 2])

  store.toggleFilterLiked()                   // 叠加「赞过」
  assert.deepEqual(store.filteredPosts.map(p => p.id), [1])

  store.setFilter(7)                          // 再选角色 → 退出「我发的」
  assert.equal(store.filterUser, false)
  assert.deepEqual(store.filteredPosts.map(p => p.id), [3])

  store.resetFilters()
  assert.equal(store.filterUser, false)
  assert.equal(store.filteredPosts.length, 3)
})

test('charactersWithPosts 不把「我」算进角色筛选条', () => {
  const store = useMomentsStore()
  store.posts = [
    post(1, { author_type: 'user', character_id: null, npc_id: null }),
    post(2, { author_type: 'character', character_id: 7, display_name: '琪亚娜' }),
  ]
  assert.deepEqual(store.charactersWithPosts.map(c => c.author), [7])
})
