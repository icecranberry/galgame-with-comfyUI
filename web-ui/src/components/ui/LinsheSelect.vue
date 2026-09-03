<template>
  <div ref="wrapper" class="ls-select-wrapper" :class="[`ls-select--${size}`, { 'is-open': open, 'is-disabled': disabled }]">
    <div v-if="inputMode" class="ls-select-search-trigger">
      <linshe-input
        ref="searchInput"
        v-model="searchText"
        class="ls-select-search-input"
        :size="size"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        :aria-label="ariaLabel || placeholder"
        :aria-expanded="open"
        :placeholder="placeholder"
        autocomplete="off"
        :disabled="disabled || undefined"
        @focus="openSearch"
        @click.stop="openSearch"
        @input="handleSearchInput"
        @keydown="onSearchKey"
      />
      <svg class="ls-select-chevron" :class="{ open }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div
      v-else
      class="ls-select-trigger"
      role="combobox"
      tabindex="0"
      :aria-label="ariaLabel || placeholder"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-disabled="disabled || undefined"
      @click="toggle"
      @keydown="onKey"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <span class="ls-select-label" :class="{ placeholder: !selectedLabel }">{{ selectedLabel || placeholder }}</span>
      <svg class="ls-select-chevron" :class="{ open }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <Teleport to="body">
      <Transition name="ls-select-drop">
        <div
          v-if="open"
          ref="panel"
          class="ls-select-dropdown"
          :class="{ up: isUp }"
          :style="panelStyle"
          role="listbox"
          @click.stop
        >
          <div
            v-for="(opt, index) in visibleOptions"
            :key="opt.value"
            class="ls-select-option"
            :class="{ active: modelValue === opt.value, highlighted: inputMode && activeIndex === index }"
            role="option"
            tabindex="-1"
            :aria-selected="modelValue === opt.value"
            :title="opt.label"
            @mouseenter="activeIndex = index"
            @click="select(opt.value)"
          >
            <span>{{ opt.label }}</span>
            <svg v-if="modelValue === opt.value" class="ls-select-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div v-if="visibleOptions.length === 0" class="ls-select-empty">没有匹配的选项</div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import LinsheInput from './LinsheInput.vue'

defineOptions({ name: 'LinsheSelect' })

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '请选择…' },
  /** sm / md / lg，与 LinsheButton / LinsheInput 尺寸对齐 */
  size: { type: String, default: 'md' },
  disabled: { type: Boolean, default: false },
  searchable: { type: Boolean, default: false },
  /** 自由输入模式（输入即值，选项仅作联想建议），需配合可输入 UI 使用 */
  allowFreeInput: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const DROP_GAP = 4
const DROP_MAX_HEIGHT = 220

const wrapper = ref(null)
const searchInput = ref(null)
const panel = ref(null)
const open = ref(false)
const searchText = ref('')
const activeIndex = ref(-1)
const isUp = ref(false)
const panelStyle = ref({})
const freeDirty = ref(false)

const inputMode = computed(() => props.searchable || props.allowFreeInput)

