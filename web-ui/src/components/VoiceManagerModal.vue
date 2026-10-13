<template>
  <linshe-modal :model-value="modelValue && !recorderOpen" :title="`${character?.display_name || '角色'}的声音`" wide :transition-ms="300" @update:model-value="$emit('update:modelValue', $event)">
    <div class="voice-manager">
      <div class="voice-intro"><span>{{ binding ? `当前绑定 · ${binding.name}` : '还没有绑定声音' }}</span><span>参考对白建议 6～12 秒</span></div>
      <label v-if="voices.length" class="voice-field">音色来源
        <linshe-select v-model="selected" :disabled="busy" :options="voiceOptions" />
      </label>
      <Transition name="voice-content" mode="out-in">
        <div v-if="!selected" key="new" class="voice-fields">
          <div class="voice-section-heading"><h4>声音素材</h4><span>清晰、单人、无伴奏 · 无需填写原台词</span></div>
          <div class="voice-source-actions">
            <div><linshe-button :disabled="busy" @click="openRecorder">录制系统声音</linshe-button><p>录下正在播放的角色对白</p></div>
            <div><linshe-button :loading="busy && operation === 'upload'" :disabled="busy" @click="chooseFile">{{ original ? '更换音频文件' : '上传音频文件' }}</linshe-button><p>音频文件 · 25MB / 120 秒以内</p></div>
          </div>
          <div ref="uploadPicker" hidden><linshe-input type="file" accept="audio/*" :disabled="busy" tabindex="-1" @change="upload" /></div>
          <template v-if="original">
            <div class="voice-section-heading"><h4>选取参考片段</h4><span>原音 {{ original.duration.toFixed(1) }} 秒</span></div>
            <audio ref="sourceAudio" :src="original.preview_url" controls preload="metadata" @play="playOriginal" @timeupdate="loopOriginal" @ended="restartOriginal" />
            <svg class="voice-wave" viewBox="0 0 720 100" role="group" aria-label="拖动左右端点选择参考片段" @pointermove="moveHandle" @pointerup="dragging = ''" @pointercancel="dragging = ''">
              <line v-for="(peak, i) in original.peaks" :key="i" :x1="i * 3 + 1" :x2="i * 3 + 1" :y1="50 - Math.max(2, peak * 46)" :y2="50 + Math.max(2, peak * 46)" class="wave-line" />
              <rect :x="start / original.duration * 720" y="0" :width="(end - start) / original.duration * 720" height="100" class="wave-selection" />
              <rect
v-for="edge in ['start', 'end']" :key="edge" :x="(edge === 'start' ? start : end) / original.duration * 720 - 10" y="0" width="20" height="100" class="wave-handle"
                role="slider" tabindex="0" :aria-label="edge === 'start' ? '片段开始时间' : '片段结束时间'" aria-valuemin="0" :aria-valuemax="original.duration" :aria-valuenow="edge === 'start' ? start : end"
                @pointerdown.prevent="beginDrag($event, edge)" @keydown.left.prevent="adjust(edge, -0.1)" @keydown.right.prevent="adjust(edge, 0.1)"
