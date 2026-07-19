<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="viewer-overlay"
      :class="{ 'overlay-leave': leaving }"
      @click.self="requestClose"
    >
      <button
        class="viewer-close"
        @click="requestClose"
      >&times;</button>

      <div
        class="paper-bg"
        ref="paperRef"
        :class="{ 'paper-no-bg': !letter.paper_path }"
        :style="paperBgStyle"
      >
        <!-- Portrait - tilted left -->
        <div v-if="letter.portrait_path" ref="portraitRef" class="paper-portrait" @pointerdown.prevent="startDrag($event, 'portrait')" @wheel.prevent.stop="handleWheel($event, 'portrait')">
          <img :src="letter.portrait_path" alt="" draggable="false" />
        </div>

        <!-- Text content -->
        <div class="paper-text-area">
          <div class="paper-text handwritten">{{ displayText }}</div>
        </div>

        <!-- Illustration - right -->
        <div v-if="letter.illustration_path" ref="illustrationRef" class="paper-illustration" @pointerdown.prevent="startDrag($event, 'illustration')" @wheel.prevent.stop="handleWheel($event, 'illustration')">
          <img :src="letter.illustration_path" alt="" draggable="false" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps({
  letter: { type: Object, required: true },
  sourceRect: { type: Object, default: null },
})
const emit = defineEmits(['close', 'delete'])

const displayText = computed(() => {
  if (props.letter.reply_content) return props.letter.reply_content
  return props.letter.content
})

const show = ref(false)
const leaving = ref(false)
const paperRef = ref(null)
const portraitRef = ref(null)
const illustrationRef = ref(null)
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
  el.style.transform = type === 'portrait' ? `rotate(-3deg) scale(${zoom})` : `scale(${zoom})`

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

function onDragEnd() {
  if (!dragState.active) return
  const el = dragState.active === 'portrait' ? portraitRef.value : illustrationRef.value
  if (el) {
    try { el.releasePointerCapture(dragState.pointerId) } catch {}
  }
  dragState.active = null
  document.removeEventListener('pointermove', onDragMove)
  document.removeEventListener('pointerup', onDragEnd)
  document.removeEventListener('pointercancel', onDragEnd)
}

function cleanupDrag() {
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
  if (type === 'portrait') {
    el.style.transform = isDragged
      ? `rotate(-3deg) scale(${zoom})`
      : `translateY(-50%) rotate(-3deg) scale(${zoom})`
  } else {
    el.style.transform = isDragged
      ? `scale(${zoom})`
      : `translateY(-50%) scale(${zoom})`
  }
}

onMounted(async () => {
  show.value = true
  await nextTick()

  if (!props.sourceRect || !paperRef.value) return

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

function requestClose() {
  if (leaving.value) return
  cleanupDrag()

  if (!props.sourceRect || !paperRef.value) {
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

.viewer-close {
  position: fixed; top: 16px; right: 24px;
  width: 40px; height: 40px; border-radius: 50%;
  background: rgba(255,255,255,0.85); border: 1px solid rgba(0,0,0,0.1);
  color: #3a2a1a; font-size: 22px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  z-index: 10;
  box-shadow: 0 2px 12px rgba(0,0,0,0.15);
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
.viewer-close:hover { background: #fff; transform: scale(1.08); }

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
  flex: 1; max-width: clamp(350px, 52vw, 620px); padding: 0 36px; z-index: 1;
}
.paper-text {
  font-family: 'Ma Shan Zheng', 'STKaiti', 'KaiTi', serif;
  font-size: clamp(17px, 2.2vw, 24px); line-height: 2.2; color: #3a2a1a;
  white-space: pre-wrap; word-break: break-word;
  max-height: 70vh; overflow-y: auto;
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
</style>
