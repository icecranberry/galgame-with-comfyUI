<template>
  <div ref="anchor" class="studio-outfit-picker">
    <slot :open="open" :toggle="toggle" :keydown="onTriggerKey" :menu-id="menuId" :active-id="activeId" />
    <Teleport to="body">
      <Transition name="studio-wardrobe">
        <div v-if="open" :id="menuId" ref="panel" class="studio-wardrobe" :style="panelStyle" role="listbox" aria-label="选择入镜服装" :aria-busy="loading" @pointerdown.stop>
          <div class="wardrobe-heading"><strong>衣柜</strong><span v-if="!loading && !error">{{ options.length }} 套</span></div>
          <div v-if="loading" class="wardrobe-status" role="status">查找服装…</div>
          <div v-else-if="error" class="wardrobe-status" role="alert"><span>{{ error }}</span><studio-button size="sm" variant="ghost" @click="load">重试</studio-button></div>
          <template v-else>
            <div v-for="(option, index) in options" :id="`${menuId}-${index}`" :key="option.value" class="wardrobe-option" :class="{ selected: option.value === modelValue, highlighted: index === activeIndex }" role="option" tabindex="-1" :aria-selected="option.value === modelValue" @mouseenter="activeIndex = index" @click="select(option.value)">
              <span class="wardrobe-number" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span><span class="wardrobe-label">{{ option.label }}<small v-if="option.name">{{ option.name }}</small></span><span v-if="option.value === modelValue" class="wardrobe-check" aria-hidden="true">✓</span>
            </div>
          </template>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { listSceneOutfits } from '../../api/index.js'
import { studioOutfitOptions } from '../../utils/studioWardrobe.js'
import StudioButton from './StudioButton.vue'

const props = defineProps({ characterId: { type: [Number, String], required: true }, modelValue: { type: String, default: 'work' } })
const emit = defineEmits(['update:modelValue', 'open'])
const menuId = `studio-wardrobe-${useId()}`
const anchor = ref(null), panel = ref(null), open = ref(false), loading = ref(false), error = ref('')
const options = ref([]), activeIndex = ref(-1), panelStyle = ref({})
const activeId = computed(() => open.value && activeIndex.value >= 0 ? `${menuId}-${activeIndex.value}` : undefined)
let requestVersion = 0

async function load() {
  const version = ++requestVersion
  loading.value = true
  error.value = ''
  try {
    const result = await listSceneOutfits(props.characterId)
    if (version !== requestVersion) return
    options.value = studioOutfitOptions(result.outfits)
    if (!options.value.some(option => option.value === props.modelValue)) emit('update:modelValue', 'work')
    activeIndex.value = Math.max(0, options.value.findIndex(option => option.value === props.modelValue))
  } catch {
    if (version === requestVersion) error.value = '服装读取失败'
  } finally {
    if (version === requestVersion) {
      loading.value = false
      await nextTick()
      position()
    }
  }
}
function position() {
  if (!open.value || !anchor.value || !panel.value) return
  const rect = anchor.value.getBoundingClientRect()
  const width = Math.min(224, window.innerWidth - 16)
  const height = panel.value.offsetHeight
  const above = rect.top - 8, below = window.innerHeight - rect.bottom - 8
  panelStyle.value = {
    width: `${width}px`,
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
    top: `${Math.max(8, Math.min(above >= height || above > below ? rect.top - height - 8 : rect.bottom + 8, window.innerHeight - height - 8))}px`,
  }
}
function close(restoreFocus = false) {
  open.value = false
  requestVersion++
  if (restoreFocus) anchor.value?.querySelector('[role="combobox"]')?.focus({ preventScroll: true })
}
function toggle() {
  if (open.value) { close(); return }
  window.dispatchEvent(new CustomEvent('studio-wardrobe-open', { detail: menuId }))
  open.value = true
  emit('open')
  void load()
}
function select(value) { emit('update:modelValue', value); close(true) }
function onTriggerKey(event) {
  if (['Enter', ' '].includes(event.key)) {
    event.preventDefault()
    if (open.value && !loading.value && !error.value && activeIndex.value >= 0) select(options.value[activeIndex.value].value)
    else toggle()
  } else if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault()
    if (!open.value) { toggle(); return }
    if (loading.value || !options.value.length) return
    activeIndex.value = (activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + options.value.length) % options.value.length
  } else if (event.key === 'Escape') { event.preventDefault(); close(true) }
  else if (event.key === 'Tab') close()
}
function onOutside(event) {
  if (open.value && !anchor.value?.contains(event.target) && !panel.value?.contains(event.target)) close()
}
function onOtherOpen(event) { if (event.detail !== menuId) close() }
function onEscape(event) { if (open.value && event.key === 'Escape') { event.stopPropagation(); close(true) } }
watch(open, value => {
  if (value) {
    nextTick(position)
    document.addEventListener('scroll', position, true)
    window.addEventListener('resize', position)
  } else {
    document.removeEventListener('scroll', position, true)
    window.removeEventListener('resize', position)
  }
})
watch(() => props.characterId, () => close())
onMounted(() => {
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('keydown', onEscape)
  window.addEventListener('studio-wardrobe-open', onOtherOpen)
})
onBeforeUnmount(() => {
  requestVersion++
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('keydown', onEscape)
  document.removeEventListener('scroll', position, true)
  window.removeEventListener('resize', position)
  window.removeEventListener('studio-wardrobe-open', onOtherOpen)
})
</script>

