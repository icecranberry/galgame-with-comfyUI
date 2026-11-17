<template>
  <Teleport to="body">
    <Transition name="game-window" @after-leave="afterLeave">
      <div v-if="modelValue" class="game-theme game-overlay" :class="{ 'game-theme--pixel': theme === 'pixel' }" @pointerdown="backdropStarted = $event.target === $event.currentTarget" @click.self="onBackdropClick">
        <section ref="panel" class="game-overlay__panel" :class="{ 'game-overlay__panel--wide': wide }" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
          <header><h2 :id="titleId">{{ title }}</h2><button class="game-overlay__close no-press" type="button" aria-label="关闭" :disabled="closeDisabled" @click="close">×</button></header>
          <div class="game-overlay__body"><slot /></div>
          <footer v-if="$slots.footer"><slot name="footer" /></footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
<script setup>
import { ref, watch, onBeforeUnmount, useId, nextTick } from 'vue'
import '../styles/game-ui.css'
const props = defineProps({ modelValue: Boolean, title: { type: String, default: '' }, theme: { type: String, default: '' }, wide: Boolean, closeDisabled: Boolean })
const emit = defineEmits(['update:modelValue', 'after-leave'])
const panel = ref(null), titleId = `game-dialog-${useId()}`
let previousFocus, backdropStarted = false, listening = false
watch(() => props.modelValue, async open => {
  if (!open) return
  previousFocus = document.activeElement
  if (!listening) { document.addEventListener('keydown', onDocumentKeydown, true); listening = true }
  await nextTick(); if (props.modelValue) panel.value?.focus({ preventScroll: true })
}, { immediate: true })
const close = () => { if (!props.closeDisabled) emit('update:modelValue', false) }
function onBackdropClick(event) { if (backdropStarted || event.detail === 0) close(); backdropStarted = false }
function restoreFocus() { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); previousFocus = null }
function stopListening() { document.removeEventListener('keydown', onDocumentKeydown, true); listening = false }
function afterLeave() { if (!props.modelValue) { stopListening(); restoreFocus(); emit('after-leave') } }
function onDocumentKeydown(event) {
  if (!panel.value || [...document.querySelectorAll('.game-overlay')].at(-1) !== panel.value.closest('.game-overlay')) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close() }
  else if (event.key === 'Tab') {
    if (!panel.value.contains(document.activeElement)) { event.preventDefault(); panel.value.focus({ preventScroll: true }) }
    trapFocus(event)
  }
}
function trapFocus(event) {
  const items = [...(panel.value?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || [])].filter(item => item.getClientRects().length)
  if (!items.length) { event.preventDefault(); return }
  if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === panel.value)) { event.preventDefault(); items.at(-1).focus() }
  else if (!event.shiftKey && (document.activeElement === items.at(-1) || document.activeElement === panel.value)) { event.preventDefault(); items[0].focus() }
}
onBeforeUnmount(() => { stopListening(); restoreFocus() })
</script>
<style scoped>
.game-overlay { position:fixed;inset:0;z-index:15000;background:var(--game-window-backdrop,#050d11cf);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:24px; }
.game-overlay__panel { width:min(100%,540px);max-height:90dvh;background:var(--game-window-bg,#172122);border:var(--game-control-border,1px) solid var(--game-window-border,#63715c);box-shadow:var(--game-window-shadow,10px 10px 0 #050a0c88);display:flex;flex-direction:column;outline:none; }
.game-overlay__panel--wide { width:min(100%,1000px); }
header { display:flex;align-items:center;justify-content:space-between;border-bottom:var(--game-control-border,1px) solid var(--game-window-border,#48534c);background:var(--game-window-header,transparent);padding:20px 24px;gap:16px; }
h2 { font-size:22px;margin:0;line-height:1.4; }
.game-overlay__close { appearance:none;background:var(--game-control-bg,transparent);border:var(--game-control-border,1px) solid var(--game-window-border,#63715c);border-radius:0;color:inherit;font-size:26px;padding:0;width:44px;height:44px;cursor:pointer;transition:background .3s;flex-shrink:0;box-shadow:none; }
.game-overlay__close:hover:not(:disabled) { background:var(--game-window-hover,#344338); }
.game-overlay__close:disabled { opacity:.45;cursor:not-allowed; }
.game-overlay__close:focus-visible { outline:3px solid var(--game-focus,#d2fa72);outline-offset:3px; }
.game-overlay__body { padding:24px;overflow:auto;line-height:1.7;min-height:0; }
footer { padding:16px 24px;border-top:1px solid var(--game-window-border,#48534c);display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap; }
.game-window-enter-active,.game-window-leave-active { transition:opacity .3s; }
.game-window-enter-active .game-overlay__panel,.game-window-leave-active .game-overlay__panel { transition:transform .3s; }
.game-window-enter-from,.game-window-leave-to { opacity:0; }
.game-window-enter-from .game-overlay__panel,.game-window-leave-to .game-overlay__panel { transform:translateY(16px); }
@media(max-width:600px) { .game-overlay { padding:calc(14px + env(safe-area-inset-top)) 14px calc(14px + env(safe-area-inset-bottom)); }.game-overlay__body { padding:18px; }header { padding:14px 18px; }.game-overlay__panel { max-height:100%; } }
@media(prefers-reduced-motion:reduce) { .game-window-enter-active,.game-window-leave-active,.game-window-enter-active .game-overlay__panel,.game-window-leave-active .game-overlay__panel { transition:none; } }
</style>
