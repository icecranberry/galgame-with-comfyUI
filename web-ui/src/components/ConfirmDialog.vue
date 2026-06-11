<template>
  <Transition name="confirm">
    <div v-if="visible" class="confirm-overlay" @click.self="onCancel">
      <div class="confirm-card" ref="cardEl">
        <div class="confirm-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.8" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="13"/>
            <circle cx="12" cy="16.5" r="1" fill="var(--danger)" stroke="none"/>
          </svg>
        </div>
        <div class="confirm-body">
          <div class="confirm-title">{{ title }}</div>
          <div class="confirm-message">{{ message }}</div>
        </div>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-btn-cancel" @click="onCancel">{{ cancelText }}</button>
          <button class="confirm-btn confirm-btn-ok" :class="{ danger }" @click="onOk">{{ okText }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, nextTick } from 'vue'

const visible = ref(false)
const title = ref('')
const message = ref('')
const okText = ref('确定')
const cancelText = ref('取消')
const danger = ref(false)
const cardEl = ref(null)

let resolvePromise = null

function show(opts) {
  title.value = opts.title || '确认操作'
  message.value = opts.message || '确定要执行此操作吗？'
  okText.value = opts.okText || '确定'
  cancelText.value = opts.cancelText || '取消'
  danger.value = opts.danger !== false
  visible.value = true
  // 下一帧 animate card scale
  nextTick(() => {
    if (cardEl.value) cardEl.value.classList.add('in')
  })
  return new Promise((resolve) => {
    resolvePromise = resolve
  })
}

function onOk() {
  visible.value = false
  resolvePromise?.(true)
}

function onCancel() {
  visible.value = false
  resolvePromise?.(false)
}

defineExpose({ show })
</script>

<style scoped>
.confirm-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}

.confirm-card {
  width: 360px; max-width: 90vw;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  display: flex; flex-direction: column; align-items: center;
  padding: 28px 24px 20px;
  gap: 14px;
  transform: scale(0.92);
  opacity: 0;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.confirm-card.in {
  transform: scale(1);
  opacity: 1;
}

.confirm-icon {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
}
.confirm-icon svg { width: 100%; height: 100%; }
.confirm-body { text-align: center; }
.confirm-title {
  font-size: 16px; font-weight: 600; color: var(--text-bright);
  margin-bottom: 6px;
}
.confirm-message {
  font-size: 13px; color: var(--text-secondary);
  line-height: 1.6; white-space: pre-line;
}
.confirm-actions {
  display: flex; gap: 12px; margin-top: 4px; width: 100%;
}
.confirm-btn {
  flex: 1; padding: 10px 0; border-radius: 10px;
  font-size: 14px; font-weight: 500; cursor: pointer;
  transition: all 0.2s ease;
}
.confirm-btn-cancel {
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.08);
  color: var(--text-secondary);
}
.confirm-btn-cancel:hover {
  background: rgba(0, 0, 0, 0.07);
  color: var(--text-bright);
}
.confirm-btn-ok {
  background: var(--accent);
  border: none; color: #fff;
  box-shadow: 0 2px 8px rgba(224, 123, 108, 0.18);
}
.confirm-btn-ok:hover {
  background: var(--accent-hover);
  box-shadow: 0 4px 14px rgba(224, 123, 108, 0.25);
  transform: translateY(-1px);
}
.confirm-btn-ok:active { transform: scale(0.97); }
.confirm-btn-ok.danger {
  background: var(--danger);
  box-shadow: 0 2px 8px rgba(255, 77, 79, 0.18);
}
.confirm-btn-ok.danger:hover {
  background: #e04848;
  box-shadow: 0 4px 14px rgba(255, 77, 79, 0.25);
}

/* Transition 仅控制 overlay 淡入淡出 */
.confirm-enter-active { transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.confirm-leave-active { transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.confirm-enter-from,
.confirm-leave-to { opacity: 0; }
</style>
