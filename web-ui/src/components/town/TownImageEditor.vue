<template>
  <div class="img-editor">
    <!-- 画布区：棋盘格透明底 + 可拖动图片（检查脚底是否贴底） + 点击白色继续抠白 -->
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
      <div class="ie-hint">{{ hint || '拖动图片检查脚底是否贴底 · 点击残留白色继续抠白' }}</div>
      <div class="ie-buttons">
        <linshe-button variant="chip" size="sm" :active="eraseMode" @click="eraseMode = !eraseMode">
          {{ eraseMode ? '🖱️ 抠白中' : '🪄 抠白模式' }}
        </linshe-button>
        <linshe-button variant="chip" size="sm" @click="trimBottom">🦶 脚底贴底</linshe-button>
        <linshe-button variant="primary" size="sm" :loading="saving" :disabled="!dirty" @click="save">保存编辑</linshe-button>
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
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as api from '../../api/index.js'
import LinsheButton from '../ui/LinsheButton.vue'

const props = defineProps({
  src: { type: String, required: true },
  assetId: { type: Number, required: true },
  hint: { type: String, default: '' },
  loadingText: { type: String, default: '' },
  /** 立绘类贴底显示；小人贴底即可 */
  fitHeight: { type: [Number, String], default: 360 },
})
const emit = defineEmits(['saved'])

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

const WHITE_TOLERANCE = 42

function draw() {
  if (!ctx || !img) return
  const frame = frameEl.value
  ctx.clearRect(0, 0, frame.clientWidth, frame.clientHeight)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, offX, offY)
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
    deWhiteAt(x, y)
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
  if (!dragging.value) return
  const rect = canvasEl.value.getBoundingClientRect()
  offX = downPt.offX + (e.clientX - rect.left - downPt.x)
  offY = downPt.offY + (e.clientY - rect.top - downPt.y)
  draw()
}

function onUp() {
  dragging.value = false
}

/** 点击白色区域：以点击点为种子的容差洪泛 → 透明（继续抠白） */
function deWhiteAt(px, py) {
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
  // 只处理近白种子（防误点深色区域大面积清除）
  if (target[0] < 200 || target[1] < 200 || target[2] < 200) {
    savedTip.value = '点击的位置不是白色'
    setTimeout(() => { savedTip.value = '' }, 1500)
    return
  }
  const nearWhite = (o) =>
    Math.abs(d[o] - target[0]) <= WHITE_TOLERANCE &&
    Math.abs(d[o + 1] - target[1]) <= WHITE_TOLERANCE &&
    Math.abs(d[o + 2] - target[2]) <= WHITE_TOLERANCE

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
      if (nearWhite(no)) { seen[k] = 1; stack.push(nx, ny) }
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

/** 脚底贴底：裁掉四周透明边后，让脚底正好贴住图片底边（左右上留 4% 呼吸边） */
function trimBottom() {
  const work = document.createElement('canvas')
  work.width = img.width
  work.height = img.height
  work.getContext('2d').drawImage(img, 0, 0)
  const wctx = work.getContext('2d', { willReadFrequently: true })
  const { width, height } = work
  const d = wctx.getImageData(0, 0, width, height).data
  let minY = height, maxY = -1, minX = width, maxX = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3] > 8) {
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
  }
  if (maxY < 0) return
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04)
  const cropW = maxX - minX + 1
  const cropH = maxY - minY + 1
  const out = document.createElement('canvas')
  out.width = cropW + pad * 2
  out.height = cropH + pad // 底部不留边：脚底贴底
  const octx = out.getContext('2d')
  octx.drawImage(work, minX, minY, cropW, cropH, pad, 0, cropW, cropH)
  const outImg = new Image()
  outImg.onload = () => {
    outImg._drawW = out.width
    outImg._drawH = out.height
    img = outImg
    const canvas = canvasEl.value
    offX = (canvas.width - out.width) / 2
    offY = canvas.height - out.height - 4
    dirty.value = true
    draw()
  }
  outImg.src = out.toDataURL('image/png')
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
  const out = document.createElement('canvas')
  out.width = Math.round(img._drawW / (img._drawH / img.height)) || img.width
  out.height = img.height
  const scale = img._drawW / img.width || 1
  out.width = Math.round(img.width * scale)
  out.height = Math.round(img.height * scale)
  const c = out.getContext('2d')
  c.imageSmoothingEnabled = false
  c.drawImage(img, 0, 0, out.width, out.height)
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
