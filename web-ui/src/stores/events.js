import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'
import { onEvent } from './unifiedStream.js'

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

      // 保留本地 processing / queued 状态 —— 后端 DB 里没有排队状态，
      // 直接用后端数据覆盖会导致切换页面后 loading 消失
      const localMeta = new Map()
      for (const e of activeEvents.value) {
        if (e.processing || _chooseQueue.some(q => q.eventId === e.id)) {
          localMeta.set(e.id, { processing: true, _queued: _chooseQueue.some(q => q.eventId === e.id) })
        }
      }

      activeEvents.value = (data.active || []).filter(e => {
        if (!e.expires_at) return true
        if (new Date(e.expires_at).getTime() > now) return true
        // 过期但正在本地处理/排队中 → 保留（后端调度器可能还没结算）
        if (localMeta.has(e.id)) return true
        expired.push(e)
        return false
      }).map(e => {
        const local = localMeta.get(e.id)
        return local ? { ...e, processing: local.processing, _queued: local._queued } : e
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

  // ── 选择队列：最多 2 个 HTTP 请求并发，超出排队 ──
  // 用户点第 3 个分支时不会报错，而是暂存并在有空闲时自动处理。
  // UI 立刻显示"推进中"（processing=true），无需等待 HTTP 响应。
  const MAX_CONCURRENT_CHOOSES = 2
  let _choosingCount = 0
  const _chooseQueue = []  // { eventId, choice, customText }

  /** 实际执行 HTTP 请求 + 结果处理 */
  async function _executeChoice(eventId, choice, customText) {
    _choosingCount++
    console.log(`[store] makeChoice EXEC event=${eventId} (concurrent: ${_choosingCount}/${MAX_CONCURRENT_CHOOSES})`)

    try {
      const result = await api.chooseEventOption(eventId, choice, customText)
      console.log(`[store] makeChoice API_OK event=${eventId} concluded=${result.concluded}`)
      if (result.concluded) {
        activeEvents.value = activeEvents.value.filter(e => e.id !== eventId)
        await loadEvents()
      } else if (result.event) {
        const idx = activeEvents.value.findIndex(e => e.id === eventId)
        if (idx !== -1) {
          activeEvents.value[idx] = result.event
        }
        await markSeen()
      }
      return result
    } catch (err) {
      console.error(`[store] makeChoice ERROR event=${eventId}:`, err?.message)
      const idx = activeEvents.value.findIndex(e => e.id === eventId)
      if (idx !== -1) {
        activeEvents.value[idx] = { ...activeEvents.value[idx], processing: false }
      }
      throw err
    } finally {
      _choosingCount--
      // 有空闲槽位 → 处理队列中的下一个
      _drainQueue()
    }
  }

  /** 从队列取出下一个待处理的选择 */
  function _drainQueue() {
    if (_chooseQueue.length === 0) return
    if (_choosingCount >= MAX_CONCURRENT_CHOOSES) return

    const next = _chooseQueue.shift()
    const idx = activeEvents.value.findIndex(e => e.id === next.eventId)

    // 事件已不在活跃列表中（被删除/过期/结束），跳过
    if (idx === -1) {
      console.log(`[store] makeChoice SKIP_QUEUED event=${next.eventId}: no longer active`)
      _drainQueue() // 尝试下一个
      return
    }

    console.log(`[store] makeChoice DEQUEUE event=${next.eventId} (${_chooseQueue.length} left in queue)`)
    // 清除 _queued 标记：HTTP 请求即将发出，不可再取消
    if (idx !== -1) {
      activeEvents.value[idx] = { ...activeEvents.value[idx], _queued: false }
    }
    // 不 await —— 让队列异步消化，不阻塞当前调用栈
    _executeChoice(next.eventId, next.choice, next.customText)
  }

  /** 取消排队中的选择，恢复可点击状态 */
  function cancelQueuedChoice(eventId) {
    // 从队列移除
    const qIdx = _chooseQueue.findIndex(q => q.eventId === eventId)
    if (qIdx !== -1) {
      _chooseQueue.splice(qIdx, 1)
      console.log(`[store] cancelQueuedChoice REMOVED event=${eventId} from queue`)
    }
    // 恢复本地状态
    const idx = activeEvents.value.findIndex(e => e.id === eventId)
    if (idx !== -1) {
      activeEvents.value[idx] = { ...activeEvents.value[idx], processing: false, _queued: false }
    }
  }

  /** 选择事件选项（可排队） */
  async function makeChoice(eventId, choice, customText) {
    const idx = activeEvents.value.findIndex(e => e.id === eventId)

    // 守卫 1：同一事件已有请求在处理或排队中
    if (idx !== -1 && activeEvents.value[idx].processing) {
      console.warn(`[store] makeChoice IGNORED event=${eventId}: already processing`)
      return null
    }
    if (_chooseQueue.some(q => q.eventId === eventId)) {
      console.warn(`[store] makeChoice IGNORED event=${eventId}: already in queue`)
      return null
    }

    // 立即标记 processing，UI 显示"推进中"
    if (idx !== -1) {
      activeEvents.value[idx] = { ...activeEvents.value[idx], processing: true }
    }

    // 有可用槽位 → 立即执行
    if (_choosingCount < MAX_CONCURRENT_CHOOSES) {
      return _executeChoice(eventId, choice, customText)
    }

    // 槽位满 → 入队等待
    console.log(`[store] makeChoice QUEUED event=${eventId} (queue depth: ${_chooseQueue.length + 1})`)
    _chooseQueue.push({ eventId, choice, customText })
    return null
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

  // ── 统一 SSE 订阅（替代独立 SSE 长连接）──
  let _pollTimer = null
  let _sseStarted = false
  let _unsubs = []  // onEvent 返回的取消订阅函数

  /** SSE 事件触发时，本地更新未读计数而不发起额外 API 请求。
   *  避免在 HTTP/1.1 6 连接限制下（3 SSE + 长 choose = 仅剩 1-2 连接），
   *  refreshUnreadCount 的 fetch 抢走最后可用连接导致页面导航等请求排队 23 秒。
   *  Poll timer (30s) 仍会定期同步以修正偏差。
   */
  function _bumpUnreadLocal() {
    if (!isViewingEvents.value) {
      newEventCount.value = activeEvents.value.length
    }
  }

  function connectSSE() {
    if (_sseStarted) return
    _sseStarted = true

    // 订阅统一 SSE 流的事件类型（单个 HTTP 连接承载所有事件）
    _unsubs = [
      onEvent('new_event', (data) => {
        const exists = activeEvents.value.find(e => e.id === data.id)
        if (!exists) activeEvents.value.unshift(data)
        _bumpUnreadLocal()
      }),
      onEvent('event_update', (data) => {
        const idx = activeEvents.value.findIndex(e => e.id === data.id)
        if (idx !== -1) activeEvents.value[idx] = { ...activeEvents.value[idx], ...data }
        _bumpUnreadLocal()
      }),
      onEvent('event_concluded', (data) => {
        activeEvents.value = activeEvents.value.filter(e =>
          !(e.character_id === data.character_id && e.title === data.event_title)
        )
        if (isViewingEvents.value) loadEvents()
        else _bumpUnreadLocal()
      }),
      onEvent('event_expired', (data) => {
        activeEvents.value = activeEvents.value.filter(e =>
          !(e.character_id === data.character_id && e.title === data.event_title)
        )
        _bumpUnreadLocal()
      }),
    ]

    if (!_pollTimer) {
      _pollTimer = setInterval(() => {
        if (!_sseStarted) return
        refreshUnreadCount()
      }, POLL_INTERVAL)
    }
  }

  function disconnectSSE() {
    _sseStarted = false
    _unsubs.forEach(fn => fn())
    _unsubs = []
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null }
  }

  return {
    activeEvents, history, loading,
    filterCharacterId, filterEngaged, newEventCount, isViewingEvents,
    scrollToTopSignal,
    filteredActive, filteredHistory, charactersWithEvents,
    loadEvents, makeChoice, cancelQueuedChoice, dismissEvent, deleteEvent,
    setFilter, toggleFilterEngaged,
    refreshUnreadCount, markSeen,
    connectSSE, disconnectSSE, requestScrollToTop,
  }
})
