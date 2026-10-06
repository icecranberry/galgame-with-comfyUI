<template>
  <svg viewBox="0 0 1024 1024" :width="size" :height="size" fill="currentColor" aria-hidden="true">
    <path d="M160 96c17.7 0 32 14.3 32 32v640h672c17.7 0 32 14.3 32 32s-14.3 32-32 32H160c-17.7 0-32-14.3-32-32V128c0-17.7 14.3-32 32-32z"/>
    <path d="M704 176c0-17.7 14.3-32 32-32h160c17.7 0 32 14.3 32 32v160c0 17.7-14.3 32-32 32s-32-14.3-32-32V224h-128c-17.7 0-32-14.3-32-32z"/>
    <path d="M836.6 163.1a32 32 0 0 1 5.6 44.8l-256 326.4a32 32 0 0 1-45.3 5.1L407.9 439.4l-171.5 200.1a32 32 0 1 1-48.8-41.4l192-224a32 32 0 0 1 45.9-2l134.3 101.4 234.2-298.6a32 32 0 0 1 44.6-5.8z"/>
  </svg>
</template>

<script setup>
// 日程台账入口图标（折线图语义），跟随 currentColor 变色
defineProps({
  size: { type: [Number, String], default: 18 },
})
</script>