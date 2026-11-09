<template>
  <input
    class="ls-slider" :class="{ 'ls-slider--fine': variant === 'fine' || variant === 'film', 'ls-slider--film': variant === 'film' }" :style="variant === 'fine' || variant === 'film' ? { '--slider-fill': `${Math.max(0, Math.min(100, (modelValue - min) / (max - min || 1) * 100))}%` } : undefined" type="range" :value="modelValue"
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
  variant: { type: String, default: 'default' },
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
.ls-slider--fine {
  display: block; height: 28px; margin: 0; padding: 0; border: 0;
  background: transparent; border-radius: 0;
}
.ls-slider--fine::-webkit-slider-runnable-track {
  height: 4px; border-radius: var(--radius-full);
  background: linear-gradient(to right, var(--accent) var(--slider-fill), var(--border-strong) var(--slider-fill));
}
.ls-slider--fine::-moz-range-track {
  height: 4px; border-radius: var(--radius-full);
  background: linear-gradient(to right, var(--accent) var(--slider-fill), var(--border-strong) var(--slider-fill));
}
.ls-slider--fine::-webkit-slider-thumb {
  width: 14px; height: 20px; margin-top: -8px; border-radius: 5px;
  background: var(--bg-secondary); border: 2px solid var(--accent); box-shadow: var(--shadow-xs);
}
.ls-slider--fine::-moz-range-thumb {
  width: 10px; height: 16px; border-radius: 5px;
  background: var(--bg-secondary); border: 2px solid var(--accent); box-shadow: var(--shadow-xs);
}
.ls-slider--film { --accent:var(--studio-accent); --border-strong:var(--studio-line); --bg-secondary:var(--studio-paper); }
</style>
