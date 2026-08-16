<template>
  <Teleport v-if="ready" to="body">
    <div class="live-toast-host __toast__root" aria-live="polite" style="z-index: 99999; isolation: isolate;">
      <TransitionGroup name="lt" @before-leave="pinLeaving">
        <div
          v-for="item in toasts"
          :key="item.id"
          class="live-toast"
          :class="'live-toast--' + item.type"
          :style="{ '--lt-life': item.duration + 'ms' }"
          @mouseenter="pauseItem(item)"
          @mouseleave="resumeItem(item)"
          @click="dismiss(item.id)"
        >
          <svg class="live-toast-mark" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <!-- success -->
            <template v-if="item.type === 'success'">
              <path d="M4.6 10.2 8 13.6l7.4-7.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </template>
            <!-- warning -->
            <template v-else-if="item.type === 'warning'">
              <path d="M10 3.6 16.85 15.7H3.15L10 3.6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <path d="M10 8.9v3.2M10 14.1h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </template>
            <!-- error -->
            <template v-else-if="item.type === 'error'">
              <circle cx="10" cy="10" r="7.2" stroke="currentColor" stroke-width="1.6"/>
              <path d="m7.7 7.7 4.6 4.6M12.3 7.7l-4.6 4.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </template>
            <!-- info -->
            <template v-else>
              <circle cx="10" cy="10" r="7.2" stroke="currentColor" stroke-width="1.6"/>
              <path d="M10 8.7V13M10 5.9h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </template>
          </svg>
          <div class="live-toast-body">
            <p class="live-toast-message" :class="{ 'is-title': item.description }">{{ item.message }}</p>
            <p v-if="item.description" class="live-toast-note">{{ item.description }}</p>
          </div>
          <button class="live-toast-close" type="button" aria-label="关闭" @click.stop="dismiss(item.id)">
            <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M1.6 1.6l6.8 6.8M8.4 1.6 1.6 8.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <span class="live-toast-life" aria-hidden="true"></span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const MAX_VISIBLE = 4

let _id = 0
const toasts = ref([])
const ready = ref(false)

// 兼容旧签名 show(message, type, duration),也接受 show({ message, description, type, duration })
function show(message, type = 'info', duration, description) {
  if (message && typeof message === 'object') {
    const opts = message
    message = opts.message
    type = opts.type ?? type
    duration = opts.duration ?? duration
    description = opts.description ?? description
  }
  if (duration === undefined) {
    duration = type === 'error' ? 4500 : 3000
  }
  const item = {
    id: ++_id,
    message: String(message ?? ''),
    description: description || '',
    type,
    duration,
    elapsed: 0,
    startedAt: performance.now(),
    timer: null,
  }
  item.timer = setTimeout(() => dismiss(item.id), duration)
  // 新 Toast 落在最上方
  toasts.value.unshift(item)
  // 超出上限时最早的先离场
  while (toasts.value.length > MAX_VISIBLE) {
    dismiss(toasts.value[toasts.value.length - 1].id)
  }
}

function dismiss(id) {
  const idx = toasts.value.findIndex(t => t.id === id)
  if (idx === -1) return
  const [item] = toasts.value.splice(idx, 1)
  clearTimeout(item.timer)
}

// 悬停暂停:冻结剩余时长,与底部生命周期线的 animation-play-state 同步
function pauseItem(item) {
  if (!item.timer) return
  clearTimeout(item.timer)
  item.timer = null
  item.elapsed += performance.now() - item.startedAt
}

function resumeItem(item) {
  if (item.timer) return
  if (!toasts.value.some(t => t.id === item.id)) return
  const remaining = item.duration - item.elapsed
  if (remaining <= 60) {
    dismiss(item.id)
    return
  }
  item.startedAt = performance.now()
  item.timer = setTimeout(() => dismiss(item.id), remaining)
}

// 退场时先把卡片钉在原位,让堆叠中的其余卡片平滑上移
// 钉位以宿主右缘为基准:宿主右缘固定(right: 24px),不会因失去唯一子元素而塌缩
function pinLeaving(el) {
  const host = el.parentElement
  if (!host) return
  const hostRect = host.getBoundingClientRect()
  const rect = el.getBoundingClientRect()
  el.style.right = `${hostRect.right - rect.right}px`
  el.style.top = `${rect.top - hostRect.top}px`
  el.style.width = `${rect.width}px`
  el.style.height = `${rect.height}px`
}

onMounted(() => {
  setTimeout(() => { ready.value = true })
})

