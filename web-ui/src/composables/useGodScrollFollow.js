import { ref, watch, onScopeDispose } from 'vue'

// 跟随的是持续变化的内容底部；不会为每个流式片段重启一次原生 smooth scroll。
export function useGodScrollFollow(scrollArea, readingArea) {
  const atBottom = ref(true)
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let frame = 0
  let previousTime = 0
  let writtenTop = null
  let detach = () => {}

  function stop() {
    cancelAnimationFrame(frame)
    frame = 0
    previousTime = 0
  }
  function write(el, top) {
    el.scrollTop = top
    writtenTop = el.scrollTop
  }
  function tick(time) {
    frame = 0
    const el = scrollArea.value
    if (!el || !atBottom.value) return
    const target = Math.max(0, el.scrollHeight - el.clientHeight)
    const distance = target - el.scrollTop
    const elapsed = previousTime ? Math.min(time - previousTime, 64) : 16
    previousTime = time
    if (motion.matches || Math.abs(distance) < 1) {
      write(el, target)
      previousTime = 0
      return
    }
    // 约 0.3 秒收敛，按帧间隔计算，兼容 60/120Hz 屏幕。
    const step = Math.sign(distance) * Math.max(1, Math.abs(distance) * (1 - Math.exp(-elapsed / 75)))
    write(el, el.scrollTop + step)
    frame = requestAnimationFrame(tick)
  }
  function follow() {
    if (atBottom.value && !frame) frame = requestAnimationFrame(tick)
  }
  function goBottom({ immediate = false } = {}) {
    atBottom.value = true
    if (immediate && scrollArea.value) {
      stop()
      write(scrollArea.value, Math.max(0, scrollArea.value.scrollHeight - scrollArea.value.clientHeight))
    } else follow()
  }
  function pause() {
    atBottom.value = false
    stop()
  }

  watch([scrollArea, readingArea], ([el, content]) => {
    detach()
    stop()
    writtenTop = null
    if (!el || !content) return
    let touchY = null
    const onScroll = () => {
      // 自动滚动引发的 scroll 事件不取消跟随，即使正在追赶较长的新段落。
      if (writtenTop !== null && Math.abs(el.scrollTop - writtenTop) < 1) return
      writtenTop = null
      atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 2
      if (atBottom.value) follow()
      else stop()
    }
    const onWheel = event => { if (event.deltaY < 0) pause() }
    const onTouchStart = event => { touchY = event.touches[0]?.clientY ?? null }
    const onTouchMove = event => {
      const nextY = event.touches[0]?.clientY ?? null
      if (touchY !== null && nextY !== null && nextY > touchY) pause()
      touchY = nextY
    }
    const onKeyDown = event => {
      if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) pause()
    }
    const onPointerDown = event => {
      // 拖动滚动条时先交还控制权，包括覆盖式滚动条。
      if (event.target === el && event.clientX >= el.getBoundingClientRect().right - 18) pause()
    }
    const events = { scroll: onScroll, wheel: onWheel, touchstart: onTouchStart, touchmove: onTouchMove, keydown: onKeyDown, pointerdown: onPointerDown }
    for (const [name, handler] of Object.entries(events)) el.addEventListener(name, handler, { passive: true })
    const observer = new ResizeObserver(follow)
    observer.observe(content)
    observer.observe(el)
    detach = () => {
      observer.disconnect()
      for (const [name, handler] of Object.entries(events)) el.removeEventListener(name, handler)
    }
    follow()
  }, { flush: 'post', immediate: true })

  motion.addEventListener('change', follow)
  onScopeDispose(() => { stop(); detach(); motion.removeEventListener('change', follow) })
  return { atBottom, goBottom }
}
