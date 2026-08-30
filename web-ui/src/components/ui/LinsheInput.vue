<template>
  <textarea
    v-if="type === 'textarea'"
    ref="el"
    class="ls-input ls-input--textarea"
    :class="lsClasses"
    :value="modelValue"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled || undefined"
    :readonly="readonly || undefined"
    :maxlength="maxlength"
    @input="onInput"
    @compositionstart="onCompositionStart"
    @compositionend="onCompositionEnd"
  ></textarea>
  <input
    v-else
    ref="el"
    class="ls-input"
    :class="lsClasses"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled || undefined"
    :readonly="readonly || undefined"
    :maxlength="maxlength"
    @input="onInput"
    @compositionstart="onCompositionStart"
    @compositionend="onCompositionEnd"
  />
</template>

<script setup>
import { computed, ref } from 'vue'

defineOptions({ name: 'LinsheInput' })

const props = defineProps({
  /** 原生 input 类型（text/password/number/time…），或 'textarea' 渲染为文本域 */
  type: { type: String, default: 'text' },
  /** sm / md / lg，与 LinsheButton 尺寸对齐 */
  size: { type: String, default: 'md' },
  placeholder: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  maxlength: { type: [String, Number], default: undefined },
  /** textarea 行数 */
  rows: { type: [String, Number], default: 3 },
  /** 校验错误态：红色描边（对应原 .fi-error） */
  invalid: { type: Boolean, default: false },
  modelValue: { type: [String, Number], default: '' },
  /** v-model 修饰符：.number / .trim */
  modelModifiers: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['update:modelValue'])

const el = ref(null)
let composing = false

const lsClasses = computed(() => [
  `ls-input--${props.size}`,
  { 'ls-input--invalid': props.invalid },
])

function looseToNumber(val) {
  const n = parseFloat(val)
  return Number.isNaN(n) ? val : n
}

function emitValue(e) {
  let value = e.target.value
  if (props.modelModifiers.trim) value = value.trim()
  if (props.modelModifiers.number) value = looseToNumber(value)
  emit('update:modelValue', value)
}
function onInput(e) {
  if (composing) return
  emitValue(e)
}
function onCompositionStart() {
  composing = true
}
function onCompositionEnd(e) {
  if (!composing) return
  composing = false
  emitValue(e)
}

defineExpose({
  focus: (options) => el.value?.focus(options),
  blur: () => el.value?.blur(),
  select: () => el.value?.select(),
})
</script>

<style scoped>
/* ── 软糖凹陷输入框 ──
   与 LinsheButton 的「软糖立体」互补：按钮是凸起的糖，
   输入框是糖被按进糖纸后留下的凹痕（微下陷 + 聚焦时被珊瑚色照亮） */
.ls-input {
  box-sizing: border-box;
  display: block;
  width: 100%;
  margin: 0;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-bright);
  background: #fffdfb;
  border: 1.5px solid #e3dcd2;
  border-radius: 10px;
  caret-color: var(--accent);
  outline: none;
  box-shadow: inset 0 1px 2px rgba(96, 66, 46, 0.05);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background-color 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}
.ls-input::placeholder { color: #b8afa5; opacity: 1; }

/* ── 尺寸（与 LinsheButton 对齐） ── */
.ls-input--sm { min-height: 26px; padding: 3px 9px; font-size: 12px; border-radius: 8px; }
.ls-input--md { min-height: 36px; padding: 6px 12px; }
.ls-input--lg { min-height: 42px; padding: 10px 14px; font-size: 14px; border-radius: 12px; }

/* ── 文本域 ── */
.ls-input--textarea {
  min-height: 0;
  padding: 8px 12px;
  line-height: 1.6;
  resize: vertical;
}

/* ── 悬停：边框加深一点 ── */
.ls-input:hover:not(:disabled):not(:focus) { border-color: #d5cabb; }

/* ── 聚焦：凹痕被珊瑚色照亮 ── */
.ls-input:focus {
  background: #fff;
  border-color: var(--accent);
  box-shadow:
    0 0 0 3px rgba(224, 123, 108, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

/* ── 校验错误 ── */
.ls-input--invalid { border-color: var(--danger, #d9534f); }
.ls-input--invalid:focus { box-shadow: 0 0 0 3px rgba(217, 83, 79, 0.15); }

/* ── 禁用 ── */
.ls-input:disabled {
  background: #f6f3ee;
  border-color: #eae4da;
  color: #b3aca4;
  cursor: not-allowed;
  box-shadow: none;
}
.ls-input:disabled::placeholder { color: #c4bdb2; }

/* ── 浏览器自动填充时保持暖白底 ── */
.ls-input:-webkit-autofill {
  -webkit-box-shadow: 0 0 0 40px #fffdfb inset;
  -webkit-text-fill-color: var(--text-bright);
  transition: background-color 9999s ease-out;
}

/* ── 减弱动效 ── */
@media (prefers-reduced-motion: reduce) {
  .ls-input { transition: none; }
}
</style>
