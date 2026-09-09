<template>
  <Teleport to="body">
    <Transition name="share-fade">
      <div
        v-if="visible"
        class="share-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="分享朋友圈"
        @click.self="close"
        @keydown.escape="close"
      >
        <div ref="panelRef" class="share-panel" tabindex="-1">
          <div ref="previewRef" class="share-preview" @click.self="close">
            <!-- 生成中骨架 -->
            <div v-if="rendering" class="share-skeleton" aria-hidden="true">
              <span class="share-skeleton-hint">正在生成分享图…</span>
            </div>
            <template v-else-if="previewUrl">
              <!-- 海报预览（1080×1920 竖版）：此时只是草稿，照片可在下方编辑层里调整 -->
              <img
                ref="posterRef"
                :src="previewUrl"
                class="share-poster"
                draggable="false"
                alt="朋友圈分享图预览"
                @load="onPosterLoad"
                @contextmenu.prevent
              />
              <!-- 主图编辑层：拖动改位置 / 滚轮·双指改比例，确认后点下方按钮才真正出图 -->
              <canvas
                v-if="heroReady"
                ref="heroCanvasRef"
                class="share-hero-overlay"
                :class="{ 'is-grabbing': heroGestureActive }"
                aria-label="拖动调整照片位置，滚轮或双指缩放"
                @pointerdown="onHeroPointerDown"
                @pointermove="onHeroPointerMove"
                @pointerup="onHeroPointerUp"
                @pointercancel="onHeroPointerUp"
                @wheel.stop.prevent="onHeroWheel"
                @dblclick.stop="resetHeroAdjust"
                @contextmenu.prevent
              ></canvas>
              <div v-if="heroReady" class="share-hero-hint" :class="{ 'is-hidden': hintHidden }">
                <span class="share-hero-hint-text">拖动照片调整位置 · 滚轮 / 双指缩放</span>
                <linshe-button
                  variant="ghost"
                  size="sm"
                  :disabled="!heroAdjusted"
                  @click="resetHeroAdjust"
                >复原</linshe-button>
              </div>
            </template>
          </div>

          <!-- 版式切换 -->
          <div class="share-style-bar" role="radiogroup" aria-label="分享图版式">
            <span class="share-style-label">版式</span>
            <linshe-button
              v-for="s in styles"
              :key="s.id"
              variant="chip"
              size="md"
              :active="activeStyle === s.id"
              :disabled="rendering"
              @click="switchStyle(s.id)"
            >{{ s.label }}</linshe-button>
          </div>

          <footer class="share-panel-actions">
            <linshe-button
              class="share-action"
              variant="primary"
              size="lg"
              block
              :disabled="rendering"
              :loading="copying"
              @click="copyPoster"
            >
              <template v-if="!copying && !copied">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>复制图片</span>
              </template>
              <template v-else-if="!copying">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>已复制</span>
              </template>
              <template v-else>
                <span>生成中</span>
              </template>
            </linshe-button>

            <linshe-button
              class="share-action"
              variant="secondary"
              size="lg"
              block
              :disabled="rendering"
              :loading="downloading"
              @click="downloadPoster"
            >
              <template v-if="!downloading && !downloaded">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>下载</span>
              </template>
              <template v-else-if="!downloading">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>已下载</span>
              </template>
              <template v-else>
                <span>生成中</span>
              </template>
            </linshe-button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick, inject } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import {
  renderMomentShareCard,
  MOMENT_SHARE_STYLES,
  computeHeroInitialAdjust,
  getHeroOverlayBounds,
  paintHeroOverlay,
} from '../utils/momentShareRenderer.js'

const toastFn = inject('toast', null)

