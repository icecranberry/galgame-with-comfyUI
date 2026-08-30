<template>
  <Transition name="modal-fade">
    <div v-if="modelValue" class="modal-overlay" @click.self="close">
      <div class="modal-panel modal-wide">
        <div class="modal-header">
          <h3>HiresFix 细化设置</h3>
          <button class="modal-close" @click="close">✕</button>
        </div>
        <div class="modal-body">
          <p class="hires-hint">图片进一步高清细化设置，点击图片上的「放大细化」时生效</p>

          <div class="hires-main-body">

          <div class="hires-section hires-params-section">
            <div class="hires-section-title">HiresFix 参数</div>
            <div class="hires-params">
              <div class="form-group">
                <label class="fl">步数<span class="fl-sub">（推荐30~40）越高越精细，耗时越久</span></label>
                <input v-model.number="steps" type="number" min="1" max="100" step="1" class="fi" />
              </div>
              <div class="form-group">
                <label class="fl">CFG<span class="fl-sub">（推荐3~5）</span></label>
                <input v-model.number="cfg" type="number" min="0" max="20" step="0.1" class="fi" />
              </div>
              <div class="form-group">
                <label class="fl">重绘幅度<span class="fl-sub">（推荐0.3~0.5）</span></label>
                <input v-model.number="denoise" type="number" min="0" max="1" step="0.01" class="fi" />
              </div>
              <div class="form-group">
                <label class="fl">最长边<span class="fl-sub">（像素，默认2000）</span></label>
                <input v-model.number="maxSize" type="number" min="256" max="8192" step="100" class="fi" />
              </div>
            </div>
          </div>

          <div class="hires-section hires-artist-section">
            <div class="hires-section-title">画师串</div>
            <div class="artist-segmented">
              <button :class="['artist-mode-chip', { active: artistMode === 'inherit' }]" @click="artistMode = 'inherit'">沿用原图</button>
              <button :class="['artist-mode-chip', { active: artistMode === 'empty' }]" @click="artistMode = 'empty'">留空</button>
              <button :class="['artist-mode-chip', { active: artistMode === 'specified' }]" @click="artistMode = 'specified'">指定</button>
            </div>
            <div class="artist-mode-hint">{{ artistModeHint }}</div>
            <Transition name="artist-block">
            <div v-if="artistMode === 'specified'" class="artist-specified-block">
              <input v-model="artist" class="fi artist-input" placeholder="输入画师串" />
              <p class="artist-input-hint">用于 HiresFix 的画师风格，可覆盖原图画师串</p>
            </div>
            </Transition>
          </div>

          <div class="hires-section hires-lora-section">
            <div class="hires-section-title">LoRA</div>

            <div class="lora-body-card">
            <TransitionGroup name="lora-card" tag="div" class="lora-list">
              <div v-for="(item, idx) in items" :key="idx" class="lora-item-card" :class="{ 'lora-disabled': !item.enabled }">
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

            <div v-if="items.length === 0" class="lora-empty-hint">
              尚未配置任何强化HiresFix细化的LoRA，点击下方按钮添加
            </div>

            <button class="lora-add-btn" @click="addLoraGroup">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              添加 LoRA
            </button>
            </div>
          </div>
          </div>

          <div class="modal-actions" style="margin-top:16px">
            <span class="lora-civitai-label">LoRA 获取：</span>
            <a href="https://civitai.com/search/models?baseModel=Anima&modelType=LORA&sortBy=models_v9&query=highres" target="_blank" rel="noopener noreferrer" class="lora-civitai-link">CivitAI 搜索highres</a>
            <span class="lora-civitai-label">或</span>
            <a href="https://civitai.red/search/models?baseModel=Anima&modelType=LORA&sortBy=models_v9&query=highres" target="_blank" rel="noopener noreferrer" class="lora-civitai-link">CivitAI.red 搜索highres</a>
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
import { ref, computed, watch, inject } from 'vue'
import * as api from '../api/index.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  initialLoras: { type: Array, default: () => [] },
  initialSteps: { type: Number, default: 35 },
  initialCfg: { type: Number, default: 5 },
  initialDenoise: { type: Number, default: 0.35 },
  initialMaxSize: { type: Number, default: 2000 },
  initialArtistMode: { type: String, default: 'empty' },
  initialArtist: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'saved'])

const toastFn = inject('toast')

const items = ref([])
const steps = ref(35)
const cfg = ref(5)
const denoise = ref(0.35)
const maxSize = ref(2000)
const artistMode = ref('empty')
const artist = ref('')
const artistModeHint = computed(() => {
  if (artistMode.value === 'empty') return 'HiresFix 时不使用画师串'
  if (artistMode.value === 'specified') return '使用下方自定义的画师串，可覆盖原图画师串'
  return '继续使用原图中的画师串'
})
const lorasFiles = ref([])
const activeLoraFileIdx = ref(null)
const loraDropdownIdx = ref(-1)
const loraSuggestions = ref([])
const loraFetching = ref(false)
const loraLoading = ref(false)

