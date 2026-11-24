<template>
  <linshe-modal :model-value="modelValue" title="LoRA 设置（全局画风）" wide :transition-ms="300" :close-disabled="Boolean(pendingAction)" @update:model-value="close">
    <template #body-header>
      <div v-if="ready" class="lora-preset-toolbar" :aria-busy="pendingAction === 'switch'">
        <linshe-tabs
          v-if="presets.length"
          ref="presetTabs"
          class="lora-preset-tabs"
          aria-label="全局 LoRA 预设"
          variant="folder"
          :model-value="activePresetId"
          :options="presetOptions"
          :disabled="Boolean(pendingAction)"
          @update:model-value="selectPreset"
          @close="openDeletePreset"
        >
          <template #option="{ option }">
            <span class="lora-preset-label">{{ option.label }}</span>
          </template>
        </linshe-tabs>
        <linshe-button
          ref="addPresetButton"
          class="lora-preset-action"
          variant="link"
          tone="muted"
          touch-target
          aria-label="新增预设"
          :disabled="Boolean(pendingAction)"
          @click="openAddPreset"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
          <span v-if="!presets.length">新增预设</span>
        </linshe-button>
      </div>
    </template>
    <p v-if="ready" class="lora-tab-hint">全局画风 LoRA，按适用范围生效（注意去掉画师串或者和画师串并存）</p>
    <div v-if="ready" class="lora-add-actions">
      <linshe-button block :aria-expanded="pickerOpen" :aria-controls="pickerId" :disabled="Boolean(pendingAction)" @click="pickerOpen = !pickerOpen">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        添加 LoRA
      </linshe-button>
    </div>
    <Transition name="lora-picker">
      <div v-if="ready && pickerOpen" :id="pickerId" class="lora-picker" :inert="Boolean(pendingAction)">
        <ul v-if="availableLoras.length" class="lora-picker-list" aria-label="尚未添加的 LoRA">
          <li v-for="item in availableLoras" :key="item.path" class="lora-picker-card">
            <div class="lora-picker-file">
              <span class="lora-field-label">文件路径</span>
              <span class="lora-model-path">{{ item.path }}</span>
            </div>
            <div class="lora-picker-row">
              <dl class="lora-picker-details">
                <div>
                  <dt class="lora-field-label">默认权重</dt>
                  <dd>{{ item.weight }}</dd>
                </div>
                <div>
                  <dt class="lora-field-label">触发词</dt>
                  <dd>{{ item.triggerWord || '—' }}</dd>
                </div>
                <div>
                  <dt class="lora-field-label">备注</dt>
                  <dd>{{ item.note || '—' }}</dd>
                </div>
              </dl>
              <linshe-button variant="ghost" size="sm" :aria-label="`添加 ${item.path}`" @click="addLibraryLora(item)">添加</linshe-button>
            </div>
          </li>
        </ul>
        <p v-else class="lora-message">{{ library.loras.length ? '库中的 LoRA 已全部添加。' : 'LoRA 库为空，请先到库中新增。' }}</p>
      </div>
    </Transition>
    <TransitionGroup
      v-if="ready"
      :key="loraRevision"
      name="lora-card"
      tag="div"
      class="lora-list"
      :class="{ 'lora-list-reveal': loraRevision > 0 }"
      :inert="Boolean(pendingAction)"
    >
      <div v-for="(item, idx) in activeItems" :key="'global-' + idx" class="lora-card-entry">
        <div class="lora-item-card">
          <div class="lora-path-header">
            <span class="lora-model-path">{{ item.path }}</span>
            <linshe-button variant="icon" size="sm" @click="removeLoraGroup(idx)" :aria-label="`从预设移除 ${item.path}`">
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </linshe-button>
          </div>
          <div class="lora-card-details">
            <div class="lora-parameters">
              <div class="lora-parameter-row">
                <label :for="`${cardId}-trigger-${idx}`" class="lora-field-label">触发词</label>
                <linshe-input
                  :id="`${cardId}-trigger-${idx}`"
                  v-model="item.triggerWord"
                  size="sm"
                  class="lora-trigger-input"
                  autocomplete="off"
                  placeholder="可选"
                />
              </div>
              <div class="lora-parameter-row">
                <label :for="`${cardId}-weight-${idx}`" class="lora-field-label">权重</label>
                <linshe-input
                  :id="`${cardId}-weight-${idx}`"
                  v-model.number="item.weight"
                  type="number"
                  size="sm"
                  step="0.05"
                  min="0"
                  max="5"
                  class="lora-weight-input"
                  autocomplete="off"
                />
              </div>
            </div>
            <div class="lora-scenes" role="group" :aria-labelledby="`${cardId}-scenes-${idx}`">
              <span :id="`${cardId}-scenes-${idx}`" class="lora-field-label">适用范围</span>
              <div class="lora-scenes-chips">
                <linshe-button
                  v-for="s in sceneOptions"
                  :key="s.value"
                  variant="chip"
                  size="md"
                  :active="isSceneSelected(item, s.value)"
                  :aria-pressed="isSceneSelected(item, s.value)"
                  @click="toggleScene(item, s.value)"
                >
                  <span v-if="isSceneSelected(item, s.value)" class="scene-check" aria-hidden="true">✓</span>
                  {{ s.label }}
                </linshe-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TransitionGroup>

    <div v-if="ready && activeItems.length === 0" class="lora-empty-hint" :class="{ 'lora-list-reveal': loraRevision > 0 }">
      当前预设还没有 LoRA。
    </div>

    <div v-if="!ready && loadError" class="lora-load-error">
      <p class="lora-message" role="alert">{{ loadError }}</p>
      <linshe-button size="sm" @click="loadSettings">重试</linshe-button>
    </div>
    <p v-else-if="!ready" class="lora-message" role="status">正在载入全局 LoRA…</p>
    <template #footer>
      <linshe-button v-if="ready" class="lora-footer-action lora-library-entry" variant="secondary" size="md" :disabled="Boolean(pendingAction)" @click="libraryVisible = true">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></svg>
        全局 LoRA 库
      </linshe-button>
      <linshe-button class="lora-footer-action" variant="primary" size="md" :loading="pendingAction === 'save'" :disabled="!ready || Boolean(pendingAction)" @click="save">保存</linshe-button>
    </template>
  </linshe-modal>

  <GlobalLoraLibraryModal v-model="libraryVisible" :library="library" @saved="library = $event" />

  <linshe-modal v-model="addPresetVisible" title="新增 LoRA 预设" :transition-ms="300" :close-disabled="pendingAction === 'addPreset'">
    <form id="global-lora-preset-form" class="lora-preset-form" @submit.prevent="addPreset">
      <label class="fl" for="global-lora-preset-name">预设名称</label>
      <linshe-input
        id="global-lora-preset-name"
        v-model="presetName"
        maxlength="50"
        autocomplete="off"
        :disabled="pendingAction === 'addPreset'"
        :invalid="Boolean(presetNameError)"
        @input="presetNameError = ''"
      />
      <p v-if="presetNameError" class="lora-message lora-name-error" role="alert">{{ presetNameError }}</p>
    </form>
    <template #footer>
      <linshe-button :disabled="pendingAction === 'addPreset'" @click="addPresetVisible = false">取消</linshe-button>
      <linshe-button type="submit" form="global-lora-preset-form" variant="primary" :loading="pendingAction === 'addPreset'" :disabled="!presetName.trim()">新增预设</linshe-button>
    </template>
  </linshe-modal>

  <linshe-modal v-model="deletePresetVisible" title="删除 LoRA 预设" :transition-ms="300" :close-disabled="pendingAction === 'delete'" @after-leave="restorePresetFocus">
    <p class="lora-message">删除「{{ deleteTarget?.name }}」？当前生效的 LoRA 配置会保留。</p>
    <template #footer>
      <linshe-button :disabled="pendingAction === 'delete'" @click="deletePresetVisible = false">取消</linshe-button>
      <linshe-button variant="danger" :loading="pendingAction === 'delete'" @click="deletePreset">删除预设</linshe-button>
    </template>
  </linshe-modal>

  <linshe-modal v-model="switchDialogVisible" title="有未保存的修改" :transition-ms="300">
    <p class="lora-message">切换到「{{ switchTarget?.name }}」会放弃本次修改。</p>
    <template #footer>
      <linshe-button @click="switchDialogVisible = false">取消</linshe-button>
      <linshe-button variant="danger" @click="applyPreset">放弃并切换</linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
