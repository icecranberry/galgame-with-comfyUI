<template>
  <input
    class="ls-slider" type="range" :value="modelValue"
    :min="min" :max="max" :step="step" :disabled="disabled"
    @input="$emit('update:modelValue', Number($event.target.value))"
    @change="$emit('change', Number($event.target.value))"
  />
</template>

<script setup>
defineProps({
  modelValue: { type: Number, required: true },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  disabled: Boolean,
})
defineEmits(['update:modelValue', 'change'])
</script>

<style scoped>
.ls-slider {
  width: 100%; height: 6px; margin: 4px 0 2px;
  padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-full);
  appearance: none; cursor: pointer;
  background: linear-gradient(90deg, var(--slider-track-start), var(--accent));
}
.ls-slider::-webkit-slider-thumb {
  appearance: none; width: 18px; height: 18px; border-radius: 50%;
  background: var(--bg-secondary); border: 2px solid var(--accent);
  box-shadow: var(--slider-thumb-shadow);
}
.ls-slider::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--bg-secondary); border: 2px solid var(--accent);
  box-shadow: var(--slider-thumb-shadow);
}
.ls-slider:focus-visible { outline: 2px solid var(--accent); outline-offset: 5px; }
.ls-slider:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
