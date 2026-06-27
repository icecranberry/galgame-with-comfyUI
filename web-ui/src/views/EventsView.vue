<template>
  <div class="events-page" @scroll.passive="onScroll" ref="pageEl">
    <!-- 标题栏 -->
    <div class="events-topbar" ref="topbarEl">
      <div class="topbar-title">
        <span>奇遇</span>
        <span v-if="store.newEventCount > 0" class="topbar-badge">{{ store.newEventCount > 99 ? '99+' : store.newEventCount }}</span>
      </div>
      <button class="btn-post" @click="manualGenerate" :disabled="stirring">
        {{ stirring ? '扰动中' : '🎬 扰动世界线' }}
      </button>
    </div>

    <!-- 活跃事件瀑布流 -->
    <div class="events-content">
      <div v-if="store.loading" class="events-loading">
        <div class="loading-spinner-lg"></div>
        <span>加载中…</span>
      </div>

      <template v-else-if="store.filteredActive.length > 0">
        <div class="waterfall-row" :style="{ '--cols': colCount }">
          <div v-for="(col, ci) in activeColumns" :key="ci" class="waterfall-col">
            <EventCard
              v-for="evt in col"
              :key="evt.id"
              :event="evt"
              @updated="onEventUpdated"
            />
          </div>
        </div>
      </template>

      <div v-else class="events-empty">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
        </svg>
        <span>暂无奇遇</span>
        <span class="empty-hint">等待角色们的故事展开…</span>
      </div>
    </div>

    <!-- 往期奇遇 -->
    <div v-if="store.filteredHistory.length > 0" class="history-section">
      <div class="history-header" @click="showHistory = !showHistory">
        <span>📋 往期奇遇 ({{ store.filteredHistory.length }})</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
          :class="{ rotated: showHistory }">
          <polyline points="6,9 12,15 18,9" />
        </svg>
      </div>
      <Transition name="slide-down">
        <div v-if="showHistory" class="waterfall-row" :style="{ '--cols': colCount }">
          <div v-for="(col, ci) in historyColumns" :key="'hc_' + ci" class="waterfall-col">
            <EventCard
              v-for="eh in col"
              :key="'h_' + eh.id"
              :event="eh"
              :conclusion="eh._conclusion"
              compact
            />
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, inject } from 'vue'
import { useEventsStore } from '../stores/events.js'
import * as api from '../api/index.js'
import EventCard from '../components/EventCard.vue'

const store = useEventsStore()
const showHistory = ref(false)
const stirring = ref(false)
const pageEl = ref(null)
const topbarEl = ref(null)
const winWidth = ref(window.innerWidth)

function onResize() { winWidth.value = window.innerWidth }
onMounted(() => window.addEventListener('resize', onResize))
onUnmounted(() => window.removeEventListener('resize', onResize))

const colCount = computed(() => {
  if (winWidth.value >= 1400) return 4
  if (winWidth.value >= 1000) return 3
  if (winWidth.value >= 640) return 2
  return 1
})

function splitColumns(items, n) {
  const cols = Array.from({ length: n }, () => [])
  items.forEach((item, i) => cols[i % n].push(item))
  return cols
}

const activeColumns = computed(() => splitColumns(store.filteredActive, colCount.value))
const historyColCount = computed(() => Math.min(colCount.value + 1, 6))
const historyColumns = computed(() => splitColumns(normalizedHistory.value, historyColCount.value))

// 将 history 数据规范化为 event 结构，供 EventCard 复用
const normalizedHistory = computed(() => store.filteredHistory.map(h => ({
  id: h.id,
  character_id: h.character_id,
  display_name: h.display_name,
  avatar_path: h.avatar_path,
  event_type_key: h.event_type_key,
  title: h.title,
  description: h.description,
  image: h.final_image || null,
  choice_history: h.choice_history || [],
  current_branch: h.total_branches || 0,
  max_branches: h.total_branches || 0,
  summary: h.summary,
  engaged: h.engaged,
  expires_at: h.ended_at,  // 已结束，用于 isExpired 判定
  created_at: h.created_at,
  outcome: h.outcome,
  _conclusion: h.summary,
})))

