<template>
  <div class="gallery" ref="scrollContainer" @scroll="onScroll">
    <!-- 加载状态 -->
    <div v-if="loading" class="gallery-empty">
    <!-- 置空不填 -->
    </div>

    <!-- 空状态 -->
    <div v-else-if="images.length === 0" class="gallery-empty">
      <div class="empty-icon">📭</div>
      <p>相册暂无图片</p>
      <p class="empty-hint">生成图片后会自动出现在这里</p>
    </div>

    <!-- 按时间分组的图片网格 -->
    <template v-else>
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
    <div v-else-if="!hasMore && images.length > 0" class="load-more">— 共 {{ images.length }} 张 —</div>

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

const emit = defineEmits(['loaded'])

const images = ref([])
const loading = ref(true)
const loadingMore = ref(false)
const visibleDays = ref(2)  // 初始只展示 2 组（今天 + 昨天）
const lightboxVisible = ref(false)
const lightboxIndex = ref(0)
const scrollContainer = ref(null)

// 将所有图片按天分组（全部数据，仅内存操作）
const allDayGroups = computed(() => {
  if (images.value.length === 0) return []

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  const thisYear = now.getFullYear()

  const map = new Map()  // key: dayStart (ms), value: { label, images }

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

  // 按 dayStart 倒序排列（最新在前）
  return [...map.values()].sort((a, b) => b.dayStart - a.dayStart)
})

// 当前可见的分组
const visibleDayGroups = computed(() => {
  const groups = allDayGroups.value.slice(0, visibleDays.value)

  // 为每张图片嵌入 flatIndex，供 lightbox 定位
  let idx = 0
  for (const group of groups) {
    for (const img of group.images) {
      img.flatIndex = idx++
    }
  }

  return groups
})

// 可见图片的 URL 扁平数组，供 lightbox 使用
const lightboxImgs = computed(() => {
  const urls = []
  for (const group of visibleDayGroups.value) {
    for (const img of group.images) {
      urls.push(img.url)
    }
  }
  return urls
})

const hasMore = computed(() => visibleDays.value < allDayGroups.value.length)

function onPreview(flatIndex) {
  lightboxIndex.value = flatIndex
  lightboxVisible.value = true
}

function onScroll() {
  const el = scrollContainer.value
  if (!el || loadingMore.value || !hasMore.value) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
    loadingMore.value = true
    // 延迟一小段让用户感知加载过程
    setTimeout(() => {
      visibleDays.value = Math.min(visibleDays.value + 2, allDayGroups.value.length)
      loadingMore.value = false
    }, 200)
  }
}

onMounted(async () => {
  try {
    const data = await listGalleryImages()
    images.value = data.images || []
    emit('loaded', images.value.length)
  } catch (err) {
    console.error('[gallery] load images error:', err)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.gallery {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
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
}
</style>
