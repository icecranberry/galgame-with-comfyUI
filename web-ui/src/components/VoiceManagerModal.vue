<template>
  <linshe-modal :model-value="modelValue && !recorderOpen" :title="`${character?.display_name || '角色'}的声音`" wide :transition-ms="300" @update:model-value="$emit('update:modelValue', $event)">
    <div class="voice-manager">
      <SpeechSettings />
      <div class="voice-intro"><div><span>角色当前使用</span><strong>{{ voicesLoading ? '正在读取…' : binding?.name || '尚未设置声音' }}</strong></div><span>{{ binding ? '新声音保存后自动使用' : '试听满意后，保存给这个角色' }}</span></div>
      <div class="voice-section-heading"><h4>选择声音素材</h4><span>参考对白建议 6～12 秒</span></div>
      <linshe-tabs v-if="voices.length" v-model="sourceMode" :options="sourceModes" :disabled="busy" aria-label="声音素材来源" />
      <Transition name="voice-content" mode="out-in">
        <p v-if="voicesLoading" key="loading" class="voice-hint" role="status">正在读取角色声音…</p>
        <div v-else-if="!selected" key="new" class="voice-fields">
          <div class="voice-source-actions">
            <div><linshe-button :disabled="busy" @click="openRecorder">录制系统声音</linshe-button><p>打开置顶小窗，录下正在播放的对白</p></div>
            <div><linshe-button :loading="busy && operation === 'upload'" :disabled="busy" @click="chooseFile">{{ original ? '更换音频文件' : '上传音频文件' }}</linshe-button><p>音频文件 · 25MB / 120 秒以内</p></div>
          </div>
          <div ref="uploadPicker" hidden><linshe-input type="file" accept="audio/*" :disabled="busy" tabindex="-1" @change="upload" /></div>
          <template v-if="original">
            <div class="voice-section-heading"><div><h4>新素材 · 尚未保存</h4><p class="voice-hint">{{ sourceName }}</p></div><span>原音 {{ original.duration.toFixed(1) }} 秒</span></div>
            <VoiceAudioPlayer ref="sourceAudio" :src="original.preview_url" preload="metadata" label="原音试听" @play="playOriginal" @timeupdate="loopOriginal" @ended="restartOriginal" />
            <div class="voice-section-heading"><h4>选取参考片段</h4><span>拖动两端，保留 1～15 秒对白</span></div>
            <svg class="voice-wave" viewBox="0 0 720 100" role="group" aria-label="拖动左右端点选择参考片段" @pointermove="moveHandle" @pointerup="dragging = ''" @pointercancel="dragging = ''">
              <line v-for="(peak, i) in original.peaks" :key="i" :x1="i * 3 + 1" :x2="i * 3 + 1" :y1="50 - Math.max(2, peak * 46)" :y2="50 + Math.max(2, peak * 46)" class="wave-line" />
              <rect :x="start / original.duration * 720" y="0" :width="(end - start) / original.duration * 720" height="100" class="wave-selection" />
              <rect
v-for="edge in ['start', 'end']" :key="edge" :x="(edge === 'start' ? start : end) / original.duration * 720 - 10" y="0" width="20" height="100" class="wave-handle"
                role="slider" tabindex="0" :aria-label="edge === 'start' ? '片段开始时间' : '片段结束时间'" aria-valuemin="0" :aria-valuemax="original.duration" :aria-valuenow="edge === 'start' ? start : end"
                @pointerdown.prevent="beginDrag($event, edge)" @keydown.left.prevent="adjust(edge, -0.1)" @keydown.right.prevent="adjust(edge, 0.1)"