import { ref, computed, watch, inject, onBeforeUnmount, useId } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheTabs from './ui/LinsheTabs.vue'
import LinsheModal from './ui/LinsheModal.vue'
import GlobalLoraLibraryModal from './GlobalLoraLibraryModal.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'applied'])

const toastFn = inject('toast')
const cardId = useId()
const pickerId = useId()

const activeItems = ref([])
const appliedSnapshot = ref('[]')
const savedPresetSnapshot = ref(null)
const draftSnapshot = computed(() => JSON.stringify(activeItems.value))
const dirty = computed(() => draftSnapshot.value !== appliedSnapshot.value)
const loraRevision = ref(0)
const ready = ref(false)
const loadError = ref('')
let loadController

const library = ref({ loras: [], revision: 0 })
const libraryVisible = ref(false)
const pickerOpen = ref(false)
const loraPathKey = path => path.trim().replaceAll('\\', '/')
const availableLoras = computed(() => {
  const used = new Set(activeItems.value.map(item => loraPathKey(item.path)))
  return library.value.loras.filter(item => !used.has(loraPathKey(item.path)))
})

const presets = ref([])
const activePresetId = ref('')
const presetTabs = ref(null)
const presetOptions = computed(() => presets.value.map(({ id, name }) => ({ value: id, label: name, closeLabel: `删除预设「${name}」` })))
const pendingAction = ref('')
const addPresetButton = ref(null)
const addPresetVisible = ref(false)
const presetName = ref('')
const presetNameError = ref('')
const deletePresetVisible = ref(false)
const deleteTarget = ref(null)
const switchTarget = ref(null)
const switchDialogVisible = ref(false)

