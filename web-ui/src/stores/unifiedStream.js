/**
 * 统一 SSE 连接管理器
 *
 * 替代 3 个独立 SSE 长连接（events / moments / notifications），
 * 复用单一 HTTP 连接接收所有事件。Store 通过 onEvent/offEvent 订阅。
 *
 * 重连策略：断开后立即重连，指数退避 1s→2s→4s→8s→16s→30s(max)，
 * 成功连接后重置退避。关闭期间丢失的事件由各 store 的 30s poll timer 兜底。
 *
 * 使用方式：
 *   import { onEvent, startUnifiedStream, stopUnifiedStream } from './unifiedStream.js'
 *   onEvent('new_event', (data) => { ... })
 *   // NavBar onMounted: startUnifiedStream()
 *   // NavBar onUnmounted: stopUnifiedStream()
 */

import * as api from '../api/index.js'

const BACKOFF_INITIAL = 1000   // 首次重连等待 1s
const BACKOFF_MAX = 30000      // 最大退避 30s
const BACKOFF_MULTIPLIER = 2

let _conn = null
let _reconnectTimer = null
let _stableTimer = null
let _started = false
let _backoff = BACKOFF_INITIAL

/** Map<eventType, Set<handler>> */
const _handlers = new Map()

/**
 * 订阅特定 SSE 事件类型
 * @param {string} eventType - 如 'new_event', 'event_update', 'new_post', 'proactive_message'
 * @param {Function} handler - (data) => void
 * @returns {Function} 取消订阅函数
 */
export function onEvent(eventType, handler) {
  if (!_handlers.has(eventType)) _handlers.set(eventType, new Set())
  _handlers.get(eventType).add(handler)
  return () => {
    const set = _handlers.get(eventType)
    if (set) set.delete(handler)
  }
}

/** @deprecated 别名，向后兼容 */
export const offEvent = (eventType, handler) => {
  const set = _handlers.get(eventType)
  if (set) set.delete(handler)
}

function _dispatch(eventType, data) {
  const handlers = _handlers.get(eventType)
  if (handlers) {
    for (const fn of handlers) {
      try { fn(data) } catch (e) { console.warn('[unifiedSSE] handler error:', eventType, e) }
    }
  }
}

/** 创建 SSE 连接并注册 onClose 回调。
 *  收到 'connected' 事件后启动 15s 稳定计时器，到时重置退避。*/
function _connect() {
  if (_conn && !_conn._closed) _conn.close()

  _conn = api.connectUnifiedStream({
    connected:         () => { _stableTimer = setTimeout(_onStable, 15000) },
    new_event:         d => _dispatch('new_event', d),
    event_update:      d => _dispatch('event_update', d),
    event_concluded:   d => _dispatch('event_concluded', d),
    event_expired:     d => _dispatch('event_expired', d),
    event_urgency:     d => _dispatch('event_urgency', d),
    new_post:          d => _dispatch('new_post', d),
    proactive_message: d => _dispatch('proactive_message', d),
  }, {
    onClose: _scheduleReconnect,
  })
}

/** 连接持续稳定 15s → 重置退避时间 */
function _onStable() {
  _backoff = BACKOFF_INITIAL
}

/** 断开后立即调度重连（指数退避 1s→2s→4s→...→30s） */
function _scheduleReconnect() {
  if (!_started) return
  if (_reconnectTimer) clearTimeout(_reconnectTimer)
  if (_stableTimer) { clearTimeout(_stableTimer); _stableTimer = null }

  console.log(`[unifiedSSE] disconnected, reconnecting in ${(_backoff / 1000).toFixed(0)}s...`)
  _reconnectTimer = setTimeout(() => {
    if (!_started) return
    _connect()
  }, _backoff)

  _backoff = Math.min(_backoff * BACKOFF_MULTIPLIER, BACKOFF_MAX)
}

/** 启动统一 SSE 连接（NavBar onMounted 调用一次） */
export function startUnifiedStream() {
  if (_started) return
  _started = true
  _backoff = BACKOFF_INITIAL
  _connect()
}

/** 停止统一 SSE 连接（NavBar onUnmounted 调用） */
export function stopUnifiedStream() {
  _started = false
  _backoff = BACKOFF_INITIAL
  if (_conn) { _conn.close(); _conn = null }
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
  if (_stableTimer) { clearTimeout(_stableTimer); _stableTimer = null }
}
