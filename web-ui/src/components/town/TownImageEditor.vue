<template>
  <div class="img-editor">
    <!-- 画布区：棋盘格透明底 + 可拖动图片 + 点击颜色抠除连通区域 -->
    <div
      ref="frameEl"
      class="ie-frame"
      :class="{ 'is-grabbing': dragging }"
      @pointerdown.prevent="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <div class="ie-checker"></div>
      <canvas ref="canvasEl" class="ie-canvas"></canvas>
      <div v-if="!loaded" class="ie-loading">{{ loadingText || '加载中…' }}</div>
    </div>

    <div class="ie-toolbar">
      <div class="ie-hint">{{ cropHint }}</div>
      <div class="ie-buttons">
        <linshe-button variant="chip" size="sm" :active="eraseMode" @click="eraseMode = !eraseMode">
          {{ eraseMode ? '🪄 抠白中' : '🪄 抠去多余白色' }}
        </linshe-button>

        <linshe-button v-if="cropMode && !eraseMode" variant="primary" size="sm" :loading="cropping" @click="confirmCrop">确认裁剪</linshe-button>
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
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as api from '../../api/index.js'
import LinsheButton from '../ui/LinsheButton.vue'

const props = defineProps({
  src: { type: String, required: true },
  assetId: { type: Number, required: true },
  hint: { type: String, default: '' },
  loadingText: { type: String, default: '' },
  /** 编辑画布的显示高度 */
  fitHeight: { type: [Number, String], default: 360 },
  /** 截取框模式：放大查看，拖动/缩放截取框划定最终成图范围 */
  cropMode: { type: Boolean, default: false },
  /** 截取框默认占画面比例 */
  cropScale: { type: Number, default: 0.72 },
})
const emit = defineEmits(['saved', 'cropped'])

const frameEl = ref(null)
const canvasEl = ref(null)
const loaded = ref(false)
const dragging = ref(false)
const eraseMode = ref(false)
const saving = ref(false)
const dirty = ref(false)
const savedTip = ref('')

let img = null          // 当前编辑中的 ImageData 源（HTMLImageElement）
let offX = 0            // 图片在 frame 内的偏移
let offY = 0
let downPt = null
let ctx = null

const ERASE_TOLERANCE = 42

// ── 截取框（原图像素坐标，绘制时换算到画布）──
const cropRect = ref(null) // { x, y, w, h }
const cropping = ref(false)
let cropDrag = null        // { mode: 'move'|'resize', dx, dy }

function displayScale() {
  if (!img) return { x: 1, y: 1 }
  return {
    x: (img._drawW || img.width) / img.width,
    y: (img._drawH || img.height) / img.height,
  }
}

function sourcePoint(px, py) {
  const scale = displayScale()
  return { x: (px - offX) / scale.x, y: (py - offY) / scale.y }
}

function cropDisplayRect() {
  const scale = displayScale()
  const r = cropRect.value
  return {
    x: offX + r.x * scale.x,
    y: offY + r.y * scale.y,
    w: r.w * scale.x,
    h: r.h * scale.y,
  }
}

const cropHint = computed(() => {
  if (eraseMode.value) return props.hint || '点击要去除的白色或底色 · 拖动调整图片位置'
  if (props.cropMode) return '拖动移动截取框 · 拖右下角手柄调大小 · 框内即最终成图范围'
  return props.hint || '开启抠去多余白色后，点击要移除的白色或底色'
})

function draw() {
  if (!ctx || !img) return
  const frame = frameEl.value
  ctx.clearRect(0, 0, frame.clientWidth, frame.clientHeight)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, offX, offY, img._drawW || img.width, img._drawH || img.height)

  if (props.cropMode && cropRect.value && !eraseMode.value) {
    const r = cropDisplayRect()
    // 框外压暗
    ctx.fillStyle = 'rgba(20, 14, 10, 0.45)'
    ctx.beginPath()
    ctx.rect(0, 0, frame.clientWidth, frame.clientHeight)
    ctx.rect(r.x, r.y, r.w, r.h)
    ctx.fill('evenodd')
    // 框边
    ctx.strokeStyle = '#e07b6c'
    ctx.lineWidth = 2
    ctx.strokeRect(r.x, r.y, r.w, r.h)
    // 三分线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.lineWidth = 1
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath()
      ctx.moveTo(r.x + (r.w * i) / 3, r.y)
      ctx.lineTo(r.x + (r.w * i) / 3, r.y + r.h)
      ctx.moveTo(r.x, r.y + (r.h * i) / 3)
      ctx.lineTo(r.x + r.w, r.y + (r.h * i) / 3)
      ctx.stroke()
    }
    // 右下角手柄
    ctx.fillStyle = '#e07b6c'
    ctx.fillRect(r.x + r.w - 10, r.y + r.h - 10, 12, 12)
    ctx.strokeStyle = '#fff'
    ctx.strokeRect(r.x + r.w - 10, r.y + r.h - 10, 12, 12)
  }
}

