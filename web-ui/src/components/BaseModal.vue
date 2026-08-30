<script setup>
// 统一弹窗基座：Teleport + 遮罩 + 面板 + 头部/关闭键，视觉走全局 modal 家族类。
// 新弹窗一律使用本组件（设计系统 docs/design-system.md「弹窗」约定）。
// 内容用 #default 插槽；需要自定义底部操作区时用 #footer。
import { watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  wide: { type: Boolean, default: false },   // 面板加宽（.modal-wide）
})

const emit = defineEmits(['close'])

function onOverlayClick() {
  emit('close')
}

// Esc 关闭
function onKeydown(e) {
  if (e.key === 'Escape' && props.visible) emit('close')
}
watch(() => props.visible, (v) => {
  if (v) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
}, { immediate: true })
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="modal-overlay" @click.self="onOverlayClick">
        <div class="modal-panel" :class="{ 'modal-wide': wide }" @click.stop>
          <div class="modal-header">
            <h3 class="modal-title">{{ title }}</h3>
            <button class="modal-close" @click="emit('close')">✕</button>
          </div>
          <div class="modal-body">
            <slot />
          </div>
          <div v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 2px solid var(--border);
  flex-shrink: 0;
}
</style>
