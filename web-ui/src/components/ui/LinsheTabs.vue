<template>
  <div
    class="ls-tabs"
    :class="[
      `ls-tabs--${size}`,
      `ls-tabs--${variant}`,
      { 'ls-tabs--disabled': disabled }
    ]"
    role="tablist"
    :aria-disabled="disabled || undefined"
  >
    <div
      v-for="option in options"
      :key="option.value"
      class="ls-tabs__item"
      :class="{ 'ls-tabs__item--active': option.value === modelValue }"
      role="tab"
      :tabindex="
        variant === 'comic'
          ? disabled || option.disabled || option.value !== modelValue
            ? -1
            : 0
          : undefined
      "
      :aria-selected="option.value === modelValue"
      :aria-disabled="disabled || option.disabled || undefined"
      :title="option.title"
      @click="select(option)"
      @keydown="navigate($event, option)"
      @keydown.enter.prevent="select(option)"
      @keydown.space.prevent="select(option)"
    >
      <span
        v-if="variant === 'comic' && option.eyebrow"
        class="ls-tabs__eyebrow"
        aria-hidden="true"
      >
        {{ option.eyebrow }}
      </span>
      {{ option.label }}
      <span v-if="option.badge" class="ls-tabs__badge">{{ option.badge }}</span>
    </div>
  </div>
</template>

<script setup>
defineOptions({ name: 'LinsheTabs' })

const props = defineProps({
  variant: { type: String, default: 'default' },
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  /** sm / md，与 LinsheButton 尺寸对齐 */
  size: { type: String, default: 'md' },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue'])

function select(option) {
  if (props.disabled || option.disabled) return
  emit('update:modelValue', option.value)
}
function navigate(event, option) {
  if (props.variant !== 'comic' || props.disabled) return
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  const enabled = props.options.filter((item) => !item.disabled)
  if (!enabled.length) return
  const index = enabled.findIndex((item) => item.value === option.value)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? enabled.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) %
          enabled.length
  const target = enabled[next]
  const tabs =
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')
  tabs[props.options.indexOf(target)]?.focus()
  select(target)
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
  transition:
    background-color var(--dur-fast) ease,
    color var(--dur-fast) ease,
    box-shadow var(--dur-fast) ease;
}

.ls-tabs__item:hover:not(.ls-tabs__item--active) {
  background: color-mix(in srgb, var(--bg-secondary) 55%, transparent);
  color: var(--text-primary);
}

.ls-tabs__item--active {
  background: rgba(var(--accent-rgb), 0.1);
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
.ls-tabs--sm {
  gap: 3px;
  border-radius: 10px;
}
.ls-tabs--sm .ls-tabs__item {
  min-height: 26px;
  padding: 4px 8px;
  font-size: var(--fs-sm);
  border-radius: 7px;
}
.ls-tabs--sm .ls-tabs__item:hover:not(.ls-tabs__item--active) {
  background: transparent;
  color: var(--accent);
}
.ls-tabs--sm .ls-tabs__item--active {
  background: var(--bg-secondary);
  box-shadow: var(--shadow-xs);
}
.ls-tabs--sm .ls-tabs__item--active::after {
  display: none;
}

.ls-tabs__item[aria-disabled='true'] {
  opacity: 0.55;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .ls-tabs__item {
    transition: none;
  }
}
.ls-tabs--comic {
  background: transparent;
  gap: 10px;
  padding: 3px 4px 7px;
  border-radius: 0;
}
.ls-tabs--comic .ls-tabs__item {
  min-height: 44px;
  border: 2px solid var(--media-rule);
  border-radius: 1px;
  color: var(--text-bright);
  background: var(--media-paper);
  padding: 9px 16px;
  font-weight: 800;
  font-size: 14px;
  gap: 10px;
  overflow: visible;
  transition: transform 0.3s ease;
}
.ls-tabs--comic .ls-tabs__item:hover:not(.ls-tabs__item--active) {
  background: var(--media-paper);
  color: var(--text-bright);
  transform: translateY(-2px);
}
.ls-tabs--comic .ls-tabs__item--active {
  background: var(--accent);
  color: var(--media-ink);
  border-color: var(--media-ink);
  box-shadow: 3px 3px 0 var(--media-rule);
  transform: rotate(-1deg);
}
.ls-tabs--comic .ls-tabs__item--active::after {
  display: none;
}
.ls-tabs--comic .ls-tabs__item:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}
.ls-tabs--comic.ls-tabs--md .ls-tabs__item {
  min-height: 64px;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 18px;
}
.ls-tabs__eyebrow {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: monospace;
  font-size: 12px;
  letter-spacing: 0.08em;
  opacity: 0.75;
}
@media (max-width: 767px) {
  .ls-tabs--comic {
    gap: 6px;
  }
  .ls-tabs--comic.ls-tabs--sm .ls-tabs__item {
    padding: 8px 12px;
    font-size: 13px;
  }
  .ls-tabs--comic.ls-tabs--md .ls-tabs__item {
    min-height: 44px;
    align-items: center;
    font-size: 13px;
    padding: 9px 4px;
  }
  .ls-tabs--comic .ls-tabs__eyebrow {
    display: none;
  }
}
.ls-tabs__badge { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 800; line-height: 1.3; }
.ls-tabs__badge::before { content: ''; width: 6px; height: 6px; background: var(--danger); border: 1px solid var(--media-ink, var(--cel-outline)); border-radius: 50%; }
.ls-tabs--comic.ls-tabs--md .ls-tabs__item:has(.ls-tabs__badge) { padding-right: 48px; }
.ls-tabs--comic .ls-tabs__badge { position: absolute; right: 8px; top: 8px; padding: 3px 5px; border: 1px solid var(--media-ink); background: var(--media-light); color: var(--media-ink); transform: rotate(5deg); }
@media (max-width: 767px) { .ls-tabs--comic.ls-tabs--md .ls-tabs__item:has(.ls-tabs__badge) { padding: 9px 4px; gap: 3px; } .ls-tabs--comic .ls-tabs__badge { position: static; font-size: 9px; padding: 1px 4px; transform: none; } }
</style>
