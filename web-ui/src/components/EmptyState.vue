<template>
  <div class="empty" :class="{ compact }">
    <div class="empty-icon" :class="{ 'icon-tile': tileMode }">{{ icon }}</div>
    <div v-if="title" class="empty-title">{{ title }}</div>
    <div v-if="hint" class="empty-hint">{{ hint }}</div>
    <slot />
  </div>
</template>

<script setup>
defineProps({
  icon: { type: String, default: '🫧' },
  title: { type: String, default: '' },
  hint: { type: String, default: '' },
  compact: { type: Boolean, default: false },
  /** true 时图标使用彩色圆角底座（icon-tile）而非大 emoji */
  tileMode: { type: Boolean, default: false },
})
</script>

<style scoped>
.empty.compact { padding: 22px 12px; gap: 5px; }
.empty.compact .empty-icon { font-size: 30px; }
</style>
