import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'

const POLL_INTERVAL = 30_000

export const useEventsStore = defineStore('events', () => {
  const activeEvents = ref([])        // 活跃事件列表
  const history = ref([])             // 事件历史
  const loading = ref(false)
  const filterCharacterId = ref(null) // null = 全部
  const filterEngaged = ref(false)      // 只看参与过的

  // ── 红点通知状态 ──
  const newEventCount = ref(0)
  const isViewingEvents = ref(false)

  // ── 筛选 ──
  function setFilter(charId) {
    filterCharacterId.value = charId
    filterEngaged.value = false
  }
  function toggleFilterEngaged() {
    filterEngaged.value = !filterEngaged.value
    filterCharacterId.value = null
  }

  // ── 滚动到顶部信号 ──
  const scrollToTopSignal = ref(0)
  function requestScrollToTop() {
    scrollToTopSignal.value++
  }

  // 按角色 + 参与状态筛选
  const filteredActive = computed(() => {
    let result = activeEvents.value
    if (filterCharacterId.value !== null) result = result.filter(e => e.character_id === filterCharacterId.value)
    if (filterEngaged.value) result = result.filter(e => e.engaged)
    return result
  })

  const filteredHistory = computed(() => {
    let result = history.value
    if (filterCharacterId.value !== null) result = result.filter(e => e.character_id === filterCharacterId.value)
    if (filterEngaged.value) result = result.filter(e => e.engaged)
    return result
  })

  // 有事件的角色列表
  const charactersWithEvents = computed(() => {
    const map = new Map()
    for (const e of activeEvents.value) {
      const id = e.character_id
      if (!id) continue
      const existing = map.get(id)
      const evtTime = new Date(e.created_at || 0).getTime()
      if (!existing || evtTime > existing._latestAt) {
        map.set(id, {
          character_id: id,
          display_name: e.display_name || '未知',
          avatar_path: e.avatar_path || '',
          _latestAt: evtTime,
        })
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b._latestAt - a._latestAt)
      .map(({ _latestAt, ...rest }) => rest)
  })

  // 加载全部事件
  async function loadEvents() {
    if (loading.value) return
    loading.value = true
    try {
      const data = await api.listEvents()
      const now = Date.now()
      const expired = []
      activeEvents.value = (data.active || []).filter(e => {
        if (!e.expires_at) return true
        if (new Date(e.expires_at).getTime() > now) return true
        expired.push(e)
        return false
      })
      // 过期事件在调度器处理前先并入前端 history，避免消失
      history.value = [
        ...expired.map(e => ({
          ...e,
          outcome: 'expired',
          ended_at: e.expires_at,
          summary: e.summary || e.description,
          image: undefined,
          final_image: e.image,
        })),
        ...(data.history || []),
      ]
      await markSeen()
    } catch (err) {
      console.error('[events] loadEvents error:', err)
    } finally {
      loading.value = false
    }
  }

  // 选择事件选项
  async function makeChoice(eventId, choice, customText) {
    try {
      const result = await api.chooseEventOption(eventId, choice, customText)
      if (result.concluded) {
        // 事件已结束，从活跃列表移除
        activeEvents.value = activeEvents.value.filter(e => e.id !== eventId)
        await loadEvents() // 刷新以获取更新后的历史
      } else if (result.event) {
        // 更新活跃事件
        const idx = activeEvents.value.findIndex(e => e.id === eventId)
        if (idx !== -1) {
          activeEvents.value[idx] = result.event
        }
      }
      return result
    } catch (err) {
      console.error('[events] makeChoice error:', err)
      throw err
    }
  }

  // 取消事件
  async function dismissEvent(eventId) {
    try {
      await api.dismissEvent(eventId)
      activeEvents.value = activeEvents.value.filter(e => e.id !== eventId)
    } catch (err) {
      console.error('[events] dismissEvent error:', err)
    }
  }

  async function deleteEvent(eventId) {
    try {
      await api.deleteEvent(eventId)
      activeEvents.value = activeEvents.value.filter(e => e.id !== eventId)
      history.value = history.value.filter(e => e.id !== eventId)
    } catch (err) {
      console.error('[events] deleteEvent error:', err)
    }
  }

  // ── 未读计数 ──
  async function refreshUnreadCount() {
    try {
      const data = await api.getEventsUnread()
      if (data && typeof data.count === 'number') {
        newEventCount.value = data.count
      }
    } catch { /* silent */ }
  }

  async function markSeen() {
    newEventCount.value = 0
    try { await api.markEventsRead() } catch { /* silent */ }
  }

  // ── SSE 连接 ──
  let _sseConn = null
  let _pollTimer = null

  function connectSSE() {
    if (_sseConn && !_sseConn._closed) return

    _sseConn = api.connectEventsStream({
      onNewEvent(data) {
        // 追加到活跃列表前端
        const exists = activeEvents.value.find(e => e.id === data.id)
        if (!exists) {
          activeEvents.value.unshift(data)
        }
        refreshUnreadCount()
      },
      onUpdate(data) {
        // 更新已有事件
        const idx = activeEvents.value.findIndex(e => e.id === data.id)
        if (idx !== -1) {
          activeEvents.value[idx] = { ...activeEvents.value[idx], ...data }
        }
      },
      onConclusion(data) {
        // 从活跃列表移除
        activeEvents.value = activeEvents.value.filter(e =>
          !(e.character_id === data.character_id && e.title === data.event_title)
        )
        // 刷新以获取历史
        loadEvents()
      },
      onExpired(data) {
        activeEvents.value = activeEvents.value.filter(e =>
          !(e.character_id === data.character_id && e.title === data.event_title)
        )
      },
    })

    _startPoll()
  }

  function disconnectSSE() {
    if (_sseConn) {
      _sseConn.close()
      _sseConn = null
    }
    _stopPoll()
  }

  function _startPoll() {
    if (_pollTimer) return
    _pollTimer = setInterval(() => {
      if (_sseConn?._closed) {
        connectSSE() // 重连
      }
      refreshUnreadCount()
    }, POLL_INTERVAL)
  }

  function _stopPoll() {
    if (_pollTimer) {
      clearInterval(_pollTimer)
      _pollTimer = null
    }
  }

  return {
    activeEvents, history, loading,
    filterCharacterId, filterEngaged, newEventCount, isViewingEvents,
    scrollToTopSignal,
    filteredActive, filteredHistory, charactersWithEvents,
    loadEvents, makeChoice, dismissEvent, deleteEvent,
    setFilter, toggleFilterEngaged,
    refreshUnreadCount, markSeen,
    connectSSE, disconnectSSE, requestScrollToTop,
  }
})
