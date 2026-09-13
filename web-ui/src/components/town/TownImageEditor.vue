<template>
  <div class="img-editor" :class="{ 'is-large': cropMode, 'is-portrait': isPortrait, 'is-checking': gapOpen }">
    <!-- 画布区：canvas 内部保持原图像素；CSS 只负责适配浏览器高度 -->
    <div
      ref="frameEl"
      class="ie-frame"
      :class="{ 'is-crop': cropActive, 'is-erase': eraseMode, 'is-viewer': !cropActive && !eraseMode, 'is-panning': panning }"
      @pointerdown.prevent="onDown"
      @wheel.prevent="onWheel"
      @contextmenu="onContextMenu"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onCancel"
    >
      <div class="ie-stage">
        <div class="ie-checker"></div>
        <canvas ref="canvasEl" class="ie-canvas" :style="canvasViewStyle"></canvas>
      </div>
      <div v-if="!loaded" class="ie-loading" role="status">{{ loadError || loadingText || '加载中…' }}</div>
      <Teleport to="body">
        <aside v-show="!gapOpen" class="ie-info" :style="infoStyle" aria-label="图片生成配置">
          <TownPromptPanel
            :model-value="generationParams"
            :step="generationStep"
            :hide-prefix="isPortrait"
            :show-portrait-lora="isPortrait"
            @update:model-value="value => emit('update:generationParams', value)"
          />
          <div v-if="configStatus" class="ie-config-status">{{ configStatus }}</div>
        </aside>
      </Teleport>
    </div>

    <div class="ie-toolbar">
      <section v-if="gapOpen" class="ie-gaps" aria-label="自动抠白" :aria-busy="detecting">
        <div class="ie-gap-heading">
          <label :for="gapSliderId">抠白强度 <strong>{{ gapStrength }}</strong></label>
          <span role="status">{{ gapStatus }}</span>
          <linshe-button variant="icon" size="sm" aria-label="收起自动抠白" @click="closeGaps">✕</linshe-button>
        </div>
        <input
          :id="gapSliderId" v-model.number="gapStrength" class="ie-gap-slider" type="range" min="0" max="100" step="1" aria-label="抠白强度"
          :disabled="!loaded || saving || cropping" :aria-valuetext="`${gapStrength}，${gapStatus}`" :style="{ '--fill': gapStrength / 100 }"
        >
        <div class="ie-gap-scale"><span>0 · 不抠</span><span>低抠大块 · 高抠碎白</span><span>100 · 碎白</span></div>
        <div class="ie-gap-footer">
          <p class="ie-gap-help"><i class="ie-gap-swatch" aria-hidden="true"></i>{{ gapPreview ? '正在预览抠后效果，保存后生效。' : '粉色区域将被整块抠透明。' }}抠白按连通的白色块计算：强度低只动大块留白，调高强度才把更细碎的白色也整块抠掉。</p>
          <linshe-button variant="ghost" size="sm" :disabled="editLocked || !gapPixelCount" @click="gapPreview = !gapPreview">{{ gapPreview ? '显示待抠标记' : '看抠后效果' }}</linshe-button>
        </div>
        <p v-if="gapError" class="ie-gap-error" role="alert">{{ gapError }}</p>
      </section>
      <div class="ie-hint">{{ cropHint }}</div>
      <div class="ie-buttons">
        <linshe-button variant="primary" size="sm" :loading="detecting" :disabled="!loaded || saving || cropping" @click="toggleGaps">
          <span class="ie-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
              <path d="m14 7 3 3" />
              <path d="M5 6v4" />
              <path d="M19 14v4" />
              <path d="M10 2v2" />
              <path d="M7 8H3" />
              <path d="M21 16h-4" />
              <path d="M11 3H9" />
            </svg>
          </span>
          自动抠白
        </linshe-button>
        <linshe-button variant="primary" size="sm" :disabled="editLocked" @click="toggleErase">
          <span class="ie-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
              <path d="M22 21H7" />
              <path d="m5 11 9 9" />
            </svg>
          </span>
          {{ eraseMode ? '点选抠白中' : '手动抠白' }}
        </linshe-button>

        <linshe-button v-if="cropMode" variant="primary" size="sm" :disabled="editLocked" @click="toggleCrop">
          <span class="ie-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="6" cy="6" r="3" />
              <path d="M8.12 8.12 12 12" />
              <path d="M20 4 8.12 15.88" />
              <circle cx="6" cy="18" r="3" />
              <path d="m14.8 14.8 5.2 5.2" />
            </svg>
          </span>
          裁剪模式
        </linshe-button>

        <linshe-button variant="ghost" size="sm" :disabled="(!canUndo && !(gapOpen && gapPixelCount)) || editLocked" @click="undoErase">{{ gapOpen && gapPixelCount ? '撤销抠白预览' : '撤销上一步' }}</linshe-button>
        <!-- 外部注入的操作（重新生成 / 立绘 HiresFix）：与主按钮同排 -->
        <slot name="actions" />
        <linshe-button v-if="cropActive && !eraseMode" variant="primary" size="sm" :loading="cropping" :disabled="editLocked" @click="confirmCrop">确认裁剪</linshe-button>
        <linshe-button v-else variant="primary" size="sm" :loading="saving" :disabled="(!dirty && !(gapOpen && gapPixelCount)) || editLocked" @click="save">{{ gapOpen && gapPixelCount ? '应用并保存' : '保存编辑' }}</linshe-button>
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
import { ref, shallowRef, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick, useId } from 'vue'
import * as api from '../../api/index.js'
import LinsheButton from '../ui/LinsheButton.vue'
import TownPromptPanel from './TownPromptPanel.vue'
import { applyWhiteGapStrength, normalizeWhiteGapStrength, MAX_WHITE_GAP_PIXELS } from '../../town/whiteGapDetection.js'

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
const loadError = ref('')
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
const gapOpen = ref(false)
const detecting = ref(false)
const gapError = ref('')
const gapStrength = ref(35)
const gapSliderId = useId()
const gapSession = shallowRef(null)
const gapPreview = ref(false)
const gapPixelCount = computed(() => gapSession.value?.pixelCounts[normalizeWhiteGapStrength(gapStrength.value)] || 0)
const gapRegionCount = computed(() => gapSession.value?.regionCounts[normalizeWhiteGapStrength(gapStrength.value)] || 0)
const editLocked = computed(() => !loaded.value || saving.value || cropping.value || detecting.value)
const gapStatus = computed(() => detecting.value ? '正在分析留白…' : !gapSession.value ? '等待分析' :
  gapStrength.value === 0 ? '保留原图' : gapRegionCount.value ? `将抠去 ${gapRegionCount.value} 处` :
    gapSession.value.pixelCounts[100] ? '暂无待抠区域，可调高强度' : '未发现可抠留白')
