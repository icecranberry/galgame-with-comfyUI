<template>
  <div
    class="studio-button"
    :class="[`studio-button--${variant}`, `studio-button--${size}`, { 'is-disabled': disabled || loading, 'is-block': block, 'is-exposing': exposing, 'is-active': active, 'is-joined': joined }]"
    role="button"
    :tabindex="disabled || loading ? -1 : 0"
    :aria-disabled="disabled || loading || undefined"
    :aria-busy="loading || undefined"
    @click="activate"
    @keydown.enter.prevent="activate"
    @keydown.space.prevent
    @keyup.space.prevent="activate"
  >
    <span class="studio-button__content">
      <span v-if="loading" class="studio-button__spinner" aria-hidden="true" />
      <slot />
    </span>
    <Transition name="studio-button-badge">
      <span v-if="burstCount > 1" class="studio-button__burst" :aria-label="`连拍 ${burstCount} 张`">
        <svg class="studio-button__burst-ring" viewBox="0 0 64 40" preserveAspectRatio="none" aria-hidden="true">
          <path class="studio-button__burst-paper" d="M57 11C52 2 25 1 11 8C-2 14 1 29 14 34C30 41 56 35 61 24C64 17 59 8 48 6" />
          <path d="M52 4C36-1 10 4 5 16C0 28 18 37 38 36C49 36 59 31 61 26" />
        </svg>
        <span class="studio-button__burst-value">×{{ burstCount }}</span>
      </span>
    </Transition>
  </div>
</template>

<script setup>
const props = defineProps({
  variant: { type: String, default: 'secondary' },
  size: { type: String, default: 'md' },
  block: Boolean,
  disabled: Boolean,
  loading: Boolean,
  exposing: Boolean,
  active: Boolean,
  joined: Boolean,
  burstCount: { type: Number, default: 1 },
})
const emit = defineEmits(['click'])
function activate(event) {
  if (props.disabled || props.loading || event.repeat) return
  emit('click', event)
}
</script>