watch(() => props.modelValue, (v) => {
  if (v) {
    const raw = props.initialLoras.length > 0 ? JSON.parse(JSON.stringify(props.initialLoras)) : []
    for (const item of raw) {
      if (item.enabled === undefined) item.enabled = true
    }
    items.value = raw
    steps.value = Number.isFinite(props.initialSteps) ? props.initialSteps : 35
    cfg.value = Number.isFinite(props.initialCfg) ? props.initialCfg : 5
    denoise.value = Number.isFinite(props.initialDenoise) ? props.initialDenoise : 0.35
    maxSize.value = Number.isFinite(props.initialMaxSize) ? props.initialMaxSize : 2000
    artistMode.value = ['inherit', 'empty', 'specified'].includes(props.initialArtistMode) ? props.initialArtistMode : 'empty'
    artist.value = props.initialArtist || ''
    fetchLorasFiles()
  }
})

function close() {
  emit('update:modelValue', false)
}

function addLoraGroup() {
  items.value.push({ path: '', weight: 1, triggerWord: '', enabled: true })
}

function removeLoraGroup(idx) {
  items.value.splice(idx, 1)
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
  loraSuggestions.value = filterLoras(items.value[idx]?.path || '')
}

function onLoraInput(idx) {
  activeLoraFileIdx.value = idx
  loraDropdownIdx.value = -1
  loraSuggestions.value = filterLoras(items.value[idx]?.path || '')
}

function onLoraInputBlur() {
  setTimeout(() => { activeLoraFileIdx.value = null }, 150)
}

function selectLoraFile(idx, file) {
  items.value[idx].path = file.name
  activeLoraFileIdx.value = null
}

function onLoraKeydown(e, idx) {
  if (activeLoraFileIdx.value !== idx) return
  const list = loraSuggestions.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    loraDropdownIdx.value = Math.min(loraDropdownIdx.value + 1, list.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    loraDropdownIdx.value = Math.max(loraDropdownIdx.value - 1, -1)
  } else if (e.key === 'Enter' && loraDropdownIdx.value >= 0) {
    e.preventDefault()
    selectLoraFile(idx, list[loraDropdownIdx.value])
  } else if (e.key === 'Escape') {
    activeLoraFileIdx.value = null
  }
}

async function save() {
  const validLoras = items.value.filter(l => l.path && l.path.trim())
  const savedSteps = Math.max(1, Math.min(100, parseInt(steps.value, 10) || 35))
  const savedCfg = Math.max(0, Math.min(20, parseFloat(cfg.value) || 5))
  const savedDenoise = Math.max(0, Math.min(1, parseFloat(denoise.value) || 0.35))
  const savedMaxSize = Math.max(256, Math.min(8192, parseInt(maxSize.value, 10) || 2000))
  const savedArtistMode = ['inherit', 'empty', 'specified'].includes(artistMode.value) ? artistMode.value : 'empty'
  const savedArtist = (artist.value || '').trim()
  loraLoading.value = true
  try {
    await api.updateHiresSettings({ loras: validLoras, steps: savedSteps, cfg: savedCfg, denoise: savedDenoise, maxSize: savedMaxSize, artistMode: savedArtistMode, artist: savedArtist })
    emit('saved', { loras: validLoras, steps: savedSteps, cfg: savedCfg, denoise: savedDenoise, maxSize: savedMaxSize, artistMode: savedArtistMode, artist: savedArtist })
    emit('update:modelValue', false)
    if (toastFn) toastFn('HiresFix 设置已保存', 'success')
  } catch (e) {
    console.error('saveHiresSettings failed:', e)
    if (toastFn) toastFn(e.message || '保存失败', 'error')
  } finally {
    loraLoading.value = false
  }
}
</script>

<style scoped>
/* ═══ 弹窗骨架已迁移至全局 .modal-*（styles/components.css）═══ */
.modal-body { padding: 16px 22px 22px; }

