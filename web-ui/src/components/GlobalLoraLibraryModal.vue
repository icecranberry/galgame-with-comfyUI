<template>
  <linshe-modal :model-value="modelValue" title="LoRA 库" wide :transition-ms="300" :close-disabled="saving" @update:model-value="close">
    <div class="library-toolbar">
      <p class="library-source-hint">
        <span>LoRA 获取：</span>
        <a class="library-source" href="https://civitai.red/search/models?baseModel=Anima&modelType=LORA&sortBy=models_v9&query=style" target="_blank" rel="noopener noreferrer">CivitAI.red 搜索Style</a>
        <span>（但实际上作者并不会都以Style为画风LoRA取名，可以自行寻找其他关键词）</span>
      </p>
      <linshe-button size="sm" :disabled="saving" @click="addLora">新增 LoRA</linshe-button>
    </div>

    <TransitionGroup name="library-row" tag="div" class="library-list" :inert="saving">
      <div v-for="item in rows" :key="item.key" class="library-item">
        <div class="library-file">
          <span class="library-label">文件路径</span>
          <linshe-select
            v-model="item.path"
            :options="fileOptions"
            size="sm"
            searchable
            allow-free-input
            aria-label="LoRA 文件路径"
            placeholder="搜索或输入 LoRA 文件路径"
          />
        </div>
        <div class="library-weight">
          <label class="library-label" :for="`${formId}-weight-${item.key}`">默认权重</label>
          <linshe-input :id="`${formId}-weight-${item.key}`" v-model.number="item.weight" size="sm" type="number" min="0" max="5" step="0.05" />
        </div>
        <div class="library-trigger">
          <label class="library-label" :for="`${formId}-trigger-${item.key}`">触发词</label>
          <linshe-input :id="`${formId}-trigger-${item.key}`" v-model="item.triggerWord" size="sm" placeholder="可选" autocomplete="off" />
        </div>
        <div class="library-note">
          <label class="library-label" :for="`${formId}-note-${item.key}`">备注</label>
          <linshe-input :id="`${formId}-note-${item.key}`" v-model="item.note" size="sm" autocomplete="off" />
        </div>
        <linshe-button variant="danger" size="sm" :aria-label="item.path ? `删除库中的 ${item.path}` : '删除空白 LoRA'" @click="rows = rows.filter(row => row.key !== item.key)">删除</linshe-button>
      </div>
    </TransitionGroup>
    <p v-if="!rows.length" class="library-message library-empty">LoRA 库为空。</p>
    <p v-if="error" class="library-message library-error" role="alert">{{ error }}</p>

    <template #footer>
      <linshe-button :disabled="saving" @click="close">取消</linshe-button>
      <linshe-button variant="primary" :loading="saving" @click="save">保存</linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
import { ref, watch, useId, inject } from 'vue'
import { fetchLorasFiles, updateGlobalLoraLibrary } from '../api/index.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheSelect from './ui/LinsheSelect.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  library: { type: Object, required: true },
})
const emit = defineEmits(['update:modelValue', 'saved'])
const toast = inject('toast')
const formId = useId()
const rows = ref([])
const fileOptions = ref([])
const saving = ref(false)
const error = ref('')
let nextKey = 0
let revision = 0

watch(() => props.modelValue, async (open, _previous, onCleanup) => {
  if (!open) return
  revision = props.library.revision
  rows.value = props.library.loras.map(item => ({ ...item, note: item.note ?? '', key: nextKey++ }))
  error.value = ''

  let cancelled = false
  onCleanup(() => { cancelled = true })
  try {
    const { files = [] } = await fetchLorasFiles()
    if (cancelled) return
    const options = new Map()
    for (const { name, source } of files) {
      if (!options.has(name)) options.set(name, { value: name, label: source ? `[${source}] ${name}` : name })
    }
    fileOptions.value = [...options.values()]
  } catch {
    // 无法列举 ComfyUI 文件时，仍可手动输入相对路径。
    if (!cancelled) fileOptions.value = []
  }
}, { immediate: true })

function addLora() {
  rows.value.unshift({ key: nextKey++, path: '', weight: 0.9, triggerWord: '', note: '' })
}

function close() {
  emit('update:modelValue', false)
}

async function save() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    const loras = rows.value.map(({ path, weight, triggerWord, note }) => ({ path, weight, triggerWord, note }))
    const data = await updateGlobalLoraLibrary(loras, revision)
    emit('saved', data.library)
    toast?.('LoRA 库已保存', 'success')
    close()
  } catch (cause) {
    error.value = cause.message
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.library-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 12px; margin-bottom: 12px; }
.library-source-hint { color: var(--text-secondary); font-size: var(--fs-sm); line-height: 1.6; overflow-wrap: anywhere; }
.library-source { color: var(--accent-hover); text-underline-offset: 3px; white-space: nowrap; }
.library-list { display: grid; gap: 8px; }
.library-item {
  display: grid;
  grid-template-columns: clamp(3.5rem, 18%, 5rem) minmax(0, 1fr) minmax(0, 1.35fr) auto;
  align-items: end;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
}
.library-file, .library-weight, .library-trigger, .library-note { display: grid; gap: 4px; min-width: 0; }
.library-file { grid-column: 1 / -1; }
.library-label { color: var(--text-primary); font-size: var(--fs-sm); line-height: 1.4; }
.library-message { color: var(--text-secondary); font-size: var(--fs-sm); line-height: 1.6; overflow-wrap: anywhere; }
.library-empty { padding: 12px 0; text-align: center; }
.library-error { margin-top: 10px; color: var(--danger); }
.library-row-enter-active, .library-row-leave-active { transition: opacity var(--dur-interaction) var(--ease-standard); }
.library-row-enter-from, .library-row-leave-to { opacity: 0; }
</style>