/>
            </svg>
            <p class="fd" role="status">{{ validRange ? `已选择 ${(end - start).toFixed(1)} 秒` : '请选择原音范围内 1～15 秒的片段' }}</p>
            <div class="voice-inline-action"><linshe-button size="sm" :loading="busy && operation === 'crop'" :disabled="busy || !validRange" @click="crop">试听处理后的片段</linshe-button><span class="voice-hint">生成试听时会自动处理选段</span></div>
          </template>
          <section v-if="sample" class="voice-reference" aria-label="处理后的参考音">
            <div class="voice-section-heading"><h4>处理后的参考音</h4><span>{{ sample.duration.toFixed(1) }} 秒</span></div>
            <VoiceAudioPlayer :src="sample.reference_url" label="处理后的参考音试听" @play="speechPlayer.adopt($event.target)" />
            <p v-for="warning in sample.warnings" :key="warning" class="fd">{{ warning }}</p>
          </section>
          <label class="voice-field">音色名称<linshe-input v-model="name" maxlength="80" :disabled="busy" /></label>
        </div>
        <div v-else key="existing" class="voice-fields">
          <label class="voice-field">已存音色<linshe-select :model-value="selected" :disabled="busy" :options="voiceOptions" @update:model-value="selectVoice" /></label>
          <div class="voice-section-heading"><h4>{{ selectedVoice?.name }}</h4><span>{{ selected === binding?.voice_id ? '当前角色正在使用' : '选择后立即使用' }}</span></div>
          <VoiceAudioPlayer :src="selectedVoice?.reference_url" label="已有音色参考试听" @play="speechPlayer.adopt($event.target)" />
          <div class="voice-inline-action"><linshe-button variant="danger" size="sm" :disabled="busy" :loading="busy && operation === 'delete'" @click="deleteSelectedVoice">删除音色</linshe-button></div>
        </div>
      </Transition>
      <section class="voice-advanced" :class="{ 'is-open': advancedOpen }" aria-label="音色高级参数">
        <div class="voice-advanced-heading" role="button" tabindex="0" :aria-expanded="advancedOpen" aria-controls="voice-advanced-fields" @click="advancedOpen = !advancedOpen" @keydown.enter.prevent="advancedOpen = !advancedOpen" @keydown.space.prevent="advancedOpen = !advancedOpen">
          <h4>高级参数</h4>
          <span class="voice-advanced-status">{{ parametersDirty ? '参数已修改，尚未保存' : isDefaultParameters ? '使用默认参数' : '使用此音色的专属参数' }}</span>
          <svg class="voice-advanced-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </div>
        <div id="voice-advanced-fields" class="voice-advanced-content" :aria-hidden="!advancedOpen" :inert="!advancedOpen">
          <div class="voice-advanced-clip">
          <div class="voice-advanced-body">
            <p class="voice-hint">仅调整当前音色。先生成试听确认效果，保存后用于聊天朗读；未保存的修改会在关闭或切换音色时丢弃。</p>
            <div class="voice-parameter-grid">
              <label v-for="field in parameterFields" :key="field.key" class="voice-field">
                <span class="voice-parameter-label"><span>{{ field.label }} <span class="voice-parameter-key">{{ field.key }}</span></span><output :for="`voice-param-${field.key}`" class="voice-parameter-value">{{ field.step === 1 ? generationParams[field.key] : generationParams[field.key].toFixed(2) }}</output></span>
                <linshe-slider :id="`voice-param-${field.key}`" v-model="generationParams[field.key]" :min="field.min" :max="field.max" :step="field.step" :disabled="busy || voicesLoading" :aria-label="field.label + ' ' + field.key" />
                <span class="voice-hint">{{ field.hint }}</span>
              </label>
            </div>
            <p v-if="!parametersValid" class="voice-hint voice-parameter-error" role="alert">请按提示范围填写参数，候选数量和搜索束数必须为整数。</p>
            <div class="voice-inline-action">
              <linshe-button variant="ghost" size="sm" :disabled="busy || voicesLoading || isDefaultParameters" @click="resetParameters">恢复默认</linshe-button>
              <linshe-button v-if="selected" size="sm" :disabled="busy || voicesLoading || !parametersDirty || !parametersValid" :loading="busy && operation === 'parameters'" @click="saveParameters">保存音色参数</linshe-button>
              <span v-else class="voice-hint">参数将随新音色一起保存</span>
            </div>
          </div>
          </div>
        </div>
      </section>
      <section class="voice-fields voice-test">
      <div class="voice-section-heading"><h4>听听效果</h4><span>换一句台词，确认声音是否合适</span></div>
      <Transition name="voice-content">
        <div v-if="previewJob?.audio_url" class="voice-preview-result">
          <VoiceAudioPlayer ref="previewAudio" :src="previewJob.audio_url" preload="metadata" label="合成试听" @play="playPreview" />
          <p v-if="playbackHint" class="voice-hint" role="status">{{ playbackHint }}</p>
        </div>
      </Transition>
      <p class="voice-preview-source" role="status">本次试听：<strong>{{ auditionSource }}</strong></p>
      <div class="voice-presets"><linshe-button v-for="line in testLines" :key="line.label" variant="chip" size="sm" :active="text === line.value" :disabled="busy" @click="text = line.value">{{ line.label }}</linshe-button></div>
      <linshe-input v-model="text" type="textarea" :rows="3" maxlength="1000" :disabled="busy" aria-label="自定义试听台词" />
      <div class="voice-inline-action"><linshe-button :loading="busy && operation === 'preview'" :disabled="busy || !canPreview" @click="preview">{{ previewJob?.status === 'completed' ? '重新生成试听' : '生成试听' }}</linshe-button><linshe-button v-if="busy && operation === 'preview'" variant="ghost" size="sm" @click="cancelPreview">取消试听</linshe-button><span class="voice-hint" role="status">{{ previewJob ? statusLabels[previewJob.status] : previewHint }}</span></div>
      </section>
      <Transition name="voice-content" mode="out-in">
        <p v-if="error" key="error" class="voice-feedback voice-error" role="alert">{{ error }}</p>
        <p v-else-if="notice" key="notice" class="voice-feedback" role="status">{{ notice }}</p>
      </Transition>
    </div>
    <template #footer>
      <div class="voice-footer">
