import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  CATALOG,
  DEFAULT_CONFIG,
  EVENT_TYPES,
  createReactionEngine,
  dedupeKeyFor,
  isEnabledEventType,
  isKnownEventType,
  isRecordOnlyEventType,
  isSupportedActor,
  localDayKey,
  markerKeyForEmotion,
  parseActorKey,
  parseMarkers,
  resolveCachedText,
} from '../src/utils/characterReactionRules.js'
import {
  createObservationBus,
  normalizeCharacterObservation,
} from '../src/utils/characterObservationEvents.js'
import {
  emitAppearanceApplied,
  emitAppearanceRestored,
  emitCharacterAvatarChanged,
  emitCharacterDisplayNameChanged,
  emitCharacterPinEnabled,
  emitLetterReopened,
  emitMomentComment,
  emitMomentLikeEnabled,
  emitMomentShareExported,
  emitRelationshipChanged,
  emitScheduleAgreement,
  emitSchedulePeeked,
} from '../src/utils/characterReactionProducers.js'

// ── 测试工具：时钟与随机源全部注入，边界可复现 ──

const BASE_TIME = 1_700_000_000_000
let clock = BASE_TIME
const now = () => clock

beforeEach(() => { clock = BASE_TIME })

function makeEngine(patch = {}) {
  const config = { ...DEFAULT_CONFIG, ...patch }
  if (patch.categoryEnabled) config.categoryEnabled = { ...DEFAULT_CONFIG.categoryEnabled, ...patch.categoryEnabled }
  const rolls = []
  const random = () => (rolls.length > 0 ? rolls.shift() : 0.99)
  const engine = createReactionEngine({ now, random, config })
  return { engine, rolls }
}

function event(overrides = {}) {
  const base = {
    type: 'appearance.applied',
    actorKey: 'character:42',
    subject: { kind: 'outfit', id: 'outfit-1' },
    operationId: 'op-1',
    outcome: 'applied',
    occurredAtMs: clock,
    payload: {},
  }
  return {
    ...base,
    ...overrides,
    subject: { ...base.subject, ...(overrides.subject || {}) },
    payload: { ...base.payload, ...(overrides.payload || {}) },
  }
}

// ── 事件目录与身份归属（§2.2 / §2.4 / §4.1）──

test('catalog only keeps the remaining non-town actions; record-only facts stay out of the display whitelist', () => {
  assert.deepEqual(Object.keys(CATALOG).sort(), [
    'appearance.applied',
    'appearance.restored',
    'character.avatar_changed',
    'character.display_name_changed',
    'character.pin_enabled',
    'character.relationship_changed',
    'letter.reopened',
    'moment.comment',
    'moment.like_enabled',
    'moment.share_exported',
    'schedule.agreement',
    'schedule.peeked',
  ])
  assert.deepEqual(EVENT_TYPES.slice().sort(), [
    'appearance.applied',
    'appearance.restored',
    'character.avatar_changed',
    'character.display_name_changed',
    'character.pin_enabled',
    'character.relationship_changed',
    'letter.reopened',
    'moment.like_enabled',
    'moment.share_exported',
    'schedule.peeked',
  ])
  assert.equal(isEnabledEventType('appearance.restored'), true)
  assert.equal(DEFAULT_CONFIG.categoryEnabled.schedule, true)
  for (const type of ['moment.comment', 'schedule.agreement']) {
    assert.equal(isRecordOnlyEventType(type), true, `${type} 应为只记录事件`)
    assert.equal(EVENT_TYPES.includes(type), false)
    assert.equal(isEnabledEventType(type), false)
  }
  for (const type of ['photo.download_requested', 'photo.saved_after_viewing', 'gift.selection_abandoned', 'gift.sent', 'oath.bonded', 'letter.sent', 'appearance.changed_repeatedly', 'npc.foo']) {
    assert.equal(isKnownEventType(type), false, `${type} 已退回，不应再出现在目录`)
  }
  for (const spec of Object.values(CATALOG)) {
    assert.equal(typeof spec.producer, 'string')
    assert.equal(spec.feedbackOwner, 'character-reaction')
  }
})

