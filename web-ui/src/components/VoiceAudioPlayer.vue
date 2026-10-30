<template>
  <div class="voice-audio" role="group" :aria-label="label">
    <audio
v-if="!transport && src"
ref="media" :src="transport ? undefined : src" :preload="preload" @play="onPlay" @pause="onPause" @ended="onEnded"
      @timeupdate="onTime" @loadedmetadata="syncTime" @durationchange="syncTime" @seeked="syncTime"
      @waiting="buffering = playing" @playing="buffering = false" @volumechange="syncVolume"
      @error="onError" @emptied="reset"
/>
    <div class="voice-audio-row">
      <linshe-button
variant="icon" :disabled="!src" :aria-label="`${playing ? '暂停' : '播放'}${label}`"
        :title="playing ? '暂停' : '播放'" @click="toggle"
>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path v-if="playing" d="M6 5h4v14H6zm8 0h4v14h-4z" />
          <path v-else d="m8 4 12 8-12 8z" />
        </svg>
      </linshe-button>
      <div class="voice-audio-timeline">
        <div
class="voice-audio-seek" :class="{ 'is-disabled': !duration }" role="slider" tabindex="0"
          :aria-label="`${label}播放进度`" aria-valuemin="0" :aria-valuemax="duration" :aria-valuenow="position"
          :aria-valuetext="`${formatTime(position)} / ${formatTime(duration)}`" :aria-disabled="!duration"
          @pointerdown.prevent="beginSeek" @pointermove="moveSeek" @pointerup="endSeek" @pointercancel="dragging = false"
          @keydown="seekKey"
>
          <div class="voice-audio-track" aria-hidden="true">
            <div class="voice-audio-fill" :style="{ transform: `scaleX(${fraction})` }" />
            <span class="voice-audio-thumb" :style="{ left: `${fraction * 100}%` }" />
          </div>
        </div>
        <div class="voice-audio-times"><span>{{ formatTime(position) }}<span v-if="buffering" class="voice-audio-buffer" role="status">缓冲中…</span></span><span>{{ formatTime(duration) }}</span></div>
      </div>
      <linshe-button variant="icon" size="sm" :disabled="!src" :aria-label="muted ? '取消静音' : '静音'" :title="muted ? '取消静音' : '静音'" @click="toggleMute">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4z" />
          <path v-if="muted" d="m16 9 5 6m0-6-5 6" /><path v-else d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
        </svg>
      </linshe-button>
    </div>
    <p v-if="error" class="voice-audio-error" role="alert">{{ error }}</p>
  </div>
</template>

<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'

