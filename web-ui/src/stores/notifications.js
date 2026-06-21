import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import * as api from '../api/index.js'

const RECONNECT_INTERVAL = 30_000

export const useProactiveStore = defineStore('proactive', () => {
  // 有未读主动消息的角色 ID 集合
  const unreadIds = shallowRef(new Set())
  // 每位角色最新主动消息数据 { [charId]: { content, display_name, avatar_path, avatar_color, created_at, msg_id } }
  const latestMessages = ref({})
  // SSE 回调（供 App.vue 注入）
  const onMessageCallback = ref(null)

  const _sseConn = ref(null)
  const _sseStarted = ref(false)
  const _pollTimer = ref(null)

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

  // ── SSE 内部逻辑 ──

  function _onMessage(data) {
    addProactive(data)
    if (onMessageCallback.value) onMessageCallback.value(data)
  }

  function _createSSE() {
    if (_sseConn.value && !_sseConn.value._closed) _sseConn.value.close()
    _sseConn.value = api.connectNotificationsStream(_onMessage)
  }

  function _startReconnectTimer() {
    if (_pollTimer.value) clearInterval(_pollTimer.value)
    _pollTimer.value = setInterval(() => {
      if (!_sseStarted.value) return
      if (!_sseConn.value || _sseConn.value._closed) {
        _createSSE()
      }
    }, RECONNECT_INTERVAL)
  }

  async function connectSSE() {
    if (_sseStarted.value) return
    _sseStarted.value = true

    // 从后端恢复未读状态（DB 为单一数据源）
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

    _createSSE()
    _startReconnectTimer()
  }

  function disconnectSSE() {
    _sseStarted.value = false
    if (_pollTimer.value) { clearInterval(_pollTimer.value); _pollTimer.value = null }
    if (_sseConn.value) { _sseConn.value.close(); _sseConn.value = null }
  }

  return {
    unreadIds, unreadCount, latestMessages,
    hasUnread, addProactive, markRead, setOnMessage,
    connectSSE, disconnectSSE,
  }
})
