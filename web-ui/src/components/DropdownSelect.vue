<template>
  <div class="dds-wrapper" ref="wrapper">
    <button class="dds-trigger" @click="toggle" @keydown="onKey" type="button">
      <span class="dds-label" :class="{ placeholder: !selectedLabel }">{{ selectedLabel || placeholder }}</span>
      <svg class="dds-chevron" :class="{ open }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <Transition name="dds-drop">
      <div v-if="open" class="dds-dropdown" @click.stop>
        <button
          v-for="opt in options"
          :key="opt.value"
          class="dds-option"
          :class="{ active: modelValue === opt.value }"
          @click="select(opt.value)"
          type="button"
        >
          <span>{{ opt.label }}</span>
          <svg v-if="modelValue === opt.value" class="dds-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <div v-if="options.length === 0" class="dds-empty">暂无选项</div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '请选择…' },
})

const emit = defineEmits(['update:modelValue'])

const wrapper = ref(null)
const open = ref(false)

const selectedLabel = computed(() => {
  const found = props.options.find(o => o.value === props.modelValue)
  return found ? found.label : ''
})

function toggle() {
  open.value = !open.value
}

function select(val) {
  emit('update:modelValue', val)
  open.value = false
}

function onKey(e) {
  if (e.key === 'Escape' && open.value) {
    open.value = false
    e.stopPropagation()
  }
}

function onDocumentClick(e) {
  if (wrapper.value && !wrapper.value.contains(e.target)) {
    open.value = false
  }
}

function onDocumentKey(e) {
  if (e.key === 'Escape' && open.value) {
    open.value = false
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
  position: absolute; left: 0; right: 0; top: calc(100% + 4px);
  background: #fff;
  border: 1px solid #e2d6c7;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06);
  z-index: 100;
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
.dds-option:hover { background: rgba(224, 123, 108, 0.08); color: var(--accent); }
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
</style>
