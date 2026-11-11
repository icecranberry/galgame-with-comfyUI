<template>
  <section class="prompt-desk" aria-label="Prompt设定">
    <div class="prompt-desk-heading">
      <strong class="prompt-desk-title">Prompt设定</strong>
      <div class="polish-stamp" :class="{ 'is-on': modelValue, 'is-disabled': disabled }" role="switch" :aria-checked="modelValue" :aria-disabled="disabled" :tabindex="disabled ? -1 : 0" aria-label="拍摄前 AI 润色" @click="toggle" @keydown.enter.prevent="toggle" @keydown.space.prevent="toggle">
        <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m7 20 2-6L21 2l5 5-12 12-7 1ZM18 5l5 5M4 25h20M3 7h6M6 4v6" /></svg><strong>AI 润色</strong><span class="polish-status">{{ modelValue ? 'ON' : 'OFF' }}</span>
      </div>
    </div>
    <div class="prompt-desk-actions"><studio-button variant="ghost" size="compact" :disabled="!canPreview" @click="$emit('preview')">拼装Prompt ↗</studio-button><studio-button variant="ghost" size="compact" :disabled="!hasPhoto" @click="$emit('photo-prompt')">最终Prompt ↗</studio-button></div>
  </section>
</template>

<script setup>
import StudioButton from './StudioButton.vue'
const props = defineProps({ modelValue: Boolean, disabled: Boolean, canPreview: Boolean, hasPhoto: Boolean })
const emit = defineEmits(['update:modelValue', 'preview', 'photo-prompt'])
function toggle(event) { if (!props.disabled && !event?.repeat) emit('update:modelValue', !props.modelValue) }
</script>

<style scoped>
.prompt-desk{display:grid;gap:6px;border-top:1px dashed var(--studio-ink);padding-top:8px;flex-shrink:0}.prompt-desk-heading{display:flex;align-items:center;justify-content:space-between;gap:6px}.prompt-desk-title{font-size:13px;line-height:1.4;white-space:nowrap}
.polish-stamp{position:relative;display:flex;align-items:center;gap:6px;min-height:36px;padding:5px 6px;box-sizing:border-box;border:2px solid var(--studio-muted);color:var(--studio-muted);background:var(--studio-bg);text-align:left;cursor:pointer;user-select:none;transition:background .3s,color .3s,border-color .3s,transform .3s}.polish-stamp svg{width:16px;height:16px;flex-shrink:0}.polish-stamp strong{font-size:13px;line-height:1.4;font-weight:900;white-space:nowrap}.polish-status{margin-left:auto;padding-left:6px;border-left:1px dashed currentColor;font:italic 900 14px/1.3 monospace}.polish-stamp.is-on{border-color:var(--studio-tag);color:var(--studio-tag);background:color-mix(in srgb,var(--studio-tag) 8%,var(--studio-paper));box-shadow:inset 0 0 0 2px var(--studio-paper)}.polish-stamp.is-on::after{content:'';position:absolute;inset:3px;border:1px solid currentColor;pointer-events:none;opacity:.4}.polish-stamp:hover:not(.is-disabled){transform:rotate(-1deg)}.polish-stamp:active:not(.is-disabled){transform:translateY(2px)}.polish-stamp:focus-visible{outline:2px solid var(--studio-tag);outline-offset:3px}.polish-stamp.is-disabled{opacity:.5;cursor:not-allowed}.prompt-desk-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
@media(pointer:coarse){.polish-stamp{min-height:44px}}
@media(prefers-reduced-motion:reduce){.polish-stamp{transition:none}}
</style>
