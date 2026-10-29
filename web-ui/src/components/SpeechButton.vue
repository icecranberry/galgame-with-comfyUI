<template>
  <div v-if="speechEnabled" class="speech-control" :class="{ 'is-active': waiting || isPlaying }" @click.stop @pointerdown.stop @pointerup.stop>
    <linshe-button variant="icon" tone="paper" size="md" :touch-target="touchTarget" :title="label" :aria-label="label" @click="waiting ? cancel() : play()">
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
    </linshe-button>
    <span v-if="failure" class="speech-error" role="status">{{ failure }}</span>
  </div>
</template>
<script setup>
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import { ttsApi } from '../api/tts.js'
import { speechEnabled, speechJobs, messageSpeech, speechPlayer, playingSpeech, stopSpeech, waitSpeech, playSpeechJob } from '../stores/speech.js'
import { createSpeechTask } from '../utils/speechTask.js'
const props = defineProps({ characterId: { type: Number, required: true }, characterName: { type: String, default: '' }, messageId: { type: Number, required: true }, groupId: { type: Number, default: null }, touchTarget: Boolean })
const toast = inject('toast', null)
const error = ref(''), pending = ref(false), waiting = ref(false)
const playbackTicket = ref(null)
let cancellationTicket = null
const job = computed(() => speechJobs[messageSpeech[props.messageId]])
const isPlaying = computed(() => !!playingSpeech.value && playingSpeech.value === job.value?.id
  && playbackTicket.value !== null && speechPlayer.current(playbackTicket.value))
const failure = computed(() => error.value || (!pending.value && job.value?.status === 'failed' && (job.value.error || '朗读失败，请重试')))
const label = computed(() => isPlaying.value ? '停止朗读' : waiting.value
  ? `${pending.value ? '正在请求' : job.value?.status === 'queued' ? '语音排队中' : '语音生成中'}，点击取消`
  : failure.value ? '重试朗读' : '朗读')
let task, disposed = false
async function play() {
  if (isPlaying.value) { stopSpeech(); return }
  if (waiting.value) return
  const ticket = speechPlayer.begin()
  playbackTicket.value = ticket
  cancellationTicket = null
  playingSpeech.value = null
  error.value = ''; pending.value = true; waiting.value = true
  const active = createSpeechTask({
    request: () => ttsApi(`${props.groupId ? `/groups/${props.groupId}` : ''}/characters/${props.characterId}/messages/${props.messageId}`, {}),
    wait: waitSpeech,
    // 后端可能将相同对白合并为同一任务；旧气泡不能取消新播放者正在使用的任务。
    cancel: job => speechPlayer.current(ticket) || (cancellationTicket !== null && speechPlayer.current(cancellationTicket))
      ? ttsApi(`/jobs/${job.id}/cancel`, {}) : undefined,
    onJob: next => {
      if (!disposed && (speechPlayer.current(ticket) || (cancellationTicket !== null && speechPlayer.current(cancellationTicket)))) {
        messageSpeech[props.messageId] = next.id; speechJobs[next.id] = next
      }
      pending.value = false
    },
  })
  task = active
  try {
    const ready = await active.run()
    if (!disposed && !active.cancelled && speechPlayer.current(ticket)) await playSpeechJob(ready, ticket)
  } catch (e) {
    if (!disposed && e.name !== 'AbortError' && (speechPlayer.current(ticket) || (cancellationTicket !== null && speechPlayer.current(cancellationTicket)))) {
      if (e.code === 'VOICE_NOT_CONFIGURED' && toast) {
        toast(`请先为${props.characterName ? `「${props.characterName}」` : '该角色'}配置声音：角色详情 → 声音设置`, 'warning')
      } else error.value = e.message
    }
  }
  finally { if (task === active) { task = null; pending.value = false; waiting.value = false } }
}
async function cancel() {
  // begin 同时停止音频并生成取消凭据，避免迟到的创建响应误伤之后的朗读。
  if (playbackTicket.value !== null && speechPlayer.current(playbackTicket.value)) cancellationTicket = speechPlayer.begin()
  try { await task?.cancel() }
  catch (e) { if (!disposed) error.value = e.message }
}
onBeforeUnmount(() => { disposed = true; cancel() })
</script>
<style scoped>
.speech-control { display:flex; align-items:center; padding-left:8px; }
.speech-spinner { transform-origin:12px 12px; animation:cel-spin 1s linear infinite; }
.speech-error {
  position:absolute; right:0; top:100%; z-index:1;
  width:max-content; max-width:min(240px, 65vw); padding:6px 10px;
  border-radius:var(--radius-sm); background:var(--bg-secondary); box-shadow:var(--shadow-sm);
  font-size:var(--fs-xs); line-height:1.5; color:var(--text-secondary); overflow-wrap:anywhere;
}
</style>
