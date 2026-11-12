import { nextTick, ref } from 'vue'

// 进入时只执行一次；每帧重新测量分界线，兼容字体和历史图片改变高度。
export function useGroupEntryScroll({ container, busy, reveal, onStart, onFinish }) {
  const active = ref(false)
  let frame = null
  let revision = 0

  function cancel() {
    revision++
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    active.value = false
  }

  async function start(entry) {
    cancel()
    if (!entry?.unread || entry.generating || busy()) return false
    const current = revision
    active.value = true
    onStart()
    if (!reveal()) { cancel(); return false }
    await nextTick()
    if (current !== revision) return false
    const el = container()
    const divider = el?.querySelector('.last-seen-divider')
    if (!el || !divider || busy()) { cancel(); return false }
    el.scrollTop = el.scrollHeight
    const from = el.scrollTop
    const startedAt = performance.now()
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    function step(now) {
      if (current !== revision) return
      if (busy()) { cancel(); onFinish(); return }
      const progress = reduceMotion ? 1 : Math.min(1, (now - startedAt) / 300)
      const dividerRect = divider.getBoundingClientRect()
      const target = Math.max(0, Math.min(el.scrollHeight - el.clientHeight,
        el.scrollTop + dividerRect.top + dividerRect.height / 2
          - el.getBoundingClientRect().top - el.clientTop - el.clientHeight / 2))
      // 限制为向上移动，避免异步布局变化造成来回滚动。
      el.scrollTop = Math.min(el.scrollTop, from + (target - from) * (1 - (1 - progress) ** 3))
      if (progress < 1) frame = requestAnimationFrame(step)
      else {
        frame = null
        active.value = false
        onFinish()
      }
    }
    frame = requestAnimationFrame(step)
    return true
  }

  return { active, start, cancel }
}
