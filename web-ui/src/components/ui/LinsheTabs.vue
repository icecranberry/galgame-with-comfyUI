<template>
  <div
    ref="tabList"
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
      class="ls-tabs__entry"
      :class="{ 'ls-tabs__entry--closable': variant === 'folder' && option.closeLabel }"
      role="presentation"
    >
      <div
        class="ls-tabs__item"
        :class="{ 'ls-tabs__item--active': option.value === modelValue }"
        role="tab"
        :tabindex="!disabled && !option.disabled && option.value === focusableValue ? 0 : -1"
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
        <slot name="option" :option="option" :selected="option.value === modelValue">{{ option.label }}</slot>
        <span v-if="variant === 'filter' && option.count != null" class="ls-tabs__count">{{ option.count }}</span>
        <span v-if="option.badge" class="ls-tabs__badge">{{ option.badge }}</span>
      </div>
      <linshe-button
        v-if="variant === 'folder' && option.closeLabel"
        class="ls-tabs__close"
        variant="link"
        tone="muted"
        size="sm"
        :disabled="disabled || option.disabled"
        :aria-label="option.closeLabel"
        @click="emit('close', option.value)"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </linshe-button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watchPostEffect } from 'vue'
import LinsheButton from './LinsheButton.vue'

defineOptions({ name: 'LinsheTabs' })

const props = defineProps({
  variant: { type: String, default: 'default' },
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  /** sm / md，与 LinsheButton 尺寸对齐 */
  size: { type: String, default: 'md' },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'close'])
const tabList = ref(null)
const focusableValue = computed(() => (props.options.find(option => !option.disabled && option.value === props.modelValue)
  ?? props.options.find(option => !option.disabled))?.value)

watchPostEffect(() => {
  if (props.variant !== 'folder' || !tabList.value) return
  const index = props.options.findIndex(option => option.value === props.modelValue)
  tabList.value.children[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
})

function select(option) {
  if (props.disabled || option.disabled) return
  emit('update:modelValue', option.value)
}

function focusTab() {
  tabList.value?.querySelector('.ls-tabs__item[tabindex="0"]')?.focus()
}

defineExpose({ focusTab })

function navigate(event, option) {
  if (props.disabled) return
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
  tabList.value?.children[props.options.indexOf(target)]?.querySelector('.ls-tabs__item')?.focus()
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
.ls-tabs__entry { display: contents; }

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

/* 轻量分类栏：不为每个分类加外壳，只突出当前项。 */
.ls-tabs--filter {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding: 0;
  background: transparent;
  border-radius: 0;
}
.ls-tabs--filter .ls-tabs__item {
  gap: 6px;
  min-height: 34px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  color: var(--text-primary);
  transition: background-color 0.3s ease, color 0.3s ease;
}
.ls-tabs--filter .ls-tabs__item:hover:not(.ls-tabs__item--active) {
  background: color-mix(in srgb, var(--text-secondary) 7%, transparent);
}
.ls-tabs--filter .ls-tabs__item--active {
  background: rgba(var(--accent-rgb), 0.09);
  color: var(--accent-hover);
  box-shadow: none;
}
.ls-tabs--filter .ls-tabs__item--active::after {
  bottom: 0;
}
.ls-tabs--filter .ls-tabs__item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.ls-tabs__count {
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.ls-tabs--filter .ls-tabs__item--active .ls-tabs__count { color: inherit; }
@media (max-width: 767px) {
  .ls-tabs--filter { gap: 2px 4px; }
  .ls-tabs--filter .ls-tabs__item { min-height: 40px; padding: 9px 8px; }
}

/* 文件夹页签：选中项以同色底边接到正文面板。 */
.ls-tabs--folder {
  --folder-tab-surface: color-mix(in srgb, var(--bg-primary), var(--border-strong) 35%);
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 4px 2px 0;
  overflow-x: auto;
  scrollbar-width: thin;
  background: transparent;
  border-radius: 0;
}
:global([data-theme="dark"] .ls-tabs--folder) {
  --folder-tab-surface: color-mix(in srgb, var(--bg-tertiary), var(--bg-primary) 60%);
}
.ls-tabs--folder .ls-tabs__entry {
  position: relative;
  display: flex;
  flex: 1 0 clamp(8rem, 22%, 12rem);
  min-width: 0;
  max-width: 12rem;
}
.ls-tabs--folder .ls-tabs__item {
  flex: 1;
  min-height: 38px;
  justify-content: flex-start;
  padding: 8px 14px;
  border: 1px solid color-mix(in srgb, var(--border), transparent 30%);
  border-bottom: 0;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  background: var(--folder-tab-surface);
  transition: background-color var(--dur-interaction) ease, border-color var(--dur-interaction) ease, color var(--dur-interaction) ease, box-shadow var(--dur-interaction) ease;
}
.ls-tabs--folder .ls-tabs__item:hover:not(.ls-tabs__item--active) {
  background: color-mix(in srgb, var(--folder-tab-surface), var(--bg-secondary) 28%);
}
.ls-tabs--folder .ls-tabs__entry--closable .ls-tabs__item { padding-inline-end: 34px; }
.ls-tabs__close {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 4px;
  margin-block: auto;
  width: 28px;
  height: 28px;
}
.ls-tabs--folder .ls-tabs__item--active {
  background: var(--bg-secondary);
  border-color: var(--border);
  color: var(--accent-hover);
  font-weight: 700;
  box-shadow: 0 -2px 6px color-mix(in srgb, var(--cel-outline) 12%, transparent);
}
.ls-tabs--folder .ls-tabs__item--active::after { display: none; }
.ls-tabs--folder .ls-tabs__item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -3px;
}
@media (max-width: 767px) {
  .ls-tabs--folder { gap: 6px; scrollbar-width: none; }
  .ls-tabs--folder .ls-tabs__entry {
    flex: 0 0 auto;
    max-width: min(12rem, 100%);
  }
  .ls-tabs--folder .ls-tabs__entry--closable { min-width: min(6rem, 100%); }
  .ls-tabs--folder .ls-tabs__item {
    min-height: 44px;
    padding-inline: 12px;
  }
  .ls-tabs--folder .ls-tabs__entry--closable .ls-tabs__item { padding-inline-end: 44px; }
  .ls-tabs__close { inset-inline-end: 0; width: 44px; height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .ls-tabs__item,
  .ls-tabs--filter .ls-tabs__item,
  .ls-tabs--folder .ls-tabs__item {
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
/* Opt-in photographic control rail; other tab variants keep their own skin. */
.ls-tabs--film { background:var(--studio-bg); border:1px solid var(--studio-line); border-radius:5px; gap:3px; padding:4px; }
.ls-tabs--film .ls-tabs__item { min-height:38px; border-radius:3px; color:var(--studio-muted); font-weight:600; transition:background-color .3s,color .3s,box-shadow .3s; }
.ls-tabs--film .ls-tabs__item:hover:not(.ls-tabs__item--active) { color:var(--studio-ink); background:var(--studio-paper); }
.ls-tabs--film .ls-tabs__item--active { color:var(--studio-ink); background:var(--studio-paper); box-shadow:0 1px 3px var(--studio-shadow),inset 0 -2px var(--studio-accent); }
.ls-tabs--film .ls-tabs__item--active::after { display:none; }
.ls-tabs--film .ls-tabs__item:focus-visible { outline:2px solid var(--studio-accent); outline-offset:1px; }
@media(prefers-reduced-motion:reduce) { .ls-tabs--film .ls-tabs__item { transition:none; } }
</style>
