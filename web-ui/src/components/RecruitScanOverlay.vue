<template>
  <div class="scan-overlay" role="status" aria-live="polite">
    <div class="scan-line" aria-hidden="true"></div>
    <span class="scan-text">{{ text }}</span>
  </div>
</template>

<script setup>
defineProps({ text: { type: String, required: true } })
</script>

<style scoped>
.scan-overlay {
  /* 铺满整个白色内衬（含内边距），模糊才不会在内容区边上截出一道硬边。 */
  position: absolute; inset: calc(-1 * var(--modal-lining-pad));
  background: transparent;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: var(--modal-lining-radius);
  display: flex; align-items: center; justify-content: center;
  z-index: 10; overflow: hidden;
}
.scan-line {
  position: absolute; left: 10%; right: 10%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  animation: scan-sweep 2s ease-in-out infinite;
  box-shadow: 0 0 24px rgba(var(--accent-rgb),0.6), 0 0 8px rgba(var(--accent-rgb),0.3);
}
@keyframes scan-sweep {
  0%   { top: 10%; opacity: 0.2; }
  25%  { top: 90%; opacity: 1; }
  50%  { top: 90%; opacity: 0.2; }
  75%  { top: 10%; opacity: 1; }
  100% { top: 10%; opacity: 0.2; }
}
.scan-text {
  font-size: 14px; color: var(--accent); font-weight: 600;
  animation: scan-pulse 1.2s ease-in-out infinite;
  text-shadow: 0 0 12px rgba(var(--accent-rgb),0.3);
}
@keyframes scan-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.97); }
  50%      { opacity: 1;   transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .scan-line, .scan-text { animation: none; }
  .scan-line { top: 15%; }
}
</style>
