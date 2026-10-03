/**
 * 角色操作反馈（右下角轻通知）——纯规则层。
 *
 * 这一层只做判断，不碰 DOM、不碰网络、不读 Pinia：
 *   · 事件目录（哪些语义事件允许弹、谁生产、事实边界）
 *   · 目标角色与去重键解析
 *   · 资源级 / 日级去重、全局与角色冷却、类别开关
 *   · 一次概率抽签（命中即请求模型，无额度 / 间隔 / 并发限制）
 *   · 角色级短句（短句包 / 手动编辑）：仅未命中且该角色配置了短句时显示，否则静默；
 *     内置基础短句已移除（§18）
 *
 * 时钟（now）与随机源（random）由调用方注入，便于测试固定边界；
 * 见 docs/character-reaction-notification-plan.md §2.2 / §5.4 / §6 / §7.1。
 */

export const SCHEMA_VERSION = 1

// ── 调度参数（§6.1 / §7.1，默认值，可被注入覆盖）──
export const DEFAULT_CONFIG = {
  enabled: true,
  maxPerScreen: 1,
  maxStack: 3,
  soundEnabled: true,
  displayDuration: 5000,
  mergeWindowMs: 400,
  globalGapMs: 20_000,
  perActorGapMs: 60_000,
  perCategoryGapMs: 300_000,
  blockedCandidateTtlMs: 8_000,
  llmEnabled: true,
  llmProbability: 0.15,
  llmTimeoutMs: 4_000,
  eventTtlMs: 8_000,
  observationTtlMs: 10 * 60_000,
  maxObservations: 50,
  maxDedupeEntries: 256,
  historyLimit: 3,
  historyTtlMs: 24 * 3600_000,
  categoryEnabled: {
    character: true,
    moment: true,
    appearance: true,
    letter: true,
    schedule: true,
  },
}

/** 文本硬上限：40 个可见字符（§6.1） */
export const MAX_VISIBLE_TEXT = 40

