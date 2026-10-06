/**
 * 角色通知的展示场景判断：遮挡与宿主可见性。
 *
 * 只做「现在适不适合弹一张角色通知」的粗判，不推断业务意图；
 * 具体候选的资格终检在 stores/characterReactions.js。
 * 见 docs/character-reaction-notification-plan.md §3.2 / §5.4。
 */

/**
 * 各独立特效 / 浮层的覆盖层选择器。
 * 含图片灯箱（.vel-modal）：卡片固定在右下角，与灯箱右侧操作栏同侧，
 * 打开期间暂停新通知，不覆盖灯箱的关闭 / 返回按钮（§3.2）。
 * 角色通知卡片自身用 data-ct-card 标记并排除。
 */
const OVERLAY_SELECTORS = [
  '.linshe-modal-overlay',             // 统一弹窗
  '.modal-overlay',                    // 页面自有遮罩面板
  '.iet-modal',                        // 图片编辑任务全屏对比
  '.vel-modal',                        // 图片灯箱（右侧操作栏与通知卡片同侧）
  '[data-ct-blocker]',                 // 全屏演出 / 抽屉 / 礼物演出的显式标记
]

/** 系统 Toast 容器内实际可见的卡片数（旧实现有 99999 强制层级，必须让位） */
export function activeSystemToastCount() {
  if (typeof document === 'undefined') return 0
  const host = document.querySelector('.__toast__root')
  if (!host) return 0
  let count = 0
  for (const el of host.querySelectorAll('.live-toast')) {
    if (isOverlayVisuallyActive(el)) count += 1
  }
  return count
}

/**
 * 浮层是否真的在占屏。只按选择器命中还不够：离场过渡被打断留下的幽灵遮罩
 * （opacity:0 但仍在 DOM、pointer-events:auto）或隐藏状态的常驻浮层
 * 会让遮挡判定永久为真，通知被 8 秒 TTL 队列静默丢弃（§3.2）。
 */
export function isOverlayVisuallyActive(el) {
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  if (Number.parseFloat(style.opacity) < 0.05) return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/** 除角色通知卡片自身以外，是否已有实际占屏的弹窗 / 演出 / 抽屉等覆盖层 */
export function activeSceneOverlays() {
  if (typeof document === 'undefined') return 0
  let count = 0
  for (const selector of OVERLAY_SELECTORS) {
    for (const el of document.querySelectorAll(selector)) {
      if (el.closest('[data-ct-card]')) continue
      if (!isOverlayVisuallyActive(el)) continue
      count += 1
    }
  }
  return count
}

/**
 * 是否应暂停新角色通知。
 * 返回 `{ blocked, reason }`，reason 便于日志与测试断言。
 */
export function isCharacterNotificationBlocked({ softKeyboard = false } = {}) {
  if (typeof document === 'undefined') return { blocked: true, reason: 'no-document' }
  if (document.visibilityState === 'hidden') return { blocked: true, reason: 'page-hidden' }
  if (softKeyboard) return { blocked: true, reason: 'soft-keyboard' }
  if (activeSystemToastCount() > 0) return { blocked: true, reason: 'system-toast' }
  if (activeSceneOverlays() > 0) return { blocked: true, reason: 'overlay' }
  return { blocked: false, reason: '' }
}

/** 软键盘探测：视口高度明显小于布局视口高度时视为键盘打开（§3.2） */
export function detectSoftKeyboard() {
  if (typeof window === 'undefined' || !window.visualViewport) return false
  const vv = window.visualViewport
  return (window.innerHeight - vv.height) > 120
}

/**
 * 订阅场景变化：可见性、覆盖层增删。
 * 返回卸载函数；多次调用各自独立。
 */
export function subscribeSceneChanges(listener) {
  if (typeof window === 'undefined') return () => {}
  const notify = () => listener()
  window.addEventListener('visibilitychange', notify)
  window.addEventListener('ct-scene-changed', notify)
  window.addEventListener('ct-toast-activity', notify)
  window.addEventListener('resize', notify)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', notify)
  }
  return () => {
    window.removeEventListener('visibilitychange', notify)
    window.removeEventListener('ct-scene-changed', notify)
    window.removeEventListener('ct-toast-activity', notify)
    window.removeEventListener('resize', notify)
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', notify)
    }
  }
}

/** 系统 Toast 增删后由 Toast.vue 通知，让宿主重算遮挡 */
export function notifyToastActivity() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('ct-toast-activity'))
}

/**
 * 组件侧显式标记遮挡（礼物演出、全屏抽屉、小镇全屏演出等）：
 * `notifySceneBlocker(true)` 开始遮挡，返回的函数用于解除。
 */
export function notifySceneBlocker(active = true) {
  if (typeof window === 'undefined') return () => {}
  window.dispatchEvent(new CustomEvent('ct-scene-changed', { detail: { active } }))
  return () => window.dispatchEvent(new CustomEvent('ct-scene-changed', { detail: { active: false } }))
}
