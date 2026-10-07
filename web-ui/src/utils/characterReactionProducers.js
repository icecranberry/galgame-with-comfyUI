/**
 * 角色操作反馈 —— 生产适配器。
 *
 * 每个业务成功分支只调用这里的函数，把「已经确认成功的最小事实」转成一条语义事件；
 * 具体是否反馈、怎么反馈由规则层与 store 决定。
 * 禁止在这里读「此刻选中的角色」——延迟完成的操作必须使用发起时捕获的快照（§5.3）。
 * 见 docs/character-reaction-notification-plan.md §5.1。
 */

import { dispatchCharacterObservation } from './characterObservationEvents.js'
import { localDayKey } from './characterReactionRules.js'

/**
 * 置顶：只有从未置顶到置顶、且接口确认成功才算（§2.2）。
 * @param {object} params `{ characterId, characterName, wasPinned, pinned, ok }`
 */
export function emitCharacterPinEnabled({ characterId, characterName = '', wasPinned = false, pinned = false, ok = false } = {}) {
  if (!ok || !pinned || wasPinned) return { ok: false, reason: 'no-op' }
  return dispatchCharacterObservation({
    type: 'character.pin_enabled',
    source: 'character-pin',
    initiator: 'user',
    actorKey: `character:${characterId}`,
    actorName: characterName,
    subject: { kind: 'character', id: String(characterId) },
    operationId: `pin:${characterId}:${Date.now()}`,
    outcome: 'confirmed',
    payload: { summary: `用户把角色${characterId}置顶` },
  })
}

/**
 * 点赞角色动态：liked=true 且作者可确认；用户自己的动态与镇民动态不触发（§4.1）。
 * @param {object} params `{ post, liked }`，post 使用帖子对象快照
 */
export function emitMomentLikeEnabled({ post, liked = false, now = Date.now() } = {}) {
  if (!liked || !post) return { ok: false, reason: 'no-op' }
  if (post.npc_id != null) return { ok: false, reason: 'npc-unsupported' }
  if (post.character_id == null) return { ok: false, reason: 'user-post' }
  const createdMs = new Date(post.created_at || 0).getTime()
  const isOld = Number.isFinite(createdMs) && createdMs > 0 && (now - createdMs) > 7 * 24 * 3600_000
  return dispatchCharacterObservation({
    type: 'moment.like_enabled',
    source: 'moments-store',
    initiator: 'user',
    actorKey: `character:${post.character_id}`,
    actorName: post.display_name || '',
    subject: { kind: 'moment', id: String(post.id) },
    operationId: `like:${post.id}:${liked ? 'on' : 'off'}`,
    outcome: 'confirmed',
    payload: {
      old: isOld,
      summary: isOld
        ? `用户点赞了角色${post.character_id}发布的一条历史动态`
        : `用户点赞了角色${post.character_id}发布的一条动态`,
    },
  })
}

/**
 * 外观类道具结算成功。仅外观类 kind 计入；原流程已有角色台词或图片叙事时抑制（§2.2 / §2.3）。
 * @param {object} params `{ characterId, itemName, effectKey, effectId, kind, hasNarrative }`
 */
export function emitAppearanceApplied({ characterId, itemName = '', effectKey = '', effectId = null, kind = '', hasNarrative = false } = {}) {
  if (hasNarrative) return { ok: false, reason: 'original-feedback' }
  const appearanceKinds = ['outfit', 'world_outfit', 'hairstyle', 'transform']
  if (!appearanceKinds.includes(kind)) return { ok: false, reason: 'not-appearance' }
  return dispatchCharacterObservation({
    type: 'appearance.applied',
    source: 'backpack-store',
    initiator: 'user',
    actorKey: `character:${characterId}`,
    subject: { kind: 'outfit', id: String(effectKey || effectId || 'appearance') },
    operationId: `appearance:${characterId}:${effectKey || effectId}`,
    outcome: 'applied',
    payload: {
      itemName: String(itemName || '').slice(0, 40),
      summary: `用户给角色${characterId}用了外观类道具${itemName ? `「${itemName}」` : ''}`,
    },
  })
}

/**
 * 重开旧回信：必须是本人收到的、该角色写的、先前已读、完成时间距今超过 7 天（§2.2）。
 * 不能由后台 markRead 或列表加载推断。
 * @param {object} params `{ letter, now }`
 */
