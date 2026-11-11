<template>
  <div ref="root" class="studio-select" :class="{ 'is-open': open, 'is-disabled': disabled }" @keydown="onKey" @focusout="onFocusOut">
    <div ref="trigger" class="studio-select-trigger" role="combobox" :tabindex="disabled ? -1 : 0" :aria-label="label" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="open ? listId : undefined" :aria-activedescendant="open && !searchable && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined" :aria-disabled="disabled" @click="toggle">
      <span>{{ selectedLabel }}</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg>
    </div>
    <Transition name="studio-select">
      <div v-if="open" class="studio-select-menu">
        <studio-input v-if="searchable" ref="search" v-model="query" :aria-label="`搜索${label}`" role="combobox" aria-expanded="true" :aria-controls="listId" :aria-activedescendant="activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined" placeholder="查找分类…" />
        <div :id="listId" ref="list" role="listbox" :aria-label="label" class="studio-select-list">
          <div v-for="(option, index) in filtered" :id="`${listId}-${index}`" :key="option.value" role="option" :aria-selected="option.value === modelValue" class="studio-select-option" :class="{ 'is-active': index === activeIndex, 'is-selected': option.value === modelValue }" @pointerdown.prevent @click="choose(option)"><span>{{ option.label }}</span><span v-if="option.value === modelValue" aria-hidden="true">✓</span></div>
          <div v-if="!filtered.length" class="studio-select-empty" role="status">没有匹配的分类</div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, useId } from 'vue'
import StudioInput from './StudioInput.vue'
defineOptions({ inheritAttrs: false })
const props = defineProps({ modelValue: { type: [String, Number], default: '' }, options: { type: Array, default: () => [] }, searchable: Boolean, disabled: Boolean, label: { type: String, required: true }, placeholder: { type: String, default: '请选择' } })
const emit = defineEmits(['update:modelValue'])
const root = ref(null), trigger = ref(null), search = ref(null), list = ref(null), open = ref(false), query = ref(''), activeIndex = ref(-1)
const listId = `studio-select-${useId()}`
const selectedLabel = computed(() => props.options.find(option => option.value === props.modelValue)?.label || props.placeholder)
const filtered = computed(() => props.options.filter(option => option.label.toLowerCase().includes(query.value.trim().toLowerCase())))
function close(restore = false) { open.value = false; if (restore) trigger.value?.focus() }
async function toggle() {
  if (props.disabled) return
  if (open.value) { close(); return }
  document.dispatchEvent(new CustomEvent('studio-select-open', { detail: listId }))
  query.value = ''; open.value = true
  await nextTick()
  if (!open.value) return
  activeIndex.value = Math.max(0, filtered.value.findIndex(option => option.value === props.modelValue))
  if (props.searchable) search.value?.focus()
  revealActive()
}
function choose(option) { if (props.disabled) return; emit('update:modelValue', option.value); close(true) }
function revealActive() { nextTick(() => list.value?.children[activeIndex.value]?.scrollIntoView({ block: 'nearest' })) }
function onKey(event) {
  if (event.key === 'Escape' && open.value) { event.preventDefault(); event.stopPropagation(); close(true); return }
  if (event.key === 'Tab') { close(); return }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    if (!open.value && ['Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (!open.value) { void toggle(); return }
    const count = filtered.value.length
    activeIndex.value = !count ? -1 : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
    revealActive()
  } else if (event.key === 'Enter' || (event.key === ' ' && event.target === trigger.value)) {
    event.preventDefault()
    if (open.value && filtered.value[activeIndex.value]) choose(filtered.value[activeIndex.value])
    else if (!open.value) void toggle()
  }
}
function onOutside(event) { if (!root.value?.contains(event.target)) close() }
function onOtherOpen(event) { if (event.detail !== listId) close() }
function onFocusOut(event) { if (event.relatedTarget && !root.value?.contains(event.relatedTarget)) close() }
watch(query, () => { activeIndex.value = filtered.value.length ? 0 : -1 })
watch(() => props.disabled, value => { if (value) close() })
onMounted(() => { document.addEventListener('pointerdown', onOutside); document.addEventListener('studio-select-open', onOtherOpen) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', onOutside); document.removeEventListener('studio-select-open', onOtherOpen) })
</script>

<style scoped>
.studio-select{position:relative;min-width:0;color:var(--studio-ink)}.studio-select.is-open{z-index:25}.studio-select-trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;padding:10px 12px;border:1px solid var(--studio-ink);border-bottom-width:3px;background:url('../../assets/studio-photocopy.svg'),var(--studio-paper);font-size:13px;line-height:1.6;cursor:pointer;text-align:left;transition:border-color .3s,box-shadow .3s}.studio-select-trigger>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.studio-select-trigger svg{width:18px;height:18px;flex-shrink:0;color:var(--studio-tag);transition:transform .3s}.is-open .studio-select-trigger svg{transform:rotate(180deg)}.studio-select-trigger:hover,.studio-select-trigger:focus-visible,.is-open .studio-select-trigger{outline:none;border-color:var(--studio-tag);box-shadow:inset 3px 0 var(--studio-tag)}.is-disabled{opacity:.5}.is-disabled .studio-select-trigger{cursor:not-allowed}
.studio-select-menu{position:absolute;top:calc(100% + 5px);left:0;right:0;border:1px solid var(--studio-ink);padding:6px;background:var(--studio-paper);box-shadow:4px 4px 0 var(--studio-shadow)}.studio-select-list{max-height:min(240px,35dvh);overflow:auto;overscroll-behavior:contain;scrollbar-color:var(--studio-muted) var(--studio-paper)}.studio-select-option{display:flex;justify-content:space-between;gap:8px;min-height:44px;align-items:center;padding:9px 10px;font-size:13px;line-height:1.6;cursor:pointer;border-bottom:1px dashed var(--studio-line);overflow-wrap:anywhere}.studio-select-option:last-child{border-bottom:0}.studio-select-option:hover,.studio-select-option.is-active{background:var(--studio-bg)}.studio-select-option.is-selected{color:var(--studio-tag);font-weight:800}.studio-select-empty{padding:14px 10px;font-size:13px;color:var(--studio-muted)}.studio-select-enter-active,.studio-select-leave-active{transition:opacity .3s,transform .3s}.studio-select-enter-from,.studio-select-leave-to{opacity:0;transform:translateY(-5px)}
@media(prefers-reduced-motion:reduce){.studio-select *{transition:none}}
</style>
