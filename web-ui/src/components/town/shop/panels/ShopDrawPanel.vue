<template>
  <!-- 抽奖机（pool_draw）：奖池格子翻转 + 抽一次；库存为 0 的奖品格置灰 -->
  <div class="bf-machine">
    <div class="bf-pool" :class="{ 'is-spinning': busy }">
      <div v-for="(opt, i) in prizes" :key="opt.key" class="bf-prize" :class="{ 'is-sold-out': stockLeft(opt) === 0 }" :style="{ '--i': i + 1 }">
        <span class="bf-prize-name">{{ opt.label }}</span>
        <span v-if="stockLeft(opt) !== null" class="bf-prize-stock" :class="{ 'is-empty': stockLeft(opt) === 0 }">
          {{ stockLeft(opt) === 0 ? '已空' : `剩 ${stockLeft(opt)}` }}
        </span>
      </div>
    </div>
    <p class="bf-widget-hint" aria-live="polite">
      {{ busy ? '转盘转动中…' : '投币转一次，抽中的直接拿走。' }}
    </p>
  </div>
</template>

<script setup>
const props = defineProps({
  prizes: { type: Array, default: () => [] },
  // { [resourceKey]: 可售件数 }；视图未带库存时为 null，不显示剩余数
  stock: { type: Object, default: null },
  busy: { type: Boolean, default: false },
})
function stockLeft(opt) {
  if (!props.stock || !(opt.key in props.stock)) return null
  return props.stock[opt.key]
}
</script>

<style scoped>
.bf-machine { display: flex; flex-direction: column; gap: 8px; }
.bf-pool { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; }
.bf-prize {
  display: flex; flex-direction: column; gap: 2px; align-items: center;
  padding: 12px 6px; border-radius: 10px; text-align: center;
  background: var(--side-panel-surface, var(--tint-subtle));
  border: 1.5px solid var(--town-paper-line, var(--border));
  animation-delay: calc(var(--i) * 0.07s);
}
.bf-prize.is-sold-out { opacity: 0.55; filter: grayscale(0.8); }
.bf-pool.is-spinning .bf-prize { animation: bf-spin 0.8s linear infinite; }
@keyframes bf-spin { 0% { transform: rotateY(0deg); } 100% { transform: rotateY(360deg); } }
.bf-prize-name { font-size: 12px; color: var(--text-primary); }
.bf-prize-stock { font-size: 10px; opacity: 0.7; font-variant-numeric: tabular-nums; }
.bf-prize-stock.is-empty { color: var(--accent-hover, #b4443c); opacity: 0.9; }
.bf-widget-hint { font-size: 12px; opacity: 0.7; text-align: center; }
@media (prefers-reduced-motion: reduce) {
  .bf-pool.is-spinning .bf-prize { animation: none; }
}
</style>