let gapWorker = null
let gapOverlay = null
let gapPreviewMask = null
let gapBoundary = null
let gapPaintFrame = null
let imageVersion = 0

function cancelDetection() {
  gapWorker?.terminate()
  gapWorker = null
  detecting.value = false
}

function clearGaps() {
  cancelDetection()
  if (gapPaintFrame !== null) cancelAnimationFrame(gapPaintFrame)
  gapPaintFrame = null
  gapSession.value = null
  gapPreview.value = false
  gapOverlay = null
  gapPreviewMask = null
  gapBoundary = null
  gapError.value = ''
}

function closeGaps() {
  cancelDetection()
  gapOpen.value = false
  gapPreview.value = false
  nextTick(() => requestAnimationFrame(() => requestAnimationFrame(draw)))
  draw()
}

function toggleGaps() {
  if (gapOpen.value) { closeGaps(); return }
  if (editLocked.value) return
  gapOpen.value = true
  eraseMode.value = false
  cropActive.value = false
  // 画框高度在 is-checking 下变化，等布局稳定后补一次重绘，避免合成层按旧尺寸采样
  nextTick(() => requestAnimationFrame(() => requestAnimationFrame(draw)))
  if (gapSession.value) nextTick(scheduleGapOverlay)
  else scanGaps()
}

function toggleErase() {
  closeGaps()
  cropActive.value = false
  eraseMode.value = !eraseMode.value
}

function toggleCrop() {
  closeGaps()
  eraseMode.value = false
  cropActive.value = !cropActive.value
}

