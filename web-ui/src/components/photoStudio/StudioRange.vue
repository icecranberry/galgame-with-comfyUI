<template>
  <input class="studio-range" type="range" :value="modelValue" :min="min" :max="max" :disabled="disabled" :style="{ '--range-position': `${(modelValue - min) / (max - min || 1) * 100}%` }" @input="$emit('update:modelValue', Number($event.target.value))" />
</template>
<script setup>
defineProps({ modelValue: { type: Number, required: true }, min: { type: Number, default: 0 }, max: { type: Number, default: 100 }, disabled: Boolean })
defineEmits(['update:modelValue'])
</script>
<style scoped>
.studio-range { display:block; box-sizing:border-box; width:100%; height:36px; padding:0; margin:0; appearance:none; border:0; border-radius:0; cursor:ew-resize; background:repeating-linear-gradient(90deg,var(--studio-line) 0 1px,transparent 1px 10%) bottom 2px left/100% 6px no-repeat; }
.studio-range::-webkit-slider-runnable-track { height:5px; background:linear-gradient(to right,var(--studio-tag) var(--range-position),var(--studio-line) var(--range-position)); }
.studio-range::-moz-range-track { height:5px; background:linear-gradient(to right,var(--studio-tag) var(--range-position),var(--studio-line) var(--range-position)); }
.studio-range::-webkit-slider-thumb { appearance:none; width:16px; height:26px; margin-top:-10px; border:2px solid var(--studio-ink); border-radius:0; background:var(--studio-shutter); box-shadow:2px 2px 0 var(--studio-ink); }
.studio-range::-moz-range-thumb { width:12px; height:22px; border:2px solid var(--studio-ink); border-radius:0; background:var(--studio-shutter); box-shadow:2px 2px 0 var(--studio-ink); }
.studio-range:disabled { opacity:.5; cursor:default; }.studio-range:focus-visible { outline:2px solid var(--studio-tag); outline-offset:3px; }
</style>
