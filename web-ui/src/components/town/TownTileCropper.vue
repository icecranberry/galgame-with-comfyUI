<template>
  <div class="ttc">
    <!-- 地皮专用：在「裁剪前原图」上拖菱形，而不是在已经裁好的 64×32 成品上做文章 -->
    <div
      ref="frameEl"
      class="ttc-frame"
      :class="{ 'is-panning': panning }"
      @pointerdown.prevent="onDown"
      @wheel.prevent="onWheel"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <div class="ttc-stage">
        <div class="ttc-checker"></div>
        <canvas ref="canvasEl" class="ttc-canvas" :style="canvasViewStyle"></canvas>
      </div>
      <div v-if="!loaded" class="ttc-loading">裁剪前原图加载中…</div>
      <Teleport to="body">
        <aside class="ttc-info" :style="infoStyle" aria-label="图片生成配置">
          <TownPromptPanel
            :model-value="generationParams"
            :step="generationStep"
            :hide-prefix="isPortrait"
            :show-portrait-lora="isPortrait"
            @update:model-value="value => emit('update:generationParams', value)"
          />
          <div v-if="configStatus" class="ttc-config-status">{{ configStatus }}</div>
        </aside>
      </Teleport>
    </div>

    <div class="ttc-hint">{{ hintText }}</div>

    <div class="ttc-previews">
      <div class="ttc-preview">
        <span class="ttc-preview-label">裁剪预览 · {{ TILE_PIXEL.w }}×{{ TILE_PIXEL.h }}</span>
        <canvas ref="previewEl" class="ttc-preview-canvas"></canvas>
      </div>
      <div v-if="previewSrc" class="ttc-preview">
        <span class="ttc-preview-label">地图上当前用的小图</span>
        <img class="ttc-preview-canvas" :src="previewSrc" alt="当前成品贴图" />
      </div>
      <div class="ttc-preview-meta">
        <span>菱形 {{ diamond.w }} × {{ Math.round(diamond.w / 2) }}</span>
        <span>左上角 {{ Math.round(diamond.x) }}, {{ Math.round(diamond.y) }}</span>
        <span class="ttc-preview-note">菱形内会成为地图上的砖面，框外的侧面 / 土壤 / 装饰都会被切掉；四个尖端如果被切进一点，把菱形收窄 1~2px 就能贴合</span>
      </div>
    </div>

    <div class="ttc-toolbar">
      <linshe-button variant="ghost" size="sm" :disabled="!loaded" @click="resetDiamond">还原自动裁剪</linshe-button>
      <!-- 外部注入的操作（重新生成）：与确认按钮同排 -->
      <slot name="actions" />
      <linshe-button variant="primary" size="sm" :loading="cropping" :disabled="!loaded" @click="confirm">确认裁剪</linshe-button>
    </div>

    <Teleport to="body">
      <Transition name="ttc-fade">
        <div v-if="tip" class="ttc-tip">{{ tip }}</div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as api from '../../api/index.js'
import LinsheButton from '../ui/LinsheButton.vue'
import TownPromptPanel from './TownPromptPanel.vue'

/** 与 agent-core ASSET_SPECS.ground.pixel 一致：地砖成品就是 64×32 */
const TILE_PIXEL = { w: 64, h: 32 }
/** 与后端 extractIsoDiamond 的菱形蒙版容差一致（略外扩，避免相邻菱形间出现发丝缝） */
const DIAMOND_EPS = 1.06
const HANDLE_SIZE = 12
const MIN_DIAMOND_W = 24
const DEFAULT_SCALE = 0.72

const props = defineProps({
  assetId: { type: Number, required: true },
  /** 裁剪前原图（生成出来的 800×800 大图）URL */
  src: { type: String, required: true },
  /** 当前成品贴图 URL，只用于对照 */
  previewSrc: { type: String, default: '' },
  /** 初始菱形：meta.tileCrop（用户上次调的）或 meta.sourceDiamond（生成时自动检测的） */
  initial: { type: Object, default: null },
  generationStep: { type: String, required: true },
  generationParams: { type: Object, required: true },
  isPortrait: { type: Boolean, default: false },
  configStatus: { type: String, default: '' },
})
const emit = defineEmits(['cropped', 'update:generationParams'])

const frameEl = ref(null)
const canvasEl = ref(null)
const previewEl = ref(null)
const loaded = ref(false)
const cropping = ref(false)
const tip = ref('')
const panning = ref(false)
const view = reactive({ scale: 1, x: 0, y: 0 })
/** 菱形包围框（原图像素坐标）：宽 w、高 w/2 */
const diamond = reactive({ x: 0, y: 0, w: 0 })
const infoStyle = ref({ top: '16px', right: '16px' })

