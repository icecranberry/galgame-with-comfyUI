<template>
  <linshe-modal :model-value="modelValue" :title="`${worldName || '世界观'} · 语言风格`" wide :transition-ms="300" @update:model-value="requestClose">
    <div class="language-style-editor">
      <div class="language-style-toolbar">
        <linshe-button variant="secondary" size="md" :loading="polishing" :disabled="saving || !draft.trim()" @click="polish">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.3z" />
            <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
          </svg>
          一键润色
        </linshe-button>
      </div>
      <linshe-input
        v-model="draft"
        type="textarea"
        :rows="14"
        :disabled="polishing || saving"
        aria-label="额外语言风格"
        aria-describedby="language-style-hint"
        placeholder="例如：说话温柔一点，带一点含蓄的幽默。可以直接填写示例，也可以点击一键润色扩写。"
      />
      <p id="language-style-hint" class="language-style-hint">保存后追加到私聊、群聊和朋友圈的原有语言示例后。清空并保存可恢复默认。</p>
      <Transition name="language-style-feedback" :duration="300">
        <p v-if="error" class="language-style-error" role="alert">{{ error }}</p>
      </Transition>
    </div>
    <template #footer>
      <linshe-button :disabled="saving" @click="requestClose(false)">取消</linshe-button>
      <linshe-button variant="primary" :loading="saving" :disabled="polishing || !changed || !worldId" @click="save">保存</linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheButton from './ui/LinsheButton.vue'
import * as api from '../api/index.js'

const props = defineProps({
  modelValue: Boolean,
  worldId: { type: Number, default: null },
  worldName: { type: String, default: '' },
  languageStyle: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'saved'])
const draft = ref('')
const original = ref('')
const polishing = ref(false)
const saving = ref(false)
const error = ref('')
const changed = computed(() => draft.value.trim() !== original.value.trim())
let session = 0

watch(() => [props.modelValue, props.worldId], ([open]) => {
  session++
  polishing.value = false
  saving.value = false
  // 关闭时保留正文，让统一弹窗完成 300ms 淡出。
  if (open) {
    draft.value = original.value = props.languageStyle
    error.value = ''
  }
}, { immediate: true })
onBeforeUnmount(() => session++)

function requestClose(open) {
  if (!saving.value) emit('update:modelValue', open)
}

async function polish() {
  if (polishing.value || saving.value || !draft.value.trim() || !props.worldId) return
  const current = session
  polishing.value = true
  error.value = ''
  try {
    const result = await api.polishWorldLanguageStyle(props.worldId, { content: draft.value })
    if (current !== session) return
    if (!result?.ok || !result.content?.trim()) throw new Error(result?.error || '润色结果为空，请重试')
    draft.value = result.content
  } catch (err) {
    if (current === session) error.value = err.message || '润色失败，请重试'
  } finally {
    if (current === session) polishing.value = false
  }
}

async function save() {
  if (saving.value || polishing.value || !changed.value || !props.worldId) return
  const current = session
  saving.value = true
  error.value = ''
  try {
    const result = await api.updateWorldSetting(props.worldId, { language_style: draft.value.trim() })
    if (current !== session) return
    if (!result?.ok || !result.item) throw new Error(result?.error || '保存失败，请重试')
    emit('saved', result.item)
    emit('update:modelValue', false)
  } catch (err) {
    if (current === session) error.value = err.message || '保存失败，请重试'
  } finally {
    if (current === session) saving.value = false
  }
}
</script>

<style scoped>
.language-style-editor { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.language-style-toolbar { display: flex; align-items: center; justify-content: flex-end; }
.language-style-hint, .language-style-error { margin: 0; font-size: var(--fs-sm); line-height: 1.6; overflow-wrap: anywhere; }
.language-style-hint { color: var(--text-secondary); }
.language-style-error { color: var(--danger); }
.language-style-feedback-enter-active, .language-style-feedback-leave-active { transition: opacity 0.3s var(--ease-standard); }
.language-style-feedback-enter-from, .language-style-feedback-leave-to { opacity: 0; }
</style>
