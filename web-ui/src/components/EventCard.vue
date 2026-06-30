<template>
  <!-- ═══ 预览卡片（列表用）。initialOpen 模式不渲染预览，直接进详情 ═══ -->
  <div v-if="!initialOpen" class="event-preview" :class="{ 'is-expired': isExpired, 'is-compact': compact, 'is-engaged': compact && event.engaged }" @click="openDetail">
    <!-- 倒计时进度条（最上方，compact 模式隐藏） -->
    <div v-if="!compact" class="countdown-bar-wrap">
      <div class="countdown-bar" :style="{ width: progressPercent + '%' }" :class="barColorClass"></div>
    </div>

    <!-- 头部：角色信息 -->
    <div class="preview-header">
      <div class="preview-avatar" :style="avatarStyle">
        <span v-if="!event.avatar_path">{{ event.display_name?.charAt(0) }}</span>
      </div>
      <div class="preview-header-info">
        <span class="preview-name">{{ event.display_name }}</span>
        <span class="preview-title">{{ event.title }}</span>
      </div>
      <span v-if="!compact" class="preview-badge" :class="{ urgent: countdownMinutes < 10 }">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
        {{ countdownText }}
      </span>
      <span v-else class="preview-badge history-time">{{ formatTime(event.ended_at || event.expires_at) }}</span>
      <!-- 更多菜单 -->
      <div class="card-more-wrap" @click.stop>
        <div class="card-more-btn" @click="showMenu = !showMenu">
          <svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor">
            <path d="M427.976 206.117c0.728 46.398 38.94 83.429 85.337 82.701 46.406-0.717 83.438-38.928 82.71-85.326-0.726-46.407-38.927-83.438-85.334-82.71-46.41 0.728-83.43 38.928-82.713 85.335z m0 614.402c0.728 46.396 38.94 83.427 85.337 82.7 46.406-0.718 83.438-38.929 82.71-85.327-0.726-46.407-38.927-83.438-85.334-82.71-46.41 0.73-83.43 38.928-82.713 85.337z m0-307.206c0.728 46.407 38.94 83.438 85.337 82.71 46.406-0.73 83.438-38.927 82.71-85.336-0.726-46.396-38.927-83.428-85.334-82.71-46.41 0.73-83.43 38.929-82.713 85.336z" />
          </svg>
        </div>
        <Transition name="menu-pop">
          <div v-if="showMenu" class="card-dropdown">
            <button class="card-dropdown-item danger" @click.stop="onDelete">🗑️ 删除</button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- 配图 -->
    <div v-if="currentImage" class="preview-image-wrap">
      <img :src="currentImage" class="preview-image" loading="lazy" alt="" />
    </div>
    <div v-else class="preview-image-placeholder">
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21,15 16,10 5,21" />
      </svg>
      <span>配图生成中…</span>
    </div>

    <!-- 底部信息 -->
    <div class="preview-footer">
      <span class="preview-text">{{ previewText }}</span>
      <div class="preview-meta-row">
        <span v-if="choiceHistory.length > 1" class="preview-meta">已推演 {{ choiceHistory.length - 1 }} 步</span>
      </div>
    </div>
  </div>

  <!-- ═══ 详情遮罩 ═══ -->
  <Teleport to="body">
    <Transition name="detail-fade">
      <div v-if="detailOpen" class="detail-overlay">
        <!-- 关闭按钮 -->
        <button class="detail-close" @click="closeDetail">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <!-- 标题浮层 -->
        <div class="detail-title-bar">
          <span class="detail-title-name">{{ event.display_name }}</span>
          <span class="detail-title-event">{{ event.title }}</span>
          <span class="detail-title-badge" :class="{ urgent: countdownMinutes < 10 }">{{ isExpired ? '已结束' : countdownText }}</span>
        </div>

        <!-- 横向滚动分支卡片 (80vh)，点击空白区域关闭，滚轮左右滑动 -->
        <div class="branch-scroll" ref="scrollEl" @click.self="closeDetail" @wheel.prevent="onWheelScroll">
          <div class="branch-track" @click.self="closeDetail">
            <!-- 所有步骤（choice_history[0]=初始场景, [1..N]=分支步骤） -->
            <div
              v-for="(step, i) in choiceHistory" :key="i"
              class="branch-card"
              :class="{
                'is-initial': i === 0,
                'is-latest': i === choiceHistory.length - 1 && !isExpired
              }"
            >
              <div class="branch-img-wrap">
                <img v-if="step.image" :src="step.image" class="branch-img" @click.stop="previewImg = step.image" />
                <div v-else class="branch-img-empty">配图生成中…</div>
              </div>
              <div class="branch-text">
                <div class="choice-made-box">
                  <div class="choice-made-label">{{ i === 0 ? '事件开始' : '选择了：' }}</div>
                  <div v-if="i > 0" class="choice-made-text">「{{ step.choice_label }}」</div>
                </div>
                <div class="branch-desc">{{ step.summary }}</div>
              </div>
            </div>

            <!-- 结局（已过期） -->
            <div v-if="isExpired" class="branch-card is-ending">
              <div class="branch-text ending-text">
                <div class="branch-label">📖 事件结束</div>
                <div class="branch-desc">{{ conclusionText }}</div>
              </div>
            </div>

            <!-- 当前选项（活跃事件末尾）· VN 风格 -->
            <div v-if="!isExpired" class="branch-card is-current">
              <div class="branch-text">
                <div class="branch-label">⚡ 做出选择 或 ✍️ 自由行动</div>
                <!-- 真实处理中（HTTP 请求已发出，不可取消） -->
                <div v-if="(choosing || event.processing) && !event._queued" class="choice-loading">
                  <div class="loading-spinner"></div>
                  <span>故事推进中…</span>
                </div>
                <!-- 排队中（尚未发送 HTTP，可取消重新选择） -->
                <div v-else-if="event._queued" class="choice-loading is-queued">
                  <div class="loading-spinner"></div>
                  <span>故事推进中…</span>
                  <button class="queued-back-btn" @click.stop="onCancelQueue">← 返回重选</button>
                </div>
                <div v-else class="vn-choices">
                  <button class="vn-choice" @click="onChoose('A')">
                    <span class="vn-choice-bar"></span>
                    <span>{{ event.choice_a }}</span>
                  </button>
                  <button class="vn-choice" @click="onChoose('B')">
                    <span class="vn-choice-bar"></span>
                    <span>{{ event.choice_b }}</span>
                  </button>
                  <div class="vn-choice-c">
                    <input v-model="customText" class="vn-input" :placeholder="event.choice_c_label || '自由行动'" @keyup.enter="onChoose('C')" />
                    <button class="vn-submit" @click="onChoose('C')" :disabled="!customText.trim()">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19,12 12,19 5,12"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- 图片预览：Teleport 到 body 并置于遮罩层之上 -->
  <Teleport to="body">
    <vue-easy-lightbox :visible="!!previewImg" :imgs="previewImg ? [previewImg] : []" :z-index="400" @hide="previewImg = null" />
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch, inject } from 'vue'
import { useEventsStore } from '../stores/events.js'
import * as api from '../api/index.js'
import VueEasyLightbox from 'vue-easy-lightbox'

