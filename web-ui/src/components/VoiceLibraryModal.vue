<template>
  <linshe-modal :model-value="modelValue && !detailOpen" title="音色管理" full :transition-ms="300" @update:model-value="$emit('update:modelValue', $event)">
    <div class="voice-library">
      <SpeechSettings />
      <div class="voice-library-heading">
        <div><h4>角色音色</h4><p>上传或录制 6～12 秒清晰对白，无需填写参考台词。</p></div>
        <span class="voice-library-count">已绑定 {{ boundCount }} / {{ characters.length }}</span>
      </div>
      <div class="voice-library-tools">
        <linshe-input v-model="query" placeholder="搜索角色或音色" aria-label="搜索角色或音色" />
        <linshe-select v-model="filter" :options="filters" aria-label="音色绑定筛选" />
      </div>
      <p v-if="error" role="alert">{{ error }} <linshe-button variant="link" @click="refresh">重试</linshe-button></p>
      <p v-if="loading" role="status">正在读取角色声音…</p>
      <div v-else class="voice-library-grid">
        <div v-for="character in rows" :key="character.id" class="voice-library-row">
          <img v-if="character.avatar_path" :src="character.avatar_path" alt="" loading="lazy">
          <span v-else class="voice-library-avatar">{{ (character.display_name || character.name || '?')[0] }}</span>
          <div class="voice-library-meta"><strong>{{ character.display_name || character.name }}</strong><span>{{ bindings[character.id]?.name || '尚未设置声音' }}</span></div>
          <linshe-button size="sm" @click="manage(character)">管理声音</linshe-button>
        </div>
        <p v-if="!rows.length" class="empty">{{ characters.length ? '没有符合筛选条件的角色' : '还没有角色，先去酒馆招募吧。' }}</p>
      </div>
    </div>
  </linshe-modal>
  <VoiceManagerModal :model-value="modelValue && detailOpen" :character="selectedCharacter" @update:model-value="detailOpen = $event" @saved="refresh" />
</template>
<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheSelect from './ui/LinsheSelect.vue'
import LinsheButton from './ui/LinsheButton.vue'
import VoiceManagerModal from './VoiceManagerModal.vue'
import SpeechSettings from './SpeechSettings.vue'
import { ttsApi } from '../api/tts.js'
const props = defineProps({ modelValue: Boolean, characters: { type: Array, default: () => [] } })
defineEmits(['update:modelValue'])
const query = ref(''), filter = ref('all'), bindings = ref({}), loading = ref(false), error = ref('')
const selectedCharacter = ref(null), detailOpen = ref(false)
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
    const rows = await ttsApi('/bindings')
    if (current === sequence) bindings.value = Object.fromEntries(rows.map(row => [row.character_id, row]))
  } catch (e) { if (current === sequence) error.value = e.message }
  finally { if (current === sequence) loading.value = false }
}
function manage(character) { selectedCharacter.value = character; detailOpen.value = true }
watch(() => props.modelValue, open => { if (open) { detailOpen.value = false; refresh() } else { sequence++; detailOpen.value = false } }, { immediate: true })
onBeforeUnmount(() => { sequence++ })
</script>
<style scoped>
.voice-library { display:flex; flex-direction:column; gap:18px; }
.voice-library-heading { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; }
.voice-library-heading h4 { margin:0 0 5px; font-size:var(--fs-sm); color:var(--text-primary); }
.voice-library-heading p { margin:0; font-size:var(--fs-xs); color:var(--text-secondary); line-height:1.6; }
.voice-library-count { font-size:var(--fs-xs); color:var(--text-secondary); white-space:nowrap; }
.voice-library-tools { display:grid; grid-template-columns:minmax(0,1fr) 160px; gap:12px; align-items:center; }
.voice-library-tools > * { min-width:0; }
.voice-library-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px; }
.voice-library-row { display:flex; gap:12px; align-items:center; padding:14px; border:1px solid var(--border); border-radius:var(--radius-md); background:var(--bg-sunken); }
.voice-library-row img,.voice-library-avatar { width:44px; height:44px; object-fit:cover; border-radius:var(--radius-full); flex-shrink:0; }
.voice-library-avatar { display:grid; place-items:center; background:var(--bg-primary); color:var(--accent); }
.voice-library-meta { display:flex; flex-direction:column; gap:5px; min-width:0; flex:1; }
.voice-library-meta strong,.voice-library-meta span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.voice-library-meta span { font-size:var(--fs-xs); color:var(--text-secondary); }
@media(max-width:480px) { .voice-library-grid,.voice-library-tools { grid-template-columns:1fr; } }
</style>
