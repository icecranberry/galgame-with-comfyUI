<template>
  <div
    ref="rootEl"
    class="ba-slider"
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
    <img class="ba-img ba-before" :src="before" alt="细化前" draggable="false" @load="fit" />
    <img ref="afterEl" class="ba-img ba-after" :src="after" alt="细化后" draggable="false" :style="{ clipPath: `inset(0 0 0 ${pos}%)` }" @load="fit" />
    <div class="ba-divider" :style="{ left: `${pos}%` }">
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
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

defineProps({
  before: { type: String, required: true },
  after: { type: String, required: true },
})

const rootEl = ref(null)
const afterEl = ref(null)
const pos = ref(50)
let dragging = false

// 展示高度上限（视口高度的占比）：宽度随图片比例自适应，高度受限，尽量大但不出弹窗/卡片
const MAX_H_RATIO = 0.66
let _ro = null

function updateFromEvent(e) {
  const el = rootEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const pct = ((e.clientX - rect.left) / rect.width) * 100
  pos.value = Math.min(100, Math.max(0, pct))
}

function onPointerDown(e) {
  dragging = true
  rootEl.value?.setPointerCapture?.(e.pointerId)
  updateFromEvent(e)
}

function onPointerMove(e) {
  if (!dragging) return
  updateFromEvent(e)
}

function onPointerUp(e) {
  dragging = false
  rootEl.value?.releasePointerCapture?.(e.pointerId)
}

/** 按图片真实比例撑满可用空间：宽度 = min(原始宽, 容器宽)，高度上限 = 视口高度 * MAX_H_RATIO */
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
  const capW = Math.min(img.naturalWidth, parent && parent.clientWidth > 0 ? parent.clientWidth : window.innerWidth)
  const capH = window.innerHeight * MAX_H_RATIO
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
}

onMounted(() => {
  window.addEventListener('resize', fit)
  if (afterEl.value?.complete && afterEl.value.naturalWidth > 0) fit()
  else requestAnimationFrame(fit)
  // 容器宽度变化（弹窗切换、卡片重排）后重新适配
  _ro = rootEl.value?.parentElement ? new ResizeObserver(fit) : null
  _ro?.observe(rootEl.value.parentElement)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', fit)
  _ro?.disconnect()
  _ro = null
})
</script>

<style scoped>
.ba-slider {
  position: relative;
  /* 图片加载完成前兜底占位；加载后由 fit() 按图片真实比例内联覆盖宽高 */
  width: 100%;
  max-width: 760px;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  cursor: col-resize;
}
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
</style>
