<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="viewer-overlay"
      :class="{ 'overlay-compact': compact, 'overlay-leave': leaving }"
      @click.self="requestClose"
    >
      <linshe-button
        variant="icon"
        class="viewer-close"
        :class="{ 'viewer-close-compact': compact }"
        @click="requestClose"
      >&times;</linshe-button>

      <!-- Compact portrait: rotation wrapper keeps paper-bg coordinate system clean -->
      <div v-if="compact" class="paper-rotate-wrap">
        <div
          class="paper-bg"
          ref="paperRef"
          :class="{ 'paper-compact': true, 'paper-no-bg': !letter.paper_path }"
          :style="paperBgStyle"
        >
          <div v-if="letter.portrait_path" ref="portraitRef" class="paper-portrait portrait-compact"
            @pointerdown.prevent="startDrag($event, 'portrait')"
            @wheel.prevent.stop="handleWheel($event, 'portrait')"
            @pointermove="onPinchMove($event, 'portrait')"
          ><img :src="letter.portrait_path" alt="" draggable="false" /></div>

          <div class="paper-text-area text-area-compact">
            <div ref="textRef" class="paper-text handwritten text-compact" :style="handwritingFontStyle" @wheel.passive="onTextScroll">{{ displayText }}</div>
          </div>

          <div v-if="letter.illustration_path" ref="illustrationRef" class="paper-illustration illustration-compact"
            @pointerdown.prevent="startDrag($event, 'illustration')"
            @wheel.prevent.stop="handleWheel($event, 'illustration')"
            @pointermove="onPinchMove($event, 'illustration')"
          ><img :src="letter.illustration_path" alt="" draggable="false" /></div>
        </div>
      </div>

      <!-- Normal mode: no rotation wrapper -->
      <div v-else
        class="paper-bg"
        ref="paperRef"
        :class="{ 'paper-no-bg': !letter.paper_path }"
        :style="paperBgStyle"
      >
        <div v-if="letter.portrait_path" ref="portraitRef" class="paper-portrait"
          @pointerdown.prevent="startDrag($event, 'portrait')"
          @wheel.prevent.stop="handleWheel($event, 'portrait')"
        ><img :src="letter.portrait_path" alt="" draggable="false" /></div>

        <div class="paper-text-area">
          <div ref="textRef" class="paper-text handwritten" :style="handwritingFontStyle" @wheel.passive="onTextScroll">{{ displayText }}</div>
        </div>

        <div v-if="showScrollHint" class="scroll-hint" @click="scrollTextDown">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M14 6v14M8 17l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>

        <div v-if="letter.illustration_path" ref="illustrationRef" class="paper-illustration"
          @pointerdown.prevent="startDrag($event, 'illustration')"
          @wheel.prevent.stop="handleWheel($event, 'illustration')"
        ><img :src="letter.illustration_path" alt="" draggable="false" /></div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { getFontFamily, loadFont, getPageDefaultFontFamily } from '../composables/useHandwritingFont.js'
import LinsheButton from './LinsheButton.vue'

const props = defineProps({
  letter: { type: Object, required: true },
  sourceRect: { type: Object, default: null },
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'delete'])

const displayText = computed(() => {
  if (props.letter.reply_content) return props.letter.reply_content
  return props.letter.content
})

const handwritingFontStyle = computed(() => {
  const fontId = props.letter?.handwriting_font
  if (!fontId) return { fontFamily: getPageDefaultFontFamily() }
  return { fontFamily: getFontFamily(fontId) }
})

const show = ref(false)
const leaving = ref(false)
const paperRef = ref(null)
const textRef = ref(null)
const portraitRef = ref(null)
const illustrationRef = ref(null)
const showScrollHint = ref(false)
const dragState = reactive({
  active: null,
  startX: 0, startY: 0,
  startLeft: 0, startTop: 0,
  pointerId: 0,
  zoom: 1,
  natW: 0, natH: 0,
})
const portraitZoom = ref(1)
const illustrationZoom = ref(1)