let img = null
let ctx = null
let infoResizeObserver = null
let diamondDrag = null
let viewDrag = null
let stageCanvas = null
const halvePool = []

const hintText = computed(() => (loaded.value
  ? '拖菱形移动 · 拖四角调大小（2:1 锁定）· 滚轮缩放 · 拖框外平移画布'
  : '正在读取裁剪前的原图…'))

const canvasViewStyle = computed(() => ({ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }))

const diamondHalfH = () => diamond.w / 2

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

/** 菱形宽保持偶数：高正好是宽的一半，预览与后端裁出来的比例一致 */
function evenWidth(value) {
  return Math.max(MIN_DIAMOND_W, Math.round(value / 2) * 2)
}

/** object-fit: contain 时，canvas 元素边框不等于实际内容区域；交互必须按内容区域换算 */
function canvasContentRect(canvas) {
  const rect = canvas.getBoundingClientRect()
  const imageRatio = canvas.width / canvas.height
  const boxRatio = rect.width / rect.height
  let width = rect.width
  let height = rect.height
  if (imageRatio > boxRatio) height = rect.width / imageRatio
  else width = rect.height * imageRatio
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  }
}

/** canvas 是原图坐标系；这里返回 CSS 缩放比例，用于保持框线/手柄视觉大小 */
function displayScale() {
  const canvas = canvasEl.value
  if (!img || !canvas?.width || !canvas.clientWidth) return { x: 1, y: 1 }
  const content = canvasContentRect(canvas)
  return {
    x: content.width / view.scale / canvas.width,
    y: content.height / view.scale / canvas.height,
  }
}

/** 鼠标 CSS 坐标 → canvas/原图像素 */
function canvasPoint(e) {
  const canvas = canvasEl.value
  const content = canvasContentRect(canvas)
  return {
    x: (e.clientX - content.left) * (canvas.width / content.width),
    y: (e.clientY - content.top) * (canvas.height / content.height),
  }
}

function diamondPoints() {
  const height = diamondHalfH()
  const cx = diamond.x + diamond.w / 2
  const cy = diamond.y + height / 2
  return {
    height,
    cx,
    cy,
    corners: [[diamond.x, diamond.y], [diamond.x + diamond.w, diamond.y], [diamond.x, diamond.y + height], [diamond.x + diamond.w, diamond.y + height]],
    tips: [[cx, diamond.y], [diamond.x + diamond.w, cy], [cx, diamond.y + height], [diamond.x, cy]],
  }
}

function updateInfoPosition() {
  const panel = frameEl.value?.closest?.('.tam-panel')
  const top = panel ? Math.max(12, panel.getBoundingClientRect().top + 12) : 16
  if (!panel) {
    infoStyle.value = { top: `${top}px`, right: '16px' }
    return
  }
  const panelRect = panel.getBoundingClientRect()
  const infoWidth = 260
  const canFloatOutside = panelRect.right + 12 + infoWidth + 12 <= window.innerWidth
  infoStyle.value = canFloatOutside
    ? { top: `${top}px`, left: `${Math.round(panelRect.right + 12)}px` }
    : { top: `${top}px`, right: '12px' }
}

function draw() {
  if (!ctx || !img) return
  const canvas = canvasEl.value
  const { height, corners, tips } = diamondPoints()
  const unit = Math.max(1 / ((displayScale().x || 1) * view.scale), 1)
  const lineWidth = 2 * unit
  const handle = HANDLE_SIZE * unit

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  // 菱形外压暗：一眼看出最终砖面是哪一块
  ctx.fillStyle = 'rgba(20, 14, 10, 0.45)'
  ctx.beginPath()
  ctx.rect(0, 0, canvas.width, canvas.height)
  ctx.moveTo(tips[0][0], tips[0][1])
  for (const [px, py] of tips.slice(1)) ctx.lineTo(px, py)
  ctx.closePath()
  ctx.fill('evenodd')

  ctx.strokeStyle = '#e07b6c'
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  ctx.moveTo(tips[0][0], tips[0][1])
  for (const [px, py] of tips.slice(1)) ctx.lineTo(px, py)
  ctx.closePath()
  ctx.stroke()

  ctx.fillStyle = '#e07b6c'
  for (const [px, py] of corners) {
    ctx.fillRect(px - handle / 2, py - handle / 2, handle, handle)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = Math.max(1, lineWidth / 2)
    ctx.strokeRect(px - handle / 2, py - handle / 2, handle, handle)
  }

  // 菱形高度提示：水平/竖直对角线长度（对齐用）
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.lineWidth = Math.max(1, lineWidth / 2)
  ctx.beginPath()
  ctx.moveTo(diamond.x, diamond.y + height / 2)
  ctx.lineTo(diamond.x + diamond.w, diamond.y + height / 2)
  ctx.moveTo(diamond.x + diamond.w / 2, diamond.y)
  ctx.lineTo(diamond.x + diamond.w / 2, diamond.y + height)
  ctx.stroke()
}

