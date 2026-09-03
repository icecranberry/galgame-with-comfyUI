import { ref, computed, onUnmounted } from 'vue'
import { useBackpackStore } from '../stores/backpack.js'

/** 道具详情里的种类说明文案 */
export const ITEM_KIND_LABELS = {
  outfit: '服饰卡 · 换装一天',
  world_outfit: '世界观服饰卡 · 换装一天',
  hairstyle: '发型卡 · 换发型一天',
  transform: '形态卡 · 变身一天',
  buff: '状态道具 · 持续六小时',
  mood: '心情道具 · 立即生效',
  favor: '心意道具 · 立即生效',
  unknown: '神秘道具',
}

const EFFECT_KIND_LABELS = { outfit: '服饰', world_outfit: '特殊服饰', hairstyle: '发型', transform: '变身', buff: '状态', mood: '心情', favor: '心意', unknown: '未知' }
const EFFECT_ICON_PATHS = {
  outfit: 'M12 3l4 2 5-1-1 5-3 1v9H7v-9L4 9 3 4l5 1z',
  world_outfit: 'M12 3l4 2 5-1-1 5-3 1v9H7v-9L4 9 3 4l5 1z',
  hairstyle: 'M9 6a3 3 0 1 1-6 0 3 3 0 1 1 6 0M9 18a3 3 0 1 1-6 0 3 3 0 1 1 6 0M8.12 8.12 12 12M20 4 8.12 15.88M14.8 14.8 20 20',
  transform: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  buff: 'M13 2 4.5 13H11l-1 9 8.5-11H12l1-9z',
  mood: 'M12 21S4.5 16.2 2.5 12C1 8.6 3.2 5.5 6.4 5.5c2 0 3.5 1.1 5.6 3.4 2.1-2.3 3.6-3.4 5.6-3.4 3.2 0 5.4 3.1 3.9 6.5-2 4.2-9.5 9-9.5 9z',
  favor: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8-6.1-3.4-6.1 3.4 1.4-6.8L2.2 9.1l6.9-.8z',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 背包交互逻辑：开箱演出、使用（含角色选择）、丢弃、生效效果管理。
 * BackpackModal（酒馆桌面弹窗）与 BackpackView（移动端整页）共享，
 * 确认框与 toast 由调用方注入：confirm(opts) => Promise<boolean>，toast(message, type)。
 */
export function useBackpackActions({ confirm, toast }) {
  const store = useBackpackStore()

  const fullscreen = ref(false)
  const chestAnim = ref('idle')          // idle | charging | opening | opened | exiting
  const chestProcessActive = ref(false)  // 流程未进入 exiting 前，背包不展示冷却信息
  const chargeBoost = ref(false)         // 蓄力强化档
  const flashOn = ref(false)
  const revealedItemId = ref(null)
  const showCharPicker = ref(false)
  const pendingItem = ref(null)
  const detailItem = ref(null)
  const removingEffectId = ref(null)
  const effectNow = ref(Date.now())
  const collecting = ref(false)

  let chargeBoostTimer = null
  let flashTimer = null
  let flashOffTimer = null
  let openedTimer = null
  let exitTimer = null
  let openSeq = 0                        // 开箱序号：关闭演出/再次开箱后旧等待循环自动作废

  const revealedItem = computed(() =>
    store.items.find(i => i.id === revealedItemId.value)
    || store.pendingItems.find(i => i.id === revealedItemId.value)
    || null
  )

  const revealVisible = computed(() => chestAnim.value === 'opened' || chestAnim.value === 'exiting')

  function clearRevealTimers() {
    for (const timer of [flashTimer, flashOffTimer, openedTimer, exitTimer]) {
      if (timer) clearTimeout(timer)
    }
    flashTimer = null
    flashOffTimer = null
    openedTimer = null
    exitTimer = null
  }

  // 本地倒计时（每秒）
  let countdownTimer = null
  function startCountdown() {
    stopCountdown()
    countdownTimer = setInterval(() => {
      store._tickCooldown()
      effectNow.value = Date.now()
    }, 1000)
  }
  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
  }

  const countdownText = computed(() => {
    const s = store.chest.remainingSeconds || 0
    if (s <= 0) return '已就绪'
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h} 小时 ${m} 分`
    if (m > 0) return `${m} 分 ${sec} 秒`
    return `${sec} 秒`
  })

  // 非本次开箱流程的正常冷却仍可查看；本次流程只有到 exiting 后才恢复倒计时。
  const showChestCooldown = computed(() =>
    !store.chest.canOpen && !chestProcessActive.value && !store.chest.generating
  )
  const chestButtonLabel = computed(() => {
    if (store.chest.canOpen) return '开启宝箱'
    return showChestCooldown.value ? `下次开启 · ${countdownText.value}` : '开启宝箱'
  })

  function effectKindLabel(kind) { return EFFECT_KIND_LABELS[kind] || EFFECT_KIND_LABELS.unknown }
  function effectIconPath(kind) { return EFFECT_ICON_PATHS[kind] || EFFECT_ICON_PATHS.transform }

  function effectRemainingSeconds(ef) {
    if (ef.expires_at == null) return null
    const rawExpiresAt = String(ef.expires_at)
    const normalizedExpiresAt = rawExpiresAt.includes('T')
      ? (/[zZ]|[+-]\d{2}:?\d{2}$/.test(rawExpiresAt) ? rawExpiresAt : `${rawExpiresAt}Z`)
      : `${rawExpiresAt.replace(' ', 'T')}Z`
    const expiresAt = new Date(normalizedExpiresAt).getTime()
    if (!Number.isFinite(expiresAt)) return Math.max(0, Number(ef.remaining_seconds) || 0)
    return Math.max(0, Math.round((expiresAt - effectNow.value) / 1000))
  }

  function effectRemainingText(ef) {
    const s = effectRemainingSeconds(ef)
    if (s == null) return '永久生效'
    if (s <= 0) return '即将结束'
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (h > 0) return `剩余 ${h} 小时 ${m} 分`
    if (m <= 0) return `剩余 ${s} 秒`
    return `剩余 ${m} 分钟`
  }

  function isEffectUrgent(ef) {
    const remaining = effectRemainingSeconds(ef)
    return remaining != null && remaining > 0 && remaining <= 3600
  }

  function closeFullscreen() {
    clearRevealTimers()
    fullscreen.value = false
    chestAnim.value = 'idle'
    chestProcessActive.value = false
    chargeBoost.value = false
    flashOn.value = false
    revealedItemId.value = null
    if (chargeBoostTimer) { clearTimeout(chargeBoostTimer); chargeBoostTimer = null }
  }

  /** 关闭背包（弹窗隐藏 / 离开页面）时重置所有二级界面状态 */
  function resetUi() {
    closeFullscreen()
    showCharPicker.value = false
    pendingItem.value = null
    detailItem.value = null
  }

  // ── 开箱：全屏蓄力 → 等图片生成完毕 → 开盖揭示 ──

  /** 进入蓄力态：全屏演出、蓄力 6 秒后切强化档动画 */
  function enterCharging() {
    chestProcessActive.value = true
    fullscreen.value = true
    chestAnim.value = 'charging'
    chargeBoost.value = false
    if (chargeBoostTimer) clearTimeout(chargeBoostTimer)
    chargeBoostTimer = setTimeout(() => { chargeBoost.value = true }, 6000)
  }

  /** 蓄力等待道具图片生成完毕才揭示（SSE item_ready 会实时更新 store，轮询兜底）；约 3 分钟超时先揭示 */
  async function chargeAndWaitReveal(itemId) {
    const seq = ++openSeq
    const start = Date.now()
    while (Date.now() - start < 180000) {
      await sleep(2500)
      if (seq !== openSeq || !fullscreen.value) return
      const it = store.items.find((i) => i.id === itemId)
        || store.pendingItems.find((i) => i.id === itemId)
      if (it && it.status === 'ready') { burstReveal(seq); return }
      store.fetchItems()
    }
    // 超时兜底：先揭示，图片完成后背包里自动更新
    burstReveal(seq, true)
  }

  async function onOpenChest() {
    if (!store.chest.canOpen || fullscreen.value) return
    enterCharging()

    const seq = ++openSeq
    try {
      const result = await store.openChest()
      if (seq !== openSeq) return
      if (!result.ok) {
        toast?.(result.error || '宝箱开启失败', 'error')
        closeFullscreen()
        return
      }
      revealedItemId.value = result.item.id
      await chargeAndWaitReveal(result.item.id)
    } catch (err) {
      if (seq !== openSeq) return
      toast?.(err.message || '宝箱开启失败', 'error')
      closeFullscreen()
    }
  }

  /** 断点续播：刷新/中途离开后重进背包，上一箱还没收下时续播揭示演出（已出图直接开盖，未出图续蓄力等待） */
  async function resumePendingReveal() {
    if (fullscreen.value || chestProcessActive.value) return
    await store.fetchItems()
    if (fullscreen.value || chestProcessActive.value) return
    const pending = store.pendingItems[0]
    if (!pending) return
    revealedItemId.value = pending.id
    chestProcessActive.value = true
    fullscreen.value = true
    if (pending.status !== 'ready') {
      enterCharging()
      await chargeAndWaitReveal(pending.id)
      return
    }
    burstReveal(++openSeq)
  }

  function burstReveal(seq, timedOut = false) {
    if (seq !== openSeq || !fullscreen.value) return
    if (chargeBoostTimer) { clearTimeout(chargeBoostTimer); chargeBoostTimer = null }
    clearRevealTimers()
    chestAnim.value = 'opening'

    // 锁扣先退、箱盖后起；白光落在开盖动作中段，不抢先遮住结构动画。
    flashTimer = setTimeout(() => {
      if (seq !== openSeq || !fullscreen.value) return
      flashOn.value = true
      flashOffTimer = setTimeout(() => { flashOn.value = false }, 720)
    }, 360)

    // SVG 开启动作完成后再揭示道具，随后宝箱独立退场。
    openedTimer = setTimeout(() => {
      if (seq !== openSeq || !fullscreen.value) return
      chestAnim.value = 'opened'
    }, 1160)
    exitTimer = setTimeout(() => {
      if (seq !== openSeq || !fullscreen.value) return
      chestAnim.value = 'exiting'
      chestProcessActive.value = false
    }, 2180)

    if (timedOut) toast?.('图片绘制较慢，先展示道具，完成后背包里会自动更新', 'info')
  }

  /** 开箱演出里的「收入背包」：收下后关闭演出，道具进入背包 */
  async function onCollectFromReveal() {
    if (collecting.value) return
    collecting.value = true
    try {
      if (revealedItemId.value != null) {
        const result = await store.collectItem(revealedItemId.value)
        if (!result.ok) toast?.(result.error || '收下失败', 'error')
      }
    } catch (err) {
      toast?.(err.message || '收下失败', 'error')
    } finally {
      collecting.value = false
      closeFullscreen()
    }
  }

  // ── 使用 / 丢弃 ──

  function openDetail(item) {
    if (!item) return
    detailItem.value = item
  }

  function startUse(item) {
    if (!item || item.status !== 'ready') return
    detailItem.value = null
    pendingItem.value = item
    showCharPicker.value = true
  }

  function cancelPick() {
    showCharPicker.value = false
    pendingItem.value = null
  }

  async function pickCharacter(char) {
    const item = pendingItem.value
    if (!item) return
    showCharPicker.value = false
    const effectHint = {
      outfit: `会让 ${char.display_name} 换上这套服装，持续一天`,
      world_outfit: `会让 ${char.display_name} 换上这套来自当前世界观的服装，持续一天`,
      hairstyle: `会让 ${char.display_name} 换上这个发型，持续一天`,
      transform: `会让 ${char.display_name} 变身成这种形态，持续一天`,
      buff: `会让 ${char.display_name} 在接下来几小时的对话中带上这种状态`,
      mood: `会立即把 ${char.display_name} 的心情修复为开心`,
      favor: `会立即提升与 ${char.display_name} 的亲密度`,
    }[item.kind] || '使用后立即生效'

    const ok = await confirm?.({
      title: '使用道具',
      message: `确定对 ${char.display_name} 使用「${item.name}」吗？\n${effectHint}`,
      okText: '使用',
    })
    if (!ok) { pendingItem.value = null; return }
    try {
      const result = await store.useItem(item.id, char.id)
      if (result.ok) {
        toast?.(result.summary || '道具已使用', 'success')
      } else {
        toast?.(result.error || '使用失败', 'error')
      }
    } catch (err) {
      toast?.(err.message || '使用失败', 'error')
    } finally {
      pendingItem.value = null
    }
  }

  async function onDiscard(item) {
    if (!item) return
    const ok = await confirm?.({
      title: '丢弃道具',
      message: `确定丢弃「${item.name}」吗？丢弃后无法找回。`,
      okText: '丢弃',
      danger: true,
    })
    if (!ok) return
    try {
      await store.discardItem(item.id)
      detailItem.value = null
      if (revealedItemId.value === item.id) revealedItemId.value = null
      toast?.('已丢弃', 'success')
    } catch (err) {
      toast?.(err.message || '丢弃失败', 'error')
    }
  }

  async function onRemoveEffect(effect) {
    if (!effect || removingEffectId.value !== null) return
    const effectName = effect.item_name || effect.effect_name || '这个效果'
    const ok = await confirm?.({
      title: '移除生效效果',
      message: `确定结束 ${effect.character_name} 的「${effectName}」吗？\n移除后会立即恢复原状态，且无法撤销。`,
      okText: '移除',
      danger: true,
    })
    if (!ok) return

    removingEffectId.value = effect.id
    try {
      const result = await store.removeActiveEffect(effect.id)
      if (result.ok) {
        toast?.(`已移除 ${effect.character_name} 的「${effectName}」`, 'success')
      } else {
        toast?.(result.error || '移除失败', 'error')
      }
    } catch (err) {
      toast?.(err.message || '移除失败', 'error')
    } finally {
      removingEffectId.value = null
    }
  }

  onUnmounted(() => {
    stopCountdown()
    if (chargeBoostTimer) { clearTimeout(chargeBoostTimer); chargeBoostTimer = null }
    clearRevealTimers()
  })

  return {
    store,
    // 开箱演出
    fullscreen, chestAnim, chestProcessActive, chargeBoost, flashOn,
    revealedItem, revealVisible, collecting,
    onOpenChest, onCollectFromReveal, closeFullscreen, resumePendingReveal,
    // 宝箱倒计时
    countdownText, showChestCooldown, chestButtonLabel,
    startCountdown, stopCountdown,
    // 生效效果
    effectKindLabel, effectIconPath, effectRemainingText, isEffectUrgent,
    removingEffectId, onRemoveEffect,
    // 道具使用 / 丢弃
    detailItem, openDetail, startUse,
    showCharPicker, pendingItem, cancelPick, pickCharacter,
    onDiscard,
    resetUi,
  }
}
