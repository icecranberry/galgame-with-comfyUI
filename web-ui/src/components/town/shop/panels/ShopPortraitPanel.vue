<template>
  <!-- 取景框（portrait_single / portrait_pair）：主题卡 = 拍摄主题 + 画面场景摘录 -->
  <div v-if="options.length" class="bf-frames">
    <div
      v-for="opt in options" :key="opt.key" role="button" tabindex="0"
      class="bf-frame-card" :class="{ 'is-picked': selectedOptionKey === opt.key }"
      @click="emit('select', opt.key)" @keydown.enter.prevent="emit('select', opt.key)"
      @keydown.space.prevent="emit('select', opt.key)"
    >
      <span class="bf-frame-label">{{ opt.label }}</span>
      <span class="bf-frame-scene">{{ opt.scene }}</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  options: { type: Array, default: () => [] },
  selectedOptionKey: { type: String, default: '' },
})
const emit = defineEmits(['select'])
</script>

<style scoped>
.bf-frames { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; }
.bf-frame-card {
  display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border-radius: 10px; text-align: left;
  background: var(--side-panel-surface, var(--tint-subtle));
  border: 1.5px solid var(--town-paper-line, var(--border));
  color: var(--text-primary);
  cursor: pointer;
  transition: border-color 0.25s var(--ease-standard, ease), transform 0.25s var(--ease-standard, ease), box-shadow 0.25s var(--ease-standard, ease);
}
.bf-frame-card:hover { border-color: var(--accent); }
.bf-frame-card.is-picked { border-color: var(--accent); transform: translateY(-1px); box-shadow: 0 0 0 1px var(--accent); }
.bf-frame-label { font-size: 13px; font-weight: 600; }
.bf-frame-scene {
  font-size: 11px; line-height: 1.5; opacity: 0.7;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
</style>