const selectedLabel = computed(() => {
  if (inputMode.value && (props.modelValue === '' || props.modelValue === null || props.modelValue === undefined)) return ''
  const found = props.options.find(o => o.value === props.modelValue)
  if (found) return found.label
  return props.allowFreeInput ? String(props.modelValue ?? '') : ''
})
const visibleOptions = computed(() => {
  if (!inputMode.value) return props.options
  const query = normalizeSearch(searchText.value)
  const unfiltered = !query || (searchText.value === selectedLabel.value && !(props.allowFreeInput && freeDirty.value))
  if (unfiltered) return props.options
  return props.options
    .map((option, index) => ({ option, index, score: fuzzyScore(option.label, query) }))
    .filter(item => item.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(item => item.option)
})

watch(selectedLabel, label => {
  if (!open.value) searchText.value = label
}, { immediate: true })

watch(open, value => {
  if (value) {
    nextTick(positionPanel)
    document.addEventListener('scroll', positionPanel, true)
    document.addEventListener('resize', positionPanel)
  } else {
    document.removeEventListener('scroll', positionPanel, true)
    document.removeEventListener('resize', positionPanel)
  }
})

/** 面板 Teleport 到 body，跟随触发器定位；下方空间不足时向上翻转 */
function positionPanel() {
  const el = wrapper.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const wanted = Math.min(panel.value?.offsetHeight || DROP_MAX_HEIGHT, DROP_MAX_HEIGHT)
  const spaceBelow = window.innerHeight - rect.bottom - DROP_GAP
  const spaceAbove = rect.top - DROP_GAP
  isUp.value = spaceBelow < wanted && spaceAbove > spaceBelow
  panelStyle.value = {
    left: `${Math.round(rect.left)}px`,
    width: `${Math.round(rect.width)}px`,
    ...(isUp.value
      ? { bottom: `${Math.round(window.innerHeight - rect.top + DROP_GAP)}px` }
      : { top: `${Math.round(rect.bottom + DROP_GAP)}px` }),
  }
}

function toggle() {
  if (props.disabled) return
  open.value = !open.value
}

/** 供父组件程序化展开（如获取模型列表后自动弹出） */
function openPanel() {
  if (props.disabled) return
  if (!props.searchable && !props.allowFreeInput) {
    open.value = true
    return
  }
  if (!open.value) {
    open.value = true
    freeDirty.value = false
    activeIndex.value = Math.max(0, visibleOptions.value.findIndex(option => option.value === props.modelValue))
    nextTick(() => searchInput.value?.focus())
  }
}

function select(val) {
  if (props.disabled) return
  emit('update:modelValue', val)
  const empty = val === '' || val === null || val === undefined
  const option = props.options.find(item => item.value === val)
  searchText.value = inputMode.value && empty ? '' : (option?.label || String(val ?? ''))
  open.value = false
  activeIndex.value = -1
  freeDirty.value = false
}

function onKey(e) {
  if (props.disabled) return
  if (e.key === 'Escape' && open.value) {
    open.value = false
    e.stopPropagation()
  }
}

function openSearch() {
  if (props.disabled || !inputMode.value) return
  openPanel()
  if (open.value) nextTick(() => searchInput.value?.select())
}

function handleSearchInput() {
  open.value = true
  if (props.allowFreeInput) {
    activeIndex.value = -1
    freeDirty.value = true
    emit('update:modelValue', searchText.value)
  } else {
    activeIndex.value = visibleOptions.value.length ? 0 : -1
  }
}

function onSearchKey(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) open.value = true
    const length = visibleOptions.value.length
    if (!length) return
    const step = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = (activeIndex.value + step + length) % length
  } else if (event.key === 'Enter' && open.value && activeIndex.value >= 0) {
    event.preventDefault()
    select(visibleOptions.value[activeIndex.value].value)
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    closeSearch()
  } else if (event.key === 'Tab') {
    closeSearch()
  }
}

function normalizeSearch(value) {
  return String(value || '').toLocaleLowerCase().replace(/\s+/g, '')
}

function fuzzyScore(label, normalizedQuery) {
  const text = normalizeSearch(label)
  if (!normalizedQuery) return 0
  if (text === normalizedQuery) return 0
  if (text.startsWith(normalizedQuery)) return 1
  const containedAt = text.indexOf(normalizedQuery)
  if (containedAt >= 0) return 2 + containedAt / 100
  let queryIndex = 0
  let firstMatch = -1
  let lastMatch = -1
  for (let index = 0; index < text.length && queryIndex < normalizedQuery.length; index++) {
    if (text[index] === normalizedQuery[queryIndex]) {
      if (firstMatch < 0) firstMatch = index
      lastMatch = index
      queryIndex++
    }
  }
  return queryIndex === normalizedQuery.length ? 10 + (lastMatch - firstMatch) / 100 : null
}

function closeSearch() {
  open.value = false
  activeIndex.value = -1
  freeDirty.value = false
  searchText.value = selectedLabel.value
}

function onDocumentClick(e) {
  if (wrapper.value && !wrapper.value.contains(e.target) && !(panel.value && panel.value.contains(e.target))) {
    if (inputMode.value) closeSearch()
    else open.value = false
  }
}

function onDocumentKey(e) {
  if (e.key === 'Escape' && open.value) {
    if (inputMode.value) closeSearch()
    else open.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick, true)
  document.addEventListener('keydown', onDocumentKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick, true)
  document.removeEventListener('keydown', onDocumentKey)
  document.removeEventListener('scroll', positionPanel, true)
  document.removeEventListener('resize', positionPanel)
})

defineExpose({ open: openPanel })
</script>

<style scoped>
/* ── 软糖凹陷选择框 ──
   触发器与 LinsheInput 同一皮肤（糖纸凹痕，聚焦时被珊瑚色照亮），
   选项面板是轻量浮层：白底暖描边 + 珊瑚色选中态 */
