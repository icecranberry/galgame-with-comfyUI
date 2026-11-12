import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useGroupsStore } from '../src/stores/groups.js'
import { useGroupEntryScroll } from '../src/composables/useGroupEntryScroll.js'

function fixture(t, { reduceMotion = false } = {}) {
  const frames = new Map()
  let frameId = 0, now = 0, busy = false, finished = 0, revealed = 0
  function global(name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name])
  }
  global('requestAnimationFrame', fn => { frames.set(++frameId, fn); return frameId })
  global('cancelAnimationFrame', id => frames.delete(id))
  global('window', { matchMedia: () => ({ matches: reduceMotion }) })
  t.mock.method(performance, 'now', () => now)
  let top = 0, dividerOffset = 700
  const el = {
    scrollHeight: 2000, clientHeight: 500, clientTop: 0,
    get scrollTop() { return top },
    set scrollTop(value) { top = Math.max(0, Math.min(1500, value)) },
    getBoundingClientRect: () => ({ top: 50 }),
    querySelector: () => ({ getBoundingClientRect: () => ({ top: 50 + dividerOffset - top, height: 40 }) }),
  }
  const scroll = useGroupEntryScroll({
    container: () => el, busy: () => busy,
    reveal: () => { revealed++; return true }, onStart() {}, onFinish: () => finished++,
  })
  return {
    scroll, el, frames,
    get finished() { return finished }, get revealed() { return revealed },
    setBusy(value) { busy = value }, moveDivider(value) { dividerOffset = value },
    step(time) {
      now = time
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(fn => fn(time))
    },
  }
}

test('已读完、后台生成或前台播放中不触发回滚', async t => {
  const f = fixture(t)
  for (const entry of [{ unread: 0 }, { unread: 4, generating: true }, undefined]) {
    assert.equal(await f.scroll.start(entry), false)
  }
  f.setBusy(true)
  assert.equal(await f.scroll.start({ unread: 4 }), false)
  assert.equal(f.revealed, 0)
  assert.equal(f.frames.size, 0)
})

test('从最新消息快速向上滚动，300ms 后已读分界线居中', async t => {
  const f = fixture(t)
  assert.equal(await f.scroll.start({ unread: 80 }), true)
  assert.equal(f.el.scrollTop, 1500)
  f.step(100)
  assert.ok(f.el.scrollTop > 470 && f.el.scrollTop < 1500)
  f.step(300)
  assert.equal(f.el.scrollTop, 470)
  const rect = f.el.querySelector().getBoundingClientRect()
  assert.equal(rect.top + rect.height / 2 - f.el.getBoundingClientRect().top, f.el.clientHeight / 2)
  assert.equal(f.scroll.active.value, false)
  assert.equal(f.finished, 1)
  assert.equal(f.frames.size, 0)
})

test('滚动过程中重新计算图片或字体改变后的分界线位置', async t => {
  const f = fixture(t)
  await f.scroll.start({ unread: 80 })
  f.step(100)
  f.moveDivider(800)
  f.step(300)
  assert.equal(f.el.scrollTop, 570)
})

test('手动滚动或离开后取消动画，旧帧不会抢回位置', async t => {
  const f = fixture(t)
  await f.scroll.start({ unread: 80 })
  const staleFrame = [...f.frames.values()][0]
  f.scroll.cancel()
  f.el.scrollTop = 700
  staleFrame(300)
  assert.equal(f.el.scrollTop, 700)
  assert.equal(f.frames.size, 0)
  assert.equal(f.finished, 0)
})

test('回滚中开始生成则立即停止；减少动态效果时直接定位', async t => {
  const f = fixture(t, { reduceMotion: true })
  await f.scroll.start({ unread: 80 })
  f.step(16)
  assert.equal(f.el.scrollTop, 470)
  await f.scroll.start({ unread: 80 })
  f.setBusy(true)
  f.step(32)
  assert.equal(f.el.scrollTop, 1500)
  assert.equal(f.scroll.active.value, false)
})

test('切群后的新动画不受上一群的待执行帧影响', async t => {
  const f = fixture(t)
  await f.scroll.start({ unread: 80 })
  const staleFrame = [...f.frames.values()][0]
  await f.scroll.start({ unread: 80 })
  staleFrame(300)
  assert.equal(f.el.scrollTop, 1500)
  f.step(300)
  assert.equal(f.el.scrollTop, 470)
  assert.equal(f.finished, 1)
})

test('初次进入与缓存重进均保留清未读前的快照，并展开窗口外的已读边界', async t => {
  setActivePinia(createPinia())
  const store = useGroupsStore()
  const group = { id: 1, unread: 90, generating: false, last_seen_at: '2026-11-12T00:00:10.000Z' }
  const messages = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1, role: 'assistant', created_at: new Date(Date.parse('2026-11-12T00:00:00Z') + i * 1000).toISOString(),
  }))
  let loads = 0
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/seen')) return Response.json({ ok: true })
    loads++
    return Response.json({ group, messages })
  })
  store.groups = [{ ...group }]
  const entry = await store.selectGroup(1)
  assert.equal(entry.unread, 90)
  assert.equal(entry.generating, false)
  assert.equal(store.lastSeenDividerId, 12)
  assert.equal(store.visibleMessages.some(msg => msg.id === 12), false)
  assert.equal(store.revealLastSeenDivider(), true)
  assert.equal(store.visibleMessages[0].id, 1)
  store.leaveGroup()
  store.groups = [{ ...group, unread: 0, generating: true }]
  const cached = await store.selectGroup(1)
  assert.deepEqual(cached, { unread: 0, generating: true })
  assert.equal(loads, 1)
  store.leaveGroup()
})