const props = defineProps({
  post: { type: Object, required: true },
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const styles = MOMENT_SHARE_STYLES
const panelRef = ref(null)
const rendering = ref(false)
const copying = ref(false)
const downloading = ref(false)
const copied = ref(false)
const downloaded = ref(false)
const activeStyle = ref('auto')
const previewUrl = ref('')
// 首渲命中的实际版式 / 胶片布局：烘焙与出图时回传，避免 auto 加权重抽、胶片 A/B/C 重摇
const resolvedStyleId = ref('')
const resolvedFilmLayout = ref(null)
let previewBlob = null
let renderSeq = 0
let renderWidth = 1080

function revokePreview() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
  previewBlob = null
}

// ── 主图编辑：海报中间那张照片的位置 / 比例 ──
// 变换以「框占比」表达：scale 相对 cover 基准（1 = 恰好铺满照片框），offset 为相对框
// 宽高的中心偏移占比。编辑层画布与最终出图共用渲染器的 drawHeroAdjusted 路径，所见即
// 所得；初始值由 computeHeroInitialAdjust 复刻智能裁剪的默认效果，不动照片时出图与
// 旧的直接渲染逐像素一致。
const previewRef = ref(null)
const posterRef = ref(null)
const heroInfo = ref(null)
const heroCanvasRef = ref(null)
const heroAdjust = reactive({ scale: 1, offsetX: 0, offsetY: 0 })
const heroInitialAdjust = reactive({ scale: 1, offsetX: 0, offsetY: 0 })
const heroLimits = reactive({ min: 1, max: 4 })
const heroAdjustDirty = ref(false)
const heroGestureActive = ref(false)
const heroViewScale = ref(0) // 显示像素 / 画布基准像素
// 操作提示：显示 2 秒后渐出，首次编辑手势立即渐出，切换版式时重新出现
const hintHidden = ref(false)
const heroPointers = new Map()
let heroGesture = null
let hintTimer = 0
let bakeTimer = 0
let syncRaf = 0
let paintRaf = 0

const heroReady = computed(() => !!(previewUrl.value && heroInfo.value?.img))
const heroAdjusted = computed(() =>
  Math.abs(heroAdjust.scale - heroInitialAdjust.scale) > 1e-3 ||
  Math.abs(heroAdjust.offsetX - heroInitialAdjust.offsetX) > 1e-3 ||
  Math.abs(heroAdjust.offsetY - heroInitialAdjust.offsetY) > 1e-3
)

function clampValue(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

function sameAdjust(a, b) {
  return Math.abs(a.scale - b.scale) < 1e-4 &&
    Math.abs(a.offsetX - b.offsetX) < 1e-4 &&
    Math.abs(a.offsetY - b.offsetY) < 1e-4
}

/** 当前变换下主图的实际绘制尺寸与中心（照片框局部坐标） */
function heroMetrics(scale) {
  const hero = heroInfo.value
  const iw = hero.img.naturalWidth, ih = hero.img.naturalHeight
  const fw = hero.fw, fh = hero.fh
  const base = Math.max(fw / iw, fh / ih)
  const s = base * scale
  return {
    fw, fh,
    cx: hero.fx + fw / 2, cy: hero.fy + fh / 2,
    dw: iw * s, dh: ih * s,
  }
}

/** 偏移夹紧：scale ≥ 1 时图片不可拖出框缘；scale < 1 时最多滑到框缘贴合 */
function clampHeroAdjust() {
  const hero = heroInfo.value
  if (!hero?.img) return
  heroAdjust.scale = clampValue(heroAdjust.scale, heroLimits.min, heroLimits.max)
  const m = heroMetrics(heroAdjust.scale)
  const limX = Math.abs(m.dw - m.fw) / 2 / m.fw
  const limY = Math.abs(m.dh - m.fh) / 2 / m.fh
  heroAdjust.offsetX = clampValue(heroAdjust.offsetX, -limX, limX)
  heroAdjust.offsetY = clampValue(heroAdjust.offsetY, -limY, limY)
}

/** 客户端坐标 → 照片框局部坐标（逆旋转；普通版式 rotate=0 时即画布坐标） */
function heroLocalFromClient(clientX, clientY) {
  const hero = heroInfo.value
  const cv = heroCanvasRef.value
  if (!hero || !cv) return { x: 0, y: 0 }
  const b = getHeroOverlayBounds(hero)
  const rect = cv.getBoundingClientRect()
  const k = rect.width / b.w
  const x = (clientX - rect.left) / k + b.x
  const y = (clientY - rect.top) / k + b.y
  const cos = Math.cos(-hero.rotate), sin = Math.sin(-hero.rotate)
  const dx = x - hero.pivotX, dy = y - hero.pivotY
  return { x: hero.pivotX + dx * cos - dy * sin, y: hero.pivotY + dx * sin + dy * cos }
}

function onHeroPointerDown(e) {
  if (rendering.value || !heroReady.value || e.button !== 0) return
  e.preventDefault() // 抑制触摸长按 / 选择行为，保持面板焦点
  hideHeroHint()
  heroPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  try { heroCanvasRef.value?.setPointerCapture(e.pointerId) } catch { /* 触摸指针有隐式捕获，失败不影响 */ }
  if (heroPointers.size === 1) {
    heroGesture = {
      mode: 'pan',
      baseOffsetX: heroAdjust.offsetX,
      baseOffsetY: heroAdjust.offsetY,
      startX: e.clientX,
      startY: e.clientY,
    }
  } else if (heroPointers.size === 2) {
    const [p1, p2] = [...heroPointers.values()]
    const l1 = heroLocalFromClient(p1.x, p1.y), l2 = heroLocalFromClient(p2.x, p2.y)
    const mid = { x: (l1.x + l2.x) / 2, y: (l1.y + l2.y) / 2 }
    const m = heroMetrics(heroAdjust.scale)
    heroGesture = {
      mode: 'pinch',
      baseScale: heroAdjust.scale,
      dist: Math.hypot(l1.x - l2.x, l1.y - l2.y) || 1,
      // 捏合起点两指中心按住的图片内容点（主图归一化坐标）
      rx: (mid.x - (m.cx + heroAdjust.offsetX * m.fw - m.dw / 2)) / m.dw,
      ry: (mid.y - (m.cy + heroAdjust.offsetY * m.fh - m.dh / 2)) / m.dh,
    }
  }
  heroGestureActive.value = true
}

function onHeroPointerMove(e) {
  if (!heroGesture || !heroPointers.has(e.pointerId)) return
  heroPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  const hero = heroInfo.value
  if (!hero?.img) return
  if (heroGesture.mode === 'pan') {
    const k = heroViewScale.value || 1
    const dx = (e.clientX - heroGesture.startX) / k
    const dy = (e.clientY - heroGesture.startY) / k
    const cos = Math.cos(-hero.rotate), sin = Math.sin(-hero.rotate)
    heroAdjust.offsetX = heroGesture.baseOffsetX + (dx * cos - dy * sin) / hero.fw
    heroAdjust.offsetY = heroGesture.baseOffsetY + (dx * sin + dy * cos) / hero.fh
  } else if (heroPointers.size >= 2) {
    const [p1, p2] = [...heroPointers.values()]
    const l1 = heroLocalFromClient(p1.x, p1.y), l2 = heroLocalFromClient(p2.x, p2.y)
    const dist = Math.hypot(l1.x - l2.x, l1.y - l2.y) || 1
    const scale = clampValue(heroGesture.baseScale * dist / heroGesture.dist, heroLimits.min, heroLimits.max)
    const m = heroMetrics(scale)
    const mid = { x: (l1.x + l2.x) / 2, y: (l1.y + l2.y) / 2 }
    heroAdjust.scale = scale
    heroAdjust.offsetX = (mid.x - (heroGesture.rx - 0.5) * m.dw - m.cx) / m.fw
    heroAdjust.offsetY = (mid.y - (heroGesture.ry - 0.5) * m.dh - m.cy) / m.fh
  }
  clampHeroAdjust()
}

function onHeroPointerUp(e) {
  if (!heroPointers.delete(e.pointerId)) return
  if (heroPointers.size === 1 && heroGesture?.mode === 'pinch') {
    // 双指抬起一根：以剩余手指为基准无缝切换回单指拖动
    const [p] = [...heroPointers.values()]
    heroGesture = {
      mode: 'pan',
      baseOffsetX: heroAdjust.offsetX,
      baseOffsetY: heroAdjust.offsetY,
      startX: p.x,
      startY: p.y,
    }
    return
  }
  if (heroPointers.size > 0) return
  heroGesture = null
  heroGestureActive.value = false
  clampHeroAdjust()
  scheduleBake()
}

function onHeroWheel(e) {
  if (rendering.value || !heroReady.value) return
  const hero = heroInfo.value
  if (!hero?.img) return
  hideHeroHint()
  const pt = heroLocalFromClient(e.clientX, e.clientY)
  // 触摸板捏合（ctrl+wheel）灵敏度高，用更大的系数
  const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
  const m0 = heroMetrics(heroAdjust.scale)
  const rx = (pt.x - (m0.cx + heroAdjust.offsetX * m0.fw - m0.dw / 2)) / m0.dw
  const ry = (pt.y - (m0.cy + heroAdjust.offsetY * m0.fh - m0.dh / 2)) / m0.dh
  const next = clampValue(heroAdjust.scale * factor, heroLimits.min, heroLimits.max)
  if (next !== heroAdjust.scale) {
    const m1 = heroMetrics(next)
    heroAdjust.scale = next
    heroAdjust.offsetX = (pt.x - (rx - 0.5) * m1.dw - m1.cx) / m1.fw
    heroAdjust.offsetY = (pt.y - (ry - 0.5) * m1.dh - m1.cy) / m1.fh
  }
  if (e.deltaX && !e.ctrlKey) {
    // 触摸板双指横扫平移
    const k = heroViewScale.value || 1
    const dx = -e.deltaX / k
    const cos = Math.cos(-hero.rotate), sin = Math.sin(-hero.rotate)
    heroAdjust.offsetX += dx * cos / hero.fw
    heroAdjust.offsetY += dx * sin / hero.fh
  }
  clampHeroAdjust()
  scheduleBake()
}

function resetHeroAdjust() {
  if (!heroReady.value) return
  if (!heroAdjusted.value && !heroAdjustDirty.value) return
  heroAdjust.scale = heroInitialAdjust.scale
  heroAdjust.offsetX = heroInitialAdjust.offsetX
  heroAdjust.offsetY = heroInitialAdjust.offsetY
  scheduleBake()
}

/** 编辑层重绘（仅内容），跟随变换变化 */
function paintHero() {
  const cv = heroCanvasRef.value
  const hero = heroInfo.value
  if (!cv || !hero?.img || !(heroViewScale.value > 0)) return
  const dpr = Math.min(3, window.devicePixelRatio || 1)
  paintHeroOverlay(cv, hero, { ...heroAdjust }, heroViewScale.value * dpr)
}

function scheduleHeroPaint() {
  if (paintRaf) return
  paintRaf = requestAnimationFrame(() => { paintRaf = 0; paintHero() })
}

/** 编辑层对位：与海报 img 的显示位置、照片框几何对齐后重绘 */
function syncHeroOverlay() {
  const hero = heroInfo.value
  const img = posterRef.value
  const container = previewRef.value
  const cv = heroCanvasRef.value
  if (!hero?.img || !img || !container || !cv) return
  const imgRect = img.getBoundingClientRect()
  const baseRect = container.getBoundingClientRect()
  const k = imgRect.width / renderWidth
  if (!(k > 0)) return
  heroViewScale.value = k
  const b = getHeroOverlayBounds(hero)
  const style = cv.style
  style.left = `${imgRect.left - baseRect.left + b.x * k}px`
  style.top = `${imgRect.top - baseRect.top + b.y * k}px`
  style.width = `${b.w * k}px`
  style.height = `${b.h * k}px`
  paintHero()
}

function scheduleSyncHero() {
  if (syncRaf) return
  syncRaf = requestAnimationFrame(() => { syncRaf = 0; syncHeroOverlay() })
}

/** 手势结束 / 滚轮停止后把当前变换烘焙进海报预览，补齐编辑层画不出的细节（暗角、压字、颗粒等） */
function scheduleBake() {
  heroAdjustDirty.value = true
  clearTimeout(bakeTimer)
  bakeTimer = setTimeout(() => {
    bakeTimer = 0
    if (heroAdjustDirty.value && previewUrl.value && !rendering.value) {
      renderPoster(activeStyle.value, { bake: true })
    }
  }, 240)
}

function showHeroHint() {
  clearTimeout(hintTimer)
  hintHidden.value = false
  hintTimer = setTimeout(() => { hintHidden.value = true }, 2000)
}

function hideHeroHint() {
  clearTimeout(hintTimer)
  hintHidden.value = true
}

watch(heroAdjust, () => scheduleHeroPaint())

/** 渲染当前版式的海报并转成可预览/可导出的 blob；bake = 携带主图变换的静默重烘焙 */
async function renderPoster(styleId, { bake = false } = {}) {
  const seq = ++renderSeq
  const snapshot = { ...heroAdjust }
  if (bake) {
    clearTimeout(bakeTimer)
    bakeTimer = 0
  } else {
    rendering.value = true
  }
  try {
    const { canvas, styleId: resolved, hero, filmLayout } = await renderMomentShareCard(props.post, {
      styleId: bake
        ? (resolvedStyleId.value || undefined)
        : (styleId === 'auto' ? undefined : styleId),
      featureLayout: bake ? resolvedFilmLayout.value : undefined,
      imageAdjust: bake ? { ...snapshot } : undefined,
    })
    if (seq !== renderSeq) return // 已切换到其它版式，丢弃过期结果
    resolvedStyleId.value = resolved
    resolvedFilmLayout.value = filmLayout
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
    })
    revokePreview()
    previewBlob = blob
    previewUrl.value = URL.createObjectURL(blob)
    renderWidth = canvas.width
    heroInfo.value = hero
    if (bake) {
      // 烘焙期间用户可能又动了照片：有新变更则保持脏标记，等待下一次烘焙
      heroAdjustDirty.value = !sameAdjust(snapshot, heroAdjust)
    } else {
      // 首渲 / 切换版式：变换复位到「复刻智能裁剪」的初始值，再交给用户调整
      const init = computeHeroInitialAdjust(hero)
      heroLimits.min = init.minScale
      heroLimits.max = init.maxScale
      heroInitialAdjust.scale = init.scale
      heroInitialAdjust.offsetX = init.offsetX
      heroInitialAdjust.offsetY = init.offsetY
      heroAdjust.scale = init.scale
      heroAdjust.offsetX = init.offsetX
      heroAdjust.offsetY = init.offsetY
      heroAdjustDirty.value = false
    }
    await nextTick()
    scheduleSyncHero()
    if (!bake) showHeroHint()
  } catch (err) {
    console.error('[ShareCard] render poster failed:', err)
    if (seq === renderSeq) toastFn?.('分享图生成失败', 'error')
  } finally {
    if (seq === renderSeq) rendering.value = false
  }
}

