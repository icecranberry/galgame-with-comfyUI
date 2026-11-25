// 横向滑动（触控板左右滑、Shift+滚轮）交给浏览器原生处理，保留惯性和 scroll-snap。
// 只把竖向滚轮转成横向：触控板的小步长直接跟手，鼠标滚轮的大步长累加到同一个目标上缓动。
// 缓动按时间衰减而不是按帧比例，页面掉帧时也在大约同样的时间内到位。
const MOUSE_STEP = 50
const EASE_MS = 60
const easing = new WeakMap()

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

function stopEasing(element) {
  const state = easing.get(element)
  if (state) cancelAnimationFrame(state.frame)
  easing.delete(element)
}

function easeTowardTarget(element, now) {
  const state = easing.get(element)
  if (!state) return
  // 元素已卸载，或布局变窄导致目标够不着时，停下而不是一直排帧
  const target = Math.min(state.target, element.scrollWidth - element.clientWidth)
  const before = element.scrollLeft
  if (!element.isConnected || Math.abs(target - before) < 1) {
    if (element.isConnected) element.scrollLeft = target
    easing.delete(element)
    return
  }
  const elapsed = now - state.last
  state.last = now
  element.scrollLeft = before + (target - before) * (1 - Math.exp(-elapsed / EASE_MS))
  if (elapsed > 0 && element.scrollLeft === before) {
    element.scrollLeft = target
    easing.delete(element)
    return
  }
  state.frame = requestAnimationFrame((t) => easeTowardTarget(element, t))
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
  if ((Math.abs(delta) < MOUSE_STEP && !state) || reducedMotion()) {
    stopEasing(element)
    element.scrollLeft = next
    return
  }
  if (state) state.target = next
  else easing.set(element, { target: next, last: performance.now(), frame: requestAnimationFrame((t) => easeTowardTarget(element, t)) })
}

// 卡片式横向列表：鼠标滚轮一格翻一页。触控板一次上下滑动（连同惯性）每 8 到 16ms 来一个事件，
// 快速甩动时单个事件也可能超过 50px，所以光看步长分不出鼠标。一次滑动里翻过一页之后，
// 只有和上一个事件隔开至少 50ms 的大步长才算新的一格；事件停下 250ms 才算下一次滑动。
const GESTURE_GAP_MS = 250
const NOTCH_GAP_MS = 50
const SWIPE_DISTANCE = 120

/** Returns a wheel handler that calls onPage(direction) once per mouse notch or per touchpad swipe. */
export function pageOnWheel(onPage) {
  let lastAt = -Infinity, sum = 0, pagedThisGesture = false
  return (event) => {
    if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
    event.preventDefault()
    const now = performance.now()
    const gap = now - lastAt
    if (gap > GESTURE_GAP_MS) { sum = 0; pagedThisGesture = false }
    lastAt = now
    const mouseNotch = event.deltaMode !== 0 || Math.abs(event.deltaY) >= MOUSE_STEP
    if (mouseNotch && (!pagedThisGesture || gap >= NOTCH_GAP_MS)) {
      pagedThisGesture = true
      onPage(Math.sign(event.deltaY))
      return
    }
    if (pagedThisGesture) return
    sum += event.deltaY
    if (Math.abs(sum) < SWIPE_DISTANCE) return
    pagedThisGesture = true
    onPage(Math.sign(sum))
  }
}
