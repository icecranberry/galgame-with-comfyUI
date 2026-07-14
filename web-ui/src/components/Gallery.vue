<template>
  <div class="gallery" ref="scrollContainer" @scroll="onScroll">
    <!-- 加载状态 -->
    <div v-if="loading" class="gallery-empty">
    </div>

    <!-- 空状态 -->
    <div v-else-if="images.length === 0 && !hasMore" class="gallery-empty">
      <div class="empty-icon">📭</div>
      <p>{{ activeFolder ? '该分类暂无图片' : '相册暂无图片' }}</p>
      <p class="empty-hint">生成图片后会自动出现在这里</p>
    </div>

    <!-- 文件夹筛选按钮（常驻） -->
    <div v-if="!loading && folderButtons.length > 1" class="folder-bar">
      <button
        v-for="f in folderButtons"
        :key="f.key"
        class="folder-btn"
        :class="{ active: activeFolder === f.key }"
        @click="onFolderChange(f.key)"
      >
        <span class="folder-label">{{ f.label }}</span>
        <span class="folder-count">{{ f.count }}</span>
      </button>
    </div>

    <!-- 按时间分组的图片网格 -->
    <template v-if="images.length > 0">
      <div v-for="group in visibleDayGroups" :key="group.label" class="gallery-group">
        <div class="group-header">
          <span class="group-label">{{ group.label }}</span>
          <span class="group-count">{{ group.images.length }} 张</span>
        </div>
        <div class="gallery-grid">
          <div
            v-for="img in group.images"
            :key="img.name"
            class="gallery-item"
            @click="onPreview(img.flatIndex)"
          >
            <div
              class="img-wrapper"
              :style="{ backgroundImage: `url(${img.url})` }"
            ></div>
          </div>
        </div>
      </div>
    </template>

    <!-- 加载更多 -->
    <div v-if="!loading && hasMore && images.length > 0" class="load-more">
      <span v-if="loadingMore">加载中...</span>
      <span v-else>上滑加载更多</span>
    </div>
    <div v-else-if="!hasMore && images.length > 0" class="load-more">— 共 {{ total }} 张 —</div>

    <!-- 图片预览 Lightbox -->
    <VueEasyLightbox
      :visible="lightboxVisible"
      :imgs="lightboxImgs"
      :index="lightboxIndex"
      :max-zoom="6"
      :min-zoom="0.3"
      :zoom-scale="0.35"
      @hide="lightboxVisible = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { listGalleryImages } from '../api/index.js'
import VueEasyLightbox from 'vue-easy-lightbox'
import 'vue-easy-lightbox/dist/external-css/vue-easy-lightbox.css'

const PAGE_SIZE = 60

const emit = defineEmits(['loaded'])

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
      urls.push(img.url)
    }
  }
  return urls
})

function onPreview(flatIndex) {
  lightboxIndex.value = flatIndex
  lightboxVisible.value = true
}

function onFolderChange(key) {
  if (activeFolder.value === key) return
  activeFolder.value = key
  images.value = []
  total.value = 0
  hasMore.value = false
  loadPage(0)
}

async function loadPage(offset) {
  try {
    const data = await listGalleryImages(PAGE_SIZE, offset, activeFolder.value || '')
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
    console.error('[gallery] load images error:', err)
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
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
  images.value = []
  total.value = 0
  hasMore.value = false
  await loadPage(0)
}

defineExpose({ refresh })
</script>

<style scoped>
.gallery {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
}

/* ── 文件夹筛选栏 ── */
.folder-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  margin-bottom: 16px;
}

.folder-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.folder-btn:hover {
  background: rgba(224, 123, 108, 0.08);
  border-color: rgba(224, 123, 108, 0.2);
}

.folder-btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.folder-label {
  font-weight: 500;
}

.folder-count {
  font-size: 11px;
  opacity: 0.7;
}

/* ── 空状态 ── */
.gallery-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  gap: 8px;
}
.empty-icon { font-size: 48px; opacity: 0.6; }
.empty-hint { font-size: 12px; opacity: 0.5; }

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
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.gallery-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.08);
}

.img-wrapper {
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  background-color: rgba(0, 0, 0, 0.04);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  transition: transform 0.3s ease, background-color 0.2s ease;
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
  .folder-btn {
    padding: 5px 10px;
    font-size: 12px;
  }
}
</style>
