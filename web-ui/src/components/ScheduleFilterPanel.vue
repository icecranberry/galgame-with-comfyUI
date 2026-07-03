<template>
  <aside class="filter-panel">
    <!-- 标题 + 时间 -->
    <div class="panel-header">
      <h2 class="panel-title">角色日程</h2>
      <p class="panel-time">{{ timeText }}</p>
    </div>

    <!-- 状态汇总 -->
    <div class="panel-summary">
      <div class="sum-item" v-for="s in summaries" :key="s.key" @click="$emit('filter', s.key)">
        <span class="sum-dot" :style="{ background: s.color }"></span>
        <span class="sum-n">{{ s.count }}</span>
        <span class="sum-label">{{ s.label }}</span>
      </div>
    </div>

    <!-- 搜索 -->
    <div class="panel-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input
        v-model="searchText"
        type="text"
        placeholder="搜索角色..."
        @input="$emit('search', searchText)"
      />
    </div>

    <!-- 筛选胶囊 -->
    <div class="panel-chips">
      <button
        v-for="f in filters"
        :key="f.key"
        class="chip"
        :class="{ active: activeFilter === f.key }"
        @click="$emit('filter', f.key)"
      >{{ f.label }}</button>
    </div>

    <!-- 角色状态列表 -->
    <div class="panel-list">
      <div
        v-for="c in characters"
        :key="c.id"
        class="list-item"
        :class="{ active: activeCharId === c.id }"
        @click="$emit('select-char', c.id)"
      >
        <div class="li-avatar">
          <img
            :src="c.avatar_path || '/avatars/default.png'"
            @error="($event.target as HTMLImageElement).src = '/avatars/default.png'"
          />
          <span class="li-dot" :class="dotClass(c)"></span>
        </div>
        <div class="li-info">
          <span class="li-name">{{ c.display_name }}</span>
          <span class="li-status">{{ statusText(c) }}</span>
        </div>
        <span class="li-summary">{{ activitySummary(c) }}</span>
      </div>

      <div v-if="characters.length === 0" class="list-empty">
        无匹配角色
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  characters: any[]
  activeCharId: number | null
  activeFilter: string
}>()

defineEmits(['filter', 'search', 'select-char'])

const searchText = ref('')

const WD = ['周日','周一','周二','周三','周四','周五','周六']
const now = new Date()
const timeText = `${WD[now.getDay()]} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`

const available = computed(() => props.characters.filter(c => !c.is_sleeping && c.reply_delay === 0).length)
const busy = computed(() => props.characters.filter(c => !c.is_sleeping && c.reply_delay > 0).length)
const sleeping = computed(() => props.characters.filter(c => c.is_sleeping).length)

const summaries = [
  { key: 'all',       label: '全部', count: props.characters.length, color: '#8c8074' },
  { key: 'available', label: '空闲', count: available.value,         color: '#52c41a' },
  { key: 'delayed',   label: '忙碌', count: busy.value,             color: '#faad14' },
  { key: 'sleeping',  label: '睡眠', count: sleeping.value,         color: '#bfbfbf' },
]

const filters = [
  { key: 'all',       label: '全部' },
  { key: 'available', label: '可互动' },
  { key: 'idle',      label: '空闲' },
  { key: 'delayed',   label: '外出中' },
  { key: 'busy2',     label: '忙碌中' },
  { key: 'sleeping',  label: '睡眠中' },
]

function dotClass(c: any) {
  if (c.is_sleeping) return 'd-sleep'
  if (c.reply_delay > 0) return 'd-busy'
  return 'd-idle'
}

function statusText(c: any) {
  if (c.is_sleeping) return '睡眠中'
  if (c.reply_delay > 0) return '外出中'
  return '空闲'
}

function activitySummary(c: any) {
  const a = c.current_activity || ''
  // 去掉地点前缀，只保留简短摘要
  return a.length > 10 ? a.slice(0, 10) + '...' : a
}
</script>

