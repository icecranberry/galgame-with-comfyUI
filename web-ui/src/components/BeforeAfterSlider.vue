<template>
  <div
    ref="rootEl"
    class="ba-slider"
    :class="{ 'is-zoomed': scale > 1 }"
    role="slider"
    aria-label="Before After 图片对比"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(pos)"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <!-- 缩放层：两张图 + 分割线跟随同一 transform，保证对比线与图像列严格对齐 -->
    <div class="ba-zoom" :class="{ 'is-smooth': smoothZoom }" :style="zoomStyle">
      <img class="ba-img ba-before" :src="before" alt="细化前" draggable="false" @load="fit" />
      <img ref="afterEl" class="ba-img ba-after" :src="after" alt="细化后" draggable="false" :style="{ clipPath: `inset(0 0 0 ${pos}%)` }" @load="fit" />
    </div>
    <!-- 分割线放在缩放层之外：线宽 / 手柄尺寸不随缩放变化 -->
    <div class="ba-divider" :style="dividerStyle">
      <span class="ba-handle">
        <svg class="ba-chevron ba-chevron-left" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M6.5 1.5 3 5l3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg class="ba-chevron ba-chevron-right" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M3.5 1.5 7 5l-3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </div>
    <span class="ba-label ba-label-before">Before</span>
    <span class="ba-label ba-label-after">After</span>
    <!-- 缩放指示 / 归位：仅在放大后出现，避免平时占画面 -->
    <div
      v-if="scale > 1"
      class="ba-zoom-badge"
      role="button"
      tabindex="0"
      :title="`当前缩放 ${Math.round(scale * 100)}%，点击恢复原始大小`"
      :aria-label="`当前缩放 ${Math.round(scale * 100)}%，点击恢复原始大小`"
      @pointerdown.stop
      @click.stop="resetZoom"
      @keydown.enter.prevent="resetZoom"
      @keydown.space.prevent="resetZoom"
    >
      <svg class="ba-zoom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/>
      </svg>
      {{ Math.round(scale * 100) }}%
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  before: { type: String, required: true },
  after: { type: String, required: true },
  /**
   * 高度上限口径：
   * - 'viewport'（默认）：按视口高度的固定比例留白，尺寸只随视口变化，适合普通页面里的大图预览；
   * - 'container'：额外按父容器**实际可用高度**收敛，用于窄屏整屏弹窗（卡片给定了确定高度），
   *   否则图片会把底部按钮顶出屏幕、逼出滚动条。
   */
  fitMode: { type: String, default: 'viewport' },
})

const rootEl = ref(null)
const afterEl = ref(null)
const pos = ref(50)

/* ── 缩放（滚轮 / 双指） ── */
const MIN_SCALE = 1
const MAX_SCALE = 6
const scale = ref(1)
const tx = ref(0)   // 缩放层位移（相对滑块左上角，px）
const ty = ref(0)
const boxW = ref(0) // 图像显示区尺寸（fit() 求出）
const boxH = ref(0)
const smoothZoom = ref(false)

/* ── 手势状态（非响应式，逐指跟踪） ── */
const pointers = new Map()  // pointerId -> { x, y }（client 坐标）
let mode = null             // 'split' | 'pan' | 'pinch'
let posBeforeGesture = 50   // 单指落下时会把分割线跳到落点，改成双指/拖动前可回滚
let panOrigin = null
let pinchOrigin = null
let smoothTimer = 0

// 展示高度上限（视口高度的占比）：宽度随图片比例自适应，高度受限，尽量大但不出弹窗/卡片
const MAX_H_RATIO = 0.66
// 窄屏断点：与样式表 @media (max-width: 767px) 保持一致
const NARROW_QUERY = '(max-width: 767px)'
let _ro = null
let _maxW = 760  // 由 CSS 的 max-width 读回，保持单一来源

function isNarrow() {
  return window.matchMedia?.(NARROW_QUERY).matches ?? window.innerWidth <= 767
}

const zoomStyle = computed(() => ({
  transform: `translate3d(${tx.value}px, ${ty.value}px, 0) scale(${scale.value})`,
}))

const dividerStyle = computed(() => {
  const w = boxW.value
  if (!w) return { left: `${pos.value}%` }
  // 图像坐标 -> 屏幕坐标，放大后分割线仍钉在同一图像列上
  return { left: `${tx.value + scale.value * (pos.value / 100) * w}px` }
})

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

/** 位移钳制：放大后不允许露出空白边（缩放层始终盖满取景框） */
function clampPan() {
  const s = scale.value
  if (s <= 1) {
    scale.value = 1
    tx.value = 0
    ty.value = 0
    return
  }
  tx.value = clamp(tx.value, boxW.value * (1 - s), 0)
  ty.value = clamp(ty.value, boxH.value * (1 - s), 0)
}