async function switchStyle(styleId) {
  if (rendering.value || activeStyle.value === styleId) return
  clearTimeout(bakeTimer)
  bakeTimer = 0
  activeStyle.value = styleId
  await renderPoster(styleId)
}

/** 复制 / 下载前确保预览已携带最新的主图变换 */
async function ensureFreshPoster() {
  clearTimeout(bakeTimer)
  bakeTimer = 0
  if (previewBlob && !heroAdjustDirty.value) return
  await renderPoster(activeStyle.value, { bake: !!previewBlob })
}

async function savePoster() {
  await ensureFreshPoster()
  if (!previewBlob) throw new Error('poster blob is not ready')
  const url = URL.createObjectURL(previewBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `moment_${props.post.id}.png`
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadPoster() {
  if (downloading.value || copying.value) return
  downloading.value = true
  copied.value = false
  downloaded.value = false
  try {
    await savePoster()
    downloaded.value = true
    setTimeout(() => { downloaded.value = false }, 2000)
  } catch (err) {
    console.error('[ShareCard] download poster failed:', err)
    toastFn?.('分享图下载失败', 'error')
  } finally {
    downloading.value = false
  }
}

async function copyPoster() {
  if (copying.value || downloading.value) return
  copying.value = true
  copied.value = false
  downloaded.value = false
  try {
    await ensureFreshPoster()
    if (!previewBlob) throw new Error('poster blob is not ready')
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': previewBlob }),
    ])
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch (err) {
    console.error('[ShareCard] copy poster failed:', err)
    // 剪贴板不可用时降级为下载，仍保证能拿到图片
    try {
      await savePoster()
      copied.value = false
      downloaded.value = true
      toastFn?.('复制失败，已保存分享图到下载', 'info')
    } catch (fallbackErr) {
      console.error('[ShareCard] poster fallback failed:', fallbackErr)
      toastFn?.('分享图生成失败', 'error')
    }
  } finally {
    copying.value = false
  }
}

function onPosterLoad() {
  scheduleSyncHero()
}

function focusPanel() {
  requestAnimationFrame(() => panelRef.value?.focus({ preventScroll: true }))
}

function close() {
  emit('close')
}

function onWindowResize() {
  scheduleSyncHero()
}

// 组件以 v-if + visible=true 挂载（MomentsView），挂载即首渲；watch 兜底外部切换 visible
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  if (props.visible && !previewUrl.value && !rendering.value) {
    focusPanel()
    renderPoster(activeStyle.value)
  }
})

