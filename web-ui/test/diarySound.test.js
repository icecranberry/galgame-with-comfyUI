import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useDiaryStore } from '../src/stores/diary.js'

test('打开日记只为本次加载的非空正文发声；空白、失败、关闭和过期响应静音', async (t) => {
  let audible = 0
  let now = 1000
  let response = { diary: { content: '今天去散步。' } }
  let resolveDiary
  let delayed = false
  let failed = false
  for (const key of ['window', 'Audio']) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key)
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original)
      else delete globalThis[key]
    })
  }
  // ⚠ 2026-10-08 合并 v3.7.0：本项目 api 层的 request() 读的是 `res.text()`（见
  //   src/api/index.js 顶部的「测试契约」注释，另有一个仍用 json() 的 jsonRequest()）。
  //   上游新增的本测试只 mock 了 `json()`，未提供 `text()` → diary 加载必然失败。
  //   这里只**补全 mock**（返回等价 JSON 文本），不改任何断言。
  const asText = data => ({ ok: true, json: async () => data, text: async () => JSON.stringify(data) })
  globalThis.window = {}
  globalThis.Audio = class {
    readyState = 4
    play() { if (this.volume > 0) audible++; return Promise.resolve() }
    pause() {}
  }
  t.mock.method(Date, 'now', () => now += 500)
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('/history')) return { ok: true, json: async () => ({ diaries: [] }), text: async () => JSON.stringify({ diaries: [] }) }
    if (delayed) return new Promise(resolve => { resolveDiary = data => resolve({ ok: true, json: async () => data, text: async () => JSON.stringify(data) }) })
    if (failed) throw new Error('离线')
    return asText(response)
  })
  setActivePinia(createPinia())
  const store = useDiaryStore()
  await store.openBook({ characterId: 1 })
  assert.equal(audible, 1)
  for (const diary of [null, { content: '' }, { content: '  \n ' }]) {
    response = { diary }
    await store.openBook({ characterId: 1 })
    assert.equal(audible, 1)
  }
  store.diary = { content: '旧正文' }
  failed = true
  await store.openBook({ characterId: 1 })
  assert.equal(audible, 1, '请求失败不能因旧正文而响')
  failed = false
  delayed = true
  const closed = store.openBook({ characterId: 1 })
  store.closeBook()
  resolveDiary({ diary: { content: '迟到正文' } })
  await closed
  assert.equal(audible, 1)
  const old = store.openBook({ characterId: 1 })
  const resolveOld = resolveDiary
  delayed = false
  response = { diary: null }
  await store.openBook({ characterId: 2 })
  resolveOld({ diary: { content: '另一个角色的旧正文' } })
  await old
  assert.equal(audible, 1)
  assert.equal(store.diary, null)
})
