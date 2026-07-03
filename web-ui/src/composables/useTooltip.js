import { ref } from 'vue'

/**
 * 轻量悬浮 tooltip：跟随鼠标，显示 description
 */
export function useTooltip() {
  const tooltip = ref({ show: false, text: '', x: 0, y: 0 })

  function onEnter(e, text) {
    if (!text) return
    tooltip.value = { show: true, text, x: e.clientX + 14, y: e.clientY - 8 }
  }

  function onMove(e) {
    if (!tooltip.value.show) return
    tooltip.value.x = e.clientX + 14
    tooltip.value.y = e.clientY - 8
  }

  function onLeave() {
    tooltip.value.show = false
  }

  return { tooltip, onEnter, onMove, onLeave }
}
