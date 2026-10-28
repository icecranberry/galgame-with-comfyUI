<template>
  <section class="voice-api-editor" aria-label="角色 API 音色参数">
    <div class="voice-api-heading"><h4>角色 API 声音</h4><span>{{ saved ? `已保存 · ${saved.source === 'references' ? '参考音频克隆' : saved.voice}` : '尚未设置' }}</span></div>
    <p class="voice-api-hint">使用现有音色 ID，或通过参考音频克隆。克隆需服务商及模型支持硅基流动兼容扩展；API 素材独立保存，本地音频和参数保留。</p>
    <p v-if="loading" class="voice-api-hint" role="status">正在读取角色 API 参数…</p>
    <template v-else>
      <linshe-tabs v-model="source" size="sm" :options="sources" :disabled="busy" aria-label="API 音色来源" />
      <Transition name="voice-api-fade" mode="out-in">
        <div v-if="source === 'voice'" key="voice" class="voice-api-section">
          <label class="voice-api-field">音色 ID（voice）<linshe-input v-model="draft.voice" maxlength="200" :disabled="busy" placeholder="例如 alloy，或服务商返回的 speech:…" /></label>
          <linshe-button variant="link" size="sm" :disabled="busy" :aria-expanded="cloneOpen" @click="cloneOpen = !cloneOpen">{{ cloneOpen ? '收起参考音频' : '选择参考音频，创建音色 ID' }}</linshe-button>
        </div>
        <p v-else key="references" class="voice-api-hint">每次合成都会把参考音频及对应文本放入 references，不发送 voice，无需先创建音色 ID。</p>
      </Transition>
      <Transition name="voice-api-fade">
      <div v-if="source === 'references' || cloneOpen" class="voice-api-section voice-api-reference">
        <div class="voice-api-heading"><h4>API 参考音频</h4><span>{{ samples.length }} 份素材</span></div>
        <p class="voice-api-hint">建议 8～10 秒、单人清晰对白；最长 30 秒、25MB。上传到应用后可试听，创建 ID 或生成试听时才发送给服务商。</p>
        <label v-if="localVoices.length" class="voice-api-field">角色已有本地音频<linshe-select :model-value="localVoiceId" :options="localVoiceOptions" :disabled="busy" placeholder="直接选择角色已录入的声音" @update:model-value="useLocalReference" /><span class="voice-api-hint">直接复用已处理的参考片段，自动带入已存信息。</span></label>
        <label v-if="samples.length" class="voice-api-field">已上传的素材<linshe-select :model-value="referenceId" :options="sampleOptions" :disabled="busy" @update:model-value="selectReference" /></label>
        <div class="voice-api-actions"><linshe-button :disabled="busy" :loading="uploading" @click="chooseFile">{{ referenceId ? '上传另一段音频' : '上传参考音频' }}</linshe-button></div>
        <div ref="uploadPicker" hidden><linshe-input type="file" accept="audio/*" tabindex="-1" :disabled="busy" @change="upload" /></div>
        <VoiceAudioPlayer v-if="selectedSample" :src="selectedSample.preview_url" label="API 参考音频" @play="speechPlayer.adopt($event.target)" />
        <p v-if="selectedSample?.source === 'local'" class="voice-api-hint">已选用本地音频，无需填写参考台词。{{ referenceText ? '已自动带入原有台词。' : '将按空文本提交，请使用支持免台词克隆的 API 模型。' }}</p>
        <label v-else class="voice-api-field">参考音频对应文本（可选）<linshe-input v-model="referenceText" type="textarea" :rows="3" maxlength="4000" :disabled="busy" placeholder="IndexTTS 等免台词模型可留空，其他模型按服务商要求填写" /></label>
        <template v-if="source === 'voice'">
          <label class="voice-api-field">克隆音色名称<linshe-input v-model="cloneName" maxlength="80" :disabled="busy" placeholder="例如 日常声音" /></label>
          <div class="voice-api-actions"><linshe-button :disabled="busy || !referenceReady || !cloneName.trim()" :loading="cloning" @click="createClone">上传到 API 并创建音色 ID</linshe-button></div>
          <p class="voice-api-hint">使用全局设置中的音色上传地址、模型和 Key，返回的 ID 会填入草稿；保存后用于聊天朗读。</p>
        </template>
        <label v-if="cloneOptions.length" class="voice-api-field">已创建的音色 ID<linshe-select :model-value="''" :options="cloneOptions" :disabled="busy" placeholder="选择已创建的音色" @update:model-value="useClone" /><span class="voice-api-hint">选择后使用 voice 合成，请确认全局服务商与模型和创建时一致。</span></label>
      </div>
      </Transition>
      <label class="voice-api-field">语速（speed）<linshe-input v-model.number="draft.speed" type="number" :min="0.25" :max="4" :step="0.05" :disabled="busy" /><span class="voice-api-hint">0.25～4 倍，默认 1</span></label>
      <label class="voice-api-field">语音指令（instructions，可选）<linshe-input v-model="draft.instructions" type="textarea" :rows="3" maxlength="4000" :disabled="busy" placeholder="例如：语气温柔、自然，句尾稍作停顿。仅支持此参数的模型可用。" /></label>
      <label class="voice-api-field">附加参数（JSON，可选）<linshe-input v-model="extraText" type="textarea" :rows="3" maxlength="16000" :disabled="busy" placeholder="例如 {&quot;language&quot;:&quot;zh&quot;}，仅填写服务商支持的字段" /><span class="voice-api-hint">直接注入请求正文；请勿重复填写 input、model、voice、references、speed、instructions、response_format 或 stream。</span></label>
      <label class="voice-api-field">试听台词<linshe-input v-model="text" type="textarea" :rows="2" maxlength="1000" :disabled="busy" /></label>
      <div class="voice-api-actions">
        <linshe-button :disabled="busy || !speechEnabled || !valid || !text.trim()" :loading="previewing" @click="preview">生成试听</linshe-button>
        <linshe-button v-if="previewing" variant="ghost" size="sm" @click="cancel">取消试听</linshe-button>
        <linshe-button variant="primary" :disabled="busy || !valid || !dirty" :loading="saving" @click="save">保存 API 音色</linshe-button>
      </div>
      <p class="voice-api-hint">{{ !speechEnabled ? '请先在音色管理的全局设置中开启语音朗读，再生成试听。' : dirty ? '当前为未保存草稿，试听使用这些参数；保存后才改变聊天朗读。' : '已保存，聊天朗读将使用这组 API 参数。' }}</p>
      <VoiceAudioPlayer v-if="audioUrl" :src="audioUrl" label="API 声音试听" @play="speechPlayer.adopt($event.target)" />
    </template>
    <p v-if="error || validationError" class="voice-api-hint voice-api-error" role="alert">{{ error || validationError }}</p>
    <linshe-button v-if="loadFailed" variant="link" size="sm" @click="load">重新读取参数</linshe-button>
    <p v-if="notice" class="voice-api-hint" role="status">{{ notice }}</p>
  </section>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheTabs from './ui/LinsheTabs.vue'