const props = defineProps({ src: { type: String, default: '' }, label: { type: String, default: '音频' }, preload: { type: String, default: 'metadata' }, transport: { type: Object, default: null } })
const emit = defineEmits(['play', 'timeupdate', 'ended'])
const media = ref(null), playing = ref(false), buffering = ref(false), muted = ref(false)
const playback = computed(() => props.transport || media.value)
const position = ref(0), duration = ref(0), dragging = ref(false), error = ref('')
const fraction = computed(() => duration.value ? Math.min(1, Math.max(0, position.value / duration.value)) : 0)
let intent = 0, frame = null
function formatTime(value) {
  const seconds = Math.floor(Number.isFinite(value) ? Math.max(0, value) : 0)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
function syncTime() {
  const audio = playback.value
  duration.value = Number.isFinite(audio?.duration) ? Math.max(0, audio.duration) : 0
  position.value = Number.isFinite(audio?.currentTime) ? Math.max(0, audio.currentTime) : 0
}
function stopFrames() { if (frame !== null) cancelAnimationFrame(frame); frame = null }
function tick() { syncTime(); frame = playing.value ? requestAnimationFrame(tick) : null }
function onPlay(event) {
  if (event.target.paused) return
  playing.value = true; error.value = ''; stopFrames(); tick()
  emit('play', event)
}
function onPause(event) {
  // Native events are queued: a previous pause can arrive after a new play.
  if (event && !event.target.paused) return
  intent++; playing.value = false; buffering.value = false; stopFrames(); syncTime()
}
function onEnded(event) { onPause(); emit('ended', event) }
function onTime(event) { emit('timeupdate', event); syncTime() }
function onError() { onPause(); error.value = '音频加载失败，请重新播放或更换音频' }
async function play() {
  const audio = playback.value
  if (!audio || !props.src) return
  const ticket = ++intent
  playing.value = true; error.value = ''
  try { await audio.play() }
  catch (e) {
    if (ticket === intent) {
      onPause()
      if (e.name !== 'AbortError') error.value = '暂时无法播放，请再次点击播放'
    }
  }
}
function pause() { onPause(); playback.value?.pause() }
function toggle() { if (playing.value) pause(); else void play() }
function syncVolume() { muted.value = !!playback.value?.muted || playback.value?.volume === 0 }
function toggleMute() {
  if (!playback.value) return
  playback.value.muted = !muted.value
  if (!playback.value.muted && playback.value.volume === 0) playback.value.volume = 1
  syncVolume()
}
function seek(seconds) {
  if (!playback.value || !duration.value) return
  const target = Math.max(0, Math.min(duration.value, seconds))
  playback.value.currentTime = target
  position.value = target
}
function seekPointer(event) {
  const box = event.currentTarget.getBoundingClientRect()
  if (box.width) seek((event.clientX - box.left) / box.width * duration.value)
}
function beginSeek(event) {
  if (!duration.value || (event.button !== undefined && event.button !== 0)) return
  event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
  dragging.value = true; seekPointer(event)
}
function moveSeek(event) { if (dragging.value) seekPointer(event) }
function endSeek(event) { if (dragging.value) seekPointer(event); dragging.value = false }
function seekKey(event) {
  const targets = { ArrowLeft: position.value - 5, ArrowDown: position.value - 5, ArrowRight: position.value + 5, ArrowUp: position.value + 5, Home: 0, End: duration.value }
  if (!(event.key in targets)) return
  event.preventDefault(); seek(targets[event.key])
}
function reset() { onPause(); position.value = 0; duration.value = 0; dragging.value = false; error.value = '' }
watch(() => props.src, () => { pause(); reset() }, { flush: 'sync' })
let detachTransport = () => {}
watch(() => props.transport, (transport, previous) => {
  detachTransport(); previous?.pause(); reset(); syncTime(); syncVolume()
  const handlers = { play: onPlay, pause: onPause, timeupdate: onTime, loadedmetadata: syncTime, seeked: syncTime, volumechange: syncVolume, error: onError }
  // A local DSP transport implements media events without an HTML element.
  const listeners = Object.entries(handlers).map(([type, handle]) => {
    const listener = () => handle({ target: transport })
    transport?.addEventListener(type, listener)
    return [type, listener]
  })
  detachTransport = () => listeners.forEach(([type, listener]) => transport?.removeEventListener(type, listener))
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => { pause(); detachTransport() })
defineExpose({ media: playback })
</script>

<style scoped>
.voice-audio { min-width:0; width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius-md); background:var(--bg-secondary); }
.voice-audio audio { display:none; }
.voice-audio-row { display:flex; align-items:center; gap:14px; }
.voice-audio-timeline { min-width:0; flex:1; }
.voice-audio-seek { display:flex; align-items:center; height:28px; cursor:pointer; touch-action:none; border-radius:var(--radius-sm); }
.voice-audio-seek:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.voice-audio-seek.is-disabled { cursor:default; opacity:.5; }
.voice-audio-track { position:relative; height:7px; width:100%; border-radius:var(--radius-full); background:var(--audio-track); box-shadow:inset 0 0 0 1px var(--audio-track-border); }
.voice-audio-fill { position:absolute; inset:0; border-radius:inherit; background:var(--audio-progress); transform-origin:left; }
.voice-audio-thumb { position:absolute; top:50%; width:13px; height:13px; transform:translate(-50%,-50%); border:3px solid var(--audio-progress); border-radius:50%; background:var(--bg-secondary); }
.voice-audio-times { display:flex; justify-content:space-between; gap:8px; color:var(--text-secondary); font-size:var(--fs-xs); line-height:1.4; font-variant-numeric:tabular-nums; }
.voice-audio-times > :first-child { color:var(--text-primary); }
.voice-audio-buffer { margin-left:8px; color:var(--text-secondary); }
.voice-audio-error { margin:8px 0 0; color:var(--danger); font-size:var(--fs-xs); line-height:1.5; }
@media(max-width:480px) { .voice-audio { padding:8px 10px; } .voice-audio-row { gap:10px; } }
</style>