test('actor keys must be formal characters; town NPC and unknown identities never qualify', () => {
  assert.deepEqual(parseActorKey('character:42'), { kind: 'character', id: 42, key: 'character:42' })
  assert.equal(isSupportedActor('character:42'), true)
  assert.equal(isSupportedActor('npc:7'), false, '小镇相关暂不接入')
  assert.equal(isSupportedActor('character:abc'), false)
  assert.equal(isSupportedActor(''), false)
})

test('normalization rejects unknown types, sources, actors, subject kinds and oversized events', () => {
  const ok = normalizeCharacterObservation({
    type: 'letter.reopened',
    source: 'mailbox-view',
    actorKey: 'character:42',
    subject: { kind: 'letter', id: '/letters/9?x=1' },
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.event.subject.id, '/letters/9', '资源标识去掉 cache-bust 参数')

  const reason = (input) => normalizeCharacterObservation(input).reason
  const base = { type: 'letter.reopened', source: 'mailbox-view', actorKey: 'character:42', subject: { kind: 'letter', id: 'x' } }
  assert.equal(reason({ ...base, type: 'nope' }), 'unknown-type')
  assert.equal(reason({ ...base, source: 'evil' }), 'unknown-source')
  assert.equal(reason({ ...base, actorKey: 'npc:1' }), 'unsupported-actor')
  assert.equal(reason({ ...base, subject: { kind: 'photo', id: 'x' } }), 'unknown-subject-kind')
  assert.equal(reason({ ...base, subject: { kind: 'letter', id: '' } }), 'missing-subject-id')
  assert.equal(reason({ ...base, payload: { blob: 'a'.repeat(4000) } }), 'payload-field-too-large')
  assert.equal(reason({ ...base, subject: { kind: 'letter', id: `x${'y'.repeat(2200)}` } }), 'event-too-large')
})

test('observation bus keeps a bounded window and a 3-entry session history without the current operation', () => {
  const bus = createObservationBus({ now, maxObservations: 5, ttlMs: 60_000, historyLimit: 3 })
  for (let i = 0; i < 8; i += 1) {
    clock += 10
    bus.dispatch({
      type: 'character.pin_enabled',
      source: 'character-pin',
      actorKey: 'character:42',
      subject: { kind: 'character', id: '42' },
      operationId: `op-${i}`,
      outcome: 'confirmed',
      payload: { summary: `op ${i}` },
    })
  }
  assert.equal(bus.recentObservations().length, 5)

  const snapshot = bus.commitHistory({ type: 'character.pin_enabled', actorKey: 'character:42', occurredAtMs: clock, payload: { summary: 'first' } })
  assert.equal(snapshot.length, 0, '当前操作不得计入历史')

  for (let i = 0; i < 4; i += 1) {
    clock += 100
    bus.commitHistory({ type: 'moment.like_enabled', actorKey: 'character:7', occurredAtMs: clock, payload: { summary: `h${i}` } })
  }
  const history = bus.recentHistory()
  assert.equal(history.length, 3)
  assert.equal(history[0].content, 'h1')
  assert.equal(history[2].content, 'h3')
  assert.equal(bus.markFeedbackShown('character:7', history[2].occurredAtMs), true)
  assert.equal(bus.recentHistory()[2].feedbackShown, true)

  clock += 4000
  assert.equal(bus.recentHistory().length, 3, 'TTL 内保留最近三次')
})

test('observation history expires after its TTL', () => {
  const bus = createObservationBus({ now, ttlMs: 1000, historyLimit: 3, historyTtlMs: 1000 })
  bus.commitHistory({ type: 'moment.like_enabled', actorKey: 'character:7', occurredAtMs: clock, payload: { summary: 'h0' } })
  assert.equal(bus.recentHistory().length, 1)
  clock += 4000
  assert.equal(bus.recentHistory().length, 0)
  assert.equal(bus.recentObservations().length, 0)
})

test('paused scene still normalizes explicit operations instead of throwing', () => {
  const bus = createObservationBus({ now })
  bus.setPaused(true)
  const res = bus.dispatch({ type: 'character.pin_enabled', source: 'character-pin', actorKey: 'character:42', subject: { kind: 'character', id: '42' } })
  assert.equal(res.paused, true)
  assert.equal(typeof res.event.occurredAtMs, 'number')
})

// ── 去重与冷却（§5.4 / §6.1）──

test('100 repeats inside one dedupe window produce at most one candidate and one dice roll', () => {
  const { engine } = makeEngine({ llmProbability: 0.5 })
  const overrides = { 'appearance.applied': [{ text: '包里的台词。', emotion: 'neutral' }] }
  let displayed = 0
  let modelRequests = 0
  for (let i = 0; i < 100; i += 1) {
    const decision = engine.decide(event({ operationId: `op-${i}` }), now(), { overrides })
    if (decision.action === 'display') { displayed += 1; engine.markDisplayed(event()) }
    if (decision.action === 'request-llm') modelRequests += 1
  }
  assert.equal(displayed, 1)
  assert.equal(modelRequests, 0)
  assert.equal(engine._internals.dedupe.size, 1)
})

test('resource dedupe follows the catalog window and the same fact never repeats inside it', () => {
  const { engine } = makeEngine()
  const first = event()
  engine.markDisplayed(first)
  assert.equal(engine.decide(first).reason, 'duplicate')
  clock += 4 * 60_000
  assert.equal(engine.decide({ ...first, occurredAtMs: clock }).reason, 'duplicate')
  clock += 2 * 60_000
  // 走出窗口后按正常流程判定；未命中抽签且没有角色级短句时是 silent（§18）
  assert.ok(['display', 'request-llm', 'silent'].includes(engine.decide({ ...first, occurredAtMs: clock }).action))
})

test('per-day facts use the local day: crossing midnight does not replay them', () => {
  const { engine } = makeEngine()
  const liked = { ...event({ type: 'moment.like_enabled', subject: { kind: 'moment', id: 'post-9' }, outcome: 'confirmed' }) }
  engine.markDisplayed(liked)
  clock += 26 * 3600_000
  // 同帖本地日内一次：跨日后该帖子不再重复通知（新的本地日会重新允许新帖子）
  assert.ok(['display', 'request-llm', 'silent'].includes(engine.decide({ ...liked, occurredAtMs: clock }).action))
  const another = event({ type: 'moment.like_enabled', subject: { kind: 'moment', id: 'post-10' }, outcome: 'confirmed', occurredAtMs: clock })
  assert.ok(['display', 'request-llm', 'silent'].includes(engine.decide(another).action))
})

test('the 400ms merge window keeps only one semantic event of one business operation', () => {
  const { engine } = makeEngine({ llmProbability: 0 })
  const first = event({ type: 'appearance.applied', subject: { kind: 'outfit', id: 'outfit-a' }, outcome: 'applied', operationId: 'op-merge' })
  // 没有角色级短句时未命中抽签即静默（§18），但事实仍被合并窗口记录
  assert.equal(engine.decide(first).action, 'silent')
  engine.markDisplayed(first)
  // 同一次操作在 400ms 内派生的另一类语义事件（换装触发的道具更新 + 外观更新）被合并掉
  clock += 120
  const second = event({ type: 'letter.reopened', subject: { kind: 'letter', id: 'letter-1' }, outcome: 'confirmed', operationId: 'op-merge' })
  assert.equal(engine.decide(second).reason, 'merged')
  // 同类型事件的重复回包仍由去重兜住，不会被合并掩盖
  assert.equal(engine.decide(first).reason, 'duplicate')
  // 走出合并窗口后按正常冷却 / 去重流程判定（先越过角色级 60 秒间隔，再撞上共享类别冷却）
  clock += 61_000
  const other = event({ type: 'appearance.applied', subject: { kind: 'outfit', id: 'outfit-d' }, outcome: 'applied', operationId: 'op-other' })
  assert.equal(engine.decide(other).reason, 'category-cooldown')
  assert.equal(engine.isWithinMergeWindow(other, clock), false)
})

test('character pack lines are used on a dice miss; without them the miss is silent', () => {
  const packOverrides = {
    'appearance.applied': [
      { text: '包里的第一条台词。', emotion: 'shy' },
      { text: '包里的第二条台词。', emotion: 'neutral' },
    ],
  }
  const { engine } = makeEngine({ llmProbability: 0 })
  // 配置了角色级短句：未命中抽签时显示短句包
  const withPack = engine.decide(event(), now(), { overrides: packOverrides })
  assert.equal(withPack.action, 'display')
  assert.ok(['包里的第一条台词。', '包里的第二条台词。'].includes(withPack.text))

  // 没有角色级短句：未命中即静默，不再有内置基础短句（§18）
  const plain = engine.decide(event({ operationId: 'op-plain' }))
  assert.equal(plain.action, 'silent')
  assert.equal(plain.reason, 'no-cached-line')
})

test('display cooldowns run before the dice roll and never queue', () => {
  const { engine } = makeEngine({ llmProbability: 1 })
  engine.markDisplayed(event())
  clock += 1000
  assert.equal(engine.decide(event({ subject: { kind: 'outfit', id: 'outfit-2' } })).reason, 'actor-cooldown')
  clock += 65_000
  assert.equal(engine.decide(event({ subject: { kind: 'image', id: 'img-3' } })).reason, 'category-cooldown')
})

test('appearance.applied and appearance.restored share one cooldown bucket', () => {
  const { engine } = makeEngine({ llmProbability: 0 })
  engine.markDisplayed(event({ type: 'appearance.applied', subject: { kind: 'outfit', id: 'outfit-a' }, outcome: 'applied' }))
  // 越过角色级 60 秒间隔，剩下的应该是共享类别冷却（5 分钟）
  clock += 61_000
  const appliedAgain = event({ type: 'appearance.applied', subject: { kind: 'outfit', id: 'outfit-b' }, outcome: 'applied', operationId: 'op-applied-2' })
  assert.equal(engine.decide(appliedAgain).reason, 'category-cooldown')
  assert.equal(CATALOG['appearance.restored'].cooldownKey, CATALOG['appearance.applied'].cooldownKey)
  const restored = event({ type: 'appearance.restored', subject: { kind: 'outfit', id: 'outfit-c' }, outcome: 'applied', operationId: 'op-restore-1' })
  assert.equal(engine.decide(restored).reason, 'category-cooldown')
  assert.equal(isEnabledEventType('appearance.restored'), true, 'M3 起 restored 已接入展示')
})

test('failed and cancelled outcomes never produce feedback', () => {
  const { engine } = makeEngine({ llmProbability: 1 })
  assert.equal(engine.decide(event({ outcome: 'failed' })).reason, 'failed')
  assert.equal(engine.decide(event({ outcome: 'cancelled' })).reason, 'failed')
})

test('category switches and the master switch both silence the pipeline', () => {
  const { engine } = makeEngine({ llmProbability: 1 })
  engine.setConfig({ categoryEnabled: { ...DEFAULT_CONFIG.categoryEnabled, appearance: false } })
  assert.equal(engine.decide(event()).reason, 'category-off')
  engine.setConfig({ categoryEnabled: { ...DEFAULT_CONFIG.categoryEnabled, appearance: true }, enabled: false })
  assert.equal(engine.decide(event()).reason, 'disabled')
})

test('events older than the 8 second validity window are dropped', () => {
  const { engine } = makeEngine({ llmProbability: 1 })
  const stale = clock - DEFAULT_CONFIG.eventTtlMs - 1
  assert.equal(engine.decide(event({ occurredAtMs: stale })).reason, 'expired')
})

test('dice: 0% never requests the model, a forced hit requests once and never re-rolls the same fact', () => {
  const zero = makeEngine({ llmProbability: 0 })
  assert.equal(zero.engine.decide(event()).action, 'silent', '未命中且没有角色级短句时静默（§18）')

  const full = makeEngine({ llmProbability: 1 })
  assert.equal(full.engine.decide(event()).action, 'request-llm')
  assert.equal(full.engine.hasRolled(event()), true, '抽签结果绑定事实去重键')
  // 已抽签的事实不再重抽：即使强制命中，也不会第二次请求
  assert.notEqual(full.engine.decide(event({ operationId: 'other-op' }), now(), { llmForced: true }).action, 'request-llm')
})

test('the default 15% roll is decided once per fact; a miss is silent without role-level lines', () => {
  assert.equal(DEFAULT_CONFIG.llmProbability, 0.15)
  const miss = createReactionEngine({ now, random: () => 0.5, config: { ...DEFAULT_CONFIG, llmProbability: 0.15 } })
  assert.equal(miss.decide(event()).action, 'silent')
  assert.equal(miss.hasRolled(event()), true)

  const hit = createReactionEngine({ now, random: () => 0.05, config: { ...DEFAULT_CONFIG, llmProbability: 0.15 } })
  assert.equal(hit.decide(event()).action, 'request-llm')
})

test('a fact already committed to a model request is not requested twice', () => {
  const { engine } = makeEngine({ llmProbability: 1 })
  const e = event()
  assert.equal(engine.decide(e).action, 'request-llm')
  assert.equal(engine.decide(e).reason, 'duplicate', '失败重试路径不会重复请求模型')
})

test('stillValid re-checks switches and expiry for late model results', () => {
  const { engine } = makeEngine()
  const e = event()
  assert.equal(engine.stillValid(e), true)
  engine.setConfig({ enabled: false })
  assert.equal(engine.stillValid(e), false)
  engine.setConfig({ enabled: true })
  clock += DEFAULT_CONFIG.eventTtlMs + 1
  assert.equal(engine.stillValid(e), false)
})

// ── 缓存短句与素材语义（§3.3 / §6.3）──

test('role-level phrase pools (including the old-moment branch key) are the only line source', () => {
  const pools = {
    'character.pin_enabled': [{ text: '置顶包台词。', emotion: 'pleased' }],
    'moment.like_enabled:old': [{ text: '旧动态专属。', emotion: 'surprised' }],
  }
  const pinned = resolveCachedText(event({ type: 'character.pin_enabled', subject: { kind: 'character', id: '42' }, outcome: 'confirmed' }), pools, () => 0)
  assert.equal(pinned.text, '置顶包台词。')
  const oldLine = resolveCachedText(event({ type: 'moment.like_enabled', payload: { old: true } }), pools, () => 0)
  assert.equal(oldLine.text, '旧动态专属。', '旧动态走 :old 分支键')

  // 没有角色级短句时返回 null：不再有内置基础短句兜底（§18）
  assert.equal(resolveCachedText(event({ type: 'letter.reopened' }), null, () => 0), null)
  assert.equal(resolveCachedText(event({ type: 'letter.reopened' }), {}, () => 0), null)
})

test('role-level phrase overrides resolve with unknown placeholders dropped', () => {
  const override = { 'appearance.applied': [{ text: '角色专属台词。', emotion: 'shy' }] }
  const line = resolveCachedText(event(), override, () => 0)
  assert.equal(line.text, '角色专属台词。')
  assert.equal(line.emotion, 'shy')

  // 命中含未允许占位符的那条时跳过它，顺延到下一条合法台词
  const replaced = resolveCachedText(
    event({ type: 'appearance.applied', payload: { itemName: '丝绒长裙' } }),
    { 'appearance.applied': [{ text: '{unknown}占位', emotion: 'neutral' }, { text: '{itemName}穿上了。', emotion: 'pleased' }] },
    () => 0,
  )
  assert.equal(replaced.text, '丝绒长裙穿上了。')
  assert.equal(replaced.emotion, 'pleased')

  // 只命中第二条：同样跳过非法占位符
  const skipped = resolveCachedText(
    event({ type: 'appearance.applied', payload: { itemName: '绒线帽' } }),
    { 'appearance.applied': [{ text: '{unknown}占位', emotion: 'neutral' }, { text: '{itemName}戴上了。', emotion: 'shy' }] },
    () => 0.9,
  )
  assert.equal(skipped.text, '绒线帽戴上了。')
  assert.equal(skipped.emotion, 'shy')

  const allInvalid = resolveCachedText(
    event(),
    { 'appearance.applied': [{ text: '{unknown}占位', emotion: 'neutral' }] },
    () => 0,
  )
  assert.equal(allInvalid, null, '没有合法短句时静默')
})

test('cached text is clamped to 40 visible characters', () => {
  const line = resolveCachedText(event(), { 'appearance.applied': [{ text: '好'.repeat(60), emotion: 'neutral' }] }, () => 0)
  assert.equal(Array.from(line.text).length, 40)
})

test('emotion maps to a semantic marker and markers are stripped from the displayed line', () => {
  assert.equal(markerKeyForEmotion('pleased'), '😊')
  assert.equal(markerKeyForEmotion('shy'), '😳')
  assert.equal(markerKeyForEmotion('surprised'), '😮')
  assert.equal(markerKeyForEmotion('neutral'), '🙂')
  // 建议格式是「😊#笑#正文」：剥掉已有表情的标记后只留正文
  const parsed = parseMarkers('😊#笑#这张你也要留着啊。')
  assert.equal(parsed.hasMarker, true)
  assert.equal(parsed.text, '这张你也要留着啊。')
  // 没有标记时保持原文，不做任何截断
  const plain = parseMarkers('就这样吧。')
  assert.equal(plain.hasMarker, false)
  assert.equal(plain.text, '就这样吧。')
  // 使用 U+FE0F 变体选择符的写法同样被识别
  const variant = parseMarkers('😊\uFE0F#笑#就这样吧。')
  assert.equal(variant.hasMarker, true)
  assert.equal(variant.text, '就这样吧。')
  // 整行只有标记时保留可展示文本，而不是显示空句
  const markerOnly = parseMarkers('😊#好呀。#')
  assert.equal(markerOnly.hasMarker, true)
  assert.equal(markerOnly.text, '#好呀。#')
})

// ── 生产者：事实边界（§2.2 / §4.1 / §10.2）──

test('pin: repeated saves, unpinning and failed calls never fire', () => {
  assert.equal(emitCharacterPinEnabled({ characterId: 1, pinned: false, wasPinned: true, ok: true }).reason, 'no-op')
  assert.equal(emitCharacterPinEnabled({ characterId: 1, pinned: true, wasPinned: true, ok: true }).reason, 'no-op')
  assert.equal(emitCharacterPinEnabled({ characterId: 1, pinned: true, wasPinned: false, ok: false }).reason, 'no-op')
  const fired = emitCharacterPinEnabled({ characterId: 1, pinned: true, wasPinned: false, ok: true })
  assert.equal(fired.ok, true)
  assert.equal(fired.event.actorKey, 'character:1')
})

test('moment like: user posts and NPC posts are not character targets; the 7-day branch is explicit', () => {
  assert.equal(emitMomentLikeEnabled({ post: { id: 1, character_id: null }, liked: true }).reason, 'user-post')
  assert.equal(emitMomentLikeEnabled({ post: { id: 2, npc_id: 5 }, liked: true }).reason, 'npc-unsupported')
  assert.equal(emitMomentLikeEnabled({ post: { id: 3, character_id: 9 }, liked: false }).reason, 'no-op')

  const recent = emitMomentLikeEnabled({ post: { id: 4, character_id: 9, created_at: new Date(clock - 3600_000).toISOString() }, liked: true, now: clock })
  assert.equal(recent.event.payload.old, false)
  const old = emitMomentLikeEnabled({ post: { id: 5, character_id: 9, created_at: new Date(clock - 30 * 24 * 3600_000).toISOString() }, liked: true, now: clock })
  assert.equal(old.event.payload.old, true)
})

test('appearance applied only covers appearance kinds and yields to existing narrative feedback', () => {
  assert.equal(emitAppearanceApplied({ characterId: 1, kind: 'buff' }).reason, 'not-appearance')
  assert.equal(emitAppearanceApplied({ characterId: 1, kind: 'outfit', hasNarrative: true }).reason, 'original-feedback')
  const ok = emitAppearanceApplied({ characterId: 1, kind: 'outfit', itemName: '丝绒长裙', effectKey: 'outfit:v3' })
  assert.equal(ok.ok, true)
  assert.equal(ok.event.payload.itemName, '丝绒长裙')
  assert.match(ok.event.payload.summary, /丝绒长裙/)
})

test('letter reopening requires a previously read incoming letter older than 7 days', () => {
  const base = { id: 11, direction: 'char_to_user', character_id: 42, is_read: 1, replied_at: new Date(clock - 30 * 24 * 3600_000).toISOString() }
  assert.equal(emitLetterReopened({ letter: { ...base, direction: 'user_to_char' }, now: clock }).reason, 'not-incoming')
  assert.equal(emitLetterReopened({ letter: { ...base, is_read: 0 }, now: clock }).reason, 'first-read')
  assert.equal(emitLetterReopened({ letter: { ...base, replied_at: new Date(clock - 3600_000).toISOString() }, now: clock }).reason, 'too-recent')
  const ok = emitLetterReopened({ letter: base, now: clock })
  assert.equal(ok.ok, true)
  assert.equal(ok.event.subject.id, '11')
})

test('dedupe keys separate resources where the fact is resource-scoped', () => {
  assert.equal(dedupeKeyFor(event({ subject: { kind: 'outfit', id: 'a' } })), 'appearance.applied|character:42|a')
  assert.equal(dedupeKeyFor(event({ type: 'character.pin_enabled', subject: { kind: 'character', id: '42' } })), 'character.pin_enabled|character:42')
  assert.equal(isKnownEventType('appearance.applied'), true)
  assert.equal(localDayKey(clock).length, 10)
})

// ── M3：组合规则与 P1 生产者（§2.2 / §2.5 / §6.2）──


test('new P1 producers keep the fact boundary: unchanged / failed / unattributed stay silent', () => {
  assert.equal(emitCharacterAvatarChanged({ characterId: 1, previousVersion: 'a', nextVersion: 'a', ok: true }).reason, 'unchanged')
  assert.equal(emitCharacterAvatarChanged({ characterId: 1, previousVersion: 'a', nextVersion: 'b', ok: false }).reason, 'no-op')
  const avatar = emitCharacterAvatarChanged({ characterId: 1, previousVersion: 'a', nextVersion: 'b', ok: true })
  assert.equal(avatar.ok, true)
  assert.equal(avatar.event.type, 'character.avatar_changed')

  assert.equal(emitCharacterDisplayNameChanged({ characterId: 1, previousName: 'A', nextName: 'A', ok: true }).reason, 'unchanged')
  const name = emitCharacterDisplayNameChanged({ characterId: 1, previousName: 'A', nextName: 'B', ok: true })
  assert.equal(name.ok, true)
  assert.equal(name.event.type, 'character.display_name_changed')

  assert.equal(emitMomentShareExported({ post: { id: 1, character_id: null } }).reason, 'user-post')
  assert.equal(emitMomentShareExported({ post: { id: 2, npc_id: 5 } }).reason, 'npc-unsupported')
  const share = emitMomentShareExported({ post: { id: 3, character_id: 7 }, channel: 'download' })
  assert.equal(share.ok, true)
  assert.equal(share.event.subject.kind, 'moment')

  assert.equal(emitAppearanceRestored({ characterId: 1, kind: 'buff' }).reason, 'not-appearance')
  assert.equal(emitAppearanceRestored({ characterId: 1, kind: 'outfit', effectKey: 'outfit:a' }).ok, true)
})

test('an in-flight model request blocks repeats but not its own late result', () => {
  const { engine } = makeEngine({ llmProbability: 1 })
  const e = event()
  assert.equal(engine.decide(e).action, 'request-llm')
  // 模型在途期间同一事实再次派发仍被挡下，不重复请求
  assert.equal(engine.decide(e).reason, 'duplicate')
  // 但异步返回后的终检不能把这次请求自身当成已展示而过早丢弃
  assert.equal(engine.stillValid(e), true)
  // 缓存回退展示后，同一事实在新的模型间隔前不会再请求 / 展示
  engine.markDisplayed(e)
  assert.equal(engine.stillValid(e), false)
})

//  2.3 P1：只记录、不弹出的上下文事实（非小镇）

test('record-only facts feed context but never display or request the model', () => {
  const { engine } = makeEngine({ llmProbability: 1 })
  const cases = [
    ['moment.comment', { kind: 'moment', id: 'p1' }],
    ['schedule.agreement', { kind: 'schedule', id: 's1' }],
  ]
  for (const [type, subject] of cases) {
    const e = event({ type, subject, outcome: 'confirmed' })
    assert.equal(engine.decide(e).reason, 'record-only')
    assert.equal(engine.stillValid(e), false)
  }
})

test('record-only producers guard the success fact and never target non-character content', () => {
  assert.equal(emitMomentComment({ post: { id: 3, character_id: null } }).reason, 'user-post')
  assert.equal(emitMomentComment({ post: { id: 4, npc_id: 2 } }).reason, 'npc-unsupported')
  const comment = emitMomentComment({ post: { id: 5, character_id: 7 }, commentId: 99 })
  assert.equal(comment.event.type, 'moment.comment')
  assert.equal(comment.event.actorKey, 'character:7')

  const agreement = emitScheduleAgreement({ characterId: 7, activity: '一起看展', index: 2 })
  assert.equal(agreement.ok, true)
  assert.equal(agreement.event.type, 'schedule.agreement')
  assert.equal(agreement.event.subject.kind, 'schedule')
  assert.equal(emitScheduleAgreement({}).reason, 'no-op')
})

test('record-only facts still normalize and reach the observation history', () => {
  const bus = createObservationBus({ now, maxObservations: 10, ttlMs: 60_000, historyLimit: 3 })
  const res = bus.dispatch({
    type: 'moment.comment', source: 'moments-store', actorKey: 'character:7',
    subject: { kind: 'moment', id: '5' }, operationId: 'moment-comment:5:99', outcome: 'confirmed',
    payload: { summary: '用户评论了该角色发布的一条动态' },
  })
  assert.equal(res.ok, true)
  bus.commitHistory(res.event)
  assert.equal(bus.recentHistory().length, 1)
  assert.equal(bus.recentHistory()[0].type, 'moment.comment')
})

test('relationship and schedule-peek producers expose only the confirmed fact', () => {
  assert.equal(emitRelationshipChanged({}).reason, 'no-op')
  const created = emitRelationshipChanged({ characterId: 7, action: 'create', targetName: '小明' })
  assert.equal(created.ok, true)
  assert.equal(created.event.type, 'character.relationship_changed')
  assert.equal(created.event.actorKey, 'character:7')
  assert.equal(created.event.source, 'relationship-editor')
  assert.equal(created.event.subject.kind, 'relationship')
  assert.equal(emitRelationshipChanged({ characterId: 7, action: 'delete' }).event.payload.action, 'delete')

  assert.equal(emitSchedulePeeked({}).reason, 'no-op')
  const peek = emitSchedulePeeked({ characterId: 9, activityName: '在咖啡馆看书' })
  assert.equal(peek.ok, true)
  assert.equal(peek.event.type, 'schedule.peeked')
  assert.equal(peek.event.source, 'schedule-view')
  assert.equal(peek.event.subject.kind, 'schedule')
  assert.equal(peek.event.actorKey, 'character:9')
})
