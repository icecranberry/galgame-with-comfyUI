<template>
  <div class="reply-flow" :class="{ 'is-sizing': height !== null }" :style="height === null ? undefined : { height: `${height}px` }">
    <div ref="content" class="reply-flow-content"><slot /></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'

const props = defineProps({ active: Boolean })
const content = ref(null)
const height = ref(null)
let observer
let release

function measure() {
  if (content.value && (props.active || height.value !== null)) height.value = content.value.getBoundingClientRect().height
}
watch(() => props.active, active => {
  clearTimeout(release)
  measure()
  // 最后一段文字也走完过渡，再恢复自然高度；历史内容不逐次播放动画。
  if (!active) release = setTimeout(() => { height.value = null }, 300)
}, { flush: 'post' })
onMounted(() => {
  measure()
  observer = new ResizeObserver(measure)
  observer.observe(content.value)
})
onBeforeUnmount(() => { observer?.disconnect(); clearTimeout(release) })
</script>

<style scoped>
.reply-flow { transition:height .3s var(--ease-standard); }
.reply-flow.is-sizing { overflow:clip; }
.reply-flow-content { display:flow-root; }
@media (prefers-reduced-motion:reduce) { .reply-flow { transition:none; } }
</style>
