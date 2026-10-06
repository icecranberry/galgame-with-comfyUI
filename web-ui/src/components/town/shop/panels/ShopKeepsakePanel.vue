<template>
  <!-- 明信片架（illustrated_keepsake）：款式（程序排版预览）+ 主题 -->
  <div class="bf-keepsake">
    <div class="bf-format-row">
      <button
        v-for="format in formats" :key="format" type="button"
        class="bf-format-chip" :class="{ 'is-picked': selectedFormat === format }"
        @click="emit('select-format', format)"
      >{{ formatLabel(format) }}</button>
    </div>
    <div class="bf-preview">
      <span class="bf-preview-frame" aria-hidden="true">
        <span class="bf-preview-lines">
          <i v-for="n in 3" :key="n" />
        </span>
        <span class="bf-preview-stamp">{{ selectedStampLabel }}</span>
      </span>
      <span class="bf-preview-hint">选中款式会按 {{ selectedStampLabel }} 版式排图文</span>
    </div>
    <div
      v-for="opt in options" :key="opt.key" role="button" tabindex="0"
      class="bf-frame-card is-compact" :class="{ 'is-picked': selectedOptionKey === opt.key }"
      @click="emit('select', opt.key)" @keydown.enter.prevent="emit('select', opt.key)"
      @keydown.space.prevent="emit('select', opt.key)"
    >
      <span class="bf-frame-label">{{ opt.label }}</span>
      <span class="bf-frame-scene">{{ opt.scene }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatLabel } from '../useShopFeature.js'

const props = defineProps({
  formats: { type: Array, default: () => ['postcard'] },
  selectedFormat: { type: String, default: 'postcard' },
  options: { type: Array, default: () => [] },
  selectedOptionKey: { type: String, default: '' },
})
const emit = defineEmits(['select-format', 'select'])
const selectedStampLabel = computed(() => formatLabel(props.selectedFormat))
</script>

<style scoped>
.bf-keepsake { display: flex; flex-direction: column; gap: 8px; }
.bf-format-row { display: flex; gap: 6px; }
.bf-format-chip {
  flex: 1; padding: 7px 0; border-radius: 999px; font-size: 12px; cursor: pointer;
  background: var(--side-panel-surface, var(--tint-subtle));
  border: 1.5px solid var(--town-paper-line, var(--border));
  color: var(--text-primary);
  transition: border-color 0.25s var(--ease-standard, ease), box-shadow 0.25s var(--ease-standard, ease), color 0.25s ease;
}
.bf-format-chip.is-picked {
  border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent);
  color: var(--accent-hover, var(--accent));
}
/* 程序排版预览：示意框不用真图，只示意款式版式 */
.bf-preview { display: flex; align-items: center; gap: 10px; }
.bf-preview-frame {
  position: relative; width: 96px; height: 64px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--side-panel-surface, var(--tint-subtle));
  border: 1.5px solid var(--town-paper-line, var(--border)); border-radius: 8px;
}
.bf-preview-lines { display: flex; flex-direction: column; gap: 5px; width: 56px; }
.bf-preview-lines i { display: block; height: 4px; border-radius: 2px; background: color-mix(in srgb, currentColor 18%, transparent); }
.bf-preview-lines i:nth-child(2) { width: 80%; }
.bf-preview-lines i:nth-child(3) { width: 60%; }
.bf-preview-stamp {
  position: absolute; right: 6px; bottom: 6px; padding: 1px 4px;
  font-size: 9px; border: 1px solid currentColor; border-radius: 3px; opacity: 0.7;
}
.bf-preview-hint { font-size: 11px; line-height: 1.5; opacity: 0.7; }
.bf-frame-card {
  display: flex; flex-direction: column; gap: 3px; padding: 9px 12px; border-radius: 10px; text-align: left;
  background: var(--side-panel-surface, var(--tint-subtle));
  border: 1.5px solid var(--town-paper-line, var(--border));
  color: var(--text-primary);
  cursor: pointer;
  transition: border-color 0.25s var(--ease-standard, ease), transform 0.25s var(--ease-standard, ease), box-shadow 0.25s var(--ease-standard, ease);
}
.bf-frame-card:hover { border-color: var(--accent); }
.bf-frame-card.is-picked { border-color: var(--accent); transform: translateY(-1px); box-shadow: 0 0 0 1px var(--accent); }
.bf-frame-card.is-compact { padding: 7px 10px; }
.bf-frame-label { font-size: 13px; font-weight: 600; }
.bf-frame-scene {
  font-size: 11px; line-height: 1.5; opacity: 0.7;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .bf-format-chip, .bf-frame-card { transition: none; }
}
</style>