const sceneOptions = [
  { value: 'chat', label: '聊天' },
  { value: 'group', label: '群聊' },
  { value: 'portrait', label: '立绘' },
  { value: 'town_portrait', label: '小镇立绘' },
  { value: 'moments', label: '朋友圈' },
  { value: 'events', label: '奇遇' },
  { value: 'game', label: '游戏' },
  { value: 'sticker', label: '表情包' },
  { value: 'mailbox', label: '信件' },
  { value: 'schedule', label: '日程' },
]

// 表情包需显式开启；其余范围（含小镇立绘）默认勾选。
const defaultScenes = () => sceneOptions.filter(s => s.value !== 'sticker').map(s => s.value)

watch(() => props.modelValue, open => {
  if (!open) {
    loadController?.abort()
    pickerOpen.value = false
    return
  }
  loadSettings()
}, { immediate: true })

onBeforeUnmount(() => loadController?.abort())

async function loadSettings() {
  loadController?.abort()
  const controller = new AbortController()
  loadController = controller
  ready.value = false
  loadError.value = ''
  loraRevision.value = 0
  try {
    const data = await api.fetchGlobalLoraSettings({ signal: controller.signal })
    if (controller.signal.aborted) return
    setAppliedSettings(data)
    ready.value = true
  } catch (error) {
    if (!controller.signal.aborted) loadError.value = `读取全局 LoRA 失败。${error.message}`
  }
}

function setAppliedSettings({ globalLora, presets: savedPresets, activePresetId: appliedId, library: storedLibrary }) {
  presets.value = savedPresets
  activePresetId.value = appliedId ?? ''
  if (storedLibrary) library.value = storedLibrary
  const loras = Array.isArray(globalLora) ? globalLora.filter(item => item?.path && item.enabled !== false) : []
  activeItems.value = loras.map(item => ({
    ...item,
    scenes: Array.isArray(item.scenes) ? [...item.scenes] : null,
  }))
  appliedSnapshot.value = draftSnapshot.value
  savedPresetSnapshot.value = null
  emit('applied', loras)
}

function close() {
  emit('update:modelValue', false)
}

function addLibraryLora(item) {
  if (!availableLoras.value.includes(item)) return
  const { path, weight, triggerWord } = item
  activeItems.value.push({ path, weight, triggerWord, scenes: defaultScenes() })
}

