/**
 * 角色操作反馈——事件契约与集中派发。
 *
 * 公共组件 / 业务成功分支只调用 `dispatchCharacterObservation()` 送出一条最小语义事件；
 * 本模块负责标准化、白名单校验、有界短期观察与订阅分发。
 * 规则判断、冷却、抽签在 characterReactionRules.js；这里不做展示决策。
 * 见 docs/character-reaction-notification-plan.md §5.1 / §5.3 / §5.4。
 */

import { CATALOG, SCHEMA_VERSION, isKnownEventType, isSupportedActor, parseActorKey, normalizeResourceId } from './characterReactionRules.js'

/** 事件来源白名单 */
export const ALLOWED_SOURCES = Object.freeze([
  'town-building-feature',
  'character-pin',
  'character-avatar',
  'character-display-name',
  'moments-store',
  'backpack-store',
  'mailbox-view',
  'schedule-view',
  'relationship-editor',
])

/** subject.kind 白名单 */
export const ALLOWED_SUBJECT_KINDS = Object.freeze(['building-operation', 'moment', 'letter', 'character', 'outfit', 'schedule', 'relationship'])

/** outcome 白名单：requested 只表示发起，不表示完成 */
export const ALLOWED_OUTCOMES = Object.freeze(['requested', 'saved', 'confirmed', 'applied'])

export const MAX_EVENT_BYTES = 2 * 1024
export const MAX_OBSERVATIONS = 50
export const OBSERVATION_TTL_MS = 10 * 60_000

let _seq = 0
/** 测试用：重置采集序号 */
export function __resetSequence() { _seq = 0 }

function newEventId() {
  _seq += 1
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* 非浏览器环境退化为序号 id */ }
  return `coe-${Date.now().toString(36)}-${_seq}`
}

/**
 * 标准化一条事件。返回 `{ ok, event }` 或 `{ ok: false, reason }`。
 * 身份未知、类型未知、字段非法一律不进入展示队列（§5.3）。
 */
export function normalizeCharacterObservation(input = {}, options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const type = String(input.type || '')
  if (!isKnownEventType(type)) return { ok: false, reason: 'unknown-type' }

  const source = String(input.source || '')
  if (!ALLOWED_SOURCES.includes(source)) return { ok: false, reason: 'unknown-source' }

  const actor = parseActorKey(input.actorKey)
  if (!actor) return { ok: false, reason: 'unknown-actor' }
  // 只支持正式角色：小镇 / 轻量 NPC 身份在采集层就被拒绝，避免影子身份与正式角色各弹一次（§2.4）
  if (!isSupportedActor(actor.key)) return { ok: false, reason: 'unsupported-actor' }

  const initiator = input.initiator === 'system' || input.initiator === 'auto' ? 'auto' : 'user'

  const subjectInput = input.subject || {}
  const kind = String(subjectInput.kind || '')
  if (!ALLOWED_SUBJECT_KINDS.includes(kind)) return { ok: false, reason: 'unknown-subject-kind' }

  const rawId = subjectInput.id !== undefined && subjectInput.id !== null ? String(subjectInput.id) : ''
  if (!rawId) return { ok: false, reason: 'missing-subject-id' }

  const outcome = String(input.outcome || 'confirmed')
  if (!ALLOWED_OUTCOMES.includes(outcome)) return { ok: false, reason: 'unknown-outcome' }

  const occurredAtMs = Number.isFinite(input.occurredAtMs) ? input.occurredAtMs : now()
  const payload = {}
  for (const [key, value] of Object.entries(input.payload || {})) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      // payload 只放短字段：不放 base64、完整聊天、输入草稿或整个角色对象（§5.3）
      if (value.length > 200) return { ok: false, reason: 'payload-field-too-large' }
      payload[key] = value
    } else if (typeof value === 'number' || typeof value === 'boolean') payload[key] = value
  }

  const related = Array.isArray(subjectInput.relatedActorKeys)
    ? subjectInput.relatedActorKeys
      .map(k => parseActorKey(k))
      .filter(Boolean)
      .map(k => k.key)
    : [actor.key]

  const event = {
    schemaVersion: SCHEMA_VERSION,
    eventId: String(input.eventId || newEventId()),
    type,
    occurredAt: new Date(occurredAtMs).toISOString(),
    occurredAtMs,
    sourceTabId: String(input.sourceTabId || ''),
    source,
    initiator,
    actorKey: actor.key,
    actorKind: actor.kind,
    actorName: String(input.actorName || '').slice(0, 40),
    worldId: input.worldId ? String(input.worldId).slice(0, 64) : null,
    subject: {
      kind,
      id: normalizeResourceId(rawId) || rawId,
      relatedActorKeys: related,
    },
    operationId: String(input.operationId || input.eventId || `${type}-${occurredAtMs}`).slice(0, 120),
    outcome,
    payload,
  }

  // 单条序列化事件目标上限 2 KiB（§5.3）
  try {
    if (JSON.stringify(event).length > MAX_EVENT_BYTES) return { ok: false, reason: 'event-too-large' }
  } catch {
    return { ok: false, reason: 'event-not-serializable' }
  }

  return { ok: true, event }
}