/** 按菱形（含后端同款外扩蒙版）实时算一张 64×32 预览 */
function renderPreview() {
  const canvas = previewEl.value
  if (!canvas || !img || diamond.w <= 0) return
  const height = Math.max(1, Math.round(diamondHalfH()))
  if (canvas.width !== TILE_PIXEL.w || canvas.height !== TILE_PIXEL.h) {
    canvas.width = TILE_PIXEL.w
    canvas.height = TILE_PIXEL.h
  }
  if (!stageCanvas) stageCanvas = document.createElement('canvas')
  if (stageCanvas.width !== diamond.w || stageCanvas.height !== height) {
    stageCanvas.width = diamond.w
    stageCanvas.height = height
  }
  const sctx = stageCanvas.getContext('2d')
  sctx.clearRect(0, 0, diamond.w, height)
  sctx.imageSmoothingEnabled = false
  sctx.drawImage(img, diamond.x, diamond.y, diamond.w, height, 0, 0, diamond.w, height)
  sctx.globalCompositeOperation = 'destination-in'
  sctx.beginPath()
  sctx.moveTo(diamond.w / 2, height / 2 - (height / 2) * DIAMOND_EPS)
  sctx.lineTo(diamond.w / 2 + (diamond.w / 2) * DIAMOND_EPS, height / 2)
  sctx.lineTo(diamond.w / 2, height / 2 + (height / 2) * DIAMOND_EPS)
  sctx.lineTo(diamond.w / 2 - (diamond.w / 2) * DIAMOND_EPS, height / 2)
  sctx.closePath()
  sctx.fill()
  sctx.globalCompositeOperation = 'source-over'

  const pctx = canvas.getContext('2d')
  pctx.clearRect(0, 0, TILE_PIXEL.w, TILE_PIXEL.h)
  pctx.imageSmoothingEnabled = true
  pctx.imageSmoothingQuality = 'high'
  const shrunk = halveToTile(stageCanvas)
  pctx.drawImage(shrunk, 0, 0, shrunk.width, shrunk.height, 0, 0, TILE_PIXEL.w, TILE_PIXEL.h)
}

/**
 * 逐级折半再落到 64×32。
 * canvas 一步缩到 1/N（源图 800~1536，目标只有 64）时，每个目标像素只采样源图两三个像素，
 * 大部分源像素被丢掉（混叠），预览会与后端 sharp 的缩图结果对不上；
 * 逐级折半近似 box 平均，缩图比例再大也能保持与后端一致。
 */
function halveToTile(source) {
  let current = source
  let index = 0
  while (current.width >= TILE_PIXEL.w * 2 && current.height >= TILE_PIXEL.h * 2) {
    const nextW = Math.max(TILE_PIXEL.w, Math.floor(current.width / 2))
    const nextH = Math.max(TILE_PIXEL.h, Math.floor(current.height / 2))
    let next = halvePool[index]
    if (!next) {
      next = document.createElement('canvas')
      halvePool[index] = next
    }
    if (next.width !== nextW) next.width = nextW
    if (next.height !== nextH) next.height = nextH
    const nctx = next.getContext('2d')
    nctx.clearRect(0, 0, nextW, nextH)
    nctx.imageSmoothingEnabled = true
    nctx.imageSmoothingQuality = 'high'
    nctx.drawImage(current, 0, 0, nextW, nextH)
    current = next
    index++
  }
  return current
}

