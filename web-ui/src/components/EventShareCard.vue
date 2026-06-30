<template>
  <!-- 奇遇分享卡片 — QQ/微信分享卡片风格 -->
  <div class="event-share-card" :class="{ 'is-expired': isExpired, 'no-event': !hasData && !msg.eventId }" @click="onClick">
    <!-- 骨架屏：无数据时 -->
    <template v-if="!hasData">
      <div class="card-image skeleton"></div>
      <div class="card-body">
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line skeleton-desc"></div>
      </div>
    </template>

    <!-- 正常渲染 -->
    <template v-else>
      <div class="card-image">
        <img v-if="eventImage" :src="eventImage" alt="" @error="onImgError" />
        <div v-else class="card-image-empty">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21,15 16,10 5,21" />
          </svg>
        </div>
      </div>
      <div class="card-body">
        <div class="card-title">{{ eventTitle }}</div>
        <div class="card-desc">{{ eventDesc }}</div>
        <div class="card-status" :class="{ urgent: countdownMinutes > 0 && countdownMinutes < 10 }">
          <svg v-if="!isExpired" class="status-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/>
          </svg>
          <svg v-else class="status-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M9 9l6 6M15 9l-6 6"/>
          </svg>
          <span>{{ statusText }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useEventsStore } from '../stores/events.js'

const props = defineProps({
  msg: { type: Object, required: true },
})
const emit = defineEmits(['open-detail'])

const eventsStore = useEventsStore()
const imgFailed = ref(false)

// ── 数据源优先级：eventData(SSE快照) → store(响应式) → API(异步兜底) ──
const eventSnapshot = computed(() => props.msg.eventData || null)

// 从 eventsStore 查找实时事件（活跃事件优先）
const liveEvent = computed(() => {
  if (!props.msg.eventId) return null
  return eventsStore.activeEvents?.find(e => e.id === props.msg.eventId) || null
})

const hasData = computed(() => !!(eventSnapshot.value || liveEvent.value))

// ── 显示字段 ──
const eventTitle = computed(() =>
  liveEvent.value?.title || eventSnapshot.value?.title || '奇遇事件'
)
const eventDesc = computed(() => {
  const desc = liveEvent.value?.description || eventSnapshot.value?.description || ''
  return desc
})
const eventImage = computed(() => {
  if (imgFailed.value) return null
  // liveEvent 中最新分支的图片优先
  if (liveEvent.value?.choice_history?.length > 0) {
    const latest = liveEvent.value.choice_history[liveEvent.value.choice_history.length - 1]
    if (latest.image) return latest.image
  }
  return liveEvent.value?.image || eventSnapshot.value?.image || null
})

// ── 过期判定 ──
const now = ref(Date.now())
let timer = null
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 5000) })
onUnmounted(() => { if (timer) clearInterval(timer) })

const expiresAtRaw = computed(() =>
  liveEvent.value?.expires_at || eventSnapshot.value?.expires_at || null
)
const expiresAt = computed(() => expiresAtRaw.value ? new Date(expiresAtRaw.value) : null)
const isExpired = computed(() => {
  if (liveEvent.value) {
    // 已在事件历史中 = 已结束
    return false // liveEvent 保证是活跃的
  }
  // 无 liveEvent + 无快照 = 已结束（从历史加载）
  if (!eventSnapshot.value && !liveEvent.value) return true
  // 无 liveEvent 但有快照 → 检查快照中的过期时间
  if (!expiresAt.value) return true
  return now.value >= expiresAt.value.getTime()
})
const countdownMinutes = computed(() => {
  if (!expiresAt.value || isExpired.value) return 0
  return Math.max(0, Math.floor((expiresAt.value.getTime() - now.value) / 60000))
})
const statusText = computed(() => {
  if (isExpired.value) return '已结束'
  if (!expiresAt.value) return ''
  const m = countdownMinutes.value
  if (m > 60) return `${Math.floor(m / 60)}h${m % 60}m`
  if (m > 0) return `${m}分钟`
  return '即将结束'
})

// ── 点击 ──
function onClick() {
  // 始终允许点击，数据缺失由 ChatView 的 API 兜底
  emit('open-detail', props.msg.eventId)
}

function onImgError() {
  imgFailed.value = true
}
</script>

<style scoped>
.event-share-card {
  display: flex;
  width: 420px;
  max-width: 100%;
  background: #faf9f7;
  border: 1px solid #e0dbd3;
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s, opacity 0.3s;
  user-select: none;
}
.event-share-card:hover {
  border-color: #d4c8b8;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}
.event-share-card:active {
  transform: scale(0.985);
}

/* 完全无数据骨架屏：仅视觉降级，仍可点击（由 API 兜底） */
.event-share-card.no-event {
  opacity: 0.6;
}

/* ── 左侧图片 ── */
.card-image {
  width: 200px;
  height: 150px; /* 4:3 */
  flex-shrink: 0;
  background: #efece6;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.card-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.card-image-empty {
  color: #c4bdb0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── 右侧正文 ── */
.card-body {
  flex: 1;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: #4a3728;
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}
.card-desc {
  font-size: 13px;
  color: #6b5d4f;
  line-height: 1.5;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  flex: 1;
}
.card-status {
  font-size: 11.5px;
  color: #a09080;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: auto;
}
.card-status.urgent {
  color: #c0392b;
}
.status-icon {
  flex-shrink: 0;
}

/* ── 骨架屏 ── */
.skeleton {
  background: linear-gradient(110deg, #e8e4dc 30%, #f0ede6 50%, #e8e4dc 70%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.skeleton-line {
  border-radius: 4px;
  background: linear-gradient(110deg, #e8e4dc 30%, #f0ede6 50%, #e8e4dc 70%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  height: 12px;
}
.skeleton-title { width: 75%; }
.skeleton-desc { width: 90%; margin-top: 4px; }

/* ── 移动端 ── */
@media (max-width: 767px) {
  .card-image {
    width: 130px;
    height: 130px;
  }
}
</style>