watch(() => props.visible, v => {
  if (v) {
    focusPanel()
    activeStyle.value = 'auto'
    renderPoster('auto')
  } else {
    copying.value = false
    downloading.value = false
    copied.value = false
    downloaded.value = false
    resolvedStyleId.value = ''
    resolvedFilmLayout.value = null
    renderSeq++
    rendering.value = false
    clearTimeout(bakeTimer)
    bakeTimer = 0
    clearTimeout(hintTimer)
    hintHidden.value = false
    heroInfo.value = null
    heroAdjustDirty.value = false
    heroPointers.clear()
    heroGesture = null
    heroGestureActive.value = false
    revokePreview()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  clearTimeout(bakeTimer)
  clearTimeout(hintTimer)
  bakeTimer = 0
  if (syncRaf) cancelAnimationFrame(syncRaf)
  if (paintRaf) cancelAnimationFrame(paintRaf)
  renderSeq++
  revokePreview()
})
</script>

<style scoped>
.share-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: hidden;
}

.share-panel {
  width: min(640px, 100%);
  height: min(92dvh, 940px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-secondary) 93%, transparent);
  border: 1px solid rgba(255, 255, 255, 0.58);
  border-radius: 18px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.12);
  outline: none;
}

.share-preview {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px 22px 10px;
  overflow: hidden;
  /* 触摸手势（拖动 / 双指捏合）全部交给照片编辑层处理 */
  touch-action: none;
}

