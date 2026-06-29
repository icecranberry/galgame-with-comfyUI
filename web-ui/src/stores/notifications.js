import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import * as api from '../api/index.js'

const RECONNECT_INTERVAL = 30_000

export const useProactiveStore = defineStore('proactive', () => {
  // 有未读主动消息的角色 ID 集合
  const unreadIds = shallowRef(new Set())
  // 每位角色最新主动消息数据 { [charId]: { content, display_name, avatar_path, created_at, msg_id } }
  const latestMessages = ref({})
  // SSE 回调（供 App.vue 注入）
  const onMessageCallback = ref(null)

  const _sseStarted = ref(false)
  const _pollTimer = ref(null)
  let _unsubProactive = null

  const unreadCount = computed(() => unreadIds.value.size)

  function hasUnread(charId) {
    return unreadIds.value.has(charId)
  }

  function addProactive(data) {
    const id = data.character_id
    const next = new Set(unreadIds.value)
    next.add(id)
    unreadIds.value = next
    latestMessages.value = { ...latestMessages.value, [id]: data }
  }

  async function markRead(charId) {
    const next = new Set(unreadIds.value)
    if (!next.delete(charId)) return
    unreadIds.value = next
    // 后端持久化：写入 proactive_last_read_at，刷新不丢
    try { await api.markProactiveRead(charId) } catch { /* 非关键 */ }
  }

  function setOnMessage(callback) {
    onMessageCallback.value = callback
  }

  // ── 统一 SSE 订阅 ──

  function _onMessage(data) {
    addProactive(data)
    if (onMessageCallback.value) onMessageCallback.value(data)
  }

  function _startReconnectTimer() {
    if (_pollTimer.value) clearInterval(_pollTimer.value)
    _pollTimer.value = setInterval(async () => {
      if (!_sseStarted.value) return
      // 从后端恢复未读状态（DB 为单一数据源，定期同步防丢失）
      try {
        const { unread } = await api.getProactiveUnread()
        if (unread?.length) {
          const ids = new Set()
          const msgs = { ...latestMessages.value }
          for (const r of unread) {
            ids.add(r.character_id)
            msgs[r.character_id] = r
          }
          unreadIds.value = ids
          latestMessages.value = msgs
        }
      } catch { /* 非关键 */ }
    }, RECONNECT_INTERVAL)
  }

  async function connectSSE() {
    if (_sseStarted.value) return
    _sseStarted.value = true

    // 先订阅统一 SSE 流（必须在任何 await 之前，避免竞态窗口期内消息丢失）
    const { onEvent } = await import('./unifiedStream.js')
    _unsubProactive = onEvent('proactive_message', _onMessage)

    // 从后端恢复未读状态（DB 为单一数据源，兜底 SSE 断开期间丢失的消息）
    try {
      const { unread } = await api.getProactiveUnread()
      if (unread?.length) {
        const ids = new Set()
        const msgs = { ...latestMessages.value }
        for (const r of unread) {
          ids.add(r.character_id)
          msgs[r.character_id] = r
        }
        unreadIds.value = ids
        latestMessages.value = msgs
      }
    } catch { /* 非关键 */ }

    _startReconnectTimer()
  }

  function disconnectSSE() {
    _sseStarted.value = false
    if (_pollTimer.value) { clearInterval(_pollTimer.value); _pollTimer.value = null }
    if (_unsubProactive) { _unsubProactive(); _unsubProactive = null }
  }

  return {
    unreadIds, unreadCount, latestMessages,
    hasUnread, addProactive, markRead, setOnMessage,
    connectSSE, disconnectSSE,
  }
})
