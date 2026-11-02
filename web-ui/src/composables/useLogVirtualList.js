import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { buildLogOffsets, findLogWindow } from '../utils/logVirtualWindow.js'

export function useLogVirtualList(entries, listRef) {
  const heights = new Map()
  const elements = new Map()
  const keys = new WeakMap()
  const revision = ref(0)
  const scrollTop = ref(0)
  const viewportHeight = ref(800)
  let observer
  let frame = 0
  let width = 0

  const offsets = computed(() => {
    void revision.value
    return buildLogOffsets(entries.value, heights)
  })
  const windowRange = computed(() => findLogWindow(offsets.value, scrollTop.value, viewportHeight.value))

  function setScroll(top) {
    scrollTop.value = Math.max(0, top)
    if (listRef.value) listRef.value.scrollTop = scrollTop.value
  }

  function onScroll() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (listRef.value) scrollTop.value = listRef.value.scrollTop
    })
  }

  function measureEntry(seq, el) {
    const previous = elements.get(seq)
    if (previous === el) return
    if (previous) observer?.unobserve(previous)
    if (el) {
      elements.set(seq, el)
      keys.set(el, seq)
      observer?.observe(el)
    } else elements.delete(seq)
  }

  watch(listRef, (el) => {
    observer?.disconnect()
    cancelAnimationFrame(frame)
    frame = 0
    if (!el) return
    setScroll(el.scrollTop)
    viewportHeight.value = el.clientHeight
    observer = new ResizeObserver((records) => {
      const anchor = findLogWindow(offsets.value, scrollTop.value, 0, 0).start
      const anchorSeq = entries.value[anchor]?.seq
      const within = scrollTop.value - offsets.value[anchor]
      let changed = false
      for (const record of records) {
        if (record.target === el) {
          viewportHeight.value = el.clientHeight
          if (width && width !== el.clientWidth) {
            heights.clear()
            changed = true
          }
          width = el.clientWidth
          continue
        }
        const seq = keys.get(record.target)
        if (elements.get(seq) !== record.target) continue
        const height = record.borderBoxSize?.[0]?.blockSize ?? record.contentRect.height
        if (heights.get(seq) !== height) {
          heights.set(seq, height)
          changed = true
        }
      }
      if (changed) {
        revision.value++
        const index = entries.value.findIndex(entry => entry.seq === anchorSeq)
        if (index >= 0) setScroll(offsets.value[index] + within)
      }
    })
    observer.observe(el)
    for (const node of elements.values()) observer.observe(node)
  }, { flush: 'post' })

  // 新日志前插时保持正在阅读的条目；在顶部时继续显示最新日志。
  watch(entries, (next, previous) => {
    if (scrollTop.value > 0 && previous.length) {
      const oldOffsets = buildLogOffsets(previous, heights)
      const anchor = findLogWindow(oldOffsets, scrollTop.value, 0, 0).start
      const index = next.findIndex(entry => entry.seq === previous[anchor]?.seq)
      setScroll(index < 0 ? 0 : offsets.value[index] + scrollTop.value - oldOffsets[anchor])
    }
    const retained = new Set(next.map(entry => entry.seq))
    for (const key of heights.keys()) if (!retained.has(key)) heights.delete(key)
  }, { flush: 'sync' })

  onBeforeUnmount(() => {
    observer?.disconnect()
    cancelAnimationFrame(frame)
  })
  return { windowRange, onScroll, measureEntry }
}
