<template>
  <svg viewBox="0 0 24 24" :width="size" :height="size" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <path d="M7 9h6m-3-3v6m6 3h1m-9 3h1" />
  </svg>
</template>

<script setup>
defineProps({ size: { type: Number, default: 24 } })
</script>
