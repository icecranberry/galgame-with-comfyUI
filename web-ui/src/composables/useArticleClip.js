// 版面正文压裁（《邻舍日报》头版用）。
//
// 配图优先口径由 CSS 兜底（图块浮动环绕 + 图框 height/contain 等比收缩，正文 min-height 保底一行），
// 这里只负责正文：排版完成后量一遍真实行盒，把「装不下的那半行」截断并补上省略号
// （全文照旧进详情页）。
import { getCurrentInstance, nextTick, onBeforeUnmount, onUpdated, watch } from 'vue'

const ELLIPSIS = '…'

let measureProbe = null

function ensureProbe() {
  if (measureProbe || typeof document === 'undefined') return measureProbe
  measureProbe = document.createElement('span')
  measureProbe.setAttribute('aria-hidden', 'true')
  const style = measureProbe.style
  style.display = 'inline-block'
  style.whiteSpace = 'pre'
  style.visibility = 'hidden'
  style.pointerEvents = 'none'
  return measureProbe
}

// 剪裁边界：向上找第一个 overflow:hidden/clip 的祖先（通常是 .np-article / .np-world）
function findClipBoundary(startEl) {
  for (let node = startEl; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'hidden' || overflowY === 'clip') return node
  }
  return null
}

/**
 * 只保留正文在 el 里排得下的部分，并在截断处补省略号。
 * 「装得下」看的是文字的自然排版高度（Range 量 bottom）：正文自身 overflow:hidden，
 * height 被锁在边界内，光看 height 会永远判定为装得下。
 * float 环绕下换行位置随截断长度变化，所以先用行宽估一个起点，再按实际高度二分收敛。
 * @returns {boolean} 是否发生了截断（el.textContent 已被就地改写）
 */
export function trimArticleText(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return false
  const probe = ensureProbe()
  if (!probe) return false
  const host = el.parentElement
  if (!host) return false

  const elRect = el.getBoundingClientRect()
  if (!elRect.height || !host.getBoundingClientRect().height) return false

  // 剪裁边界：通常是 overflow:hidden 的 .np-article，正文最多排到它（减掉内边距）的底边
  const boundary = findClipBoundary(host)
  const boundaryEl = boundary || host
  const boundaryLimit = () => boundaryEl.getBoundingClientRect().bottom
    - (parseFloat(getComputedStyle(boundaryEl).paddingBottom) || 0)
  const textBottom = () => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const rect = range.getBoundingClientRect()
    range.detach()
    return rect.bottom
  }
  const fits = () => textBottom() <= boundaryLimit() + 0.5

  const fullText = el.textContent || ''
  if (!fullText.trim()) return false
  if (fits()) return false // 整段本来就排得下（含末行没排满的情况）

  // 可见行盒：整行都在边界内的才算数（末行往往已被剪掉一半）
  const range = document.createRange()
  range.selectNodeContents(el)
  const lineBoxes = Array.from(range.getClientRects()).filter(rect => rect.width > 1 && rect.height > 1)
  range.detach()
  if (!lineBoxes.length) return false

  const limit = boundaryLimit()
  const visibleLines = lineBoxes.filter(rect => rect.bottom <= limit + 0.5)
  const lastVisible = visibleLines[visibleLines.length - 1] || lineBoxes[0]
  // 末行可用宽度：末行贴着 float 时比整行窄，用它估一个「装得下」的起点
  const lineWidth = Math.max(lastVisible.width, 1)

  // 量尺：与被裁正文同款字体，插进正文里量，收尾统一摘掉
  probe.textContent = ''
  el.insertBefore(probe, el.firstChild)

  const measure = (text) => {
    probe.textContent = text
    return probe.getBoundingClientRect().width
  }
  const setText = (text) => { el.textContent = text }

  try {
    // 起点：按整行宽度估「最多能摆下多少字」，再转成实际高度判定
    const widthOfEllipsis = measure(ELLIPSIS)
    let seed = 0
    let upper = fullText.length
    while (seed < upper) {
      const mid = Math.ceil((seed + upper) / 2)
      if (measure(fullText.slice(0, mid)) + widthOfEllipsis <= lineWidth) seed = mid
      else upper = mid - 1
    }

    const render = (n) => setText(`${fullText.slice(0, n)}${ELLIPSIS}`)
    const fitsCut = (n) => {
      render(n)
      return fits()
    }
    const largestFitting = (floor) => {
      if (fitsCut(floor)) return floor
      let lo = 0
      let hi = floor
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (fitsCut(mid)) lo = mid
        else hi = mid - 1
      }
      return lo
    }

    // 起点按行宽估算，截断后正文会重排（float 让出的整行宽度也用得上），
    // 所以先找一个确实装得下的长度兜底，再二分收敛到「再想多留一个字就出界」的前缀
    const floor = largestFitting(seed)
    const cut = floor < fullText.length ? largestFitting(fullText.length) : floor
    render(cut)
    return true
  } finally {
    probe.remove()
  }
}

