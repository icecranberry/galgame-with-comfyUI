/**
 * 角色操作反馈 —— 前端状态与调度宿主。
 *
 * 职责：
 *   · 内置配置：始终开启、15% 概率、显示 8 秒，不读取旧本地设置
 *   · 观察总线订阅、候选队列、单条展示状态与倒计时
 *   · 素材缓存（该角色启用表情包配置单里已完成的图片 → 类别语义映射 → 头像回退）
 *   · 即时反应在途请求、4 秒超时、8 秒失效与迟到结果丢弃
 *
 * 不做：业务成功判定（由适配器负责）、提示词组装（由后端负责）。
 * 见 docs/character-reaction-notification-plan.md §3 / §5.4 / §6 / §7.1。
 */

import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import * as api from '../api/index.js'
import { characterObservationBus } from '../utils/characterObservationEvents.js'
import { playReactionSound } from '../utils/characterReactionSound.js'
import {
  CATALOG,
  DEFAULT_CONFIG,
  createReactionEngine,
  markerKeyForEmotion,
  parseActorKey,
  parseMarkers,
} from '../utils/characterReactionRules.js'

const DEDUPE_KEY = 'linshe_character_reaction_dedupe'

function readDedupeLedger() {
  try {
    const raw = sessionStorage.getItem(DEDUPE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch { return null }
}

/** 已展示的「同资源日内一次」摘要可写入 sessionStorage：带到期日，不保存事件正文（§5.4） */
function writeDedupeLedger(dedupeMap) {
  try {
    const day = new Date().toLocaleDateString('sv-SE')
    const out = {}
    for (const [key, rec] of Object.entries(dedupeMap || {})) {
      // 只持久化「本地日内一次」这类摘要；纯时间窗口记录不落盘（§5.4）
      if (rec?.day === day) out[key] = { day: rec.day }
    }
    sessionStorage.setItem(DEDUPE_KEY, JSON.stringify(out))
  } catch { /* 忽略 */ }
}

export const useCharacterReactionsStore = defineStore('characterReactions', () => {
  const config = Object.freeze({ ...DEFAULT_CONFIG, categoryEnabled: Object.freeze({ ...DEFAULT_CONFIG.categoryEnabled }) })

  const engine = createReactionEngine({ config: { ...config } })

  /** 展示中的卡片：右下角可叠多条，从下往上顶 */
  const shown = ref([])             // [{ id, actorKey, name, text, emotion, mediaUrl, mediaKind, source, duration, ... }]
  const pending = ref(null)         // 阻塞期间最多保留 1 条候选（§6.1）
  const blocked = ref(false)
  const sceneBlocked = ref(false)   // 由宿主维护的场景遮挡（弹窗 / 演出 / 系统 Toast）
  const paused = ref(false)
  const materials = reactive({})    // actorKey -> { name, avatarUrl, items: [{ key, url }], loadedAt }
  const lastError = ref('')

  let pendingTimer = null
  let disposed = false
  let _unsubscribe = null
  let _id = 0

  const enabled = computed(() => config.enabled)
  const categories = computed(() => Object.entries(CATALOG).reduce((acc, [type, spec]) => {
    if (!acc[spec.category]) acc[spec.category] = { key: spec.category, types: [] }
    acc[spec.category].types.push(type)
    return acc
  }, {}))

  // ── 素材（§3.3）──

  function cachedMaterials(actorKey) {
    return materials[actorKey] || null
  }

  function shouldRefreshMaterials(entry) {
    if (!entry) return true
    return Date.now() - (entry.loadedAt || 0) > 5 * 60_000
  }

  /**
   * 只加载本次候选需要的素材；图片缺失不会触发任何生成任务（§3.3-6）。
   * 失败静默，回退头像 → 首字占位。
   */
  async function ensureMaterials(actorKey) {
    const parsed = parseActorKey(actorKey)
    if (!parsed || parsed.kind !== 'character') return null
    const cached = materials[actorKey]
    if (!shouldRefreshMaterials(cached)) return cached
    if (cached?.loading) return cached
    materials[actorKey] = { ...(cached || {}), loading: true }
    try {
      const data = await api.getCharacterReactionAssets(parsed.id)
      const items = Array.isArray(data?.emojis) ? data.emojis.filter(e => e && e.url) : []
      const entry = {
        name: String(data?.display_name || data?.name || cached?.name || '角色'),
        avatarUrl: data?.avatar_url || null,
        items,
        hasEmoji: items.length > 0,
        loadedAt: Date.now(),
        loading: false,
      }
      materials[actorKey] = entry
      return entry
    } catch (err) {
      lastError.value = err?.message || '素材加载失败'
      materials[actorKey] = { ...(cached || {}), loading: false, loadedAt: Date.now() }
      return materials[actorKey]
    }
  }

  /** 语义 → 表情类别映射：不依赖固定数字 ID 或永久中文名，可被用户改名/删除（§3.3-3） */
  /**
   * 表情选择：优先用模型从该角色「可用表情」里选的 emojiKey（必须精确命中类别名）；
   * 缓存短句没有 key，则按 emotion 映射语义标记匹配。都没有就回退头像 / 首字，
   * 且只从该角色自己的表情包列表里取，永不使用别的角色的表情。
   */
  function mediaFor(entry, { emojiKey = '', emotion = 'neutral' } = {}) {
    if (!entry) return null
    const items = Array.isArray(entry.items) ? entry.items.filter(item => item && item.url) : []
    if (items.length > 0) {
      let hit = emojiKey ? items.find(item => item.key === emojiKey) : null
      if (!hit && emotion) {
        const wanted = markerKeyForEmotion(emotion)
        hit = items.find(item => item.key === wanted) || items.find(item => item.marker === wanted)
      }
      if (hit?.url) return { kind: 'emoji', url: hit.url }
    }
    if (entry.avatarUrl) return { kind: 'avatar', url: entry.avatarUrl }
    return { kind: 'initial', url: null }
  }

  //  候选与展示（可叠多条，右下角从下往上顶）

  const cardTimers = new Map()   // cardId -> timeout

  function clearTimers() {
    for (const timer of cardTimers.values()) clearTimeout(timer)
    cardTimers.clear()
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
  }

  function clearPending() {
    pending.value = null
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
  }

  function clearAll() {
    clearTimers()
    pending.value = null
    shown.value = []
  }

  function remainingMs() {
    return Math.max(600, Number(config.displayDuration) || DEFAULT_CONFIG.displayDuration)
  }

  function removeCard(id) {
    const timer = cardTimers.get(id)
    if (timer) { clearTimeout(timer); cardTimers.delete(id) }
    shown.value = shown.value.filter(card => card.id !== id)
    maybeShowPending()
  }

  /** 某条卡片退场：先标记 leaving，动画结束后移除 */
  function dismissCard(id) {
    const card = shown.value.find(item => item.id === id)
    if (!card || card.leaving) return
    const timer = cardTimers.get(id)
    if (timer) { clearTimeout(timer); cardTimers.delete(id) }
    shown.value = shown.value.map(item => item.id === id ? { ...item, leaving: true } : item)
    setTimeout(() => removeCard(id), 320)
  }

  /** 关闭：默认关掉最新（最下面）的一条，也可以指定 id */
  function dismissDisplay(id = null) {
    const card = id === null ? shown.value[shown.value.length - 1] : shown.value.find(item => item.id === id)
    if (card) dismissCard(card.id)
  }

  /** 悬停 / 键盘焦点在卡片内时暂停该卡片计时（3.1） */
  function pauseDisplay(id = null) {
    const card = id === null ? shown.value[shown.value.length - 1] : shown.value.find(item => item.id === id)
    if (!card || card.leaving) return
    const timer = cardTimers.get(card.id)
    if (timer) { clearTimeout(timer); cardTimers.delete(card.id) }
    const elapsed = Date.now() - Number(card.startedAt || Date.now())
    const remaining = Math.max(600, Number(card._remaining || card.duration || remainingMs()) - elapsed)
    shown.value = shown.value.map(item => item.id === card.id ? { ...item, _remaining: remaining } : item)
  }

  function resumeDisplay(id = null) {
    const card = id === null ? shown.value[shown.value.length - 1] : shown.value.find(item => item.id === id)
    if (!card || card.leaving || cardTimers.has(card.id)) return
    const remaining = Math.max(600, Number(card._remaining) || card.duration || remainingMs())
    shown.value = shown.value.map(item => item.id === card.id ? { ...item, startedAt: Date.now() } : item)
    cardTimers.set(card.id, setTimeout(() => dismissCard(card.id), remaining))
  }

  /** 素材加载失败：表情包  头像  首字占位（3.3-4），不重置计时 */
  function demoteMedia(id = null) {
    const card = id === null ? shown.value[shown.value.length - 1] : shown.value.find(item => item.id === id)
    if (!card) return
    const entry = materials[card.actorKey]
    const patch = (card.mediaKind === 'emoji' && entry?.avatarUrl)
      ? { mediaKind: 'avatar', mediaUrl: entry.avatarUrl }
      : { mediaKind: 'initial', mediaUrl: null }
    shown.value = shown.value.map(item => item.id === card.id ? { ...item, ...patch } : item)
  }

  /** 兼容旧宿主：渐出流程已由 dismissCard 内部完成 */
  function finishDismiss() { /* no-op */ }

  /**
   * 展示一条候选：先做资格终检（异步返回后同样走这里），再加载素材并展示。
   * @param {object} candidate `{ event, text, emotion, source, actorKey, name }`
   */
  async function present(candidate) {
    if (!candidate?.text) return false
    if (!candidate.event || !engine.stillValid(candidate.event)) return false
    const actorKey = candidate.actorKey || candidate.event?.actorKey
    const entry = await ensureMaterials(actorKey)
    if (disposed) return false
    if (!config.enabled) return false
    if (blocked.value || sceneBlocked.value) {
      // 遮罩 / 演出 / 系统 Toast 打开期间只保留最新候选，8 秒失效（3.2 / 6.1）
      pending.value = candidate
      if (pendingTimer) clearTimeout(pendingTimer)
      pendingTimer = setTimeout(() => { pending.value = null; pendingTimer = null }, config.blockedCandidateTtlMs)
      return false
    }
    // 超过堆叠上限：让最旧的一条先退场
    const maxCards = Math.max(1, Number(config.maxStack) || 3)
    while (shown.value.filter(card => !card.leaving).length >= maxCards) {
      const oldest = shown.value.find(card => !card.leaving)
      if (!oldest) break
      dismissCard(oldest.id)
    }
    const parsed = parseMarkers(candidate.text)
    const media = mediaFor(entry, { emojiKey: candidate.emojiKey, emotion: candidate.emotion })
    const duration = Math.max(1500, Number(config.displayDuration) || DEFAULT_CONFIG.displayDuration)
    const card = {
      id: ++_id,
      actorKey,
      name: entry?.name || candidate.name || candidate.event?.actorName || '角色',
      text: parsed.text,
      emotion: candidate.emotion || 'neutral',
      emojiKey: candidate.emojiKey || '',
      mediaKind: media?.kind || 'initial',
      mediaUrl: media?.url || null,
      source: candidate.source || 'cached',
      duration,
      _remaining: duration,
      startedAt: Date.now(),
      leaving: false,
      event: candidate.event || null,
    }
    shown.value = [...shown.value, card]
    engine.markDisplayed(candidate.event)
    characterObservationBus.markFeedbackShown(candidate.event.actorKey, candidate.event.occurredAtMs)
    writeDedupeLedger(engine.snapshot().dedupe)
    playReactionSound({ enabled: config.soundEnabled !== false })
    cardTimers.set(card.id, setTimeout(() => dismissCard(card.id), duration))
    return true
  }

  function maybeShowPending() {
    const candidate = pending.value
    if (!candidate) return
    clearPending()
    if (!config.enabled || blocked.value || sceneBlocked.value) return
    present(candidate)
  }
  /** 请求即时反应；4 秒超时 / 失败 / 非法输出 → 静默丢弃（§7.1-5 / §18） */
  async function requestInstantReaction(event, history = null) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs)
      let data
      // 声明提到内层 try 之外：emojiKey 终检在 try/finally 之后还要用它做包含判断
      let emojis = []
      try {
        // 先把该角色实际拥有的表情类别带给模型，让它只从里面选
        const entry = await ensureMaterials(event.actorKey)
        emojis = (entry?.items || []).filter(item => item && item.key).map(item => item.key)
        data = await api.requestCharacterReaction({
          event,
          // 用「本次操作入历史之前」的快照，避免当前操作既进 previousOperations 又当 currentOperation
          history: Array.isArray(history) ? history : characterObservationBus.recentHistory(),
          emojis,
        }, { signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      if (disposed) return null
      const text = parseMarkers(data?.text).text
      if (!text) return null
      const emojiKey = emojis.includes(data?.emoji) ? data.emoji : ''
      return { event, text, emojiKey, source: 'llm' }
    } catch (err) {
      lastError.value = err?.message || '即时反应失败'
      return null
    }
  }

  // 执行命中的即时反应请求（失败静默）
  async function runDecision(event, decision, history = null) {
    if (decision.action === 'display') {
      await present({ event, text: decision.text, emotion: decision.emotion, source: decision.source })
      return
    }
    if (decision.action === 'request-llm') {
      const result = await requestInstantReaction(event, history)
      if (result && engine.stillValid(event)) {
        await present(result)
      }
      // 超时 / 失败 / 失效：静默丢弃，不做缓存短句回退（§18）
    }
  }

  async function handleEvent(event, history = null) {
    if (disposed) return
    const decision = engine.decide(event)
    if (decision.action === 'ignore') return
    // 静默（未命中概率）也要把这次事实记下来：反复操作不会每次重新抽签、也不会积攒候选
    if (decision.action === 'silent') { engine.markSuppressed(event); return }
    await runDecision(event, decision, history)
  }

  // ── 生命周期 ──

  function start() {
    if (disposed) return
    const ledger = readDedupeLedger()
    if (ledger) {
      const snapshot = engine.snapshot()
      engine.hydrate({ ...snapshot, dedupe: { ...snapshot.dedupe, ...ledger } })
    }
    if (!_unsubscribe) {
      _unsubscribe = characterObservationBus.subscribe((event) => {
        // commitHistory 返回「本次操作入历史之前」的最近三条快照
        const history = characterObservationBus.commitHistory(event)
        handleEvent(event, history)
      })
      characterObservationBus.addDisposer(() => stop())
    }
  }

  function stop() {
    disposed = true
    if (_unsubscribe) { _unsubscribe(); _unsubscribe = null }
    clearAll()
  }

  function setBlocked(value, reason = '') {
    blocked.value = !!value
    if (blocked.value) {
      if (shown.value.length) dismissDisplay()
    } else {
      maybeShowPending()
    }
    return reason
  }

  /** 场景遮挡（弹窗 / 抽屉 / 演出 / 系统 Toast）：由宿主维护，候选只保留 8 秒 */
  function setSceneBlocked(value, reason = '') {
    sceneBlocked.value = !!value
    if (sceneBlocked.value) {
      if (shown.value.length) dismissDisplay()
    } else {
      maybeShowPending()
    }
    return reason
  }

  function setPaused(value) {
    paused.value = !!value
    characterObservationBus.setPaused(!!value)
  }

  return {
    config, shown, pending, blocked, sceneBlocked, paused, materials, lastError,
    enabled, categories,
    ensureMaterials, cachedMaterials, mediaFor,
    start, stop, setBlocked, setSceneBlocked, setPaused,
    dismissDisplay, finishDismiss, present, maybeShowPending,
    pauseDisplay, resumeDisplay, demoteMedia,
    engine,
  }
})
