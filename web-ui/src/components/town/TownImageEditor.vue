<template>
  <div class="img-editor" :class="{ 'is-large': cropMode }">
    <!-- 画布区：canvas 内部保持原图像素；CSS 只负责适配浏览器高度 -->
    <div
      ref="frameEl"
      class="ie-frame"
      :class="{ 'is-crop': cropActive, 'is-erase': eraseMode, 'is-viewer': !cropActive && !eraseMode, 'is-panning': panning }"
      @pointerdown.prevent="onDown"
      @wheel.prevent="onWheel"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <div class="ie-stage">
        <div class="ie-checker"></div>
        <canvas ref="canvasEl" class="ie-canvas" :style="canvasViewStyle"></canvas>
      </div>
      <div v-if="!loaded" class="ie-loading">{{ loadingText || '加载中…' }}</div>
      <Teleport to="body">
        <aside class="ie-info" :style="infoStyle" aria-label="图片生成配置">
          <TownPromptPanel
            :model-value="generationParams"
            :step="generationStep"
            :hide-prefix="isPortrait"
            @update:model-value="value => emit('update:generationParams', value)"
          />
          <div v-if="configStatus" class="ie-config-status">{{ configStatus }}</div>
        </aside>
      </Teleport>
    </div>

    <div class="ie-toolbar">
      <div class="ie-hint">{{ cropHint }}</div>
      <div class="ie-buttons">
        <linshe-button variant="chip" size="sm" :active="eraseMode" @click="eraseMode = !eraseMode">
          {{ eraseMode ? '🪄 抠白中' : '🪄 抠去多余白色' }}
        </linshe-button>

        <linshe-button v-if="cropMode" variant="chip" size="sm" :active="cropActive" @click="cropActive = !cropActive">
          ✂️ 裁剪模式
        </linshe-button>

        <linshe-button variant="ghost" size="sm" :disabled="!canUndo" @click="undoErase">撤销上一步</linshe-button>
        <linshe-button v-if="cropActive && !eraseMode" variant="primary" size="sm" :loading="cropping" @click="confirmCrop">确认裁剪</linshe-button>
        <linshe-button v-else variant="primary" size="sm" :loading="saving" :disabled="!dirty" @click="save">保存编辑</linshe-button>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="ie-fade">
        <div v-if="savedTip" class="ie-saved-tip">{{ savedTip }}</div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as api from '../../api/index.js'
import LinsheButton from '../ui/LinsheButton.vue'
import TownPromptPanel from './TownPromptPanel.vue'

const props = defineProps({
  src: { type: String, required: true },
  assetId: { type: Number, required: true },
  hint: { type: String, default: '' },
  loadingText: { type: String, default: '' },
  /** 兼容旧调用；显示高度现在由浏览器可视区决定 */
  fitHeight: { type: [Number, String], default: 360 },
  /** 截取框模式：放大查看，拖动/缩放截取框划定最终成图范围 */
  cropMode: { type: Boolean, default: false },
  /** 截取框默认占原图比例 */
  cropScale: { type: Number, default: 0.72 },
  generationStep: { type: String, required: true },
  generationParams: { type: Object, required: true },
  isPortrait: { type: Boolean, default: false },
  configStatus: { type: String, default: '' },
})
const emit = defineEmits(['saved', 'cropped', 'update:generationParams'])

const frameEl = ref(null)
const canvasEl = ref(null)
const loaded = ref(false)
const eraseMode = ref(false)
const cropActive = ref(false)
const canUndo = ref(false)
const saving = ref(false)
const dirty = ref(false)
const savedTip = ref('')
const view = reactive({ scale: 1, x: 0, y: 0 })
const panning = ref(false)
const infoStyle = ref({ top: '16px', right: '16px' })
let infoResizeObserver = null

let img = null
let ctx = null

const ERASE_TOLERANCE = 42
const cropRect = ref(null)
const cropping = ref(false)
let cropDrag = null
let viewDrag = null
let eraseHistory = []

