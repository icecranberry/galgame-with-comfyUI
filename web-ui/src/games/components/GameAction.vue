<template>
  <button class="game-action no-press" :class="[`game-action--${variant}`, { 'is-busy': busy, 'is-active': active, 'is-compact': compact }]" :disabled="disabled || busy" :type="type" :aria-busy="busy || undefined">
    <span v-if="busy" class="game-action__spinner" aria-hidden="true"></span><slot />
  </button>
</template>
<script setup>
// The independent game-test control; additions cover the current host's tabs.
defineProps({ variant: { type: String, default: 'outline' }, busy: Boolean, disabled: Boolean, active: Boolean, compact: Boolean, type: { type: String, default: 'button' } })
</script>
<style scoped>
.game-action { appearance:none;border:var(--game-control-border,1px) solid var(--game-line,#495455);border-radius:var(--game-control-radius,3px);background:var(--game-control-bg,transparent);color:inherit;min-height:44px;padding:11px 19px;font:inherit;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:9px;transition:background .3s,color .3s,transform .3s,border-color .3s,box-shadow .3s;line-height:1.3;text-align:center;box-shadow:var(--game-control-shadow,none); }
.game-action:hover:not(:disabled) { background:var(--game-hover,#283333);border-color:var(--game-acid,#d2fa72);transform:translateY(-2px); }
.game-action:active:not(:disabled) { transform:translateY(1px); }
.game-action:focus-visible { outline:3px solid var(--game-focus,var(--game-acid,#d2fa72));outline-offset:4px; }
.game-action:disabled { opacity:.45;cursor:not-allowed; }
.game-action--primary { background:var(--game-acid,#d2fa72);border-color:var(--game-primary-border,var(--game-acid,#d2fa72));color:var(--game-primary-ink,#172016);box-shadow:var(--game-control-shadow,3px 3px 0 #090f0d); }
.game-action--primary:hover:not(:disabled) { background:var(--game-primary-hover,#e2ff9f);color:var(--game-primary-ink,#172016);border-color:var(--game-primary-border,var(--game-acid,#d2fa72)); }
.game-action--quiet { border-color:transparent;background:transparent;padding-inline:10px;box-shadow:none; }
.game-action--danger { color:var(--game-danger-ink,#ff9b8d);border-color:var(--game-danger-border,#86564e); }
.game-action--tab { position:relative;border:0;border-radius:0;color:var(--game-dim,#a8b2a9);font-size:13px;padding:12px 18px; }
.game-action--tab::after { content:'';position:absolute;bottom:0;left:18px;right:18px;height:3px;background:var(--game-acid,#d2fa72);transform:scaleX(0);transition:transform .3s; }
.game-action--tab.is-active { color:var(--game-cream,#f4f0df); }
.game-action--tab.is-active::after { transform:scaleX(1); }
.game-action--tab:hover:not(:disabled) { transform:none; }
.game-action.is-compact { padding:8px 12px;font-size:12px; }
.game-theme--pixel .game-action:hover:not(:disabled) { border-color:var(--game-line); }
.game-theme--pixel .game-action:active:not(:disabled) { transform:translate(3px,3px);box-shadow:none; }
.game-theme--pixel .game-action--quiet { box-shadow:none; }
.game-theme--pixel .game-action--tab { border:2px solid transparent;background:transparent;font-size:14px;padding:12px 20px;gap:10px;box-shadow:none; }
.game-theme--pixel .game-action--tab.is-active { background:var(--game-surface);border-color:var(--game-line);box-shadow:3px 3px 0 var(--game-line); }
.game-theme--pixel .game-action--tab::after { display:none; }
.game-theme--pixel .game-action--tab:active:not(:disabled) { transform:none; }
.game-theme--pixel .game-action.is-compact { font-size:13px; }
@media(max-width:600px) { .game-theme--pixel .game-action--tab { padding:10px 12px;gap:7px;font-size:13px;white-space:nowrap; } }
.game-action__spinner { width:15px;height:15px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:game-action-spin .8s linear infinite;flex-shrink:0; }
@keyframes game-action-spin { to { transform:rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { .game-action,.game-action::after { transition:none; }.game-action__spinner { animation:none; } }
</style>
