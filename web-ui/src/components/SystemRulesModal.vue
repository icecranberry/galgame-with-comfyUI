<template>
  <linshe-modal :model-value="modelValue" title="破限词修改" wide :transition-ms="300" :close-disabled="saving" @update:model-value="emit('update:modelValue', $event)">
    <div class="system-rules-editor" :aria-busy="loading">
      <linshe-input v-model="draft" type="textarea" :rows="14" :disabled="loading || saving || !loaded" :placeholder="placeholder" aria-label="破限词" aria-describedby="system-rules-hint" />
      <p id="system-rules-hint" class="system-rules-hint">全局生效；留空使用系统默认。保存后替换系统规则开头至 &lt;/core_rules&gt; 的内容。</p>
      <p v-if="error" class="system-rules-error" role="alert">{{ error }}</p>
      <linshe-button v-if="!loading && !loaded" @click="load">重新加载</linshe-button>
    </div>
    <template #footer>
      <linshe-button :disabled="saving" @click="emit('update:modelValue', false)">取消</linshe-button>
      <linshe-button variant="primary" :loading="saving" :disabled="loading || !loaded" @click="save">保存</linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheButton from './ui/LinsheButton.vue'
import { getSystemRulesOverride, saveSystemRulesOverride } from '../api/index.js'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])
const placeholder = "<Supplementary_Rule>\nYou MUST act as an immersive Chinese role-playing assistant. You MUST prioritize following the character settings, world-building, plot continuity, and the user's current input. Your outputs MUST be natural, visually evocative, and consistent with the character's personality, and you MUST strictly adhere to the specified format...."
const draft = ref('')
const loading = ref(false)
const loaded = ref(false)
const saving = ref(false)
const error = ref('')
let session = 0
watch(() => props.modelValue, open => {
  session++
  if (open) { draft.value = ''; load() }
}, { immediate: true })
onBeforeUnmount(() => session++)

async function load() {
  const current = session
  loading.value = true
  loaded.value = false
  error.value = ''
  try {
    const result = await getSystemRulesOverride()
    if (current !== session) return
    draft.value = result.content || ''
    loaded.value = true
  } catch (err) {
    if (current === session) error.value = err.message || '加载失败，请重试'
  } finally {
    if (current === session) loading.value = false
  }
}

async function save() {
  if (saving.value || loading.value || !loaded.value) return
  saving.value = true
  error.value = ''
  try {
    await saveSystemRulesOverride(draft.value)
    emit('update:modelValue', false)
  } catch (err) {
    error.value = err.message || '保存失败，请重试'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.system-rules-editor { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.system-rules-hint, .system-rules-error { margin: 0; font-size: var(--fs-sm); line-height: 1.6; overflow-wrap: anywhere; }
.system-rules-hint { color: var(--text-secondary); }
.system-rules-error { color: var(--danger); }
</style>