/** 初始化菱形：优先用 meta 里记的框，否则居中取 72% 宽 */
function resetDiamond() {
  if (!img) return
  const maxW = evenWidth(img.width)
  const initW = props.initial?.w ? evenWidth(props.initial.w) : evenWidth(img.width * DEFAULT_SCALE)
  const width = clamp(initW, MIN_DIAMOND_W, maxW)
  const height = width / 2
  const initX = Number.isFinite(props.initial?.x) ? Math.round(props.initial.x) : Math.round((img.width - width) / 2)
  const initY = Number.isFinite(props.initial?.y) ? Math.round(props.initial.y) : Math.round((img.height - height) / 2)
  diamond.w = width
  diamond.x = clamp(initX, 0, Math.max(0, img.width - width))
  diamond.y = clamp(initY, 0, Math.max(0, img.height - height))
  renderPreview()
  draw()
}

async function loadImage(src) {
  loaded.value = false
  resetView()
  const image = new Image()
  image.crossOrigin = 'anonymous'
  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = () => reject(new Error('原图加载失败'))
    image.src = src
  }).catch(() => {})
  img = image
  await nextTick()
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const canvas = canvasEl.value
  if (canvas) {
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    canvas.style.width = ''
    canvas.style.height = ''
    ctx = canvas.getContext('2d', { willReadFrequently: false })
  }
  resetDiamond()
  loaded.value = true
  draw()
}

function resetView() {
  view.scale = 1
  view.x = 0
  view.y = 0
}

function onWheel(e) {
  if (!img || !canvasEl.value || !frameEl.value) return
  const canvas = canvasEl.value
  const frameRect = frameEl.value.getBoundingClientRect()
  const oldContent = canvasContentRect(canvas)
  const oldScale = view.scale
  const nextScale = Math.min(5, Math.max(1, oldScale * (e.deltaY > 0 ? 0.9 : 1.1)))
  if (nextScale === oldScale) return

  const pointerX = e.clientX - frameRect.left
  const pointerY = e.clientY - frameRect.top
  const oldLeft = oldContent.left - frameRect.left
  const oldTop = oldContent.top - frameRect.top
  const baseLeft = oldLeft - view.x
  const baseTop = oldTop - view.y
  const nextLeft = pointerX - (pointerX - oldLeft) * (nextScale / oldScale)
  const nextTop = pointerY - (pointerY - oldTop) * (nextScale / oldScale)
  view.x = nextLeft - baseLeft
  view.y = nextTop - baseTop
  view.scale = nextScale
}

/** 命中检测：先四角手柄（缩放），再框内（平移菱形），最后空画布（平移视图） */
function onDown(e) {
  if (!img) return
  const point = canvasPoint(e)
  const { corners, height } = diamondPoints()
  const unit = Math.max(1 / ((displayScale().x || 1) * view.scale), 1)
  const hit = (HANDLE_SIZE * 1.6) * unit
  const corner = corners.find(([px, py]) => Math.abs(point.x - px) <= hit && Math.abs(point.y - py) <= hit)
  if (corner) {
    const anchor = { x: corner[0] === diamond.x ? diamond.x + diamond.w : diamond.x, y: corner[1] === diamond.y ? diamond.y + height : diamond.y }
    diamondDrag = { mode: 'resize', anchor }
    frameEl.value?.setPointerCapture?.(e.pointerId)
    return
  }
  const nx = (point.x - (diamond.x + diamond.w / 2)) / (diamond.w / 2)
  const ny = (point.y - (diamond.y + height / 2)) / (height / 2)
  if (Math.abs(nx) + Math.abs(ny) <= 1.15) {
    diamondDrag = { mode: 'move', dx: point.x - diamond.x, dy: point.y - diamond.y }
    frameEl.value?.setPointerCapture?.(e.pointerId)
    return
  }
  viewDrag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, viewX: view.x, viewY: view.y }
  panning.value = true
  frameEl.value?.setPointerCapture?.(e.pointerId)
}

function onMove(e) {
  if (viewDrag && e.pointerId === viewDrag.pointerId) {
    view.x = viewDrag.viewX + e.clientX - viewDrag.x
    view.y = viewDrag.viewY + e.clientY - viewDrag.y
    return
  }
  if (!diamondDrag || !img) return
  const point = canvasPoint(e)
  if (diamondDrag.mode === 'move') {
    diamond.x = clamp(point.x - diamondDrag.dx, 0, Math.max(0, img.width - diamond.w))
    diamond.y = clamp(point.y - diamondDrag.dy, 0, Math.max(0, img.height - diamondHalfH()))
  } else {
    const { anchor } = diamondDrag
    const width = evenWidth(Math.max(Math.abs(point.x - anchor.x), Math.abs(point.y - anchor.y) * 2))
    const bounded = clamp(width, MIN_DIAMOND_W, Math.max(MIN_DIAMOND_W, img.width))
    const height = bounded / 2
    diamond.w = bounded
    diamond.x = clamp(point.x < anchor.x ? anchor.x - bounded : anchor.x, 0, Math.max(0, img.width - bounded))
    diamond.y = clamp(point.y < anchor.y ? anchor.y - height : anchor.y, 0, Math.max(0, img.height - height))
  }
  renderPreview()
  draw()
}

