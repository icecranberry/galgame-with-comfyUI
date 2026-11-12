<template>
  <div class="studio-photo-deck" role="group" :tabindex="photos.length > 1 ? 0 : -1" :aria-label="`本组照片，第 ${index + 1} 张，共 ${photos.length} 张`" @keydown.left.prevent="flip(-1)" @keydown.right.prevent="flip(1)" @wheel="wheel" @touchstart.passive="touchStart" @touchend="touchEnd" @touchcancel="touch = null">
    <figure v-for="(photo, i) in photos" :key="photo.id" class="photo-print" :class="{ 'is-top': i === index, 'is-peeking': i === index && flash }" :style="cardStyle(photo, i)" :aria-hidden="i !== index || undefined" :inert="i !== index || undefined">
      <img :src="photo.output_url" :alt="`${characters(photo)} · ${photo.pose_name || ''}`" role="button" :tabindex="i === index ? 0 : -1" @click="preview(photo)" @keydown.enter.prevent="preview(photo)" @keydown.space.prevent="preview(photo)" @load="$emit('load', photo.id)" @error="$emit('error', photo.id)" />
      <span v-if="i === index && flash" class="photo-flash" aria-hidden="true"></span>
      <figcaption><strong>{{ characters(photo) }}</strong><span>{{ photo.pose_name }}</span></figcaption>
    </figure>
    <div v-if="photos.length > 1" class="photo-counter" aria-live="polite">{{ index + 1 }} / {{ photos.length }}</div>
  </div>
</template>

<script setup>
const props = defineProps({ photos: { type: Array, required: true }, index: { type: Number, default: 0 }, flash: Boolean })
const emit = defineEmits(['update:index', 'preview', 'load', 'error'])
let wheelLock = 0, touch = null, suppressClickUntil = 0
function characters(photo) { return [photo.character_name, photo.character2_name].filter(Boolean).join(' + ') }
function cardStyle(photo, i) {
  const depth = (i - props.index + props.photos.length) % props.photos.length
  return {
    '--photo-aspect': Number(photo.width) / Number(photo.height) || 9 / 16,
    '--photo-x': `${Math.min(depth, 2) * 5}px`, '--photo-y': `${Math.min(depth, 2) * -5}px`,
    '--photo-rotation': `${depth === 0 ? 0 : depth % 2 ? -3 : 3}deg`,
    zIndex: props.photos.length - depth, opacity: depth < 3 ? 1 : 0,
  }
}
function flip(direction) {
  if (props.photos.length > 1) emit('update:index', (props.index + direction + props.photos.length) % props.photos.length)
}
function wheel(event) {
  if (props.photos.length < 2 || event.ctrlKey) return
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
  if (!delta) return
  event.preventDefault()
  event.stopPropagation()
  const now = Date.now()
  if (now - wheelLock < 300) return
  wheelLock = now
  flip(delta > 0 ? 1 : -1)
}
function touchStart(event) {
  const point = event.touches?.length === 1 && event.touches[0]
  touch = point ? { x: point.clientX, y: point.clientY } : null
}
function touchEnd(event) {
  const start = touch, point = event.changedTouches?.[0]
  touch = null
  if (!start || !point) return
  const dx = point.clientX - start.x, dy = point.clientY - start.y
  if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return
  suppressClickUntil = Date.now() + 350
  flip(dx < 0 ? 1 : -1)
}
function preview(photo) { if (Date.now() >= suppressClickUntil) emit('preview', photo.output_url) }
</script>

<style scoped>
.studio-photo-deck { width:100%; height:100%; min-height:0; position:relative; display:grid; place-items:center; touch-action:pan-y pinch-zoom; }
.studio-photo-deck:focus-visible { outline:2px solid var(--studio-shutter); outline-offset:3px; }
.photo-print { grid-area:1/1; margin:0; display:flex; flex-direction:column; gap:8px; max-width:calc(100% - 18px); max-height:calc(100% - 20px); width:min(calc(100cqw - 18px),calc((100cqh - 66px) * var(--photo-aspect) + 20px)); padding:10px; background:var(--dialogue-photo-paper); box-shadow:0 10px 30px var(--studio-shadow); position:relative; transform:translate(var(--photo-x),var(--photo-y)) rotate(var(--photo-rotation)); transition:transform .3s,opacity .3s; pointer-events:none; }
.photo-print.is-top { pointer-events:auto; }
.photo-print img { display:block; width:100%; min-height:0; max-height:calc(100cqh - 66px); object-fit:contain; cursor:zoom-in; }
.photo-print img:focus-visible { outline:2px solid var(--studio-tag); outline-offset:2px; }
.photo-print figcaption { color:var(--dialogue-photo-caption); display:flex; align-items:center; justify-content:space-between; gap:12px; min-width:0; font-size:12px; line-height:20px; }
.photo-print figcaption strong,.photo-print figcaption span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.photo-print figcaption span { font-size:11px; }
.photo-counter { position:absolute; z-index:12; right:0; bottom:0; padding:3px 8px; color:var(--studio-film); background:var(--studio-shutter); font:700 12px/1.5 monospace; pointer-events:none; }
.photo-print.is-peeking img { animation:photo-peek .42s ease both; }
.photo-flash { position:absolute; inset:0; pointer-events:none; background:var(--dialogue-photo-paper); animation:photo-flash .42s ease-out both; }
@keyframes photo-peek { from { opacity:.2; filter:brightness(1.4); } to { opacity:1; filter:none; } }
@keyframes photo-flash { 0%,100% { opacity:0; } 7% { opacity:.96; } 38% { opacity:0; } }
@media(max-width:520px) { .photo-print figcaption span { display:none; } }
@media(prefers-reduced-motion:reduce) { .photo-print { transition:none; }.photo-print.is-peeking img,.photo-flash { animation:none; } }
</style>
