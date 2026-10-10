<template>
  <div class="gallery" ref="scrollContainer" @scroll="onScroll">
    <!-- 空状态 -->

    <!-- 角色筛选条（横向滚动头像，与文件夹筛选叠加） -->
    <div v-if="!loading && chat.characters.length > 0" class="char-bar">
      <div ref="charScrollRef" class="char-scroll" @wheel="onCharWheel">
        <div
          class="char-avatar char-all"
          :class="{ active: activeCharId === null }"
          @click="onCharChange(null)"
        >全部</div>
        <div
          v-for="ch in chat.characters"
          :key="ch.id"
          class="char-avatar"
          :class="{ active: activeCharId === ch.id }"
          :title="ch.display_name"
          @click="onCharChange(ch.id)"
        >
          <img v-if="ch.avatar_path" :src="ch.avatar_path" class="char-avatar-img" alt="" />
          <span v-else>{{ ch.display_name?.charAt(0) || '?' }}</span>
        </div>
      </div>
    </div>

    <!-- 文件夹筛选按钮（常驻） -->
    <div v-if="!loading && folderButtons.length > 1" class="folder-bar">
      <linshe-button
        v-for="f in folderButtons"
        :key="f.key"
        variant="chip"
        :active="activeFolder === f.key"
        @click="onFolderChange(f.key)"
      >
        <span class="folder-label">{{ f.label }}</span>
        <span class="folder-count">{{ f.count }}</span>
      </linshe-button>
    </div>

    <!-- 按时间分组的图片网格 -->
    <template v-if="images.length > 0">
      <div v-for="group in visibleDayGroups" :key="group.label" class="gallery-group">
        <div class="group-header">
          <span class="group-label">{{ group.label }}</span>
          <span class="group-count">{{ group.images.length }} 张</span>
          <button
            v-if="selectMode"
            type="button"
            class="group-pick"
            @click="toggleGroup(group)"
          >{{ groupAllSelected(group) ? '取消全选' : '全选本组' }}</button>
        </div>
        <div class="gallery-grid stagger">
          <div
            v-for="img in group.images"
            :key="img.name"
            class="gallery-item sheen"
            :class="{ 'is-selecting': selectMode, 'is-selected': isSelected(img) }"
            @click="onItemClick(img)"
          >
            <!-- 用 img + loading=lazy 取代 background-image：浏览器可延迟加载视口外缩略图 -->
            <img
              class="img-wrapper"
              :src="bustUrlIfOverwritten(img.url)"
              loading="lazy"
              decoding="async"
              alt=""
            >
            <!-- 多选态：右上角勾选标记（未选中是空心圈，选中填充打勾） -->
            <span v-if="selectMode" class="pick" :class="{ on: isSelected(img) }" aria-hidden="true">
              <svg v-if="isSelected(img)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- 空状态提示 -->
    <div v-else-if="!loading" class="load-more">— {{ activeCharId !== null ? 'ta还没有留下图片' : '相册还是空的' }} —</div>

    <!-- 加载更多 -->
    <div v-if="!loading && hasMore && images.length > 0" class="load-more">
      <span v-if="loadingMore">加载中...</span>
      <span v-else>上滑加载更多</span>
    </div>
    <div v-else-if="!hasMore && images.length > 0" class="load-more">— 共 {{ total }} 张 —</div>

    <!-- 多选操作栏（底部悬浮，选择模式下常驻） -->
    <Transition name="pick-bar">
      <div v-if="selectMode" class="pick-bar">
        <span class="pick-count">已选 <b>{{ selectedCount }}</b> 张</span>
        <div class="pick-actions">
          <linshe-button size="sm" variant="secondary" :disabled="deleting" @click="selectAllVisible">全选</linshe-button>
          <linshe-button size="sm" variant="secondary" :disabled="!selectedCount || deleting" @click="clearSelection">清空</linshe-button>
          <linshe-button
            size="sm"
            variant="danger"
            :disabled="!selectedCount || deleting"
            :loading="deleting"
            @click="doBatchDelete"
          >删除{{ selectedCount ? ` ${selectedCount} 张` : '' }}</linshe-button>
        </div>
      </div>
    </Transition>

    <!-- 图片预览 Lightbox -->
    <ImageLightbox
      :visible="lightboxVisible"
      :imgs="lightboxImgs"
      :index="lightboxIndex"
      @hide="lightboxVisible = false"
      @regenerated="onRegenerated"
      @upscaled="onRegenerated"
      @deleted="onDeleted"
    />
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted } from 'vue'
import { listGalleryImages, deleteImagesBatch } from '../api/index.js'
import ImageLightbox from './ImageLightbox.vue'
import LinsheButton from './ui/LinsheButton.vue'
import { bustUrlIfOverwritten } from '../utils/imageUrlRefresh.js'
import { useChatStore } from '../stores/chat.js'

