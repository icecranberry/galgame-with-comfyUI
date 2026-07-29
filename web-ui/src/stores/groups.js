/**
 * 群聊 store
 *
 * - 群列表 / 当前群消息 / 未读红点
 * - 播放队列：后端一次性推来的多条剧本消息，前端按打字延迟逐条上屏（"xx 正在输入…"）
 * - SSE：发言走 groupChatStream 直连流；后台闲聊/其他页面经统一流 group_message 到达
 * - 消息 id 去重：直连流 + 统一流会重复收到同一条消息
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'
import { onEvent } from './unifiedStream.js'

export const useGroupsStore = defineStore('groups', () => {
  const groups = ref([])
  const activeGroupId = ref(null)
  const activeGroup = computed(() => groups.value.find(g => g.id === activeGroupId.value) || null)
  const messages = ref([])          // 已上屏消息
  const playing = ref(false)        // 播放队列是否正在逐条上屏
  const sending = ref(false)
  const undoing = ref(false)
  const scrollSignal = ref(0)       // 消息上屏后通知视图滚动到底
  const lullCount = ref(0)          // 前台冷场自动触发计数：跨群/跨路由不重置，仅用户发言时归零

  const _seenMsgIds = new Set()
  const _playQueue = []
  const _pendingImageMsgIds = new Set()
  let _imageGateWaiters = []
  let _playing = false
  let _unsubs = []

  const totalUnread = computed(() => groups.value.reduce((s, g) => s + (g.unread || 0), 0))

  // ── 群列表 ──

  async function loadGroups() {
    try {
      const data = await api.listGroups()
      groups.value = data.groups || []
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
    if (activeGroupId.value === id) {
      activeGroupId.value = null
      messages.value = []
    }
    await loadGroups()
  }

  // ── 进入群聊 ──

  async function selectGroup(id) {
    _flushAggNow()   // 切群前把上一个群未发送的聚合消息立即发出
    _clearImageGates()
    activeGroupId.value = id
    messages.value = []
    _seenMsgIds.clear()
    _playQueue.length = 0
    const data = await api.getGroupMessages(id)
    messages.value = (data.messages || []).map(m => ({ ...m, images: parseImages(m.images) }))
    for (const m of messages.value) _seenMsgIds.add(m.id)
    scrollSignal.value++
    api.markGroupSeen(id).then(() => {
      const g = groups.value.find(g => g.id === id)
      if (g) g.unread = 0
    })
  }

  function leaveGroup() {
    _flushAggNow()
    _clearImageGates()
    if (activeGroupId.value) api.markGroupSeen(activeGroupId.value)
    activeGroupId.value = null
    messages.value = []
    _playQueue.length = 0
  }

  // ── 播放队列（动态上屏） ──

  function _enqueue(msg) {
    // 不属于当前群的消息不入队（切群后直连流仍在推送）；不记 seen，统一流到达时走未读计数
    if (!msg || msg.group_id !== activeGroupId.value) return
    if (_seenMsgIds.has(msg.id)) return
    _seenMsgIds.add(msg.id)
    _playQueue.push(msg)
    _drainQueue()
  }

  let _currentPlaying = null  // 正在延迟中、即将上屏的那条（打断时作为"+1"保留）
  let _lastPushAt = 0         // 上一条分句上屏时刻：距上条超 5s 视为新一轮首条，免延迟
  const ROUND_GAP = 5000

  function _wakeImageGateWaiters() {
    const waiters = _imageGateWaiters
    _imageGateWaiters = []
    for (const resolve of waiters) resolve()
  }

  function _clearImageGates() {
    _pendingImageMsgIds.clear()
    _wakeImageGateWaiters()
  }

  function _hasBlockingImage(allowedMsgId) {
    const firstPendingId = _pendingImageMsgIds.values().next().value
    return firstPendingId !== undefined && firstPendingId !== allowedMsgId
  }

  async function _waitForImageGate(allowedMsgId) {
    while (_hasBlockingImage(allowedMsgId)) {
      await new Promise(resolve => _imageGateWaiters.push(resolve))
    }
  }

  async function _drainQueue() {
    if (_playing) return
    _playing = true
    playing.value = true
    try {
      while (_playQueue.length > 0) {
        const msg = _playQueue.shift()
        _currentPlaying = msg
        // 出队时已切群 → 丢弃（DB 已持久化，回到该群时 selectGroup 会重新加载）
        if (msg.group_id !== activeGroupId.value) continue
        // 图片生成期间只允许对应的图片消息上屏，后续分句等待图片实际加载完成。
        await _waitForImageGate(msg.id)
        // 分句节奏：700~1800ms 按长度递增，逐条推出
        // 流式逐条到达时队列经常被消费空、drain 反复重启，故"首条"按上屏间隔判定而非 drain 会话
        const delay = (Date.now() - _lastPushAt > ROUND_GAP) ? 0 : 700 + Math.min(1100, (msg.content?.length || 0) * 30)
        if (delay > 0) await new Promise(r => setTimeout(r, delay))
        // 延迟期间可能刚开始生图，上屏前再次检查门控。
        await _waitForImageGate(msg.id)
        // 延迟期间可能切了群，上屏前二次校验；快速切走又切回时 selectGroup 已从 DB 载入，按 id 去重
        if (msg.group_id !== activeGroupId.value) continue
        if (messages.value.some(m => m.id === msg.id)) continue
        messages.value.push({ ...msg, images: parseImages(msg.images) })
        _lastPushAt = Date.now()
        scrollSignal.value++
      }
    } finally {
      _currentPlaying = null
      _playing = false
      playing.value = false
    }
  }

  /**
   * 用户打断播放：正在推出的那条作为"+1"照常在间隙中上屏，队列剩余全部抛弃。
   * 返回截断边界 msg id（后端据此删库）；无需截断时返回 null
   */
  function _interruptPlayback() {
    const discarded = _playQueue.splice(0)
    let gateChanged = false
    for (const msg of discarded) {
      if (_pendingImageMsgIds.delete(msg.id)) gateChanged = true
    }
    if (gateChanged) _wakeImageGateWaiters()
    if (discarded.length === 0) return null
    if (_currentPlaying) return _currentPlaying.id
    const lastShown = [...messages.value].reverse().find(m => m.role === 'assistant' && typeof m.id === 'number')
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
    lullCount.value = 0   // 用户发言 → 重置冷场自动触发额度
    const clientMsgId = `g${groupId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // 立即上屏用户气泡（乐观更新）
    const tempMsg = {
      id: `temp_${clientMsgId}`, role: 'user', content: text,
      speaker_character_id: null, created_at: new Date().toISOString(), images: [],
    }
    messages.value.push(tempMsg)
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
    messages.value = messages.value.filter(message => !pendingMessages.has(message))
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
          if (matched) matched.tempMsg.id = data.id
          _seenMsgIds.add(data.id)
        } else if (event === 'group_msg') {
          _enqueue({ ...data, group_id: groupId })
        } else if (event === 'group_msg_update') {
          _applyContentUpdate(data)
        } else if (event === 'generate_start' || event === 'generate_progress' || event === 'generate_retrying' || event === 'generate_error') {
          _applyGenState(event, data)
        } else if (event === 'generate_done') {
          _applyImages(data)
        } else if (event === 'error') {
          console.warn('[groups] chat error:', data.message)
        }
      }
      // 刷新群列表排序（last_message_at 变了）
      loadGroups()
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

      _playQueue.length = 0
      _currentPlaying = null
      _playing = false
      playing.value = false
      _clearImageGates()

      const result = await api.undoLastGroupRound(groupId)
      await selectGroup(groupId)
      await loadGroups()
      return result
    } finally {
      undoing.value = false
    }
  }

  function _applyContentUpdate(data) {
    const m = messages.value.find(m => m.id === data.id)
    if (m) m.content = data.content
    const q = _playQueue.find(m => m.id === data.id)
    if (q) q.content = data.content
  }

  /** 按 msg_id 在已上屏消息、播放队列或正在延迟中的那条里找到目标（队列对象上屏时展开会带上字段） */
  function _findMsg(msgId) {
    return messages.value.find(m => m.id === msgId)
      || _playQueue.find(m => m.id === msgId)
      || (_currentPlaying && _currentPlaying.id === msgId ? _currentPlaying : null)
  }

  /** 图片生成状态 → 挂到消息对象上，供 ImageGenBubble 渲染遮罩/进度/错误（与私聊对齐） */
  function _applyGenState(event, data) {
    const m = _findMsg(data.msg_id)
    if (event === 'generate_start') {
      if (!m) return
      if (m.genStatus === 'done' && parseImages(m.images).length > 0) return
      _pendingImageMsgIds.add(data.msg_id)
      m.genStatus = 'pending'
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
      }
      if (_pendingImageMsgIds.delete(data.msg_id)) _wakeImageGateWaiters()
    }
    scrollSignal.value++
  }

  function _applyImages(data) {
    const msgId = data.msg_id
    const m = messages.value.find(m => m.id === msgId)
    if (m) {
      m.images = data.images || []
      m.genStatus = 'done'
    } else {
      const q = _findMsg(msgId)
      if (q) { q.images = JSON.stringify(data.images || []); q.genStatus = 'done' }
    }
    if (!data.images?.length && _pendingImageMsgIds.delete(msgId)) _wakeImageGateWaiters()
    scrollSignal.value++
  }

  /** ImageGenBubble 确认图片已完成浏览器加载后，恢复后续分句播放。 */
  function markGroupImageLoaded(msgId) {
    if (_pendingImageMsgIds.delete(msgId)) _wakeImageGateWaiters()
    scrollSignal.value++
  }

  // ── 统一 SSE 流（后台闲聊 / 其他页面的群消息） ──

  function connectSSE() {
    if (_unsubs.length > 0) return
    _unsubs.push(onEvent('group_message', (data) => {
      if (data.group_id === activeGroupId.value) {
        _enqueue(data)
        api.markGroupSeen(data.group_id)
      } else {
        const g = groups.value.find(g => g.id === data.group_id)
        if (g) {
          g.unread = (g.unread || 0) + 1
          g.last_message_at = data.created_at
          groups.value.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0))
        } else {
          loadGroups()
        }
      }
    }))
    _unsubs.push(onEvent('group_created', () => loadGroups()))
    _unsubs.push(onEvent('group_round_undone', (data) => {
      if (data.group_id === activeGroupId.value && !undoing.value) selectGroup(data.group_id)
      loadGroups()
    }))
    _unsubs.push(onEvent('group_image_start', (data) => _applyGenState('generate_start', data)))
    _unsubs.push(onEvent('group_image_done', (data) => _applyImages(data)))
    _unsubs.push(onEvent('group_image_error', (data) => _applyGenState('generate_error', data)))
  }

  function disconnectSSE() {
    for (const un of _unsubs) un()
    _unsubs = []
  }

  return {
    groups, activeGroupId, activeGroup, messages, playing, sending, undoing, scrollSignal, totalUnread, lullCount,
    loadGroups, createGroup, updateGroup, deleteGroup,
    selectGroup, leaveGroup, sendMessage, nudge, undoLastRound,
    connectSSE, disconnectSSE, markGroupImageLoaded,
  }
})

function parseImages(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) || [] } catch { return [] }
}
