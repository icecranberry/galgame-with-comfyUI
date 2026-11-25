<template>
  <span>已获取智慧宫资料，感谢<a :href="homepage" target="_blank" rel="noopener noreferrer">{{ homepage }}</a>的大力支持</span>
</template>

<script setup>
const homepage = 'https://agent.zlb.ink/'
</script>

<style scoped>
a { color: var(--accent); text-decoration: underline; overflow-wrap: anywhere; }
</style>
