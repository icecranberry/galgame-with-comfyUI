<template>
  <div class="upgrade-tools">
    <linshe-button
      size="sm" :variant="isNew ? 'ghost' : 'secondary'" :disabled="disabled || open"
      :title="disabled ? '请先保存当前修改' : '重新生成人设，保留已有外观与记忆'" @click="start"
    >
重新生成
</linshe-button>
  </div>
  <linshe-modal
v-model="open" :title="character.display_name + ' · 重新生成人设'" wide :z-index="11000"
    :close-disabled="saving" @after-leave="clearDraft"
>
    <div v-if="source" class="source-status" role="status">
      <PersonaSourceStatus :source="source" />
    </div>
    <div class="persona-stage" :class="{ 'is-loading': generating }">
      <pre v-if="draft || generating" class="persona-preview" :aria-hidden="generating">{{ draft?.persona || originalPersona }}</pre>
      <Transition name="persona-fade">
        <RecruitScanOverlay v-if="generating" :text="progress" />
      </Transition>
    </div>
    <p v-if="error" class="generation-error" role="alert">{{ error }}</p>
    <template #footer>
      <linshe-button v-if="source || error" class="reorganize-button" variant="secondary" :disabled="generating || saving" @click="generate(!!source)">
        {{ source ? '重新整理' : '重试' }}
      </linshe-button>
      <linshe-button variant="primary" :loading="saving" :disabled="!draft || saving || generating" @click="confirmReplacement">确认替换</linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheModal from './ui/LinsheModal.vue'
import RecruitScanOverlay from './RecruitScanOverlay.vue'
import PersonaSourceStatus from './PersonaSourceStatus.vue'
import { generatePersonaDraft, applyCharacterPersona } from '../api/index.js'
import { useChatStore } from '../stores/chat.js'
import { isNewPersonaFormat, splitPersonaForUpgrade } from '../../../agent-core/src/shared/personaSectionUtils.js'

const props = defineProps({ character: { type: Object, required: true }, disabled: Boolean })
const emit = defineEmits(['busy', 'applied'])
const chat = useChatStore()
const isNew = computed(() => isNewPersonaFormat(props.character.base_prompt))
const open = ref(false)
const generating = ref(false)
const saving = ref(false)
const draft = ref(null)
const progress = ref('')
const error = ref('')
const source = ref('')
const originalBase = ref('')
const originalPersona = computed(() => splitPersonaForUpgrade(originalBase.value).persona)
let searchContext = ''
let request

function cancelRequest() {
  request?.abort()
  request = undefined
  generating.value = false
}
watch(open, value => {
  emit('busy', value)
  if (!value) cancelRequest()
}, { flush: 'sync' })
onBeforeUnmount(() => { cancelRequest(); emit('busy', false) })

function clearDraft() {
  draft.value = null
  source.value = ''
  searchContext = ''
  error.value = ''
}
function start() {
  if (props.disabled || open.value) return
  clearDraft()
  originalBase.value = props.character.base_prompt
  open.value = true
  void generate(false)
}

function updateStage(data) {
  if (data.stage === 'reference') {
    source.value = data.source
    searchContext = data.search_context
    return
  }
  const labels = {
    search: '正在爬取网络资料…',
    'search-akasha': '正在查询智慧宫角色资料…',
    'search-fallback': '智慧宫未取得资料，正在查询其他来源…',
    write: '已获得资料，正在整理网络资料…',
    'write-local': source.value === 'original' ? '正在塑造原创角色…' : '未找到网络资料，正在根据已有设定塑造角色…',
    validate: '正在校验人设格式…',
    'retry-format': '格式校验未通过，正在请求模型重写…',
  }
  if (labels[data.stage]) progress.value = labels[data.stage]
}

async function generate(reuse) {
  if (!open.value || generating.value || saving.value) return
  const controller = new AbortController()
  request = controller
  generating.value = true
  error.value = ''
  progress.value = reuse ? '正在读取本次资料…' : '正在读取角色卡…'
  try {
    const body = { expected_base_prompt: originalBase.value }
    if (reuse) body.search_context = searchContext
    const result = await generatePersonaDraft(props.character.id, body, data => {
      if (request === controller) updateStage(data)
    }, controller.signal)
    if (request !== controller) return
    if (!result?.persona || !result.source_revision) throw new Error('未收到完整人设，请重试')
    if (typeof result.search_context === 'string') {
      source.value = result.source || (result.search_context ? 'network' : 'not-found')
      searchContext = result.search_context
    }
    draft.value = result
  } catch (err) {
    if (request === controller) error.value = err.message
  } finally {
    if (request === controller) {
      request = undefined
      generating.value = false
    }
  }
}

async function confirmReplacement() {
  if (!open.value || generating.value || saving.value || !draft.value) return
  saving.value = true
  error.value = ''
  try {
    const { id, persona, source_revision } = draft.value
    const saved = await applyCharacterPersona(id, { persona, source_revision })
    const entry = chat.characters.find(item => item.id === saved.id)
    if (entry) Object.assign(entry, saved)
    emit('applied', saved)
    open.value = false
  } catch (err) {
    error.value = err.message
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.upgrade-tools { display: flex; justify-content: flex-end; margin-bottom: 8px; }
.reorganize-button { margin-inline-end: auto; }
.persona-stage { position: relative; }
.persona-stage.is-loading { height: clamp(160px, 32vh, 280px); overflow: hidden; }
.persona-preview { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font: inherit; line-height: 1.7; }
.source-status, .generation-error { font-size: var(--fs-sm); line-height: 1.5; }
.source-status { margin-bottom: 10px; color: var(--text-secondary); }
.generation-error { margin: 8px 0 0; color: var(--danger); }
.persona-fade-enter-active, .persona-fade-leave-active { transition: opacity .3s; }
.persona-fade-enter-from, .persona-fade-leave-to { opacity: 0; }
</style>
