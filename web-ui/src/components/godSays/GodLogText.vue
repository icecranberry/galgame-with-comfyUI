<template>
  <div
    class="log-text-preview"
    role="button"
    tabindex="0"
    :aria-expanded="expanded"
    :aria-label="expanded ? '收起到四行' : '展开全文'"
    @click.stop="emit('toggle')"
    @keydown.enter.stop.prevent="emit('toggle')"
    @keydown.space.stop.prevent="emit('toggle')"
  >
    <div class="log-text-viewport" :style="{ maxHeight }"><pre ref="contentRef" class="log-text-content">{{ renderedText }}</pre></div>
    <span class="log-text-chevron" :class="{ 'is-expanded': expanded }" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </span>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { logTextPreview } from '../../utils/logVirtualWindow.js'

const props = defineProps({ text: { type: String, default: '' }, expanded: Boolean })
const emit = defineEmits(['toggle'])

const contentRef = ref(null)
const renderFull = ref(props.expanded)
const renderedText = computed(() => renderFull.value ? props.text : logTextPreview(props.text))
const maxHeight = ref('6.8em')
let observer
let collapseTimer
let version = 0

async function syncExpanded() {
  const current = ++version
  clearTimeout(collapseTimer)
  observer?.disconnect()
  if (!props.expanded) {
    maxHeight.value = '6.8em'
    // 收起动画结束再移除全文，避免先截文字导致高度突变。
    collapseTimer = setTimeout(() => { renderFull.value = false }, 300)
    return
  }
  renderFull.value = true
  await nextTick()
  if (current !== version || !contentRef.value) return
  const measure = () => { maxHeight.value = `${Math.ceil(contentRef.value.getBoundingClientRect().height)}px` }
  measure()
  // 仅展开的块需要测量全文；四行预览不创建 Observer、不测量隐藏全文。
  observer ??= new ResizeObserver(measure)
  observer.observe(contentRef.value)
}

onMounted(() => {
  if (props.expanded) syncExpanded()
})
watch(() => props.expanded, syncExpanded)
onBeforeUnmount(() => {
  version++
  clearTimeout(collapseTimer)
  observer?.disconnect()
})
</script>

<style scoped>
.log-text-preview {
  /* 1.7 行高 × 4 行；按视觉换行预览，短内容保持自然高度。 */
  line-height: 1.7;
  cursor: pointer;
  text-align: left;
}
.log-text-viewport {
  overflow: hidden;
  transition: max-height 0.3s var(--ease-out, ease);
}
.log-text-content {
  margin: 0;
  font: inherit;
  color: inherit;
  white-space: inherit;
}
.log-text-chevron {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 16px;
  margin-top: 4px;
  color: var(--text-secondary);
  transition: transform 0.3s var(--ease-out, ease);
}
.log-text-chevron svg { width: 12px; height: 12px; }
.log-text-chevron.is-expanded { transform: rotate(180deg); }
</style>