/** 事件注册表：每条声明唯一生产者、事实语义、去重作用域与冷却桶 */
export const CATALOG = {
  'character.pin_enabled': {
    category: 'character',
    producer: 'character-pin',
    feedbackOwner: 'character-reaction',
    // 同角色本地日内至多一次；取消置顶静默
    dedupeScope: 'actor-day',
    cooldownKey: 'character.pin',
    llm: true,
    summary: '用户把该角色置顶',
  },
  'moment.like_enabled': {
    category: 'moment',
    producer: 'moments-store',
    feedbackOwner: 'character-reaction',
    // 同帖本地日内一次；超过 7 天按旧动态分支，同一事实只选一个分支
    dedupeScope: 'resource-day',
    cooldownKey: 'moment.like',
    llm: true,
    summary: '用户点赞了该角色发布的一条动态',
    branches: ['default', 'old'],
  },
  'appearance.applied': {
    category: 'appearance',
    producer: 'backpack-store',
    feedbackOwner: 'character-reaction',
    // 记录有效外观版本，同物品操作去重
    dedupeScope: 'resource',
    cooldownKey: 'appearance.change',
    llm: true,
    summary: '用户给该角色用了一件外观类道具',
  },
  // P1（M3 接入）：切回原有外观（移除生效中的外观效果）。与 applied 共用冷却桶，避免同段反复说话
  'appearance.restored': {
    category: 'appearance',
    producer: 'backpack-store',
    feedbackOwner: 'character-reaction',
    dedupeScope: 'resource',
    cooldownKey: 'appearance.change',
    llm: true,
    summary: '用户把该角色的外观换回原来那一套',
  },
  'letter.reopened': {
    category: 'letter',
    producer: 'mailbox-view',
    feedbackOwner: 'character-reaction',
    // 同封信本地日内一次
    dedupeScope: 'resource-day',
    cooldownKey: 'letter.reopen',
    llm: true,
    summary: '用户重新打开了该角色写来的一封已读旧回信',
  },
  // ── M3：按需启用的 P1 行为（§2.2）──
  'character.avatar_changed': {
    category: 'character',
    producer: 'character-avatar',
    feedbackOwner: 'character-reaction',
    // 同角色 30 分钟内至多一次；上传预览不算完成（§2.2）
    dedupeScope: 'actor',
    dedupeTtlMs: 30 * 60_000,
    cooldownKey: 'character.avatar',
    llm: true,
    summary: '用户保存了该角色的新头像（不分析头像内容）',
  },
  'character.display_name_changed': {
    category: 'character',
    producer: 'character-display-name',
    feedbackOwner: 'character-reaction',
    // 同角色 30 分钟内至多一次；当前显示名是角色配置，不是独立昵称系统（§2.2）
    dedupeScope: 'actor',
    dedupeTtlMs: 30 * 60_000,
    cooldownKey: 'character.display-name',
    llm: true,
    summary: '用户修改了该角色的显示名（当前显示名是角色配置，不是独立昵称系统）',
  },
  'moment.share_exported': {
    category: 'moment',
    producer: 'moments-store',
    feedbackOwner: 'character-reaction',
    // 一次导出操作一次；不声称已经发到外部平台（§2.2）
    dedupeScope: 'resource',
    dedupeTtlMs: 10 * 60_000,
    cooldownKey: 'moment.share',
    llm: true,
    summary: '用户导出/下载了该角色动态的分享图（不表示已经发到外部平台）',
  },

  'character.relationship_changed': {
    category: 'character',
    producer: 'relationship-editor',
    feedbackOwner: 'character-reaction',
    // 关系可能一次改多条：同角色 30 分钟内至多一次，避免批量保存刷屏
    dedupeScope: 'actor',
    dedupeTtlMs: 30 * 60_000,
    cooldownKey: 'character.relationship',
    llm: true,
    summary: '用户添加 / 修改 / 删除了一条与该角色有关的关系（不复述关系内容）',
  },
  'schedule.peeked': {
    category: 'schedule',
    producer: 'schedule-view',
    feedbackOwner: 'character-reaction',
    // 同角色 30 分钟内至多一次，避免反复瞄
    dedupeScope: 'actor',
    dedupeTtlMs: 30 * 60_000,
    cooldownKey: 'schedule.peek',
    llm: true,
    summary: '用户瞄了一眼该角色此刻在做什么（不描述快照画面、不声称角色一定在做某事）',
  },
  // ── §2.3 P1：只记录、不弹出的上下文事实（不进入抽签与展示） ──
  'moment.comment': {
    category: 'moment',
    producer: 'moments-store',
    feedbackOwner: 'character-reaction',
    recordOnly: true,
    dedupeScope: 'resource',
    summary: '用户评论了该角色发布的一条动态（原评论回复优先）',
  },
  'schedule.agreement': {
    category: 'character',
    producer: 'schedule-view',
    feedbackOwner: 'character-reaction',
    recordOnly: true,
    dedupeScope: 'resource',
    summary: '用户明确保存了一条与该角色的日程约定（不代表已经赴约）',
  },
}

export function isKnownEventType(type) {
  return Object.prototype.hasOwnProperty.call(CATALOG, type)
}

/** 只记录、不弹出的上下文事件（§2.3）：进入观察与历史，不进入抽签与展示 */
export function isRecordOnlyEventType(type) {
  return CATALOG[type]?.recordOnly === true
}

/**
 * 目录中声明、但暂不接入展示的事件。
 * M3 起 appearance.restored 已接入；礼物收起类改为 categoryEnabled.gift 默认关闭控制，
 * 因此这里不再硬排除任何事件，保留空集合作为显式扩展点。
 */
export const DISABLED_EVENT_TYPES = Object.freeze([])

export function isEnabledEventType(type) {
  return isKnownEventType(type) && !DISABLED_EVENT_TYPES.includes(type) && !isRecordOnlyEventType(type)
}

/** 允许进入展示流程的事件白名单 */
export const EVENT_TYPES = Object.freeze(Object.keys(CATALOG).filter(type => isEnabledEventType(type)))

/** `character:42` / `npc:7` 解析结果；无法识别返回 null（身份未知即不进入展示队列） */
export function parseActorKey(actorKey) {
  const m = /^([a-z]+):(.+)$/.exec(String(actorKey || ''))
  if (!m) return null
  const kind = m[1]
  const raw = m[2]
  if (kind === 'character') {
    const id = Number(raw)
    return Number.isInteger(id) && id > 0 ? { kind, id, key: `character:${id}` } : null
  }
  if (kind === 'npc') {
    return raw ? { kind, id: raw, key: `npc:${raw}` } : null
  }
  return null
}

