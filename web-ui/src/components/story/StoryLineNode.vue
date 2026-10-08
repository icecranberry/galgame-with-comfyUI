<template>
  <!-- 事件线节点卡（T2 第二期）。
       ★ 节点=**事件线**，不是聊天楼层 —— 这是与「构画」的关键差别（用户已裁定）。
       卡上必须一次性交代：线名 / 阶段 / 是否锁定 / 涉及几个角色 / 推进时间。
       ⚠ 只用 `pointer-events: none` 之外的区域交给 vue-flow 处理拖拽。
       ⚠ 颜色一律走 CSS 变量（`--stage-*` 由 StoryView 定义，暗色主题同样适用），
         不硬编码浅色 —— 否则暗夜主题下整块不翻转（见 darkThemeReadability 测试）。 -->
  <div class="sg-node" :class="[`sg-stage-${stageKey}`, { 'is-terminal': data.terminal, 'is-busy': data.busy }]">
    <Handle v-for="h in handles" :key="h.id" type="target" :position="h.position" :id="h.id" class="sg-handle" />

    <div class="sg-node-head">
      <span class="sg-stage">{{ data.stage }}</span>
      <span v-if="data.pin" class="sg-badge sg-pin" title="已锁定：AI 不得改动这条线">已锁定</span>
      <span v-if="data.adult" class="sg-badge sg-adult">成人向</span>
      <span v-if="data.stall" class="sg-badge sg-stall" title="停滞">停滞</span>
    </div>

    <div class="sg-name" :title="data.name">{{ data.name }}</div>

    <div class="sg-meta">
      <span v-if="data.participantCount" title="涉及角色数">角色 {{ data.participantCount }}</span>
      <span v-if="data.placeCount" title="涉及地点数">地点 {{ data.placeCount }}</span>
      <span class="sg-flex"></span>
      <span v-if="data.when" class="sg-when" :title="data.when">{{ data.when }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps({
  data: { type: Object, required: true },
})

/** 阶段 → 样式键。未知阶段不崩（落到默认），与布局算法的容错同取向。 */
const stageKey = computed(() => {
  const map = { 起线: 'qi', 延展: 'yan', 成形: 'cheng', 收束: 'shou', 淡出: 'dan' }
  return map[String(props.data.stage || '')] || 'qi'
})

/** 四个方向的连接点，供连线吸附（上下为主 —— 布局是纵向分层的） */
const handles = [
  { id: 'sg-t', position: Position.Top },
  { id: 'sg-b', position: Position.Bottom },
  { id: 'sg-l', position: Position.Left },
  { id: 'sg-r', position: Position.Right },
]
</script>

<style scoped>
.sg-node {
  width: 196px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-primary);
  box-sizing: border-box;
  user-select: none;
}
.sg-node.is-terminal { opacity: 0.62; }
.sg-node.is-busy { outline: 2px solid var(--accent-solid); }
.sg-node-head { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.sg-stage {
  padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 600;
  border: 1px solid transparent;
}
.sg-badge { padding: 1px 6px; border-radius: 999px; font-size: 10px; }
.sg-pin { background: #FBEAF0; color: #993556; }
.sg-adult { background: #FAECE7; color: #993C1D; }
.sg-stall { background: #F1EFE8; color: #5F5E5A; }
/* 暗色主题下把浅色徽标压深，避免浅底浅字糊成一片 */
[data-theme="dark"] .sg-pin { background: #4B1528; color: #F4C0D1; }
[data-theme="dark"] .sg-adult { background: #4A1B0C; color: #F5C4B3; }
[data-theme="dark"] .sg-stall { background: #2C2C2A; color: #D3D1C7; }

.sg-name {
  margin-top: 6px; font-size: 13px; font-weight: 600; line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-word;
}
.sg-meta { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 11px; color: var(--text-secondary); }
.sg-flex { flex: 1; }
.sg-when { max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sg-stage-qi .sg-stage { background: #E6F1FB; color: #185FA5; }
.sg-stage-yan .sg-stage { background: #E1F5EE; color: #0F6E56; }
.sg-stage-cheng .sg-stage { background: #FAEEDA; color: #854F0B; }
.sg-stage-shou .sg-stage { background: #F1EFE8; color: #5F5E5A; }
.sg-stage-dan .sg-stage { background: #F1EFE8; color: #888780; }
[data-theme="dark"] .sg-stage-qi .sg-stage { background: #042C53; color: #B5D4F4; }
[data-theme="dark"] .sg-stage-yan .sg-stage { background: #04342C; color: #9FE1CB; }
[data-theme="dark"] .sg-stage-cheng .sg-stage { background: #412402; color: #FAC775; }
[data-theme="dark"] .sg-stage-shou .sg-stage { background: #2C2C2A; color: #D3D1C7; }
[data-theme="dark"] .sg-stage-dan .sg-stage { background: #2C2C2A; color: #B4B2A9; }

/* 连接点：默认不可见，但要有面积便于吸附 */
.sg-handle {
  width: 8px !important; height: 8px !important;
  background: var(--accent-solid) !important;
  border: none !important;
  opacity: 0.55;
}
</style>