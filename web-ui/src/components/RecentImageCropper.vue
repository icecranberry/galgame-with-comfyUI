<template>
  <linshe-modal :model-value="true" title="从最近图片挑选并截取" wide @update:model-value="$emit('close')">
    <!-- 选图：该角色全部渠道的近期图片 -->
    <div v-if="!pickedSrc" class="ric-gallery">
      <div v-if="loading" class="ric-hint">加载中...</div>
      <div v-else-if="images.length === 0" class="ric-hint">暂无最近的图片</div>
      <img
        v-for="(url, i) in images"
        :key="i"
        :src="url"
        class="ric-thumb"
        :class="{ 'ric-thumb-err': errSet.has(i) }"
        alt=""
        loading="lazy"
        decoding="async"
        @click="pickImage(url, i)"
        @error="markErr(i)"
      />
    </div>

    <!-- 截取：完整展示全图，用户拖拽画出选区 -->
    <div v-else class="ric-crop">
      <div ref="imgBoxEl" class="ric-imgbox">
        <img ref="imgEl" :src="pickedSrc" alt="" draggable="false" @dragstart.prevent @load="onImgLoad" @error="onPickErr" />
        <div
          class="ric-mask"
          @mousedown.prevent="onPointerDown"
          @touchstart.prevent="onTouchStart"
        >
          <div v-if="sel" class="ric-sel" :style="selStyle"></div>
        </div>
      </div>
      <p class="ric-tip">在图上按住拖拽画出要截取的区域；不调整则使用整张图</p>
    </div>

    <template #footer>
      <linshe-button v-if="pickedSrc" variant="ghost" @click="backToPick">← 重新选图</linshe-button>
      <div style="flex:1"></div>
      <linshe-button variant="primary" :disabled="!pickedSrc" @click="confirmCrop">截取部分</linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
// 最近图片挑选 + 全图拖拽截取（修正外观参考图专用，区别于头像固定框裁剪 AvatarCropper）：
// 先选图，然后完整展示全图，用户在图上直接拖拽画选区，选哪块截哪块。
import { ref, computed, nextTick, onUnmounted } from 'vue'
import { getRecentImages } from '../api/index.js'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'

const props = defineProps({
  characterId: { type: [Number, String], default: null },
})

const emit = defineEmits(['close', 'save'])

const images = ref([])
const loading = ref(false)
const errSet = ref(new Set())
const pickedSrc = ref('')
const imgBoxEl = ref(null)
const imgEl = ref(null)
// 选区 { x, y, w, h }，相对图片渲染尺寸；null = 尚未就绪
const sel = ref(null)

async function fetchRecent() {
  if (!props.characterId || loading.value) return
  loading.value = true
  try {
    const res = await getRecentImages(props.characterId)
    images.value = res.images || []
  } catch {
    images.value = []
  } finally {
    loading.value = false
  }
}

fetchRecent()

function markErr(i) {
  const s = new Set(errSet.value)
  s.add(i)
  errSet.value = s
}

function pickImage(url, i) {
  if (errSet.value.has(i)) return
  pickedSrc.value = url
}

function onPickErr() {
  // 图挂了退回选图列表并标记
  errSet.value = new Set([...errSet.value, images.value.indexOf(pickedSrc.value)].filter(i => i >= 0))
  pickedSrc.value = ''
}

// ── 选区拖拽 ──
let dragging = false
let anchor = { x: 0, y: 0 }

function onImgLoad() {
  // 默认全图选中，用户可拖拽改小
  nextTick(resetSelection)
}

function resetSelection() {
  const box = imgBoxEl.value
  if (!box) return
  sel.value = { x: 0, y: 0, w: box.clientWidth, h: box.clientHeight }
}

function pointFrom(e) {
  const box = imgBoxEl.value.getBoundingClientRect()
  const p = e.touches ? e.touches[0] : e
  return {
    x: Math.min(Math.max(p.clientX - box.left, 0), box.width),
    y: Math.min(Math.max(p.clientY - box.top, 0), box.height),
  }
}

