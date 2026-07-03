<template>
  <div class="schedule-view">
    <!-- ═══ 主体：单栏全宽 ═══ -->
    <div class="sched-body" v-if="!store.loading && enrichedChars.length > 0">
      <main class="main-area">
        <!-- 顶部概览 -->
        <div class="main-topbar">
          <div class="main-title-row">
            <h2>今日日程总览</h2>
            <span class="main-time">{{ timeText }}</span>
          </div>
          <div class="main-summary">
            <span v-for="s in mainSummaries" :key="s.key" class="ms-item" @click="onFilter(s.key)">
              <i class="ms-dot" :style="{ background: s.color }"></i>
              {{ s.count }} {{ s.label }}
            </span>
          </div>
        </div>

        <!-- 卡片网格 -->
        <div class="card-grid">
          <CharacterStatusCard
            v-for="c in filteredChars"
            :key="c.id"
            :char="c"
            :active="activeCharId === c.id"
            @select="onSelectChar(c.id)"
          />
        </div>
      </main>
    </div>

    <!-- ═══ 加载态 ═══ -->
    <div v-else-if="store.loading" class="sched-placeholder">
      <div class="loader"></div>
      <p>加载角色日程中...</p>
    </div>

    <!-- ═══ 空态 ═══ -->
    <div v-else class="sched-placeholder">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <p>今天还没有生成角色日程</p>
      <span class="ph-hint">生成后，你可以在这里查看所有角色今天的行动与状态。</span>
      <button class="btn-glass" @click="regenerateAll">立即生成今日行程</button>
    </div>

    <!-- ═══ 角色详情抽屉 ═══ -->
    <CharacterDetailDrawer
      :open="drawerOpen"
      :char="detailChar"
      :activities="detailActs"
      :loading="detailLoading"
      :peek-busy="peekBusy"
      :regenerating="detailRegenerating"
      @close="drawerOpen = false"
      @peek="onPeek"
      @regenerate="onRegenerate"
    />

    <!-- ═══ 瞄一眼快照弹窗 ═══ -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="peekOpen" class="peek-overlay" @click="peekOpen = false">
          <div class="peek-dialog" @click.stop>
            <div class="pk-top">
              <div class="pk-char">
                <img :src="peekChar?.avatar_path || '/avatars/default.png'" @error="($event.target as HTMLImageElement).src = '/avatars/default.png'" />
                <div><b>{{ peekAct?.activity || '瞄一眼' }}</b><span v-if="peekAct?.location">{{ peekAct.location }}</span></div>
              </div>
              <button class="pk-x" @click="peekOpen = false">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="pk-body">
              <template v-if="peekLoading">
                <div class="pk-wait"><div class="loader-ring"></div><p>正在定位角色位置...</p><span>拍照中请稍后</span></div>
              </template>
              <template v-else-if="peekError">
                <div class="pk-err"><p>生成失败</p><span>{{ peekError }}</span><button class="btn-glass" @click="retryPeek">重试</button></div>
              </template>
              <img v-else-if="peekImage" :src="peekImage" class="pk-img" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useScheduleStore } from '../stores/schedule.js'
import { onEvent } from '../stores/unifiedStream.js'
import CharacterStatusCard from '../components/CharacterStatusCard.vue'
import CharacterDetailDrawer from '../components/CharacterDetailDrawer.vue'

const store = useScheduleStore()