import LinsheSelect from './ui/LinsheSelect.vue'
import VoiceAudioPlayer from './VoiceAudioPlayer.vue'
import { ttsApi, uploadApiReference } from '../api/tts.js'
import { speechEnabled, speechPlayer, stopSpeech, waitSpeech } from '../stores/speech.js'
import { createSpeechTask } from '../utils/speechTask.js'
const props = defineProps({ characterId: { type: Number, required: true }, connectionKey: { type: String, default: '' } })
const emit = defineEmits(['saved', 'busy'])
const draft = ref({ voice: '', speed: 1, instructions: '' }), extraText = ref('{}'), saved = ref(null)
const loading = ref(true), saving = ref(false), previewing = ref(false), loadFailed = ref(false)
const source = ref('voice'), referenceId = ref(''), referenceText = ref(''), samples = ref([])
const localVoices = ref([]), localVoiceId = ref('')
const localVoiceOptions = computed(() => localVoices.value.map(v => ({ value: v.id, label: `${v.name} · ${v.duration.toFixed(1)} 秒` })))
const cloneOpen = ref(false), cloneName = ref(''), uploading = ref(false), cloning = ref(false), uploadPicker = ref(null)
const sources = [{ label: '音色 ID', value: 'voice' }, { label: '直接传 references', value: 'references' }]
const sampleOptions = computed(() => samples.value.map(s => ({ value: s.id, label: `${s.name} · ${s.duration.toFixed(1)} 秒` })))
const selectedSample = computed(() => samples.value.find(s => s.id === referenceId.value))
const cloneOptions = computed(() => (selectedSample.value?.clones || []).map(c => ({ value: c.voice, label: `${c.name} · ${c.model}` })))
const referenceReady = computed(() => !!selectedSample.value)
const text = ref('今天过得怎么样？坐下来，和我聊聊吧。'), audioUrl = ref(''), error = ref(''), notice = ref('')
let session = 0, task
const busy = computed(() => loading.value || saving.value || previewing.value || uploading.value || cloning.value)
watch(busy, value => emit('busy', value), { immediate: true })
const validationError = computed(() => {
  if (!Number.isFinite(draft.value.speed) || draft.value.speed < 0.25 || draft.value.speed > 4) return '语速必须在 0.25～4 倍之间'
  try { const extra = JSON.parse(extraText.value || '{}'); if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return '附加参数必须是 JSON 对象' }
  catch { return '附加参数不是有效的 JSON' }
  return ''
})
const valid = computed(() => !loadFailed.value && (source.value === 'references' ? referenceReady.value : !!draft.value.voice.trim()) && !validationError.value)
const payload = () => ({ ...draft.value, voice: draft.value.voice.trim(), instructions: draft.value.instructions.trim(), extra: JSON.parse(extraText.value || '{}'),
  source: source.value, references: referenceReady.value ? [{ sample_id: referenceId.value, text: referenceText.value.trim() }] : [] })
