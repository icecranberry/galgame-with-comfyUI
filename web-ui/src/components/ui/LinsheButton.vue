<template>
  <button
    class="ls-btn"
    :class="[
      `ls-btn--${variant}`,
      `ls-btn--${size}`,
      {
        'ls-btn--block': block,
        'ls-btn--active': active,
        'ls-btn--tone-danger': tone === 'danger',
        'ls-btn--jelly-enter': jellyPhase === 'enter',
        'ls-btn--jelly-leave': jellyPhase === 'leave',
        'ls-btn--loading': loading,
      },
    ]"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    @mouseenter="startJelly('enter')"
    @mouseleave="startJelly('leave')"
    @animationend="endJelly"
  >
    <span v-if="loading" class="ls-btn__spinner" aria-hidden="true"></span>
    <slot></slot>
  </button>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  /** primary 主操作 / secondary 次要 / danger 危险 / ghost 幽灵 / icon 圆形图标钮 / chip 胶囊选择 / link 链接 */
  variant: { type: String, default: 'secondary' },
  /** sm / md / lg */
  size: { type: String, default: 'md' },
  type: { type: String, default: 'button' },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  /** 宽度撑满父容器 */
  block: { type: Boolean, default: false },
  /** chip 变体的选中态 */
  active: { type: Boolean, default: false },
  /** 色调覆盖：danger 时 link/ghost 等变体转红色 */
  tone: { type: String, default: 'default' },
})

const jellyPhase = ref('')

const startJelly = (phase) => {
  jellyPhase.value = phase
}

const endJelly = (event) => {
  if (event.target === event.currentTarget) {
    jellyPhase.value = ''
  }
}
</script>

<style scoped>
/* ── 软糖立体按钮 ──
   结构：亮面填充 + 同色系深色厚底(硬投影) + 顶部高光
   按压：整体下沉、厚底压扁                          */
@property --ls-jelly-x {
  syntax: '<number>';
  inherits: false;
  initial-value: 1;
}

@property --ls-jelly-y {
  syntax: '<number>';
  inherits: false;
  initial-value: 1;
}

.ls-btn {
  --depth: 3px;
  --ls-jelly-x: 1;
  --ls-jelly-y: 1;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  margin: 0;
  cursor: pointer;
  font-family: inherit;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.2;
  white-space: nowrap;
  user-select: none;
  transform: scale(var(--ls-jelly-x), var(--ls-jelly-y));
  -webkit-tap-highlight-color: transparent;
  border-radius: 10px;
  transition:
    transform 0.1s ease,
    box-shadow 0.1s ease,
    filter 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease;
}

/* ── 尺寸 ── */
/* 移入/移出各触发一次完整果冻弹动 */
.ls-btn--jelly-enter { animation: ls-btn-jelly-enter 0.3s cubic-bezier(0.3, 1.15, 0.4, 1) both; }
.ls-btn--jelly-leave { animation: ls-btn-jelly-leave 0.3s cubic-bezier(0.3, 1.15, 0.4, 1) both; }

@keyframes ls-btn-jelly-enter {
  0% { --ls-jelly-x: 1; --ls-jelly-y: 1; }
  45% { --ls-jelly-x: 1.04; --ls-jelly-y: 0.96; }
  72% { --ls-jelly-x: 0.992; --ls-jelly-y: 1.008; }
  100% { --ls-jelly-x: 1; --ls-jelly-y: 1; }
}

@keyframes ls-btn-jelly-leave {
  0% { --ls-jelly-x: 1; --ls-jelly-y: 1; }
  45% { --ls-jelly-x: 1.04; --ls-jelly-y: 0.96; }
  72% { --ls-jelly-x: 0.992; --ls-jelly-y: 1.008; }
  100% { --ls-jelly-x: 1; --ls-jelly-y: 1; }
}
.ls-btn--sm { --depth: 2px; min-height: 26px; padding: 4px 10px; font-size: 12px; border-radius: 8px; gap: 4px; }
.ls-btn--md { --depth: 3px; min-height: 32px; padding: 7px 14px; font-size: 13px; }
.ls-btn--lg { --depth: 4px; min-height: 42px; padding: 11px 20px; font-size: 14px; border-radius: 12px; }