function scanGaps() {
  if (editLocked.value || !img) return
  clearGaps()
  gapOpen.value = true
  eraseMode.value = false
  cropActive.value = false
  resetView()
  draw()
  if (img.width * img.height > MAX_WHITE_GAP_PIXELS) {
    gapError.value = '图片较大，请使用不超过 1600 万像素的图片查找留白；仍可手动抠白。'
    return
  }
  detecting.value = true
  const version = imageVersion
  try {
    // Read the working image, never the canvas containing preview highlights.
    const source = compositeFull().getContext('2d', { willReadFrequently: true }).getImageData(0, 0, img.width, img.height)
    const worker = new Worker(new URL('../../town/whiteGapDetection.worker.js', import.meta.url), { type: 'module' })
    gapWorker = worker
    const fail = message => {
      if (gapWorker !== worker || version !== imageVersion) return
      cancelDetection()
      gapError.value = message
    }
    worker.onerror = () => fail('留白查找失败，请重试；仍可使用手动抠白。')
    worker.onmessage = ({ data }) => {
      if (gapWorker !== worker || version !== imageVersion) return
      if (data.error) { fail(data.error); return }
      cancelDetection()
      gapSession.value = { ...data, width: source.width, height: source.height }
      rebuildGapOverlay()
    }
    worker.postMessage({ pixels: source.data.buffer, width: source.width, height: source.height }, [source.data.buffer])
  } catch (error) {
    cancelDetection()
    gapError.value = error.message || '留白查找失败，请重试'
  }
}

function scheduleGapOverlay() {
  if (gapPaintFrame !== null) return
  gapPaintFrame = requestAnimationFrame(() => {
    gapPaintFrame = null
    rebuildGapOverlay()
  })
}

function rebuildGapOverlay() {
  const session = gapSession.value
  if (!session) { gapOverlay = null; gapPreviewMask = null; gapBoundary = null; draw(); return }
  const { width, height, thresholds } = session
  const strength = normalizeWhiteGapStrength(gapStrength.value)
  gapOverlay ||= document.createElement('canvas')
  gapPreviewMask ||= document.createElement('canvas')
  gapOverlay.width = gapPreviewMask.width = width
  gapOverlay.height = gapPreviewMask.height = height
  const overlay = gapOverlay.getContext('2d')
  const mask = gapPreviewMask.getContext('2d')
  const cutout = mask.createImageData(width, height)
  const selected = i => thresholds[i] > 0 && thresholds[i] <= strength
  // Regions go away whole, so the preview is binary too: solid pink over every selected region.
  const boundary = new Path2D()
  for (let i = 0; i < thresholds.length; i++) {
    if (!selected(i)) continue
    cutout.data[i * 4 + 3] = 255
    const x = i % width, y = Math.floor(i / width)
    // The contour is a display-only path. Its thick outline never enters the saved alpha mask.
    if (x === 0 || !selected(i - 1)) { boundary.moveTo(x, y); boundary.lineTo(x, y + 1) }
    if (x === width - 1 || !selected(i + 1)) { boundary.moveTo(x + 1, y); boundary.lineTo(x + 1, y + 1) }
    if (y === 0 || !selected(i - width)) { boundary.moveTo(x, y); boundary.lineTo(x + 1, y) }
    if (y === height - 1 || !selected(i + width)) { boundary.moveTo(x, y + 1); boundary.lineTo(x + 1, y + 1) }
  }
  gapBoundary = [{ path: boundary, opacity: 1 }]
  mask.putImageData(cutout, 0, 0)
  overlay.putImageData(cutout, 0, 0)
  overlay.globalCompositeOperation = 'source-in'
  const style = getComputedStyle(frameEl.value)
  overlay.fillStyle = style.getPropertyValue('--fun-pink').trim()
  overlay.fillRect(0, 0, width, height)
  overlay.globalCompositeOperation = 'source-atop'
  overlay.strokeStyle = style.getPropertyValue('--on-accent').trim()
  const unit = 1 / Math.max(0.01, displayScale().x * view.scale)
  const stride = Math.max(5, 10 * unit)
  overlay.lineWidth = Math.max(1, 2 * unit)
  overlay.beginPath()
  for (let x = -height; x < width; x += stride) {
    overlay.moveTo(x, 0); overlay.lineTo(x + height, height)
  }
  overlay.stroke()
  overlay.globalCompositeOperation = 'source-over'
  draw()
}

