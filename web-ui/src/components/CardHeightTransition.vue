<template>
  <div ref="el" class="card-height-transition">
    <slot />
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'

const props = defineProps({
  editing: { type: Boolean, default: false },
})

const el = ref(null)
let finishTimer = null

watch(() => props.editing, async () => {
  const node = el.value
  if (!node) return
  clearTimeout(finishTimer)

  const from = node.offsetHeight
  node.style.height = `${from}px`
  node.style.maxHeight = 'none'
  node.style.overflow = 'hidden'
  node.style.transition = 'none'

  await nextTick()

  node.style.height = 'auto'
  const to = node.offsetHeight
  node.style.height = `${from}px`
  void node.offsetHeight
  node.style.transition = 'height 0.2s linear, max-height 0.2s linear'
  node.style.height = `${to}px`
  node.style.maxHeight = 'none'

  finishTimer = setTimeout(() => {
    node.style.height = ''
    node.style.maxHeight = ''
    node.style.overflow = ''
    node.style.transition = ''
  }, 350)
})

onBeforeUnmount(() => {
  clearTimeout(finishTimer)
})
</script>

<style scoped>
.card-height-transition {
  min-width: 0;
}
</style>
