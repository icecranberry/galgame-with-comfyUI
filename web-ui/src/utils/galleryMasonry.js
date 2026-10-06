/**
 * 规则34 图库的「按原比例铺排」计算（纯函数，可单测）
 *
 * ── 要解决的问题 ────────────────────────────────────────────────
 * 图库条目的画幅比例是**服务端随机分配**的（`GALLERY_ASPECTS` 7 种，见
 * `agent-core/src/services/mediaService.js`），比例随机正是本形态的核心特征。
 * 但缩略图原先被钉成统一的 `aspect-ratio: 3/4` + `object-fit: cover` →
 * 9:16 / 16:9 这类比例会被**裁掉一截**，「随机比例」在界面上完全看不出来。
 *
 * 改成按原比例展示后，格子高度变得参差；若还用普通 grid，每一行都要按该行最高的
 * 格子对齐，矮的格子下方会留下大片空白。所以主区改为**瀑布流**（等宽多列 + 塞最短列）。
 *
 * ── 为什么比例取 `payload.gallery.width/height` ─────────────────
 * 这两个数是**服务端下发给生图器的真实像素**，因此它就是成图的真实宽高比 ——
 * 比 `aspect` 字符串更权威（字符串只是这两个数的人读标签）。
 * `aspect` 仅作次选，最后才回落到 3:4（占位卡 / 历史数据缺 payload 时）。
 */

/** 缺省比例（竖幅 3:4）：用于「排队生图中」占位卡与缺 payload 的旧数据 */
export const DEFAULT_RATIO = 3 / 4

/** 比例合法区间 —— 防止坏 payload（0 / 负数 / NaN）把某格撑成天文高度或压成一条线 */
const MIN_RATIO = 0.25
const MAX_RATIO = 4

const clamp = r => Math.min(MAX_RATIO, Math.max(MIN_RATIO, r))

/**
 * `'9:16'` → `0.5625`。解析不出来返回 `null`。
 * @param {string} s
 * @returns {number|null}
 */
export function ratioFromAspect(s) {
  // 分隔符收全几种写法：半角冒号/全角冒号/`x`/`×`/`/`/全角斜杠
  // （全角是中文输入法下的默认产物，`GALLERY_ASPECTS` 目前是半角，但别指望它永远不变）
  const m = String(s || '').match(/^\s*(\d+(?:\.\d+)?)\s*[:：xX×✕/／]\s*(\d+(?:\.\d+)?)\s*$/)
  if (!m) return null
  const w = Number(m[1]); const h = Number(m[2])
  if (!(w > 0) || !(h > 0)) return null
  return clamp(w / h)
}

/**
 * 该条目的图片宽高比（宽 / 高）。
 * 优先「真实像素」→ 次「aspect 字符串」→ 最后缺省 3:4。
 * @param {object} post - media_posts 行（前端 mapPostRow 后的对象）
 * @returns {number}
 */
export function imageRatioOf(post) {
  const g = post?.payload?.gallery
  const w = Number(g?.width)
  const h = Number(g?.height)
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return clamp(w / h)
  return ratioFromAspect(g?.aspect) ?? DEFAULT_RATIO
}

/**
 * 视口宽度 → 列数。
 *
 * ★ 这是**唯一**的列数定义处：CSS 里**不再写** media query 定列数
 *   （两处各写一份的话，改一处必漏另一处 —— 项目红线「同一口径只留一份定义」）。
 *   窄屏降到 3 / 2 列，否则缩略图小到看不清。
 * @param {number} width - 视口宽度 px
 * @returns {number} 2 | 3 | 4
 */
export function colsForWidth(width) {
  const w = Number(width)
  if (!Number.isFinite(w)) return 4
  if (w <= 1000) return 2
  if (w <= 1400) return 3
  return 4
}

/**
 * 卡片文字区的估算高度，单位 = **一个列宽**。
 *
 * 只用于瀑布流的配平（把新格子塞进当前最矮的列），不追求像素精确 ——
 * 列宽约 200~360px 时，标题 2 行 + 标签 1 行的实测高度大致落在 0.28 个列宽附近。
 */
const TEXT_H = 0.3

/**
 * 单个格子的估算高度，单位 = 列宽（图片高 = 列宽 / 比例）。
 * @param {object} post
 * @returns {number}
 */
export function cellHeightUnits(post) {
  return 1 / imageRatioOf(post) + TEXT_H
}

/**
 * 瀑布流分列：等宽多列，逐个把格子塞进**当前最矮**的列。
 *
 * 为什么不用 CSS 的 `columns: 4`：多列布局是在**渲染后**按高度切分的，
 * 切点由浏览器定，我们无法保证「最新的一条在最上面」；这里自己分列，顺序可控、可测。
 *
 * @param {Array<object>} items
 * @param {number} colCount
 * @returns {Array<Array<object>>} 长度恒为 colCount 的二维数组（可能有空列）
 */
export function distributeColumns(items, colCount) {
  const n = Math.max(1, Math.floor(Number(colCount) || 1))
  const cols = Array.from({ length: n }, () => [])
  const heights = new Array(n).fill(0)

  for (const it of (items || [])) {
    // 找最矮的列；并列时取下标最小的（保证同样的输入得到同样的输出，便于测试与稳定渲染）
    let k = 0
    for (let i = 1; i < n; i++) if (heights[i] < heights[k]) k = i
    cols[k].push(it)
    heights[k] += cellHeightUnits(it)
  }
  return cols
}
