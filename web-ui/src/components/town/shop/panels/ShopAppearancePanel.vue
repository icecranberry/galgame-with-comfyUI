<template>
  <!-- 造型台（外观四件套）：衣柜格子 = 品类徽章 + 名称 + appearance 描述节选，选中高亮 -->
  <div v-if="options.length" class="bf-wardrobe">
    <div
      v-for="opt in options" :key="opt.key" role="button" tabindex="0"
      class="bf-wardrobe-card" :class="{ 'is-picked': selectedOptionKey === opt.key }"
      @click="emit('select', opt.key)" @keydown.enter.prevent="emit('select', opt.key)"
      @keydown.space.prevent="emit('select', opt.key)"
    >
      <span class="bf-wardrobe-head">
        <span v-if="categoryLabel" class="bf-wardrobe-badge">{{ categoryLabel }}</span>
        <span class="bf-wardrobe-label">{{ opt.label }}</span>
      </span>
      <span v-if="detail(opt)" class="bf-wardrobe-desc">{{ detail(opt) }}</span>
    </div>
  </div>
</template>

<script setup>
import { excerptOf, optionDetailOf } from '../useShopFeature.js'

const props = defineProps({
  options: { type: Array, default: () => [] },
  // 编译参数：options[].appearance 提供描述节选
  params: { type: Object, default: null },
  // 服务品类（【服装】【发型】等），来自建筑功能视图
  categoryLabel: { type: String, default: '' },
  selectedOptionKey: { type: String, default: '' },
})
const emit = defineEmits(['select'])

function detail(opt) {
  return excerptOf(optionDetailOf(props.params, opt.key, 'appearance'))
}
</script>

<style scoped>
.bf-wardrobe { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
.bf-wardrobe-card {
  display: flex; flex-direction: column; gap: 3px; padding: 10px; border-radius: 10px; text-align: left;
  background: var(--side-panel-surface, var(--tint-subtle));
  border: 1.5px solid var(--town-paper-line, var(--border));
  color: var(--text-primary);
  cursor: pointer;
  transition: border-color 0.25s var(--ease-standard, ease), transform 0.25s var(--ease-standard, ease), box-shadow 0.25s var(--ease-standard, ease);
}
.bf-wardrobe-card:hover { border-color: var(--accent); }
.bf-wardrobe-card.is-picked { border-color: var(--accent); transform: translateY(-1px); box-shadow: 0 0 0 1px var(--accent); }
.bf-wardrobe-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.bf-wardrobe-badge {
  flex-shrink: 0; padding: 1px 6px; font-size: 10px; font-weight: 700;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent-hover, var(--accent));
  border-radius: 4px;
}
.bf-wardrobe-label { font-size: 13px; font-weight: 600; }
.bf-wardrobe-desc { font-size: 11px; line-height: 1.5; opacity: 0.7; }
</style>