function onUp() {
  diamondDrag = null
  viewDrag = null
  panning.value = false
}

async function confirm() {
  if (!img || cropping.value || diamond.w <= 0) return
  cropping.value = true
  try {
    await api.cropTownTileAsset(props.assetId, {
      x: Math.round(diamond.x),
      y: Math.round(diamond.y),
      w: Math.round(diamond.w),
    })
    tip.value = '✓ 已按新菱形重裁'
    emit('cropped')
  } catch (err) {
    tip.value = '裁剪失败：' + (err?.message || '')
  } finally {
    cropping.value = false
    setTimeout(() => { tip.value = '' }, 1800)
  }
}

// 裁剪前原图换了（重新生成 / 手动上传）就重新加载，画面不能停在旧图上
watch(() => props.src, (v) => { if (v) loadImage(v) })

onMounted(() => {
  nextTick(() => updateInfoPosition())
  const panel = frameEl.value?.closest?.('.tam-panel')
  if (panel && typeof ResizeObserver !== 'undefined') {
    infoResizeObserver = new ResizeObserver(() => updateInfoPosition())
    infoResizeObserver.observe(panel)
  }
  window.addEventListener('resize', updateInfoPosition)
  if (props.src) loadImage(props.src)
})

onBeforeUnmount(() => {
  diamondDrag = null
  viewDrag = null
  stageCanvas = null
  halvePool.length = 0
  infoResizeObserver?.disconnect()
  infoResizeObserver = null
  window.removeEventListener('resize', updateInfoPosition)
})
</script>

<style scoped>
.ttc { display: flex; flex-direction: column; gap: 8px; }

.ttc-frame {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 50vh;
  max-height: 72vh;
  border-radius: 12px;
  overflow: hidden;
  background: #efe9de;
  touch-action: none;
  cursor: grab;
}
.ttc-frame.is-panning { cursor: grabbing; }

.ttc-checker {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(45deg, #e3dccc 25%, transparent 25%),
    linear-gradient(-45deg, #e3dccc 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e3dccc 75%),
    linear-gradient(-45deg, transparent 75%, #e3dccc 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}

.ttc-stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  line-height: 0;
}
.ttc-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  transform-origin: 0 0;
  will-change: transform;
}

.ttc-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-secondary);
}

.ttc-info {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 1170;
  width: min(260px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ttc-info :deep(.prompt-panel) {
  width: 100%;
  max-height: min(84vh, 620px);
  overflow-y: auto;
}
.ttc-config-status {
  font-size: 10px;
  color: var(--text-secondary);
  background: rgba(240, 236, 232, 0.75);
  border-radius: 10px;
  padding: 7px 9px;
}

.ttc-hint { font-size: 10px; color: var(--text-secondary); }

.ttc-previews { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.ttc-preview { display: flex; flex-direction: column; gap: 4px; }
.ttc-preview-label { font-size: 10px; color: var(--text-secondary); }
/* 320×160 = 64×32 的 5 倍整数放大：像素块清晰，菱形四个尖端能看清单像素 */
.ttc-preview-canvas {
  width: min(320px, 27vw);
  height: auto;
  aspect-ratio: 2 / 1;
  border-radius: 8px;
  background: rgba(240, 236, 232, 0.7);
  image-rendering: pixelated;
}
.ttc-preview-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 10px;
  color: var(--text-secondary);
  max-width: 260px;
}
.ttc-preview-note { opacity: 0.85; }

.ttc-toolbar { display: flex; gap: 6px; flex-wrap: wrap; }
.ttc-toolbar > :last-child { margin-left: auto; }

.ttc-tip {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #f4f1ee;
  color: var(--text-primary);
  font-size: 12px;
  padding: 8px 16px;
  border-radius: 999px;
  box-shadow: 0 8px 24px rgba(54, 42, 38, 0.2);
  z-index: 1200;
}
.ttc-fade-enter-active, .ttc-fade-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.ttc-fade-enter-from, .ttc-fade-leave-to { opacity: 0; transform: translate(-50%, 8px); }
</style>