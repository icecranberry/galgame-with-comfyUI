<template>
  <Transition name="modal-fade">
    <div v-if="modelValue" class="modal-overlay" @click.self="close">
      <div class="modal-panel modal-wide">
        <div class="modal-header">
          <h3>LoRA 设置（全局画风 & HiresFix细化）</h3>
          <button class="modal-close" @click="close">✕</button>
        </div>
        <div class="lora-tab-bar">
          <button :class="['lora-tab', { active: activeTab === 'global' }]" @click="activeTab = 'global'">
            全局画风
            <span v-if="globalCount > 0" class="lora-tab-count">{{ globalCount }}</span>
          </button>
          <button :class="['lora-tab', { active: activeTab === 'hires' }]" @click="switchTab('hires')">
            HiresFix细化
            <span v-if="hiresCount > 0" class="lora-tab-count">{{ hiresCount }}</span>
          </button>
        </div>
        <p class="lora-tab-hint">{{ activeTab === 'hires' ? '仅作用于放大细化工作流，追加在 LoRA 链末尾（普通生图不受影响）' : '全局画风 LoRA，按适用范围生效（注意去掉画师串或者和画师串并存）' }}</p>
        <div class="modal-body">
          <div class="lora-body-card">
            <TransitionGroup name="lora-card" tag="div" class="lora-list">
              <div v-for="(item, idx) in activeItems" :key="`${activeTab}-${idx}`" class="lora-item-card" :class="{ 'lora-disabled': !item.enabled }">
                <button class="lora-remove-btn" @click="removeLoraGroup(idx)" title="删除 LoRA">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
                <div class="lora-item-row">
                  <div class="form-group lora-path-group">
                    <label class="fl lora-inline-label">文件路径</label>
                    <div class="lora-autocomplete-wrap">
                      <input
                        v-model="item.path"
                        class="fi"
                        autocomplete="off"
                        placeholder="在ComfyUI-aki-v3(或其他名称)\ComfyUI\models\loras下搜索..."
                        @focus="onLoraInputFocus(idx)"
                        @input="onLoraInput(idx)"
                        @keydown="onLoraKeydown($event, idx)"
                        @blur="onLoraInputBlur"
                      />
                      <ul v-if="activeLoraFileIdx === idx && loraSuggestions.length > 0" class="lora-dropdown">
                        <li
                          v-for="(file, di) in loraSuggestions"
                          :key="file.path"
                          :class="['lora-dropdown-item', { active: di === loraDropdownIdx }]"
                          @mousedown.prevent="selectLoraFile(idx, file)"
                        >
                          <span>{{ loraDisplayName(file) }}</span>
                        </li>
                      </ul>
                      <div v-else-if="activeLoraFileIdx === idx && lorasFiles.length === 0 && !loraFetching" class="lora-dropdown" style="padding:16px;text-align:center;font-size:13px;color:var(--text-secondary)">
                        请先在启动器中配置 ComfyUI 路径
                      </div>
                      <div v-else-if="activeLoraFileIdx === idx && loraFetching" class="lora-dropdown" style="padding:16px;text-align:center;font-size:13px;color:var(--text-secondary)">
                        加载中...
                      </div>
                    </div>
                  </div>
                  <div class="form-group lora-weight-group">
                    <label class="fl lora-inline-label">权重</label>
                    <input
                      v-model.number="item.weight"
                      type="number"
                      step="0.05"
                      min="0"
                      max="5"
                      class="fi lora-weight-input"
                      autocomplete="off"
                    />
                  </div>
                </div>
                <div class="lora-trigger-row">
                  <label class="fl lora-inline-label">触发词</label>
                  <input v-model="item.triggerWord" class="fi" autocomplete="off" placeholder="可选，用于增强 lora 效果的提示词" />
                </div>
                <div class="lora-scenes-row">
                  <template v-if="activeTab === 'global'">
                    <span class="fl lora-inline-label">适用范围</span>
                    <div class="lora-scenes-chips">
                      <button
                        v-for="s in sceneOptions"
                        :key="s.value"
                        :class="['scene-chip', { active: item.scenes && item.scenes.includes(s.value) }]"
                        @click="toggleScene(item, s.value)"
                      >
                        <span v-if="item.scenes && item.scenes.includes(s.value)" class="scene-check">✓</span>
                        {{ s.label }}
                      </button>
                    </div>
                  </template>
                  <div style="flex:1;min-width:0"></div>
                  <label class="lora-enable-toggle" @click.stop>
                    <span class="lora-enable-status">{{ item.enabled ? '已启用' : '已禁用' }}</span>
                    <span class="lora-toggle-switch">
                      <input type="checkbox" v-model="item.enabled" />
                      <span class="lora-toggle-slider"></span>
                    </span>
                  </label>
                </div>
              </div>
            </TransitionGroup>

            <div v-if="activeItems.length === 0" class="lora-empty-hint">
              {{ activeTab === 'hires' ? '尚未配置任何细化 LoRA，点击下方按钮添加' : '尚未配置任何全局 LoRA，点击下方按钮添加' }}
            </div>

            <button class="lora-add-btn" @click="addLoraGroup">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              添加 LoRA
            </button>
          </div>

          <div class="modal-actions" style="margin-top:16px">
            <span class="lora-civitai-label">LoRA 获取：</span>
            <a href="https://civitai.com/search/models?baseModel=Anima&modelType=LORA&sortBy=models_v9&query=style" target="_blank" rel="noopener noreferrer" class="lora-civitai-link">CivitAI 搜索Style</a>
            <span class="lora-civitai-label">或</span>
            <a href="https://civitai.red/search/models?baseModel=Anima&modelType=LORA&sortBy=models_v9&query=style" target="_blank" rel="noopener noreferrer" class="lora-civitai-link">CivitAI.red 搜索Style</a>
            <span class="lora-civitai-label">（但实际上作者并不会都以Style为画风LoRA取名，可以自行寻找其他关键词）</span>
            <div style="flex:1"></div>
            <button class="btn-primary" @click="save" :disabled="loraLoading">
              {{ loraLoading ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch, nextTick, inject } from 'vue'
import * as api from '../api/index.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  initialLoras: { type: Array, default: () => [] },
  initialHiresLoras: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'saved'])

