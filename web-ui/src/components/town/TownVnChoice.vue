<template>
  <div
    class="vn-choice"
    :class="{ 'is-primary': primary, 'is-disabled': disabled, 'is-busy': busy }"
    role="button"
    :tabindex="disabled || busy ? -1 : 0"
    :aria-disabled="disabled || busy || undefined"
    :aria-busy="busy || undefined"
    @click="select"
    @keydown.enter.prevent="select"
    @keydown.space.prevent="select"
  >
    <span class="vn-choice__label"><slot /></span>
    <span v-if="hint" class="vn-choice__hint">{{ hint }}</span>
  </div>
</template>

<script setup>
const props = defineProps({
  /** 主选项（实心主题糖），一屏最多一个 */
  primary: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  /** 右侧附注：价格 / 工资等 */
  hint: { type: String, default: '' },
})
const emit = defineEmits(['select'])
function select() {
  if (props.disabled || props.busy) return
  emit('select')
}
</script>

<style scoped>
/* 视觉小说选项：横向暖纸长条，深描边 + 底部厚度，是小镇纸张语言的一部分，
   按设计系统约定用 div[role=button] 自包含实现，不套通用按钮组件。 */
.vn-choice {
  --vn-ink: var(--town-paper-ink, #554a43);
  --vn-line: #8d7968;
  --vn-paper-top: #fffdf7;
  --vn-paper-bottom: #f4e7cf;
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 9px 14px 9px 34px;
  box-sizing: border-box;
  border: 2px solid var(--vn-line);
  border-radius: 12px;
  background: linear-gradient(180deg, var(--vn-paper-top) 0%, var(--vn-paper-top) 52%, var(--vn-paper-bottom) 52%, var(--vn-paper-bottom) 100%);
  color: var(--vn-ink);
  font-size: var(--fs-md, 14px);
  font-weight: 700;
  letter-spacing: .02em;
  line-height: 1.35;
  text-align: left;
  box-shadow: 0 3px 0 #d8c1a1, 0 6px 14px rgba(54, 42, 56, .14);
  cursor: pointer;
  user-select: none;
  transition: transform var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard), filter var(--dur-fast) var(--ease-standard);
}
.vn-choice::before {
  content: '';
  position: absolute;
  left: 13px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  color: var(--town-paper-accent, #ae6451);
  transition: transform var(--dur-fast) var(--ease-spring);
}
.vn-choice:hover:not(.is-disabled),
.vn-choice:focus-visible:not(.is-disabled) {
  filter: brightness(1.03);
  transform: translateY(-1px);
  box-shadow: 0 4px 0 #d8c1a1, 0 8px 16px rgba(54, 42, 56, .16);
}
.vn-choice:hover:not(.is-disabled)::before,
.vn-choice:focus-visible:not(.is-disabled)::before { transform: translateY(-50%) translateX(3px); }
.vn-choice:active:not(.is-disabled) {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #d8c1a1, 0 3px 8px rgba(54, 42, 56, .14);
}
.vn-choice:focus-visible { outline: none; }
.vn-choice__label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.vn-choice__hint { flex-shrink: 0; font-size: var(--fs-sm, 12px); font-weight: 400; color: var(--town-paper-muted, #76665a); }
.vn-choice.is-primary {
  border-color: var(--cel-outline, #4a3d36);
  background: linear-gradient(180deg, var(--accent-light, #f0a89a) 0%, var(--accent-light, #f0a89a) 52%, var(--accent, #e07b6c) 52%, var(--accent, #e07b6c) 100%);
  color: var(--on-accent, #fff);
  text-shadow: 0 1px 0 rgba(0, 0, 0, .18);
  box-shadow: 0 3px 0 var(--btn-lip, #a44a3e), 0 6px 14px rgba(54, 42, 56, .18);
}
.vn-choice.is-primary::before { color: #fff8ef; }
.vn-choice.is-primary .vn-choice__hint { color: rgba(255, 255, 255, .85); }
.vn-choice.is-disabled {
  opacity: .5;
  cursor: not-allowed;
  transform: none;
  box-shadow: 0 2px 0 #d8c1a1;
}
.vn-choice.is-busy { cursor: progress; opacity: .75; }
</style>