/>
            </svg>
            <div class="voice-range">
              <label class="voice-field">开始（秒）<linshe-input v-model.number="start" type="number" min="0" :max="original.duration" step="0.1" :disabled="busy" /></label>
              <label class="voice-field">结束（秒）<linshe-input v-model.number="end" type="number" min="0" :max="original.duration" step="0.1" :disabled="busy" /></label>
            </div>
            <p class="fd" role="status">{{ validRange ? `已选择 ${(end - start).toFixed(1)} 秒` : '请选择原音范围内 1～15 秒的片段' }}</p>
            <div class="voice-clip-options"><linshe-switch v-model="loop" size="sm" on-text="循环选段" off-text="完整原音" /><linshe-switch v-model="denoise" size="sm" :disabled="busy" on-text="轻度降噪" off-text="不降噪" /></div>
            <div class="voice-inline-action"><linshe-button size="sm" :loading="busy && operation === 'crop'" :disabled="busy || !validRange" @click="crop">试听处理后的片段</linshe-button><span class="voice-hint">生成试听时会自动处理选段</span></div>
          </template>
          <template v-if="sample">
            <span>处理后的参考音 · {{ sample.duration.toFixed(1) }} 秒</span>
            <audio :src="sample.reference_url" controls @play="speechPlayer.adopt($event.target)" />
            <p v-for="warning in sample.warnings" :key="warning" class="fd">{{ warning }}</p>
          </template>
          <label class="voice-field">音色名称<linshe-input v-model="name" maxlength="80" :disabled="busy" /></label>
          <div class="voice-inline-action"><linshe-button variant="link" size="sm" :aria-expanded="advancedOpen" @click="advancedOpen = !advancedOpen">{{ advancedOpen ? '收起音色选项' : '语速、语言与备注' }}</linshe-button></div>
          <Transition name="voice-content">
            <div v-if="advancedOpen" class="voice-fields voice-advanced">
              <label class="voice-field">语速倍数<linshe-input v-model.number="speed" type="number" min="0.5" max="2" step="0.1" :disabled="busy" /></label>
              <label class="voice-field">语言<linshe-select v-model="language" :disabled="busy" :options="languages" /></label>
              <label class="voice-field">备注<linshe-input v-model="notes" type="textarea" :rows="2" maxlength="1000" /></label>
            </div>
          </Transition>
        </div>
        <div v-else key="existing" class="voice-fields">
          <span>已有音色的参考原音</span>
          <audio :src="selectedVoice?.reference_url" controls @play="speechPlayer.adopt($event.target)" />
          <p class="fd">{{ selectedVoice?.speed }} 倍速 · {{ selectedVoice?.language }} · 版本 {{ selectedVoice?.version }}</p>
        </div>
      </Transition>
      <section class="voice-fields voice-test">
      <div class="voice-section-heading"><h4>听听效果</h4><span>换一句台词，确认声音是否合适</span></div>
      <div class="voice-presets"><linshe-button v-for="line in testLines" :key="line.label" variant="chip" size="sm" :active="text === line.value" :disabled="busy" @click="text = line.value">{{ line.label }}</linshe-button></div>
      <linshe-input v-model="text" type="textarea" :rows="3" maxlength="1000" :disabled="busy" aria-label="自定义试听台词" />
      <div class="voice-inline-action"><linshe-button :loading="busy && operation === 'preview'" :disabled="busy || !canPreview" @click="preview">{{ previewJob?.status === 'completed' ? '重新生成试听' : '生成试听' }}</linshe-button><span class="voice-hint" role="status">{{ previewJob ? statusLabels[previewJob.status] : previewHint }}</span></div>
      <audio v-if="previewJob?.audio_url" :src="previewJob.audio_url" controls aria-label="合成试听" @play="speechPlayer.adopt($event.target)" />
      </section>
      <p v-if="error" class="voice-error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
    </div>
    <template #footer>
      <div class="voice-footer">
<span class="voice-hint">{{ selected ? '绑定后，该角色将使用所选音色' : previewJob?.status === 'completed' ? '试听满意后，保存给这个角色' : '先生成试听，再保存音色' }}</span><div class="voice-footer-actions">
      <linshe-button v-if="binding" variant="ghost" :disabled="busy" @click="unbind">解除声音绑定</linshe-button>
      <linshe-button variant="primary" :disabled="busy || !canSave" :loading="busy && operation === 'save'" @click="save">{{ selected ? '使用这个声音' : '保存并绑定' }}</linshe-button>
      </div>
</div>
    </template>
  </linshe-modal>
  <SystemAudioRecorder v-model="recorderOpen" @recorded="importRecording" />
</template>

<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheSelect from './ui/LinsheSelect.vue'
import LinsheSwitch from './ui/LinsheSwitch.vue'
import SystemAudioRecorder from './SystemAudioRecorder.vue'
import { ttsApi, uploadVoice } from '../api/tts.js'
import { speechJobs, speechPlayer, stopSpeech, waitSpeech } from '../stores/speech.js'
const props = defineProps({ modelValue: Boolean, character: { type: Object, default: null } })
const emit = defineEmits(['update:modelValue', 'saved'])
const voices = ref([]), binding = ref(null), selected = ref(''), original = ref(null), sample = ref(null)
const start = ref(0), end = ref(10), loop = ref(true), denoise = ref(false), dragging = ref(''), sourceAudio = ref(null)
const name = ref('日常'), speed = ref(1), language = ref('zh'), notes = ref(''), transcript = ref('')
const busy = ref(false), operation = ref(''), error = ref(''), notice = ref(''), previewId = ref(null)
const recorderOpen = ref(false), advancedOpen = ref(false), uploadPicker = ref(null)
function chooseFile() { uploadPicker.value?.querySelector('input')?.click() }
let controller, session = 0
const testLines = [
  { label: '日常问候', value: '今天过得怎么样？坐下来，和我聊聊吧。' },
  { label: '疑问句', value: '你说的那家咖啡馆，真的就在街角吗？' },
  { label: '稍长对白', value: '我原本想等雨停了再出门，后来发现，和你一起撑伞走回家也是件很开心的事。' },
]
const text = ref(testLines[0].value)
const languages = [{ label: '中文', value: 'zh' }, { label: '英语', value: 'en' }, { label: '日语', value: 'ja' }]
const statusLabels = { queued: '正在排队，等待显存可用…', generating: '正在生成试听…', completed: '合成试听已完成', failed: '试听失败，可以重试', cancelled: '已取消' }
const voiceOptions = computed(() => [{ label: '上传或录制新声音', value: '' }, ...voices.value.map(v => ({ label: v.name, value: v.id }))])
const selectedVoice = computed(() => voices.value.find(v => v.id === selected.value))
const previewJob = computed(() => speechJobs[previewId.value])
const validRange = computed(() => original.value && Number.isFinite(start.value) && Number.isFinite(end.value) && start.value >= 0 && end.value <= original.value.duration && end.value - start.value >= 1 && end.value - start.value <= 15)
const canPreview = computed(() => !!text.value.trim() && (!!selected.value || !!validRange.value))
const canSave = computed(() => !!selected.value || (!!name.value.trim() && !!sample.value && previewJob.value?.status === 'completed'))
const previewHint = computed(() => !selected.value && !original.value ? '先上传或录制一段声音' : !selected.value && !validRange.value ? '请先选取 1～15 秒参考片段' : !text.value.trim() ? '请输入试听台词' : '可编辑上方台词，试听不会改变角色绑定')