// ── 时钟 ──
const WD = ['周日','周一','周二','周三','周四','周五','周六']
const now = ref(new Date())
let ct: ReturnType<typeof setInterval> | null = null
const timeText = computed(() => {
  const d = now.value
  return `${WD[d.getDay()]} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
})

// ── 筛选 ──
const activeFilter = ref('all')

// ── 数据增强：解析 current_activity → _location + _behavior ──
const enrichedChars = computed(() => {
  return store.characters.map(c => {
    const raw = c.current_activity || ''
    const sep = raw.indexOf(' · ')
    const location = sep > -1 ? raw.slice(0, sep) : raw
    const behavior = sep > -1 ? raw.slice(sep + 3) : raw
    return {
      ...c,
      _location: location || '未知地点',
      _behavior: behavior || '暂无信息',
      _description: c._desc || behavior || raw || '',
      _hasEvent: false,
      _nextActivity: null,
    }
  })
})

const filteredChars = computed(() => {
  let list = enrichedChars.value
  if (activeFilter.value === 'available') list = list.filter(c => !c.is_sleeping && c.reply_delay === 0)
  else if (activeFilter.value === 'delayed') list = list.filter(c => !c.is_sleeping && c.reply_delay > 0)
  else if (activeFilter.value === 'sleeping') list = list.filter(c => c.is_sleeping)
  else if (activeFilter.value === 'idle') list = list.filter(c => !c.is_sleeping && c.reply_delay === 0)
  else if (activeFilter.value === 'busy2') list = list.filter(c => !c.is_sleeping && c.reply_delay > 0)
  return list
})

const mainSummaries = computed(() => {
  const all = enrichedChars.value
  return [
    { key: 'all',       label: '全部', count: all.length,                                   color: '#8c8074' },
    { key: 'available', label: '空闲', count: all.filter(c => !c.is_sleeping && c.reply_delay === 0).length, color: '#52c41a' },
    { key: 'delayed',   label: '忙碌', count: all.filter(c => !c.is_sleeping && c.reply_delay > 0).length, color: '#faad14' },
    { key: 'sleeping',  label: '睡眠', count: all.filter(c => c.is_sleeping).length,          color: '#bfbfbf' },
  ]
})

// ── 选中角色 / 抽屉 ──
const activeCharId = ref<number | null>(null)
const drawerOpen = ref(false)
const detailChar = ref<any>(null)
const detailActs = ref<any[]>([])
const detailLoading = ref(false)
const detailRegenerating = ref(false)

// ── 快照 ──
const peekOpen = ref(false)
const peekBusy = ref(false)
const peekLoading = ref(false)
const peekImage = ref<string | null>(null)
const peekError = ref<string | null>(null)
const peekChar = ref<any>(null)
const peekAct = ref<any>(null)

// ── 生命周期 ──
onMounted(() => {
  store.fetchOverview()
  ct = setInterval(() => { now.value = new Date() }, 30_000)
  try {
    onEvent('schedule_peek_ready', (d: any) => {
      if (d.images?.length) { peekImage.value = d.images[0]; peekError.value = null }
      else if (d.error) { peekError.value = d.error }
      peekLoading.value = false; peekBusy.value = false
    })
  } catch { /* */ }
})
onUnmounted(() => { if (ct) clearInterval(ct) })

// ── 方法 ──
function onFilter(key: string) { activeFilter.value = key }

async function onSelectChar(id: number) {
  activeCharId.value = id
  const c = enrichedChars.value.find(x => x.id === id)
  detailChar.value = c || null
  drawerOpen.value = true
  detailLoading.value = true
  detailActs.value = []
  try {
    const d = await store.fetchCharacterSchedule(id)
    detailActs.value = d.activities || []
  } catch { detailActs.value = [] }
  finally { detailLoading.value = false }
}

function onPeek() {
  if (!detailChar.value) return
  const act = detailActs.value.find((a: any) => a.isCurrent) || detailActs.value[0]
  peekChar.value = detailChar.value
  peekAct.value = act || null
  peekImage.value = null; peekError.value = null
  peekOpen.value = true; peekBusy.value = true; peekLoading.value = true
  store.peekSnapshot(detailChar.value.id)
}

async function onRegenerate() {
  if (!detailChar.value || detailRegenerating.value) return
  detailRegenerating.value = true
  try {
    try { await store.regenerateSchedule(detailChar.value.id) } catch { return }
    await store.fetchOverview()
    detailLoading.value = true
    try {
      const d = await store.fetchCharacterSchedule(detailChar.value.id)
      detailActs.value = d.activities || []
    } catch { }
    finally { detailLoading.value = false }
  } finally {
    detailRegenerating.value = false
  }
}

function retryPeek() {
  if (!peekChar.value) return
  peekError.value = null; peekLoading.value = true; peekBusy.value = true
  store.peekSnapshot(peekChar.value.id)
}

async function regenerateAll() {
  for (const c of store.characters) {
    try { await store.regenerateSchedule(c.id) } catch { /* continue */ }
  }
  await store.fetchOverview()
}
</script>

<style scoped>
.schedule-view {
  flex: 1; display: flex; flex-direction: column;
  height: 100vh; height: 100dvh; overflow: hidden;
  background: transparent;
}

/* ── Body ── */
.sched-body { flex: 1; display: flex; min-height: 0; overflow: hidden; }

/* ── Main Area ── */
.main-area { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }

.main-topbar {
  padding: 16px 24px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: rgba(255,255,255,0.3);
  backdrop-filter: blur(8px);
}

.main-title-row { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.main-title-row h2 { margin: 0; font-size: 1.1rem; font-weight: 700; color: var(--text-bright); }
.main-time { font-size: 0.8rem; color: var(--text-secondary); font-variant-numeric: tabular-nums; }

.main-summary { display: flex; gap: 16px; margin-bottom: 8px; }
.ms-item {
  display: flex; align-items: center; gap: 4px;
  font-size: 0.75rem; color: var(--text-secondary); cursor: pointer;
  transition: color 0.15s;
}
.ms-item:hover { color: var(--text-bright); }
.ms-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

/* ── Card Grid ── */
.card-grid {
  flex: 1; overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px; padding: 16px 20px;
  align-content: start;
}

/* ── Placeholder ── */
.sched-placeholder {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px;
  color: var(--text-secondary);
}
.sched-placeholder p { margin: 0; font-size: 0.95rem; }
.ph-hint { font-size: 0.8rem; color: #bfbbb6; }

.loader { width: 36px; height: 36px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.btn-glass {
  display: inline-flex; align-items: center; gap: 5px; margin-top: 6px;
  padding: 8px 18px; border: 1px solid var(--border); border-radius: 999px;
  background: var(--glass-bg); color: var(--text-secondary);
  font-size: 0.85rem; cursor: pointer; transition: 0.15s;
}
.btn-glass:hover { background: var(--bg-hover); color: var(--text-bright); }

/* ── Peek Modal ── */
.peek-overlay {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(0,0,0,0.3); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.peek-dialog {
  background: #fff; border: 1px solid var(--border);
  border-radius: 16px; width: 100%; max-width: 480px; max-height: 88vh;
  overflow: hidden; display: flex; flex-direction: column;
  box-shadow: 0 8px 40px rgba(0,0,0,0.1);
}
.pk-top { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.pk-char { display: flex; align-items: center; gap: 10px; }
.pk-char img { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }
.pk-char b { display: block; font-size: 0.9rem; color: var(--text-bright); }
.pk-char span { font-size: 0.75rem; color: var(--text-secondary); }
.pk-x { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; border: none; background: transparent; color: var(--text-secondary); cursor: pointer; }
.pk-x:hover { background: var(--bg-hover); }
.pk-body { flex: 1; min-height: 150px; display: flex; align-items: center; justify-content: center; }
.pk-wait { text-align: center; padding: 36px; color: var(--text-secondary); }
.pk-wait p { margin: 10px 0 4px; font-size: 0.88rem; }
.pk-wait span { font-size: 0.73rem; color: #bfbbb6; }
.loader-ring { width: 36px; height: 36px; margin: 0 auto; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
.pk-err { text-align: center; padding: 36px; }
.pk-err p { color: #ff4d4f; margin: 0 0 4px; font-size: 0.9rem; }
.pk-err span { display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 12px; }
.pk-img { width: 100%; max-height: 60vh; object-fit: contain; display: block; }

.modal-enter-active, .modal-leave-active { transition: opacity 0.2s; }
.modal-enter-active .peek-dialog, .modal-leave-active .peek-dialog { transition: transform 0.2s cubic-bezier(0.4,0,0.2,1); }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .peek-dialog { transform: scale(0.95) translateY(10px); }
.modal-leave-to .peek-dialog { transform: scale(0.95) translateY(10px); }

/* ── Responsive ── */
@media (max-width: 767px) {
  .main-topbar { padding: 10px 14px 8px; }
  .main-title-row h2 { font-size: 1rem; }
  .card-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 8px; padding: 10px 12px;
  }
  .peek-dialog { max-width: 94vw; border-radius: 12px; }
}

@media (min-width: 768px) and (max-width: 1023px) {
  .card-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
}

@media (min-width: 1024px) {
  .card-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
}
</style>