function drawGapMarkers() {
  if (!gapBoundary || !gapPixelCount.value) return
  const style = getComputedStyle(frameEl.value)
  const pink = style.getPropertyValue('--fun-pink').trim()
  const ink = style.getPropertyValue('--cel-outline').trim()
  const paper = style.getPropertyValue('--on-accent').trim()
  const unit = 1 / Math.max(0.01, displayScale().x * view.scale)
  ctx.save()
  ctx.globalAlpha = 0.85
  ctx.drawImage(gapOverlay, 0, 0)
  ctx.lineJoin = 'round'
  for (const { path, opacity } of gapBoundary) {
    ctx.globalAlpha = opacity
    for (const [color, weight] of [[ink, 4], [pink, 2.5], [paper, 0.8]]) {
      ctx.strokeStyle = color
      ctx.lineWidth = weight * unit
      ctx.stroke(path)
    }
  }
  // Keep tiny openings visible even when viewing a whole portrait.
  for (const region of gapSession.value.regions) {
    if (region.firstStrength > gapStrength.value || Math.min(region.bounds.w, region.bounds.h) / unit >= 6) continue
    const { x, y } = region.anchor
    ctx.beginPath()
    ctx.arc(x, y, 8 * unit, 0, Math.PI * 2)
    ctx.strokeStyle = ink; ctx.lineWidth = 4 * unit; ctx.stroke()
    ctx.strokeStyle = paper; ctx.lineWidth = 2.5 * unit; ctx.stroke()
    ctx.strokeStyle = pink; ctx.lineWidth = 1.5 * unit; ctx.stroke()
  }
  ctx.restore()
}

function rememberEdit() {
  eraseHistory.push({ image: compositeFull(), dirty: dirty.value })
  if (eraseHistory.length > 8) eraseHistory.shift()
  canUndo.value = true
}

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
  if (gapOpen.value) return '调低强度即可恢复 · 拖动画布查看 · 滚轮缩放'
  if (eraseMode.value) return props.hint ? `${props.hint} · 右键拖动画布` : '点击要去除的白色或底色 · 右键拖动画布'
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

  if (gapOpen.value && gapOverlay) {
    if (gapPreview.value) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.drawImage(gapPreviewMask, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
    } else drawGapMarkers()
  }

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
  const version = ++imageVersion
  clearGaps()
  gapOpen.value = false
  gapStrength.value = 35
  eraseMode.value = false
  onCancel()
  loaded.value = false
  loadError.value = ''
  dirty.value = false
  eraseHistory = []
  canUndo.value = false
  cropActive.value = false
  resetView()
  const image = new Image()
  image.crossOrigin = 'anonymous'
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('图片加载失败，请重新打开图片'))
      image.src = src
    })
  } catch (error) {
    if (version === imageVersion) loadError.value = error.message
    return
  }
  if (version !== imageVersion) return
  img = image
  await nextTick()
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  if (version !== imageVersion) return
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

/** 滚轮缩放：以当前鼠标位置为锚点，指针下的图像点保持不动 */
function onWheel(e) {
  if (!img || !canvasEl.value || !frameEl.value) return
  const canvas = canvasEl.value
  const oldScale = view.scale
  const nextScale = Math.min(5, Math.max(1, oldScale * (e.deltaY > 0 ? 0.9 : 1.1)))
  if (nextScale === oldScale) return
  // contain 后位图在元素内的居中偏移只跟布局有关；显示区域 = translate + 偏移 × scale
  const layoutScale = Math.min(canvas.offsetWidth / img.width, canvas.offsetHeight / img.height)
  const baseW = img.width * layoutScale
  const baseH = img.height * layoutScale
  const offsetLeft = (canvas.offsetWidth - baseW) / 2
  const offsetTop = (canvas.offsetHeight - baseH) / 2
  const frameRect = frameEl.value.getBoundingClientRect()
  const pointerX = e.clientX - frameRect.left
  const pointerY = e.clientY - frameRect.top
  const ratio = nextScale / oldScale
  const left = view.x + offsetLeft * oldScale
  const top = view.y + offsetTop * oldScale
  view.x = pointerX - (pointerX - left) * ratio - offsetLeft * nextScale
  view.y = pointerY - (pointerY - top) * ratio - offsetTop * nextScale
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
  if (!loaded.value || !img || saving.value || cropping.value || detecting.value) return
  const point = canvasPoint(e)
  // 手动/自动抠白下右键只负责拖动画布，左键才是点选抠色
  if (e.button === 2 && (eraseMode.value || gapOpen.value)) {
    viewDrag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, viewX: view.x, viewY: view.y }
    panning.value = true
    frameEl.value?.setPointerCapture?.(e.pointerId)
    return
  }
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
  onCancel()
}

