<template>
  <div class="events-page" @scroll.passive="onScroll" @wheel.passive="onPageWheel" ref="pageEl">
    <!-- 标题栏 -->
    <div class="events-topbar" ref="topbarEl">
      <div class="topbar-title">
        <span>奇遇</span>
      </div>
      <button class="btn-post" @click.stop="showPicker = !showPicker" :disabled="stirring">
        {{ stirring ? '扰动中' : '🎬 扰动世界线' }}
      </button>
    </div>

    <!-- 角色选择器 -->
    <Transition name="picker-fade">
      <div v-if="showPicker" ref="pickerRef" class="picker-dropdown" @click.stop>
        <div class="picker-title">选择触发奇遇的角色：</div>
        <div v-for="c in characters" :key="c.id" class="picker-item" @click="triggerGenerate(c)">
          <div class="picker-avatar" :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: '#e07b6c' }">
            {{ c.avatar_path ? '' : c.display_name?.charAt(0) }}
          </div>
          <span>{{ c.display_name }}</span>
        </div>
      </div>
    </Transition>

    <!-- 自定义事件弹窗 -->
    <Transition name="modal-fade">
      <div v-if="showCustomModal" class="custom-modal-overlay" @click.self="showCustomModal = false">
        <div class="custom-modal">
          <div class="custom-modal-header">
            <span>为 {{ selectedCharacter?.display_name }} 触发奇遇</span>
            <button class="custom-modal-close" @click="showCustomModal = false">✕</button>
          </div>
          <textarea
            v-model="customEventText"
            class="custom-modal-input"
            placeholder="输入事件动机，让角色按你的想法展开故事…（留空直接点「随机奇遇」）"
            rows="4"
          ></textarea>
          <div class="custom-modal-actions">
            <button class="btn-random" @click="confirmGenerate(false)" :disabled="stirring">
              🎲 随机奇遇
            </button>
            <button class="btn-custom" @click="confirmGenerate(true)" :disabled="stirring || !customEventText.trim()">
              🎬 开始推演
            </button>
          </div>
        </div>
      </div>
    </Transition>

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
        <div v-if="showHistory">
          <!-- 历史奇遇筛选条 -->
          <div class="history-filter-bar">
            <div class="filter-scroll" @wheel="onFilterWheel">
              <div class="filter-avatar filter-all" :class="{ active: store.filterCharacterId === null && !store.filterEngaged }" @click="store.setFilter(null)">全部</div>
              <div class="filter-avatar filter-heart" :class="{ active: store.filterEngaged }" @click="store.toggleFilterEngaged()" title="只看参与过的">
                <svg viewBox="0 0 24 24" width="18" height="18" :fill="store.filterEngaged ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </div>
              <div
                v-for="ch in charactersWithEvents"
                :key="ch.character_id"
                class="filter-avatar"
                :class="{ active: store.filterCharacterId === ch.character_id && !store.filterEngaged }"
                :style="ch.avatar_path ? { backgroundImage: `url(${ch.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: '#e07b6c' }"
                @click="store.setFilter(ch.character_id)"
              >{{ ch.avatar_path ? '' : ch.display_name?.charAt(0) || '?' }}</div>
            </div>
          </div>
          <div class="waterfall-row" :style="{ '--cols': colCount }">
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
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, inject } from 'vue'
import { useEventsStore } from '../stores/events.js'
import { useChatStore } from '../stores/chat.js'
import * as api from '../api/index.js'
import EventCard from '../components/EventCard.vue'

const store = useEventsStore()
const chat = useChatStore()
const showHistory = ref(false)
const historyPage = ref(1)
const HISTORY_PAGE_SIZE = 20
const showPicker = ref(false)
const pickerRef = ref(null)
const stirring = ref(false)
const pageEl = ref(null)
const topbarEl = ref(null)

const characters = computed(() => chat.characters.filter(c => !c.events_disabled))

