<template>
  <div v-if="speechEnabled" class="speech-control" @click.stop @pointerdown.stop>
    <linshe-button variant="link" size="sm" :disabled="pending" @click="play">
      {{ playingSpeech && playingSpeech === job?.id ? '停止朗读' : pending ? '正在请求…' : job?.status === 'queued' ? '等待生图 / 排队中…' : job?.status === 'generating' ? '语音生成中…' : job?.status === 'failed' ? '重试朗读' : '朗读' }}
    </linshe-button>
    <linshe-button v-if="waiting" variant="link" size="sm" @click="cancel">取消</linshe-button>
    <span v-if="error || (!pending && job?.status === 'failed' && job?.error)" class="speech-error" role="status">{{ error || job?.error }}</span>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import { ttsApi } from '../api/tts.js'
import { speechEnabled, speechJobs, messageSpeech, speechPlayer, playingSpeech, stopSpeech, waitSpeech, playSpeechJob } from '../stores/speech.js'
import { createSpeechTask } from '../utils/speechTask.js'
const props = defineProps({ characterId: { type: Number, required: true }, messageId: { type: Number, required: true } })
const error = ref(''), pending = ref(false), waiting = ref(false)
const job = computed(() => speechJobs[messageSpeech[props.messageId]])
let task, disposed = false
async function play() {
  if (playingSpeech.value && playingSpeech.value === job.value?.id) { stopSpeech(); return }
  if (waiting.value) return
  const ticket = speechPlayer.begin()
  playingSpeech.value = null
  error.value = ''; pending.value = true; waiting.value = true
  const active = createSpeechTask({
    request: () => ttsApi(`/characters/${props.characterId}/messages/${props.messageId}`, {}),
    wait: waitSpeech,
    cancel: job => ttsApi(`/jobs/${job.id}/cancel`, {}),
    onJob: next => { messageSpeech[props.messageId] = next.id; speechJobs[next.id] = next; pending.value = false },
  })
  task = active
  try {
    const ready = await active.run()
    if (!disposed && !active.cancelled && speechPlayer.current(ticket)) await playSpeechJob(ready, ticket)
  } catch (e) { if (!disposed && e.name !== 'AbortError') error.value = e.message }
  finally { if (task === active) { task = null; pending.value = false; waiting.value = false } }
}
async function cancel() {
  stopSpeech()
  try { await task?.cancel() }
  catch (e) { if (!disposed) error.value = e.message }
}
onBeforeUnmount(() => { disposed = true; task?.cancel().catch(() => {}); if (playingSpeech.value === job.value?.id) stopSpeech() })
</script>
<style scoped>
.speech-control { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:6px; }
.speech-error { font-size:var(--fs-xs); color:var(--text-secondary); overflow-wrap:anywhere; }
</style>
