<template>
  <svg viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path :d="paths[name] || paths.star" /></svg>
</template>
<script setup>
defineProps({ name: { type: String, default: 'star' } })
const paths = {
  controller: 'M5 5h14v2h3v3h2v10h-2v2h-5v-2h-2v-3H9v3H7v2H2v-2H0V10h2V7h3Zm0 5v3H2v2h3v3h2v-3h3v-2H7v-3Zm12 0v3h3v-3Zm3 4v3h3v-3Z',
  cartridge: 'M4 1h14v2h3v20H3V1Zm2 3v9h12V4Zm2 2h8v5H8Zm-2 9v6h12v-6Zm3 1h2v4H9Zm4 0h2v4h-2Z',
  globe: 'M8 1h8v2h4v4h3v10h-3v4h-4v2H8v-2H4v-4H1V7h3V3h4Zm0 4H6v3H3v5h4v3h3v5h4v-3h3v-4h4V9h-5V6h-5V3H8Z',
  arrow: 'M3 10h11V5h3v3h3v3h3v2h-3v3h-3v3h-3v-5H3Z',
  back: 'M10 4h3v4h-3v3h12v3H10v3h3v4h-3v-3H7v-3H4v-5h3V7h3Z',
  settings: 'M9 1h6v4h4v4h4v6h-4v4h-4v4H9v-4H5v-4H1V9h4V5h4Zm0 7v2H7v4h2v2h6v-2h2v-4h-2V8Z',
  plus: 'M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7Z',
  star: 'M10 1h4v6h3v3h6v4h-6v3h-3v6h-4v-6H7v-3H1v-4h6V7h3Z',
  heart: 'M3 3h6v3h6V3h6v3h3v9h-3v3h-3v3h-3v3H9v-3H6v-3H3v-3H0V6h3Z',
  coin: 'M7 1h10v3h4v3h2v10h-2v3h-4v3H7v-3H3v-3H1V7h2V4h4Zm2 4v14h6V5Zm2 2h2v10h-2Z',
  ghost: 'M7 1h10v3h4v4h2v15h-4v-4h-4v4H9v-4H5v4H1V8h2V4h4Zm-1 7v5h4V8Zm8 0v5h4V8Z',
}
</script>
<style scoped>
svg { width:1.25em;height:1.25em;display:inline-block;flex-shrink:0;vertical-align:middle; }
</style>
