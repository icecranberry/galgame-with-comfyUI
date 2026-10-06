<template>
  <!-- 货架（item_purchase）：木牌格子商品卡，缺货格置灰不可点 -->
  <div v-if="mode === 'purchase'" class="bf-shelf is-grid">
    <div
      v-for="opt in options" :key="opt.key" role="button" tabindex="0"
      class="bf-shelf-row is-cell" :class="{ 'is-picked': selectedOptionKey === opt.key, 'is-sold-out': soldOut(opt) }"
      :aria-disabled="soldOut(opt) || undefined"
      @click="pick(opt)" @keydown.enter.prevent="pick(opt)" @keydown.space.prevent="pick(opt)"
    >
      <span class="bf-cell-icon" aria-hidden="true">{{ iconOf(opt) }}</span>
      <span class="bf-cell-name">{{ opt.label }}</span>
      <span class="bf-cell-price">{{ opt.hint || '免费' }}</span>
      <span v-if="stockLeft(opt) !== null" class="bf-cell-stock" :class="{ 'is-empty': stockLeft(opt) === 0 }">
        {{ stockLeft(opt) === 0 ? '已售罄' : `剩 ${stockLeft(opt)}` }}
      </span>
    </div>
  </div>

  <!-- 兑换台（item_exchange）：用你的 X 换 Y（物品下拉在外壳，这里给换向预览） -->
  <div v-else-if="mode === 'exchange'" class="bf-swap">
    <div class="bf-swap-side">
      <span class="bf-swap-title">你给出</span>
      <div class="bf-swap-give" :class="{ 'is-empty': !selectedItemName }">{{ selectedItemName || '先从背包挑一件' }}</div>
    </div>
    <span class="bf-swap-arrow" aria-hidden="true">⇄</span>
    <div class="bf-swap-side">
      <span class="bf-swap-title">你换到</span>
      <div
        v-for="opt in options" :key="opt.key" role="button" tabindex="0"
        class="bf-swap-item" :class="{ 'is-picked': selectedOptionKey === opt.key }"
        @click="emit('select', opt.key)" @keydown.enter.prevent="emit('select', opt.key)"
        @keydown.space.prevent="emit('select', opt.key)"
      >{{ opt.label }}</div>
    </div>
  </div>

  <!-- 收购单（item_recycle）：选要出售的物品 + 预计报价 -->
  <div v-else class="bf-buyback">
    <span class="bf-field-label">挑一件不要的，{{ tierHint }}收购：</span>
    <span v-if="estimatePrice != null && estimatePrice > 0" class="bf-buyback-estimate" aria-live="polite">
      预计报价 {{ estimatePrice }} 金币
    </span>
  </div>
</template>

<script setup>
const props = defineProps({
  // purchase / exchange / recycle
  mode: { type: String, required: true },
  options: { type: Array, default: () => [] },
  // { [resourceKey]: 可售件数 }；视图未带库存时为 null，不置灰（避免加载中全部误灰）
  stock: { type: Object, default: null },
  selectedOptionKey: { type: String, default: '' },
  selectedItemName: { type: String, default: '' },
  tierHint: { type: String, default: '按行情' },
  estimatePrice: { type: Number, default: null },
})
const emit = defineEmits(['select'])

function stockLeft(opt) {
  if (!props.stock || !(opt.key in props.stock)) return null
  return props.stock[opt.key]
}
function soldOut(opt) { return stockLeft(opt) === 0 }
function iconOf(opt) { return String(opt.label || '货').trim().slice(0, 1) || '货' }
function pick(opt) {
  if (soldOut(opt)) return
  emit('select', opt.key)
}
</script>

<style scoped>
/* 卡片公共底：格子货架 / 交换档共用 */
.bf-shelf-row.is-cell, .bf-swap-item {
  background: var(--side-panel-surface, var(--tint-subtle));
  border: 1.5px solid var(--town-paper-line, var(--border));
  color: var(--text-primary);
  cursor: pointer;
  transition: border-color 0.25s var(--ease-standard, ease), transform 0.25s var(--ease-standard, ease), box-shadow 0.25s var(--ease-standard, ease);
}
.bf-shelf-row.is-cell:hover, .bf-swap-item:hover { border-color: var(--accent); }
.bf-shelf-row.is-cell.is-picked, .bf-swap-item.is-picked {
  border-color: var(--accent);
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px var(--accent);
}

/* ── 货架（purchase）：格子商品卡 ── */
.bf-shelf.is-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.bf-shelf-row.is-cell {
  display: flex; flex-direction: column; align-items: stretch; gap: 4px;
  padding: 10px; border-radius: 10px; text-align: left;
}
.bf-shelf-row.is-cell.is-sold-out { opacity: 0.55; filter: grayscale(0.8); cursor: not-allowed; }
.bf-shelf-row.is-cell.is-sold-out.is-picked { border-color: var(--town-paper-line, var(--border)); transform: none; box-shadow: none; }
.bf-cell-icon {
  width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
  border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 6px; font-size: 16px; font-weight: 700; background: #ffffff40;
}
.bf-cell-name { font-size: 13px; color: var(--text-primary); }
.bf-cell-price { font-size: 11px; color: var(--accent-hover, var(--accent)); font-variant-numeric: tabular-nums; }
.bf-cell-stock { font-size: 10px; opacity: 0.7; font-variant-numeric: tabular-nums; }
.bf-cell-stock.is-empty { color: var(--accent-hover, #b4443c); opacity: 0.9; }

/* ── 兑换台（exchange） ── */
.bf-swap { display: flex; align-items: stretch; gap: 8px; }
.bf-swap-side { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.bf-swap-title { font-size: 12px; opacity: 0.7; }
.bf-swap-give { padding: 8px 10px; border-radius: 10px; font-size: 12px; background: var(--side-panel-surface, var(--tint-subtle)); border: 1.5px dashed var(--town-paper-line, var(--border)); color: var(--text-primary); }
.bf-swap-give.is-empty { color: var(--text-primary); opacity: 0.55; }
.bf-swap-arrow { align-self: center; font-size: 18px; color: var(--accent); }
.bf-swap-item { padding: 8px 10px; border-radius: 10px; font-size: 12px; }

/* ── 收购单（recycle） ── */
.bf-buyback { display: flex; flex-direction: column; gap: 4px; }
.bf-buyback-estimate { font-size: 12px; color: var(--accent-hover, var(--accent)); font-variant-numeric: tabular-nums; }
</style>