<span class="voice-hint">{{ selected ? '选择音色后立即用于聊天朗读' : '先生成试听，保存后自动使用' }}</span><div class="voice-footer-actions">
      <linshe-button v-if="selected" :disabled="busy" @click="$emit('update:modelValue', false)">完成</linshe-button>
      <linshe-button v-else variant="primary" :disabled="busy || !canSave" :loading="busy && operation === 'save'" @click="save">保存音色</linshe-button>
      </div>
</div>
    </template>
  </linshe-modal>
  <SystemAudioRecorder ref="recorderPanel" v-model="recorderOpen" @recorded="importRecording" @error="error = $event" />
</template>

<script setup>
import { computed, inject, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheSlider from './ui/LinsheSlider.vue'
import LinsheSelect from './ui/LinsheSelect.vue'
import LinsheTabs from './ui/LinsheTabs.vue'
import SystemAudioRecorder from './SystemAudioRecorder.vue'
import SpeechSettings from './SpeechSettings.vue'
import VoiceAudioPlayer from './VoiceAudioPlayer.vue'
import { ttsApi, uploadVoice } from '../api/tts.js'
import { speechEnabled, speechJobs, speechPlayer, stopSpeech, waitSpeech } from '../stores/speech.js'
import { createSpeechTask } from '../utils/speechTask.js'
const props = defineProps({ modelValue: Boolean, character: { type: Object, default: null } })
const emit = defineEmits(['update:modelValue', 'saved'])
const confirm = inject('confirm')
const voices = ref([]), binding = ref(null), selected = ref(''), original = ref(null), sample = ref(null)
const sourceName = ref(''), voicesLoading = ref(true)
const start = ref(0), end = ref(10), dragging = ref(''), sourceAudio = ref(null)
const name = ref('日常')
const voiceDefaults = { speed: 1, language: 'zh' }
const generationDefaults = { temperature: 0.8, top_k: 30, top_p: 0.9, num_beams: 3 }
const generationParams = ref({ ...generationDefaults }), advancedOpen = ref(false)
const parameterFields = [
  { key: 'temperature', label: '采样温度', min: 0.1, max: 1.5, step: 0.05, hint: '默认 0.8 · 范围 0.1～1.5，影响语调变化与稳定性' },
  { key: 'top_p', label: '概率范围', min: 0.1, max: 1, step: 0.05, hint: '默认 0.9 · 范围 0.1～1，影响采样候选范围' },
  { key: 'top_k', label: '候选数量', min: 0, max: 100, step: 1, hint: '默认 30 · 整数 0～100，0 表示不限制候选数量' },
  { key: 'num_beams', label: '搜索束数', min: 1, max: 5, step: 1, hint: '默认 3 · 整数 1～5，较高时通常更慢' },
]
function validParameter(field) {
  const value = generationParams.value[field.key]
  return typeof value === 'number' && Number.isFinite(value) && value >= field.min && value <= field.max && (field.step !== 1 || Number.isInteger(value))
}
const parametersValid = computed(() => parameterFields.every(validParameter))
const sameParameters = (a, b) => Object.keys(generationDefaults).every(key => a[key] === b[key])
const isDefaultParameters = computed(() => sameParameters(generationParams.value, generationDefaults))
const parametersDirty = computed(() => !sameParameters(generationParams.value, { ...generationDefaults, ...selectedVoice.value?.generation_params }))
function resetParameters() { generationParams.value = { ...generationDefaults } }
const busy = ref(false), operation = ref(''), error = ref(''), notice = ref(''), previewId = ref(null)
const recorderOpen = ref(false), recorderPanel = ref(null), uploadPicker = ref(null)
const previewAudio = ref(null), playbackHint = ref('')
function chooseFile() { uploadPicker.value?.querySelector('input')?.click() }
let previewTask, session = 0
const testLines = [
  { label: '日常问候', value: '今天过得怎么样？坐下来，和我聊聊吧。' },
  { label: '疑问句', value: '你说的那家咖啡馆，真的就在街角吗？' },
  { label: '稍长对白', value: '我原本想等雨停了再出门，后来发现，和你一起撑伞走回家也是件很开心的事。' },
]
const text = ref(testLines[0].value)
const statusLabels = { queued: '正在排队，等待显存可用…', generating: '正在生成试听…', completed: '合成试听已完成', failed: '试听失败，可以重试', cancelled: '已取消' }
const sourceModes = [{ label: '已存音色', value: 'existing' }, { label: '新声音', value: 'new' }]
const sourceMode = computed({
  get: () => selected.value ? 'existing' : 'new',
  set: value => { selected.value = value === 'existing' ? (voices.value.find(v => v.id === binding.value?.voice_id)?.id || voices.value[0]?.id || '') : '' },
})
const voiceOptions = computed(() => voices.value.map(v => ({ label: v.name, value: v.id })))
const selectedVoice = computed(() => voices.value.find(v => v.id === selected.value))
const auditionSource = computed(() => voicesLoading.value ? '正在读取声音素材…' : selected.value ? `已存音色 · ${selectedVoice.value?.name || ''}` : original.value ? `新素材 · ${sourceName.value}` : '等待录制或上传新素材')
const previewJob = computed(() => speechJobs[previewId.value])
watch(previewId, () => { playbackHint.value = '' })
const validRange = computed(() => original.value && Number.isFinite(start.value) && Number.isFinite(end.value) && start.value >= 0 && end.value <= original.value.duration && end.value - start.value >= 1 && end.value - start.value <= 15)
const canPreview = computed(() => parametersValid.value && speechEnabled.value && !!text.value.trim() && (!!selectedVoice.value || (!selected.value && !!validRange.value)))
const canSave = computed(() => parametersValid.value && !selected.value && !!name.value.trim() && !!sample.value && previewJob.value?.status === 'completed')
const previewHint = computed(() => !speechEnabled.value ? '请先开启上方的语音朗读开关' : !selected.value && !original.value ? '先上传或录制一段声音' : !selected.value && !validRange.value ? '请先选取 1～15 秒参考片段' : !text.value.trim() ? '请输入试听台词' : '首次生成需要加载模型，请稍候；试听不会更换当前声音')

watch([start, end], () => { sample.value = null; previewId.value = null; stopSpeech() })
watch([selected, text], () => { previewId.value = null; stopSpeech() })
watch(selected, () => { notice.value = ''; generationParams.value = { ...generationDefaults, ...selectedVoice.value?.generation_params } }, { flush: 'sync' })
watch(generationParams, () => { previewId.value = null; stopSpeech() }, { deep: true, flush: 'sync' })
watch([() => props.modelValue, () => props.character?.id], async ([open, characterId]) => {
  const current = ++session
  previewTask?.cancel().catch(() => {}); previewTask = null; stopSpeech(); busy.value = false; operation.value = ''
  recorderOpen.value = false
  if (!open || !characterId) return
  voicesLoading.value = true
  advancedOpen.value = false; resetParameters()
  text.value = testLines[0].value
  error.value = ''; notice.value = ''; original.value = null; sample.value = null; previewId.value = null
  voices.value = []; binding.value = null; selected.value = ''; sourceName.value = ''
  busy.value = true
  try {
    const [list, bound] = await Promise.all([ttsApi(`/voices?character_id=${characterId}`), ttsApi(`/characters/${characterId}`)])
    if (current !== session) return
    voices.value = list.filter(voice => voice.character_id === characterId)
    binding.value = voices.value.some(voice => voice.id === bound?.voice_id) ? bound : null
    selected.value = binding.value?.voice_id || ''
    name.value = nextVoiceName()
  } catch (e) { if (current === session) error.value = e.message }
  finally { if (current === session) { busy.value = false; voicesLoading.value = false } }
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
  return importRecording(file)
}
function openRecorder() {
  if (busy.value || selected.value) return
  stopSpeech(); error.value = ''; recorderOpen.value = true
  return recorderPanel.value?.open()
}
function nextVoiceName() {
  const base = `${props.character.display_name} · 日常`
  let value = base, suffix = 2
  while (voices.value.some(voice => voice.name === value)) value = `${base} ${suffix++}`
  return value
}
function importRecording(file) {
  if (busy.value) return
  stopSpeech(); previewId.value = null
  return perform('upload', async current => {
    const result = await uploadVoice(file)
    if (!current()) return
    stopSpeech(); sample.value = null; previewId.value = null
    if (selected.value || !original.value) name.value = nextVoiceName()
    selected.value = ''
    sourceName.value = `${file.name || '新录音'} · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
    original.value = result; start.value = 0; end.value = Math.min(result.duration, 12)
    notice.value = '已切换到新素材。接下来的试听使用这段声音，保存后自动用于聊天朗读。'
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
  if (validRange.value && (event.target.currentTime < start.value || event.target.currentTime >= end.value)) event.target.currentTime = start.value
}
function loopOriginal(event) { if (validRange.value && event.target.currentTime >= end.value) event.target.currentTime = start.value }
async function restartOriginal(event) {
  if (!props.modelValue || !validRange.value) return
  event.target.currentTime = start.value
  try { await event.target.play() } catch { error.value = '浏览器暂停了循环试听，请手动点击播放' }
}
function crop() {
  perform('crop', async current => {
    const result = await ttsApi(`/samples/${original.value.id}/crop`, { start: start.value, end: end.value })
    if (current()) { sample.value = result; previewId.value = null }
  })
}
function preview() {
  if (busy.value || !canPreview.value) return
  const playbackTicket = speechPlayer.begin()
  playbackHint.value = ''
  return perform('preview', async current => {
    const task = createSpeechTask({
      request: async signal => {
        if (!selected.value && !sample.value) {
          const cropped = await ttsApi(`/samples/${original.value.id}/crop`, { start: start.value, end: end.value }, 'POST', signal)
          if (signal.aborted || !current()) throw new DOMException('已取消试听', 'AbortError')
          sample.value = cropped
        }
        return ttsApi('/preview', { character_id: props.character.id, voice_id: selected.value || undefined, sample_id: sample.value?.id, text: text.value, ...voiceDefaults, generation_params: { ...generationParams.value } })
      },
      wait: waitSpeech,
      cancel: job => ttsApi(`/jobs/${job.id}/cancel`, {}),
      onJob: job => { speechJobs[job.id] = job; if (current()) previewId.value = job.id },
    })
    previewTask = task
    try {
      const result = await task.run()
      await nextTick()
      const audio = previewAudio.value?.media
      if (!current() || task.cancelled || !speechEnabled.value || !audio || previewId.value !== result.id || !speechPlayer.current(playbackTicket)) return
      audio.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      speechPlayer.adopt(audio)
      try { await audio.play() }
      catch {
        if (current() && !task.cancelled && previewId.value === result.id) playbackHint.value = '试听已生成，请点击播放按钮收听'
      }
    }
    finally { if (previewTask === task) previewTask = null }
  })
}
function playPreview(event) {
  speechPlayer.adopt(event.target)
  playbackHint.value = ''
}
async function cancelPreview() {
  stopSpeech()
  const current = session
  try { await previewTask?.cancel() }
  catch (e) { if (current === session) error.value = e.message }
}
function save() {
  if (busy.value || !canSave.value) return
  const characterId = props.character.id
  return perform('save', async current => {
    await ttsApi('/voices', { character_id: characterId, sample_id: sample.value.id, name: name.value, ...voiceDefaults, generation_params: { ...generationParams.value } })
    if (current()) { emit('saved'); emit('update:modelValue', false) }
  })
}
function saveParameters() {
  const voice = selectedVoice.value
  if (busy.value || !voice || !parametersValid.value || !parametersDirty.value) return
  return perform('parameters', async current => {
    const saved = await ttsApi(`/voices/${voice.id}/parameters`, { character_id: props.character.id, generation_params: { ...generationParams.value } }, 'PUT')
    if (!current()) return
    voices.value = voices.value.map(item => item.id === saved.id ? saved : item)
    notice.value = '音色参数已保存，之后的聊天朗读将使用这组参数。'
    emit('saved')
  })
}
function selectVoice(voiceId) {
  if (busy.value) return
  const voice = voices.value.find(item => item.id === voiceId)
  if (!voice) return
  if (binding.value?.voice_id === voiceId) { selected.value = voiceId; return }
  const characterId = props.character.id
  return perform('switch', async current => {
    await ttsApi(`/characters/${characterId}`, { voice_id: voiceId }, 'PUT')
    if (current()) { selected.value = voiceId; binding.value = { voice_id: voiceId, name: voice.name }; emit('saved') }
  })
}
function deleteSelectedVoice() {
  const voice = selectedVoice.value
  if (busy.value || !voice) return
  return perform('delete', async current => {
    if (!await confirm({ title: '删除音色', message: `删除「${voice.name}」？已生成的聊天语音会保留。`, okText: '删除', danger: true }) || !current()) return
    const result = await ttsApi(`/voices/${voice.id}`, {}, 'DELETE')
    if (!current()) return
    stopSpeech(); previewId.value = null
    voices.value = voices.value.filter(item => item.id !== voice.id)
    binding.value = result.current_voice
    selected.value = voices.value.find(item => item.id === binding.value?.voice_id)?.id || voices.value[0]?.id || ''
    notice.value = `已删除音色「${voice.name}」`; emit('saved')
  })
}
onBeforeUnmount(() => { session++; previewTask?.cancel().catch(() => {}); stopSpeech() })
</script>

<style scoped>
.voice-manager, .voice-fields, .voice-field { display:flex; flex-direction:column; min-width:0; }
.voice-manager { color:var(--text-primary); gap:18px; }
.voice-fields { gap:16px; padding:20px 0; border-top:1px solid var(--border); }
.voice-field { gap:8px; font-size:var(--fs-xs); color:var(--text-secondary); line-height:1.6; }
.voice-wave { width:100%; height:100px; background:var(--bg-sunken); border-radius:var(--radius-sm); touch-action:none; overflow:visible; }
.wave-line { stroke:var(--text-secondary); stroke-width:2; }
.wave-selection { fill:var(--accent); opacity:0.18; pointer-events:none; }
.wave-handle { fill:var(--accent); opacity:0.65; cursor:ew-resize; }
.wave-handle:focus { outline:2px solid var(--text-primary); }
.voice-reference { display:grid; gap:10px; min-width:0; }
.voice-preview-result { display:grid; gap:8px; min-width:0; scroll-margin-block:16px; }
.voice-feedback { margin:0; padding:10px 14px; border-left:3px solid var(--accent); border-radius:var(--radius-sm); background:var(--bg-sunken); color:var(--text-secondary); font-size:var(--fs-xs); line-height:1.6; overflow-wrap:anywhere; }
.voice-error { border-left-color:var(--danger); color:var(--danger); }
.voice-content-enter-active, .voice-content-leave-active { transition:opacity .3s ease, transform .3s ease; }
.voice-content-enter-from, .voice-content-leave-to { opacity:0; transform:translateY(4px); }

.voice-intro,.voice-section-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px 16px; }
.voice-intro { padding:0 0 18px; border-bottom:1px solid var(--border); }
.voice-intro > div { display:flex; flex-direction:column; gap:5px; min-width:0; }
.voice-intro strong { font-size:var(--fs-sm); color:var(--text-primary); overflow-wrap:anywhere; }
.voice-section-heading > div { min-width:0; }
.voice-intro,.voice-section-heading span,.voice-hint,.voice-manager .fd { font-size:var(--fs-xs); color:var(--text-secondary); line-height:1.6; margin:0; }
.voice-hint { overflow-wrap:anywhere; }
.voice-section-heading h4 { margin:0; font-size:var(--fs-sm); font-weight:700; }
.voice-source-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.voice-source-actions > div { padding:24px 16px; border:1px solid var(--border); border-radius:var(--radius-md); background:var(--bg-secondary); display:flex; flex-direction:column; align-items:center; gap:12px; text-align:center; }
.voice-source-actions p { margin:0; font-size:var(--fs-xs); color:var(--text-secondary); line-height:1.6; }
.voice-inline-action,.voice-presets,.voice-footer-actions { display:flex; align-items:center; flex-wrap:wrap; gap:12px; }
.voice-test { padding-bottom:0; }
.voice-advanced { border-top:1px solid var(--border); }
.voice-advanced-heading { display:flex; align-items:center; gap:12px; padding:16px 0; cursor:pointer; text-align:left; border-radius:var(--radius-sm); }
.voice-advanced-heading h4 { margin:0; font-size:var(--fs-sm); font-weight:700; }
.voice-advanced-heading:hover h4 { color:var(--accent); }
.voice-advanced-status { margin-left:auto; color:var(--text-secondary); font-size:var(--fs-xs); line-height:1.6; text-align:right; }
.voice-advanced-chevron { flex-shrink:0; color:var(--text-secondary); transition:transform .3s var(--ease-standard); }
.voice-advanced.is-open .voice-advanced-chevron { transform:rotate(180deg); }
.voice-advanced-content { display:grid; grid-template-rows:0fr; opacity:0; visibility:hidden; transition:grid-template-rows .3s var(--ease-standard), opacity .3s var(--ease-standard), visibility .3s; }
.voice-advanced.is-open .voice-advanced-content { grid-template-rows:1fr; opacity:1; visibility:visible; }
.voice-advanced-clip { min-height:0; overflow:hidden; }
.voice-advanced-body { display:grid; gap:16px; padding:0 0 4px; }
.voice-parameter-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.voice-parameter-key { font-size:var(--fs-xs); color:var(--text-secondary); margin-left:6px; }
.voice-parameter-label { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
.voice-parameter-value { flex-shrink:0; font-size:var(--fs-sm); font-weight:600; font-variant-numeric:tabular-nums; color:var(--text-primary); }
.voice-parameter-error { color:var(--danger); }
.voice-preview-source { margin:0; padding:10px 14px; border-left:3px solid var(--accent); background:var(--bg-sunken); border-radius:var(--radius-sm); font-size:var(--fs-xs); color:var(--text-secondary); line-height:1.6; overflow-wrap:anywhere; }
.voice-preview-source strong { color:var(--text-primary); font-weight:600; }
.voice-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; width:100%; }
.voice-footer-actions { margin-left:auto; }
@media(max-width:480px) { .voice-fields { padding-top:16px; gap:14px; } .voice-source-actions { grid-template-columns:minmax(0,1fr); } .voice-footer > .voice-hint { width:100%; } .voice-footer-actions { gap:8px; } }
@media(max-width:480px) { .voice-parameter-grid { grid-template-columns:minmax(0,1fr); } }
</style>
