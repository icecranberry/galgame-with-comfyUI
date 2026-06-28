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
        await loadEvents() // 刷新以获取更新后的历史（内部调用 markSeen）
      } else if (result.event) {
        // 更新活跃事件
        const idx = activeEvents.value.findIndex(e => e.id === eventId)
        if (idx !== -1) {
          activeEvents.value[idx] = result.event
        }
        // 用户刚在事件页面看到了分支更新，标记已读（避免离开页面后自身触发红点）
        await markSeen()
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
  let _sseStarted = false

  /** 创建 SSE 事件处理器（connectSSE 和 _createSSE 共用，避免重复代码） */
  function _makeHandlers() {
    return {
      onNewEvent(data) {
        const exists = activeEvents.value.find(e => e.id === data.id)
        if (!exists) {
          activeEvents.value.unshift(data)
        }
        refreshUnreadCount()
      },
      onUpdate(data) {
        const idx = activeEvents.value.findIndex(e => e.id === data.id)
        if (idx !== -1) {
          activeEvents.value[idx] = { ...activeEvents.value[idx], ...data }
        }
        // 分支更新也触发红点（后端通过 last_interaction_at 判断）
        refreshUnreadCount()
      },
      onConclusion(data) {
        activeEvents.value = activeEvents.value.filter(e =>
          !(e.character_id === data.character_id && e.title === data.event_title)
        )
        if (isViewingEvents.value) {
          // 正在浏览事件页面 → 完整刷新列表（含 markSeen 清零红点）
          loadEvents()
        } else {
          // 不在事件页面 → 只刷新未读计数，避免 markSeen 错误清零红点
          refreshUnreadCount()
        }
      },
      onExpired(data) {
        activeEvents.value = activeEvents.value.filter(e =>
          !(e.character_id === data.character_id && e.title === data.event_title)
        )
        refreshUnreadCount()
      },
    }
  }

  function connectSSE() {
    if (_sseStarted) return
    _sseStarted = true

    // 先关闭旧连接（如果存在）
    if (_sseConn && !_sseConn._closed) {
      _sseConn.close()
    }

    _sseConn = api.connectEventsStream(_makeHandlers())
    _startPoll()
  }

  function disconnectSSE() {
    _sseStarted = false
    if (_sseConn) {
      _sseConn.close()
      _sseConn = null
    }
    _stopPoll()
  }

  /** SSE 断线重连（仅被 poll timer 内部调用，不改变 _sseStarted 状态） */
  function _createSSE() {
    if (_sseConn && !_sseConn._closed) {
      _sseConn.close()
    }
    _sseConn = api.connectEventsStream(_makeHandlers())
  }

  function _startPoll() {
    if (_pollTimer) return
    _pollTimer = setInterval(() => {
      if (!_sseStarted) return
      if (!_sseConn || _sseConn._closed) {
        _createSSE()
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