watch([start, end, denoise], () => { sample.value = null; previewId.value = null })
watch([selected, speed, language, text], () => { previewId.value = null; stopSpeech() })
watch([() => props.modelValue, () => props.character?.id], async ([open, characterId]) => {
  const current = ++session
  controller?.abort(); stopSpeech(); busy.value = false
  recorderOpen.value = false
  if (!open || !characterId) return
  advancedOpen.value = false; speed.value = 1; language.value = 'zh'; notes.value = ''; transcript.value = ''; text.value = testLines[0].value
  error.value = ''; notice.value = ''; original.value = null; sample.value = null; previewId.value = null
  busy.value = true
  try {
    const [list, bound] = await Promise.all([ttsApi('/voices'), ttsApi(`/characters/${characterId}`)])
    if (current !== session) return
    voices.value = list; binding.value = bound; selected.value = bound?.voice_id || ''
    name.value = `${props.character.display_name} · 日常`
  } catch (e) { if (current === session) error.value = e.message }
  finally { if (current === session) busy.value = false }
}, { immediate: true })
async function perform(action, fn) {
  const current = session
  busy.value = true; operation.value = action; error.value = ''; notice.value = ''
  try { await fn(() => current === session) }
  catch (e) { if (current === session && e.name !== 'AbortError') error.value = e.message }
  finally { if (current === session) { busy.value = false; operation.value = '' } }
}
function upload(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  importRecording(file)
}
function openRecorder() { stopSpeech(); recorderOpen.value = true }
function importRecording(file) {
  perform('upload', async current => {
    const result = await uploadVoice(file)
    if (!current()) return
    stopSpeech(); sample.value = null; previewId.value = null
    original.value = result; start.value = 0; end.value = Math.min(result.duration, 12)
    notice.value = '素材已导入，请选取参考片段，再生成试听。'
  })
}
function beginDrag(event, edge) {
  if (busy.value) return
  dragging.value = edge
  event.currentTarget.ownerSVGElement.setPointerCapture(event.pointerId)
}
function moveHandle(event) {
  if (!dragging.value || busy.value) return
  const box = event.currentTarget.getBoundingClientRect()
  const seconds = Math.round(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * original.value.duration * 10) / 10
  setEdge(dragging.value, seconds)
}
function setEdge(edge, seconds) {
  if (edge === 'start') start.value = Math.max(0, Math.min(seconds, end.value - 1))
  else end.value = Math.min(original.value.duration, Math.max(seconds, start.value + 1))
}
function adjust(edge, delta) { if (!busy.value) setEdge(edge, (edge === 'start' ? start.value : end.value) + delta) }
function playOriginal(event) {
  speechPlayer.adopt(event.target)
  if (loop.value && validRange.value && (event.target.currentTime < start.value || event.target.currentTime >= end.value)) event.target.currentTime = start.value
}
function loopOriginal(event) { if (loop.value && validRange.value && event.target.currentTime >= end.value) event.target.currentTime = start.value }
async function restartOriginal(event) {
  if (!props.modelValue || !loop.value || !validRange.value) return
  event.target.currentTime = start.value
  try { await event.target.play() } catch { error.value = '浏览器暂停了循环试听，请手动点击播放' }
}
function crop() {
  perform('crop', async current => {
    const result = await ttsApi(`/samples/${original.value.id}/crop`, { start: start.value, end: end.value, denoise: denoise.value })
    if (current()) { sample.value = result; previewId.value = null }
  })
}
function preview() {
  if (busy.value || !canPreview.value) return
  perform('preview', async current => {
    controller = new AbortController()
    if (!selected.value && !sample.value) {
      const cropped = await ttsApi(`/samples/${original.value.id}/crop`, { start: start.value, end: end.value, denoise: denoise.value }, 'POST', controller.signal)
      if (!current()) return
      sample.value = cropped
    }
    const result = await ttsApi('/preview', { voice_id: selected.value || undefined, sample_id: sample.value?.id, text: text.value, speed: speed.value, language: language.value }, 'POST', controller.signal)
    if (!current()) return
    previewId.value = result.id; speechJobs[result.id] = result
    await waitSpeech(result, controller.signal)
  })
}
function save() {
  if (busy.value || !canSave.value) return
  const characterId = props.character.id
  perform('save', async current => {
    let voiceId = selected.value
    if (!voiceId) {
      const voice = await ttsApi('/voices', { sample_id: sample.value.id, name: name.value, speed: speed.value, language: language.value, notes: notes.value, transcript: transcript.value })
      voiceId = voice.id
      if (!current()) return
      // If binding fails, retry uses the saved asset instead of creating duplicates.
      voices.value.push(voice); selected.value = voice.id
    }
    await ttsApi(`/characters/${characterId}`, { voice_id: voiceId }, 'PUT')
    if (current()) { emit('saved'); emit('update:modelValue', false) }
  })
}
function unbind() {
  perform('save', async current => {
    await ttsApi(`/characters/${props.character.id}`, { voice_id: null }, 'PUT')
    if (current()) { binding.value = null; notice.value = '已解除声音绑定'; emit('saved') }
  })
}
onBeforeUnmount(() => { session++; controller?.abort(); stopSpeech() })
</script>