.ls-select-wrapper { position: relative; width: 100%; }

.ls-select-search-trigger { position: relative; }
.ls-select-search-trigger .ls-select-search-input {
  box-sizing: border-box;
  width: 100%; padding: 6px 30px 6px 12px;
}

.ls-select-trigger {
  box-sizing: border-box; width: 100%;
  font-family: inherit; line-height: 1.4;
  color: var(--text-bright);
  background: var(--bg-secondary);
  border: 1.5px solid var(--border);
  border-radius: 10px;
  cursor: pointer; user-select: none;
  outline: none;
  text-align: left;
  position: relative;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background-color 0.15s ease;
}
.ls-select--md .ls-select-trigger { min-height: 36px; padding: 6px 30px 6px 12px; font-size: 13px; }

/* ── 尺寸（与 LinsheButton / LinsheInput 对齐） ── */
.ls-select--sm .ls-select-trigger { min-height: 26px; padding: 3px 26px 3px 9px; font-size: 12px; border-radius: 8px; }
.ls-select--lg .ls-select-trigger { min-height: 42px; padding: 10px 32px 10px 14px; font-size: 14px; border-radius: 12px; }

.ls-select-label { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ls-select-label.placeholder { color: var(--text-secondary); }

/* ── 悬停：边框加深一点（同 LinsheInput） ── */
.ls-select-trigger:hover { border-color: var(--border-strong); }

/* ── 展开 / 聚焦：凹痕被主题色照亮 ── */
.ls-select-trigger:focus-visible,
.ls-select-wrapper.is-open:not(.is-disabled) .ls-select-trigger {
  background: var(--bg-secondary);
  border-color: var(--accent);
  box-shadow:
    0 0 0 3px rgba(var(--accent-rgb), 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.ls-select-chevron {
  position: absolute; right: 10px; top: 50%;
  transform: translateY(-50%);
  color: var(--text-secondary);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), color 0.25s;
  pointer-events: none;
}
.ls-select--sm .ls-select-chevron { right: 8px; }
.ls-select--lg .ls-select-chevron { right: 12px; }
.ls-select-chevron.open { transform: translateY(-50%) rotate(180deg); color: var(--accent); }

/* ── 禁用：同 LinsheInput ── */
.ls-select-wrapper.is-disabled .ls-select-trigger {
  background: var(--bg-tertiary);
  border-color: var(--border);
  color: var(--text-secondary);
  cursor: not-allowed;
  box-shadow: none;
}
.ls-select-wrapper.is-disabled .ls-select-trigger:hover { border-color: var(--border); }
.ls-select-wrapper.is-disabled .ls-select-label.placeholder { color: var(--text-secondary); }
.ls-select-wrapper.is-disabled .ls-select-chevron { color: var(--text-secondary); }

/* ── 选项面板：轻量浮层 ── */
.ls-select-dropdown {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06);
  z-index: 11000;
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
  transform-origin: top center;
}
.ls-select-dropdown.up { transform-origin: bottom center; }

.ls-select-option {
  box-sizing: border-box;
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 9px 10px;
  font-size: 13px; font-weight: 400; font-family: inherit;
  border: none; border-radius: 6px;
  background: transparent;
  color: var(--text-bright);
  cursor: pointer; user-select: none;
  text-align: left;
  transition: background 0.15s, color 0.15s;
}
.ls-select-option:hover,
.ls-select-option.highlighted { background: rgba(var(--accent-rgb), 0.08); color: var(--accent); }
.ls-select-option.active { background: rgba(var(--accent-rgb), 0.1); color: var(--accent-hover); font-weight: 600; }

.ls-select-check { flex-shrink: 0; color: var(--accent); }

.ls-select-empty { padding: 16px; text-align: center; font-size: 13px; color: var(--text-secondary); }

.ls-select-drop-enter-active {
  transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.ls-select-drop-leave-active {
  transition: opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
.ls-select-drop-enter-from,
.ls-select-drop-leave-to {
  opacity: 0;
  transform: scaleY(0.9) translateY(-6px);
}
.ls-select-dropdown.up.ls-select-drop-enter-from,
.ls-select-dropdown.up.ls-select-drop-leave-to {
  transform: scaleY(0.9) translateY(6px);
}

/* ── 减弱动效 ── */
@media (prefers-reduced-motion: reduce) {
  .ls-select-trigger,
  .ls-select-chevron,
  .ls-select-option { transition: none; }
}
</style>
