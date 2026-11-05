<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="drawer-overlay" @click.self="emit('close')" @keydown.stop="onDrawerKeydown" @keyup.stop>
        <div ref="drawerPanel" class="drawer-panel" role="dialog" aria-modal="true" :aria-label="`${char?.display_name || '天使'}的日程`" tabindex="-1" @click.stop>
          <!-- 头部：头像 + 信息 + 关闭 -->
          <div class="dr-header">
            <div class="dr-row1">
              <div class="dr-avatar">
                <img v-if="char?.avatar_path" :src="char.avatar_path" class="dr-avatar-img" alt="" />
                <span v-else class="dr-avatar-text">{{ char?.display_name?.charAt(0) || '' }}</span>
              </div>
              <div class="dr-info">
                <h3>{{ char?.display_name || '' }}</h3>
                <div v-if="currentAct" class="dr-now">
                  <div class="dr-now-line">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                    <span>{{ currentAct.activity }}</span>
                  </div>
                  <div v-if="currentAct.location" class="dr-now-line">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                    <span>{{ currentAct.location }}</span>
                  </div>
                </div>
                <div v-else class="dr-now dr-no-data">还没安排日程</div>
              </div>
              <linshe-close-button class="dr-close" @click="emit('close')" />
            </div>

            <!-- 操作按钮：瞄一眼 -->
            <div v-if="items.length" class="dr-row2">
              <linshe-button variant="secondary" class="dr-btn" :disabled="peekBusy" @click="emit('peek')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                <span>瞄一眼</span>
              </linshe-button>
            </div>
          </div>

          <!-- 时间轴 -->
          <div class="dr-body">
            <div v-if="loading" class="dr-skel">
              <div class="sk-line" v-for="n in 5" :key="n" :style="{ width: (50 + Math.random() * 45) + '%' }"></div>
            </div>
            <div v-else-if="!items.length" class="dr-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              <p>还没有日程安排</p>
            </div>
            <div v-else class="dr-timeline">
              <div
                v-for="(act, i) in items"
                :key="i"
                class="tl-item"
                @mouseenter="onEnter($event, act.description)"
                @mousemove="onMove"
                @mouseleave="onLeave"
                :class="{ 'tl-curr': act.isCurrent, 'tl-sleep': act.replyDelay === -1 }"
              >
                <div class="tl-node">
                  <div class="tl-d"></div>
                  <div v-if="i < items.length - 1" class="tl-l"></div>
                </div>
                <div class="tl-t">{{ act.startTime }}</div>
                <div class="tl-content">
                  <div class="tl-top">
                    <span class="tl-act">{{ act.activity }}</span>
                    <linshe-button variant="icon" size="sm" class="tl-peek-btn" title="瞄一眼这个瞬间" :disabled="peekBusy" @click.stop="emit('peek-at', act)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                    </linshe-button>
                  </div>
                  <div v-if="act.location" class="tl-loc">{{ act.location }}</div>
                  <div v-if="act.isCurrent" class="tl-mark">
                    <span class="pulse"></span>此刻
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Tooltip -->
    <Teleport to="body">
      <div v-if="tooltip.show" class="hover-tip" :class="{ flip: tooltip.flip }" :style="tipStyle">
        {{ tooltip.text }}
      </div>
    </Teleport>
  </Teleport>
</template>

<script setup>
import LinsheCloseButton from "../ui/LinsheCloseButton.vue"

import { computed, nextTick, ref, watch, onUnmounted } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import { useTooltip } from '../../composables/useTooltip.js'

const props = defineProps({
  open: Boolean,
  char: { type: Object, default: null },
  activities: { type: Array, default: () => [] },
  loading: Boolean,
  peekBusy: Boolean,
})
const emit = defineEmits(['close', 'peek', 'peek-at'])
const { tooltip, tipStyle, onEnter, onMove, onLeave } = useTooltip()

function minutesOf(text) {
  const m = /^(\d{1,2}):(\d{2})/.exec(text || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const items = computed(() => {
  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return (props.activities || []).map(act => {
    if (typeof act.isCurrent === 'boolean') return act
    const start = minutesOf(act.startTime)
    const end = minutesOf(act.endTime)
    return { ...act, isCurrent: start !== null && end !== null && nowMinutes >= start && nowMinutes < end }
  })
})
const currentAct = computed(() => items.value.find(a => a.isCurrent) || null)

const drawerPanel = ref(null)
let returnFocus = null
watch(() => props.open, async open => {
  if (open) {
    returnFocus = document.activeElement
    await nextTick()
    if (props.open) drawerPanel.value?.focus({ preventScroll: true })
  } else if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
}, { immediate: true })
onUnmounted(() => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }) })

function onDrawerKeydown(event) {
  if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); emit('close'); return }
  if (event.key !== 'Tab' || !drawerPanel.value) return
  const nodes = [...drawerPanel.value.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length)
  const first = nodes[0], last = nodes.at(-1)
  if (!first) { event.preventDefault(); drawerPanel.value.focus() }
  else if (event.shiftKey && [first, drawerPanel.value].includes(document.activeElement)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && [last, drawerPanel.value].includes(document.activeElement)) { event.preventDefault(); first.focus() }
}
</script>

<style scoped>
/* ── Overlay ── */
.drawer-overlay {
  position: fixed; inset: 0; z-index: 900;
  background: rgba(0,0,0,0.2);
  display: flex; justify-content: flex-end;
}
.drawer-panel {
  width: 420px; max-width: 92vw; height: 100vh; height: 100dvh;
  background: var(--bg-secondary); border-left: 1px solid var(--border);
  display: flex; flex-direction: column;
  box-shadow: -4px 0 30px rgba(0,0,0,0.08);
}