/** object-fit: contain 时，canvas 元素边框不等于实际内容区域；交互必须按内容区域换算 */
function canvasContentRect(canvas) {
  const rect = canvas.getBoundingClientRect()
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height)
  const width = canvas.width * scale
  const height = canvas.height * scale
  return {
    left: rect.left + ((rect.width - width) / 2),
    top: rect.top + ((rect.height - height) / 2),
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

function cropDisplayRect() {
  return { ...cropRect.value }
}

const cropHint = computed(() => {
  if (eraseMode.value) return props.hint || '点击要去除的白色或底色'
  if (cropActive.value) return '拖动移动截取框 · 拖右下角手柄调大小 · 框内即最终成图范围'
  return '滚轮缩放 · 拖动画布查看'
})

const canvasViewStyle = computed(() => ({ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }))

/** 配置面板挂在主弹窗外侧；空间不足时保持右侧可见 */
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
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  if (cropActive.value && cropRect.value && !eraseMode.value) {
    const r = cropDisplayRect()
    const unit = Math.max(1 / ((displayScale().x || 1) * view.scale), 1)
    const lineWidth = 2 * unit
    const handleSize = 12 * unit
    ctx.fillStyle = 'rgba(20, 14, 10, 0.45)'
    ctx.beginPath()
    ctx.rect(0, 0, canvas.width, canvas.height)
    ctx.rect(r.x, r.y, r.w, r.h)
    ctx.fill('evenodd')
    ctx.strokeStyle = '#e07b6c'
    ctx.lineWidth = lineWidth
    ctx.strokeRect(r.x, r.y, r.w, r.h)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.lineWidth = Math.max(1, lineWidth / 2)
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath()
      ctx.moveTo(r.x + (r.w * i) / 3, r.y)
      ctx.lineTo(r.x + (r.w * i) / 3, r.y + r.h)
      ctx.moveTo(r.x, r.y + (r.h * i) / 3)
      ctx.lineTo(r.x + r.w, r.y + (r.h * i) / 3)
      ctx.stroke()
    }
    ctx.fillStyle = '#e07b6c'
    ctx.fillRect(r.x + r.w - handleSize, r.y + r.h - handleSize, handleSize, handleSize)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = Math.max(1, lineWidth / 2)
    ctx.strokeRect(r.x + r.w - handleSize, r.y + r.h - handleSize, handleSize, handleSize)
  }
}

async function loadImage(src) {
  loaded.value = false
  dirty.value = false
  eraseHistory = []
  canUndo.value = false
  cropActive.value = false
  resetView()
  const image = new Image()
  image.crossOrigin = 'anonymous'
  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
  img = image
  await nextTick()
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  sizeCanvas()
  loaded.value = true
  if (props.cropMode) resetCrop()
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

/** 关键点：backing store 就是原图宽高；缩放只发生在 CSS 显示层 */
function sizeCanvas() {
  const canvas = canvasEl.value
  if (!canvas || !img) return
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  canvas.style.width = ''
  canvas.style.height = ''
  ctx = canvas.getContext('2d', { willReadFrequently: true })
}

function onDown(e) {
  const point = canvasPoint(e)
  if (eraseMode.value) {
    eraseColorAt(point.x, point.y)
    return
  }
  if (cropActive.value && cropRect.value) {
    const dr = cropDisplayRect()
    const scale = displayScale()
    const unit = Math.max(1 / ((scale.x || 1) * view.scale), 1)
    const hit = 12 / unit
    if (point.x >= dr.x + dr.w - hit && point.x <= dr.x + dr.w + hit / 4 && point.y >= dr.y + dr.h - hit && point.y <= dr.y + dr.h + hit / 4) {
      cropDrag = { mode: 'resize' }
      frameEl.value?.setPointerCapture?.(e.pointerId)
      return
    }
    if (point.x >= dr.x && point.x <= dr.x + dr.w && point.y >= dr.y && point.y <= dr.y + dr.h) {
      cropDrag = { mode: 'move', dx: point.x - cropRect.value.x, dy: point.y - cropRect.value.y }
      frameEl.value?.setPointerCapture?.(e.pointerId)
      return
    }
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
  if (!cropActive.value || !cropDrag || !cropRect.value) return
  const point = canvasPoint(e)
  const r = cropRect.value
  if (cropDrag.mode === 'move') {
    r.x = Math.max(0, Math.min(img.width - r.w, point.x - cropDrag.dx))
    r.y = Math.max(0, Math.min(img.height - r.h, point.y - cropDrag.dy))
  } else {
    r.w = Math.max(8, Math.min(img.width - r.x, point.x - r.x))
    r.h = Math.max(8, Math.min(img.height - r.y, point.y - r.y))
  }
  draw()
}

function onUp() {
  cropDrag = null
  viewDrag = null
  panning.value = false
}

/** 点击颜色区域：以点击点颜色为种子，容差洪泛 → 透明 */
function eraseColorAt(px, py) {
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) return

  const snapshot = document.createElement('canvas')
  snapshot.width = img.width
  snapshot.height = img.height
  snapshot.getContext('2d').drawImage(img, 0, 0)
  eraseHistory.push(snapshot)
  if (eraseHistory.length > 8) eraseHistory.shift()
  canUndo.value = true

  const work = document.createElement('canvas')
  work.width = img.width
  work.height = img.height
  const wctx = work.getContext('2d', { willReadFrequently: true })
  wctx.drawImage(img, 0, 0)
  const data = wctx.getImageData(0, 0, img.width, img.height)
  const d = data.data
  const at = (x, y) => (y * img.width + x) * 4
  const seed = at(ix, iy)
  const target = [d[seed], d[seed + 1], d[seed + 2]]
  if (d[seed + 3] < 8) {
    savedTip.value = '点击的位置已经是透明区域'
    setTimeout(() => { savedTip.value = '' }, 1500)
    return
  }
  const nearSeed = (o) =>
    Math.abs(d[o] - target[0]) <= ERASE_TOLERANCE &&
    Math.abs(d[o + 1] - target[1]) <= ERASE_TOLERANCE &&
    Math.abs(d[o + 2] - target[2]) <= ERASE_TOLERANCE

  const seen = new Uint8Array(img.width * img.height)
  const stack = [ix, iy]
  seen[iy * img.width + ix] = 1
  while (stack.length > 0) {
    const y = stack.pop()
    const x = stack.pop()
    const o = at(x, y)
    d[o + 3] = 0
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue
      const k = ny * img.width + nx
      if (seen[k]) continue
      const no = at(nx, ny)
      if (d[no + 3] > 8 && nearSeed(no)) { seen[k] = 1; stack.push(nx, ny) }
    }
  }
  wctx.putImageData(data, 0, 0)

  const out = new Image()
  out.onload = () => {
    img = out
    dirty.value = true
    draw()
  }
  out.src = work.toDataURL('image/png')
}