/**
 * 扫描容器内所有 [data-np-clip] 正文，把溢出剪裁边界的部分收成省略号。
 * 窗口显隐、换期、补图（图片 load）、字体就位、改窗口尺寸后都会重跑；
 * 每次重跑都从 Vue 渲染出的全文重新量，所以是幂等的，不会越截越短。
 */
export function useArticleClip({ root, active, sources = [] } = {}) {
  let frame = 0
  let observer = null
  const watchedImages = new WeakSet()

  function clip() {
    const host = root?.value
    if (!host || typeof host.querySelectorAll !== 'function') return
    if (active && !active.value) return
    if (!host.getBoundingClientRect().height) return
    // 版面确认就绪后把 ResizeObserver 补挂到位：watch 里的 observe() 赶在模板 ref
    // 赋值之前跑，读到的 root 还是 null，窗口缩放就永远量不到
    observe()
    host.querySelectorAll('[data-np-clip]').forEach(el => { trimArticleText(el) })
    watchImages(host)
  }

  // 配图落位会改变版面可排的行数，图一加载完就重量一遍
  function watchImages(host) {
    host.querySelectorAll('img').forEach(img => {
      if (img.complete || watchedImages.has(img)) return
      watchedImages.add(img)
      img.addEventListener('load', schedule, { once: true })
      img.addEventListener('error', schedule, { once: true })
    })
  }

  function schedule() {
    if (typeof requestAnimationFrame !== 'function') return
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      clip()
    })
  }

  // 观察版面根节点的尺寸变化（窗口缩放）。root 晚就绪（loading 骨架 / 关窗期间为 null）
  // 时不能把 observer 锁死在空观察上，就绪后要补挂——所以每次 clip（版面确认就绪后）都补挂一次
  let observedEl = null
  function observe() {
    if (typeof ResizeObserver !== 'function') return
    const el = root?.value
    if (!el) return
    if (observer && observedEl === el) return
    if (!observer) observer = new ResizeObserver(schedule)
    observer.observe(el)
    observedEl = el
  }

  function teardown() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    if (observer) observer.disconnect()
    observer = null
    observedEl = null
  }

  // 组件外调用（单测等）没有实例可挂生命周期钩子，跳过即可
  if (getCurrentInstance()) {
    onUpdated(() => { observe(); schedule() })
    watch([() => active?.value, ...sources.map(source => () => source?.value)], async () => {
      await nextTick()
      observe()
      schedule()
    }, { immediate: true })
    // 换字体（HarmonyOS Sans / 楷体就位）会改变每行的排布，落地后再量一次
    try { document.fonts?.ready?.then(schedule) } catch { /* 没有 Font Loading API 就算了 */ }
    onBeforeUnmount(teardown)
  }

  return { clip, schedule, teardown, observe }
}