<style scoped>
.filter-panel {
  width: 270px; flex-shrink: 0;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--border);
  background: rgba(255,255,255,0.35);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  overflow: hidden;
}

/* ── Header ── */
.panel-header {
  padding: 18px 18px 6px;
}
.panel-title {
  margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--text-bright);
}
.panel-time {
  margin: 3px 0 0; font-size: 0.8rem; color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* ── Summary ── */
.panel-summary {
  display: flex; gap: 12px; padding: 10px 18px;
  border-bottom: 1px solid var(--border);
}
.sum-item {
  display: flex; align-items: center; gap: 4px;
  cursor: pointer; font-size: 0.75rem; color: var(--text-secondary);
  transition: color 0.15s;
}
.sum-item:hover { color: var(--text-bright); }
.sum-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.sum-n { font-weight: 700; color: var(--text-bright); }

/* ── Search ── */
.panel-search {
  display: flex; align-items: center; gap: 6px;
  margin: 10px 14px; padding: 7px 10px;
  background: var(--glass-bg); border: 1px solid var(--glass-border);
  border-radius: 10px;
}
.panel-search svg { flex-shrink: 0; color: var(--text-secondary); opacity: 0.5; }
.panel-search input {
  flex: 1; border: none; outline: none; background: transparent;
  font-size: 0.8rem; color: var(--text-primary);
}
.panel-search input::placeholder { color: #bfbbb6; }

/* ── Filter Chips ── */
.panel-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 6px 14px 10px;
}
.chip {
  padding: 4px 11px; border: 1px solid var(--border);
  border-radius: 999px; background: var(--glass-bg);
  font-size: 0.72rem; color: var(--text-secondary); cursor: pointer;
  transition: all 0.15s;
}
.chip:hover { background: var(--bg-hover); color: var(--text-bright); }
.chip.active {
  background: var(--accent); color: #fff; border-color: var(--accent);
}

/* ── Character List ── */
.panel-list {
  flex: 1; overflow-y: auto; padding: 4px 0;
}
.list-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 18px; cursor: pointer;
  transition: background 0.12s;
  border-left: 3px solid transparent;
}
.list-item:hover { background: var(--bg-hover); }
.list-item.active {
  background: rgba(224,123,108,0.06);
  border-left-color: var(--accent);
}

.li-avatar {
  position: relative; width: 36px; height: 36px; flex-shrink: 0;
}
.li-avatar img {
  width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;
}
.li-dot {
  position: absolute; bottom: -1px; right: -1px;
  width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid #fff;
}
.d-idle  { background: #52c41a; }
.d-busy  { background: #faad14; }
.d-sleep { background: #bfbfbf; }

.li-info {
  display: flex; flex-direction: column; min-width: 0; flex: 1;
}
.li-name {
  font-size: 0.85rem; font-weight: 600; color: var(--text-bright);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.li-status {
  font-size: 0.7rem; color: var(--text-secondary);
  margin-top: 1px;
}
.li-summary {
  font-size: 0.7rem; color: #bfbbb6;
  max-width: 70px; text-align: right;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.list-empty {
  text-align: center; padding: 24px;
  font-size: 0.82rem; color: var(--text-secondary);
}

/* ── Responsive ── */
@media (max-width: 767px) {
  .filter-panel {
    width: 100%; flex-shrink: 0; flex-direction: column;
    max-height: 220px; border-right: none; border-bottom: 1px solid var(--border);
  }
  .panel-list {
    display: flex; flex-direction: row; overflow-x: auto; overflow-y: hidden;
    padding: 4px 8px; gap: 4px;
  }
  .list-item {
    flex-shrink: 0; flex-direction: column; gap: 2px;
    padding: 8px 10px; text-align: center; border-left: none;
    border-bottom: 3px solid transparent; min-width: 56px;
  }
  .list-item.active { border-left: none; border-bottom-color: var(--accent); }
  .li-summary { display: none; }
  .panel-chips { display: none; }
}
</style>