const toastFn = inject('toast')

// 标签页: 'global' = 全局画风 LoRA（带场景过滤）；'hires' = HiresFix 细化专用 LoRA（仅细化工作流生效）
const activeTab = ref('global')
const globalItems = ref([])
const hiresItems = ref([])
const activeItems = computed(() => (activeTab.value === 'hires' ? hiresItems.value : globalItems.value))
const globalCount = computed(() => globalItems.value.filter(l => l.path && l.enabled !== false).length)
const hiresCount = computed(() => hiresItems.value.filter(l => l.path && l.enabled !== false).length)

function switchTab(tab) {
  activeTab.value = tab
  activeLoraFileIdx.value = null
}

const sceneOptions = [
  { value: 'chat', label: '聊天' },
  { value: 'moments', label: '朋友圈' },
  { value: 'events', label: '奇遇' },
  { value: 'mailbox', label: '信件' },
  { value: 'schedule', label: '日程' },
]

const lorasFiles = ref([])
const activeLoraFileIdx = ref(null)
const loraDropdownIdx = ref(-1)
const loraSuggestions = ref([])
const loraFetching = ref(false)
const loraLoading = ref(false)

watch(() => props.modelValue, (v) => {
  if (v) {
    const normalize = (list) => {
      const raw = list.length > 0 ? JSON.parse(JSON.stringify(list)) : []
      for (const item of raw) {
        if (item.enabled === undefined) item.enabled = true
        if (!Array.isArray(item.scenes)) item.scenes = ['chat', 'moments', 'events', 'mailbox', 'schedule']
        // 已有数据的 scenes=[] 保持原样（后端视为全部场景）
      }
      return raw
    }
    globalItems.value = normalize(props.initialLoras)
    hiresItems.value = normalize(props.initialHiresLoras)
    activeTab.value = 'global'
    fetchLorasFiles()
  }
})

function close() {
  emit('update:modelValue', false)
}

function addLoraGroup() {
  activeItems.value.push({ path: '', weight: 0.8, triggerWord: '', enabled: true, scenes: ['chat', 'moments', 'events', 'mailbox', 'schedule'] })
}

function removeLoraGroup(idx) {
  activeItems.value.splice(idx, 1)
}

function toggleScene(item, scene) {
  if (!Array.isArray(item.scenes)) item.scenes = []
  const idx = item.scenes.indexOf(scene)
  if (idx >= 0) {
    item.scenes.splice(idx, 1)
  } else {
    item.scenes.push(scene)
  }
}

async function fetchLorasFiles() {
  loraFetching.value = true
  try {
    const data = await api.fetchLorasFiles()
    lorasFiles.value = data.files || []
  } catch { lorasFiles.value = [] }
  loraFetching.value = false
}

function loraDisplayName(file) {
  return file.source ? `[${file.source}] ${file.name}` : file.name
}

function filterLoras(query) {
  if (!query) return lorasFiles.value
  const q = query.toLowerCase().replace(/\\/g, '/')
  return lorasFiles.value.filter(f => {
    const display = loraDisplayName(f).toLowerCase()
    return display.includes(q) || f.name.toLowerCase().includes(q)
  })
}

