import { computed, ref } from 'vue'

/**
 * 群聊「@ 点名」面板的状态机：输入框末尾出现「@ + 过滤词」时展开候选列表，
 * ↑↓ 挪选择、回车确认（面板打开时回车只确认选择，不发送文本）、Esc 关闭。
 *
 * 候选首项固定是 @全体成员——它对应后端「本轮群里所有人都必须发言」的规则，
 * 与单人 @点名（只强制被点名者先答）区分开。
 *
 * 用法：
 *   const mention = useMentionPicker(() => store.activeGroup?.members || [])
 *   watch(draft, text => mention.sync(text))
 *   mention.move(1) / mention.current.value / mention.close()
 */

export const MENTION_ALL_LABEL = '全体成员'
// 手打「@所有人 / @全员」也应当落在全体成员这一项上
export const MENTION_ALL_LABELS = ['全体成员', '所有人', '全员']
// 输入框末尾的 @ 及其后的过滤词（过滤词不含空格）
export const MENTION_QUERY_RE = /@([^\s@]*)$/

const MENTION_ALL_OPTION = { key: 'all', display_name: MENTION_ALL_LABEL, isAll: true }

/** 把末尾的「@过滤词」换成选中的 @对象（没有 @ 时补在末尾） */
export function applyMention(text, label) {
  const base = String(text ?? '')
  return MENTION_QUERY_RE.test(base) ? base.replace(/@[^\s@]*$/, `@${label} `) : `${base}@${label} `
}

/** 候选列表：过滤词命中「全体成员」时首位永远是它，其余按角色名包含匹配 */
export function buildMentionOptions(members, query = '') {
  const list = (members || []).map(m => ({ ...m, key: `m${m.id}`, isAll: false }))
  const allMatched = !query || MENTION_ALL_LABELS.some(label => label.includes(query))
  const matched = query ? list.filter(m => (m.display_name || '').includes(query)) : list
  return allMatched ? [MENTION_ALL_OPTION, ...matched] : matched
}

export function useMentionPicker(getMembers) {
  const open = ref(false)
  const index = ref(0)
  const query = ref('')
  const options = computed(() => buildMentionOptions(getMembers(), query.value))
  const current = computed(() => (open.value ? options.value[index.value] : null))
  // 输入框 aria-activedescendant 指向当前高亮项
  const activeId = computed(() => (current.value ? `mention-opt-${current.value.key}` : undefined))

  function close() {
    open.value = false
    query.value = ''
    index.value = 0
  }

  /** 输入内容变化后重新对齐面板；返回面板是否打开 */
  function sync(text) {
    const match = MENTION_QUERY_RE.exec(String(text ?? ''))
    if (!match) { close(); return false }
    const next = match[1]
    const queryChanged = next !== query.value
    query.value = next
    const total = options.value.length
    if (total === 0) { close(); return false }
    if (queryChanged) index.value = 0
    index.value = Math.min(index.value, total - 1)
    open.value = true
    return true
  }

  /** ↑↓ 挪选择；面板没开时返回 false，把按键让给输入框默认行为 */
  function move(delta) {
    const total = options.value.length
    if (!open.value || total === 0) return false
    index.value = (index.value + delta + total) % total
    return true
  }

  return { open, index, query, options, current, activeId, sync, move, close }
}