// 筛选条：有事件的角色头像（活跃+历史合并去重）
const charactersWithEvents = computed(() => {
  const map = new Map()
  for (const e of [...store.filteredActive, ...store.filteredHistory]) {
    if (!e.character_id || map.has(e.character_id)) continue
    map.set(e.character_id, {
      character_id: e.character_id,
      display_name: e.display_name,
      avatar_path: e.avatar_path,
    })
  }
  return Array.from(map.values())
})

function onFilterWheel(e) {
  const el = e.currentTarget
  const atLeft = el.scrollLeft <= 0 && e.deltaY < 0
  const atRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0
  if (atLeft || atRight) return
  e.preventDefault()
  el.scrollBy({ left: e.deltaY, behavior: 'smooth' })
}

const visibleHistory = computed(() =>
  store.filteredHistory.slice(0, historyPage.value * HISTORY_PAGE_SIZE)
)
const hasMoreHistory = computed(() =>
  store.filteredHistory.length > historyPage.value * HISTORY_PAGE_SIZE
)
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
const historyColumns = computed(() => splitColumns(visibleHistory.value, historyColCount.value))

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

function onClickOutside(e) {
  if (pickerRef.value && !pickerRef.value.contains(e.target)) {
    showPicker.value = false
  }
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))

const showCustomModal = ref(false)
const selectedCharacter = ref(null)
const customEventText = ref('')

function triggerGenerate(c) {
  showPicker.value = false
  selectedCharacter.value = c
  customEventText.value = ''
  showCustomModal.value = true
}

async function confirmGenerate(useCustom) {
  if (stirring.value) return
  const c = selectedCharacter.value
  if (!c) return

  stirring.value = true
  showCustomModal.value = false
  try {
    const customPrompt = useCustom ? customEventText.value.trim() : null
    const result = await api.generateEvent(c.id, null, customPrompt)
    if (result.error) { alert(result.error); return }
    store.loadEvents()
  } catch (err) {
    console.error('[EventsView] generate error:', err)
  } finally {
    stirring.value = false
  }
}

let lastScrollTop = 0

// 滚动到底部后继续滚轮 → 自动展开往期奇遇
function onPageWheel(e) {
  if (showHistory.value || !pageEl.value || e.deltaY <= 0) return
  const el = pageEl.value
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 5) {
    showHistory.value = true
  }
}

function onScroll() {
  // 移动端标题栏
  if (setTopbarVisible && topbarEl.value) {
    const st = pageEl.value?.scrollTop || 0
    const direction = st > lastScrollTop ? 'down' : 'up'
    lastScrollTop = st
    setTopbarVisible(direction === 'up' || st <= 60)
  }
  // 滚动加载更多历史
  if (showHistory.value && hasMoreHistory.value && pageEl.value) {
    const el = pageEl.value
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
      historyPage.value++
    }
  }
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

/* 角色选择器 — 和朋友圈一致 */
.picker-dropdown {
  position: absolute;
  top: 54px; right: 24px;
  z-index: 100;
  background: rgba(255,255,255,0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.1);
  padding: 12px;
  min-width: 200px;
  max-height: 400px;
  overflow-y: auto;
}
.picker-title { font-size: 12px; color: var(--text-secondary); padding: 4px 8px 8px; }
.picker-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 10px;
  cursor: pointer; font-size: 14px; color: var(--text-primary);
  transition: background 0.15s;
}
.picker-item:hover { background: rgba(224,123,108,0.08); }
.picker-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 14px; font-weight: 700; flex-shrink: 0;
}
.picker-fade-enter-active { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); }
.picker-fade-leave-active { transition: all 0.15s cubic-bezier(0.4,0,0.2,1); }
.picker-fade-enter-from, .picker-fade-leave-to { opacity: 0; transform: translateY(-8px); }