/** 以某个屏幕点为锚点缩放：该点下的图像内容保持不动 */
function zoomAt(factor, clientX, clientY) {
  const el = rootEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const px = clientX - rect.left
  const py = clientY - rect.top
  const s0 = scale.value
  const s1 = clamp(s0 * factor, MIN_SCALE, MAX_SCALE)
  if (Math.abs(s1 - s0) < 1e-4) return
  const lx = (px - tx.value) / s0
  const ly = (py - ty.value) / s0
  scale.value = s1
  tx.value = px - s1 * lx
  ty.value = py - s1 * ly
  clampPan()
}

function resetZoom() {
  scale.value = 1
  tx.value = 0
  ty.value = 0
}

function flashSmooth() {
  smoothZoom.value = false
  clearTimeout(smoothTimer)
  smoothZoom.value = true
  smoothTimer = setTimeout(() => { smoothZoom.value = false }, 160)
}

function onWheel(e) {
  e.preventDefault()
  if (pointers.size > 0) return  // 拖拽/触摸中忽略滚轮
  let d = e.deltaY
  if (e.deltaMode === 1) d *= 16
  else if (e.deltaMode === 2) d *= 100
  flashSmooth()
  zoomAt(Math.exp(-d * 0.0022), e.clientX, e.clientY)
}

/** 分割线当前所在的屏幕横坐标（client 坐标），用于命中判定 */
function dividerClientX() {
  const el = rootEl.value
  if (!el) return null
  if (scale.value === 1) return el.getBoundingClientRect().left + (pos.value / 100) * el.clientWidth
  return el.getBoundingClientRect().left + tx.value + scale.value * (pos.value / 100) * boxW.value
}

function isNearDivider(clientX) {
  const x = dividerClientX()
  if (x == null) return false
  return Math.abs(clientX - x) <= 22
}

/** 按指针位置移动分割线（放大后需换算回图像坐标） */
function updateFromEvent(e) {
  const el = rootEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const w = boxW.value || rect.width
  if (!(w > 0)) return
  const pct = (((e.clientX - rect.left) - tx.value) / scale.value) / w * 100
  pos.value = clamp(pct, 0, 100)
}

function startPinch() {
  const el = rootEl.value
  const pts = [...pointers.values()]
  if (!el || pts.length < 2) return
  // 撤销第一指落下时把分割线跳走的副作用
  pos.value = posBeforeGesture
  const rect = el.getBoundingClientRect()
  const p1 = { x: pts[0].x - rect.left, y: pts[0].y - rect.top }
  const p2 = { x: pts[1].x - rect.left, y: pts[1].y - rect.top }
  pinchOrigin = {
    rect,
    dist: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1,
    midX: (p1.x + p2.x) / 2,
    midY: (p1.y + p2.y) / 2,
    scale: scale.value,
    tx: tx.value,
    ty: ty.value,
  }
  mode = 'pinch'
}

function updatePinch() {
  if (!pinchOrigin) return
  const pts = [...pointers.values()]
  if (pts.length < 2) return
  const rect = pinchOrigin.rect
  const p1 = { x: pts[0].x - rect.left, y: pts[0].y - rect.top }
  const p2 = { x: pts[1].x - rect.left, y: pts[1].y - rect.top }
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
  const midX = (p1.x + p2.x) / 2
  const midY = (p1.y + p2.y) / 2
  const s1 = clamp(pinchOrigin.scale * (dist / pinchOrigin.dist), MIN_SCALE, MAX_SCALE)
  // 起始时双指中点下的图像坐标
  const lx = (pinchOrigin.midX - pinchOrigin.tx) / pinchOrigin.scale
  const ly = (pinchOrigin.midY - pinchOrigin.ty) / pinchOrigin.scale
  scale.value = s1
  tx.value = midX - s1 * lx
  ty.value = midY - s1 * ly
  clampPan()
}

function onPointerDown(e) {
  const el = rootEl.value
  if (!el) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (pointers.size === 0) posBeforeGesture = pos.value
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  // 指针已失效时 setPointerCapture 会抛错，捕获失败不影响手势本身
  try { el.setPointerCapture?.(e.pointerId) } catch { /* ignore */ }
  if (pointers.size >= 2) {
    startPinch()
    return
  }
  if (scale.value > 1) {
    // 放大后：贴近分割线才拖分割线，其余位置拖动画面
    if (isNearDivider(e.clientX)) {
      mode = 'split'
      updateFromEvent(e)
    } else {
      mode = 'pan'
      panOrigin = { x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value }
    }
    return
  }
  mode = 'split'
  updateFromEvent(e)
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (mode === 'pinch' && pointers.size >= 2) {
    updatePinch()
    return
  }
  if (mode === 'pan' && panOrigin) {
    tx.value = panOrigin.tx + (e.clientX - panOrigin.x)
    ty.value = panOrigin.ty + (e.clientY - panOrigin.y)
    clampPan()
    return
  }
  if (mode === 'split') updateFromEvent(e)
}