function onLoraInputFocus(idx) {
  activeLoraFileIdx.value = idx
  loraDropdownIdx.value = -1
  loraSuggestions.value = filterLoras(activeItems.value[idx]?.path || '')
}

function onLoraInput(idx) {
  activeLoraFileIdx.value = idx
  loraDropdownIdx.value = -1
  loraSuggestions.value = filterLoras(activeItems.value[idx]?.path || '')
}

function onLoraInputBlur() {
  setTimeout(() => { activeLoraFileIdx.value = null }, 150)
}

function selectLoraFile(idx, file) {
  activeItems.value[idx].path = file.name
  activeLoraFileIdx.value = null
}

function onLoraKeydown(e, idx) {
  if (activeLoraFileIdx.value !== idx) return
  const items = loraSuggestions.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    loraDropdownIdx.value = Math.min(loraDropdownIdx.value + 1, items.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    loraDropdownIdx.value = Math.max(loraDropdownIdx.value - 1, -1)
  } else if (e.key === 'Enter' && loraDropdownIdx.value >= 0) {
    e.preventDefault()
    selectLoraFile(idx, items[loraDropdownIdx.value])
  } else if (e.key === 'Escape') {
    activeLoraFileIdx.value = null
  }
}

async function save() {
  const validGlobal = globalItems.value.filter(l => l.path && l.path.trim())
  const validHires = hiresItems.value.filter(l => l.path && l.path.trim())
  loraLoading.value = true
  try {
    await Promise.all([
      api.updateGlobalLora(validGlobal),
      api.updateHiresLora(validHires),
    ])
    emit('saved', validGlobal, validHires)
    emit('update:modelValue', false)
    if (toastFn) toastFn('LoRA 设置已保存', 'success')
  } catch (e) {
    console.error('saveLoraConfig failed:', e)
    if (toastFn) toastFn('保存失败', 'error')
  } finally {
    loraLoading.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
}
.modal-panel {
  background: #f4f1eeed; border-radius: 18px;
  width: min(880px, 96vw); max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18);
  overflow: hidden; backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.modal-wide { width: min(900px, 97vw); }
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 22px; flex-shrink: 0;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
.modal-header h3 { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); }
.modal-close {
  width: 30px; height: 30px; border-radius: 50%;
  border: none; background: transparent;
  font-size: 16px; color: var(--text-secondary);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.modal-close:hover { background: rgba(0,0,0,0.06); color: var(--text-primary); }
.modal-body { padding: 16px 22px 22px; overflow-y: auto; flex: 1; }
.modal-actions { display: flex; align-items: center; gap: 10px; }

/* ── 标签切换：文字 + 下划线（低调风格，仅文字变色） ── */
.lora-tab-bar {
  display: flex; gap: 20px; margin: 8px 24px 0; flex-shrink: 0;
  padding: 0 4px;
  border-bottom: 1px solid var(--glass-border);
}
.lora-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 2px 8px; font-size: 13px; font-weight: 500;
  background: transparent; border: none; cursor: pointer;
  color: var(--text-secondary); font-family: inherit;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: color 0.18s ease, border-color 0.18s ease;
}
.lora-tab:hover:not(.active) { color: var(--text-primary); }
.lora-tab.active {
  color: var(--accent);
  font-weight: 600;
  border-bottom-color: var(--accent);
}
.lora-tab-count {
  min-width: 16px; padding: 0 5px; border-radius: 8px;
  background: rgba(0,0,0,0.07); color: inherit;
  font-size: 11px; line-height: 1.5; text-align: center;
}
.lora-tab-hint {
  margin: 10px 24px 0; font-size: 12px; color: var(--text-secondary); line-height: 1.5;
}

