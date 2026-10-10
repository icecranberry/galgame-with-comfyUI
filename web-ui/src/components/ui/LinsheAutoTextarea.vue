<template>
  <div class="ls-auto-textarea" :class="{ 'is-collapsed': collapsible && !focused }">
    <textarea
      ref="el"
      class="ls-auto-textarea__field"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled || undefined"
      :maxlength="maxlength"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
    ></textarea>
    <div
      v-if="collapsible && modelValue && !focused"
      class="ls-auto-textarea__ellipsis"
      title="点击展开编辑"
      @mousedown.prevent="focusToEnd"
    >{{ modelValue }}</div>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'

defineOptions({ name: 'LinsheAutoTextarea' })

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  maxlength: { type: [String, Number], default: undefined },
  /** 收起时保持单行省略，聚焦后自动增高 */
  collapsible: { type: Boolean, default: false },
  /** 非折叠文本域的最小高度 */
  minHeight: { type: [String, Number], default: 100 },
})

const emit = defineEmits(['update:modelValue', 'focus', 'blur', 'enter', 'escape'])

const el = ref(null)
const focused = ref(false)
let composing = false

function resize() {
  if (!el.value) return
  const style = getComputedStyle(el.value)
  const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
  el.value.style.height = 'auto'
  el.value.style.height = `${Math.max(el.value.scrollHeight, el.value.clientHeight) + borders}px`
}

function focusToEnd() {
  const node = el.value
  if (!node || props.disabled) return
  node.focus()
  node.setSelectionRange(node.value.length, node.value.length)
}

function onInput(event) {
  if (composing) return
  emit('update:modelValue', event.target.value)
  nextTick(resize)
}

function onFocus(event) {
  focused.value = true
  nextTick(resize)
  emit('focus', event)
}

function onBlur(event) {
  focused.value = false
  if (props.collapsible) event.target.style.height = ''
  emit('blur', event)
}

function onKeydown(event) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') emit('escape', event)
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
  emit('enter', event)
}

function onCompositionStart() {
  composing = true
}

function onCompositionEnd(event) {
  if (!composing) return
  composing = false
  emit('update:modelValue', event.target.value)
  nextTick(resize)
}

watch(() => props.modelValue, () => nextTick(resize))

onMounted(() => {
  if (!props.collapsible) resize()
})

defineExpose({
  focus: (options) => el.value?.focus(options),
  blur: () => el.value?.blur(),
  select: () => el.value?.select(),
  focusToEnd,
})
</script>

<style scoped>
/* 独立自动增高文本域：与 LinsheInput 共用平面轮廓，支持折叠与精确光标控制 */
.ls-auto-textarea { position: relative; width: 100%; }

.ls-auto-textarea__field {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 38px;
  margin: 0;
  padding: 8px 12px;
  font-family: inherit;
  font-size: var(--fs-base);
  line-height: 1.5;
  color: var(--text-bright);
  background: var(--bg-secondary);
  border: 1.5px solid var(--border);
  border-radius: var(--radius-md);
  caret-color: var(--accent);
  outline: none;
  resize: none;
  overflow: hidden;
  box-shadow: none;
  transition: border-color var(--dur-interaction) var(--ease-standard);
}

.ls-auto-textarea__field::placeholder { color: var(--text-secondary); opacity: 1; }

.ls-auto-textarea__field:hover:not(:disabled):not(:focus) { border-color: var(--border-strong); }

.ls-auto-textarea__field:focus {
  background: var(--bg-secondary);
  border-color: var(--accent);
  outline: none;
  box-shadow: none;
}

.ls-auto-textarea__field:disabled {
  background: var(--bg-tertiary);
  border-color: var(--border);
  color: var(--text-secondary);
  cursor: not-allowed;
  box-shadow: none;
}

.is-collapsed .ls-auto-textarea__field { height: 38px; }

.ls-auto-textarea__ellipsis {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: var(--fs-base);
  color: var(--text-bright);
  background: var(--bg-secondary);
  border: 1.5px solid var(--border);
  border-radius: var(--radius-md);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
  transition: border-color var(--dur-interaction) var(--ease-standard);
}

.ls-auto-textarea__field:not(:disabled) + .ls-auto-textarea__ellipsis:hover { border-color: var(--border-strong); }
.ls-auto-textarea__field:disabled + .ls-auto-textarea__ellipsis {
  background: var(--bg-tertiary);
  border-color: var(--border);
  color: var(--text-secondary);
  cursor: not-allowed;
}
</style>