export function emitLetterReopened({ letter, now = Date.now() } = {}) {
  if (!letter || letter.direction !== 'char_to_user') return { ok: false, reason: 'not-incoming' }
  if (!letter.is_read) return { ok: false, reason: 'first-read' }
  if (letter.character_id == null) return { ok: false, reason: 'unknown-author' }
  const repliedMs = new Date(letter.replied_at || letter.reply_at || letter.created_at || 0).getTime()
  if (!Number.isFinite(repliedMs) || repliedMs <= 0) return { ok: false, reason: 'unknown-time' }
  if (now - repliedMs < 7 * 24 * 3600_000) return { ok: false, reason: 'too-recent' }
  return dispatchCharacterObservation({
    type: 'letter.reopened',
    source: 'mailbox-view',
    initiator: 'user',
    actorKey: `character:${letter.character_id}`,
    actorName: letter.display_name || '',
    subject: { kind: 'letter', id: String(letter.id) },
    operationId: `letter-open:${letter.id}:${localDayKey(now)}`,
    outcome: 'confirmed',
    payload: { summary: `用户重新打开了角色${letter.character_id}写的一封已读旧回信` },
  })
}

/** 短哈希：只用于 operationId 去重，不保存原始 URL / 名称（§5.3） */
function shortToken(value) {
  const str = String(value || '')
  let h = 0
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * 角色头像更换：只有新版本与旧版本不同、且接口确认保存成功才算（§2.2）。
 * 上传预览、裁剪过程不算完成，也不分析头像内容。
 */
export function emitCharacterAvatarChanged({ characterId, previousVersion = '', nextVersion = '', ok = false } = {}) {
  if (!ok || characterId === undefined || characterId === null) return { ok: false, reason: 'no-op' }
  const prev = String(previousVersion || '')
  const next = String(nextVersion || '')
  if (!next || next === prev) return { ok: false, reason: 'unchanged' }
  return dispatchCharacterObservation({
    type: 'character.avatar_changed',
    source: 'character-avatar',
    initiator: 'user',
    actorKey: `character:${characterId}`,
    subject: { kind: 'character', id: String(characterId) },
    operationId: `avatar:${characterId}:${shortToken(next)}`,
    outcome: 'confirmed',
    payload: { summary: `用户保存了角色${characterId}的新头像` },
  })
}

/**
 * 角色显示名修改：保存后新旧值确实不同才算；不声称已有独立昵称系统（§2.2）。
 */
export function emitCharacterDisplayNameChanged({ characterId, previousName = '', nextName = '', ok = false } = {}) {
  if (!ok || characterId === undefined || characterId === null) return { ok: false, reason: 'no-op' }
  const prev = String(previousName || '').trim()
  const next = String(nextName || '').trim()
  if (!next || next === prev) return { ok: false, reason: 'unchanged' }
  return dispatchCharacterObservation({
    type: 'character.display_name_changed',
    source: 'character-display-name',
    initiator: 'user',
    actorKey: `character:${characterId}`,
    subject: { kind: 'character', id: String(characterId) },
    operationId: `display-name:${characterId}:${shortToken(next)}`,
    outcome: 'confirmed',
    payload: { summary: `用户把角色${characterId}的显示名改成了新名字` },
  })
}

/**
 * 动态分享图导出：下载或复制成功发起后算一次；不声称已经发到外部平台，也不读取分享对象内容（§2.2）。
 */
export function emitMomentShareExported({ post, channel = 'download' } = {}) {
  if (!post) return { ok: false, reason: 'no-op' }
  if (post.npc_id != null) return { ok: false, reason: 'npc-unsupported' }
  if (post.character_id === undefined || post.character_id === null) return { ok: false, reason: 'user-post' }
  return dispatchCharacterObservation({
    type: 'moment.share_exported',
    source: 'moments-store',
    initiator: 'user',
    actorKey: `character:${post.character_id}`,
    subject: { kind: 'moment', id: String(post.id) },
    operationId: `share:${post.id}:${channel}`,
    outcome: 'confirmed',
    payload: { summary: `用户导出了角色${post.character_id}一条动态的分享图` },
  })
}

/**
 * 外观恢复：玩家主动移除生效中的外观效果，回到原来那一套；自动到期不算玩家操作（§2.2）。
 */
export function emitAppearanceRestored({ characterId, itemName = '', effectKey = '', effectId = null, kind = '' } = {}) {
  const appearanceKinds = ['outfit', 'world_outfit', 'hairstyle', 'transform']
  if (!appearanceKinds.includes(kind)) return { ok: false, reason: 'not-appearance' }
  return dispatchCharacterObservation({
    type: 'appearance.restored',
    source: 'backpack-store',
    initiator: 'user',
    actorKey: `character:${characterId}`,
    subject: { kind: 'outfit', id: String(effectKey || effectId || 'appearance') },
    operationId: `appearance-restore:${characterId}:${effectKey || effectId}`,
    outcome: 'applied',
    payload: {
      itemName: String(itemName || '').slice(0, 40),
      summary: `用户主动结束了角色${characterId}的外观效果，换回原来那一套`,
    },
  })
}

// ── §2.3 P1：只记录、不弹出的上下文事实 
// 这些事件只进入短期观察与会话历史（为后续组合判断打底），不抽签、不展示，
// 避免与既有送礼演出 / 异步回信 / 评论回复 / 日程广播重复说话。

/** 评论角色动态：原评论回复优先，这里只记录评论事实；用户自己的动态没有角色目标 */
export function emitMomentComment({ post, commentId = null } = {}) {
  if (!post) return { ok: false, reason: 'no-op' }
  if (post.npc_id != null) return { ok: false, reason: 'npc-unsupported' }
  if (post.character_id === undefined || post.character_id === null) return { ok: false, reason: 'user-post' }
  const subjectId = commentId === null || commentId === undefined ? `${post.id}:${Date.now()}` : String(commentId)
  return dispatchCharacterObservation({
    type: 'moment.comment',
    source: 'moments-store',
    initiator: 'user',
    actorKey: `character:${post.character_id}`,
    subject: { kind: 'moment', id: String(post.id) },
    operationId: `moment-comment:${post.id}:${subjectId}`,
    outcome: 'confirmed',
    payload: { summary: '用户评论了该角色发布的一条动态' },
  })
}

/** 明确保存日程约定：只记录「已排入日程」，有原确认时抑制，不声称已经赴约 */
export function emitScheduleAgreement({ characterId, activity = '', index = 0 } = {}) {
  if (characterId === undefined || characterId === null) return { ok: false, reason: 'no-op' }
  const label = String(activity || '').trim().slice(0, 40)
  return dispatchCharacterObservation({
    type: 'schedule.agreement',
    source: 'schedule-view',
    initiator: 'user',
    actorKey: `character:${characterId}`,
    subject: { kind: 'schedule', id: `${characterId}:${index}:${shortToken(label)}` },
    operationId: `schedule-agreement:${characterId}:${index}:${shortToken(label)}`,
    outcome: 'confirmed',
    payload: { summary: '用户明确保存了一条与该角色的日程约定' },
  })
}

/**
 * 关系变更：显式新建 / 修改 / 删除成功后记录，不复述关系内容（计划书 2.2）。
 * action: create | update | delete | deduced（推演确认）。
 */
export function emitRelationshipChanged({ characterId, action = 'update', targetName = '' } = {}) {
  if (characterId === undefined || characterId === null) return { ok: false, reason: 'no-op' }
  const act = ['create', 'update', 'delete', 'deduced'].includes(action) ? action : 'update'
  const label = String(targetName || '').slice(0, 20)
  const verb = act === 'delete' ? '删除' : act === 'create' ? '新建' : '修改'
  return dispatchCharacterObservation({
    type: 'character.relationship_changed',
    source: 'relationship-editor',
    initiator: 'user',
    actorKey: `character:${characterId}`,
    subject: { kind: 'relationship', id: `${characterId}:${act}:${shortToken(label)}` },
    operationId: `relationship:${characterId}:${act}:${Date.now()}`,
    outcome: 'confirmed',
    payload: { action: act, summary: `用户${verb}了一条该角色的关系` },
  })
}

/**
 * 瞄一眼日程：成功发起 peek 后记录；不描述快照画面，也不声称角色一定在做某事。
 */
export function emitSchedulePeeked({ characterId, activityName = '' } = {}) {
  if (characterId === undefined || characterId === null) return { ok: false, reason: 'no-op' }
  const label = String(activityName || '').slice(0, 20)
  return dispatchCharacterObservation({
    type: 'schedule.peeked',
    source: 'schedule-view',
    initiator: 'user',
    actorKey: `character:${characterId}`,
    subject: { kind: 'schedule', id: `${characterId}:${shortToken(label) || 'current'}` },
    operationId: `schedule-peek:${characterId}:${Date.now()}`,
    outcome: 'confirmed',
    payload: { summary: '用户瞄了一眼该角色此刻在做什么' },
  })
}

/** 只认已提交、真正给正式角色应用效果的服务端收据，不读取当前选择。 */
export function emitTownBuildingEffectApplied(operation) {
  if (operation?.status !== 'committed' || !operation.operationId) return { ok: false, reason: 'not-committed' }
  const result = operation.result
  const effect = ['appearance', 'state'].includes(result?.kind)
    ? result : result?.kind === 'fortune' ? result.stateApplied : null
  if (!effect?.effectId || !Number.isInteger(Number(effect.characterId)) || Number(effect.characterId) <= 0) {
    return { ok: false, reason: 'no-character-effect' }
  }
  const label = String(result.optionLabel || result.title || '').slice(0, 40)
  return dispatchCharacterObservation({
    type: 'town.building_effect_applied', source: 'town-building-feature', initiator: 'user',
    actorKey: `character:${effect.characterId}`, actorName: effect.targetName || '',
    worldId: operation.worldId,
    subject: { kind: 'building-operation', id: operation.operationId },
    operationId: operation.operationId, outcome: 'applied',
    payload: { itemName: label, summary: `特殊建筑给角色应用了「${label}」${result.kind === 'appearance' ? '外观' : '状态'}效果` },
  })
}