// ── Pinch-to-zoom state ──
const pinchState = reactive({
  active: null,           // 'portrait' | 'illustration' | null
  pointerA: null,         // { pointerId, clientX, clientY }
  pointerB: null,
  initialDist: 0,         // distance between fingers at pinch start
  initialZoom: 1,         // zoom level at pinch start
})

const paperBgStyle = computed(() => {
  if (props.letter.paper_path) {
    return { backgroundImage: `url(${props.letter.paper_path})` }
  }
  return {}
})

function computeTranslate(source, target) {
  const dx = source.left - target.left + (source.width - target.width) / 2
  const dy = source.top - target.top + (source.height - target.height) / 2
  const sx = source.width / target.width
  const sy = source.height / target.height
  return { dx, dy, s: Math.min(sx, sy) }
}

function cancelTransitions() {
  if (!paperRef.value) return
  paperRef.value.style.transition = 'none'
  paperRef.value.style.transform = ''
  paperRef.value.style.borderRadius = ''
  paperRef.value.style.opacity = ''
  paperRef.value.style.willChange = 'auto'
}

function startDrag(e, type) {
  if (leaving.value) return
  const el = type === 'portrait' ? portraitRef.value : illustrationRef.value
  if (!el || !paperRef.value) return

  // In compact mode, second finger starts pinch
  if (props.compact && dragState.active === type) {
    pinchState.active = type
    pinchState.pointerA = { pointerId: dragState.pointerId, clientX: dragState.startX, clientY: dragState.startY }
    pinchState.pointerB = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY }
    const dx = pinchState.pointerB.clientX - pinchState.pointerA.clientX
    const dy = pinchState.pointerB.clientY - pinchState.pointerA.clientY
    pinchState.initialDist = Math.sqrt(dx * dx + dy * dy)
    pinchState.initialZoom = type === 'portrait' ? portraitZoom.value : illustrationZoom.value
    return
  }

  // Cleanup any existing pinch
  if (pinchState.active) {
    pinchState.active = null
    pinchState.pointerA = null
    pinchState.pointerB = null
  }

  el.setPointerCapture(e.pointerId)

  const elRect = el.getBoundingClientRect()
  const paperRect = paperRef.value.getBoundingClientRect()
  const zoom = type === 'portrait' ? portraitZoom.value : illustrationZoom.value

  dragState.active = type
  dragState.pointerId = e.pointerId
  dragState.zoom = zoom
  dragState.natW = elRect.width / zoom
  dragState.natH = elRect.height / zoom
  dragState.startX = e.clientX
  dragState.startY = e.clientY
  dragState.startLeft = elRect.left - paperRect.left
  dragState.startTop = elRect.top - paperRect.top

  el.style.left = (dragState.startLeft - dragState.natW * (1 - zoom) / 2) + 'px'
  el.style.top = (dragState.startTop - dragState.natH * (1 - zoom) / 2) + 'px'
  el.style.right = 'auto'
  el.style.transform = (type === 'portrait' && !props.compact) ? `rotate(-3deg) scale(${zoom})` : `scale(${zoom})`

  document.addEventListener('pointermove', onDragMove)
  document.addEventListener('pointerup', onDragEnd)
  document.addEventListener('pointercancel', onDragEnd)
}

function onDragMove(e) {
  if (!dragState.active) return
  const el = dragState.active === 'portrait' ? portraitRef.value : illustrationRef.value
  if (!el || !paperRef.value) return

  const paperRect = paperRef.value.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const zoom = dragState.zoom

  const dx = e.clientX - dragState.startX
  const dy = e.clientY - dragState.startY

  let visLeft = dragState.startLeft + dx
  let visTop = dragState.startTop + dy
  visLeft = Math.max(-elRect.width + 30, Math.min(paperRect.width - 30, visLeft))
  visTop = Math.max(-elRect.height + 30, Math.min(paperRect.height - 30, visTop))

  el.style.left = (visLeft - dragState.natW * (1 - zoom) / 2) + 'px'
  el.style.top = (visTop - dragState.natH * (1 - zoom) / 2) + 'px'
}

