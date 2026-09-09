<template>
  <div
    class="ls-tabs"
    :class="[`ls-tabs--${size}`, { 'ls-tabs--disabled': disabled }]"
    role="tablist"
    :aria-disabled="disabled || undefined"
  >
    <div
      v-for="option in options"
      :key="option.value"
      class="ls-tabs__item"
      :class="{ 'ls-tabs__item--active': option.value === modelValue }"
      role="tab"
      :aria-selected="option.value === modelValue"
      :aria-disabled="disabled || option.disabled || undefined"
      :title="option.title"
      @click="select(option)"
      @keydown.enter.prevent="select(option)"
      @keydown.space.prevent="select(option)"
    >{{ option.label }}</div>
  </div>
</template>

<script setup>
defineOptions({ name: 'LinsheTabs' })

defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  /** sm / md，与 LinsheButton 尺寸对齐 */
  size: { type: String, default: 'md' },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

function select(option) {
  if (option.disabled) return
  emit('update:modelValue', option.value)
}
</script>

<style scoped>
/* 分段选择 / 页签：暖纸凹陷轨道 + 选中项凸起
   暖色口径与旧实现逐项对齐：
   · md 页签式（旧 .comfy-tab）：主题糖浅底 + 底部指示条
   · sm 小分段（旧 .test-mode-btn / .artist-mode-chip / .emoji-style-chip）：主题表面胶囊 + 微阴影 */
.ls-tabs {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 4px;
  padding: 3px;
  background: var(--bg-sunken);
  border-radius: var(--radius-md);
}

.ls-tabs__item {
  position: relative;
  min-width: 0;
  min-height: 32px;
  padding: 7px 10px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-base);
  font-weight: 500;
  color: var(--text-secondary);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  user-select: none;
  transition: background-color var(--dur-fast) ease, color var(--dur-fast) ease, box-shadow var(--dur-fast) ease;
}

.ls-tabs__item:hover:not(.ls-tabs__item--active) {
  background: color-mix(in srgb, var(--bg-secondary) 55%, transparent);
  color: var(--text-primary);
}

.ls-tabs__item--active {
  background: rgba(var(--accent-rgb), 0.10);
  color: var(--accent);
  font-weight: 600;
}

.ls-tabs__item--active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 4px;
  width: 18px;
  height: 2px;
  border-radius: 2px;
  transform: translateX(-50%);
  background: var(--accent);
}

/* sm：小分段选择（旧 .test-mode-btn / .artist-mode-chip / .emoji-style-chip） */
.ls-tabs--sm { gap: 3px; border-radius: 10px; }
.ls-tabs--sm .ls-tabs__item { min-height: 26px; padding: 4px 8px; font-size: var(--fs-sm); border-radius: 7px; }
.ls-tabs--sm .ls-tabs__item:hover:not(.ls-tabs__item--active) { background: transparent; color: var(--accent); }
.ls-tabs--sm .ls-tabs__item--active { background: var(--bg-secondary); box-shadow: var(--shadow-xs); }
.ls-tabs--sm .ls-tabs__item--active::after { display: none; }

.ls-tabs__item[aria-disabled='true'] { opacity: 0.55; pointer-events: none; }

@media (prefers-reduced-motion: reduce) {
  .ls-tabs__item { transition: none; }
}
</style>
