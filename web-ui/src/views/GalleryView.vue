<template>
  <div class="gallery-view">
    <!-- 顶栏 -->
    <div class="gallery-header">
      <span
        class="gallery-title"
        :class="{ 'is-clickable': isMobile }"
        @click="isMobile && toggleMobileSidebar()"
      >相册</span>
      <span class="gallery-count" v-if="totalCount > 0">共 {{ totalCount }} 张</span>
    </div>

    <!-- 内容区 -->
    <Gallery ref="galleryRef" @loaded="onLoaded" />
  </div>
</template>

<script setup>
import { ref, inject } from 'vue'
import Gallery from '../components/Gallery.vue'

const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')
const galleryRef = ref(null)
const totalCount = ref(0)

function onLoaded(count) {
  totalCount.value = count
}
</script>

<style scoped>
.gallery-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

.gallery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.25);
  flex-shrink: 0;
}

.gallery-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-bright);
  user-select: none;
}
.gallery-title.is-clickable { cursor: pointer; }

.gallery-count {
  font-size: 13px;
  color: var(--text-secondary);
}

@media (max-width: 767px) {
  .gallery-header {
    padding: 12px 16px;
  }
  .gallery-title {
    font-size: 16px;
  }
}
</style>