function onDragEnd(e) {
  // Clean up pinch if active
  if (pinchState.active && (e.pointerId === pinchState.pointerA?.pointerId || e.pointerId === pinchState.pointerB?.pointerId)) {
    pinchState.active = null
    pinchState.pointerA = null
    pinchState.pointerB = null
  }

  if (!dragState.active) return
  // Don't end drag during pinch
  if (pinchState.active && e.pointerId !== dragState.pointerId) return

  const el = dragState.active === 'portrait' ? portraitRef.value : illustrationRef.value
  if (el) {
    try { el.releasePointerCapture(dragState.pointerId) } catch {}
  }
  dragState.active = null
  pinchState.active = null
  pinchState.pointerA = null
  pinchState.pointerB = null
  document.removeEventListener('pointermove', onDragMove)
  document.removeEventListener('pointerup', onDragEnd)
  document.removeEventListener('pointercancel', onDragEnd)
}

function cleanupDrag() {
  pinchState.active = null
  pinchState.pointerA = null
  pinchState.pointerB = null
  if (!dragState.active) return
  document.removeEventListener('pointermove', onDragMove)
  document.removeEventListener('pointerup', onDragEnd)
  document.removeEventListener('pointercancel', onDragEnd)
  dragState.active = null
}

function handleWheel(e, type) {
  if (dragState.active === type) return
  const zoomRef = type === 'portrait' ? portraitZoom : illustrationZoom
  const delta = e.deltaY < 0 ? 1.1 : 0.9
  zoomRef.value = Math.max(0.3, Math.min(4, zoomRef.value * delta))
  applyZoom(type)
}

function applyZoom(type) {
  const el = type === 'portrait' ? portraitRef.value : illustrationRef.value
  if (!el) return
  const zoom = type === 'portrait' ? portraitZoom.value : illustrationZoom.value
  const isDragged = el.style.left && el.style.left !== 'auto'
  if (props.compact) {
    el.style.transform = `scale(${zoom})`
  } else if (type === 'portrait') {
    el.style.transform = isDragged
      ? `rotate(-3deg) scale(${zoom})`
      : `translateY(-50%) rotate(-3deg) scale(${zoom})`
  } else {
    el.style.transform = isDragged
      ? `scale(${zoom})`
      : `translateY(-50%) scale(${zoom})`
  }
}

// ── Pinch-to-zoom ──
function onPinchMove(e, type) {
  if (!pinchState.active) return
  if (pinchState.active !== type) return
  const pointers = pinchState
  if (e.pointerId === pointers.pointerA?.pointerId) {
    pointers.pointerA.clientX = e.clientX
    pointers.pointerA.clientY = e.clientY
  } else if (e.pointerId === pointers.pointerB?.pointerId) {
    pointers.pointerB.clientX = e.clientX
    pointers.pointerB.clientY = e.clientY
  } else {
    return
  }
  const dx = pointers.pointerB.clientX - pointers.pointerA.clientX
  const dy = pointers.pointerB.clientY - pointers.pointerA.clientY
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (pointers.initialDist < 10) return
  const ratio = dist / pointers.initialDist
  const zoomRef = type === 'portrait' ? portraitZoom : illustrationZoom
  zoomRef.value = Math.max(0.3, Math.min(4, pointers.initialZoom * ratio))
  applyZoom(type)
}

function checkOverflow() {
  const el = textRef.value
  if (!el) return
  showScrollHint.value = el.scrollHeight > el.clientHeight + 2
}

function onTextScroll() {
  showScrollHint.value = false
}

function scrollTextDown() {
  const el = textRef.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  showScrollHint.value = false
}

