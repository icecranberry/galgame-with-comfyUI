<template>
  <TransitionGroup name="god-image" tag="div" class="god-message-images">
    <figure v-for="image in images" :key="image.url" class="god-message-image">
      <div v-if="!failed[image.url]" class="image-hit" role="button" tabindex="0" aria-label="放大查看天使发来的图片" @click="open(image)" @keydown.enter.prevent="open(image)" @keydown.space.prevent="open(image)">
        <img :src="image.url" :width="image.width" :height="image.height" alt="天使发来的图片" loading="lazy" @load="$emit('loaded')" @error="failed[image.url] = true" />
      </div>
      <p v-else class="image-error" role="alert">图片暂时无法加载。<linshe-button variant="link" tone="muted" size="sm" @click="failed[image.url] = false">重新加载</linshe-button></p>
      <figcaption v-if="image.width && image.height">{{ image.width }} × {{ image.height }} · 点击放大</figcaption>
    </figure>
  </TransitionGroup>
  <Teleport to="body">
    <div style="--vel-z-index: 11000">
      <ImageLightbox :visible="visible" :imgs="images.map(image => image.url)" :index="index" :show-regenerate="false" :show-upscale="false" :show-delete="false" @hide="visible = false" />
    </div>
  </Teleport>
</template>

<script setup>
import { ref } from 'vue'
import ImageLightbox from '../ImageLightbox.vue'
import LinsheButton from '../ui/LinsheButton.vue'

const props = defineProps({ images: { type: Array, default: () => [] } })
defineEmits(['loaded'])
const visible = ref(false)
const index = ref(0)
const failed = ref({})
function open(image) { index.value = props.images.findIndex(item => item.url === image.url); visible.value = true }
</script>

<style scoped>
.god-message-images { display:flex; flex-wrap:wrap; gap:16px; }
.god-message-images:empty { display:none; }
.god-message-image { margin:18px 0 0; max-width:100%; min-width:0; }
.image-hit { cursor:zoom-in; text-align:left; max-width:100%; border-radius:var(--radius-lg); overflow:hidden; background:var(--bg-sunken); }
.image-hit:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.image-hit img { display:block; width:auto; height:auto; max-width:100%; max-height:480px; object-fit:contain; }
figcaption,.image-error { font-size:var(--fs-xs); line-height:1.7; color:var(--text-secondary); margin:8px 0 0; }
.image-error { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.god-image-enter-active,.god-image-leave-active { transition:opacity .3s var(--ease-standard),transform .3s var(--ease-standard); }
.god-image-enter-from,.god-image-leave-to { opacity:0; transform:translateY(6px); }
</style>
