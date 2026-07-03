<template>
  <article
    class="status-card"
    :class="[statusClass, { 'is-active': active }]"
    @click="$emit('select')"
  >
    <!-- 左侧状态竖条 -->
    <div class="card-accent"></div>

    <!-- 内容 -->
    <div
      class="card-inner"
      @mouseenter="(e) => onEnter(e, char._description)"
      @mousemove="onMove"
      @mouseleave="onLeave"
    >
      <!-- 顶部：头像 + 名字 + 状态标签 -->
      <div class="card-top">
        <div class="avatar-box">
          <img
            :src="char.avatar_path || '/avatars/default.png'"
            :alt="char.display_name"
            @error="($event.target as HTMLImageElement).src = '/avatars/default.png'"
          />
        </div>
        <div class="name-row">
          <span class="char-name">{{ char.display_name }}</span>
          <span class="status-badge" :class="badgeClass">{{ statusLabel }}</span>
        </div>
      </div>

      <!-- 中部：地点 + 行为摘要 -->
      <div class="card-mid">
        <div class="info-line location-line">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>{{ char._location || '未知地点' }}</span>
        </div>
        <div class="info-line activity-line">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>{{ char._behavior || '暂无信息' }}</span>
        </div>
      </div>

      <!-- 底部：辅助信息 -->
      <div class="card-foot" v-if="footnote">
        <span>{{ footnote }}</span>
      </div>
    </div>
  </article>

  <!-- Tooltip -->
  <Teleport to="body">
    <div
      v-if="tooltip.show"
      class="hover-tip"
      :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
    >{{ tooltip.text }}</div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTooltip } from '../composables/useTooltip.js'

const props = defineProps<{
  char: any
  active?: boolean
}>()

defineEmits(['select'])

const { tooltip, onEnter, onMove, onLeave } = useTooltip()

const statusMap: Record<string, { label: string; cls: string }> = {
  sleeping:  { label: '睡眠中', cls: 'badge-sleep' },
  delayed:   { label: '忙碌中', cls: 'badge-busy' },
  available: { label: '空闲',   cls: 'badge-idle' },
  event:     { label: '事件中', cls: 'badge-event' },
}

const computedStatus = computed(() => {
  if (props.char.is_sleeping) return 'sleeping'
  if (props.char._hasEvent) return 'event'
  if (props.char.reply_delay > 0) return 'delayed'
  return 'available'
})

const statusLabel = computed(() => statusMap[computedStatus.value]?.label || '未知')
const badgeClass = computed(() => statusMap[computedStatus.value]?.cls || 'badge-idle')
const statusClass = computed(() => 'st-' + computedStatus.value)

const footnote = computed(() => {
  if (props.char.is_sleeping) {
    return props.char.sleep_until ? `预计 ${props.char.sleep_until.slice(11,16)} 醒来` : '睡眠中'
  }
  if (props.char.reply_delay > 0) {
    return `${props.char.reply_delay} 分钟后可联系`
  }
  if (props.char._nextActivity) {
    return `接下来：${props.char._nextActivity}`
  }
  return '现在发消息可能秒回'
})
</script>

<style scoped>
.status-card {
  position: relative;
  display: flex;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
  box-shadow: var(--glass-shadow);
}

.status-card:hover {
  transform: translateY(-2px);
  border-color: #d5d0ca;
  box-shadow: 0 4px 20px rgba(0,0,0,0.06);
}

.status-card.is-active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(224,123,108,0.15);
}

/* ── 状态竖条 ── */
.card-accent {
  width: 4px;
  flex-shrink: 0;
  background: transparent;
  transition: background 0.2s;
}

.st-available .card-accent { background: #b7eb8f; }
.st-delayed  .card-accent { background: #ffe58f; }
.st-sleeping .card-accent { background: #d9d9d9; }
.st-event    .card-accent { background: #d3adf7; }

.card-inner {
  flex: 1;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* ── Top ── */
.card-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar-box {
  width: 38px; height: 38px;
  border-radius: 50%; overflow: hidden;
  flex-shrink: 0;
}
.avatar-box img { width: 100%; height: 100%; object-fit: cover; display: block; }

.name-row {
  display: flex; align-items: center; gap: 8px;
  min-width: 0; flex: 1;
}
.char-name {
  font-size: 0.9rem; font-weight: 600; color: var(--text-bright);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.status-badge {
  font-size: 0.68rem; padding: 2px 8px; border-radius: 999px;
  font-weight: 600; white-space: nowrap; flex-shrink: 0;
}

.badge-idle   { background: rgba(82,196,26,0.1);  color: #389e0d; }
.badge-busy   { background: rgba(250,173,20,0.12); color: #ad6800; }
.badge-sleep  { background: rgba(140,128,116,0.08); color: #8c8074; }
.badge-event  { background: rgba(179,136,255,0.1);  color: #722ed1; }

/* ── Mid ── */
.card-mid {
  display: flex; flex-direction: column; gap: 4px;
}
.info-line {
  display: flex; align-items: center; gap: 5px;
  font-size: 0.8rem; color: var(--text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.info-line svg { flex-shrink: 0; opacity: 0.45; }

/* ── Foot ── */
.card-foot {
  padding-top: 6px;
  border-top: 1px solid var(--border);
  font-size: 0.72rem; color: #bfbbb6;
}

/* ── Tooltip ── */
.hover-tip {
  position: fixed; z-index: 2000; pointer-events: none;
  max-width: 260px; padding: 6px 12px;
  background: rgba(40,40,40,0.88); color: #f0f0f0;
  border-radius: 8px; font-size: 0.78rem; line-height: 1.5;
  box-shadow: 0 4px 14px rgba(0,0,0,0.18);
  backdrop-filter: blur(6px);
}
</style>