onMounted(async () => {
  show.value = true
  await nextTick()

  const fontId = props.letter?.handwriting_font
  if (fontId) loadFont(fontId)

  checkOverflow()

  if (props.compact || !props.sourceRect || !paperRef.value) return

  const paper = paperRef.value
  const src = props.sourceRect
  const target = paper.getBoundingClientRect()

  const { dx, dy, s } = computeTranslate(src, target)

  paper.style.transition = 'none'
  paper.style.willChange = 'transform, border-radius, opacity'
  paper.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`
  paper.style.borderRadius = '14px'
  paper.style.opacity = '0'

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      paper.style.transition = 'transform 0.42s cubic-bezier(0.22, 0.61, 0.36, 1), border-radius 0.42s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.42s ease'
      paper.style.transform = ''
      paper.style.borderRadius = ''
      paper.style.opacity = ''
    })
  })

  setTimeout(() => {
    if (paperRef.value) {
      paperRef.value.style.willChange = 'auto'
    }
  }, 430)
})

watch(() => props.letter?.reply_content || props.letter?.content, async () => {
  await nextTick()
  checkOverflow()
})

function requestClose() {
  if (leaving.value) return
  cleanupDrag()

  if (props.compact || !props.sourceRect || !paperRef.value) {
    leaving.value = true
    setTimeout(() => { emit('close') }, 280)
    return
  }

  const paper = paperRef.value
  const src = props.sourceRect
  const target = paper.getBoundingClientRect()

  const { dx, dy, s } = computeTranslate(src, target)

  leaving.value = true
  paper.style.willChange = 'transform, border-radius, opacity'
  paper.style.transition = 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.32s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.32s ease'
  paper.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`
  paper.style.borderRadius = '14px'
  paper.style.opacity = '0'

  setTimeout(() => {
    cancelTransitions()
    emit('close')
  }, 250)
}

onUnmounted(() => {
  cleanupDrag()
  cancelTransitions()
})
</script>

<style scoped>
.viewer-overlay {
  position: fixed; inset: 0;
  z-index: 10001;
  display: flex; align-items: center; justify-content: center;
  padding: 32px 48px;
  background: rgba(20, 16, 12, 0.7);
  backdrop-filter: blur(10px);
  animation: overlay-in 0.4s ease both;
}
@keyframes overlay-in {
  from { background: rgba(20, 16, 12, 0); backdrop-filter: blur(0px); }
}
.viewer-overlay.overlay-leave {
  background: rgba(20, 16, 12, 0);
  backdrop-filter: blur(0px);
  transition: background 0.28s ease 0.05s, backdrop-filter 0.28s ease 0.05s;
  animation: none;
}

/* 皮肤交给 LinsheButton，仅保留定位、入场/退场动画 */
.viewer-close {
  position: fixed; top: 16px; right: 24px;
  z-index: 10;
  font-size: 22px;   /* &times; 字形尺寸 */
  animation: btn-in 0.25s ease 0.2s both;
}
@keyframes btn-in {
  from { opacity: 0; transform: scale(0.85); }
}
.viewer-overlay.overlay-leave .viewer-close {
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 0.15s ease, transform 0.15s ease;
  animation: none;
}

/* Paper — fixed 4:3 ratio, fills within viewport */
.paper-bg {
  position: relative;
  aspect-ratio: 4/3;
  width: min(100%, 1200px, calc((100vh - 64px) * 4 / 3));
  background-size: cover; background-position: center;
  background-color: #f5efe0;
  box-shadow: 0 16px 60px rgba(0,0,0,0.25);
  display: flex; align-items: center; justify-content: center;
  border-radius: 0;
}

/* Portrait - tilted left */
.paper-portrait {
  position: absolute; left: -145px; top: 50%; transform: translateY(-50%) rotate(-3deg);
  z-index: 2;
  border-radius: 0; overflow: hidden;
  border: 6px solid #fff;
  box-shadow: 0 12px 40px rgba(0,0,0,0.3), 0 4px 8px rgba(0,0,0,0.1);
  cursor: grab; user-select: none; touch-action: none;
}
.paper-portrait img {
  display: block; width: clamp(158px, 20vw, 300px); height: auto;
  aspect-ratio: 3/4; object-fit: cover;
  image-rendering: auto;
  transform: translateZ(0);
  backface-visibility: hidden;
}

/* Text */
.paper-text-area {
  flex: 1; max-width: clamp(350px, 52vw, 650px); padding: 0 36px; z-index: 1;
}
.paper-text {
  font-size: clamp(17px, 2.2vw, 24px); line-height: 2.2; color: #3a2a1a;
  white-space: pre-wrap; word-break: break-word;
  max-height: 60vh; overflow-y: auto;
  scrollbar-width: none; -ms-overflow-style: none;
}
.paper-text::-webkit-scrollbar { display: none; }

/* Illustration - right */
.paper-illustration {
  position: absolute; right: -188px; top: 60%; transform: translateY(-50%);
  z-index: 2;
  border-radius: 0; overflow: hidden;
  border: 6px solid #fff;
  box-shadow: 0 12px 40px rgba(0,0,0,0.3), 0 4px 8px rgba(0,0,0,0.1);
  cursor: grab; user-select: none; touch-action: none;
}
.paper-illustration img {
  display: block; width: clamp(216px, 26vw, 400px); height: auto;
  aspect-ratio: 4/3; object-fit: cover;
  image-rendering: auto;
  transform: translateZ(0);
  backface-visibility: hidden;
}

.paper-portrait:active, .paper-illustration:active {
  cursor: grabbing;
}

/* Fallback without paper image */
.paper-no-bg {
  background: linear-gradient(135deg, #faf5ed 0%, #f3e6d8 50%, #faf5ed 100%);
}
.paper-no-bg .paper-text { color: #4a3a2a; }

/* Scroll hint arrow */
.scroll-hint {
  position: absolute; bottom: 100px; left: 50%; transform: translateX(-50%);
  z-index: 5;
  width: 36px; height: 36px;
  border-radius: 50%;
  background: rgba(58, 42, 26, 0.15);
  color: rgba(58, 42, 26, 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  animation: hint-bounce 1.6s ease-in-out infinite;
  transition: opacity 0.2s ease;
}
.scroll-hint:hover {
  background: rgba(58, 42, 26, 0.25);
  color: rgba(58, 42, 26, 0.7);
}
@keyframes hint-bounce {
  0%, 100% { transform: translateX(-50%) translateY(0); }
  50% { transform: translateX(-50%) translateY(6px); }
}

/* ═══════════════════════════════════════
   Compact (mobile landscape) mode
   ═══════════════════════════════════════ */
.viewer-overlay.overlay-compact {
  padding: 0;
}

.viewer-close-compact {
  top: 8px; right: 8px;
}

/* Rotation wrapper — handles the rotate, paper inside has clean coords */
.paper-rotate-wrap {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%) rotate(-90deg);
}

/* ── Compact paper (inside rotation wrapper or landscape) ── */
.paper-bg.paper-compact {
  position: relative;
  aspect-ratio: 4/3;
  display: flex; flex-direction: row; align-items: center;
  justify-content: center;
  gap: 0;
}

/* ── 竖屏：wrapper 旋转，paper 填窄边 ── */
@media (orientation: portrait) {
  .paper-bg.paper-compact {
    height: 100dvw;
    width: auto;
  }
}

/* ── 真横屏：wrapper 不旋转，paper 自然满屏 ── */
@media (orientation: landscape) {
  .paper-rotate-wrap {
    position: static;
    top: auto; left: auto;
    transform: none;
  }
  .paper-bg.paper-compact {
    width: 100vw;
    height: 100vh; height: 100dvh;
    aspect-ratio: auto;
  }
}

/* ── Compact image positioning (shared by both orientations) ── */
.paper-portrait.portrait-compact {
  position: static; transform: none;
  flex-shrink: 0; order: 0;
  border-width: 2px; margin: 0 4px;
}
.paper-portrait.portrait-compact img {
  width: clamp(50px, 14vw, 140px);
}

.paper-illustration.illustration-compact {
  position: static; transform: none;
  flex-shrink: 0; order: 2;
  border-width: 2px; margin: 0 4px;
}
.paper-illustration.illustration-compact img {
  width: clamp(60px, 18vw, 180px);
}

.text-area-compact {
  flex: 1; min-width: 0; max-width: none;
  order: 1; padding: 0 20px;
}
.text-compact {
  max-height: 80vh;
  font-size: clamp(13px, 1.8vw, 16px);
  line-height: 1.8;
}
</style>
