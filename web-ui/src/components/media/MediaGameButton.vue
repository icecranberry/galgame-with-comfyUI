<template>
  <button
    type="button"
    class="media-game-button"
    :class="[
      `media-game-button--${variant}`,
      `media-game-button--${size}`,
      { 'is-loading': loading }
    ]"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <span v-if="loading" class="game-spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<script setup>
// 传媒专属漫画控件：按本页设计需求独立于通用软糖按钮。
defineProps({
  variant: { type: String, default: 'secondary' },
  size: { type: String, default: 'md' },
  disabled: Boolean,
  loading: Boolean
})
</script>

<style scoped>
.media-game-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 9px 16px;
  border: 2px solid var(--media-ink);
  border-radius: 2px;
  background: var(--media-paper);
  color: var(--text-bright);
  box-shadow: 3px 3px 0 var(--media-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.3;
  cursor: pointer;
  touch-action: manipulation;
  transition: transform 0.15s ease;
}
.media-game-button--sm {
  padding: 9px 10px;
}
.media-game-button--primary {
  background: var(--accent);
  color: var(--media-ink);
}
.media-game-button--ghost {
  background: transparent;
  box-shadow: none;
  color: inherit;
  border-color: currentColor;
}
.media-game-button--danger {
  color: color-mix(in srgb, var(--danger) 75%, var(--text-bright));
  background: var(--media-paper);
  box-shadow: none;
}
.media-game-button--icon {
  width: 44px;
  padding: 8px;
  font-size: 20px;
}
.media-game-button:hover:not(:disabled) {
  transform: translate(-1px, -2px);
}
.media-game-button:active:not(:disabled) {
  transform: translate(2px, 2px);
  box-shadow: none;
}
.media-game-button:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 4px;
}
.media-game-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}
.game-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: cel-spin 0.8s linear infinite;
}
</style>