function onCancel() {
  cropDrag = null
  viewDrag = null
  panning.value = false
}

/** 抠白（手动/自动）下右键用于拖动画布，屏蔽浏览器右键菜单 */
function onContextMenu(e) {
  if (eraseMode.value || gapOpen.value) e.preventDefault()
}

/** 点击颜色区域：以点击点颜色为种子，容差洪泛 → 透明 */
function eraseColorAt(px, py) {
  if (editLocked.value || !img) return
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) return

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
  rememberEdit()
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

  img = work
  imageVersion++
  dirty.value = true
  clearGaps()
  draw()
}

function undoErase() {
  if (gapOpen.value && gapPixelCount.value && !editLocked.value) {
    gapStrength.value = 0
    gapPreview.value = false
    return
  }
  if (!eraseHistory.length || !img || editLocked.value) return
  const previous = eraseHistory.pop()
  img = previous.image
  imageVersion++
  dirty.value = previous.dirty
  clearGaps()
  gapOpen.value = false
  canUndo.value = eraseHistory.length > 0
  rebuildGapOverlay()
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
    if (dirty.value && !(await save())) return
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
  const applyGaps = gapOpen.value && gapPixelCount.value > 0
  if ((!dirty.value && !applyGaps) || saving.value || detecting.value || !loaded.value) return false
  saving.value = true
  const version = imageVersion
  try {
    const output = compositeFull()
    if (applyGaps) {
      const context = output.getContext('2d', { willReadFrequently: true })
      const data = context.getImageData(0, 0, output.width, output.height)
      data.data.set(applyWhiteGapStrength(data.data, gapSession.value.thresholds, gapStrength.value))
      context.putImageData(data, 0, 0)
    }
    await api.saveTownAssetImage(props.assetId, output.toDataURL('image/png'))
    if (version !== imageVersion) return true
    img = output
    imageVersion++
    savedTip.value = '✓ 已保存'
    dirty.value = false
    eraseHistory = []
    canUndo.value = false
    clearGaps()
    gapOpen.value = false
    draw()
    emit('saved')
    setTimeout(() => { savedTip.value = '' }, 1600)
    return true
  } catch (err) {
    savedTip.value = '保存失败：' + (err?.message || '')
    setTimeout(() => { savedTip.value = '' }, 2200)
    return false
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
watch(gapPreview, () => draw())
watch(gapStrength, () => { if (gapOpen.value) scheduleGapOverlay() })
watch(() => view.scale, () => { if (gapOpen.value) scheduleGapOverlay() })
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
  if (frameEl.value && typeof ResizeObserver !== 'undefined') {
    infoResizeObserver = new ResizeObserver(() => {
      updateInfoPosition()
      if (gapOpen.value) scheduleGapOverlay()
    })
    infoResizeObserver.observe(frameEl.value)
  }
  window.addEventListener('resize', updateInfoPosition)
  if (props.src) loadImage(props.src)
})