function removeLoraGroup(idx) {
  activeItems.value.splice(idx, 1)
}

function isSceneSelected(item, scene) {
  return item.scenes === null || item.scenes.includes(scene)
}

function toggleScene(item, scene) {
  if (item.scenes === null) item.scenes = sceneOptions.map(option => option.value)
  const idx = item.scenes.indexOf(scene)
  if (idx >= 0) {
    item.scenes.splice(idx, 1)
  } else {
    item.scenes.push(scene)
  }
}

function snapshotDraft() {
  return activeItems.value.filter(item => item.path?.trim())
}

function openAddPreset() {
  presetName.value = ''
  presetNameError.value = ''
  addPresetVisible.value = true
}

async function addPreset() {
  const name = presetName.value.trim()
  if (!name || pendingAction.value) return
  pendingAction.value = 'addPreset'
  try {
    const data = await api.addGlobalLoraPreset(name, snapshotDraft())
    presets.value = data.presets
    savedPresetSnapshot.value = draftSnapshot.value
    addPresetVisible.value = false
    toastFn?.(`已新增预设「${name}」`, 'success')
  } catch (error) {
    presetNameError.value = error.message
  } finally {
    pendingAction.value = ''
  }
}

function openDeletePreset(id) {
  const preset = presets.value.find(item => item.id === id)
  if (!preset) return
  deleteTarget.value = preset
  deletePresetVisible.value = true
}

function restorePresetFocus() {
  if (!deleteTarget.value || presets.value.some(item => item.id === deleteTarget.value.id)) return
  if (presetTabs.value) presetTabs.value.focusTab()
  else addPresetButton.value?.$el.focus()
}

async function deletePreset() {
  if (pendingAction.value) return
  const preset = deleteTarget.value
  if (!preset) return
  pendingAction.value = 'delete'
  try {
    const data = await api.deleteGlobalLoraPreset(preset.id)
    if (dirty.value) {
      presets.value = data.presets
      if (!presets.value.some(item => item.id === activePresetId.value)) activePresetId.value = ''
    } else {
      setAppliedSettings(data)
    }
    deletePresetVisible.value = false
    toastFn?.(`已删除预设「${preset.name}」`, 'success')
  } catch (error) {
    toastFn?.(error.message, 'error')
  } finally {
    pendingAction.value = ''
  }
}

function selectPreset(id) {
  if (pendingAction.value || (id === activePresetId.value && !dirty.value)) return
  const preset = presets.value.find(item => item.id === id)
  if (!preset) return
  switchTarget.value = preset
  if (dirty.value && draftSnapshot.value !== savedPresetSnapshot.value) switchDialogVisible.value = true
  else applyPreset()
}

async function applyPreset() {
  if (pendingAction.value || !switchTarget.value) return
  const { id, name } = switchTarget.value
  switchDialogVisible.value = false
  const applied = await applyChanges('switch', () => api.activateGlobalLoraPreset(id), `已切换到「${name}」`)
  if (applied) {
    pickerOpen.value = false
    loraRevision.value++
  }
}

async function save() {
  if (pendingAction.value || !ready.value) return
  if (!dirty.value) return close()
  const loras = snapshotDraft()
  const saved = await applyChanges('save', () => api.updateGlobalLora(loras, activePresetId.value || null), 'LoRA 设置已保存')
  if (saved) close()
}

async function applyChanges(action, request, message) {
  pendingAction.value = action
  try {
    setAppliedSettings(await request())
    toastFn?.(message, 'success')
    return true
  } catch (error) {
    toastFn?.(error.message, 'error')
    return false
  } finally {
    pendingAction.value = ''
  }
}
</script>