/* ── 自定义事件弹窗 ── */
.custom-modal-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.3);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.custom-modal {
  background: rgba(255,255,255,0.97);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 18px;
  padding: 24px;
  width: 420px; max-width: 90vw;
  box-shadow: 0 12px 48px rgba(0,0,0,0.12);
}
.custom-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px;
  font-size: 16px; font-weight: 700; color: var(--text-bright);
}
.custom-modal-close {
  background: none; border: none;
  font-size: 18px; color: var(--text-secondary);
  cursor: pointer; padding: 4px 8px; border-radius: 6px;
  transition: all 0.15s;
}
.custom-modal-close:hover { background: rgba(0,0,0,0.05); color: var(--text-primary); }
.custom-modal-input {
  width: 100%; box-sizing: border-box;
  border: 1px solid var(--glass-border);
  border-radius: 12px; padding: 14px;
  font-size: 14px; font-family: inherit;
  color: var(--text-primary);
  background: rgba(0,0,0,0.02);
  resize: vertical; min-height: 80px;
  outline: none; transition: border-color 0.2s;
}
.custom-modal-input:focus { border-color: var(--accent); }
.custom-modal-input::placeholder { color: var(--text-secondary); opacity: 0.6; }
.custom-modal-actions {
  display: flex; gap: 12px; margin-top: 18px;
}
.btn-random, .btn-custom {
  flex: 1; padding: 12px 0;
  border-radius: 12px; border: none;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.2s;
}
.btn-random {
  background: rgba(224,123,108,0.08);
  color: var(--accent);
}
.btn-random:hover:not(:disabled) { background: rgba(224,123,108,0.15); }
.btn-custom {
  background: linear-gradient(120deg, #f8edea 0%, #f2eaf4 35%, #eaf0f8 65%, #f8edea 100%);
  background-size: 200% 200%;
  color: #c06a5a;
}
.btn-custom:hover:not(:disabled) {
  animation: waterflow 1s ease-in-out infinite;
  box-shadow: 0 3px 20px rgba(224,123,108,0.10);
}
.btn-random:disabled, .btn-custom:disabled { opacity: 0.4; cursor: not-allowed; }

.modal-fade-enter-active { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); }
.modal-fade-leave-active { transition: all 0.15s cubic-bezier(0.4,0,0.2,1); }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }

/* ── 筛选条（朋友圈同款）── */
.filter-scroll {
  display: flex; gap: 12px; align-items: center;
  overflow-x: auto; -webkit-overflow-scrolling: touch;
  padding: 8px 6px; margin: -8px -6px 0;
  scrollbar-width: none;
}
.filter-scroll::-webkit-scrollbar { display: none; }
.filter-avatar {
  flex-shrink: 0;
  width: 54px; height: 54px;
  box-sizing: border-box;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  opacity: 0.55;
  border: 2px solid var(--glass-border);
  font-size: 20px; font-weight: 700;
  color: #fff;
  transition: opacity 0.2s ease, border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
  user-select: none;
  background-size: cover;
  background-position: center;
}
.filter-avatar.active {
  opacity: 1;
  border-color: var(--accent);
  transform: scale(1.08);
  box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.25);
}
.filter-avatar:hover:not(.active) {
  opacity: 0.85;
  border-color: var(--text-secondary);
}
.filter-all {
  background: rgba(255,255,255,0.75);
  color: var(--text-secondary);
  font-size: 12px;
  width: 54px; height: 54px;
  font-weight: 600;
  opacity: 0.7;
}
.filter-all.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  opacity: 1;
}
.filter-heart {
  background: rgba(255,255,255,0.75);
  color: var(--text-secondary);
  opacity: 0.7;
}
.filter-heart.active {
  background: rgba(255, 77, 79, 0.12);
  color: #ff4d6d;
  border-color: #ff4d6d;
  opacity: 1;
}

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

/* 历史奇遇筛选条 */
.history-filter-bar { padding: 10px 0; }

.slide-down-enter-active, .slide-down-leave-active { transition: all 0.25s ease; overflow: hidden; }
.slide-down-enter-from, .slide-down-leave-to { opacity: 0; max-height: 0; }
.slide-down-enter-to, .slide-down-leave-from { opacity: 1; max-height: 800px; }

@media (max-width: 767px) {
  .events-content { padding: 8px; }
  .history-section { padding: 0 8px 20px; }
  .events-topbar { padding: 12px 14px; }
}
</style>