/* 海报本身是 1080×1920，这里只做展示缩放，导出始终是原尺寸 */
.share-poster {
  max-width: 100%;
  max-height: 100%;
  border-radius: 12px;
  box-shadow: 0 10px 34px rgba(60, 42, 30, 0.18);
  user-select: none;
  -webkit-user-drag: none;
  -webkit-touch-callout: none;
}

/* ── 主图编辑层：绝对定位对齐海报上的照片框，位置由 syncHeroOverlay 计算 ── */
.share-hero-overlay {
  position: absolute;
  z-index: 2;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-touch-callout: none;
}

.share-hero-overlay.is-grabbing {
  cursor: grabbing;
}

.share-hero-hint {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px 4px 14px;
  background: rgba(255, 253, 251, 0.92);
  border: 1px solid rgba(224, 216, 207, 0.55);
  border-radius: 999px;
  box-shadow: 0 6px 16px rgba(60, 42, 30, 0.12);
  pointer-events: none;
  white-space: nowrap;
  transition: opacity 0.45s ease, visibility 0.45s ease;
}

.share-hero-hint.is-hidden {
  opacity: 0;
  visibility: hidden;
}

.share-hero-hint > * {
  pointer-events: auto;
}

.share-hero-hint-text {
  font-size: 12px;
  color: var(--text-secondary);
  letter-spacing: 0.04em;
}