const confirmFn = inject('confirm')

const props = defineProps({
  event: { type: Object, required: true },
  conclusion: { type: String, default: '' },
  compact: { type: Boolean, default: false },
  initialOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['updated'])
const store = useEventsStore()

const detailOpen = ref(false)
const customText = ref('')
const choosing = ref(false)
const previewImg = ref(null)
const scrollEl = ref(null)
const showMenu = ref(false)

// ── 倒计时 ──
const now = ref(Date.now())
let timer = null
onMounted(() => {
  timer = setInterval(() => { now.value = Date.now() }, 1000)
  if (props.initialOpen) openDetail()
})
onUnmounted(() => { if (timer) clearInterval(timer) })

const expiresAt = computed(() => props.event.expires_at ? new Date(props.event.expires_at) : null)
const isExpired = computed(() => {
  if (props.compact) return true // 历史事件一律视为已结束
  return expiresAt.value ? now.value >= expiresAt.value.getTime() : false
})
const countdownMinutes = computed(() => {
  if (!expiresAt.value) return 0
  return Math.max(0, Math.floor((expiresAt.value.getTime() - now.value) / 60000))
})

const barColorClass = computed(() => {
  if (isExpired.value) return 'bar-expired'
  const p = progressPercent.value
  if (p > 80) return 'bar-green'
  if (p > 60) return 'bar-lime'
  if (p > 40) return 'bar-yellow'
  if (p > 20) return 'bar-orange'
  return 'bar-red'
})

const progressPercent = computed(() => {
  if (!props.event.created_at || !props.event.expires_at) return 100
  const created = new Date(props.event.created_at)
  const expires = new Date(props.event.expires_at)
  const total = expires.getTime() - created.getTime()
  if (total <= 0) return 0
  const elapsed = now.value - created.getTime()
  const remaining = Math.max(0, 100 - (elapsed / total) * 100)
  return Math.min(100, Math.max(0, remaining))
})
const countdownText = computed(() => {
  if (!expiresAt.value) return ''
  if (isExpired.value) return '已结束'
  const m = countdownMinutes.value
  if (m > 60) return `${Math.floor(m / 60)}h${m % 60}m`
  if (m > 0) return `${m}分钟`
  return `${Math.max(0, Math.floor((expiresAt.value.getTime() - now.value) / 1000))}秒`
})

const choiceHistory = computed(() => {
  if (Array.isArray(props.event.choice_history)) return props.event.choice_history
  return []
})

const currentImage = computed(() => {
  if (choiceHistory.value.length > 0) return choiceHistory.value[choiceHistory.value.length - 1].image || props.event.image
  return props.event.image
})

const previewText = computed(() => {
  if (choiceHistory.value.length > 0) {
    return choiceHistory.value[choiceHistory.value.length - 1].summary || ''
  }
  return props.event.description || ''
})

const conclusionText = computed(() =>
  props.conclusion || props.event.summary || props.event.description || '事件已自然结束。'
)

const avatarStyle = computed(() => {
  const a = props.event.avatar_path
  return a ? { backgroundImage: `url(${a})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}
})

// ── 详情 ──
function openDetail() {
  detailOpen.value = true
  nextTick(() => {
    if (scrollEl.value) scrollEl.value.scrollTo({ left: scrollEl.value.scrollWidth, behavior: 'smooth' })
  })
}
function closeDetail() {
  detailOpen.value = false
  choosing.value = false // 关闭详情时重置选择状态
}

async function onDelete() {
  showMenu.value = false
  const ok = await confirmFn({ title: '删除奇遇', message: '确定要删除这条奇遇吗？', okText: '删除', danger: true })
  if (!ok) return
  await store.deleteEvent(props.event.id)
}

function formatTime(dt) {
  if (!dt) return ''
  const d = new Date(dt)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  const todayStart = new Date().setHours(0,0,0,0)
  if (d.getTime() >= todayStart) {
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0')
  }
  return (d.getMonth()+1) + '月' + d.getDate() + '日 ' +
    String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0')
}

function onWheelScroll(e) {
  if (!scrollEl.value) return
  const cardWidth = 640 + 20 // card min-width + gap
  scrollEl.value.scrollBy({
    left: e.deltaY > 0 ? cardWidth : -cardWidth,
    behavior: 'smooth',
  })
}

async function onChoose(choice) {
  if (choosing.value) return
  const eventId = props.event.id
  choosing.value = true
  customText.value = ''
  console.log(`[EventCard] onChoose START event=${eventId} choice=${choice}`)

  try {
    const result = await store.makeChoice(eventId, choice, choice === 'C' ? customText.value : '')
    console.log(`[EventCard] onChoose DONE event=${eventId} concluded=${result?.concluded} queued=${result === null}`)
    if (!result) {
      // 已排队：choosing 重置（本地状态），但 event.processing 为 true（store 状态）
      // 模板 v-if="choosing || event.processing" → 仍然显示 loading
      // SSE event_update 到达后 event.processing=false → loading 消失 + 新选项出现
      choosing.value = false
      return
    }
    if (result.concluded) {
      emit('updated', { concluded: true })
      closeDetail()
    } else if (result.event) {
      emit('updated', { event: result.event })
      nextTick(() => {
        if (scrollEl.value) scrollEl.value.scrollTo({ left: scrollEl.value.scrollWidth, behavior: 'smooth' })
      })
    }
  } catch (err) {
    console.error(`[EventCard] onChoose ERROR event=${eventId}:`, err?.message || err)
  }

  choosing.value = false
  console.log(`[EventCard] onChoose END event=${eventId} choosing reset`)
}

/** 取消排队中的选择：从队列移除 + 恢复可点击状态 */
function onCancelQueue() {
  const eventId = props.event.id
  console.log(`[EventCard] cancelQueue event=${eventId}`)
  store.cancelQueuedChoice(eventId)
  choosing.value = false
}

// 到期自动触发结局（非 compact 模式，即活跃事件到期时主动调用后端生成结局）
let _expiredTriggered = false
watch(isExpired, (val) => {
  console.log(`[EventCard] isExpired changed to ${val} for "${props.event?.title}" (compact=${props.compact}, alreadyTriggered=${_expiredTriggered})`)
  if (val && !props.compact && !_expiredTriggered) {
    _expiredTriggered = true
    const eventId = props.event.id
    console.log(`[EventCard] Scheduling auto-conclude for event ${eventId} in 2s...`)
    setTimeout(async () => {
      try {
        console.log(`[EventCard] Calling concludeEvent API for ${eventId}`)
        const res = await api.concludeEvent(eventId)
        console.log(`[EventCard] concludeEvent response for ${eventId}:`, res)
        emit('updated', { concluded: true })
      } catch (err) {
        console.error(`[EventCard] auto-conclude failed for ${eventId}:`, err)
        _expiredTriggered = false
      }
    }, 2000)
  }
})
</script>

<style scoped>
/* ═══════════════ 预览卡片（瀑布流）═══════════════ */
.event-preview {
  break-inside: avoid;
  margin-bottom: 14px;
  background: rgba(255,255,255,0.6);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 14px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid rgba(255,255,255,0.35);
  animation: event-enter 0.35s ease both;
}
@keyframes event-enter {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
.event-preview:hover { background: rgba(255,255,255,0.8); transform: translateY(-1px); }
.event-preview.is-expired { opacity: 0.5; }

/* 倒计时进度条 */
.countdown-bar-wrap {
  height: 2px; background: rgba(0,0,0,0.05);
}
.countdown-bar {
  height: 100%;
  background: var(--accent);
  transition: width 1s linear;
}
.countdown-bar.bar-green  { background: #4caf50; }
.countdown-bar.bar-lime   { background: #8bc34a; }
.countdown-bar.bar-yellow { background: #ffc107; }
.countdown-bar.bar-orange { background: #ff9800; }
.countdown-bar.bar-red    { background: #f44336; }
.countdown-bar.bar-expired { background: rgba(0,0,0,0.06); width: 100% !important; }

/* 配图 — 自然高度，驱动瀑布流变化 */
.preview-image-wrap { line-height: 0; }
.preview-image {
  width: 100%; height: auto; display: block;
  transition: transform 0.2s ease;
  cursor: pointer;
}
.preview-image:hover { transform: scale(1.03); }

.preview-image-placeholder {
  width: 100%; height: 160px;
  background: var(--bg-glass);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  color: var(--text-secondary); font-size: 12px; opacity: 0.4;
}

/* 底部信息 */
.preview-footer {
  padding: 12px 16px 14px;
}
.preview-header {
  display: flex; align-items: center; gap: 10px;
  padding: 10px;
  margin-bottom: 8px;
}
.preview-avatar {
  width: 50px; height: 50px; border-radius: 50%;
  background: var(--bg-glass); background-size: cover; background-position: center;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 16px; color: var(--text-secondary);
}
.preview-header-info { flex: 1; min-width: 0; }
.preview-name { font-size: 14px; font-weight: 600; color: var(--text-bright); display: block; }
.preview-title { font-size: 14px; color: var(--accent); font-weight: 500; }

.preview-badge {
  font-size: 11px; color: var(--text-secondary);
  display: flex; align-items: center; gap: 2px;
  padding: 3px 10px; border-radius: 10px; background: rgba(255,255,255,0.5);
  white-space: nowrap; flex-shrink: 0;
}
.preview-badge.urgent { color: var(--danger); background: rgba(224,108,102,0.08); }
.preview-badge.history-time { color: var(--text-secondary); background: transparent; padding: 0; font-size: 10px; }

/* 更多菜单 */
.card-more-wrap { position: relative; margin-left: auto; flex-shrink: 0; }
.card-more-btn {
  width: 28px; height: 28px;
  border-radius: 8px; border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.card-more-btn:hover { background: rgba(0,0,0,0.06); color: var(--text-bright); }
.card-dropdown {
  position: absolute; top: 100%; right: 0;
  margin-top: 4px;
  min-width: 100px;
  background: rgba(255,255,255,0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.1);
  padding: 4px;
  z-index: 50;
}
.card-dropdown-item {
  display: block; width: 100%;
  padding: 8px 12px; border-radius: 8px; border: none;
  background: transparent;
  font-size: 13px; color: var(--text-bright);
  cursor: pointer; text-align: left;
  transition: background 0.1s;
}
.card-dropdown-item:hover { background: rgba(0,0,0,0.05); }
.card-dropdown-item.danger { color: var(--danger); }
.card-dropdown-item.danger:hover { background: rgba(224,108,102,0.08); }

.menu-pop-enter-active, .menu-pop-leave-active { transition: all 0.15s ease; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scale(0.9); }

.preview-footer .preview-text {
  font-size: 14px; line-height: 1.5; color: #54483b;
  white-space: pre-wrap; word-break: break-word;
  margin-bottom: 8px;
}
.preview-meta-row {
  display: flex; align-items: center; justify-content: space-between;
}
.preview-meta { font-size: 11px; color: var(--text-secondary); opacity: 0.5; }
.countdown-label { font-size: 11px; color: var(--text-secondary); }
.countdown-label.urgent { color: var(--danger); font-weight: 700; }

/* compact 往期奇遇 */
.event-preview.is-compact { border-radius: 10px; }
.event-preview.is-compact .preview-image-placeholder { height: 100px; }
.event-preview.is-compact .preview-footer { padding: 8px 12px 12px; }
.event-preview.is-compact .preview-footer .preview-text { font-size: 12px; }
.event-preview.is-compact .preview-avatar { width: 40px; height: 40px; font-size: 15px; }
.event-preview.is-compact .preview-name { font-size: 13px; }
.event-preview.is-compact .preview-title { font-size: 11px; }
.event-preview.is-compact .preview-header { padding: 8px; }
.event-preview.is-compact .preview-badge { font-size: 12px; padding: 2px 8px; }
.event-preview.is-compact .countdown-bar-wrap { display: none; }

.event-preview.is-engaged {
  box-shadow: 0 0 14px rgba(224, 123, 108, 0.2), 0 0 13px 5px rgb(224 123 108 / 51%);
  border-color: rgba(224,123,108,0.2);
}

/* narrow 移动端：compact 模式 header 防挤压 — 隐藏不重要元素 */
@media (max-width: 550px) {
  .event-preview.is-compact .preview-header { gap: 8px; padding: 6px 8px; }
  .event-preview.is-compact .preview-avatar { width: 36px; height: 36px; font-size: 14px; }
  .event-preview.is-compact .preview-name { font-size: 13px; }
  .event-preview.is-compact .preview-title { font-size: 11px; }
  .event-preview.is-compact .preview-badge.history-time { display: none; }
  .event-preview.is-compact .card-more-wrap { display: none; }
  .event-preview.is-compact { margin-bottom: 0; }
  .event-preview.is-compact .preview-footer .preview-text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    overflow: hidden;
    white-space: normal;
    word-break: break-word;
  }
}

/* ═══════════════ 详情遮罩 ═══════════════ */
.detail-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(20, 20, 30, 0.4);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.detail-close {
  position: fixed; top: 16px; right: 16px; z-index: 210;
  width: 44px; height: 44px; border-radius: 50%;
  border: none; background: rgba(255,255,255,0.15);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: rgba(255,255,255,0.9);
  transition: all 0.2s;
}
.detail-close:hover { background: rgba(255,255,255,0.25); }

.detail-title-bar {
  position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 205;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 18px; border-radius: 20px;
  background: rgba(255,255,255,0.1);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.detail-title-name { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.9); }
.detail-title-event { font-size: 13px; color: rgba(255,255,255,0.65); }

@media (max-width: 550px) {
  .detail-close { display: none; }
  .detail-title-bar {
    gap: 6px; padding: 6px 12px;
    max-width: calc(100vw - 24px);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .detail-title-name { font-size: 13px; }
  .detail-title-event { font-size: 11px; }
  .detail-title-badge { font-size: 10px; padding: 2px 8px; }
}

.detail-title-badge {
  font-size: 11px; color: rgba(255,255,255,0.6);
  padding: 3px 10px; border-radius: 10px;
  background: rgba(255,255,255,0.1);
  display: flex; align-items: center; gap: 4px;
}
.detail-title-badge.urgent { color: #ff8a80; background: rgba(255,100,100,0.15); }

/* ═══════════════ 横向滚动 80vh 卡片 ═══════════════ */
.branch-scroll {
  position: absolute; inset: 0;
  overflow-x: auto; overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scroll-snap-type: x proximity;
  scroll-padding: 0 40px;
  padding: 80px 40px 20px;
}
.branch-scroll::-webkit-scrollbar { height: 4px; }
.branch-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
.branch-scroll::-webkit-scrollbar-track { background: transparent; }

.branch-track {
  display: flex; gap: 20px;
  height: 100%; align-items: center;
  width: max-content;
}

.branch-card {
  width: min(640px, 80vw);
  height: 80vh; min-height: 500px;
  flex-shrink: 0;
  background: rgba(255,255,255,0.85);
  border-radius: 20px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.15);
  display: flex; flex-direction: column;
  overflow: hidden;
  scroll-snap-align: start;
  transition: box-shadow 0.3s;
}
.branch-card.is-latest {
  box-shadow: 0 8px 40px rgba(0,0,0,0.15), 0 0 0 3px rgba(224,123,108,0.35);
  animation: highlight-pulse 2.5s ease-in-out infinite;
}
@keyframes highlight-pulse {
  0%, 100% { box-shadow: 0 8px 40px rgba(0,0,0,0.15), 0 0 0 3px rgba(224,123,108,0.4); }
  50% { box-shadow: 0 8px 40px rgba(0,0,0,0.15), 0 0 0 8px rgba(224,123,108,0.12); }
}
.branch-card.is-current { box-shadow: 0 8px 40px rgba(0,0,0,0.15), 0 0 0 4px rgba(224,123,108,0.5); }
.branch-card.is-ending {
  justify-content: center;
  background: linear-gradient(160deg, #faf8f6 0%, #f5f0ed 40%, #f8f4f0 100%);
  border: 2px solid rgba(180,160,140,0.25);
}
.branch-card.is-current .branch-text { justify-content: center; }
.branch-img-wrap {
  width: 100%;
  flex-shrink: 0;
  max-height: 60%;
  overflow: hidden;
}
.branch-img {
  width: 100%; height: auto;
  display: block;
  cursor: pointer;
  transition: opacity 0.2s;
}
.branch-img:hover { opacity: 0.9; }
.branch-img-empty {
  width: 100%; height: 200px;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-glass);
  color: var(--text-secondary); font-size: 14px; opacity: 0.4;
}

.branch-text {
  flex: 1; overflow-y: auto;
  padding: 18px 22px;
  display: flex; flex-direction: column; gap: 12px;
}
.branch-text::-webkit-scrollbar { width: 4px; }
.branch-text::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 2px; }

.branch-desc {
  font-size: 15px; line-height: 1.75; color: var(--text-bright);
}

/* ── "选择了" 框体 ── */
.choice-made-box {
  border: 1.5px solid rgba(224,123,108,0.25);
  border-radius: 10px;
  background: rgba(224,123,108,0.03);
  padding: 10px 14px;
}
.choice-made-label {
  font-size: 11px; font-weight: 600; color: var(--accent);
  margin-bottom: 4px;
}
.choice-made-text {
  font-size: 14px; line-height: 1.6; color: var(--text-bright);
  font-weight: 500;
}

/* ── VN 风格选项 ── */
.vn-choices {
  display: flex; flex-direction: column; gap: 10px;
}
.vn-choice {
  display: flex; align-items: stretch;
  padding: 0;
  border: 1.5px solid rgba(0,0,0,0.06);
  background: rgba(0,0,0,0.01);
  cursor: pointer; text-align: left;
  transition: all 0.25s ease;
  font-size: 15px; color: var(--text-bright);
  border-radius: 12px;
  overflow: hidden;
}
.vn-choice:hover { background: rgba(224,123,108,0.04); border-color: rgba(224,123,108,0.2); }
.vn-choice:hover .vn-choice-bar { background: var(--accent); width: 4px; }
.vn-choice-bar {
  width: 3px; min-width: 3px;
  background: rgba(0,0,0,0.06);
  border-radius: 0 2px 2px 0;
  transition: all 0.25s ease;
  margin: 8px 0;
}
.vn-choice span:last-child {
  padding: 14px 16px;
  line-height: 1.5;
}

.vn-choice-c {
  display: flex; align-items: center;
  border: 1.5px solid rgba(0,0,0,0.06);
  background: rgba(0,0,0,0.01);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s;
}
.vn-choice-c:focus-within { border-color: rgba(224,123,108,0.25); }
.vn-input {
  flex: 1; border: none; background: transparent;
  font-size: 15px; color: var(--text-bright); outline: none;
  padding: 14px 16px;
}
.vn-input::placeholder { color: var(--text-secondary); opacity: 0.45; }
.vn-submit {
  width: 48px; align-self: stretch;
  border: none; background: transparent;
  color: var(--text-secondary);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
  border-left: 1px solid rgba(0,0,0,0.06);
}
.vn-submit:hover:not(:disabled) { background: rgba(224,123,108,0.08); color: var(--accent); }
.vn-submit:disabled { opacity: 0.2; cursor: default; }

.choice-loading {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 32px; color: var(--text-secondary); font-size: 13px;
}
/* 排队中的 loading：右下角显示取消按钮 */
.choice-loading.is-queued {
  position: relative; flex-direction: column; gap: 14px;
}
.queued-back-btn {
  padding: 4px 14px; border: 1px solid rgba(0,0,0,0.12); border-radius: 14px;
  background: rgba(255,255,255,0.7); color: var(--text-secondary);
  font-size: 11px; cursor: pointer; transition: all 0.2s;
}
.queued-back-btn:hover {
  background: rgba(0,0,0,0.04); color: var(--text-primary); border-color: rgba(0,0,0,0.2);
}
.loading-spinner {
  width: 18px; height: 18px;
  border: 2px solid rgba(224,123,108,0.15); border-top-color: var(--accent);
  border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.branch-label {
  font-size: 12px; font-weight: 700; color: rgba(0,0,0,0.4);
  letter-spacing: 0.5px;
}

.ending-text {
  justify-content: flex-start;
  align-items: center;
  text-align: center;
  padding: 40px 32px;
}
.ending-text .branch-label {
  font-size: 14px;
  color: rgba(0,0,0,0.35);
  margin-bottom: 16px;
}
.ending-text .branch-desc {
  font-size: 17px;
  line-height: 1.8;
  max-width: 480px;
}

/* transition */
.detail-fade-enter-active, .detail-fade-leave-active { transition: opacity 0.3s ease; }
.detail-fade-enter-from, .detail-fade-leave-to { opacity: 0; }
</style>

<style>
/* lightbox 必须在 detail-overlay (z-index:200) 之上 */
.vel-modal, .vel-img-wrapper, .vel-img {
  z-index: 999 !important;
}
</style>
