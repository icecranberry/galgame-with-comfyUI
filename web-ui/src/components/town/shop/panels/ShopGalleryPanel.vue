<template>
  <!-- 相框墙（gallery_display）：只读展示已有真实产物，不建操作行（计划 §7.3） -->
  <p v-if="!loaded" class="bf-empty" role="status">正在取来展出的作品…</p>
  <div v-else-if="items.length" class="bf-gallery">
    <figure v-for="item in items" :key="item.operationId || item.itemId" class="bf-gallery-item">
      <img :src="item.imageUrl" loading="lazy" alt="" />
      <figcaption v-if="item.caption">{{ item.caption }}</figcaption>
    </figure>
  </div>
  <p v-else class="bf-empty">{{ emptyText }}</p>
</template>

<script setup>
defineProps({
  items: { type: Array, default: () => [] },
  loaded: { type: Boolean, default: false },
  emptyText: { type: String, default: '还没有可以展示的作品。' },
})
</script>

<style scoped>
.bf-empty { font-size: 13px; opacity: 0.7; text-align: center; }
.bf-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.bf-gallery-item { margin: 0; display: flex; flex-direction: column; gap: 4px; }
.bf-gallery-item img { width: 100%; border-radius: 8px; border: 2px solid var(--town-paper-line, var(--border)); display: block; }
.bf-gallery-item figcaption { font-size: 11px; line-height: 1.5; opacity: 0.75; overflow-wrap: anywhere; }
</style>
