<template>
  <!-- ── 人设润色弹窗：让邻舍改写人格提示词 ──
       整卡文本由 basePrompt prop 传入（可以是待确认的草稿卡，不要求角色已入库）。
       与「修正外观」同构：只出草稿、通过 @applied 回传整卡，落库由父级决定（本弹窗不落库）。 -->
  <linshe-modal v-model="visibleModel" :title="`人设润色 — ${displayName || ''}`" wide>
    <div class="pr-body">
      <p class="pr-intro">
        邻舍会按你选的力度改写人格提示词里的人设部分，
        <strong>「## 你的外观」段会被原样保留</strong>（那一段由「修正外观」负责，不受此处影响）。
        生成结果需要你在角色卡上再点一次「保存」才会真正生效。
      </p>

      <div class="pr-section">
        <label class="fl">润色力度</label>
        <linshe-tabs v-model="mode" :options="MODE_OPTIONS" size="sm" aria-label="人设润色力度" />
        <div class="pr-hint">{{ modeHint }}</div>
      </div>

      <div v-if="appearanceNotice" class="pr-notice">{{ appearanceNotice }}</div>

      <div v-if="refining" class="pr-analyzing">
        <span class="pr-spinner"></span> 邻舍正在润色人设…
      </div>

      <div v-if="result" class="pr-result">
        <label class="fl">润色结果（可直接修改）</label>
        <linshe-input v-model="result" type="textarea" :rows="14" class="pr-result-input" />
        <div class="pr-stat">{{ statText }}</div>
      </div>

      <div v-if="error" class="pr-error">{{ error }}</div>
    </div>

    <template #footer>
      <span class="pr-foot-hint">应用后请点角色卡的「保存」生效</span>
      <div style="flex:1"></div>
      <linshe-button
        variant="secondary"
        :disabled="refining"
        :loading="refining"
        @click="run"
      >
        {{ result ? '重新润色' : '开始润色' }}
      </linshe-button>
      <linshe-button variant="primary" :disabled="!result || refining" @click="apply">
        应用到人格卡
      </linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
import { ref, computed, watch, inject } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheTabs from './ui/LinsheTabs.vue'
import LinsheModal from './ui/LinsheModal.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  displayName: { type: String, default: '' },
  basePrompt: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'applied'])

const visibleModel = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const MODE_OPTIONS = [
  { value: 'polish', label: '保持原意' },
  { value: 'enrich', label: '丰富细节' },
  { value: 'concise', label: '精简凝练' },
]
const MODE_HINTS = {
  polish: '篇幅与原文相当，只让表达更好。人设已经写得完整时用这个。',
  enrich: '在原有设定上补充细节与心理描写，形象更立体；不会新增亲属、组织、事件等硬设定。',
  concise: '删去冗余与重复表达，保留全部设定要点，大约压到原文的七成。',
}

const mode = ref('polish')
const refining = ref(false)
const result = ref('')
const error = ref('')
const originalLen = ref(0)

const modeHint = computed(() => MODE_HINTS[mode.value] || '')

// 外观段会被原样保留 —— 若这张卡根本没有外观段，明确说明，免得用户以为漏润了
const appearanceNotice = computed(() => (
  /##\s*你的外观/.test(props.basePrompt || '')
    ? '检测到「## 你的外观」段：润色时会原样跳过，需要改外观请用「修正外观」。'
    : '这张卡还没有「## 你的外观」段，本次会润色全文。'
))

const statText = computed(() => {
  const now = (result.value || '').length
  const before = originalLen.value
  if (!before) return ''
  const delta = now - before
  const pct = Math.round((delta / before) * 100)
  const sign = delta >= 0 ? '+' : ''
  return `整卡字数 ${before} → ${now}（${sign}${pct}%）`
})

// 每次打开清空上一次的结果，避免误把旧稿当成刚生成的
watch(() => props.modelValue, v => {
  if (v) {
    result.value = ''
    error.value = ''
  }
})

async function run() {
  if (!String(props.basePrompt || '').trim()) {
    error.value = '人格提示词为空，没有可润色的内容'
    return
  }
  refining.value = true
  error.value = ''
  try {
    const d = await api.refinePersonaDraft({
      basePrompt: props.basePrompt,
      displayName: props.displayName,
      mode: mode.value,
    })
    result.value = d.base_prompt || ''
    originalLen.value = String(props.basePrompt || '').length
    if (!result.value) error.value = '没有拿到润色结果，请重试'
  } catch (err) {
    error.value = err?.message || '润色失败'
  } finally {
    refining.value = false
  }
}

function apply() {
  if (!result.value.trim()) return
  visibleModel.value = false
  emit('applied', { basePrompt: result.value })
}
</script>

<style scoped>
.pr-body { display: flex; flex-direction: column; gap: 14px; }
.pr-intro { margin: 0; font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
.fl { font-size: 13px; font-weight: 600; color: var(--text-bright); display: block; margin-bottom: 6px; }

.pr-section { display: flex; flex-direction: column; }
.pr-hint { margin-top: 6px; font-size: 11px; color: var(--text-secondary); line-height: 1.5; }

.pr-notice {
  font-size: 11px; line-height: 1.5;
  color: var(--text-secondary);
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(var(--accent-rgb), 0.06);
  border: 1px solid rgba(var(--accent-rgb), 0.16);
}

.pr-analyzing { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
.pr-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(var(--accent-rgb), 0.2); border-top-color: var(--accent);
  animation: pr-spin 0.6s linear infinite;
}
@keyframes pr-spin { to { transform: rotate(360deg); } }

.pr-result-input { width: 100%; }
.pr-stat { margin-top: 6px; font-size: 11px; color: var(--text-secondary); }
.pr-error { font-size: 12px; color: var(--danger); line-height: 1.5; }
.pr-foot-hint { font-size: 11px; color: var(--text-secondary); }
</style>
