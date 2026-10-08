/**
 * 多选检索框的匹配逻辑（纯函数，可单测）。
 *
 * ── 为什么要单独抽出来 ──────────────────────────────────────
 * 本项目的组件测试只跑纯函数、不挂载 SFC（见 test/ 下的既有范式），
 * 而"候选怎么筛、怎么排"恰恰是**用户最容易感觉到不对**的地方
 * （选不中想要的项 = 直接没法用）。抽成纯函数才能把它钉住。
 *
 * ★ 检索口径与 `components/ui/LinsheSelect.vue` 内的 `fuzzyScore` **保持一致** ——
 *   两者是同一交互的"单选/多选"两面，手感必须一样。改这里请一并看那边。
 */

/** 归一化：去空白 + 转小写（中文不受影响，英文/拼音检索更宽松） */
export function normalizeQuery(v) {
  return String(v || '').toLocaleLowerCase().replace(/\s+/g, '')
}

/**
 * 模糊匹配打分。**返回 null 表示不匹配**（排序时会被丢掉）。
 * 分值含义（越小越靠前）：0 完全相同 / 1 前缀 / 2+ 包含（越靠前分越低）/
 * 10+ 字符子序列（越紧凑分越低）。
 */
export function fuzzyScore(label, normalizedQuery) {
  const text = normalizeQuery(label)
  if (!normalizedQuery) return 0
  if (text === normalizedQuery) return 0
  if (text.startsWith(normalizedQuery)) return 1
  const containedAt = text.indexOf(normalizedQuery)
  if (containedAt >= 0) return 2 + containedAt / 100
  let qi = 0
  let first = -1
  let last = -1
  for (let i = 0; i < text.length && qi < normalizedQuery.length; i++) {
    if (text[i] === normalizedQuery[qi]) {
      if (first < 0) first = i
      last = i
      qi++
    }
  }
  return qi === normalizedQuery.length ? 10 + (last - first) / 100 : null
}

/**
 * 过滤 + 排序候选。
 *
 * ⚠ **已选项必须从候选里去掉**：否则用户会重复选中同一个人/地点，
 *   而那是"点了没反应"式的坏体验（列表里明明有，点了却不变多）。
 *
 * @param {Array} candidates 候选 [{value,label,hint?}]
 * @param {string} query 用户输入
 * @param {Set<string>|Array<string>} selected 已选值
 * @param {number} limit 返回上限
 */
export function rankCandidates(candidates, query, selected, limit = 50) {
  const sel = selected instanceof Set ? selected : new Set((selected || []).map(String))
  const pool = (Array.isArray(candidates) ? candidates : [])
    .filter(o => o && o.value != null && !sel.has(String(o.value)))
  const q = normalizeQuery(query)
  if (!q) return pool.slice(0, limit)
  return pool
    .map((o, index) => ({ o, index, score: fuzzyScore(o.label, q) }))
    .filter(it => it.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map(it => it.o)
}

/**
 * 是否应该显示"就用当前输入"的自由项。
 *
 * ★ 为什么必须支持自由输入：地点可能还没被录进地图，
 *   若强制只能选候选 → 用户"选不了想要的地点"（红线 0：不能静默丢输入）。
 * ⚠ 但只在**确实没匹配上**时才出现，避免和现有候选项抢位置。
 */
export function shouldOfferFreeValue(query, visible, selected, allowFreeInput = true) {
  if (!allowFreeInput) return false
  const q = String(query || '').trim()
  if (!q) return false
  const sel = selected instanceof Set ? selected : new Set((selected || []).map(String))
  if (sel.has(q)) return false
  return !(visible || []).some(o => String(o.value) === q)
}

/** 是否还能继续添加（上限保护；max<=0 表示不限） */
export function canAddMore(selected, max = 0) {
  if (!max || max <= 0) return true
  return (selected?.length || 0) < max
}

/**
 * 已选项的**显示名**。
 *
 * ★★ 为什么必须有：`value` 与 `label` 未必相同 —— 角色多选的值是 **id**（落库要 id），
 *   但把 id 直接显示出来用户完全没法用（**实测踩过**：chip 上显示了 `100394`）。
 *   有匹配候选 → 用它的 label；找不到（自由输入 / 角色已被删或归档）→ 原样显示值。
 */
export function labelOfValue(candidates, value) {
  const v = String(value ?? '')
  const hit = (Array.isArray(candidates) ? candidates : [])
    .find(o => o && String(o.value) === v)
  return hit?.label || v
}