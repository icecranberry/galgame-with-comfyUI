<template>
  <linshe-button variant="icon" :tone="tone" :size="size" touch-target :aria-label="label" :title="label">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" />
    </svg>
  </linshe-button>
</template>

<script setup>
import LinsheButton from './LinsheButton.vue'

defineProps({
  label: { type: String, default: '关闭' },
  size: { type: String, default: 'lg' },
  // 专用纸面窗口可显式选择已有 tone；皮肤仍归 LinsheButton 维护。
  tone: { type: String, default: 'candy' },
})
</script>
