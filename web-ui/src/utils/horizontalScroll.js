/** Translate a mouse wheel into horizontal scrolling, preserving page scroll at either end. */
export function scrollHorizontalOnWheel(event) {
  if (event.ctrlKey || event.defaultPrevented) return
  const element = event.currentTarget
  const max = element.scrollWidth - element.clientWidth
  if (max <= 0) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  const unit = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? element.clientWidth : 1
  const next = Math.max(0, Math.min(max, element.scrollLeft + delta * unit))
  if (next === element.scrollLeft) return
  event.preventDefault()
  element.scrollLeft = next
}