const PAGE_SIZE = 60

const emit = defineEmits(['loaded', 'select-mode-change'])

const confirmFn = inject('confirmFn', null)
const toastFn = inject('toast', null)

const images = ref([])
const total = ref(0)
const hasMore = ref(false)
const loading = ref(true)
const loadingMore = ref(false)
const lightboxVisible = ref(false)
const lightboxIndex = ref(0)
const scrollContainer = ref(null)

const folders = ref([])
const activeFolder = ref(null)
const activeCharId = ref(null)
const charScrollRef = ref(null)

const chat = useChatStore()

const folderButtons = computed(() => {
  const all = { key: null, label: '全部', count: total.value }
  if (!activeFolder.value) all.count = total.value
  else {
    // when filtered, compute "全部" count from folders
    let sum = 0
    for (const f of folders.value) sum += f.count
    all.count = sum
  }
  return [all, ...folders.value.map(f => ({ key: f.key, label: f.label, count: f.count }))]
})

const allDayGroups = computed(() => {
  if (images.value.length === 0) return []

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  const thisYear = now.getFullYear()

  const map = new Map()

  for (const img of images.value) {
    const d = new Date(img.mtime)
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

    let label
    if (dayStart >= todayStart) {
      label = '今天'
    } else if (dayStart >= yesterdayStart) {
      label = '昨天'
    } else {
      const m = d.getMonth() + 1
      const day = d.getDate()
      if (d.getFullYear() === thisYear) {
        label = `${m}月${day}日`
      } else {
        label = `${d.getFullYear()}年${m}月${day}日`
      }
    }

    if (!map.has(dayStart)) {
      map.set(dayStart, { label, dayStart, images: [] })
    }
    map.get(dayStart).images.push(img)
  }

  return [...map.values()].sort((a, b) => b.dayStart - a.dayStart)
})

const allFlatImages = computed(() => {
  let idx = 0
  const result = []
  for (const group of allDayGroups.value) {
    for (const img of group.images) {
      img.flatIndex = idx++
    }
    result.push(group)
  }
  return result
})

const visibleDayGroups = computed(() => allFlatImages.value)

const lightboxImgs = computed(() => {
  const urls = []
  for (const group of visibleDayGroups.value) {
    for (const img of group.images) {
      urls.push(bustUrlIfOverwritten(img.url))
    }
  }
  return urls
})

function onPreview(flatIndex) {
  lightboxIndex.value = flatIndex
  lightboxVisible.value = true
}

// ── 多选与批量删除 ──
// 选中集用文件名（img.name）而不是 URL：URL 可能带 ?_t= 防缓存参数，name 才是稳定的键。
const selectMode = ref(false)
const selected = ref(new Set())
const deleting = ref(false)

function isSelected(img) {
  return selected.value.has(img.name)
}

/** 当前可见列表里被选中的张数（切筛选后旧选中项不在列表里，天然不计入） */
const selectedCount = computed(() => {
  let n = 0
  for (const group of visibleDayGroups.value) {
    for (const img of group.images) if (selected.value.has(img.name)) n++
  }
  return n
})

/** 按当前可见列表收集选中项的 URL（删除时要的是 URL） */
function selectedUrls() {
  const urls = []
  for (const group of visibleDayGroups.value) {
    for (const img of group.images) if (selected.value.has(img.name)) urls.push(img.url)
  }
  return urls
}

function onItemClick(img) {
  // 选择模式下点击是「勾选」，不再打开大图
  if (selectMode.value) { toggleSelect(img.name); return }
  onPreview(img.flatIndex)
}

function toggleSelect(name) {
  const next = new Set(selected.value)
  if (next.has(name)) next.delete(name); else next.add(name)
  selected.value = next
}

function clearSelection() {
  selected.value = new Set()
}

function groupAllSelected(group) {
  return group.images.length > 0 && group.images.every(i => selected.value.has(i.name))
}

function toggleGroup(group) {
  const next = new Set(selected.value)
  const all = groupAllSelected(group)
  for (const i of group.images) { if (all) next.delete(i.name); else next.add(i.name) }
  selected.value = next
}

function selectAllVisible() {
  const next = new Set(selected.value)
  for (const group of visibleDayGroups.value) for (const i of group.images) next.add(i.name)
  selected.value = next
}