<style scoped>
.studio-outfit-picker { min-width:0; }
.studio-wardrobe { position:fixed; z-index:11000; box-sizing:border-box; padding:6px; border:2px solid var(--studio-ink); border-radius:2px; background:url('../../assets/studio-photocopy.svg'),var(--studio-paper); color:var(--studio-ink); box-shadow:4px 5px 0 var(--studio-shadow); max-height:min(340px,calc(100dvh - 16px)); overflow:auto; }
.wardrobe-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:5px 7px 9px; border-bottom:1px dashed var(--studio-line); font-size:var(--fs-sm); line-height:1.5; }
.wardrobe-heading strong { font-weight:900; }.wardrobe-heading>span { color:var(--studio-muted); font-size:var(--fs-xs); font-variant-numeric:tabular-nums; }
.wardrobe-status { display:grid; gap:8px; justify-items:start; padding:14px 7px; font-size:var(--fs-sm); line-height:1.6; color:var(--studio-muted); }
.wardrobe-option { min-height:44px; box-sizing:border-box; display:flex; align-items:center; gap:9px; padding:8px 7px; margin-top:3px; cursor:pointer; text-align:left; color:var(--studio-ink); border-left:3px solid transparent; transition:background .3s,border-color .3s,color .3s; }
.wardrobe-option.highlighted { background:color-mix(in srgb,var(--studio-accent) 12%,transparent); border-left-color:var(--studio-tag); }
.wardrobe-option.selected { color:var(--studio-film); background:var(--studio-shutter); border-left-color:var(--studio-film); }
.wardrobe-number { align-self:flex-start; padding-top:2px; font:italic 800 var(--fs-xs)/1.5 monospace; opacity:.75; }
.wardrobe-label { min-width:0; flex:1; font-size:var(--fs-sm); line-height:1.5; font-weight:800; }
.wardrobe-label small { display:block; font-size:var(--fs-xs); font-weight:400; line-height:1.5; overflow-wrap:anywhere; }
.wardrobe-check { font-weight:900; }
.studio-wardrobe-enter-active,.studio-wardrobe-leave-active { transition:opacity .3s,transform .3s; }
.studio-wardrobe-enter-from,.studio-wardrobe-leave-to { opacity:0; transform:translateY(6px); }
@media(prefers-reduced-motion:reduce) { .studio-wardrobe,.wardrobe-option { transition:none; } }
</style>
