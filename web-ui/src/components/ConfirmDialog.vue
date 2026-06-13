<template>
  <Transition name="confirm">
    <div v-if="visible" class="confirm-overlay" @click.self="onCancel">
      <div class="confirm-card" ref="cardEl">
        <!-- 图标区：danger 用三角警告，普通用圆点信息 -->
        <div class="confirm-icon" :class="{ 'is-danger': danger }">
          <svg v-if="danger" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 22h20L12 2z" stroke-linejoin="round"
                  :stroke="danger ? 'var(--danger)' : 'var(--accent)'"
                  stroke-width="1.6" stroke-linecap="round"/>
            <line x1="12" y1="10" x2="12" y2="15" :stroke="danger ? 'var(--danger)' : 'var(--accent)'" stroke-width="1.6" stroke-linecap="round"/>
            <circle cx="12" cy="18.5" r="1" :fill="danger ? 'var(--danger)' : 'var(--accent)'" stroke="none"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="var(--accent)" stroke-width="1.6"/>
            <line x1="12" y1="7" x2="12" y2="12" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/>
            <circle cx="12" cy="16.5" r="0.9" fill="var(--accent)" stroke="none"/>
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
/* ── 遮罩：加强纵深隔离 ── */
.confirm-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
}

/* ── 卡片：更结实、层次分明 ── */
.confirm-card {
  width: 340px; max-width: calc(100vw - 32px);
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow:
    0 16px 48px rgba(0, 0, 0, 0.10),
    0 0 0 1px rgba(0, 0, 0, 0.04);
  display: flex; flex-direction: column; align-items: center;
  padding: 32px 28px 24px;
  gap: 16px;
  transform: scale(0.95);
  opacity: 0;
  transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
              opacity 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.confirm-card.in {
  transform: scale(1);
  opacity: 1;
}

/* ── 图标：柔光底色圆衬 + 动态颜色 ── */
.confirm-icon {
  width: 48px; height: 48px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(224, 123, 108, 0.08);
  flex-shrink: 0;
}
.confirm-icon.is-danger {
  background: rgba(255, 77, 79, 0.07);
}
.confirm-icon svg {
  width: 26px; height: 26px;
}

.confirm-body {
  text-align: center;
}
.confirm-title {
  font-size: 16px; font-weight: 600; color: var(--text-bright);
  margin-bottom: 6px;
  letter-spacing: 0.01em;
}
.confirm-message {
  font-size: 13px; color: var(--text-secondary);
  line-height: 1.65; white-space: pre-line;
  max-width: 260px;
}

/* ── 操作按钮 ── */
.confirm-actions {
  display: flex; gap: 12px; margin-top: 4px; width: 100%;
}
.confirm-btn {
  flex: 1;
  min-height: 44px;  /* touch target: ≥44px */
  padding: 11px 0;
  border-radius: 12px;
  font-size: 14px; font-weight: 500; cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  -webkit-tap-highlight-color: transparent;
}

/* 次要按钮：清晰但从属 */
.confirm-btn-cancel {
  background: var(--bg-tertiary);
  border: 1px solid transparent;
  color: var(--text-secondary);
}
.confirm-btn-cancel:hover {
  background: var(--bg-hover);
  color: var(--text-bright);
}
.confirm-btn-cancel:active {
  transform: scale(0.97);
}

/* 主要按钮 */
.confirm-btn-ok {
  background: var(--accent);
  border: none; color: #fff;
  box-shadow: 0 2px 10px rgba(224, 123, 108, 0.22);
}
.confirm-btn-ok:hover {
  background: var(--accent-hover);
  box-shadow: 0 4px 16px rgba(224, 123, 108, 0.30);
  transform: translateY(-1px);
}
.confirm-btn-ok:active {
  transform: scale(0.97);
}

/* 危险操作 */
.confirm-btn-ok.danger {
  background: var(--danger);
  box-shadow: 0 2px 10px rgba(255, 77, 79, 0.20);
}
.confirm-btn-ok.danger:hover {
  background: #e04848;
  box-shadow: 0 4px 16px rgba(255, 77, 79, 0.28);
}

/* ── Transition：进入弹性，退出更快 ── */
.confirm-enter-active {
  transition: opacity 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
.confirm-leave-active {
  transition: opacity 0.18s cubic-bezier(0.4, 0, 0.2, 1);  /* exit faster than enter */
}
.confirm-enter-from,
.confirm-leave-to { opacity: 0; }

/* ── prefers-reduced-motion ── */
@media (prefers-reduced-motion: reduce) {
  .confirm-card {
    transition: opacity 0.15s ease;
    transform: none;
  }
  .confirm-card.in { transform: none; }
}
</style>