async function loadImage(src) {
  loaded.value = false
  dirty.value = false
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

let lastFrameW = 0
function sizeCanvas() {
  const frame = frameEl.value
  const canvas = canvasEl.value
  if (!frame || !canvas || !img) return
  const fit = Number(props.fitHeight) || 360
  const w = Math.max(80, frame.clientWidth)
  const h = Math.max(120, Math.min(fit + 40, fit + 40))
  canvas.width = w
  canvas.height = h
  frame.style.height = `${h}px`
  ctx = canvas.getContext('2d', { willReadFrequently: true })
  const scale = Math.min((canvas.width - 24) / img.width, (canvas.height - 12) / img.height, 1.5)
  img._drawW = img.width * scale
  img._drawH = img.height * scale
  offX = (canvas.width - img._drawW) / 2
  offY = canvas.height - img._drawH - 4
  lastFrameW = w
}

function onDown(e) {
  const rect = canvasEl.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  if (eraseMode.value) {
    eraseColorAt(x, y)
    return
  }
  if (props.cropMode && cropRect.value) {
    const dr = cropDisplayRect()
    const point = sourcePoint(x, y)
    // 右下角手柄 → 缩放
    if (x >= dr.x + dr.w - 14 && x <= dr.x + dr.w + 4 && y >= dr.y + dr.h - 14 && y <= dr.y + dr.h + 4) {
      cropDrag = { mode: 'resize' }
      canvasEl.value.setPointerCapture?.(e.pointerId)
      return
    }
    // 框内 → 移动
    if (x >= dr.x && x <= dr.x + dr.w && y >= dr.y && y <= dr.y + dr.h) {
      cropDrag = { mode: 'move', dx: point.x - cropRect.value.x, dy: point.y - cropRect.value.y }
      canvasEl.value.setPointerCapture?.(e.pointerId)
    }
    return
  }
  // 命中图片范围内才开始拖动
  if (x >= offX && x <= offX + img._drawW && y >= offY && y <= offY + img._drawH) {
    dragging.value = true
    downPt = { x, y, offX, offY }
    canvasEl.value.setPointerCapture?.(e.pointerId)
  }
}

function onMove(e) {
  if (!eraseMode.value && props.cropMode && cropDrag && cropRect.value) {
    const rect = canvasEl.value.getBoundingClientRect()
    const point = sourcePoint(e.clientX - rect.left, e.clientY - rect.top)
    const r = cropRect.value
    if (cropDrag.mode === 'move') {
      r.x = Math.max(0, Math.min(img.width - r.w, point.x - cropDrag.dx))
      r.y = Math.max(0, Math.min(img.height - r.h, point.y - cropDrag.dy))
    } else {
      r.w = Math.max(8, Math.min(img.width - r.x, point.x - r.x))
      r.h = Math.max(8, Math.min(img.height - r.y, point.y - r.y))
    }
    draw()
    return
  }
  if (!dragging.value) return
  const rect = canvasEl.value.getBoundingClientRect()
  offX = downPt.offX + (e.clientX - rect.left - downPt.x)
  offY = downPt.offY + (e.clientY - rect.top - downPt.y)
  draw()
}

function onUp() {
  cropDrag = null
  dragging.value = false
}

/** 点击颜色区域：以点击点颜色为种子，容差洪泛 → 透明 */
function eraseColorAt(px, py) {
  // 把画布坐标换算回原图像素
  const ix = Math.floor((px - offX) / (img._drawW / img.width))
  const iy = Math.floor((py - offY) / (img._drawH / img.height))
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

  // 编辑结果作为新的绘制源（保持 drawW/drawH）
  const out = new Image()
  out.onload = () => {
    out._drawW = img._drawW
    out._drawH = img._drawH
    img = out
    dirty.value = true
    draw()
  }
  out.src = work.toDataURL('image/png')
}

/** 初始化截取框：直接基于原图尺寸居中，显示层只做等比换算 */
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
    // 抠白后先保存底图，避免裁剪仍使用服务器上的旧图
    if (dirty.value) await save()
    await api.cropTownAsset(props.assetId, { x: nx, y: ny, w: nw, h: nh })
    // 用新图刷新本地（缓存穿透）
    await loadImage(`${props.src.split('?')[0]}?v=${Date.now()}`)
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
    emit('saved')
    setTimeout(() => { savedTip.value = '' }, 1600)
  } catch (err) {
    savedTip.value = '保存失败：' + (err?.message || '')
    setTimeout(() => { savedTip.value = '' }, 2200)
  } finally {
    saving.value = false
  }
}

/** 合成导出：按原图分辨率导出当前编辑结果（drawW/drawH 等比还原） */
function compositeFull() {
  // 编辑只是加透明区域，必须保留原图分辨率；否则先抠白再裁剪时，原图坐标会落到缩小后的另一块区域。
  const out = document.createElement('canvas')
  out.width = img.width
  out.height = img.height
  const c = out.getContext('2d')
  c.imageSmoothingEnabled = false
  c.drawImage(img, 0, 0, img.width, img.height)
  return out
}

watch(() => props.src, (v) => { if (v) loadImage(v) })

let resizeObs = null

onMounted(() => {
  if (props.src) loadImage(props.src)
  resizeObs = new ResizeObserver(() => {
    const frame = frameEl.value
    if (!frame || !img) return
    if (Math.abs(frame.clientWidth - lastFrameW) < 2) return
    sizeCanvas()
    draw()
  })
  if (frameEl.value) resizeObs.observe(frameEl.value)
})

onBeforeUnmount(() => {
  dragging.value = false
  resizeObs?.disconnect()
})

</script>

<style scoped>
.img-editor { display: flex; flex-direction: column; gap: 8px; }

.ie-frame {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  background: #efe9de;
  min-height: 160px;
  touch-action: none;
  cursor: grab;
}

.ie-frame.is-grabbing { cursor: grabbing; }

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

.ie-canvas {
  position: relative;
  width: 100%;
  display: block;
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