function onPointerDown(e) {
  dragging = true
  anchor = pointFrom(e)
  sel.value = { x: anchor.x, y: anchor.y, w: 0, h: 0 }
  window.addEventListener('mousemove', onPointerMove)
  window.addEventListener('mouseup', onPointerUp)
}

function onPointerMove(e) {
  if (!dragging) return
  const p = pointFrom(e)
  sel.value = {
    x: Math.min(anchor.x, p.x),
    y: Math.min(anchor.y, p.y),
    w: Math.abs(p.x - anchor.x),
    h: Math.abs(p.y - anchor.y),
  }
}

function onPointerUp() {
  if (!dragging) return
  dragging = false
  window.removeEventListener('mousemove', onPointerMove)
  window.removeEventListener('mouseup', onPointerUp)
  // 太小的选区视为误触，回退整张图
  if (sel.value && (sel.value.w < 12 || sel.value.h < 12)) resetSelection()
}

// 触屏：手指拖拽画选区（touchmove 挂 window，手指移出图片也不丢）
function onTouchStart(e) {
  dragging = true
  anchor = pointFrom(e)
  sel.value = { x: anchor.x, y: anchor.y, w: 0, h: 0 }
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('touchend', onTouchEnd)
}

function onTouchMove(e) {
  if (!dragging) return
  e.preventDefault()
  onPointerMove(e)
}

function onTouchEnd() {
  onPointerUp()
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onTouchEnd)
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onPointerMove)
  window.removeEventListener('mouseup', onPointerUp)
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onTouchEnd)
})

const selStyle = computed(() => {
  if (!sel.value) return {}
  return {
    left: `${sel.value.x}px`,
    top: `${sel.value.y}px`,
    width: `${sel.value.w}px`,
    height: `${sel.value.h}px`,
  }
})

function backToPick() {
  pickedSrc.value = ''
  sel.value = null
}

// ── 确认：按选区从原图裁剪，长边压到 1024 控制视觉请求体积 ──
function confirmCrop() {
  const img = imgEl.value
  const box = imgBoxEl.value
  if (!img || !box || !sel.value || !sel.value.w || !sel.value.h) return
  const scale = img.naturalWidth / box.clientWidth
  const sx = sel.value.x * scale
  const sy = sel.value.y * scale
  const sw = Math.max(1, sel.value.w * scale)
  const sh = Math.max(1, sel.value.h * scale)
  const outScale = Math.min(1, 1024 / Math.max(sw, sh))
  const w = Math.round(sw * outScale)
  const h = Math.round(sh * outScale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
  emit('save', canvas.toDataURL('image/png'))
}
</script>

<style scoped>
.ric-gallery { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.ric-hint { font-size: 13px; color: var(--text-secondary); text-align: center; padding: 40px 0; grid-column: 1 / -1; }
.ric-thumb {
  width: 100%; aspect-ratio: 1; object-fit: cover;
  border-radius: 8px; cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.15s;
}
.ric-thumb:hover { border-color: var(--accent); }
.ric-thumb-err { opacity: 0.3; cursor: default; }

.ric-crop { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.ric-imgbox { position: relative; display: inline-block; max-width: 100%; line-height: 0; }
.ric-imgbox img {
  display: block;
  max-width: 100%;
  max-height: 56vh;
  width: auto; height: auto;
  border-radius: 8px;
  user-select: none;
  -webkit-user-drag: none;
}
.ric-mask {
  position: absolute; inset: 0;
  cursor: crosshair;
  overflow: hidden;
  border-radius: 8px;
  touch-action: none;
}
.ric-sel {
  position: absolute;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
  border: 1.5px solid rgba(255, 255, 255, 0.9);
  pointer-events: none;
}
.ric-tip { margin: 0; font-size: 12px; color: var(--text-secondary); text-align: center; }
</style>
