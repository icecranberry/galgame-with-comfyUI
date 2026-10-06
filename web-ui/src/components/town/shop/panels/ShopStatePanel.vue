<template>
  <!-- 状态台（temporary_state）：BUFF 文字卡，选一项语气状态 + 时长 -->
  <div v-if="options.length" class="bf-state">
    <div
      v-for="opt in options" :key="opt.key" role="button" tabindex="0"
      class="bf-state-card" :class="{ 'is-picked': selectedOptionKey === opt.key }"
      @click="emit('select', opt.key)" @keydown.enter.prevent="emit('select', opt.key)"
      @keydown.space.prevent="emit('select', opt.key)"
    >
      <span class="bf-state-head">
        <span class="bf-state-label">{{ opt.label }}</span>
        <span v-if="durationHours" class="bf-state-duration">{{ durationHours }} 小时</span>
      </span>
      <span v-if="detail(opt)" class="bf-state-flavor">{{ detail(opt) }}</span>
    </div>
  </div>
</template>

<script setup>
import { excerptOf, optionDetailOf } from '../useShopFeature.js'

const props = defineProps({
  options: { type: Array, default: () => [] },
  // 编译参数：options[].flavor 提供风味描述
  params: { type: Object, default: null },
  durationHours: { type: Number, default: null },
  selectedOptionKey: { type: String, default: '' },
})
const emit = defineEmits(['select'])

function detail(opt) {
  return excerptOf(optionDetailOf(props.params, opt.key, 'flavor'))
}
</script>

<style scoped>
.bf-state { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.bf-state-card {
  display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border-radius: 10px; text-align: left;
  background: var(--side-panel-surface, var(--tint-subtle));
  border: 1.5px solid var(--town-paper-line, var(--border));
  color: var(--text-primary);
  cursor: pointer;
  transition: border-color 0.25s var(--ease-standard, ease), transform 0.25s var(--ease-standard, ease), box-shadow 0.25s var(--ease-standard, ease);
}
.bf-state-card:hover { border-color: var(--accent); }
.bf-state-card.is-picked { border-color: var(--accent); transform: translateY(-1px); box-shadow: 0 0 0 1px var(--accent); }
.bf-state-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
.bf-state-label { font-size: 13px; font-weight: 600; }
.bf-state-duration {
  flex-shrink: 0; font-size: 10px; font-variant-numeric: tabular-nums;
  padding: 1px 6px; border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent-hover, var(--accent));
}
.bf-state-flavor { font-size: 11px; line-height: 1.5; opacity: 0.7; }
</style>
