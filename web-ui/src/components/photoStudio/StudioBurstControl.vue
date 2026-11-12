<template>
  <div ref="root" class="studio-burst-control" @keydown.esc.stop="close(true)">
    <Transition name="burst-picker">
      <section v-if="open" id="studio-burst-picker" class="burst-picker" aria-label="连拍数量" @keydown.tab="containFocus">
        <div class="burst-heading"><label for="studio-burst-count">连拍</label><strong>{{ modelValue }} 张</strong></div>
        <linshe-slider id="studio-burst-count" ref="slider" variant="film" :model-value="modelValue" :min="1" :max="10" :step="1" :disabled="disabled" aria-label="一次拍摄张数" @update:model-value="$emit('update:modelValue', $event)" />
        <div class="burst-scale" aria-hidden="true"><span>1</span><span>10</span></div>
      </section>
    </Transition>
    <studio-button ref="trigger" variant="shutter-toggle" :disabled="disabled" :aria-expanded="open" aria-controls="studio-burst-picker" :aria-label="`连拍数量，当前 ${modelValue} 张`" :title="`连拍 ${modelValue} 张`" @click="toggle">
      <svg class="burst-arrow" :class="{ 'is-open': open }" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 11 5-7 5 7Z" fill="currentColor" /></svg>
    </studio-button>
  </div>
</template>

<script setup>
import { ref, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import StudioButton from './StudioButton.vue'
import LinsheSlider from '../ui/LinsheSlider.vue'

const props = defineProps({ modelValue: { type: Number, default: 1 }, disabled: Boolean })
defineEmits(['update:modelValue'])
const root = ref(null), trigger = ref(null), slider = ref(null), open = ref(false)
function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.$el?.focus()
}
async function toggle() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    slider.value?.$el?.focus()
  }
}
function containFocus(event) {
  // The slider is the only field; Tab returns to the shutter arrow and closes.
  event.preventDefault()
  close(true)
}
function outside(event) { if (!root.value?.contains(event.target)) close() }
watch(() => props.disabled, value => { if (value) close() })
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<style scoped>
.studio-burst-control { position:relative; display:flex; }
.burst-arrow { width:16px; height:16px; transition:transform .3s; }
.burst-arrow.is-open { transform:rotate(180deg); }
.burst-picker { position:absolute; z-index:5; right:0; bottom:calc(100% + 12px); width:220px; padding:14px 16px 10px; border:1px solid var(--studio-ink); border-bottom:3px solid var(--studio-ink); color:var(--studio-ink); background:url('../../assets/studio-photocopy.svg'),var(--studio-paper); box-shadow:4px 4px 0 var(--studio-shadow); }
.burst-heading { display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-bottom:6px; font-size:var(--fs-sm); font-weight:800; }
.burst-heading strong { color:var(--studio-tag); font-variant-numeric:tabular-nums; }
.burst-scale { display:flex; justify-content:space-between; color:var(--studio-muted); font:11px/1.5 monospace; }
.burst-picker-enter-active,.burst-picker-leave-active { transition:opacity .3s,transform .3s; }
.burst-picker-enter-from,.burst-picker-leave-to { opacity:0; transform:translateY(8px); }
.burst-picker-leave-active { pointer-events:none; }
@media(prefers-reduced-motion:reduce) { .burst-arrow,.burst-picker-enter-active,.burst-picker-leave-active { transition:none; } }
</style>