.hires-hint { margin: 0 0 16px; font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
.hires-main-body {
  background: #FFFEFC;
  border: 1px solid rgba(125, 105, 85, 0.10);
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 14px;
}
.hires-section { margin-bottom: 16px; }
.hires-section:last-child { margin-bottom: 0; }
.hires-section-title { font-size: 12px; font-weight: 700; color: #6F675F; margin-bottom: 8px; }
.hires-params-section {
  background: rgba(245, 241, 236, 0.70);
  border: 1px solid rgba(125, 105, 85, 0.08);
  border-radius: 10px;
  padding: 12px 14px 14px;
}
.hires-params { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.hires-params .form-group { margin-bottom: 0; }
.hires-params .fi { margin-bottom: 0; }
.hires-artist-section { padding: 0 2px; }
.artist-segmented {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px;
  padding: 3px; background: #F5F1EC; border-radius: 10px;
}
.artist-mode-chip {
  padding: 8px 6px; border: none; border-radius: 7px;
  background: transparent; color: #6F675F; font-size: 12px; font-weight: 500;
  cursor: pointer; font-family: inherit; transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  text-align: center; white-space: nowrap;
}
.artist-mode-chip:hover { color: var(--accent); }
.artist-mode-chip.active {
  background: #FFFEFC; color: var(--accent); font-weight: 600;
  box-shadow: 0 1px 4px rgba(125, 105, 85, 0.12);
}
.artist-mode-hint { margin-top: 7px; font-size: 11px; color: var(--text-secondary); line-height: 1.5; }
.artist-specified-block { margin-top: 10px; overflow: hidden; }
.artist-input { margin: 0; }
.artist-block-enter-active, .artist-block-leave-active {
  transition: opacity 0.2s ease, max-height 0.24s ease, margin 0.24s ease;
}
.artist-block-enter-from, .artist-block-leave-to {
  opacity: 0; max-height: 0; margin-top: 0;
}
.artist-block-enter-to, .artist-block-leave-from {
  opacity: 1; max-height: 120px; margin-top: 10px;
}
.artist-input-hint { margin: 6px 0 0; font-size: 11px; color: var(--text-secondary); line-height: 1.5; }

.lora-body-card { background: rgba(245, 241, 236, 0.72); border: 1px solid rgba(125, 105, 85, 0.08); border-radius: 10px; padding: 12px; }
.lora-list { display: flex; flex-direction: column; gap: 8px; }
.lora-item-card { position: relative; background: var(--bg-primary); border: 1px solid var(--glass-border); border-radius: 12px; padding: 9px 10px 9px 12px; }
.lora-disabled { opacity: 0.45; }
.lora-enable-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; flex-shrink: 0; }
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
.lora-item-row { display: flex; gap: 8px; align-items: flex-end; padding-right: 24px; }
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
  background: rgba(var(--accent-rgb),0.08);
  color: var(--accent);
}
.lora-dropdown-item.active {
  background: rgba(var(--accent-rgb),0.06);
  color: var(--accent);
  font-weight: 600;
}
.lora-weight-group { flex: 0 0 64px; }
.lora-inline-label { font-size: 11px; margin-bottom: 3px; }
.lora-item-card .fi { background: var(--glass-bg); width: 100%; }
.lora-weight-input { text-align: center; padding: 9px 4px; }
.lora-trigger-row { margin-top: 6px; display: flex; align-items: center; gap: 8px; }
.lora-trigger-row .lora-inline-label { margin: 0; flex: 0 0 auto; }
.lora-trigger-row .fi { width: auto; flex: 1; min-width: 0; }
.form-group { margin-bottom: 16px; }
.form-group .fl { display: block; margin-bottom: 6px; }
.fl { font-size: 13px; font-weight: 600; color: var(--text-bright); display: block; }
.fl-sub { display: block; margin-top: 2px; font-size: 11px; font-weight: 400; color: var(--text-secondary); line-height: 1.45; }
.fi { width: 100%; padding: 9px 12px; font-size: 13px; border-radius: 8px; background: rgba(255,255,255,0.9); border: 1px solid #e2d6c7; color: var(--text-bright); outline: none; }
.fi:focus { border-color: var(--accent); }
.lora-card-enter-active, .lora-card-leave-active { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
.lora-card-enter-from, .lora-card-leave-to { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; border-width: 0; }
.lora-card-enter-to, .lora-card-leave-from { opacity: 1; max-height: 120px; }
.lora-empty-hint { text-align: center; font-size: 13px; color: var(--text-secondary); padding: 14px 0 8px; margin-bottom: 0; }
.lora-add-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 8px 0; border: 1.5px dashed var(--glass-border); border-radius: 10px; background: transparent; color: var(--accent); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; margin: 4px 0 0; }
.lora-add-btn:hover { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.05); }

.lora-civitai-label { font-size: 12px; color: var(--text-secondary); white-space: nowrap; margin: 0 2px; }
.lora-civitai-link { font-size: 12px; color: var(--accent); text-decoration: none; white-space: nowrap; opacity: 0.85; transition: opacity 0.15s; }
.lora-civitai-link:hover { opacity: 1; text-decoration: underline; }

/* 弹窗动画已迁移至全局 animations.css */

.btn-primary { padding: 8px 20px; border-radius: 10px; font-size: 13px; font-weight: 600; }

@media (max-width: 767px) {
  .modal-panel, .modal-wide { width: 100vw; max-height: 100vh; max-height: 100dvh; border-radius: 0; }
  .modal-header { padding: 10px 16px; padding-top: calc(10px + env(safe-area-inset-top, 0px)); }
  .modal-body { padding: 0 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
  .modal-wide .fi { font-size: 16px; }
  .hires-params { grid-template-columns: 1fr; }
}
</style>
