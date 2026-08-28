<template>
  <div ref="wrapper" class="dds-wrapper" :class="{ 'is-open': open }">
    <div v-if="inputMode" class="dds-search-trigger">
      <input
        ref="searchInput"
        v-model="searchText"
        class="dds-search-input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        :aria-label="ariaLabel || placeholder"
        :aria-expanded="open"
        :placeholder="placeholder"
        autocomplete="off"
        @focus="openSearch"
        @click.stop="openSearch"
        @input="handleSearchInput"
        @keydown="onSearchKey"
      >
      <svg class="dds-chevron" :class="{ open }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <button v-else class="dds-trigger" :aria-label="ariaLabel || placeholder" :aria-expanded="open" aria-haspopup="listbox" @click="toggle" @keydown="onKey" type="button">
      <span class="dds-label" :class="{ placeholder: !selectedLabel }">{{ selectedLabel || placeholder }}</span>
      <svg class="dds-chevron" :class="{ open }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <Teleport to="body">
      <Transition name="dds-drop">
        <div
          v-if="open"
          ref="panel"
          class="dds-dropdown"
          :class="{ up: isUp }"
          :style="panelStyle"
          role="listbox"
          @click.stop
        >
          <button
            v-for="(opt, index) in visibleOptions"
            :key="opt.value"
            class="dds-option"
            :class="{ active: modelValue === opt.value, highlighted: inputMode && activeIndex === index }"
            role="option"
            :aria-selected="modelValue === opt.value"
            :title="opt.label"
            @mouseenter="activeIndex = index"
            @click="select(opt.value)"
            type="button"
          >
            <span>{{ opt.label }}</span>
            <svg v-if="modelValue === opt.value" class="dds-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <div v-if="visibleOptions.length === 0" class="dds-empty">没有匹配的选项</div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '请选择…' },
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
  open.value = !open.value
}

/** 供父组件程序化展开（如获取模型列表后自动弹出） */
function openPanel() {
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
  emit('update:modelValue', val)
  const empty = val === '' || val === null || val === undefined
  const option = props.options.find(item => item.value === val)
  searchText.value = inputMode.value && empty ? '' : (option?.label || String(val ?? ''))
  open.value = false
  activeIndex.value = -1
  freeDirty.value = false
}

function onKey(e) {
  if (e.key === 'Escape' && open.value) {
    open.value = false
    e.stopPropagation()
  }
}

function openSearch() {
  if (!inputMode.value) return
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
.dds-wrapper { position: relative; width: 100%; }

.dds-search-trigger { position: relative; }
.dds-search-input {
  box-sizing: border-box;
  width: 100%; padding: 9px 32px 9px 12px;
  font-size: 13px; font-family: inherit;
  border-radius: 8px;
  background: rgba(255,255,255,0.9);
  border: 1px solid #d5d0ca;
  color: var(--text-bright);
  outline: none;
  transition: border-color 0.25s, box-shadow 0.25s;
}
.dds-search-input::placeholder { color: #b0a89c; }
.dds-search-input:hover { border-color: #c5bfb5; }
.dds-search-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.12); }

.dds-trigger {
  width: 100%; padding: 9px 32px 9px 12px;
  font-size: 13px; font-family: inherit;
  border-radius: 8px; cursor: pointer;
  background: rgba(255,255,255,0.9);
  border: 1px solid #d5d0ca;
  color: var(--text-bright);
  outline: none;
  text-align: left;
  position: relative;
  transition: border-color 0.25s, box-shadow 0.25s;
}
.dds-trigger:hover { border-color: #c5bfb5; }
.dds-trigger:focus-visible,
.dds-wrapper:focus-within .dds-trigger { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.12); }

.dds-label { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dds-label.placeholder { color: #b0a89c; }

.dds-chevron {
  position: absolute; right: 10px; top: 50%;
  transform: translateY(-50%);
  color: #b0a89c;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), color 0.25s;
  pointer-events: none;
}
.dds-chevron.open { transform: translateY(-50%) rotate(180deg); color: var(--accent); }

.dds-dropdown {
  position: fixed;
  background: #fff;
  border: 1px solid #e2d6c7;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06);
  z-index: 11000;
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
  transform-origin: top center;
}
.dds-dropdown.up { transform-origin: bottom center; }

.dds-option {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 9px 10px;
  font-size: 13px; font-family: inherit;
  border: none; border-radius: 6px;
  background: transparent;
  color: var(--text-bright);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, color 0.15s;
}
.dds-option:hover { background: rgba(224, 123, 108, 0.08); color: var(--accent); }
.dds-option.highlighted { background: rgba(224, 123, 108, 0.08); color: var(--accent); }
.dds-option.active { background: rgba(224, 123, 108, 0.06); color: var(--accent); font-weight: 600; }

.dds-check { flex-shrink: 0; color: var(--accent); }

.dds-empty { padding: 16px; text-align: center; font-size: 13px; color: var(--text-secondary); }

.dds-drop-enter-active {
  transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.dds-drop-leave-active {
  transition: opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
.dds-drop-enter-from,
.dds-drop-leave-to {
  opacity: 0;
  transform: scaleY(0.9) translateY(-6px);
}
.dds-dropdown.up.dds-drop-enter-from,
.dds-dropdown.up.dds-drop-leave-to {
  transform: scaleY(0.9) translateY(6px);
}
</style>
