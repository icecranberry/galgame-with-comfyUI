<template>
  <linshe-modal :model-value="modelValue && !detailOpen" title="音色管理" full :transition-ms="300" @update:model-value="$emit('update:modelValue', $event)">
    <div class="voice-library">
      <SpeechSettings @changed="onSettingsChanged" />
      <linshe-tabs v-if="mode === 'local'" v-model="tab" :options="tabs" aria-label="音色管理内容" />
      <Transition name="voice-library-content" mode="out-in">
      <section v-if="mode === 'api' || tab === 'characters'" :key="`characters-${mode}`" class="voice-library-section">
      <div class="voice-library-heading">
        <div><h4>角色音色</h4><p>{{ mode === 'api' ? '使用 API 音色 ID，或上传参考音频克隆角色声音。' : '上传或录制 6～12 秒清晰对白，无需填写参考台词。' }}</p></div>
        <span class="voice-library-count">已有声音 {{ boundCount }} / {{ characters.length }}</span>
      </div>
      <div class="voice-library-tools">
        <linshe-input v-model="query" placeholder="搜索角色或音色" aria-label="搜索角色或音色" />
        <linshe-select v-model="filter" :options="filters" aria-label="角色声音筛选" />
      </div>
      <p v-if="loading" role="status">正在读取角色声音…</p>
      <div v-else class="voice-library-grid">
        <div v-for="character in rows" :key="character.id" class="voice-library-row" :class="{ 'has-voice': bindings[character.id] }">
          <img v-if="character.avatar_path" :src="character.avatar_path" alt="" loading="lazy">
          <span v-else class="voice-library-avatar">{{ (character.display_name || character.name || '?')[0] }}</span>
          <div class="voice-library-meta">
            <strong :title="character.display_name || character.name">{{ character.display_name || character.name }}</strong>
            <span class="voice-library-status"><span aria-hidden="true">{{ bindings[character.id] ? '✓' : '–' }}</span>{{ bindings[character.id] ? '已有声音' : '未设置' }}</span>
            <span v-if="bindings[character.id]" class="voice-library-voice-name" :title="bindings[character.id].name">{{ bindings[character.id].name }}</span>
          </div>
          <linshe-button size="sm" :variant="bindings[character.id] ? 'secondary' : 'ghost'" @click="manage(character)">{{ bindings[character.id] ? '管理声音' : '添加声音' }}</linshe-button>
        </div>
        <p v-if="!rows.length" class="empty">{{ characters.length ? '没有符合筛选条件的角色' : '还没有角色，先去酒馆招募吧。' }}</p>
      </div>
      </section>
      <section v-else key="voices" class="voice-library-section">
        <div class="voice-library-heading"><div><h4>已存本地音色</h4><p>每个角色独立保存自己的音色。</p></div><span class="voice-library-count">{{ voices.length }} 个音色</span></div>
        <linshe-input v-model="voiceQuery" placeholder="搜索音色名称" aria-label="搜索已存音色" />
        <p v-if="loading" role="status">正在读取已存音色…</p>
        <div v-else class="voice-library-grid">
          <div v-for="voice in savedRows" :key="voice.id" class="voice-saved-row">
            <div class="voice-library-heading"><strong>{{ voice.name }}</strong><linshe-button variant="danger" size="sm" :disabled="!!deleting" :loading="deleting === voice.id" @click="deleteVoice(voice)">删除音色</linshe-button></div>
            <p>{{ ownerName(voice) }}{{ isActive(voice) ? ' · 当前使用' : '' }}</p>
            <VoiceAudioPlayer :src="voice.reference_url" preload="metadata" :label="`${voice.name}参考试听`" @play="speechPlayer.adopt($event.target)" />
          </div>
          <p v-if="!savedRows.length" class="empty">{{ voices.length ? '没有找到匹配的音色' : '还没有保存过音色' }}</p>
        </div>
      </section>
      </Transition>
      <p v-if="error" role="alert">{{ error }} <linshe-button variant="link" @click="refresh">重试</linshe-button></p>
      <p v-if="notice" class="voice-library-notice" role="status">{{ notice }}</p>
    </div>
  </linshe-modal>
  <VoiceManagerModal :model-value="modelValue && detailOpen" :character="selectedCharacter" @update:model-value="detailOpen = $event" />
