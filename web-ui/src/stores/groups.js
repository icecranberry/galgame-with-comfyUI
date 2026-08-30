/**
 * 群聊 store
 *
 * - 群列表 / 当前群消息 / 未读红点
 * - 播放队列：后端一次性推来的多条剧本消息，前端按打字延迟逐条上屏（"xx 正在输入…"）
 * - SSE：发言走 groupChatStream 直连流；后台闲聊/其他页面经统一流 group_message 到达
 * - 消息 id 去重：直连流 + 统一流会重复收到同一条消息
 */
import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import { useMessageWindow, MESSAGE_WINDOW_INITIAL, MESSAGE_WINDOW_EXPAND } from '../composables/useMessageWindow.js'
import * as api from '../api/index.js'
import { onEvent } from './unifiedStream.js'

export const useGroupsStore = defineStore('groups', () => {
  const groups = ref([])
  const activeGroupId = ref(null)
  const activeGroup = computed(() => groups.value.find(g => g.id === activeGroupId.value) || null)
  const messages = ref([])          // 已上屏消息
  // 与私聊一致：历史消息保留在内存中，窗口策略统一由 useMessageWindow 提供
  const { renderStart, visibleMessages, hasMoreOlder, resetToLatest } = useMessageWindow(messages)
  const playing = ref(false)        // 播放队列是否正在逐条上屏
  const sending = ref(false)
  const undoing = ref(false)
  const scrollSignal = ref(0)       // 消息上屏后通知视图滚动到底
  const lullCount = ref(0)          // 前台冷场自动触发计数：跨群/跨路由不重置，仅用户发言时归零

  const _sessions = new Map()
  let _unsubs = []
  let _selectRequestId = 0

  function _createSession(groupId) {
    return {
      groupId,
      messages: reactive([]),
      seenMsgIds: new Set(),
      playQueue: [],
      imageGate: createGroupImagePlaybackGate(),
      playing: false,
      currentPlaying: null,
      lastPushAt: 0,
      renderStart: 0,
      loaded: false,
    }
  }

  function _getSession(groupId, create = false) {
    let session = _sessions.get(groupId)
    if (!session && create) {
      session = _createSession(groupId)
      _sessions.set(groupId, session)
    }
    return session
  }

  function _activeSession() {
    return activeGroupId.value ? _sessions.get(activeGroupId.value) : null
  }

  const totalUnread = computed(() => groups.value.reduce((s, g) => s + (g.unread || 0), 0))

  // ── 群列表 ──

  function _speakerName(group, data) {
    if (data.role === 'user') return '我'
    return data.speaker_name
      || group?.members?.find(m => m.id === data.speaker_character_id)?.display_name
      || '角色'
  }

  function _setGroupPreview(data, { image = false } = {}) {
    const group = groups.value.find(g => g.id === data.group_id)
    if (!group) return false
    if (image && group.last_message_id !== data.msg_id) return false

    const content = String(data.content || '').trim()
    group.last_message = `${_speakerName(group, data)}：${image || !content ? '[图片]' : content.slice(0, 80)}`
    if (!image) group.last_message_id = data.id
    if (data.created_at) group.last_message_at = data.created_at
    return true
  }

  function _sortGroups() {
    groups.value.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0))
  }

  async function loadGroups() {
    try {
      const data = await api.listGroups()
      const previous = new Map(groups.value.map(group => [group.id, group]))
      groups.value = (data.groups || []).map(group => {
        const old = previous.get(group.id)
        const session = _getSession(group.id)
        if (!old || !session?.loaded) return group
        return {
          ...group,
          last_message: old.last_message,
          last_message_id: old.last_message_id,
          last_message_at: old.last_message_at,
        }
      })
    } catch (e) {
      console.warn('[groups] loadGroups failed:', e.message)
    }
  }

  async function createGroup(payload) {
    const data = await api.createGroup(payload)
    await loadGroups()
    return data.group
  }

  async function updateGroup(id, payload) {
    const data = await api.updateGroup(id, payload)
    await loadGroups()
    return data.group
  }

  async function deleteGroup(id) {
    await api.deleteGroup(id)
    _sessions.delete(id)
    if (activeGroupId.value === id) {
      activeGroupId.value = null
      messages.value = []
      renderStart.value = 0
    }
    await loadGroups()
  }

  // ── 进入群聊 ──

  async function selectGroup(id) {
    const requestId = ++_selectRequestId
    _flushAggNow()   // 切群前把上一个群未发送的聚合消息立即发出
    const previous = _activeSession()
    if (previous) {
      previous.renderStart = renderStart.value
      if (previous.groupId !== id) previous.imageGate.clear()
    }
    activeGroupId.value = id
    const session = _getSession(id, true)
    messages.value = session.messages
    renderStart.value = session.renderStart
    playing.value = session.playing

    if (session.loaded) {
      scrollSignal.value++
      api.markGroupSeen(id).then(() => {
        if (activeGroupId.value !== id) return
        const g = groups.value.find(g => g.id === id)
        if (g) g.unread = 0
      })
      return
    }

    const data = await api.getGroupMessages(id)
    if (requestId !== _selectRequestId || activeGroupId.value !== id) return
    session.messages.splice(0, session.messages.length, ...(data.messages || []).map(m => ({ ...m, images: parseImages(m.images) })))
    session.renderStart = Math.max(0, session.messages.length - MESSAGE_WINDOW_INITIAL)
    renderStart.value = session.renderStart
    session.seenMsgIds.clear()
    for (const m of session.messages) session.seenMsgIds.add(m.id)
    session.loaded = true
    scrollSignal.value++
    api.markGroupSeen(id).then(() => {
      if (requestId !== _selectRequestId || activeGroupId.value !== id) return
      const g = groups.value.find(g => g.id === id)
      if (g) g.unread = 0
    })
  }

  function leaveGroup() {
    _selectRequestId++
    _flushAggNow()
    const session = _activeSession()
    if (session) {
      session.renderStart = renderStart.value
      session.imageGate.clear()
    }
    if (activeGroupId.value) api.markGroupSeen(activeGroupId.value)
    activeGroupId.value = null
    messages.value = []
    renderStart.value = 0
    playing.value = false
  }

  function expandWindow() {
    if (!hasMoreOlder.value) return
    renderStart.value = Math.max(0, renderStart.value - MESSAGE_WINDOW_EXPAND)
    const session = _activeSession()
    if (session) session.renderStart = renderStart.value
  }

  // ── 播放队列（动态上屏） ──

  function _enqueue(msg) {
    if (!msg) return false
    const session = _getSession(msg.group_id)
    if (!session || !session.loaded) return false
    if (session.seenMsgIds.has(msg.id)) return true
    session.seenMsgIds.add(msg.id)
    session.playQueue.push(msg)
    _drainQueue(session)
    return true
  }
  const ROUND_GAP = 5000

  function _clearImageGates(session = _activeSession()) {
    session?.imageGate.clear()
  }

  async function _drainQueue(session) {
    if (session.playing) return
    session.playing = true
    if (activeGroupId.value === session.groupId) playing.value = true
    try {
      while (session.playQueue.length > 0) {
        // 只有已经上屏的图片消息才能暂停后续分句；提前收到 prompt 不阻塞前面的文本。
        await session.imageGate.waitUntilClear()
        const msg = session.playQueue.shift()
        session.currentPlaying = msg
        // 分句节奏：900~3000ms 按长度递增，逐条推出
        // 流式逐条到达时队列经常被消费空、drain 反复重启，故"首条"按上屏间隔判定而非 drain 会话
        const delay = (Date.now() - session.lastPushAt > ROUND_GAP) ? 0 : 900 + Math.min(2100, (msg.content?.length || 0) * 30)
        if (delay > 0) await new Promise(r => setTimeout(r, delay))
        // 延迟期间，已经上屏的上一条消息可能刚收到 prompt；此时暂停当前分句。
        await session.imageGate.waitUntilClear()
        if (session.messages.some(m => m.id === msg.id)) continue
        session.messages.push({ ...msg, images: parseImages(msg.images) })
        const hasImage = parseImages(msg.images).length > 0
          || ['pending', 'generating', 'retrying', 'done'].includes(msg.genStatus)
        if (hasImage) {
          // 当前群的侧栏预览跟随气泡播放，不跟随提前到达的 SSE。
          const group = groups.value.find(g => g.id === msg.group_id)
          if (group) group.last_message_id = msg.id
          _setGroupPreview({ ...msg, msg_id: msg.id }, { image: true })
        } else {
          _setGroupPreview(msg)
        }
        _sortGroups()
        // 图片任务若提前开始或已经生成，此刻才激活门控；图片完成时会直接展示，不经过遮罩。
        session.imageGate.markVisible(msg.id)
        session.lastPushAt = Date.now()
        if (activeGroupId.value === session.groupId) scrollSignal.value++
      }
    } finally {
      session.currentPlaying = null
      session.playing = false
      if (activeGroupId.value === session.groupId) playing.value = false
    }
  }

  /**
   * 用户打断播放：正在推出的那条作为"+1"照常在间隙中上屏，队列剩余全部抛弃。
   * 返回截断边界 msg id（后端据此删库）；无需截断时返回 null
   */
  function _interruptPlayback() {
    const session = _activeSession()
    if (!session) return null
    const discarded = session.playQueue.splice(0)
    for (const msg of discarded) {
      session.imageGate.discard(msg.id)
    }
    if (discarded.length === 0) return null
    if (session.currentPlaying) return session.currentPlaying.id
    const lastShown = [...session.messages].reverse().find(m => m.role === 'assistant' && typeof m.id === 'number')
    return lastShown ? lastShown.id : null
  }

  // ── 发言（5s 防抖聚合） ──
  // 第一句立即发出；若 5s 内继续发言则进入聚合模式，每发一句刷新 5s 计时，
  // 静默满 5s 后把这期间的消息一次性批量发出，之后回到立即响应状态。

  const AGG_WINDOW = 5000
  let _aggTimer = null
  let _aggItems = []
  let _lastSentAt = 0
  let _dispatchChain = Promise.resolve()   // 串行化请求，避免撞后端每群互斥锁

  function sendMessage(text) {
    const groupId = activeGroupId.value
    if (!groupId || !text.trim()) return
    const session = _getSession(groupId)
    if (!session) return
    lullCount.value = 0   // 用户发言 → 重置冷场自动触发额度
    const clientMsgId = `g${groupId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // 立即上屏用户气泡（乐观更新）
    const tempMsg = {
      id: `temp_${clientMsgId}`, role: 'user', content: text,
      speaker_character_id: null, created_at: new Date().toISOString(), images: [],
    }
    session.messages.push(tempMsg)
    _setGroupPreview({ ...tempMsg, group_id: groupId })
    _sortGroups()
    scrollSignal.value++

    const item = { text, client_msg_id: clientMsgId, tempMsg, groupId }
    const now = Date.now()
    if (_aggTimer || now - _lastSentAt < AGG_WINDOW) {
      // 聚合模式：攒起来，刷新 5s 计时
      _aggItems.push(item)
      clearTimeout(_aggTimer)
      _aggTimer = setTimeout(_flushAgg, AGG_WINDOW)
      _lastSentAt = now
      return
    }
    _lastSentAt = now
    _queueDispatch([item])
  }

  function _flushAgg() {
    _aggTimer = null
    const items = _aggItems.splice(0)
    _lastSentAt = 0   // 批量发出后回到立即响应状态
    if (items.length > 0) _queueDispatch(items)
  }

  /** 切群/离开页面前把聚合中的消息立即发出，避免丢失 */
  function _flushAggNow() {
    if (_aggTimer) {
      clearTimeout(_aggTimer)
      _flushAgg()
    }
  }

  function _undoPendingAggregation() {
    if (_aggItems.length === 0) return null
    clearTimeout(_aggTimer)
    _aggTimer = null
    _lastSentAt = 0
    const pending = _aggItems.splice(0)
    const pendingMessages = new Set(pending.map(item => item.tempMsg))
    const session = _activeSession()
    if (session) {
      for (let i = session.messages.length - 1; i >= 0; i--) {
        if (pendingMessages.has(session.messages[i])) session.messages.splice(i, 1)
      }
    }
    scrollSignal.value++
    return {
      ok: true,
      local: true,
      deleted: { type: 'pending_user_round', raws: 0, messages: pending.length, memories: 0, images: 0 },
    }
  }

  function _queueDispatch(items) {
    _dispatchChain = _dispatchChain.then(() => _dispatch(items)).catch(() => {})
  }

  async function _dispatch(items) {
    const groupId = items[0].groupId
    // 用户打断播放：抛弃未推完的分句，正在推的那条作为"+1"保留，后端同步删库
    const truncateAfterId = groupId === activeGroupId.value ? _interruptPlayback() : null
    sending.value = true
    try {
      const { stream } = api.groupChatStream(
        groupId,
        items.map(i => ({ text: i.text, client_msg_id: i.client_msg_id })),
        truncateAfterId,
      )
      const reader = stream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type !== 'data') continue
        const { event, data } = value
        if (event === 'msg_saved' && data.role === 'user') {
          const matched = items.find(i => i.client_msg_id === data.client_msg_id)
          if (matched) {
            const tempId = matched.tempMsg.id
            matched.tempMsg.id = data.id
            const group = groups.value.find(g => g.id === groupId)
            if (group?.last_message_id === tempId) group.last_message_id = data.id
          }
          _getSession(groupId)?.seenMsgIds.add(data.id)
        } else if (event === 'group_msg') {
          const msg = { ...data, group_id: groupId }
          _enqueue(msg)
        } else if (event === 'group_msg_update') {
          _applyContentUpdate(data)
        } else if (event === 'generate_start' || event === 'generate_progress' || event === 'generate_retrying' || event === 'generate_error') {
          _applyGenState(event, { ...data, group_id: groupId })
        } else if (event === 'generate_done') {
          _applyImages({ ...data, group_id: groupId })
        } else if (event === 'error') {
          console.warn('[groups] chat error:', data.message)
        }
      }
      // 群列预览由 _drainQueue 在气泡真正上屏时逐条更新，
      // 此处不立即重载 DB 最后一句，否则会越过播放队列抢跑。
    } catch (e) {
      console.warn('[groups] sendMessage failed:', e.message)
    } finally {
      sending.value = false
    }
  }

  // ── 冷场续聊 ──

  let _nudging = false
  /** 触发角色继续聊。返回 true 表示后端接受了触发（消息稍后经统一 SSE 到达） */
  async function nudge() {
    const groupId = activeGroupId.value
    if (!groupId || sending.value || _nudging) return false
    _nudging = true
    try {
      const r = await api.nudgeGroup(groupId)
      return !!(r.ok && !r.busy)
    } catch (e) {
      console.warn('[groups] nudge failed:', e.message)
      return false
    } finally {
      _nudging = false
    }
  }

  async function undoLastRound() {
    const groupId = activeGroupId.value
    if (!groupId) throw new Error('当前没有打开群聊')
    if (sending.value || playing.value) throw new Error('当前回复还没有结束，请稍后再撤回')
    if (undoing.value) return null

    undoing.value = true
    try {
      const localResult = _undoPendingAggregation()
      if (localResult) return localResult

      const session = _activeSession()
      if (session) {
        session.playQueue.length = 0
        session.currentPlaying = null
        session.playing = false
      }
      playing.value = false
      _clearImageGates(session)

      const result = await api.undoLastGroupRound(groupId)
      _sessions.delete(groupId)
      activeGroupId.value = null
      await selectGroup(groupId)
      await loadGroups()
      return result
    } finally {
      undoing.value = false
    }
  }

  function _applyContentUpdate(data) {
    const groupId = data.group_id ?? activeGroupId.value
    const session = _getSession(groupId)
    if (!session) return
    const m = session.messages.find(m => m.id === data.id)
    if (m) m.content = data.content
    const q = session.playQueue.find(m => m.id === data.id)
    if (q) q.content = data.content
    const group = groups.value.find(g => g.id === groupId)
    if (group?.last_message_id === data.id) {
      _setGroupPreview({ ...(m || q || data), ...data, group_id: groupId })
    }
  }

  /** 按 msg_id 在已上屏消息、播放队列或正在延迟中的那条里找到目标（队列对象上屏时展开会带上字段） */
  function _findMsg(session, msgId) {
    return session.messages.find(m => m.id === msgId)
      || session.playQueue.find(m => m.id === msgId)
      || (session.currentPlaying && session.currentPlaying.id === msgId ? session.currentPlaying : null)
  }

  /** 图片生成状态 → 挂到消息对象上，供 ImageGenBubble 渲染遮罩/进度/错误（与私聊对齐） */
  function _applyGenState(event, data) {
    const groupId = data.group_id ?? activeGroupId.value
    const session = _getSession(groupId)
    if (!session) return
    const m = _findMsg(session, data.msg_id)
    if (event === 'generate_start') {
      if (!m) return
      if (m.genStatus === 'done' && parseImages(m.images).length > 0) return
      const mode = session.imageGate.start(data.msg_id, session.messages.some(message => message.id === data.msg_id))
      m.genStatus = 'pending'
      // prompt 提前到达时不展示等待遮罩；等图片完成后直接显示成图。
      m.hideImagePending = mode === 'deferred'
      if (session.messages.some(message => message.id === data.msg_id)) {
        _setGroupPreview(data, { image: true })
      }
    } else if (event === 'generate_progress') {
      if (!m) return
      m.genStatus = 'generating'
      if (data.progress !== undefined) m.genProgress = data.progress
    } else if (event === 'generate_retrying') {
      if (!m) return
      m.genStatus = 'retrying'
    } else if (event === 'generate_error') {
      if (m) {
        m.genStatus = 'error'
        m.genError = data.error
        m.hideImagePending = false
      }
      session.imageGate.finish(data.msg_id)
    }
    if (activeGroupId.value === groupId) scrollSignal.value++
  }

  function _applyImages(data) {
    const groupId = data.group_id ?? activeGroupId.value
    const session = _getSession(groupId)
    if (!session) return
    const msgId = data.msg_id
    const m = session.messages.find(m => m.id === msgId)
    if (m) {
      m.images = data.images || []
      m.genStatus = 'done'
      m.hideImagePending = false
      _setGroupPreview(data, { image: true })
    } else {
      const q = _findMsg(session, msgId)
      if (q) {
        q.images = JSON.stringify(data.images || [])
        q.genStatus = 'done'
        q.hideImagePending = false
      }
    }
    // 离开该群后没有 ImageGenBubble 会回报浏览器加载完成，后台队列直接解锁。
    if (!data.images?.length || activeGroupId.value !== groupId) session.imageGate.finish(msgId)
    if (activeGroupId.value === groupId) scrollSignal.value++
  }

  /** ImageGenBubble 确认图片已完成浏览器加载后，恢复后续分句播放。 */
  function markGroupImageLoaded(msgId) {
    _activeSession()?.imageGate.finish(msgId)
    scrollSignal.value++
  }

  // ── 统一 SSE 流（后台闲聊 / 其他页面的群消息） ──

  function connectSSE() {
    if (_unsubs.length > 0) return
    _unsubs.push(onEvent('group_message', (data) => {
      const queued = _enqueue(data)
      if (data.group_id === activeGroupId.value) {
        api.markGroupSeen(data.group_id)
      } else {
        const g = groups.value.find(g => g.id === data.group_id)
        if (g) {
          if (!queued && _setGroupPreview(data)) _sortGroups()
          g.unread = (g.unread || 0) + 1
        } else {
          loadGroups()
        }
      }
    }))
    _unsubs.push(onEvent('group_message_update', _applyContentUpdate))
    _unsubs.push(onEvent('group_created', () => loadGroups()))
    _unsubs.push(onEvent('group_round_undone', (data) => {
      const wasActive = data.group_id === activeGroupId.value
      _sessions.delete(data.group_id)
      if (wasActive && !undoing.value) {
        activeGroupId.value = null
        selectGroup(data.group_id)
      }
      loadGroups()
    }))
    _unsubs.push(onEvent('group_image_start', (data) => {
      if (_getSession(data.group_id)) _applyGenState('generate_start', data)
      else _setGroupPreview(data, { image: true })
    }))
    _unsubs.push(onEvent('group_image_done', (data) => {
      if (_getSession(data.group_id)) _applyImages(data)
      else _setGroupPreview(data, { image: true })
    }))
    _unsubs.push(onEvent('group_image_error', (data) => {
      if (_getSession(data.group_id)) _applyGenState('generate_error', data)
    }))
  }

  function disconnectSSE() {
    for (const un of _unsubs) un()
    _unsubs = []
  }

  return {
    groups, activeGroupId, activeGroup, messages, visibleMessages, hasMoreOlder,
    playing, sending, undoing, scrollSignal, totalUnread, lullCount,
    loadGroups, createGroup, updateGroup, deleteGroup,
    selectGroup, leaveGroup, expandWindow, sendMessage, nudge, undoLastRound,
    connectSSE, disconnectSSE, markGroupImageLoaded,
  }
})

function parseImages(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) || [] } catch { return [] }
}

function createGroupImagePlaybackGate() {
  const pending = new Map()
  const visible = new Set()
  let waiters = []

  function wakeWaiters() {
    if (visible.size > 0) return
    const current = waiters
    waiters = []
    for (const resolve of current) resolve()
  }

  return {
    start(msgId, isVisible = false) {
      const existing = pending.get(msgId)
      if (existing) return existing.mode

      const mode = isVisible ? 'overlay' : 'deferred'
      pending.set(msgId, { mode })
      if (isVisible) visible.add(msgId)
      return mode
    },

    markVisible(msgId) {
      if (pending.has(msgId)) visible.add(msgId)
    },

    finish(msgId) {
      pending.delete(msgId)
      visible.delete(msgId)
      wakeWaiters()
    },

    discard(msgId) {
      pending.delete(msgId)
      visible.delete(msgId)
      wakeWaiters()
    },

    clear() {
      pending.clear()
      visible.clear()
      wakeWaiters()
    },

    async waitUntilClear() {
      while (visible.size > 0) {
        await new Promise(resolve => waiters.push(resolve))
      }
    },
  }
}
