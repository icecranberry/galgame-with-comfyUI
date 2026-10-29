<template>
  <div v-if="speechEnabled" class="speech-control" :class="{ 'is-active': waiting || isPlaying, 'speech-dialogue': appearance === 'dialogue' }" @click.stop @pointerdown.stop @pointerup.stop>
    <component :is="appearance === 'dialogue' ? 'div' : LinsheButton" :class="{ 'speech-dialogue-action': appearance === 'dialogue' }" :role="appearance === 'dialogue' ? 'button' : undefined" :tabindex="appearance === 'dialogue' ? 0 : undefined" @keydown="onKeydown" variant="icon" tone="paper" size="md" :hover-motion="false" :touch-target="touchTarget" :title="label" :aria-label="label" @click="waiting ? cancel() : play()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <template v-if="waiting">
          <circle class="speech-spinner" cx="12" cy="12" r="9" stroke-dasharray="42 15" />
          <path d="m9 9 6 6m0-6-6 6" />
        </template>
        <rect v-else-if="isPlaying" x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
        <path v-else-if="failure" d="M20 7v5h-5M20 12a8 8 0 1 0-2.4 5.7" />
        <template v-else>
          <path d="m11 4-6 5H2v6h3l6 5V4Z" />
          <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
        </template>
      </svg>
    </component>
    <span v-if="failure" class="speech-error" role="status">{{ failure }}</span>
  </div>
</template>
<script setup>
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import { ttsApi } from '../api/tts.js'
import { speechEnabled, speechJobs, messageSpeech, speechQueue, waitSpeech } from '../stores/speech.js'
import { createSpeechTask } from '../utils/speechTask.js'
import { chatSpeechAutoPlay } from '../utils/speechAutoPlay.js'
const props = defineProps({ characterId: { type: Number, required: true }, characterName: { type: String, default: '' }, messageId: { type: Number, default: null }, messageIds: { type: Array, default: null }, groupId: { type: Number, default: null }, appearance: { type: String, default: 'default' }, touchTarget: Boolean, autoToken: Number, notifyErrors: Boolean })
const toast = inject('toast', null)
const error = ref(''), pending = ref(false), phase = ref('idle')
const waiting = computed(() => ['preparing', 'ready', 'blocked'].includes(phase.value))
const isPlaying = computed(() => phase.value === 'playing')
const job = computed(() => speechJobs[messageSpeech[props.messageId]])
const failure = computed(() => error.value || (!pending.value && job.value?.status === 'failed' && (job.value.error || '朗读失败，请重试')))
const label = computed(() => isPlaying.value ? '停止朗读' : waiting.value
  ? `${phase.value === 'blocked' ? '轻触页面继续播放' : phase.value === 'ready' ? '等待播放' : pending.value ? '正在请求' : job.value?.status === 'queued' ? '语音排队中' : '语音生成中'}，点击取消`
  : failure.value ? '重试朗读' : '朗读')
let entry, disposed = false
function onKeydown(event) {
  if (props.appearance !== 'dialogue' || !['Enter', ' '].includes(event.key) || event.repeat) return
  event.preventDefault(); event.stopPropagation()
  if (waiting.value) cancel(); else play()
}
function showError(e) {
  if (disposed || e.name === 'AbortError') return
  if (e.code === 'VOICE_NOT_CONFIGURED' && toast) {
    toast(`请先为${props.characterName ? `「${props.characterName}」` : '该角色'}配置声音：角色详情 → 声音设置`, 'warning')
  } else {
    error.value = e.message
    if (props.notifyErrors) toast?.(e.message, 'error')
  }
}
async function play() {
  if (entry?.active) { await cancel(); return }
  const ids = [...new Set(props.messageIds || [props.messageId])].filter(id => Number.isSafeInteger(id) && id > 0)
  if (!ids.length) return
  error.value = ''
  const batch = {
    items: [], errors: new Set(),
    get active() { return this.items.some(item => item.slot?.active) },
    cancel() { return Promise.all(this.items.map(item => item.slot.cancel())) },
  }
  entry = batch
  const sync = () => {
    if (entry !== batch) return
    phase.value = batch.items.find(item => item.state !== 'idle')?.state || 'idle'
    pending.value = batch.items.some(item => item.state !== 'idle' && item.pending)
  }
  // Reserve every sentence before sending requests, so the page remains in
  // order even when cached responses arrive before unfinished synthesis.
  for (const messageId of ids) {
    const item = { state: 'preparing', pending: true }
    batch.items.push(item)
    const active = createSpeechTask({
      request: () => ttsApi(`${props.groupId ? `/groups/${props.groupId}` : ''}/characters/${props.characterId}/messages/${messageId}`, {}),
      wait: waitSpeech,
      // Other bubbles can share this job; cancel only without consumers.
      cancel: job => speechQueue.usesJob(job.id) ? undefined : ttsApi(`/jobs/${job.id}/cancel`, {}),
      onJob: next => {
        if (!disposed && entry === batch && item.slot.active) {
          item.slot.job = next
          messageSpeech[messageId] = next.id; speechJobs[next.id] = next
          item.pending = false; sync()
        }
      },
    })
    item.slot = speechQueue.reserve({
      onState: state => { item.state = state; sync() },
      onError: error => {
        if (batch.errors.has(error.code || error.message)) return
        batch.errors.add(error.code || error.message); showError(error)
      },
      onCancel: () => active.cancel(),
    })
    item.run = async () => {
      try { item.slot.ready(await active.run()) }
      catch (e) { item.slot.fail(e) }
      finally { item.pending = false; sync() }
    }
  }
  await Promise.all(batch.items.map(item => item.run()))
}
async function cancel() {
  const previous = entry
  try { await previous?.cancel() }
  catch (e) { if (entry === previous) showError(e) }
}
watch(() => props.autoToken, token => {
  if (chatSpeechAutoPlay.claim(token) && !entry?.active) play()
}, { immediate: true })
onBeforeUnmount(() => { disposed = true; cancel() })
</script>
<style scoped>
.speech-control { display:flex; align-items:center; padding-left:8px; }
.speech-dialogue { display:inline-flex; position:relative; vertical-align:middle; padding:0 2px; }
.speech-dialogue-action { display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px; cursor:pointer; text-align:center; color:var(--dialogue-ink); background:var(--dialogue-paper); border-radius:50%; transition:color .3s ease; }
.speech-dialogue-action:focus-visible { color:var(--dialogue-menu-hover); outline:2px solid currentColor; outline-offset:2px; }
@media (hover:hover) { .speech-dialogue-action:hover { color:var(--dialogue-menu-hover); } }
.speech-spinner { transform-origin:12px 12px; animation:cel-spin 1s linear infinite; }
.speech-error {
  position:absolute; right:0; top:100%; z-index:1;
  width:max-content; max-width:min(240px, 65vw); padding:6px 10px;
  border-radius:var(--radius-sm); background:var(--bg-secondary); box-shadow:var(--shadow-sm);
  font-size:var(--fs-xs); line-height:1.5; color:var(--text-secondary); overflow-wrap:anywhere;
}
</style>