<style scoped>
.lora-preset-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: flex-end;
  gap: 8px;
  padding: 7px 9px 0;
  background: var(--bg-primary);
  box-shadow: inset 0 -1px var(--border);
}
.lora-preset-tabs { flex: 1; min-width: 0; }
.lora-preset-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lora-preset-action { flex-shrink: 0; margin-inline-start: auto; }
.lora-footer-action { align-self: stretch; }
.lora-library-entry { margin-inline-end: auto; }
.lora-preset-form {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  column-gap: 12px;
}
.lora-message {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.lora-load-error { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.lora-name-error { grid-column: 2; margin-top: 8px; color: var(--danger); }
.lora-list-reveal { animation: lora-list-reveal var(--dur-interaction) var(--ease-standard); }
@keyframes lora-list-reveal { from { opacity: 0; } }

.lora-tab-hint {
  margin: 0 0 16px; font-size: 12px; color: var(--text-secondary); line-height: 1.5;
}

.lora-list { display: flex; flex-direction: column; gap: 10px; container-type: inline-size; }
.lora-card-entry { display: grid; grid-template-rows: 1fr; min-width: 0; }
.lora-item-card {
  min-width: 0;
  min-height: 0;
  background: color-mix(in srgb, var(--bg-secondary) 76%, var(--bg-primary));
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px 12px;
}
.lora-path-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lora-model-path { font-size: var(--fs-base); font-weight: 600; color: var(--text-bright); overflow-wrap: anywhere; }
.lora-field-label { font-size: var(--fs-sm); line-height: 1.4; color: var(--text-primary); }
.lora-card-details {
  display: grid;
  grid-template-columns: clamp(156px, 24%, 192px) minmax(0, 1fr);
  column-gap: 12px;
  margin-top: 12px;
}
.lora-parameters { --lora-label-width: 3.25em; display: grid; align-content: start; gap: 8px; }
.lora-parameter-row { display: grid; grid-template-columns: var(--lora-label-width) minmax(0, 1fr); gap: 8px; align-items: center; }
.lora-trigger-input { width: 8rem; max-width: 100%; min-width: 0; }
.lora-weight-input { width: 4rem; max-width: 100%; min-width: 0; text-align: center; }
.lora-scenes {
  display: grid;
  align-content: start;
  gap: 10px;
  border-inline-start: 1px solid var(--border);
  padding-inline-start: 16px;
}
.lora-scenes-chips { display: flex; flex-wrap: wrap; gap: 8px 6px; align-items: center; }
.scene-check { margin-right: 2px; font-size: 10px; }
.lora-card-enter-active, .lora-card-leave-active {
  overflow: hidden;
  transition: grid-template-rows var(--dur-interaction) var(--ease-standard), opacity var(--dur-interaction) var(--ease-standard);
}
.lora-card-enter-from, .lora-card-leave-to { grid-template-rows: 0fr; opacity: 0; }

@container (max-width: 480px) {
  .lora-card-details { grid-template-columns: minmax(0, 1fr); row-gap: 12px; }
  .lora-parameters { --lora-label-width: max-content; display: flex; flex-wrap: wrap; gap: 8px 14px; }
  .lora-trigger-input { width: 6.5rem; }
  .lora-scenes { border-inline-start: 0; border-block-start: 1px solid var(--border); padding: 10px 0 0; }
}

@media (prefers-reduced-motion: reduce) {
  .lora-card-enter-active, .lora-card-leave-active { transition: none; }
}
.lora-empty-hint { text-align: center; font-size: 13px; color: var(--text-secondary); padding: 20px 0; margin-bottom: 8px; }
.lora-add-actions, .lora-picker { margin-bottom: 12px; }
.lora-picker > .lora-message { padding: 8px 10px; }
.lora-picker-list { display: grid; gap: 8px; max-height: min(360px, 44vh); overflow-y: auto; list-style: none; }
.lora-picker-card {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
}
.lora-picker-file { display: grid; gap: 2px; }
.lora-picker-row { display: flex; align-items: flex-end; gap: 8px; }
.lora-picker-details {
  display: grid;
  grid-template-columns: clamp(3.5rem, 18%, 5rem) minmax(0, 1fr) minmax(0, 1.35fr);
  flex: 1;
  min-width: 0;
  gap: 8px;
}
.lora-picker-details dd { margin-top: 2px; font-size: var(--fs-base); color: var(--text-bright); overflow-wrap: anywhere; white-space: pre-wrap; }
.lora-picker-enter-active, .lora-picker-leave-active { transition: opacity var(--dur-interaction) var(--ease-standard); }
.lora-picker-enter-from, .lora-picker-leave-to { opacity: 0; }

</style>

