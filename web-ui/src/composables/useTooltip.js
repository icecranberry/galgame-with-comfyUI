import { ref, computed } from 'vue'

/**
 * 轻量悬浮 tooltip：跟随鼠标，显示 description
 * 靠近屏幕右边缘时自动翻转到光标左侧（自然宽度，不缩放）
 */
export function useTooltip() {
  const tooltip = ref({ show: false, text: '', x: 0, y: 0, flip: false })

  /** 由 composable 计算 style，避免 template 直接访问 window */
  const tipStyle = computed(() => {
    const t = tooltip.value
    if (!t.show) return { display: 'none' }
    const base = { top: t.y + 'px' }
    if (t.flip) {
      return { ...base, left: 'auto', right: (window.innerWidth - t.x) + 'px' }
    }
    return { ...base, left: t.x + 'px', right: 'auto' }
  })

  function computeX(clientX) {
    const edge = window.innerWidth - 20
    // 以 260px 为阈值判断是否需要翻转（仅用于判定方向，不影响实际宽度）
    if (clientX + 14 + 260 > edge) {
      return { pos: clientX - 14, flip: true }
    }
    return { pos: clientX + 14, flip: false }
  }

  function onEnter(e, text) {
    if (!text) return
    const { pos, flip } = computeX(e.clientX)
    tooltip.value = { show: true, text, x: pos, y: e.clientY - 8, flip }
  }

  function onMove(e) {
    if (!tooltip.value.show) return
    const { pos, flip } = computeX(e.clientX)
    tooltip.value.x = pos
    tooltip.value.y = e.clientY - 8
    tooltip.value.flip = flip
  }

  function onLeave() {
    tooltip.value.show = false
  }

  return { tooltip, tipStyle, onEnter, onMove, onLeave }
}