onBeforeUnmount(() => {
  imageVersion++
  clearGaps()
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

/* 立绘（900×1600 竖图）画框拉高：普通横版画幅里竖图 contain 后只占中间一小条，观感像被压缩 */
.img-editor.is-portrait .ie-frame {
  height: min(78vh, 900px);
  max-height: 86vh;
}

.ie-frame {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  max-height: 72vh;
  border-radius: 12px;
  overflow: hidden;
  background: #e8e0cb;
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
    linear-gradient(45deg, #d4c7a7 25%, transparent 25%),
    linear-gradient(-45deg, #d4c7a7 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #d4c7a7 75%),
    linear-gradient(-45deg, transparent 75%, #d4c7a7 75%);
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
  /* 预览把像素素材（建筑/道具/地皮/小人）放大到画布尺寸：这里必须用最近邻，
     否则浏览器平滑插值会把本来就小的像素贴图糊成一团（ctx.imageSmoothingEnabled 管不到 CSS 缩放） */
  image-rendering: pixelated;
  transform-origin: 0 0;
  /* 不要加 will-change: transform：常驻合成层在画框高度变化（开合自动抠白面板）后
     会按旧倍率光栅化，立绘会被放大发糊，直到多次重绘才恢复 */
}
/* 立绘是 900×1600 插画，不是像素画，保持平滑缩放 */
.img-editor.is-portrait .ie-canvas { image-rendering: auto; }

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
.ie-gaps { padding: 10px 0; border-block: 1px solid var(--border); color: var(--text-primary); font-size: 12px; }
.ie-gap-heading { display: flex; align-items: center; gap: 8px; }
.ie-gap-heading label { font-weight: 700; white-space: nowrap; }
.ie-gap-heading strong { display: inline-block; min-width: 3ch; color: var(--accent-hover); font-variant-numeric: tabular-nums; }
.ie-gap-heading > span { flex: 1; color: var(--text-secondary); text-align: right; }
.ie-gap-slider {
  --thumb-size: 24px;
  --fill-position: calc(var(--thumb-size) / 2 + (100% - var(--thumb-size)) * var(--fill, .35));
  display: block;
  width: 100%;
  height: 32px;
  margin: 6px 0 6px;
  padding: 0;
  border: 0;
  appearance: none;
  border-radius: 999px;
  background: transparent;
  box-shadow: none;
  cursor: pointer;
  touch-action: pan-y;
}
.ie-gap-slider:focus { box-shadow: none; }
.ie-gap-slider:focus-visible { outline: 2px solid var(--accent); outline-offset: 5px; }
.ie-gap-slider:disabled { cursor: not-allowed; opacity: .55; }
.ie-gap-slider::-webkit-slider-runnable-track {
  height: 8px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent) var(--fill-position), var(--border) var(--fill-position));
}
.ie-gap-slider::-moz-range-track {
  height: 8px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent) var(--fill-position), var(--border) var(--fill-position));
}
.ie-gap-slider::-webkit-slider-thumb {
  appearance: none;
  box-sizing: border-box;
  width: var(--thumb-size);
  height: var(--thumb-size);
  margin-top: -8px;
  border-radius: 50%;
  background: var(--bg-secondary);
  border: 3px solid var(--accent);
  box-shadow: var(--shadow-sm);
  cursor: grab;
}
.ie-gap-slider::-moz-range-thumb {
  box-sizing: border-box;
  width: var(--thumb-size);
  height: var(--thumb-size);
  border-radius: 50%;
  background: var(--bg-secondary);
  border: 3px solid var(--accent);
  box-shadow: var(--shadow-sm);
  cursor: grab;
}
.ie-gap-slider:active::-webkit-slider-thumb { cursor: grabbing; }
.ie-gap-slider:active::-moz-range-thumb { cursor: grabbing; }
.ie-gap-scale { display: flex; justify-content: space-between; color: var(--text-secondary); font-size: 10px; }
.ie-gap-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; margin-top: 8px; }
.ie-gap-help { flex: 1 1 220px; margin: 0; color: var(--text-secondary); font-size: 11px; line-height: 1.7; }
.ie-gap-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 4px;
  vertical-align: -2px;
  border: 1px solid var(--cel-outline);
  border-radius: 3px;
  background: repeating-linear-gradient(135deg, var(--fun-pink) 0 3px, var(--on-accent) 3px 4px);
}
.ie-gap-error { color: var(--danger); margin: 8px 0; }
.img-editor.is-checking .ie-frame { min-height: 200px; height: min(55vh, 680px); max-height: 60vh; }
@media (max-width: 600px) {
  .img-editor.is-checking .ie-frame { min-height: 180px; height: 44vh; }
  .ie-gap-heading { gap: 4px; }
}
.ie-hint { font-size: 10px; color: var(--text-secondary); }
.ie-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
.ie-buttons > :last-child { margin-left: auto; }

/* chip 按钮的行内图标：跟字色走、不参与压缩 */
.ie-icon { display: inline-flex; flex-shrink: 0; }
.ie-icon svg { display: block; width: 13px; height: 13px; }

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
