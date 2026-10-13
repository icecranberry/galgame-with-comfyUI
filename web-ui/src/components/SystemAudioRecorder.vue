<template>
  <Teleport v-if="pipBody" :to="pipBody">
    <div class="recorder-desktop" :class="{ 'is-closing': closing }">
      <div class="recorder-heading"><h3>录制系统声音</h3><linshe-button variant="icon" size="sm" aria-label="关闭录音窗" @click="close">×</linshe-button></div>
      <SystemAudioRecorderControls :state="state" :audio-url="audioUrl" :supported="supported" @start="start" @stop="recorder.stop" @use="useRecording" @play="speechPlayer.adopt" />
    </div>
  </Teleport>
</template>
<script setup>
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import SystemAudioRecorderControls from './SystemAudioRecorderControls.vue'
import { createSystemAudioRecorder } from '../utils/systemAudioRecorder.js'
import { speechPlayer, stopSpeech } from '../stores/speech.js'
const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'recorded', 'error'])
const supported = !!(window.isSecureContext && navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder)
const state = ref({ phase: 'idle', seconds: 0 }), audioUrl = ref(''), pipBody = shallowRef(null), closing = ref(false)
let blob, pipWindow, generation = 0, closingTimer, disposed = false
const recorder = createSystemAudioRecorder({
  getDisplayMedia: options => (pipWindow || window).navigator.mediaDevices.getDisplayMedia(options),
  onState: value => { state.value = value }, onResult: value => {
  clearRecording(); blob = value; audioUrl.value = URL.createObjectURL(value)
} })
function clearRecording() { if (audioUrl.value) URL.revokeObjectURL(audioUrl.value); audioUrl.value = ''; blob = null }
function start() { if (closing.value) return; stopSpeech(); clearRecording(); recorder.start() }
function disposeWindow() { const win = pipWindow; pipWindow = null; pipBody.value = null; win?.close(); clearRecording() }
function close() {
  generation++; recorder.cancel(); stopSpeech()
  if (closing.value) return
  if (!pipWindow) { clearRecording(); emit('update:modelValue', false); return }
  closing.value = true
  closingTimer = setTimeout(() => { disposeWindow(); closing.value = false; emit('update:modelValue', false) }, 300)
}
function useRecording() {
  if (!blob || closing.value) return
  const result = blob
  emit('recorded', result); close()
}
// Called directly by the source button so requestWindow keeps the user's activation.
async function open() {
  if (pipWindow) { pipWindow.focus(); return }
  clearTimeout(closingTimer); closing.value = false
  const current = ++generation
  try {
    if (!window.documentPictureInPicture?.requestWindow) throw new Error('unsupported')
    const win = await window.documentPictureInPicture.requestWindow({ width: 420, height: 460 })
    if (disposed || !props.modelValue || current !== generation) { win.close(); return }
    pipWindow = win
    win.document.title = '邻舍 · 录制系统声音'
    win.document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'warm'
    for (const sheet of document.querySelectorAll('link[rel="stylesheet"], style')) win.document.head.appendChild(sheet.cloneNode(true))
    win.document.body.style.background = 'var(--bg-primary)'
    pipBody.value = win.document.body
    win.addEventListener('pagehide', () => {
      if (pipWindow !== win) return
      generation++; recorder.cancel(); stopSpeech(); clearTimeout(closingTimer)
      pipWindow = null; pipBody.value = null; closing.value = false; clearRecording()
      emit('update:modelValue', false)
    }, { once: true })
  } catch {
    if (disposed || current !== generation) return
    disposeWindow()
    emit('error', '无法打开置顶录音小窗，请使用支持此功能的 Chrome / Edge，或上传音频文件。')
    emit('update:modelValue', false)
  }
}
watch(() => props.modelValue, value => { if (!value) close() })
defineExpose({ open })
onBeforeUnmount(() => { disposed = true; generation++; clearTimeout(closingTimer); recorder.cancel(); stopSpeech(); disposeWindow() })
</script>
<style scoped>
.recorder-desktop { padding:20px; display:flex; flex-direction:column; gap:16px; color:var(--text-primary); animation:recorder-appear .3s ease; }
.recorder-desktop h3 { margin:0; }
.recorder-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.recorder-desktop.is-closing { animation:recorder-disappear .3s ease forwards; pointer-events:none; }
@keyframes recorder-appear { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
@keyframes recorder-disappear { from { opacity:1; transform:translateY(0); } to { opacity:0; transform:translateY(6px); } }
</style>