</template>
<script setup>
import { computed, inject, ref, watch, onBeforeUnmount } from 'vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheSelect from './ui/LinsheSelect.vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheTabs from './ui/LinsheTabs.vue'
import VoiceManagerModal from './VoiceManagerModal.vue'
import SpeechSettings from './SpeechSettings.vue'
import VoiceAudioPlayer from './VoiceAudioPlayer.vue'
import { ttsApi } from '../api/tts.js'
import { speechPlayer, stopSpeech } from '../stores/speech.js'
const props = defineProps({ modelValue: Boolean, characters: { type: Array, default: () => [] } })
defineEmits(['update:modelValue'])
const query = ref(''), filter = ref('all'), bindings = ref({}), loading = ref(false), error = ref('')
const selectedCharacter = ref(null), detailOpen = ref(false)
const confirm = inject('confirm')
const tab = ref('characters'), voiceQuery = ref(''), voices = ref([]), deleting = ref(''), notice = ref('')
const mode = ref('local')
function onSettingsChanged(settings) { mode.value = settings.mode || 'local'; if (mode.value === 'api') tab.value = 'characters'; refresh() }
const tabs = [{ label: '角色声音', value: 'characters' }, { label: '已存音色', value: 'voices' }]
const savedRows = computed(() => voices.value.filter(voice => voice.name.toLowerCase().includes(voiceQuery.value.trim().toLowerCase())))
function ownerName(voice) {
  const character = props.characters.find(item => item.id === voice.character_id)
  return character?.display_name || character?.name || (voice.character_id ? `角色 ${voice.character_id}` : '历史音色 · 归属未确定')
}
function isActive(voice) { return bindings.value[voice.character_id]?.voice_id === voice.id }
const filters = [{ label: '全部角色', value: 'all' }, { label: '尚未设置', value: 'missing' }, { label: '已有声音', value: 'bound' }]
const boundCount = computed(() => props.characters.filter(c => bindings.value[c.id]).length)
const rows = computed(() => props.characters.filter(c => {
  const bound = bindings.value[c.id]
  return (filter.value === 'all' || (filter.value === 'bound' ? !!bound : !bound)) &&
    `${c.display_name || ''} ${c.name || ''} ${bound?.name || ''}`.toLowerCase().includes(query.value.trim().toLowerCase())
}))
let sequence = 0
async function refresh() {
  const current = ++sequence
  loading.value = true; error.value = ''
  try {
    const [rows, saved] = await Promise.all([ttsApi('/bindings'), mode.value === 'local' ? ttsApi('/voices') : Promise.resolve([])])
    if (current === sequence) { bindings.value = Object.fromEntries(rows.map(row => [row.character_id, row])); voices.value = saved }
  } catch (e) { if (current === sequence) error.value = e.message }
  finally { if (current === sequence) loading.value = false }
}
function manage(character) { selectedCharacter.value = character; detailOpen.value = true }
async function deleteVoice(voice) {
  if (deleting.value || loading.value) return
  const current = sequence
  deleting.value = voice.id; error.value = ''; notice.value = ''
  try {
    if (!await confirm({ title: '删除音色', message: `删除「${voice.name}」？已生成的聊天语音会保留。`, okText: '删除', danger: true }) || current !== sequence) return
    const result = await ttsApi(`/voices/${voice.id}`, {}, 'DELETE')
    if (current !== sequence) return
    if (voice.character_id && mode.value === 'local') {
      if (result.current_voice) bindings.value[voice.character_id] = result.current_voice
      else delete bindings.value[voice.character_id]
    }
    stopSpeech(); voices.value = voices.value.filter(item => item.id !== voice.id); notice.value = `已删除音色「${voice.name}」`
  } catch (e) { if (current === sequence) error.value = e.message }
  finally { if (current === sequence) deleting.value = '' }
}
watch(tab, () => { stopSpeech(); notice.value = '' })
watch(detailOpen, (open, previous) => { stopSpeech(); if (!open && previous && props.modelValue) refresh() })
watch(() => props.modelValue, open => { stopSpeech(); deleting.value = ''; notice.value = ''; if (open) { detailOpen.value = false; refresh() } else { sequence++; detailOpen.value = false } }, { immediate: true })
onBeforeUnmount(() => { sequence++; stopSpeech() })
</script>
<style scoped>
.voice-library,.voice-library-section { display:flex; flex-direction:column; gap:18px; min-width:0; }
.voice-saved-row { display:flex; flex-direction:column; gap:12px; padding:16px; border:1px solid var(--border); border-radius:var(--radius-md); }
.voice-saved-row strong { min-width:0; overflow-wrap:anywhere; color:var(--text-primary); }
.voice-saved-row p,.voice-library-notice { margin:0; color:var(--text-secondary); font-size:var(--fs-xs); line-height:1.6; overflow-wrap:anywhere; }
.voice-library-content-enter-active,.voice-library-content-leave-active { transition:opacity .3s ease,transform .3s ease; }
.voice-library-content-enter-from,.voice-library-content-leave-to { opacity:0; transform:translateY(4px); }
.voice-library-heading { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; }
.voice-library-heading h4 { margin:0 0 5px; font-size:var(--fs-sm); color:var(--text-primary); }
.voice-library-heading p { margin:0; font-size:var(--fs-xs); color:var(--text-secondary); line-height:1.6; }
.voice-library-count { font-size:var(--fs-xs); color:var(--text-secondary); white-space:nowrap; }
.voice-library-tools { display:grid; grid-template-columns:minmax(0,1fr) 160px; gap:12px; align-items:center; }
.voice-library-tools > * { min-width:0; }
.voice-library-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px; }
.voice-library-row { display:flex; gap:12px; align-items:center; padding:14px; border:1px solid var(--border); border-radius:var(--radius-md); background:var(--bg-sunken); }
.voice-library-row.has-voice { border-color:var(--accent); background:color-mix(in srgb,var(--accent) 7%,var(--bg-secondary)); }
.voice-library-row > .ls-btn { flex-shrink:0; }
.voice-library-row img,.voice-library-avatar { width:44px; height:44px; object-fit:cover; border-radius:var(--radius-full); flex-shrink:0; }
.voice-library-avatar { display:grid; place-items:center; background:var(--bg-primary); color:var(--accent); }
.voice-library-meta { display:flex; flex-direction:column; gap:5px; min-width:0; flex:1; }
.voice-library-meta strong,.voice-library-voice-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.voice-library-voice-name { font-size:var(--fs-xs); color:var(--text-secondary); }
.voice-library-status { display:inline-flex; align-items:center; align-self:flex-start; gap:4px; padding:2px 7px; border-radius:var(--radius-full); background:var(--bg-tertiary); color:var(--text-secondary); font-size:var(--fs-xs); line-height:1.5; white-space:nowrap; }
.has-voice .voice-library-status { background:color-mix(in srgb,var(--accent) 16%,var(--bg-secondary)); color:var(--accent-hover); font-weight:600; }
@media(max-width:480px) { .voice-library-grid,.voice-library-tools { grid-template-columns:1fr; } }
</style>