/** 只支持正式角色（§2.4）：小镇 / 轻量 NPC 身份在采集层就被拒绝，避免影子身份与正式角色各弹一次 */
export function isSupportedActor(actorKey) {
  const parsed = parseActorKey(actorKey)
  return !!parsed && parsed.kind === 'character'
}

/** 资源标识规范化：去掉 cache-bust 查询参数，保留路径（§5.3） */
export function normalizeResourceId(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  return raw.replace(/[?#].*$/, '')
}

/** 去重键。资源级 = 语义 + 角色 + 资源；角色日级 = 语义 + 角色（§5.4） */
export function dedupeKeyFor(event) {
  const spec = CATALOG[event?.type]
  if (!spec) return ''
  const actor = event.actorKey || ''
  if (spec.dedupeScope === 'actor-day' || spec.dedupeScope === 'actor') {
    return `${event.type}|${actor}`
  }
  const resource = event.subject?.id || event.operationId || ''
  return `${event.type}|${actor}|${resource}`
}

/** 同一资源（换分支 / 重发）归一的语义键：用于「同一事实只选一个分支」 */
export function factsKeyFor(event) {
  const spec = CATALOG[event?.type]
  if (!spec) return ''
  if (spec.dedupeScope === 'actor-day' || spec.dedupeScope === 'actor') {
    return `${event.type}|${event.actorKey || ''}`
  }
  const resource = event.subject?.id || event.operationId || ''
  return `${event.type}|${event.actorKey || ''}|${resource}`
}

/** 应用本地日（YYYY-MM-DD）；跨午夜只重置频率计数（§2.2） */
export function localDayKey(ts, now = new Date()) {
  const d = ts === undefined || ts === null ? now : new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function clampText(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  const chars = Array.from(clean)
  return chars.length > MAX_VISIBLE_TEXT ? chars.slice(0, MAX_VISIBLE_TEXT).join('') : clean
}

// ── 角色级短句（M2 短句包 / 手动编辑，§6.3）；内置基础短句已移除（§18）──

/** 分支选择：点赞旧动态走 :old 分支（§2.2） */
export function phraseBranchFor(event) {
  if (event?.type === 'moment.like_enabled' && event.payload?.old === true) return 'old'
  return 'default'
}

export function phraseKeyFor(event) {
  const branch = phraseBranchFor(event)
  if (branch === 'old') return `${event.type}:old`
  return event.type
}

/** 允许代入短句的占位符（注册表限制，§6.3）：{itemName} 仅外观类事件 */
export const ALLOWED_PLACEHOLDERS = ['itemName']

/**
 * 缓存短句的占位符替换：只替换允许的占位符；出现未允许占位符时整条作废（§6.3）。
 * @returns `{ text, invalid }`
 */
export function fillPhrase(text, event) {
  let invalid = false
  const replaced = String(text ?? '').replace(/\{(\w+)\}/g, (match, name) => {
    if (!ALLOWED_PLACEHOLDERS.includes(name)) { invalid = true; return match }
    if (name === 'itemName') return String(event?.payload?.itemName || '').trim() || '这一件'
    return match
  })
  return { text: replaced, invalid }
}

/**
 * 取一条角色级短句（短句包 / 手动编辑）。没有配置或没有合法短句时返回 null（静默）。
 * @param {object} event
 * @param {object} [overrides] `{ [phraseKey]: [{text,emotion}] }` 角色级短句
 * @param {() => number} [random]
 */
export function resolveCachedText(event, overrides = null, random = Math.random) {
  const key = phraseKeyFor(event)
  const pool = overrides && Array.isArray(overrides[key]) ? overrides[key] : null
  if (!pool || pool.length === 0) return null
  const start = Math.floor(random() * pool.length) % pool.length
  for (let i = 0; i < pool.length; i += 1) {
    const pick = pool[(start + i) % pool.length]
    const filled = fillPhrase(pick?.text, event)
    if (filled.invalid) continue
    const text = clampText(filled.text)
    if (!text) continue
    return { text, emotion: pick?.emotion || 'neutral' }
  }
  return null
}

// ── 标记语义（供缓存短句与即时反应共用）──
export const MARKER_KEYS = ['\u{1F60A}', '\u{1F633}', '\u{1F62E}', '\u{1F642}']

export function markerKeyForEmotion(emotion) {
  switch (emotion) {
    case 'pleased': return '\u{1F60A}'
    case 'shy': return '\u{1F633}'
    case 'surprised': return '\u{1F62E}'
    default: return '\u{1F642}'
  }
}

export function parseMarkers(text) {
  const raw = String(text ?? '')
  const markerRe = /([\u{1F60A}\u{1F633}\u{1F62E}\u{1F642}])\uFE0F?\s*#([^#\n]{1,40})#/gu
  const matches = [...raw.matchAll(markerRe)]
  if (matches.length === 0) return { text: clampText(raw), hasMarker: false }
  const plain = raw.replace(markerRe, '').replace(/\s+/g, ' ').trim()
  // 整行只有标记时保留可展示的标记文本，避免显示空句子
  if (!plain) return { text: clampText(matches.map(m => `#${m[2]}#`).join(' ')), hasMarker: true }
  return { text: clampText(plain), hasMarker: true }
}

// ── 调度引擎 ──

/**
 * 创建规则引擎。所有状态在闭包内，时钟与随机源可注入。
 */
export function createReactionEngine(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const random = typeof options.random === 'function' ? options.random : Math.random

  let config = { ...DEFAULT_CONFIG, ...(options.config || {}) }
  if (options.config?.categoryEnabled) {
    config.categoryEnabled = { ...DEFAULT_CONFIG.categoryEnabled, ...options.config.categoryEnabled }
  }

  let lastShownAt = 0
  const lastShownByActor = new Map()
  const lastShownByCategory = new Map()
  const dedupe = new Map()      // key -> { until, day }
  const llmDedupe = new Map()   // key -> { until }：抽签结果绑定去重键，重挂载不重抽
  const pendingLlm = new Map()  // key -> until：已发起但尚未落地的模型请求，防止重复请求
  const mergedOperations = new Map()  // operationId -> { at, actorKey }：合并窗口内只认一次操作

  function setConfig(patch = {}) {
    config = { ...config, ...patch }
    if (patch.categoryEnabled) {
      config.categoryEnabled = { ...DEFAULT_CONFIG.categoryEnabled, ...patch.categoryEnabled }
    }
  }

  function getConfig() { return { ...config, categoryEnabled: { ...config.categoryEnabled } } }

  /** 有界去重集合：清理过期项，超限淘汰最早插入的 */
  function pruneDedupe(t) {
    for (const [key, rec] of dedupe) {
      if (rec.until && rec.until <= t && !rec.day) dedupe.delete(key)
    }
    while (dedupe.size > config.maxDedupeEntries) {
      const oldest = dedupe.keys().next().value
      dedupe.delete(oldest)
    }
    for (const [key, rec] of llmDedupe) {
      if (rec.until && rec.until <= t) llmDedupe.delete(key)
    }
    while (llmDedupe.size > config.maxDedupeEntries) {
      const oldest = llmDedupe.keys().next().value
      llmDedupe.delete(oldest)
    }
    for (const [key, until] of pendingLlm) {
      if (until <= t) pendingLlm.delete(key)
    }
    while (pendingLlm.size > config.maxDedupeEntries) {
      pendingLlm.delete(pendingLlm.keys().next().value)
    }
  }

  /** 已经展示过的同事实（终检用）：只看已落地的展示去重，不看在途模型请求 */
  function isShownDuplicate(event, t) {
    const key = dedupeKeyFor(event)
    if (!key) return true
    const rec = dedupe.get(key)
    if (!rec) return false
    if ((rec.until || 0) > t) return true
    const spec = CATALOG[event.type]
    // 本地日内一次：「本地日」跟随应用统一时区，跨午夜只重置计数（§2.2）
    if (spec?.dedupeScope === 'resource-day' || spec?.dedupeScope === 'actor-day') {
      return rec.day === localDayKey(t)
    }
    return false
  }

  function isDuplicate(event, t) {
    // 在途请求也要挡重复派发；但它不能让自己异步返回后的终检失败
    return isShownDuplicate(event, t) || hasPendingRequest(event, t)
  }

  function hasPendingRequest(event, t = now()) {
    const until = pendingLlm.get(dedupeKeyFor(event))
    return !!until && until > t
  }

  /** 占住一条事实，避免模型在途期间重复请求；终检不把它当作已展示 */
  function markPending(event, t = now()) {
    const key = dedupeKeyFor(event)
    if (!key) return
    pendingLlm.set(key, t + config.eventTtlMs)
    if (pendingLlm.size > config.maxDedupeEntries) pruneDedupe(t)
  }

  function dedupeTtlFor(event) {
    const spec = CATALOG[event.type]
    return Number(spec?.dedupeTtlMs) > 0 ? Number(spec.dedupeTtlMs) : config.perCategoryGapMs
  }

  function markShown(event, t = now()) {
    const key = dedupeKeyFor(event)
    if (!key) return
    const spec = CATALOG[event.type]
    const dayScoped = spec?.dedupeScope === 'resource-day' || spec?.dedupeScope === 'actor-day'
    dedupe.set(key, dayScoped
      ? { day: localDayKey(t), until: t + config.perCategoryGapMs }
      : { until: t + dedupeTtlFor(event) })
    if (dedupe.size > config.maxDedupeEntries) pruneDedupe(t)
  }

  function markDedupeUntil(key, until, t = now()) {
    if (!key) return
    dedupe.set(key, { until })
    if (dedupe.size > config.maxDedupeEntries) pruneDedupe(t)
  }

  /** 资源级短冷却（防连点重复）：去重键仍然有效则视为重复 */
  function hasRecentFact(event, t = now()) {
    const key = dedupeKeyFor(event)
    const rec = dedupe.get(key)
    if (!rec) return false
    return (rec.until || 0) > t
  }

  /**
   * 合并窗口（默认 400ms）：同一次业务操作在同一角色下派生出的**不同语义**事件只认一条。
   * 同类型事件的重复回包由去重与冷却判定负责，不会被合并掩盖。
   */
  function isWithinMergeWindow(event, t) {
    if (!event.operationId) return false
    const record = mergedOperations.get(event.operationId)
    if (!record || record.actorKey !== event.actorKey) {
      mergedOperations.set(event.operationId, { at: t, actorKey: event.actorKey, types: new Set([event.type]) })
      while (mergedOperations.size > 64) {
        mergedOperations.delete(mergedOperations.keys().next().value)
      }
      return false
    }
    if (record.types.has(event.type)) {
      record.at = t
      return false
    }
    if ((t - record.at) < config.mergeWindowMs) {
      record.types.add(event.type)
      return true
    }
    record.at = t
    record.types.add(event.type)
    return false
  }

  function rollDedupeKey(event) {
    return factsKeyFor(event)
  }

  function hasRolled(event) {
    return llmDedupe.has(rollDedupeKey(event))
  }

  function markRolled(event, t = now()) {
    const key = rollDedupeKey(event)
    if (!key) return
    llmDedupe.set(key, { until: t + config.eventTtlMs })
    if (llmDedupe.size > config.maxDedupeEntries) pruneDedupe(t)
  }

  function rollLlm() {
    return random() < config.llmProbability
  }

  function isLlmExpired(event, t) {
    const occurred = Number(event?.occurredAtMs)
    if (!Number.isFinite(occurred)) return false
    return t - occurred > config.eventTtlMs
  }

  function displayGapBlocked(t) {
    return t - lastShownAt < config.globalGapMs
  }

  function actorGapBlocked(event, t) {
    return t - (lastShownByActor.get(event.actorKey) || 0) < config.perActorGapMs
  }

  function categoryGapBlocked(event, t) {
    const spec = CATALOG[event.type]
    if (!spec) return true
    return t - (lastShownByCategory.get(spec.cooldownKey) || 0) < config.perCategoryGapMs
  }

  /**
   * 一次判定的结果：
   *  { action: 'ignore' | 'silent', reason }
   *  { action: 'display', source: 'cached', text, emotion, event }
   *  { action: 'request-llm', event }
   * @param {object} event 标准化事件
   * @param {number} [t] 判定时刻
   * @param {object} [opts] `{ llmForced, overrides }`；`llmForced` 强制视为命中抽签（仅供测试与手动调试），
   *   `overrides` 为该角色的缓存短句覆盖（短句包 / 手动编辑），仅用于未命中时的回退。
   */
  function decide(event, t = now(), opts = {}) {
    if (!event || !isKnownEventType(event.type)) {
      return { action: 'ignore', reason: 'unknown-type' }
    }
    // §2.3：只进入观察与历史，不抽签、不展示
    if (isRecordOnlyEventType(event.type)) return { action: 'ignore', reason: 'record-only' }
    if (!isEnabledEventType(event.type)) return { action: 'ignore', reason: 'unknown-type' }
    if (!config.enabled) return { action: 'ignore', reason: 'disabled' }
    const spec = CATALOG[event.type]
    if (config.categoryEnabled?.[spec.category] === false) return { action: 'ignore', reason: 'category-off' }
    if (!isSupportedActor(event.actorKey)) return { action: 'ignore', reason: 'unsupported-actor' }
    if (event.outcome === 'failed' || event.outcome === 'cancelled') return { action: 'ignore', reason: 'failed' }
    if (isLlmExpired(event, t)) return { action: 'ignore', reason: 'expired' }
    // 合并窗口：同一次业务操作派生出的多条事件只保留最具体的一条（§6.1 / §6.2）
    if (isWithinMergeWindow(event, t)) return { action: 'ignore', reason: 'merged' }
    if (isDuplicate(event, t)) return { action: 'ignore', reason: 'duplicate' }
    pruneDedupe(t)

    // 展示冷却：不排队，直接丢弃（§6.1）。先报角色级间隔，再报全局间隔，便于定位
    if (actorGapBlocked(event, t)) return { action: 'ignore', reason: 'actor-cooldown' }
    if (displayGapBlocked(t)) return { action: 'ignore', reason: 'global-cooldown' }
    if (categoryGapBlocked(event, t)) return { action: 'ignore', reason: 'category-cooldown' }

    // 即时反应：一次概率抽签，命中即请求模型；未命中只在该角色配置了短句（包 / 手动编辑）时显示，否则静默
    if (spec.llm && config.llmEnabled) {
      if (!hasRolled(event)) markRolled(event, t)
      const hit = opts.llmForced === true || rollLlm()
      if (hit) {
        // 一旦决定请求模型，就把这条事实占住：失败 / 超时的重试路径不会再抽签或重复请求
        markPending(event, t)
        return { action: 'request-llm', event }
      }
    }

    const cached = resolveCachedText(event, opts.overrides || null, random)
    if (!cached) return { action: 'silent', reason: 'no-cached-line' }
    return { action: 'display', source: 'cached', ...cached, event }
  }

  /** 只做「这次事实是否还值得展示」的终检（异步返回后调用，§7.1-6） */
  function stillValid(event, t = now()) {
    if (!event || !config.enabled) return false
    const spec = CATALOG[event.type]
    if (!spec || !isEnabledEventType(event.type)) return false
    if (config.categoryEnabled?.[spec.category] === false) return false
    if (!isSupportedActor(event.actorKey)) return false
    if (isLlmExpired(event, t)) return false
    if (isShownDuplicate(event, t)) return false
    if (displayGapBlocked(t)) return false
    if (actorGapBlocked(event, t)) return false
    if (categoryGapBlocked(event, t)) return false
    return true
  }

  /** 真正开始展示时计入冷却（§6.1） */
  function markDisplayed(event, t = now()) {
    lastShownAt = t
    lastShownByActor.set(event.actorKey, t)
    const spec = CATALOG[event.type]
    if (spec) lastShownByCategory.set(spec.cooldownKey, t)
    markShown(event, t)
  }

  /** 展示后立即写入资源级短冷却，避免同资源连点重复弹 */
  function markSuppressed(event, t = now()) {
    markShown(event, t)
  }

  function snapshot() {
    return {
      lastShownAt,
      lastShownByActor: Object.fromEntries(lastShownByActor),
      lastShownByCategory: Object.fromEntries(lastShownByCategory),
      dedupe: Object.fromEntries(dedupe),
    }
  }

  function hydrate(state) {
    if (!state) return
    lastShownAt = Number(state.lastShownAt) || 0
    for (const [k, v] of Object.entries(state.lastShownByActor || {})) lastShownByActor.set(k, Number(v) || 0)
    for (const [k, v] of Object.entries(state.lastShownByCategory || {})) lastShownByCategory.set(k, Number(v) || 0)
    for (const [k, v] of Object.entries(state.dedupe || {})) dedupe.set(k, v)
  }

  return {
    setConfig,
    getConfig,
    decide,
    stillValid,
    markDisplayed,
    markSuppressed,
    hasRolled,
    markRolled,
    isDuplicate,
    isWithinMergeWindow,
    hasRecentFact,
    markDedupeUntil,
    snapshot,
    hydrate,
    // 供测试观察内部状态
    _internals: { dedupe, llmDedupe, lastShownByActor, lastShownByCategory, mergedOperations },
  }
}