const setTopbarVisible = inject?.('setTopbarVisible', null)

onMounted(async () => {
  store.isViewingEvents = true
  store.filterCharacterId = null
  await store.loadEvents()
  store.connectSSE()
})

onUnmounted(() => {
  store.isViewingEvents = false
  store.disconnectSSE()
})

watch(() => store.scrollToTopSignal, async () => {
  await store.loadEvents()
  if (pageEl.value) pageEl.value.scrollTop = 0
})

function onEventUpdated({ concluded }) {
  if (concluded) store.loadEvents()
}

async function manualGenerate() {
  if (stirring.value) return
  stirring.value = true
  try {
    const result = await api.generateEvent()
    if (result.error) { alert(result.error); return }
    store.loadEvents()
  } catch (err) {
    console.error('[EventsView] generate error:', err)
  } finally {
    stirring.value = false
  }
}

let lastScrollTop = 0
function onScroll() {
  if (!setTopbarVisible || !topbarEl.value) return
  const st = pageEl.value?.scrollTop || 0
  const direction = st > lastScrollTop ? 'down' : 'up'
  lastScrollTop = st
  setTopbarVisible(direction === 'up' || st <= 60)
}

</script>

<style scoped>
.events-page {
  flex: 1;
  min-height: 100vh; min-height: 100dvh;
  background: var(--bg-page);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 40px;
}

/* ── 标题栏 ── */
.events-topbar {
  position: sticky; top: 0; z-index: 20;
  background: rgba(255,255,255,0.78);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 24px;
  border-bottom: 1px solid rgba(0,0,0,0.05);
}
.topbar-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 700; color: var(--text-bright); }
.topbar-badge { font-size: 12px; background: var(--danger); color: #fff; min-width: 20px; height: 20px; border-radius: 10px; display: flex; align-items: center; justify-content: center; padding: 0 6px; }

/* 扰动世界线按钮 — 和朋友圈一致 */
.btn-post {
  padding: 8px 22px;
  border-radius: 14px;
  border: 2px solid transparent;
  background: linear-gradient(120deg, #f8edea 0%, #f2eaf4 35%, #eaf0f8 65%, #f8edea 100%);
  background-size: 200% 200%;
  color: var(--accent);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}
.btn-post:hover:not(:disabled) {
  border: 2px solid rgba(224, 123, 108, 0.55);
  box-shadow: 0 3px 20px rgba(224, 123, 108, 0.10);
  color: #a85545;
  animation: waterflow 1s ease-in-out infinite;
}
@keyframes waterflow {
  0%, 100% { background-position: 0% 50%; }
  50%      { background-position: 100% 50%; }
}
.btn-post:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── 瀑布流 ── */
.events-content { padding: 12px; }

.waterfall-row {
  display: flex; gap: 14px; align-items: flex-start;
}
.waterfall-col {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 14px;
}

.events-loading {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 80px 20px; color: var(--text-secondary);
}
.loading-spinner-lg { width: 32px; height: 32px; border: 3px solid rgba(224,123,108,0.15); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.events-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 80px 20px; color: var(--text-secondary); font-size: 15px;
}
.empty-hint { font-size: 13px; opacity: 0.5; }

/* ── 往期奇遇 ── */
.history-section { padding: 0 12px 24px; }
.history-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 4px; font-size: 14px; color: var(--text-secondary); cursor: pointer;
  border-top: 1px solid rgba(0,0,0,0.05);
}
.history-header svg { transition: transform 0.3s; }
.history-header svg.rotated { transform: rotate(180deg); }


.slide-down-enter-active, .slide-down-leave-active { transition: all 0.25s ease; overflow: hidden; }
.slide-down-enter-from, .slide-down-leave-to { opacity: 0; max-height: 0; }
.slide-down-enter-to, .slide-down-leave-from { opacity: 1; max-height: 800px; }

@media (max-width: 767px) {
  .events-content { padding: 8px; }
  .history-section { padding: 0 8px 20px; }
  .events-topbar { padding: 12px 14px; }
}
</style>
