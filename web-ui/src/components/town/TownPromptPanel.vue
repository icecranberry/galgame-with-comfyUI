<template>
  <div class="prompt-panel">
    <div class="pp-title">🪄 提示词与 LoRA</div>
    <div class="pp-hint">{{ stepHint }}</div>

    <!-- 画师串交给生图器的画师节点，位于画面描述链路最前 -->
    <div class="pp-field">
      <div class="pp-label">画师串</div>
      <linshe-input
        :model-value="artistValue"
        size="sm"
        placeholder="@ebora"
        @update:model-value="v => emit('update:modelValue', { ...modelValue, artist: v })"
      />
      <div class="pp-preview">最终按：<code>{{ artistValue || '（无）' }}, …后续提示词</code></div>
    </div>

    <!-- 硬逻辑前缀：会直接拼在最终 prompt 最前面，可改可清空（清空=用默认） -->
    <div v-if="!hidePrefix" class="pp-field">
      <div class="pp-label">
        直接添加的提示词
        <span v-if="!modelValue.prefix" class="pp-default-tag">默认</span>
        <span v-else class="pp-default-tag is-custom">已自定义</span>
      </div>
      <linshe-input
        :model-value="modelValue.prefix"
        type="textarea"
        :rows="3"
        size="sm"
        :placeholder="defaultPrefix"
        @update:model-value="v => emit('update:modelValue', { ...modelValue, prefix: v })"
      />
      <div class="pp-preview">最终会拼成：<code>{{ (modelValue.prefix || defaultPrefix) || '（无）' }}, …其余内容</code></div>
    </div>

    <!-- LoRA：参考角色详情页的添加方式 -->
    <div class="pp-field">
      <div class="pp-label">
        LoRA（{{ modelValue.loras.length }}）
        <span class="pp-default-tag" v-if="modelValue.loras.length === 0">未启用</span>
      </div>
      <div v-if="showPortraitLora" class="pp-portrait-lora">
        <linshe-switch
          :model-value="!!modelValue.portraitLoras"
          size="sm"
          aria-label="立绘应用LoRA"
          @update:model-value="v => emit('update:modelValue', { ...modelValue, portraitLoras: !!v })"
        />
        <span>立绘应用LoRA</span>
      </div>
      <TransitionGroup name="pp-pop" tag="div" class="pp-lora-list">
        <div v-for="(lora, idx) in modelValue.loras" :key="idx" class="pp-lora-item">
          <div class="pp-lora-row">
            <linshe-select
              :model-value="lora.path"
              :options="loraOptions"
              size="sm"
              searchable
              placeholder="搜索 LoRA 文件…"
              @update:model-value="v => updateLora(idx, { path: v })"
            />
            <linshe-button variant="icon" size="sm" aria-label="移除" @click="removeLora(idx)">✕</linshe-button>
          </div>
          <div class="pp-lora-row">
            <linshe-input
              :model-value="lora.triggerWord"
              size="sm"
              placeholder="触发词（可空）"
              @update:model-value="v => updateLora(idx, { triggerWord: v })"
            />
            <div class="pp-weight">
              <span class="pp-weight-label">强度</span>
              <linshe-input
                :model-value="lora.weight"
                size="sm"
                type="number"
                :min="0"
                :max="2"
                :step="0.05"
                @update:model-value="v => updateLora(idx, { weight: Number(v) })"
              />
            </div>
          </div>
        </div>
      </TransitionGroup>
      <linshe-button variant="secondary" size="sm" @click="addLora">+ 添加 LoRA</linshe-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import * as api from '../../api/index.js'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import LinsheSelect from '../ui/LinsheSelect.vue'
import LinsheSwitch from '../ui/LinsheSwitch.vue'