<style scoped>
.studio-button {
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  position:relative; min-height:44px; padding:10px 18px;
  border:1px solid var(--studio-ink); border-radius:2px;
  background:var(--studio-paper); color:var(--studio-ink);
  box-shadow:inset 0 -3px 0 color-mix(in srgb,var(--studio-ink) 12%,transparent);
  font:inherit; font-size:14px; font-weight:850; line-height:1.35; text-align:center;
  cursor:pointer; user-select:none; touch-action:manipulation;
  transition:transform .3s ease,box-shadow .3s ease,border-color .3s ease,color .3s ease;
}
.studio-button__content { display:inline-flex; align-items:center; justify-content:center; gap:9px; }
.studio-button__burst {
  position:absolute; z-index:1; top:-15px; right:10px; display:grid; place-items:center;
  min-width:44px; height:30px; padding:2px 8px; box-sizing:border-box;
  color:var(--studio-ink); transform:rotate(-10deg);
  font:italic 900 20px/1 'Trebuchet MS',Arial,sans-serif; letter-spacing:-.06em; white-space:nowrap; pointer-events:none;
}
.studio-button__burst-ring { position:absolute; inset:-3px -5px; width:calc(100% + 10px); height:calc(100% + 6px); overflow:visible; fill:none; stroke:var(--studio-tag); stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.studio-button__burst-paper { fill:var(--studio-paper); }
.studio-button__burst-ring path+path { stroke-width:1.2; opacity:.65; }
.studio-button__burst-value { position:relative; }
.studio-button-badge-enter-active,.studio-button-badge-leave-active { transition:opacity .3s ease,transform .3s ease; }
.studio-button-badge-enter-from,.studio-button-badge-leave-to { opacity:0; transform:translateY(5px) rotate(0deg) scale(.9); }
.studio-button--sm { padding:8px 12px; font-size:12px; }
.studio-button--compact { min-height:36px; padding:6px 4px; font-size:12px; }
@media(pointer:coarse) { .studio-button--compact { min-height:44px; } }
.studio-button--lg { min-height:52px; padding:12px 24px; font-size:17px; letter-spacing:-.02em; }
.studio-button--primary { border:0; border-radius:0; background:var(--studio-shutter); color:var(--studio-film); box-shadow:none; min-height:56px; padding-left:28px; }
.studio-button--primary::before { content:''; position:absolute; top:8px; bottom:8px; left:10px; border-left:2px dashed var(--studio-film); opacity:.45; }
.studio-button--primary.is-joined { padding-right:12px; white-space:nowrap; }
.studio-button--primary.is-joined .studio-button__content { gap:6px; }
@media(max-width:600px) { .studio-button--primary.is-joined { padding-left:22px; padding-right:8px; font-size:14px; } }
.studio-button--shutter-toggle { width:44px; min-height:56px; padding:8px; border:0; border-left:1px dashed color-mix(in srgb,var(--studio-film) 40%,transparent); border-radius:0; background:var(--studio-shutter); color:var(--studio-film); box-shadow:none; }
.studio-button--nav { color:var(--studio-ink); border:1px solid var(--studio-ink); background:var(--studio-paper); box-shadow:none; }
.studio-button--finish-entry { padding:8px 14px; border:2px solid var(--studio-ink); border-radius:0; background:var(--studio-shutter); color:var(--studio-film); box-shadow:3px 3px 0 var(--studio-ink); font-weight:950; }
.studio-button--finish-tab { flex:1; min-height:50px; border:0; border-bottom:3px solid var(--studio-line); border-radius:0; background:transparent; box-shadow:none; font-size:21px; font-weight:950; }
.studio-button--finish-tab.is-active { background:var(--studio-ink); color:var(--studio-paper); border-bottom-color:var(--studio-shutter); }
@media(max-width:760px) { .studio-button--finish-tab { min-height:40px; font-size:18px; } }

.studio-button--chip { padding:6px 12px; box-shadow:none; border-color:var(--studio-line); background:transparent; font-weight:750; }
.studio-button--secondary.studio-button--xs,.studio-button--chip.studio-button--xs { min-height:28px; padding:4px 10px; font-size:12px; }
.studio-button--chip.is-active { color:var(--studio-tag); border-color:var(--studio-tag); background:color-mix(in srgb,var(--studio-tag) 10%,var(--studio-paper)); box-shadow:inset 0 -2px 0 var(--studio-tag); }
.studio-button--ghost { background:transparent; box-shadow:none; }
.studio-button--link { padding:6px 4px; border:0; background:transparent; box-shadow:none; color:var(--studio-accent); text-decoration:underline; text-decoration-thickness:1px; text-underline-offset:5px; }
.studio-button--icon,.studio-button--icon-plain { width:44px; height:44px; padding:8px; border-radius:50%; }
.studio-button--icon-plain { border:0; background:transparent; box-shadow:none; }
.studio-button.is-block { width:100%; }
@media(hover:hover) { .studio-button:hover:not(.is-disabled) { transform:translateY(-1px); border-color:var(--studio-accent); }.studio-button--link:hover:not(.is-disabled) { color:var(--studio-ink); } }
.studio-button:active:not(.is-disabled) { transform:translateY(2px); box-shadow:inset 0 1px 3px var(--studio-shadow); }
.studio-button--link:active:not(.is-disabled),.studio-button--icon-plain:active:not(.is-disabled) { box-shadow:none; }
.studio-button:focus-visible { outline:2px solid var(--studio-accent); outline-offset:4px; }
.studio-button.is-disabled { opacity:.5; cursor:not-allowed; box-shadow:none; }
.studio-button__spinner { width:16px; height:16px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:studio-button-spin .8s linear infinite; }
@keyframes studio-button-spin { to { transform:rotate(360deg); } }
.studio-button.is-exposing { animation:studio-shutter-press .7s ease both; opacity:1; }
.studio-button.is-exposing .studio-button__content { animation:studio-shutter-label .7s ease both; }
@keyframes studio-shutter-press { 0%{transform:translateY(0) rotate(0)}18%{transform:translateY(4px) rotate(-2deg) scale(.97)}42%{transform:translateY(-2px) rotate(1deg)}65%,100%{transform:none} }
@keyframes studio-shutter-label { 0%,100%{transform:none}20%{transform:translateX(-3px)}38%{transform:translateX(2px)} }
@media(prefers-reduced-motion:reduce) { .studio-button,.studio-button-badge-enter-active,.studio-button-badge-leave-active { transition:none; }.studio-button__spinner { animation:none; } }
</style>