defineExpose({ show })
</script>

<style>
.__toast__root {
  z-index: 99999 !important;
  isolation: isolate;
}
</style>

<style scoped>
/* ── 宿主:固定右上角,不占布局空间 ── */
.live-toast-host {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
  pointer-events: none;
}

/* ── 卡片:暖灰纸张质感的状态卡 ── */
.live-toast {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  width: max-content;
  min-width: 280px;
  max-width: 380px;
  padding: 15px 14px 15px 18px;
  background: #F7F4EF;
  border: 1px solid rgba(224, 123, 108, 0.18);
  /* 边框染上低透明度状态色,与图标、生命周期线呼应;color-mix 不支持时退回上面的暖色边 */
  border-color: color-mix(in srgb, var(--lt-status, #E07B6C) 30%, transparent);
  border-radius: 18px;
  box-shadow: 0 12px 35px rgba(50, 40, 35, 0.12);
  overflow: hidden;
  cursor: pointer;
  pointer-events: auto;
  word-break: break-word;
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}
.live-toast:hover {
  box-shadow: 0 14px 38px rgba(50, 40, 35, 0.15);
  border-color: color-mix(in srgb, var(--lt-status, #E07B6C) 50%, transparent);
}

/* 状态色只落在标记与生命周期线上,不染整张卡;四态色相彼此拉开 */
.live-toast--success { --lt-status: #4E9C72; }  /* 茶绿 */
.live-toast--info    { --lt-status: #E07B6C; }  /* 品牌:珊瑚 */
.live-toast--warning { --lt-status: #D8A03A; }  /* 琥珀 */
.live-toast--error   { --lt-status: #C24A3E; }  /* 绯红 */

.live-toast-mark {
  width: 21px;
  height: 21px;
  flex-shrink: 0;
  color: var(--lt-status, #E07B6C);
}

.live-toast-body {
  flex: 1;
  min-width: 0;
}
.live-toast-message {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
  color: #3E3A36;
}
.live-toast-message.is-title {
  font-size: 15px;
  font-weight: 600;
}
.live-toast-note {
  margin-top: 2px;
  font-size: 12.5px;
  line-height: 1.45;
  color: #8B8179;
}

.live-toast-close {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: #B4AA9E;
  opacity: 0.55;
  transition: opacity 0.18s ease, color 0.18s ease, background-color 0.18s ease;
}
.live-toast:hover .live-toast-close { opacity: 0.9; }
.live-toast-close:hover {
  opacity: 1;
  color: #6F655C;
  background: rgba(62, 58, 54, 0.06);
}
.live-toast-close svg {
  width: 10px;
  height: 10px;
}

/* ── 生命周期进度线:随剩余时间从右向左收缩 ── */
.live-toast-life {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--lt-status, #E07B6C);
  transform-origin: right center;
  animation: lt-life var(--lt-life, 3000ms) linear forwards;
}
.live-toast:hover .live-toast-life {
  animation-play-state: paused;
}
@keyframes lt-life {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}

/* ── 进场:从右侧轻轻探出来 ── */
.lt-enter-active {
  animation: lt-pop-in 340ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes lt-pop-in {
  0%   { opacity: 0; transform: translateX(28px) scale(0.97); }
  58%  { opacity: 1; transform: translateX(-1.5px) scale(1.004); }
  100% { opacity: 1; transform: translateX(0) scale(1); }
}

/* ── 退场:比进场更快,轻轻向右缩回 ── */
.lt-leave-active {
  position: absolute;
  pointer-events: none;
  transition: opacity 200ms cubic-bezier(0.45, 0, 0.85, 0.6),
              transform 200ms cubic-bezier(0.45, 0, 0.85, 0.6);
}
.lt-leave-to {
  opacity: 0;
  transform: translateX(12px) translateY(-4px);
}

/* ── 堆叠中的既有卡片平滑让位 ── */
.lt-move {
  transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .lt-enter-active { animation: lt-fade-in 160ms ease both; }
  .lt-leave-active { transition: opacity 120ms ease; }
  .lt-leave-to { transform: none; }
  .lt-move { transition: transform 160ms ease; }
}
@keyframes lt-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ── 移动端:收紧边距,宽度不越界 ── */
@media (max-width: 640px) {
  .live-toast-host {
    top: max(12px, env(safe-area-inset-top, 12px));
    right: 12px;
  }
  .live-toast {
    min-width: min(280px, calc(100vw - 24px));
    max-width: calc(100vw - 24px);
  }
}
</style>