/* ── 主操作：珊瑚糖 ── */
.ls-btn--primary {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 var(--depth) 0 var(--accent-hover), inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.ls-btn--primary:hover:not(:disabled) { filter: brightness(1.05) saturate(1.05); }

/* ── 次要操作：白糖糖（珊瑚描边 + 浅珊瑚厚底） ── */
.ls-btn--secondary {
  background: #fff;
  color: #a85545;
  border: 1.5px solid rgba(224, 123, 108, 0.4);
  box-shadow: 0 var(--depth) 0 #f0ddd3, inset 0 1px 0 rgba(255, 255, 255, 0.9);
}
.ls-btn--secondary:hover:not(:disabled) {
  background: #fff5ef;
  border-color: rgba(224, 123, 108, 0.7);
  color: #8f4a38;
}

/* ── 危险操作：红辣椒糖 ── */
.ls-btn--danger {
  background: var(--danger);
  color: #fff;
  box-shadow: 0 var(--depth) 0 #c74949, inset 0 1px 0 rgba(255, 255, 255, 0.3);
}
.ls-btn--danger:hover:not(:disabled) { filter: brightness(1.05); }

/* ── 幽灵：暖白糖纸（无珊瑚色，弱存在感） ── */
.ls-btn--ghost {
  background: rgba(255, 255, 255, 0.72);
  color: var(--text-secondary);
  border: 1.5px solid #e3dcd2;
  box-shadow: 0 var(--depth) 0 rgba(222, 211, 198, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.9);
}
.ls-btn--ghost:hover:not(:disabled) {
  background: #fff;
  border-color: #d5cabb;
  color: var(--text-bright);
}
.ls-btn--ghost:active:not(:disabled) { transform: translateY(1px); }

/* ── 图标：小圆糖 ── */
.ls-btn--icon { padding: 0; border-radius: 50%; }
.ls-btn--icon.ls-btn--sm { width: 24px; height: 24px; min-height: 0; }
.ls-btn--icon.ls-btn--md { width: 30px; height: 30px; }
.ls-btn--icon.ls-btn--lg { width: 38px; height: 38px; }

/* ── chips：胶囊糖 ── */
.ls-btn--chip {
  background: transparent;
  color: var(--text-secondary);
  border: 1.5px solid var(--border);
  border-radius: 999px;
  box-shadow: none;
  font-weight: 500;
}
.ls-btn--chip.ls-btn--sm { min-height: 24px; padding: 2px 10px; }
.ls-btn--chip.ls-btn--md { min-height: 28px; padding: 4px 12px; }
.ls-btn--chip.ls-btn--lg { min-height: 34px; padding: 6px 16px; }
.ls-btn--chip:hover:not(:disabled) { border-color: var(--accent-light); color: var(--text-bright); }
.ls-btn--chip.ls-btn--active {
  background: rgba(224, 123, 108, 0.1);
  border-color: var(--accent-light);
  color: var(--accent-hover);
  font-weight: 600;
  box-shadow: 0 2px 0 rgba(204, 106, 92, 0.28);
}

/* ── 链接 ── */
.ls-btn--link {
  background: transparent;
  color: var(--accent);
  border: none;
  box-shadow: none;
  min-height: 0;
  padding: 0 2px;
  border-radius: 6px;
  font-weight: 500;
}
.ls-btn--link:hover:not(:disabled) { color: var(--accent-hover); text-decoration: underline; }
.ls-btn--link:active:not(:disabled) { transform: translateY(1px); }

/* 色调覆盖：危险色 */
.ls-btn--tone-danger { color: var(--danger); }
.ls-btn--tone-danger:hover:not(:disabled) { color: #c74949; }

/* ── 按压：下沉、厚底压扁 ── */
.ls-btn--primary:active:not(:disabled),
.ls-btn--secondary:active:not(:disabled),
.ls-btn--danger:active:not(:disabled) {
  transform: translateY(var(--depth));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
}
.ls-btn--chip:active:not(:disabled) { transform: translateY(1px); }

/* ── 禁用：厚底压平、降透明 ── */
.ls-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
  box-shadow: none;
  filter: none;
}

/* ── 撑满 ── */
.ls-btn--block { display: flex; width: 100%; }

/* ── 加载中 ── */
.ls-btn__spinner {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: ls-spin 0.7s linear infinite;
}
@keyframes ls-spin { to { transform: rotate(360deg); } }

/* ── 键盘焦点 ── */
.ls-btn:focus-visible { outline: 3px solid rgba(224, 123, 108, 0.3); outline-offset: 2px; }
.ls-btn:focus:not(:focus-visible) { outline: none; }

/* ── 减弱动效 ── */
@media (prefers-reduced-motion: reduce) {
  .ls-btn { transition: none; }
  .ls-btn--jelly-enter,
  .ls-btn--jelly-leave { animation: none; }
  .ls-btn__spinner { animation-duration: 1.5s; }
}
</style>
