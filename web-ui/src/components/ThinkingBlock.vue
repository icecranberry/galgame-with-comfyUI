<template>
  <div class="thinking-block" :class="{ streaming: isStreaming }">
    <div
      class="thinking-header"
      role="button"
      tabindex="0"
      @click="expanded = !expanded"
      @keydown.enter.prevent="expanded = !expanded"
      @keydown.space.prevent="expanded = !expanded"
    >
      <span class="thinking-title">{{ headerTitle }}</span>
      <span v-if="!isStreaming && msg.summary" class="thinking-summary">{{ msg.summary }}</span>
      <svg
        class="thinking-chevron"
        :class="{ expanded: bodyVisible }"
        viewBox="0 0 24 24" width="12" height="12" fill="none"
        stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
    <CollapseTransition :show="bodyVisible">
      <div class="thinking-body">{{ msg.content }}</div>
    </CollapseTransition>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import CollapseTransition from './CollapseTransition.vue'

const props = defineProps({
  msg: { type: Object, required: true },  // { type:'thinking', status, content, summary, elapsedMs }
})

const expanded = ref(false)
const isStreaming = computed(() => props.msg.status === 'streaming')

// 流式进行中自动展开（R1 风格），完成后默认折叠；用户可随时点开
const bodyVisible = computed(() => isStreaming.value || expanded.value)

const headerTitle = computed(() => {
  if (isStreaming.value) return '深度思考中…'
  return `已深度思考`
})
</script>

<style scoped>
/* 与聊天气泡左缘对齐（头像 42px + 间距 8px） */
.thinking-block {
  margin: 2px 0 4px 50px;
  min-width: 0;
  max-width: 70%;
}
.thinking-header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  cursor: pointer;
  user-select: none;
  color: var(--text-secondary);
  transition: background-color .15s ease;
}
.thinking-header:hover {
  background: rgba(140, 128, 116, 0.08);
}
.thinking-icon {
  font-size: 12px;
  line-height: 1;
}
.thinking-title {
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
}
.thinking-summary {
  font-size: 12px;
  line-height: 1.4;
  opacity: 0.75;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.thinking-chevron {
  transition: transform .2s ease;
  flex-shrink: 0;
}
.thinking-chevron.expanded {
  transform: rotate(180deg);
}
/* 流式进行中：呼吸的省略点暗示正在思考 */
.thinking-block.streaming .thinking-title::after {
  content: '';
  display: inline-block;
  width: 4px;
  height: 4px;
  margin-left: 6px;
  border-radius: 50%;
  background: var(--text-secondary);
  opacity: 0.6;
  animation: thinking-pulse 1.1s ease-in-out infinite;
}
@keyframes thinking-pulse {
  0%, 100% { opacity: 0.15; transform: scale(0.8); }
  50% { opacity: 0.7; transform: scale(1); }
}
.thinking-body {
  margin-top: 2px;
  padding: 6px 12px 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
