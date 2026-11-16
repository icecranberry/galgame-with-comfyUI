<template>
  <aside class="studio-filter-layers" aria-label="滤镜图层">
    <div class="layer-heading"><strong>滤镜图层</strong><span>{{ layers.length }}</span></div>
    <div ref="list" class="layer-list" role="group" aria-label="选择滤镜图层">
      <div v-for="(layer, index) in layers" :key="index" class="layer-row">
        <studio-button class="layer-select" variant="chip" size="compact" :active="selected === index" :aria-pressed="selected === index" :disabled="disabled" @click="$emit('select', index)"><span class="layer-label">{{ index + 1 }} · {{ label(layer.filter) }}</span></studio-button>
        <studio-button variant="icon-plain" :disabled="disabled" :aria-label="`删除第 ${index + 1} 层 ${label(layer.filter)}`" @click="$emit('remove', index)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg></studio-button>
      </div>
    </div>
    <div v-if="current" class="layer-adjustment">
      <div class="layer-setting"><label for="studio-layer-intensity">第 {{ selected + 1 }} 层强度</label><strong>{{ current.intensity }}%</strong></div>
      <studio-range id="studio-layer-intensity" :model-value="current.intensity" :disabled="disabled" @update:model-value="$emit('update', { intensity: $event })" />
      <studio-button v-if="['silver', 'glitch'].includes(current.filter)" variant="chip" size="compact" :active="current.grain" :aria-pressed="current.grain" :disabled="disabled" @click="$emit('update', { grain: !current.grain })">颗粒 {{ current.grain ? 'ON' : 'OFF' }}</studio-button>
    </div>
  </aside>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import StudioButton from './StudioButton.vue'
import StudioRange from './StudioRange.vue'
import { STUDIO_FILTERS } from '../../utils/photoStudioFinish.js'

const props = defineProps({ layers: { type: Array, required: true }, selected: { type: Number, required: true }, disabled: Boolean })
defineEmits(['select', 'remove', 'update'])
const current = computed(() => props.layers[props.selected])
const label = filter => STUDIO_FILTERS.find(option => option.value === filter)?.label || filter
const list = ref(null)
watch(() => [props.selected, props.layers.length], async () => {
  await nextTick()
  const rail = list.value, row = rail?.children[props.selected]
  if (!row) return
  const viewport = rail.getBoundingClientRect(), box = row.getBoundingClientRect()
  if (box.top < viewport.top) rail.scrollTop += box.top - viewport.top
  else if (box.bottom > viewport.bottom) rail.scrollTop += box.bottom - viewport.bottom
}, { immediate: true })
</script>

<style scoped>
.studio-filter-layers { position:absolute; z-index:2; top:10px; right:10px; width:220px; max-width:calc(100% - 20px); max-height:calc(100% - 20px); box-sizing:border-box; display:flex; flex-direction:column; gap:6px; padding:8px; border:2px solid var(--studio-ink); border-radius:2px; background:url('../../assets/studio-photocopy.svg'),var(--studio-paper); color:var(--studio-ink); box-shadow:4px 5px 0 var(--studio-shadow); overflow:auto; scrollbar-width:thin; scrollbar-color:var(--studio-line) transparent; }
.layer-heading,.layer-setting { display:flex; align-items:center; justify-content:space-between; gap:6px; font-size:var(--fs-xs); line-height:1.5; }
.layer-heading { flex:none; border-bottom:1px dashed var(--studio-line); padding-bottom:4px; }
.layer-heading span { color:var(--studio-muted); font-variant-numeric:tabular-nums; }
.layer-list { flex:1 1 auto; min-height:44px; overflow:auto; scrollbar-width:thin; scrollbar-color:var(--studio-line) transparent; }
.layer-row { display:flex; align-items:center; gap:4px; }
.layer-select { flex:1; min-width:0; }
.layer-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.layer-row svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
.layer-adjustment { flex:none; border-top:1px dashed var(--studio-line); padding-top:4px; }
@media(max-width:760px) { .studio-filter-layers { width:190px; top:6px; right:6px; padding:6px; gap:4px; max-height:calc(100% - 12px); } }
</style>