const dirty = computed(() => !saved.value || !valid.value || JSON.stringify(payload()) !== JSON.stringify(saved.value))
watch([draft, source, referenceId, referenceText, extraText, text, () => props.connectionKey], () => { audioUrl.value = ''; notice.value = ''; stopSpeech() }, { deep: true })
async function load() {
  const current = ++session
  saving.value = false; previewing.value = false; uploading.value = false; cloning.value = false
  task?.cancel().catch(() => {}); stopSpeech(); loading.value = true; loadFailed.value = false; error.value = ''; notice.value = ''; audioUrl.value = ''; saved.value = null
  try {
    const [result, assets, local] = await Promise.all([ttsApi(`/characters/${props.characterId}/api-voice`), ttsApi(`/characters/${props.characterId}/api-samples`), ttsApi(`/characters/${props.characterId}/api-local-voices`)])
    if (current !== session) return
    samples.value = assets || []
    localVoices.value = local || []; localVoiceId.value = ''
    source.value = result?.params.source || 'voice'
    referenceId.value = result?.params.references?.[0]?.sample_id || ''
    referenceText.value = result?.params.references?.[0]?.text || ''
    cloneOpen.value = false; cloneName.value = selectedSample.value?.name.slice(0, 80) || ''
    draft.value = { voice: result?.params.voice || '', speed: result?.params.speed ?? 1, instructions: result?.params.instructions || '' }
    extraText.value = JSON.stringify(result?.params.extra || {}, null, 2)
    saved.value = result ? payload() : null
  } catch (e) { if (current === session) { error.value = e.message; loadFailed.value = true } }
  finally { if (current === session) loading.value = false }
}
watch(() => props.characterId, load, { immediate: true })
function chooseFile() { uploadPicker.value?.querySelector('input')?.click() }
function selectReference(id) {
  if (id === referenceId.value) return
  referenceId.value = id
  referenceText.value = selectedSample.value?.transcript || selectedSample.value?.clones?.[0]?.transcript || ''
  cloneName.value = selectedSample.value?.name.slice(0, 80) || ''; localVoiceId.value = ''
}
async function useLocalReference(voiceId) {
  if (busy.value) return
  const current = session
  uploading.value = true; error.value = ''; notice.value = ''
  try {
    const sample = await ttsApi(`/characters/${props.characterId}/api-samples/from-local`, { voice_id: voiceId })
    if (current !== session) return
    if (!samples.value.some(s => s.id === sample.id)) samples.value.unshift(sample)
    referenceId.value = sample.id; referenceText.value = sample.transcript || ''; cloneName.value = sample.name.slice(0, 80); localVoiceId.value = voiceId
  } catch (e) { if (current === session) error.value = e.message }
  finally { if (current === session) uploading.value = false }
}
async function upload(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file || busy.value) return
  const current = session, characterId = props.characterId
  uploading.value = true; error.value = ''; notice.value = ''
  try {
    const sample = await uploadApiReference(characterId, file)
    if (current !== session) return
    samples.value.unshift(sample); referenceId.value = sample.id; referenceText.value = ''; cloneName.value = sample.name.slice(0, 80); localVoiceId.value = ''
  } catch (e) { if (current === session) error.value = e.message }
  finally { if (current === session) uploading.value = false }
}
function useClone(voice) { draft.value.voice = voice; source.value = 'voice' }
async function createClone() {
  if (busy.value || !referenceReady.value || !cloneName.value.trim()) return
  const current = session, sample = selectedSample.value
  cloning.value = true; error.value = ''; notice.value = ''
  try {
    const result = await ttsApi(`/characters/${props.characterId}/api-clones`, { sample_id: sample.id, name: cloneName.value.trim(), text: referenceText.value.trim() })
    if (current !== session) return
    sample.clones ||= []; sample.clones.unshift(result)
    draft.value.voice = result.voice
    // Let draft watchers invalidate the old preview before showing the result.
    await nextTick()
    if (current === session) notice.value = '音色 ID 已创建并填入，请试听后保存 API 音色'
  } catch (e) { if (current === session) error.value = e.message }
  finally { if (current === session) cloning.value = false }
}
async function save() {
  if (busy.value || !valid.value) return
  const current = session
  saving.value = true; error.value = ''; notice.value = ''
  try {
    const result = await ttsApi(`/characters/${props.characterId}/api-voice`, payload(), 'PUT')
    if (current === session) { saved.value = result.params; notice.value = 'API 音色已保存，本地音色与参数保留不变'; emit('saved') }
  } catch (e) { if (current === session) error.value = e.message }
  finally { if (current === session) saving.value = false }
}
async function preview() {
  if (busy.value || !valid.value || !speechEnabled.value || !text.value.trim()) return
  const current = session
  previewing.value = true; error.value = ''; notice.value = ''; audioUrl.value = ''; stopSpeech()
  const active = createSpeechTask({
    request: () => ttsApi('/preview', { character_id: props.characterId, api_params: payload(), text: text.value }),
    wait: waitSpeech, cancel: job => ttsApi(`/jobs/${job.id}/cancel`, {}),
  })
  task = active
  try { const job = await active.run(); if (current === session && !active.cancelled) { audioUrl.value = job.audio_url; notice.value = '试听已生成，点击播放收听' } }
  catch (e) { if (current === session && e.name !== 'AbortError') error.value = e.message }
  finally { if (current === session) previewing.value = false; if (task === active) task = null }
}
async function cancel() { try { await task?.cancel() } catch (e) { error.value = e.message } }
onBeforeUnmount(() => { session++; task?.cancel().catch(() => {}); stopSpeech(); emit('busy', false) })
</script>
<style scoped>
.voice-api-editor { display:grid; gap:16px; min-width:0; }
.voice-api-section { display:grid; gap:12px; min-width:0; }
.voice-api-reference { padding-top:16px; border-top:1px solid var(--border); }
.voice-api-fade-enter-active,.voice-api-fade-leave-active { transition:opacity .3s ease,transform .3s ease; }
.voice-api-fade-enter-from,.voice-api-fade-leave-to { opacity:0; transform:translateY(4px); }
.voice-api-heading,.voice-api-actions { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
.voice-api-heading { justify-content:space-between; }
.voice-api-heading h4 { margin:0; color:var(--text-primary); font-size:var(--fs-sm); }
.voice-api-heading span,.voice-api-hint { margin:0; font-size:var(--fs-xs); color:var(--text-secondary); line-height:1.6; overflow-wrap:anywhere; }
.voice-api-field { display:flex; flex-direction:column; gap:8px; min-width:0; color:var(--text-secondary); font-size:var(--fs-xs); line-height:1.6; }
.voice-api-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.voice-api-error { color:var(--danger); }
@media(max-width:480px) { .voice-api-grid { grid-template-columns:minmax(0,1fr); } }
</style>