.share-skeleton {
  width: min(46dvh, 88%);
  aspect-ratio: 9 / 16;
  max-width: 100%;
  border-radius: 12px;
  background: linear-gradient(100deg, var(--bg-tertiary) 40%, var(--bg-secondary) 50%, var(--bg-tertiary) 60%);
  background-size: 200% 100%;
  animation: shareShimmer 1.2s ease-in-out infinite;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 18px;
}

.share-skeleton-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

@keyframes shareShimmer {
  from { background-position: 120% 0; }
  to { background-position: -80% 0; }
}

/* ── 版式切换：与底部操作栏同级的控制条 ── */
.share-style-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 11px 22px;
  background: rgba(255, 255, 255, 0.38);
  border-top: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
}

.share-style-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
}

/* ── 弹窗操作 ── */
.share-panel-actions {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: 12px;
  padding: 10px 22px calc(16px + env(safe-area-inset-bottom, 0px));
  background: rgba(255, 255, 255, 0.38);
  border-top: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
}

.share-action {
  min-height: 42px;
}

/* ── 动画 ── */
.share-fade-enter-active { transition: opacity 0.25s ease; }
.share-fade-leave-active { transition: opacity 0.2s ease; }
.share-fade-enter-from,
.share-fade-leave-to { opacity: 0; }
.share-fade-enter-active .share-panel {
  animation: cardUp 0.32s cubic-bezier(0.34, 1.3, 0.64, 1);
}

@keyframes cardUp {
  from {
    opacity: 0;
    transform: translateY(22px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .share-fade-enter-active,
  .share-fade-leave-active { transition: opacity 0.15s ease; }
  .share-fade-enter-active .share-panel { animation: none; }
  .share-skeleton { animation: none; }
}

/* ── 移动端 ── */
@media (max-width: 767px) {
  .share-overlay {
    padding: max(14px, env(safe-area-inset-top, 0px)) 12px 12px;
  }

  .share-panel {
    height: 96dvh;
    border-radius: 14px;
  }

  .share-preview {
    padding: 8px 14px 4px;
  }

  .share-poster {
    border-radius: 10px;
  }

  .share-hero-hint {
    bottom: 10px;
    padding: 3px 5px 3px 12px;
  }

  .share-hero-hint-text {
    font-size: 11px;
  }

  .share-skeleton {
    width: min(52dvh, 92%);
  }

  .share-style-bar {
    gap: 8px;
    padding: 8px 12px;
  }

  .share-style-label {
    display: none;
  }

  .share-panel-actions {
    grid-template-columns: 1.2fr 1fr;
    gap: 9px;
    padding: 8px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  }

  .share-action {
    min-height: 40px;
  }
}
</style>
