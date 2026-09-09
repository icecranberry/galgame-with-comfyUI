<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="isOpen" class="modal-overlay" @click.self="close">
        <div class="modal-panel linshe-modal" :class="[{ 'modal-wide': wide, 'modal-full': full }, panelClass]" @click.stop>
          <div class="modal-header">
            <h3 class="modal-title">{{ title }}</h3>
            <span v-if="$slots['header-extra']" class="modal-header-extra"><slot name="header-extra" /></span>
            <linshe-button variant="icon" aria-label="关闭" @click="close">✕</linshe-button>
          </div>
          <!-- 白色内衬：浮于暖纸外壳之上，标题栏留在外壳上（与 LoRA 设置窗一致） -->
          <div class="linshe-modal-lining">
            <div class="modal-body" :class="bodyClass">
              <slot />
            </div>
          </div>
          <div v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
// 统一弹窗基座（Linshe 基础窗体组件）：Teleport + 遮罩 + 面板 + 头部/关闭键，
// 视觉走全局 modal 家族类 + 本组件的白色内衬（--modal-lining-*）。
// 暖色沿用 v3.2 人物详情卡口径（暖纸外壳 + 白色内衬），暗夜保持 Cel Glow 深色玻璃。
// 内容用 #default 插槽；需要自定义底部操作区时用 #footer；头部右侧附加内容用 #header-extra。
import { computed, watch } from 'vue'

import LinsheButton from './LinsheButton.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 旧用法仍可传 visible；新用法优先 v-model */
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  wide: { type: Boolean, default: false },   // 面板加宽（.modal-wide）
  full: { type: Boolean, default: false },   // 大型管理面板（.modal-full）
  panelClass: { type: [String, Array, Object], default: '' },
  bodyClass: { type: [String, Array, Object], default: '' },
})

const emit = defineEmits(['update:modelValue', 'close'])
const isOpen = computed(() => props.modelValue || props.visible)

function close() {
  emit('update:modelValue', false)
  emit('close')
}

// Esc 关闭
function onKeydown(e) {
  if (e.key === 'Escape' && isOpen.value) close()
}
watch(isOpen, (v) => {
  if (v) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
}, { immediate: true })
</script>

<style scoped>
.modal-header-extra {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  margin-right: 10px;
}

.linshe-modal-lining {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  margin: var(--modal-lining-margin);
  background: var(--modal-lining-bg);
  border: var(--modal-lining-border);
  border-radius: var(--modal-lining-radius);
}

/* 留白交给 body（对齐 LoRA 设置窗的 .lora-body-card 内边距），页面 body-class 可安全覆盖 */
.linshe-modal .modal-body {
  padding: var(--modal-lining-pad);
  /* 滚动条走主题色淡化，替代 base.css 的固定灰紫 */
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--accent-rgb), 0.28) transparent;
}
.linshe-modal .modal-body::-webkit-scrollbar { width: 6px; height: 6px; }
.linshe-modal .modal-body::-webkit-scrollbar-track { background: transparent; }
.linshe-modal .modal-body::-webkit-scrollbar-thumb {
  background: rgba(var(--accent-rgb), 0.28);
  border-radius: 999px;
}
.linshe-modal .modal-body::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--accent-rgb), 0.45);
}

/* 移动端全屏面板：内衬贴边、去圆角与描边（面板本身已满屏） */
@media (max-width: 767px) {
  .linshe-modal-lining {
    margin: 0 16px calc(16px + env(safe-area-inset-bottom, 0px));
  }
  .linshe-modal.modal-full .linshe-modal-lining {
    margin: 0;
    border-radius: 0;
    border: none;
  }
}
</style>
