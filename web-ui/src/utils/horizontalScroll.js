// 横向滑动（触控板左右滑、Shift+滚轮）交给浏览器原生处理，保留惯性和 scroll-snap。
// 只把竖向滚轮转成横向：触控板的小步长直接跟手，鼠标滚轮的大步长用 rAF 缓动，
// 连续滚动时累加到同一个目标上，不会像每次都调 scrollTo smooth 那样不停重启动画。
const MOUSE_STEP = 50
const EASE = 0.3
const easing = new WeakMap()

function stopEasing(element) {
  const state = easing.get(element)
  if (state?.frame) cancelAnimationFrame(state.frame)
  easing.delete(element)
}

function easeTowardTarget(element) {
  const state = easing.get(element)
  if (!state) return
  const remaining = state.target - element.scrollLeft
  if (Math.abs(remaining) < 0.5) {
    element.scrollLeft = state.target
    easing.delete(element)
    return
  }
  element.scrollLeft += remaining * EASE
  state.frame = requestAnimationFrame(() => easeTowardTarget(element))
}

/** Translate a vertical mouse wheel into horizontal scrolling, preserving page scroll at either end. */
export function scrollHorizontalOnWheel(event) {
  if (event.ctrlKey || event.defaultPrevented) return
  const element = event.currentTarget
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
    stopEasing(element)
    return
  }
  const max = element.scrollWidth - element.clientWidth
  if (max <= 0) return
  const unit = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? element.clientWidth : 1
  const delta = event.deltaY * unit
  const state = easing.get(element)
  const from = state ? state.target : element.scrollLeft
  const next = Math.max(0, Math.min(max, from + delta))
  if (next === from) return
  event.preventDefault()
  if (Math.abs(delta) < MOUSE_STEP && !state) {
    element.scrollLeft = next
    return
  }
  if (state) state.target = next
  else {
    easing.set(element, { target: next, frame: 0 })
    easeTowardTarget(element)
  }
}