const props = defineProps({
  modelValue: { type: Object, required: true }, // { prefix, loras: [{path, weight, triggerWord}] }
  step: { type: String, required: true },
  styleTags: { type: String, default: '' },
  /** 立绘本身不拼类型前缀；组件保持向导默认行为，由调用方隐藏 */
  hidePrefix: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const DEFAULTS = {
  tiles: 'pixel art, game sprite',
  buildings: 'pixel art, game sprite',
  npcs: 'pixel art, mini human sized, full body, game sprite',
  player: 'pixel art, mini human sized, full body, game sprite',
}

const DEFAULT_ARTIST = '@ebora'
const artistValue = computed(() => props.modelValue.artist ?? DEFAULT_ARTIST)
const showPortraitLora = computed(() => ['npcs', 'player'].includes(props.step))
const defaultPrefix = computed(() => DEFAULTS[props.step] ?? '')

const STEP_HINTS = {
  tiles: '地皮会默认加上 pixel art, game sprite',
  buildings: '建筑会硬逻辑加上 pixel art, game sprite',
  npcs: '像素小人会硬逻辑加上 mini human sized, full body',
  player: '同像素小人；立绘默认不加前缀',
}
const stepHint = computed(() => STEP_HINTS[props.step] ?? '')

const loraOptions = ref([])

function addLora() {
  emit('update:modelValue', {
    ...props.modelValue,
    loras: [...props.modelValue.loras, { path: '', weight: 1, triggerWord: '' }],
  })
}

function removeLora(idx) {
  const loras = props.modelValue.loras.filter((_, i) => i !== idx)
  emit('update:modelValue', { ...props.modelValue, loras })
}

function updateLora(idx, patch) {
  const loras = props.modelValue.loras.map((l, i) => i === idx ? { ...l, ...patch } : l)
  emit('update:modelValue', { ...props.modelValue, loras })
}

onMounted(async () => {
  try {
    const lf = await api.fetchLorasFiles()
    // ComfyUI 的 lora_name 需要模型根目录相对标识，详情卡保存的是 file.name 而非本机绝对路径。
    loraOptions.value = (lf.files || []).map(f => {
      const name = typeof f === 'string' ? f : (f.name || f.path || '')
      const source = typeof f === 'object' && f?.source ? `[${f.source}] ` : ''
      return { label: `${source}${name}`, value: name }
    }).filter(o => o.value)
  } catch { /* LoRA 列表拉不到就不启用 */ }
})
</script>

<style scoped>
.prompt-panel {
  width: 232px;
  flex-shrink: 0;
  background: rgba(240, 236, 232, 0.75);
  border-radius: 12px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-self: flex-start;
  position: sticky;
  top: 0;
}

.pp-title { font-size: 12px; font-weight: 700; color: var(--text-bright); }
.pp-hint { font-size: 10px; color: var(--text-secondary); line-height: 1.5; margin-top: -6px; }

.pp-field { display: flex; flex-direction: column; gap: 6px; }
.pp-label {
  font-size: 11px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.pp-default-tag {
  font-size: 9px;
  background: rgba(124, 176, 116, 0.16);
  color: #5c8a52;
  border-radius: 999px;
  padding: 0 7px;
}
.pp-default-tag.is-custom { background: rgba(224, 123, 108, 0.14); color: var(--accent-hover); }

.pp-preview { font-size: 10px; color: var(--text-secondary); line-height: 1.5; }
.pp-preview code {
  font-family: inherit;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 4px;
  padding: 1px 4px;
  word-break: break-all;
}

.pp-portrait-lora {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-primary);
}

.pp-lora-list { display: flex; flex-direction: column; gap: 8px; }

.pp-lora-item {
  background: #fbf8f3;
  border-radius: 10px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  animation: pp-pop 0.3s cubic-bezier(0.34, 1.4, 0.64, 1);
}

@keyframes pp-pop {
  from { opacity: 0; transform: translateY(6px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.pp-lora-row { display: flex; gap: 6px; align-items: center; }
.pp-lora-row > :first-child { flex: 1; min-width: 0; }

.pp-weight { display: flex; align-items: center; gap: 4px; }
.pp-weight-label { font-size: 10px; color: var(--text-secondary); }
.pp-weight > :last-child { width: 64px; }
</style>
