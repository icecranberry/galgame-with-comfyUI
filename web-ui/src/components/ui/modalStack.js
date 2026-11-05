// 每个文档一个键盘入口，避免同一次 Esc 依次关闭多层弹窗。
const documents = new WeakMap()
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

function visible(element) {
  return element?.isConnected && element.getClientRects().length && !element.closest('[inert]')
}

export function nextModalLayer(doc, preferred) {
  const entries = documents.get(doc)?.entries || []
  return Math.max(preferred, ...entries.filter(item => visible(item.panel)).map(item => item.layer() + 10))
}

export function registerModal(entry) {
  const doc = entry.panel.ownerDocument
  let state = documents.get(doc)
  if (!state) {
    state = { entries: [] }
    state.onKeydown = event => {
      if (event.defaultPrevented || event.isComposing) return
      const top = [...state.entries].filter(item => visible(item.panel))
        .sort((a, b) => a.layer() - b.layer()).at(-1)
      if (!top || top.suspended()) return
      // 尊重灯箱、旧式浮层和 Teleport 下拉框的键盘处理。
      const target = event.target
      if (target !== doc.body && !top.panel.contains(target)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        top.escape()
      } else if (event.key === 'Tab' && !top.floating) {
        const items = [...top.panel.querySelectorAll(focusableSelector)].filter(visible)
        const first = items[0], last = items.at(-1)
        if (!first) { event.preventDefault(); top.panel.focus() }
        else if (event.shiftKey && (doc.activeElement === first || doc.activeElement === top.panel)) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && (doc.activeElement === last || doc.activeElement === top.panel)) {
          event.preventDefault(); first.focus()
        }
      }
    }
    doc.addEventListener('keydown', state.onKeydown)
    documents.set(doc, state)
  }
  state.entries.push(entry)
  return () => {
    const index = state.entries.indexOf(entry)
    if (index !== -1) state.entries.splice(index, 1)
    if (!state.entries.length) {
      doc.removeEventListener('keydown', state.onKeydown)
      documents.delete(doc)
    }
  }
}