/* ── Header ── */
.dr-header {
  padding: 20px 20px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  display: flex; flex-direction: column; gap: 14px;
}
.dr-row1 { display: flex; align-items: center; gap: 14px; }
.dr-avatar {
  width: 52px; height: 52px; border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.dr-avatar-img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block; }
.dr-avatar-text { color: var(--on-accent); font-size: 22px; font-weight: 600; line-height: 1; user-select: none; }
.dr-info { flex: 1; min-width: 0; }
.dr-info h3 { margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--text-bright); line-height: 1.3; }
.dr-now { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; font-size: 0.8rem; color: var(--text-secondary); overflow: hidden; }
.dr-no-data { color: var(--text-secondary); font-style: italic; }
.dr-now-line { display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dr-now-line svg { flex-shrink: 0; opacity: 0.4; color: var(--text-secondary); }
.dr-close { display: none; flex-shrink: 0; }

/* Row 2: action buttons */
.dr-row2 { display: flex; gap: 8px; flex-wrap: wrap; }
.dr-btn { display: inline-flex; align-items: center; gap: 5px; }
.dr-btn svg { flex-shrink: 0; }

/* ── Body ── */
.dr-body { flex: 1; overflow-y: auto; padding: 14px 20px; user-select: none; cursor: default; position: relative; scrollbar-width: none; }
.dr-body::-webkit-scrollbar { display: none; }

.dr-skel { padding: 8px 0; }
.sk-line { height: 11px; border-radius: 6px; background: var(--bg-hover); margin-bottom: 10px; animation: sk 1.5s ease-in-out infinite; }
@keyframes sk { 0%,100%{opacity:.3} 50%{opacity:.7} }

.dr-empty {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 48px 0; color: var(--text-secondary);
  gap: 8px;
}
.dr-empty p { margin: 0; font-size: 0.9rem; }

/* ── Timeline ── */
.tl-item {
  display: grid; grid-template-columns: 18px 50px 1fr;
  gap: 8px; align-items: stretch; padding: 4px 0;
}
.tl-node { display: flex; flex-direction: column; align-items: center; padding-top: 5px; }
.tl-d { width: 9px; height: 9px; border-radius: 50%; background: var(--border-strong); flex-shrink: 0; }
.tl-curr .tl-d { background: #52c41a; box-shadow: 0 0 0 4px rgba(82,196,26,0.12); }
.tl-sleep:not(.tl-curr) .tl-d { background: var(--border); }
.tl-l { width: 1.5px; flex: 1; min-height: 22px; background: var(--border); margin-top: 3px; margin-bottom: -14px; }
.tl-item:last-child .tl-l { display: none; }

.tl-t {
  font-size: 0.7rem; color: var(--text-secondary);
  font-variant-numeric: tabular-nums; padding-top: 3px; white-space: nowrap;
}
.tl-curr .tl-t { color: #389e0d; font-weight: 600; }

.tl-content {
  background: var(--glass-bg); border: 1px solid var(--glass-border);
  border-radius: 8px; padding: 0px 12px 8px;
  position: relative;
}
.tl-curr .tl-content { border-color: rgba(82,196,26,0.2); background: rgba(82,196,26,0.03); }

.tl-top { display: flex; align-items: center; gap: 6px; }
.tl-act { font-size: 0.85rem; color: var(--text-bright); font-weight: 500; }
.tl-peek-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; flex-shrink: 0;
  opacity: 0; transition: opacity 0.2s;
  margin-left: auto;
}
.tl-item:hover .tl-peek-btn { opacity: 0.35; }
.tl-peek-btn:hover { opacity: 1 !important; }
@media (hover: none) { .tl-peek-btn { opacity: 0.55; } }
.tl-loc { font-size: 0.75rem; color: var(--text-secondary); margin-top: 3px; }

.tl-mark {
  display: flex; align-items: center; gap: 5px; margin-top: 6px;
  font-size: 0.75rem; font-weight: 600; color: #389e0d;
}
.pulse {
  width: 7px; height: 7px; border-radius: 50%; background: #52c41a;
  animation: pulse2 2s ease-in-out infinite;
}
@keyframes pulse2 {
  0%,100%{ box-shadow:0 0 0 0 rgba(82,196,26,0.5) }
  50%{ box-shadow:0 0 0 5px rgba(82,196,26,0) }
}

/* ── Transition ── */
.drawer-enter-active, .drawer-leave-active { transition: opacity 0.2s; }
.drawer-enter-active .drawer-panel, .drawer-leave-active .drawer-panel { transition: transform 0.25s cubic-bezier(0.4,0,0.2,1); }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .drawer-panel { transform: translateX(40px); }
.drawer-leave-to .drawer-panel { transform: translateX(40px); }

@media (max-width: 767px) {
  .drawer-panel { width: 100vw; max-width: 100vw; }
  .dr-close { display: flex; }
}

/* ── Tooltip ── */
.hover-tip {
  position: fixed; z-index: 2000; pointer-events: none;
  max-width: 260px; padding: 6px 12px;
  background: rgba(40,40,40,0.88); color: #f0f0f0;
  border-radius: 8px; font-size: 0.78rem; line-height: 1.5;
  box-shadow: 0 4px 14px rgba(0,0,0,0.18);
  backdrop-filter: blur(6px);
}
</style>
