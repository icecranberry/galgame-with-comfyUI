<template>
  <!-- 签筒（daily_fortune）：摇一支，结果由当日种子决定，无需选择 -->
  <div class="bf-shrine">
    <div class="bf-tube" :class="{ 'is-shaking': busy }">
      <span v-for="n in 3" :key="n" class="bf-stick" :style="{ '--i': n }">签</span>
    </div>
    <p class="bf-widget-hint">诚心摇一支，今天的签文由神龛写就。</p>
  </div>
</template>

<script setup>
defineProps({ busy: { type: Boolean, default: false } })
</script>

<style scoped>
.bf-shrine { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 4px 0; }
.bf-tube {
  position: relative; width: 64px; height: 84px; border-radius: 10px 10px 16px 16px;
  background: linear-gradient(180deg, var(--accent-light, #e0a79a) 0%, var(--accent, #d97b6c) 100%);
  border: 2px solid var(--town-paper-ink, var(--text-primary));
  box-shadow: var(--shadow-hard-sm, 0 2px 0 rgba(0, 0, 0, 0.2));
  display: flex; align-items: flex-start; justify-content: center; gap: 4px; padding-top: 6px;
}
.bf-tube.is-shaking { animation: bf-shake 0.6s ease-in-out infinite; }
.bf-stick {
  width: 9px; height: 46px; border-radius: 4px; margin-top: calc(var(--i) * -4px);
  background: linear-gradient(180deg, #f3e2c0 0%, #d8bd8e 100%);
  border: 1px solid #6b5335;
  writing-mode: vertical-rl; text-align: center; font-size: 10px; line-height: 8px; color: #55432a;
}
@keyframes bf-shake {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-8deg) translateY(-2px); }
  75% { transform: rotate(8deg) translateY(-2px); }
}
.bf-widget-hint { font-size: 12px; opacity: 0.7; text-align: center; }
@media (prefers-reduced-motion: reduce) {
  .bf-tube.is-shaking { animation: none; }
}
</style>