<style scoped>
.voice-manager, .voice-fields, .voice-field { display:flex; flex-direction:column; gap:12px; min-width:0; }
.voice-manager { color:var(--text-primary); gap:20px; }
.voice-field { gap:7px; font-size:var(--fs-xs); }
.voice-range { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.voice-manager audio { width:100%; max-width:100%; }
.voice-wave { width:100%; height:100px; background:var(--bg-sunken); border-radius:var(--radius-sm); touch-action:none; overflow:visible; }
.wave-line { stroke:var(--text-secondary); stroke-width:2; }
.wave-selection { fill:var(--accent); opacity:0.18; pointer-events:none; }
.wave-handle { fill:var(--accent); opacity:0.65; cursor:ew-resize; }
.wave-handle:focus { outline:2px solid var(--text-primary); }
.voice-advanced { padding-top:12px; }
.voice-error { color:var(--danger); overflow-wrap:anywhere; }
.voice-content-enter-active, .voice-content-leave-active { transition:opacity .3s ease, transform .3s ease; }
.voice-content-enter-from, .voice-content-leave-to { opacity:0; transform:translateY(4px); }
@media (max-width:480px) { .voice-range { gap:8px; } }

.voice-intro,.voice-section-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px 16px; }
.voice-intro,.voice-section-heading span,.voice-hint,.voice-manager .fd { font-size:var(--fs-xs); color:var(--text-secondary); line-height:1.6; margin:0; }
.voice-section-heading h4 { margin:0; font-size:var(--fs-sm); font-weight:700; }
.voice-source-actions { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.voice-source-actions > div { display:flex; align-items:flex-start; flex-direction:column; gap:8px; padding:16px; background:var(--bg-sunken); border:1px solid var(--border); border-radius:var(--radius-lg); }
.voice-source-actions p { margin:0; color:var(--text-secondary); font-size:var(--fs-xs); line-height:1.6; }
.voice-clip-options,.voice-inline-action,.voice-presets,.voice-footer-actions { display:flex; align-items:center; flex-wrap:wrap; gap:12px; }
.voice-clip-options { justify-content:space-between; }
.voice-test { padding-top:20px; border-top:1px solid var(--border); }
.voice-advanced { border-top:1px solid var(--border); }
.voice-manager audio { height:40px; }
.voice-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; width:100%; }
.voice-footer-actions { margin-left:auto; }
@media(max-width:480px) { .voice-source-actions { grid-template-columns:1fr; } .voice-source-actions > div { padding:12px; } .voice-footer > .voice-hint { width:100%; } }
</style>
