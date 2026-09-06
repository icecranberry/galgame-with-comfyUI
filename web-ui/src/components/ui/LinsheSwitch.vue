<template>
  <label
    class="ls-switch"
    :class="[`ls-switch--${size}`, { 'ls-switch--on': modelValue, 'ls-switch--disabled': disabled }]"
  >
    <span v-if="hasStateText" class="ls-switch__text">{{ stateText }}</span>
    <span class="ls-switch__box">
      <input
        v-bind="$attrs"
        class="ls-switch__input"
        type="checkbox"
        role="switch"
        :checked="modelValue"
        :disabled="disabled || undefined"
        @change="onChange"
      />
      <span class="ls-switch__track" aria-hidden="true"></span>
    </span>
  </label>
</template>

<script setup>
import { computed } from 'vue'

defineOptions({ name: 'LinsheSwitch', inheritAttrs: false })

const props = defineProps({
  /** sm / md / lg，与 LinsheButton 尺寸对齐 */
  size: { type: String, default: 'md' },
  disabled: { type: Boolean, default: false },
  modelValue: { type: Boolean, default: false },
  /** 状态文字：开启显示 onText、关闭显示 offText，传其一即启用（如「已启用/已禁用」） */
  onText: { type: String, default: '' },
  offText: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'change'])

const hasStateText = computed(() => !!(props.onText || props.offText))
const stateText = computed(() =>
  props.modelValue ? (props.onText || props.offText) : (props.offText || props.onText),
)

function onChange(e) {
  const checked = e.target.checked
  emit('update:modelValue', checked)
  emit('change', checked)
}
</script>

<style scoped>
/* ── 软糖拨动开关 ──
   与 LinsheButton / LinsheInput 同一门派：
   两态同为「凸起的糖」，仅换糖色：关＝暖灰软糖，开＝珊瑚糖；
   硬底厚投影两态等高，拨动时整体尺寸不跳变 */
.ls-switch {
  --knob: 18px;
  --pad: 3px;
  --travel: 20px;
  --depth: 2px;
  --ease: cubic-bezier(0.22, 0.61, 0.36, 1);
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

/* ── 尺寸（与 LinsheButton 对齐）── 尺寸作用在轨道盒上，状态文字不撑大开关 */
.ls-switch__box { position: relative; display: block; width: 44px; height: 24px; }
.ls-switch--sm .ls-switch__box { --knob: 14px; --pad: 2px; --travel: 14px; width: 32px; height: 18px; }
.ls-switch--lg .ls-switch__box { --knob: 22px; --travel: 24px; --depth: 2.5px; width: 52px; height: 28px; }

/* ── 状态文字 ── */
.ls-switch__text {
  font-size: 11px;
  color: var(--text-secondary);
  letter-spacing: 0.2px;
  white-space: nowrap;
}

/* 隐藏的原生 checkbox：铺满整个开关，承接键盘 / 读屏 / title 提示 */
.ls-switch__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

/* ── 轨道：关＝中性软糖 ── */
.ls-switch__track {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: 999px;
  background: var(--bg-tertiary);
  box-shadow: 0 var(--depth) 0 var(--border), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  transition:
    background-color 0.25s var(--ease-standard),
    box-shadow 0.25s var(--ease-standard),
    filter 0.15s ease;
}

/* 糖球 */
.ls-switch__track::before {
  content: '';
  position: absolute;
  top: 53%;
  left: var(--pad);
  width: var(--knob);
  height: var(--knob);
  border-radius: 50%;
  background: var(--bg-secondary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transform: translateY(-50%) translateX(0);
  transition: transform 0.25s var(--ease-standard);
}

/* ── 开＝主题糖 ── */
.ls-switch--on .ls-switch__track {
  background: var(--accent);
  box-shadow: 0 var(--depth) 0 var(--accent-hover), inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.ls-switch--on .ls-switch__track::before { transform: translateY(-50%) translateX(var(--travel)); }

/* ── 悬停：关＝灰糖加深一点；开＝主题糖提亮（同 primary 按钮） ── */
.ls-switch:not(.ls-switch--on):not(.ls-switch--disabled):hover .ls-switch__track { background: var(--bg-hover); }
.ls-switch--on:not(.ls-switch--disabled):hover .ls-switch__track { filter: brightness(1.05) saturate(1.05); }

/* ── 键盘焦点：与 LinsheButton 同款光环 ── */
.ls-switch__input:focus-visible + .ls-switch__track {
  outline: 3px solid rgba(var(--accent-rgb), 0.3);
  outline-offset: 2px;
}

/* ── 禁用 ── */
.ls-switch--disabled { cursor: not-allowed; }
.ls-switch--disabled .ls-switch__input { cursor: not-allowed; }
.ls-switch--disabled .ls-switch__track { opacity: 0.55; }

/* ── 减弱动效 ── */
@media (prefers-reduced-motion: reduce) {
  .ls-switch__track,
  .ls-switch__track::before { transition: none; }
}
</style>
