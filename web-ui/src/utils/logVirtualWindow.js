export const LOG_ITEM_GAP = 8
export const LOG_ESTIMATED_HEIGHT = 600

export function buildLogOffsets(entries, heights) {
  const offsets = [0]
  for (const entry of entries) {
    offsets.push(offsets.at(-1) + (heights.get(entry.seq) ?? LOG_ESTIMATED_HEIGHT) + LOG_ITEM_GAP)
  }
  return offsets
}

export function findLogWindow(offsets, scrollTop, viewportHeight, overscan = 700) {
  const count = offsets.length - 1
  const firstAt = (position) => {
    let low = 0
    let high = count
    while (low < high) {
      const mid = (low + high) >>> 1
      if (offsets[mid + 1] <= position) low = mid + 1
      else high = mid
    }
    return low
  }
  const start = Math.min(firstAt(Math.max(0, scrollTop - overscan)), Math.max(0, count - 1))
  const end = Math.min(count, firstAt(scrollTop + viewportHeight + overscan) + 1)
  return { start, end, before: offsets[start], after: offsets[count] - offsets[end] }
}

// 四行预览只提供有限前缀给浏览器排版，完整文本留在数据中，展开时再挂载。
// 4096 字符足以覆盖当前日志窗口宽度下的四个视觉行；显式换行也最多取四行。
export function logTextPreview(text) {
  const prefix = text.slice(0, 4096)
  let lines = 0
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] === '\n' && ++lines === 4) return prefix.slice(0, i)
  }
  return prefix
}