/** 进入/退出多选模式（由外层顶栏按钮触发） */
function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) clearSelection()
  emit('select-mode-change', selectMode.value)
}

async function doBatchDelete() {
  const urls = selectedUrls()
  if (!urls.length || deleting.value) return

  const msg = `确定删除选中的 ${urls.length} 张图片吗？\n删除后无法恢复（聊天里引用了这些图的记录也会一并清理）。`
  const ok = confirmFn
    ? await confirmFn({ title: '删除图片', message: msg, okText: '删除', danger: true })
    : window.confirm(msg)
  if (!ok) return

  deleting.value = true
  try {
    const res = await deleteImagesBatch(urls)
    const n = res?.deleted ?? urls.length
    if (res?.failed) toastFn?.(`已删除 ${n} 张，${res.failed} 张失败`, 'warning')
    else toastFn?.(`已删除 ${n} 张`, 'success')
    clearSelection()
    // 必须重载：本地移除会让 loadMore 的 offset 基准失真（重复或漏加载）
    await reloadKeepingCount()
  } catch (err) {
    console.error('[gallery] batch delete failed:', err)
    toastFn?.('删除失败：' + (err?.message || ''), 'error')
  } finally {
    deleting.value = false
  }
}

/**
 * 删除后重载「当前已加载的数量」，修正分页 offset 基准。
 * 直接 loadPage(0) 会把列表缩回一页、用户要重新往下滚；按已加载数量重载则内容不丢。
 */
async function reloadKeepingCount() {
  await loadPage(0, Math.max(PAGE_SIZE, images.value.length))
}

function onRegenerated(newUrl) {
  const base = newUrl.replace(/\?.*$/, '')
  for (const img of images.value) {
    if (img.url.replace(/\?.*$/, '') === base) {
      img.url = newUrl
    }
  }
}

function onDeleted(deletedUrl) {
  const base = deletedUrl.replace(/\?.*$/, '')
  images.value = images.value.filter(img => img.url.replace(/\?.*$/, '') !== base)
  total.value = Math.max(0, total.value - 1)
}

function onFolderChange(key) {
  if (activeFolder.value === key) return
  activeFolder.value = key
  clearSelection()   // 切换筛选后列表变了，旧选中项不该被带过去
  loadPage(0)
  scrollContainer.value?.scrollTo({ top: 0 })
}

function onCharChange(id) {
  if (activeCharId.value === id) return
  activeCharId.value = id
  clearSelection()
  loadPage(0)
  scrollContainer.value?.scrollTo({ top: 0 })
}

function onCharWheel(e) {
  const el = charScrollRef.value
  if (!el) return
  const atLeftEdge = el.scrollLeft <= 0 && e.deltaY < 0
  const atRightEdge = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0
  if (atLeftEdge || atRightEdge) return
  e.preventDefault()
  el.scrollBy({ left: e.deltaY, behavior: 'smooth' })
}

// 请求序号：筛选切换不复位旧数据（避免计数闪 0、网格闪空），靠序号丢弃过期响应
let loadSeq = 0
let pendingFirstPage = false

async function loadPage(offset, limit = PAGE_SIZE) {
  const seq = ++loadSeq
  if (offset === 0) pendingFirstPage = true
  try {
    const data = await listGalleryImages(limit, offset, activeFolder.value || '', activeCharId.value)
    if (seq !== loadSeq) return
    pendingFirstPage = false
    if (offset === 0) {
      images.value = data.images || []
      if (data.folders) folders.value = data.folders
    } else {
      images.value.push(...(data.images || []))
    }
    total.value = data.total || images.value.length
    hasMore.value = data.hasMore ?? false
    emit('loaded', total.value)
  } catch (err) {
    if (seq === loadSeq) pendingFirstPage = false
    console.error('[gallery] load images error:', err)
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value || pendingFirstPage) return
  loadingMore.value = true
  await loadPage(images.value.length)
  loadingMore.value = false
}

function onScroll() {
  const el = scrollContainer.value
  if (!el || loadingMore.value || !hasMore.value) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
    loadMore()
  }
}

onMounted(async () => {
  await loadPage(0)
  loading.value = false
})

async function refresh() {
  await loadPage(0)
}

defineExpose({ refresh, toggleSelectMode })
</script>

<style scoped>
.gallery {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
}

/* ── 角色筛选条（与朋友圈筛选条同款交互） ── */
.char-bar {
  padding: 0 0 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 12px;
}

