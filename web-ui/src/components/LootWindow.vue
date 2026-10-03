<template>
  <!-- ── 宝箱橱窗：按分类浏览商品 → 勾选 → 带走进背包 ──
       商品图由后端按「单件」缓存异步生成（首次刷新到某件才生），完成后经 loot_image_ready 推送。 -->
  <div class="loot-window">
    <!-- 分类标签 -->
    <div class="loot-tabs" role="tablist" aria-label="商品分类">
      <button
        v-for="p in pages"
        :key="p.key"
        type="button"
        role="tab"
        class="loot-tab"
        :class="{ active: p.key === activePage }"
        :aria-selected="p.key === activePage"
        @click="switchPage(p.key)"
      >{{ p.label }}</button>
    </div>

    <div v-if="!pages.length" class="loot-empty">还没有商品清单，请先在外部运行「导入道具清单」。</div>

    <template v-else>
      <!-- 工具行 -->
      <div class="loot-toolbar">
        <button type="button" class="loot-refresh" :disabled="rolling" @click="refresh">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>
          </svg>
          <span>{{ rolling ? '刷新中…' : '换一批' }}</span>
        </button>
        <span class="loot-count">
          {{ currentPageInfo?.count || 0 }} 件可选
          <template v-if="queuePending">· 还有 {{ queuePending }} 张图生成中</template>
        </span>
        <div style="flex:1"></div>
        <linshe-button
          size="sm" variant="primary"
          :disabled="!selectedSlots.length || taking"
          :loading="taking"
          @click="takeSelected"
        >带走选中的 {{ selectedSlots.length || '' }}</linshe-button>
      </div>

      <!-- 4 格 -->
      <div v-if="!slots.length" class="loot-empty">
        点「换一批」抽取这个分类的商品
      </div>
      <TransitionGroup v-else name="loot-cards" tag="div" class="loot-grid">
        <div
          v-for="(cell, idx) in slots"
          :key="cell ? cell.id : 'empty-' + idx"
          class="loot-card"
          :class="{ empty: !cell, picked: cell && selectedSlots.includes(idx) }"
          @click="cell && togglePick(idx)"
        >
          <template v-if="cell">
            <div class="loot-thumb">
              <img v-if="cell.imageUrl" :src="cell.imageUrl" :alt="cell.name" loading="lazy" />
              <span v-else class="loot-thumb-wait">
                <span class="loot-spinner" aria-hidden="true"></span>
                <span>生成中</span>
              </span>
              <span v-if="selectedSlots.includes(idx)" class="loot-check" aria-hidden="true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4.5 4.5L19 7"/></svg>
              </span>
            </div>
            <div class="loot-name" :title="cell.name">{{ cell.name }}</div>
            <div class="loot-meaning" :title="cell.meaning">{{ cell.meaning || cell.tag }}</div>
          </template>
          <div v-else class="loot-card-empty">已拿走</div>
        </div>
      </TransitionGroup>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, inject } from 'vue'
import * as api from '../api/index.js'
import { onEvent } from '../stores/unifiedStream.js'
import LinsheButton from './ui/LinsheButton.vue'

const emit = defineEmits(['taken'])
const toastFn = inject('toast', null)
const toast = (m, t) => { if (toastFn) toastFn(m, t) }

const pages = ref([])
const activePage = ref('')
const slots = ref([])
const selectedSlots = ref([])
const rolling = ref(false)
const taking = ref(false)
const queuePending = ref(0)

const currentPageInfo = computed(() => pages.value.find(p => p.key === activePage.value))

// 商品图是异步生成的：SSE 推送到达时，把当前页里同 tag 的格子补上图片
let unsub = null
let pollTimer = null

function applyImage({ tag, imageUrl }) {
  let hit = false
  for (const cell of slots.value) {
    if (cell && cell.tag === tag && !cell.imageUrl) { cell.imageUrl = imageUrl; hit = true }
  }
  if (hit) queuePending.value = Math.max(0, queuePending.value - 1)
}

/** 图还在生成时轮询兜底（SSE 可能丢帧，例如刷新页面后） */
function startPoll() {
  stopPoll()
  pollTimer = setInterval(async () => {
    const waiting = slots.value.filter(c => c && !c.imageUrl).length
    if (!waiting) { stopPoll(); return }
    try {
      const d = await api.getLootWindow(activePage.value)
      // 保留用户已勾选状态；只更新图片与内容
      slots.value = d.slots || []
      queuePending.value = d.queue?.pending || 0
      if (!slots.value.some(c => c && !c.imageUrl)) stopPoll()
    } catch { /* 网络抖动忽略，下轮再试 */ }
  }, 4000)
}
function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

async function loadPages() {
  try {
    const d = await api.getLootPages()
    pages.value = d.pages || []
    queuePending.value = d.queue?.pending || 0
    if (!activePage.value && pages.value.length) activePage.value = pages.value[0].key
  } catch (err) {
    toast('读取商品分类失败: ' + (err?.message || ''), 'error')
  }
}

async function loadWindow(page) {
  try {
    const d = await api.getLootWindow(page)
    slots.value = d.slots || []
    queuePending.value = d.queue?.pending || 0
    if (slots.value.some(c => c && !c.imageUrl)) startPoll()
  } catch {
    slots.value = []
  }
}