function onPointerUp(e) {
  pointers.delete(e.pointerId)
  try { rootEl.value?.releasePointerCapture?.(e.pointerId) } catch { /* ignore */ }
  if (pointers.size === 0) {
    mode = null
    panOrigin = null
    pinchOrigin = null
    return
  }
  if (pointers.size === 1) {
    // 双指 -> 单指：以剩下的手指重新定基准，避免手指抬起瞬间画面跳变
    const p = [...pointers.values()][0]
    pinchOrigin = null
    posBeforeGesture = pos.value
    if (scale.value > 1 && !isNearDivider(p.x)) {
      mode = 'pan'
      panOrigin = { x: p.x, y: p.y, tx: tx.value, ty: ty.value }
    } else {
      mode = 'split'
      panOrigin = null
    }
  }
}

/** 按图片真实比例撑满可用空间：宽度 = min(原图宽, 容器内容宽, CSS max-width)，高度受可用高度上限约束 */
function fit() {
  const el = rootEl.value
  const img = afterEl.value
  if (!el || !img) return
  if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) {
    // 图片未加载完：保持 CSS 兜底比例，等 @load 后再收敛
    el.style.width = ''
    el.style.height = ''
    return
  }
  const ar = img.naturalWidth / img.naturalHeight
  const parent = el.parentElement
  const cs = parent ? getComputedStyle(parent) : null
  const padX = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0
  const padY = cs ? (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) : 0
  // clientWidth 含内边距，直接拿来当可用宽会横向溢出（窄屏最明显）
  const parentW = parent && parent.clientWidth > 0 ? parent.clientWidth - padX : window.innerWidth
  const capW = Math.min(img.naturalWidth, parentW, _maxW)

  let capH = window.innerHeight * MAX_H_RATIO
  if (props.fitMode === 'container' && isNarrow() && parent) {
    // 窄屏弹窗给定了确定高度（卡片 100dvh + 预览区 flex:1），按真实剩余空间收敛
    const availH = parent.clientHeight - padY
    if (availH > 80) capH = Math.min(capH, availH)
  }

  let w = capW
  let h = w / ar
  if (h > capH) {
    h = capH
    w = h * ar
  }
  // 竖向图片宽可能 < 1px 的极端小图兜底
  w = Math.max(1, Math.round(w))
  h = Math.max(1, Math.round(h))
  if (el.style.width !== `${w}px` || el.style.height !== `${h}px`) {
    el.style.width = `${w}px`
    el.style.height = `${h}px`
  }
  if (boxW.value !== w || boxH.value !== h) {
    boxW.value = w
    boxH.value = h
    clampPan()
  }
}

onMounted(() => {
  const el = rootEl.value
  const mw = parseFloat(getComputedStyle(el).maxWidth)
  if (Number.isFinite(mw) && mw > 0) _maxW = mw
  window.addEventListener('resize', fit)
  el.addEventListener('wheel', onWheel, { passive: false })
  if (afterEl.value?.complete && afterEl.value.naturalWidth > 0) fit()
  else requestAnimationFrame(fit)
  // 容器尺寸变化（弹窗切换、卡片重排、屏幕旋转）后重新适配
  _ro = el.parentElement ? new ResizeObserver(fit) : null
  _ro?.observe(el.parentElement)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', fit)
  rootEl.value?.removeEventListener('wheel', onWheel)
  clearTimeout(smoothTimer)
  _ro?.disconnect()
  _ro = null
})
</script>

<style scoped>
.ba-slider {
  position: relative;
  /* 图片加载完成前兜底占位；加载后由 fit() 按图片真实比例内联覆盖宽高 */
  width: 100%;
  max-width: 760px; /* 与脚本里的 _maxW 同源，改这里即改两处口径 */
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  /* 手势全部自行接管（拖动分割线 / 单指平移 / 双指缩放） */
  touch-action: none;
  cursor: col-resize;
}
.ba-slider.is-zoomed { cursor: grab; }
.ba-slider.is-zoomed:active { cursor: grabbing; }
.ba-zoom {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.ba-zoom.is-smooth { transition: transform 0.15s ease-out; }
.ba-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  background: var(--glass-bg-strong);
}
.ba-after { will-change: clip-path; }
.ba-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.35);
  transform: translateX(-50%);
  pointer-events: none;
}
.ba-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 34px;
  height: 34px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: #fff;
  border: 2px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1px;
}
.ba-chevron {
  width: 9px;
  height: 9px;
  color: #333;
  flex-shrink: 0;
}
.ba-label {
  position: absolute;
  top: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
.ba-label-before { left: 12px; }
.ba-label-after { right: 12px; }
.ba-zoom-badge {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s ease;
}
.ba-zoom-badge:hover { background: rgba(0, 0, 0, 0.72); }
.ba-zoom-icon { width: 12px; height: 12px; }

/* 手机端：手柄稍微加大，便于双指之外的拇指拖动 */
@media (max-width: 767px) {
  .ba-handle { width: 38px; height: 38px; }
}
</style>
