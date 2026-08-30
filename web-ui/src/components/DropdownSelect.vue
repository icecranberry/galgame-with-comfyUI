<template>
  <div ref="wrapper" class="dds-wrapper" :class="{ 'is-open': open }">
    <div v-if="searchable" class="dds-search-trigger">
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
    <Transition name="dds-drop">
      <div v-if="open" class="dds-dropdown" role="listbox" @click.stop>
        <button
          v-for="(opt, index) in visibleOptions"
          :key="opt.value"
          class="dds-option"
          :class="{ active: modelValue === opt.value, highlighted: searchable && activeIndex === index }"
          role="option"
          :aria-selected="modelValue === opt.value"
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
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '请选择…' },
  searchable: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const wrapper = ref(null)
const searchInput = ref(null)
const open = ref(false)
const searchText = ref('')
const activeIndex = ref(-1)

const selectedLabel = computed(() => {
  if (props.searchable && (props.modelValue === '' || props.modelValue === null || props.modelValue === undefined)) return ''
  const found = props.options.find(o => o.value === props.modelValue)
  return found ? found.label : ''
})
const visibleOptions = computed(() => {
  if (!props.searchable) return props.options
  const query = normalizeSearch(searchText.value)
  if (!query || searchText.value === selectedLabel.value) return props.options
  return props.options
    .map((option, index) => ({ option, index, score: fuzzyScore(option.label, query) }))
    .filter(item => item.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(item => item.option)
})

watch(selectedLabel, label => {
  if (!open.value) searchText.value = label
}, { immediate: true })

function toggle() {
  open.value = !open.value
}

function select(val) {
  emit('update:modelValue', val)
  const option = props.options.find(item => item.value === val)
  searchText.value = props.searchable && (val === '' || val === null || val === undefined) ? '' : (option?.label || '')
  open.value = false
  activeIndex.value = -1
}

function onKey(e) {
  if (e.key === 'Escape' && open.value) {
    open.value = false
    e.stopPropagation()
  }
}

function openSearch() {
  if (!props.searchable) return
  if (!open.value) {
    open.value = true
    activeIndex.value = Math.max(0, visibleOptions.value.findIndex(option => option.value === props.modelValue))
    nextTick(() => searchInput.value?.select())
  }
}

function handleSearchInput() {
  open.value = true
  activeIndex.value = visibleOptions.value.length ? 0 : -1
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
  searchText.value = selectedLabel.value
}

function onDocumentClick(e) {
  if (wrapper.value && !wrapper.value.contains(e.target)) {
    if (props.searchable) closeSearch()
    else open.value = false
  }
}

function onDocumentKey(e) {
  if (e.key === 'Escape' && open.value) {
    if (props.searchable) closeSearch()
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
})
</script>

<style scoped>
.dds-wrapper { position: relative; width: 100%; }
.dds-wrapper.is-open { z-index: 1000; }

.dds-search-trigger { position: relative; }
.dds-search-input {
  box-sizing: border-box;
  width: 100%; padding: 9px 32px 9px 12px;
  font-size: 13px; font-family: inherit;
  border-radius: 8px;
  background: rgba(255,255,255,0.9);
  border: 1px solid var(--border);
  color: var(--text-bright);
  outline: none;
  transition: border-color 0.25s, box-shadow 0.25s;
}
.dds-search-input::placeholder { color: #b0a89c; }
.dds-search-input:hover { border-color: #c5bfb5; }
.dds-search-input:focus { border-color: var(--accent); box-shadow: var(--focus-ring); }

.dds-trigger {
  width: 100%; padding: 9px 32px 9px 12px;
  font-size: 13px; font-family: inherit;
  border-radius: 8px; cursor: pointer;
  background: rgba(255,255,255,0.9);
  border: 1px solid var(--border);
  color: var(--text-bright);
  outline: none;
  text-align: left;
  position: relative;
  transition: border-color 0.25s, box-shadow 0.25s;
}
.dds-trigger:hover { border-color: #c5bfb5; }
.dds-trigger:focus-visible,
.dds-wrapper:focus-within .dds-trigger { border-color: var(--accent); box-shadow: var(--focus-ring); }

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
  position: absolute; left: 0; right: 0; top: calc(100% + 4px);
  background: #fff;
  border: 1px solid #e2d6c7;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06);
  z-index: 1000;
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
  transform-origin: top center;
}

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
.dds-option:hover { background: rgba(var(--accent-rgb), 0.08); color: var(--accent); }
.dds-option.highlighted { background: rgba(var(--accent-rgb), 0.08); color: var(--accent); }
.dds-option.active { background: rgba(var(--accent-rgb), 0.06); color: var(--accent); font-weight: 600; }

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
</style>
