<template>
  <article class="status-card" @click="$emit('select')">
    <div
      class="card-inner"
      :class="{ 'card-dim': char.is_sleeping }"
      @mouseenter="(e) => onEnter(e, char._description)"
      @mousemove="onMove"
      @mouseleave="onLeave"
    >
      <!-- 顶部：头像 + 名字 -->
      <div class="card-top">
        <div
          class="avatar-box"
          :style="char.avatar_path ? { backgroundImage: `url(${char.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: '#e07b6c' }"
        >
          <span v-if="!char.avatar_path" class="avatar-text">{{ char.display_name.charAt(0) }}</span>
        </div>
        <div class="name-row">
          <span class="char-name">{{ char.display_name }}</span>
          <span v-if="statusLabel" class="status-badge" :class="badgeClass">{{ statusLabel }}</span>
          <template v-if="!char.is_sleeping && char.tags && char.tags.length > 0">
            <span
              v-for="(tag, i) in char.tags.slice(0, 2).reverse()"
              :key="i"
              class="tag-badge"
              :class="i === 0 ? 'tag-green' : 'tag-orange'"
            >{{ tag }}</span>
          </template>
        </div>
      </div>

      <!-- 中部：地点 + 行为 -->
      <div class="card-mid">
        <div class="info-line">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>{{ char._location || '未知地点' }}</span>
        </div>
        <div class="info-line">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>{{ char._behavior || '暂无信息' }}</span>
        </div>
      </div>

      <!-- 右上角相机按钮（有日程才显示） -->
      <button v-if="char.tags?.length" class="peek-btn" @click.stop="$emit('peek')">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </button>

      <!-- 底部 -->
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
      :class="{ flip: tooltip.flip }"
      :style="tipStyle"
    >{{ tooltip.text }}</div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTooltip } from '../composables/useTooltip.js'

const props = defineProps<{
  char: any
}>()

defineEmits(['select', 'peek'])

const { tooltip, tipStyle, onEnter, onMove, onLeave } = useTooltip()

const statusMap: Record<string, { label: string; cls: string }> = {
  sleeping:  { label: '在梦乡', cls: 'badge-sleep' },
  delayed:   { label: '正忙',   cls: 'badge-busy' },
  available: { label: '',       cls: '' },
  event:     { label: '',       cls: '' },
}

const computedStatus = computed(() => {
  if (props.char.is_sleeping) return 'sleeping'
  if (props.char._hasEvent) return 'event'
  if (props.char.reply_delay > 0) return 'delayed'
  return 'available'
})

const statusLabel = computed(() => statusMap[computedStatus.value]?.label || '')
const badgeClass = computed(() => statusMap[computedStatus.value]?.cls || '')

const footnote = computed(() => {
  if (props.char.is_sleeping) {
    // 在梦乡中：显示 description，不显示起床时间
    return props.char._description || ''
  }
  if (props.char._description && props.char._description !== props.char._behavior) {
    return props.char._description
  }
  return ''
})
</script>

<style scoped>
.status-card {
  position: relative; display: flex;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 18px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
  box-shadow: var(--glass-shadow);
}

.status-card:hover {
  transform: translateY(-2px);
  border-color: #e0dbd4;
  box-shadow: 0 4px 24px rgba(0,0,0,0.05);
}

.card-inner {
  flex: 1; padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
  min-width: 0;
  position: relative;
}
.card-dim { opacity: 0.65; }

/* ── 右上角相机按钮 ── */
.peek-btn {
  position: absolute; top: 10px; right: 10px;
  display: flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 50%;
  border: none; background: transparent;
  color: var(--text-secondary); cursor: pointer;
  transition: all 0.2s;
  opacity: 0;
  padding: 7px 12px;
}
.status-card:hover .peek-btn { opacity: 1; }
.peek-btn:hover {
  background: rgba(224,123,108,0.08);
  color: var(--accent);
}

/* ── Top ── */
.card-top {
  display: flex; align-items: center; gap: 12px;
}

.avatar-box {
  width: 42px; height: 42px;
  border-radius: 50%; overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(0,0,0,0.06);
  display: flex; align-items: center; justify-content: center;
}
.avatar-text {
  color: #fff; font-size: 18px; font-weight: 600;
  line-height: 1; user-select: none;
}

.name-row {
  display: flex; align-items: center; gap: 8px;
  min-width: 0; flex: 1;
}
.char-name {
  font-size: 0.92rem; font-weight: 600; color: var(--text-bright);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.status-badge {
  font-size: 0.65rem; padding: 2px 8px; border-radius: 999px;
  font-weight: 600; white-space: nowrap; flex-shrink: 0;
}

.badge-busy   { background: rgba(224,123,108,0.1);  color: #c06858; }
.badge-sleep  { background: rgba(149,128,204,0.1);  color: #7c6db8; }

.tag-badge {
  font-size: 0.65rem; padding: 2px 8px; border-radius: 999px;
  font-weight: 600; white-space: nowrap; flex-shrink: 0;
}
.tag-green  { background: rgba(82,196,26,0.1);  color: #389e0d; }
.tag-orange { background: rgba(250,173,20,0.1); color: #d48806; }
.tag-overflow { background: rgba(0,0,0,0.04); color: var(--text-secondary); }

/* ── Mid ── */
.card-mid {
  display: flex; flex-direction: column; gap: 5px;
}
.info-line {
  display: flex; align-items: center; gap: 6px;
  font-size: 0.82rem; color: var(--text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.info-line svg { flex-shrink: 0; opacity: 0.4; color: var(--text-secondary); }

/* ── Foot ── */
.card-foot {
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 0.73rem; color: #c5bfb6; line-height: 1.5;
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