.char-scroll {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 6px 4px;
  margin: -6px -4px 0;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.char-scroll::-webkit-scrollbar { display: none; }

.char-avatar {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  box-sizing: border-box;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  opacity: 0.55;
  border: 2px solid var(--glass-border);
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  user-select: none;
  background: var(--accent);
  transition: opacity 0.2s ease, border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}
.char-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
  border-radius: inherit;
  display: block;
}
.char-avatar.active {
  opacity: 1;
  border-color: var(--accent);
  transform: scale(1.08);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.25);
}
.char-avatar:hover:not(.active) {
  opacity: 0.85;
  border-color: var(--text-secondary);
}
/* 「全部」按钮：只覆盖视觉属性，结构尺寸继承 .char-avatar */
.char-all {
  background: rgba(255,255,255,0.75);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  opacity: 0.7;
}
.char-all.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  opacity: 1;
}

/* ── 文件夹筛选栏 ── */
.folder-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0 16px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}

.folder-label {
  font-weight: 500;
}

.folder-count {
  font-size: 11px;
  opacity: 0.7;
}

/* ── 空状态 ── */
/* 空状态已迁移至 EmptyState 组件 */

/* ── 分组 ── */
.gallery-group {
  margin-bottom: 20px;
}

.group-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 4px 12px;
}
.group-label {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-bright);
}
.group-count {
  font-size: 12px;
  color: var(--text-secondary);
}

/* ── 图片网格 ── */
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.gallery-item {
  position: relative;          /* 多选勾选标记的定位基准 */
  border-radius: 12px;
  overflow: hidden;
  background: var(--glass-bg-strong);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, outline-color 0.15s ease;
  outline: 2px solid transparent;
  outline-offset: -2px;
}
.gallery-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
/* 多选态：把「点开大图」的悬浮放大收起来，避免误以为还能点开 */
.gallery-item.is-selecting:hover { transform: none; }
.gallery-item.is-selecting:hover .img-wrapper { transform: none; }
.gallery-item.is-selected {
  outline-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.28);
}
.gallery-item.is-selected .img-wrapper { opacity: 0.82; }

/* 勾选标记：未选 = 半透明空心圈，选中 = 实心打勾 */
.pick {
  position: absolute;
  top: 8px; right: 8px;
  width: 22px; height: 22px;
  box-sizing: border-box;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.42);
  border: 2px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  pointer-events: none;   /* 点击交给整块 .gallery-item，圆圈本身不吃事件 */
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}
.pick.on {
  background: var(--accent);
  border-color: var(--accent);
  transform: scale(1.06);
}

/* 分组头的「全选本组」 */
.group-pick {
  margin-left: auto;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 11px; font-weight: 600;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.group-pick:hover { color: var(--accent); border-color: var(--accent); background: rgba(var(--accent-rgb), 0.08); }

/* ── 底部多选操作栏 ── */
.pick-bar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  margin: 12px -16px -16px;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
  display: flex; align-items: center; gap: 12px;
  background: var(--popover-bg, var(--glass-bg-strong));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-top: 1px solid var(--border);
}
.pick-count { font-size: 13px; color: var(--text-secondary); flex-shrink: 0; }
.pick-count b { color: var(--accent); font-size: 15px; font-weight: 700; }
.pick-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }

.pick-bar-enter-active { transition: all 0.24s cubic-bezier(0.3, 1.2, 0.5, 1); }
.pick-bar-leave-active { transition: all 0.16s cubic-bezier(0.4, 0, 0.2, 1); }
.pick-bar-enter-from, .pick-bar-leave-to { opacity: 0; transform: translateY(16px); }

.gallery-item .img-wrapper {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  background-color: var(--bg-tertiary);
  object-fit: cover;
  transition: transform 0.3s ease, background-color 0.2s ease;
}
.gallery-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.gallery-item:hover .img-wrapper {
  transform: scale(1.05);
}

/* ── 加载更多 ── */
.load-more {
  text-align: center;
  padding: 24px 16px;
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.7;
}

/* ── 移动端适配 ── */
@media (max-width: 767px) {
  .gallery {
    padding: 12px;
  }
  .gallery-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
  }
  .group-label {
    font-size: 14px;
  }
  .folder-bar {
    gap: 6px;
    padding: 2px 0 12px;
    margin-bottom: 12px;
  }
  .char-bar {
    padding-bottom: 10px;
    margin-bottom: 10px;
  }
  .char-scroll {
    gap: 8px;
  }
  /* 操作栏的负边距要跟着容器 padding 走（移动端 padding 是 12px） */
  .pick-bar {
    margin: 10px -12px -12px;
    padding: 9px 12px calc(9px + env(safe-area-inset-bottom, 0px));
    gap: 8px;
  }
  .pick-count { font-size: 12px; }
  .pick-actions { gap: 6px; }
}
</style>
