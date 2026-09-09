// 消息渲染窗口（chat / groups 共用）
//
// 消息已全量加载进内存时，用 renderStart 控制从哪条开始渲染，
// 避免长会话一次性渲染上千个气泡。初次显示末尾 initialCount 条，
// 上滑每次向前展开 expandCount 条。
import { ref, computed } from 'vue'

export const MESSAGE_WINDOW_INITIAL = 50
export const MESSAGE_WINDOW_EXPAND = 30

export function useMessageWindow(messages, {
  initialCount = MESSAGE_WINDOW_INITIAL,
  expandCount = MESSAGE_WINDOW_EXPAND,
} = {}) {
  const renderStart = ref(0)
  const visibleMessages = computed(() => messages.value.slice(renderStart.value))
  const hasMoreOlder = computed(() => renderStart.value > 0)

  /** 上滑展开更早的消息；没有更早的可展开时返回 false */
  function expandOlder() {
    if (!hasMoreOlder.value) return false
    renderStart.value = Math.max(0, renderStart.value - expandCount)
    return true
  }

  /** 窗口贴到最新（切换会话/发送后） */
  function resetToLatest() {
    renderStart.value = 0
  }

  /** 加载完成后初始定位到末尾 initialCount 条 */
  function anchorToLatest() {
    renderStart.value = Math.max(0, messages.value.length - initialCount)
  }

  /** 新消息到达时：若窗口原本贴着末尾，则继续贴住末尾（避免新消息被窗口截掉） */
  function keepTailPinned() {
    if (renderStart.value > messages.value.length - initialCount) {
      renderStart.value = Math.max(0, messages.value.length - initialCount)
    }
  }

  return { renderStart, visibleMessages, hasMoreOlder, expandOlder, resetToLatest, anchorToLatest, keepTailPinned }
}
