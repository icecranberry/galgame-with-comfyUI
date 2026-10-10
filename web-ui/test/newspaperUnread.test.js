import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useNewspaperStore } from '../src/stores/newspaper.js'

const READ_KEY = 'linshe.newspaper.last_read'

/** 最小 localStorage 替身（Node 默认没有；隐私模式口径由 store 自己兜底） */
function setupStorage(t, initial = {}) {
  const map = new Map(Object.entries(initial))
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: key => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: key => map.delete(key),
    },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  })
  return map
}

const paper = (date, edition = 7) => ({ id: 1, publish_date: date, edition })

function newStore(t, { stored = {}, paper: today = null } = {}) {
  const map = setupStorage(t, stored)
  let current = today
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(String(url), '/api/newspaper/today')
    return { ok: true, text: async () => JSON.stringify({ newspaper: current }) }
  })
  setActivePinia(createPinia())
  return { store: useNewspaperStore(), map, setPaper: p => { current = p } }
}

/** 让 startPolling 里那次立即拉取跑完（mock fetch 只走微任务 + 一次宏任务） */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

test('今天印出且没看过 → 未读；打开看过即消红点并落盘', async (t) => {
  const { store, map, setPaper } = newStore(t, { paper: paper('2026-09-24') })
  await store.fetchToday()
  assert.equal(store.unread, true)

  store.markRead()
  assert.equal(store.unread, false)
  assert.equal(map.get(READ_KEY), '2026-09-24')

  // 同一期内补图 / 世界影响改动不重新点亮
  setPaper({ ...paper('2026-09-24'), world_dismissed: 1 })
  await store.fetchToday()
  assert.equal(store.unread, false)
})

test('已读日期来自 localStorage：当天开页不亮，跨天印出新一期重新点亮', async (t) => {
  const { store, setPaper } = newStore(t, {
    stored: { [READ_KEY]: '2026-09-23' },
    paper: paper('2026-09-23'),
  })
  await store.fetchToday()
  assert.equal(store.unread, false, '当天这期已经看过，不该亮红点')

  setPaper(paper('2026-09-24', 8))
  await store.fetchToday()
  assert.equal(store.unread, true, '第二天早上印出新一期要重新亮红点')
})

test('还没印出时不亮红点', async (t) => {
  const { store } = newStore(t)
  await store.fetchToday()
  assert.equal(store.todayPaper, null)
  assert.equal(store.unread, false)
})

test('markRead 拿到的那一期会顺手对齐本地缓存（跨天轮询间隙读完不留红点）', async (t) => {
  const { store, map } = newStore(t)
  await store.fetchToday()
  assert.equal(store.todayPaper, null)

  store.markRead(paper('2026-09-24', 8))
  assert.equal(store.todayPaper.publish_date, '2026-09-24')
  assert.equal(store.unread, false)
  assert.equal(map.get(READ_KEY), '2026-09-24')
})

test('接口失败只记日志，不点亮红点也不抛错', async (t) => {
  setupStorage(t)
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('boom') })
  t.mock.method(console, 'error', () => {})
  setActivePinia(createPinia())
  const store = useNewspaperStore()

  await store.fetchToday()
  assert.equal(store.todayPaper, null)
  assert.equal(store.unread, false)
  assert.equal(store.loading, false)
})

test('轮询按引用计数启停：多次 start 只建一个定时器，最后一个 stop 才停表', async (t) => {
  const { store } = newStore(t, { paper: paper('2026-09-24') })
  const setIntervalMock = t.mock.method(globalThis, 'setInterval', () => 42)
  const clearIntervalMock = t.mock.method(globalThis, 'clearInterval', () => {})

  store.startPolling()
  store.startPolling()
  await flush()
  assert.equal(setIntervalMock.mock.callCount(), 1)
  assert.equal(store.unread, true, 'start 会立即拉一次，导航栏红点不用等第一个周期')

  store.stopPolling()
  assert.equal(clearIntervalMock.mock.callCount(), 0, '还有订阅者时不能停表')
  store.stopPolling()
  assert.equal(clearIntervalMock.mock.callCount(), 1)
})