.lora-body-card { background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 14px; padding: 18px; }
.lora-list { display: flex; flex-direction: column; gap: 10px; }
.lora-item-card { position: relative; background: var(--bg-primary); border: 1px solid var(--glass-border); border-radius: 12px; padding: 10px 12px; }
.lora-disabled { opacity: 0.45; }
.lora-enable-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
.lora-enable-status { font-size: 11px; color: var(--text-secondary); letter-spacing: 0.2px; }
.lora-toggle-switch { position: relative; width: 32px; height: 18px; flex-shrink: 0; }
.lora-toggle-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.lora-toggle-slider {
  position: absolute; inset: 0; cursor: pointer;
  background: #ccc; border-radius: 18px;
  transition: background 180ms ease;
}
.lora-toggle-slider::before {
  content: ''; position: absolute; left: 2px; top: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: #fff; transition: transform 180ms ease;
}
.lora-toggle-switch input:checked + .lora-toggle-slider { background: var(--accent); }
.lora-toggle-switch input:checked + .lora-toggle-slider::before { transform: translateX(14px); }
.lora-remove-btn {
  position: absolute; top: 6px; right: 6px;
  width: 22px; height: 22px; border-radius: 50%; border: none;
  background: transparent; color: var(--text-muted, #bbb);
  font-size: 11px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 180ms ease; padding: 0; z-index: 1;
}
.lora-remove-btn:hover {
  background: rgba(255, 77, 79, 0.1);
  color: var(--danger);
  transform: scale(1.03);
}
.lora-item-row { display: flex; gap: 10px; align-items: flex-end; }
.lora-item-row .form-group, .lora-trigger-row .form-group { margin-bottom: 0; }
.lora-path-group { flex: 2; min-width: 0; }
.lora-autocomplete-wrap { position: relative; }
.lora-dropdown {
  position: absolute; left: 0; right: 0; top: calc(100% + 4px);
  max-height: 220px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e2d6c7;
  border-radius: 8px;
  z-index: 10001;
  list-style: none;
  padding: 4px;
  margin: 0;
  box-shadow: 0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06);
  transform-origin: top center;
}
.lora-dropdown-item {
  display: flex; align-items: center;
  padding: 9px 10px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-bright);
  border-radius: 6px;
  transition: background 180ms ease, color 180ms ease;
}
.lora-dropdown-item:hover {
  background: rgba(224,123,108,0.08);
  color: var(--accent);
}
.lora-dropdown-item.active {
  background: rgba(224,123,108,0.06);
  color: var(--accent);
  font-weight: 600;
}
.lora-weight-group { flex: 0 0 72px; }
.lora-inline-label { font-size: 11px; margin-bottom: 3px; }
.lora-item-card .fi { background: var(--glass-bg); width: 100%; }
.lora-weight-input { text-align: center; padding: 9px 4px; }
.lora-trigger-row { margin-top: 8px; }
.lora-scenes-row { margin-top: 8px; display: flex; align-items: center; gap: 8px; }
.lora-scenes-chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.scene-chip {
  padding: 3px 10px; border-radius: 6px; border: 1px solid transparent;
  background: var(--bg-muted, #f0f0f0); color: var(--text-secondary);
  font-size: 11px; cursor: pointer; user-select: none;
  transition: all 180ms ease; line-height: 1.5;
}
.scene-chip:hover { background: rgba(0,0,0,0.06); transform: scale(1.02); }
.scene-chip.active {
  background: rgba(224,123,108,0.1); border-color: var(--accent);
  color: var(--accent); font-weight: 500;
}
.scene-chip.active:hover { background: rgba(224,123,108,0.16); }
.scene-check { margin-right: 2px; font-size: 10px; }
.form-group { margin-bottom: 16px; }
.form-group .fl { display: block; margin-bottom: 6px; }
.lora-card-enter-active, .lora-card-leave-active { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
.lora-card-enter-from, .lora-card-leave-to { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; border-width: 0; }
.lora-card-enter-to, .lora-card-leave-from { opacity: 1; max-height: 120px; }
.lora-empty-hint { text-align: center; font-size: 13px; color: var(--text-secondary); padding: 20px 0; margin-bottom: 8px; }
.lora-add-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 10px 0; border: 1.5px dashed var(--glass-border); border-radius: 10px; background: transparent; color: var(--accent); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; margin: 5px 0; }
.lora-add-btn:hover { border-color: var(--accent); background: rgba(224, 123, 108, 0.05); }

.lora-civitai-label { font-size: 12px; color: var(--text-secondary); white-space: nowrap; margin: 0 2px; }
.lora-civitai-link { font-size: 12px; color: var(--accent); text-decoration: none; white-space: nowrap; opacity: 0.85; transition: opacity 0.15s; }
.lora-civitai-link:hover { opacity: 1; text-decoration: underline; }

.modal-fade-enter-active { transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-leave-active { transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .modal-panel { animation: modal-pop 0.28s cubic-bezier(0.17, 0.89, 0.32, 1.25); }
@keyframes modal-pop { 0% { transform: scale(0.92); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }

.btn-primary { background: var(--accent); color: white; padding: 8px 20px; border-radius: 10px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 767px) {
  .modal-panel, .modal-wide { width: 100vw; max-height: 100vh; max-height: 100dvh; border-radius: 0; }
  .modal-header { padding: 10px 16px; padding-top: calc(10px + env(safe-area-inset-top, 0px)); }
  .modal-body { padding: 0 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
  .modal-wide .fi { font-size: 16px; }
}
</style>

