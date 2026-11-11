<template>
  <Transition name="studio-filter" mode="out-in">
    <div :key="optionsKey" class="studio-filter-options" role="group" :aria-label="label">
      <studio-button
        v-for="option in options"
        :key="option.value"
        variant="chip"
        :size="size"
        :active="modelValue === option.value"
        :aria-pressed="modelValue === option.value"
        @click="$emit('update:modelValue', option.value)"
      >
        {{ option.label }}
      </studio-button>
    </div>
  </Transition>
</template>

<script setup>
import { computed } from 'vue'
import StudioButton from './StudioButton.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  label: { type: String, required: true },
  size: { type: String, default: 'compact' },
})
defineEmits(['update:modelValue'])
const optionsKey = computed(() => JSON.stringify(props.options.map(option => option.value)))
</script>

<style scoped>
.studio-filter-options{display:flex;flex-wrap:wrap;align-items:flex-start;gap:6px;min-width:0}
.studio-filter-enter-active,.studio-filter-leave-active{transition:opacity .3s,transform .3s}
.studio-filter-enter-from,.studio-filter-leave-to{opacity:0;transform:translateY(4px)}
@media(prefers-reduced-motion:reduce){.studio-filter-enter-active,.studio-filter-leave-active{transition:none}.studio-filter-enter-from,.studio-filter-leave-to{transform:none}}
</style>