function switchPage(key) {
  if (key === activePage.value) return
  activePage.value = key
  selectedSlots.value = []
  loadWindow(key)
}

async function refresh() {
  if (rolling.value || !activePage.value) return
  rolling.value = true
  selectedSlots.value = []
  try {
    const d = await api.rollLootWindow(activePage.value)
    slots.value = d.slots || []
    queuePending.value = d.queue?.pending || 0
    if (slots.value.some(c => c && !c.imageUrl)) startPoll()
    // 刷新后重新拉一次分页统计（已有图数量会变）
    const ps = await api.getLootPages()
    pages.value = ps.pages || pages.value
  } catch (err) {
    toast('刷新失败: ' + (err?.message || ''), 'error')
  } finally {
    rolling.value = false
  }
}

function togglePick(idx) {
  const i = selectedSlots.value.indexOf(idx)
  if (i >= 0) selectedSlots.value.splice(i, 1)
  else selectedSlots.value.push(idx)
}

async function takeSelected() {
  if (!selectedSlots.value.length || taking.value) return
  taking.value = true
  const picked = [...selectedSlots.value]
  try {
    const d = await api.takeLootItems(activePage.value, picked)
    selectedSlots.value = []
    // 被带走的格子留空位（后端已从橱窗移除），本地同步置空
    const next = [...slots.value]
    for (const i of picked) if (i < next.length) next[i] = null
    slots.value = next
    toast(`已放入背包：${(d.taken || []).map(x => x.name).join('、')}`, 'success')
    emit('taken', d.taken || [])
  } catch (err) {
    toast('带走失败: ' + (err?.message || ''), 'error')
  } finally {
    taking.value = false
  }
}

onMounted(async () => {
  unsub = onEvent('loot_image_ready', applyImage)
  await loadPages()
  if (activePage.value) await loadWindow(activePage.value)
})
onUnmounted(() => {
  if (unsub) unsub()
  stopPoll()
})
</script>

<style scoped>
.loot-window { display: flex; flex-direction: column; gap: 12px; min-height: 0; }

.loot-tabs {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding-bottom: 10px; border-bottom: 1px solid var(--glass-border);
}
.loot-tab {
  padding: 5px 14px; border-radius: 999px; cursor: pointer;
  font-size: 13px; font-family: inherit;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: 1px solid transparent;
  transition: all 0.15s ease;
}
.loot-tab:hover { color: var(--text-bright); }
.loot-tab.active {
  color: var(--on-accent, #fff);
  background: var(--accent);
  border-color: var(--accent);
}

.loot-toolbar { display: flex; align-items: center; gap: 10px; }
.loot-refresh {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 9px; cursor: pointer;
  font-size: 13px; font-family: inherit;
  color: var(--text-bright);
  background: var(--bg-tertiary);
  border: 1px solid var(--glass-border);
  transition: all 0.15s ease;
}
.loot-refresh:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.loot-refresh:disabled { opacity: 0.55; cursor: default; }
.loot-count { font-size: 12px; color: var(--text-secondary); }

/* 每页 4 格：宽屏一行排开，窄屏 2×2（不要 3 列，那会变成 3+1 的别扭布局） */
.loot-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
  overflow-y: auto; padding-right: 2px; min-height: 0;
}
@media (max-width: 900px) { .loot-grid { grid-template-columns: repeat(2, 1fr); } }

.loot-card {
  position: relative;
  display: flex; flex-direction: column; gap: 5px;
  padding: 8px; border-radius: 12px;
  background: var(--glass-bg);
  border: 1.5px solid var(--glass-border);
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease, background 0.15s ease;
}
.loot-card:hover:not(.empty) { border-color: var(--accent); transform: translateY(-1px); }
.loot-card.picked { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.08); }
.loot-card.empty { cursor: default; border-style: dashed; opacity: 0.5; }

.loot-thumb {
  position: relative;
  width: 100%; aspect-ratio: 1 / 1;
  border-radius: 9px; overflow: hidden;
  background: var(--bg-tertiary);
  display: flex; align-items: center; justify-content: center;
}
.loot-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.loot-thumb-wait {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  font-size: 11px; color: var(--text-secondary);
}
.loot-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid rgba(var(--accent-rgb), 0.25); border-top-color: var(--accent);
  animation: loot-spin 0.7s linear infinite;
}
@keyframes loot-spin { to { transform: rotate(360deg); } }

.loot-check {
  position: absolute; top: 5px; right: 5px;
  width: 20px; height: 20px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent); color: var(--on-accent, #fff);
}

.loot-name {
  font-size: 12.5px; font-weight: 500; color: var(--text-bright);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.loot-meaning {
  font-size: 11px; color: var(--text-secondary); line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden;
}
.loot-card-empty {
  display: flex; align-items: center; justify-content: center;
  min-height: 120px; font-size: 12px; color: var(--text-secondary);
}

.loot-empty {
  padding: 28px 16px; text-align: center;
  font-size: 13px; color: var(--text-secondary);
}

.loot-cards-enter-active, .loot-cards-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.loot-cards-enter-from, .loot-cards-leave-to { opacity: 0; transform: scale(0.96); }
</style>
