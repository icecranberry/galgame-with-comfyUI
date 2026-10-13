<template>
  <linshe-modal :model-value="modelValue && !pipBody" title="录制系统声音" floating :transition-ms="300" @update:model-value="close">
    <SystemAudioRecorderControls :state="state" :audio-url="audioUrl" :supported="supported" :can-float="canFloat" @start="start" @stop="recorder.stop" @use="useRecording" @float="floatWindow" @play="speechPlayer.adopt" />
  </linshe-modal>
  <Teleport v-if="pipBody" :to="pipBody">
    <div class="recorder-desktop">
      <h3>录制系统声音</h3>
      <SystemAudioRecorderControls :state="state" :audio-url="audioUrl" :supported="supported" :can-float="false" @start="start" @stop="recorder.stop" @use="useRecording" @play="speechPlayer.adopt" />
      <linshe-button variant="ghost" size="sm" @click="returnToPage">收回页面</linshe-button>
    </div>
  </Teleport>
</template>
<script setup>
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'
import SystemAudioRecorderControls from './SystemAudioRecorderControls.vue'
import { createSystemAudioRecorder } from '../utils/systemAudioRecorder.js'
import { speechPlayer, stopSpeech } from '../stores/speech.js'
const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'recorded'])
const supported = !!(window.isSecureContext && navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder)
const canFloat = !!window.documentPictureInPicture?.requestWindow
const state = ref({ phase: 'idle', seconds: 0 }), audioUrl = ref(''), pipBody = shallowRef(null)
let blob, pipWindow, generation = 0, closingTimer, disposed = false
const recorder = createSystemAudioRecorder({
  getDisplayMedia: options => (pipWindow || window).navigator.mediaDevices.getDisplayMedia(options),
  onState: value => { state.value = value }, onResult: value => {
  clearRecording(); blob = value; audioUrl.value = URL.createObjectURL(value)
} })
function clearRecording() { if (audioUrl.value) URL.revokeObjectURL(audioUrl.value); audioUrl.value = ''; blob = null }
function start() { stopSpeech(); clearRecording(); recorder.start() }
function returnToPage() { recorder.stop(); pipBody.value = null; pipWindow?.close(); pipWindow = null }
function reset() { generation++; recorder.cancel(); stopSpeech(); returnToPage(); clearRecording() }
function close() { reset(); emit('update:modelValue', false) }
function useRecording() {
  if (!blob) return
  const result = blob
  emit('recorded', result); close()
}
async function floatWindow() {
  const current = ++generation
  try {
    const win = await window.documentPictureInPicture.requestWindow({ width: 420, height: 460 })
    if (disposed || !props.modelValue || current !== generation) { win.close(); return }
    pipWindow = win
    win.document.title = '邻舍 · 录制系统声音'
    win.document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'warm'
    for (const sheet of document.querySelectorAll('link[rel="stylesheet"], style')) win.document.head.appendChild(sheet.cloneNode(true))
    win.document.body.style.background = 'var(--bg-primary)'
    pipBody.value = win.document.body
    win.addEventListener('pagehide', () => { if (pipWindow === win) { recorder.stop(); pipBody.value = null; pipWindow = null } }, { once: true })
  } catch { state.value = { ...state.value, error: '置顶小窗暂不可用，可以继续使用页面右下角的录音窗。' } }
}
watch(() => props.modelValue, open => {
  clearTimeout(closingTimer)
  if (open) { generation++; return }
  // Stop capture immediately; retain the rendered preview during the exit fade.
  generation++; recorder.cancel(); stopSpeech(); returnToPage()
  closingTimer = setTimeout(clearRecording, 300)
})
onBeforeUnmount(() => { disposed = true; clearTimeout(closingTimer); reset() })
</script>
<style scoped>
.recorder-desktop { padding:20px; display:flex; flex-direction:column; gap:16px; color:var(--text-primary); animation:recorder-appear .3s ease; }
.recorder-desktop h3 { margin:0; }
@keyframes recorder-appear { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
</style>