/**
 * 创建观察总线：有界短期观察（默认 50 条 / TTL 10 分钟）+ 当前会话最近 3 次有效操作环形摘要。
 * 只保存短期内存记录，不写数据库、聊天记录或长期记忆（§1）。
 */
export function createObservationBus(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const maxObservations = options.maxObservations || MAX_OBSERVATIONS
  const ttlMs = options.ttlMs || OBSERVATION_TTL_MS
  const historyLimit = options.historyLimit ?? 3
  const historyTtlMs = options.historyTtlMs ?? 24 * 3600_000

  const observations = []
  const history = []
  const listeners = new Set()
  let paused = false
  let disposeReactives = []

  function prune(t) {
    while (observations.length > 0 && t - observations[0].occurredAtMs > ttlMs) observations.shift()
    while (observations.length > maxObservations) observations.shift()
    while (history.length > 0 && t - history[0].occurredAtMs > historyTtlMs) history.shift()
    while (history.length > historyLimit) history.shift()
  }

  /**
   * 送出一条事件。返回 `{ ok, event }` 或 `{ ok:false, reason }`。
   * paused（模态阻塞 / 软键盘 / 演出中）时只记录上下文，不派发展示（§2.5）。
   */
  function dispatch(input) {
    const t = now()
    const normalized = normalizeCharacterObservation(input, { now })
    if (!normalized.ok) return normalized
    const event = normalized.event
    if (paused && event.initiator !== 'user') return { ok: false, reason: 'paused' }
    observations.push(event)
    prune(t)
    for (const listener of listeners) {
      try { listener(event) } catch (err) { console.error('[character-observation] listener failed:', err) }
    }
    return { ok: true, event, paused }
  }

  /**
   * 把一次操作追加进会话环形摘要，并返回追加前的快照（最多 3 条，§5.4）。
   * 当前操作不会被算进历史。
   */
  function commitHistory(event) {
    const t = now()
    prune(t)
    const snapshot = history.slice(-historyLimit)
    history.push({
      type: event.type,
      content: String(event.payload?.summary || CATALOG[event.type]?.summary || event.type).slice(0, 120),
      actorKey: event.actorKey,
      occurredAtMs: event.occurredAtMs,
      worldId: event.worldId || null,
      feedbackShown: !!event.payload?.feedbackShown,
    })
    prune(t)
    return snapshot
  }

  function markFeedbackShown(actorKey, occurredAtMs) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].actorKey === actorKey && history[i].occurredAtMs === occurredAtMs) {
        history[i].feedbackShown = true
        return true
      }
    }
    return false
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function setPaused(value) {
    paused = !!value
  }

  function isPaused() { return paused }

  function recentObservations() { prune(now()); return observations.slice() }

  function recentHistory() { prune(now()); return history.slice() }

  function clear() {
    observations.length = 0
    history.length = 0
  }

  /** 页面卸载 / 热更新时清理订阅与计时器（§5.4） */
  function dispose() {
    listeners.clear()
    clear()
    for (const fn of disposeReactives) { try { fn() } catch { /* 已失效 */ } }
    disposeReactives = []
  }

  function addDisposer(fn) { if (typeof fn === 'function') disposeReactives.push(fn) }

  return {
    dispatch, subscribe, commitHistory, markFeedbackShown,
    setPaused, isPaused, recentObservations, recentHistory, clear, dispose, addDisposer,
    get size() { return observations.length },
  }
}

/** 应用级单例：主应用宿主与适配器共用 */
export const characterObservationBus = createObservationBus()

/** 组件侧唯一入口；返回标准化结果，便于测试断言失败原因 */
export function dispatchCharacterObservation(input) {
  return characterObservationBus.dispatch(input)
}

/**
 * 生成去重用的规范资源标识：去掉 cache-bust 参数（§5.3）。
 * 不把文件修改时间当作照片生成时间，因此这里只做 URL 规范化。
 */
export function observationResourceId(url) {
  return normalizeResourceId(url)
}
