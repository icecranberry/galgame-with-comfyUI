<template>
  <div v-if="speechEnabled" class="speech-control" @click.stop @pointerdown.stop>
    <linshe-button variant="link" size="sm" :disabled="pending" @click="play">
      {{ playingSpeech && playingSpeech === job?.id ? '停止朗读' : pending ? '正在请求…' : job?.status === 'queued' ? '等待生图 / 排队中…' : job?.status === 'generating' ? '语音生成中…' : job?.status === 'failed' ? '重试朗读' : '朗读' }}
    </linshe-button>
    <linshe-button v-if="waiting" variant="link" size="sm" @click="cancel">取消</linshe-button>
    <span v-if="error || job?.error" class="speech-error" role="status">{{ error || job?.error }}</span>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import { ttsApi } from '../api/tts.js'
import { speechEnabled, speechJobs, messageSpeech, speechPlayer, playingSpeech, stopSpeech, waitSpeech, playSpeechJob } from '../stores/speech.js'
const props = defineProps({ characterId: { type: Number, required: true }, messageId: { type: Number, required: true } })
const error = ref(''), pending = ref(false), waiting = ref(false)
const job = computed(() => speechJobs[messageSpeech[props.messageId]])
let controller
async function play() {
  if (playingSpeech.value && playingSpeech.value === job.value?.id) { stopSpeech(); return }
  if (waiting.value) return
  controller = new AbortController()
  const signal = controller.signal
  const ticket = speechPlayer.begin()
  playingSpeech.value = null
  error.value = ''; pending.value = true; waiting.value = true
  try {
    const next = await ttsApi(`/characters/${props.characterId}/messages/${props.messageId}`, {}, 'POST', signal)
    messageSpeech[props.messageId] = next.id; speechJobs[next.id] = next
    pending.value = false
    const ready = await waitSpeech(next, signal)
    if (!signal.aborted && speechPlayer.current(ticket)) await playSpeechJob(ready, ticket)
  } catch (e) { if (e.name !== 'AbortError') error.value = e.message }
  finally { pending.value = false; waiting.value = false }
}
async function cancel() {
  controller?.abort(); stopSpeech()
  if (job.value) {
    try { const result = await ttsApi(`/jobs/${job.value.id}/cancel`, {}); if (result) speechJobs[result.id] = result }
    catch (e) { error.value = e.message }
  }
}
onBeforeUnmount(() => controller?.abort())
</script>
<style scoped>
.speech-control { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:6px; }
.speech-error { font-size:var(--fs-xs); color:var(--text-secondary); overflow-wrap:anywhere; }
</style>