function undoErase() {
  if (!eraseHistory.length || !img) return
  img = eraseHistory.pop()
  dirty.value = eraseHistory.length > 0
  canUndo.value = eraseHistory.length > 0
  draw()
}

/** 初始化截取框：始终基于原图尺寸居中 */
function resetCrop() {
  if (!img) return
  const w = img.width * props.cropScale
  const h = img.height * props.cropScale
  cropRect.value = {
    x: (img.width - w) / 2,
    y: (img.height - h) / 2,
    w, h,
  }
}

async function confirmCrop() {
  const r = cropRect.value
  if (!r || !img || cropping.value) return
  const nx = Math.max(0, Math.round(r.x))
  const ny = Math.max(0, Math.round(r.y))
  const nw = Math.max(8, Math.min(Math.round(r.w), img.width - nx))
  const nh = Math.max(8, Math.min(Math.round(r.h), img.height - ny))
  cropping.value = true
  try {
    if (dirty.value) await save()
    await api.cropTownAsset(props.assetId, { x: nx, y: ny, w: nw, h: nh })
    await loadImage(freshSrc())
    resetCrop()
    emit('cropped')
  } catch (err) {
    console.warn('[img-editor] crop failed:', err?.message)
  } finally {
    cropping.value = false
  }
}

async function save() {
  if (!dirty.value || saving.value) return
  saving.value = true
  try {
    const dataUrl = canvasEl.value ? compositeFull().toDataURL('image/png') : null
    await api.saveTownAssetImage(props.assetId, dataUrl)
    savedTip.value = '✓ 已保存'
    dirty.value = false
    eraseHistory = []
    canUndo.value = false
    emit('saved')
    setTimeout(() => { savedTip.value = '' }, 1600)
  } catch (err) {
    savedTip.value = '保存失败：' + (err?.message || '')
    setTimeout(() => { savedTip.value = '' }, 2200)
  } finally {
    saving.value = false
  }
}

/** 合成导出：canvas backing 本身就是原图分辨率 */
function compositeFull() {
  const out = document.createElement('canvas')
  out.width = img.width
  out.height = img.height
  const c = out.getContext('2d')
  c.imageSmoothingEnabled = false
  c.drawImage(img, 0, 0, img.width, img.height)
  return out
}

function freshSrc() {
  if (props.src.startsWith('data:')) return props.src
  return `${props.src.split('?')[0]}?v=${Date.now()}`
}

watch(() => props.src, (v) => { if (v) loadImage(v) })
watch(eraseMode, () => draw())
watch(cropActive, (active) => {
  if (active) resetCrop()
  resetView()
  draw()
})
watch(() => props.cropMode, (allowed) => {
  if (!allowed) cropActive.value = false
})

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
  cropDrag = null
  viewDrag = null
  infoResizeObserver?.disconnect()
  infoResizeObserver = null
  window.removeEventListener('resize', updateInfoPosition)
})
</script>

<style scoped>
.img-editor { display: flex; flex-direction: column; gap: 8px; }

.img-editor.is-large .ie-frame { min-height: 50vh; }

.ie-frame {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  max-height: 72vh;
  border-radius: 12px;
  overflow: hidden;
  background: #efe9de;
  min-height: 160px;
  touch-action: none;
}

.ie-frame.is-crop { cursor: move; }
.ie-frame.is-erase { cursor: default; }
.ie-frame.is-viewer { cursor: grab; }
.ie-frame.is-panning { cursor: grabbing; }

.ie-checker {
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

.ie-stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  line-height: 0;
}
.ie-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  transform-origin: 0 0;
  will-change: transform;
}

.ie-info {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 1170;
  width: min(260px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ie-info :deep(.prompt-panel) {
  width: 100%;
  max-height: min(84vh, 620px);
  overflow-y: auto;
}
.ie-config-status {
  font-size: 10px;
  color: var(--text-secondary);
  background: rgba(240, 236, 232, 0.75);
  border-radius: 10px;
  padding: 7px 9px;
}
.ie-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-secondary);
}

.ie-toolbar { display: flex; flex-direction: column; gap: 6px; }
.ie-hint { font-size: 10px; color: var(--text-secondary); }
.ie-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
.ie-buttons > :last-child { margin-left: auto; }

.ie-saved-tip {
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

.ie-fade-enter-active, .ie-fade-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.ie-fade-enter-from, .ie-fade-leave-to { opacity: 0; transform: translate(-50%, 8px); }
</style>
