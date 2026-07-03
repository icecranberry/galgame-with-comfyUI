<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="drawer-overlay" @click.self="$emit('close')">
        <div class="drawer-panel" @click.stop>
          <!-- 头部：分两行 -->
          <div class="dr-header">
            <!-- Row 1: 头像 + 信息 + 关闭 -->
            <div class="dr-row1">
              <img
                class="dr-avatar"
                :src="char?.avatar_path || '/avatars/default.png'"
                @error="($event.target as HTMLImageElement).src = '/avatars/default.png'"
              />
              <div class="dr-info">
                <h3>{{ char?.display_name || '' }}</h3>
                <div v-if="currentAct" class="dr-now">
                  <span class="dr-act-text">{{ currentAct.activity }}</span>
                  <span class="dr-sep">·</span>
                  <span class="dr-loc-text">{{ currentAct.location }}</span>
                </div>
                <div v-else class="dr-now dr-no-data">还没安排日程</div>
              </div>
              <button class="dr-close" @click="$emit('close')">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <!-- Row 2: 操作按钮 -->
            <div class="dr-row2">
              <button class="dr-btn" @click="$emit('peek')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <span>瞄一眼</span>
              </button>
              <button class="dr-btn" @click="$emit('regenerate')" :disabled="regenerating">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                <span>{{ scheduleBtnText }}</span>
              </button>
            </div>
          </div>

          <!-- 时间轴 -->
          <div class="dr-body">
            <!-- 加载骨架 -->
            <div v-if="loading" class="dr-skel">
              <div class="sk-line" v-for="n in 5" :key="n" :style="{ width: (50 + Math.random() * 45) + '%' }"></div>
            </div>

            <!-- 空 -->
            <div v-else-if="!activities.length" class="dr-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <p>还没有日程安排</p>
            </div>

            <!-- 时间轴 -->
            <div v-else class="dr-timeline">
              <div
                v-for="(act, i) in activities"
                :key="i"
                class="tl-item"
                @mouseenter="(e) => onEnter(e, act.description)"
                @mousemove="onMove"
                @mouseleave="onLeave"
                :class="{
                  'tl-curr': act.isCurrent,
                  'tl-sleep': act.replyDelay === -1,
                }"
              >
                <div class="tl-node">
                  <div class="tl-d"></div>
                  <div v-if="i < activities.length - 1" class="tl-l"></div>
                </div>
                <div class="tl-t">{{ act.startTime }}</div>
                <div class="tl-content">
                  <div class="tl-top">
                    <span class="tl-act">{{ act.activity }}</span>
                  </div>
                  <div class="tl-loc">{{ act.location }}</div>
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
      <div
        v-if="tooltip.show"
        class="hover-tip"
        :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
      >{{ tooltip.text }}</div>
    </Teleport>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTooltip } from '../composables/useTooltip.js'

const props = defineProps<{
  open: boolean
  char: any
  activities: any[]
  loading: boolean
  peekBusy: boolean
  regenerating?: boolean
}>()

defineEmits(['close', 'peek', 'regenerate'])

const { tooltip, onEnter, onMove, onLeave } = useTooltip()

const currentAct = computed(() => props.activities.find((a: any) => a.isCurrent) || null)

const scheduleBtnText = computed(() => {
  if (props.regenerating) return '生成中...'
  if (!props.loading && !props.activities.length) return '为ta制作日程表'
  return '改变ta的日程'
})

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
  background: #fff; border-left: 1px solid var(--border);
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

/* Row 1: avatar + info + close */
.dr-row1 {
  display: flex; align-items: center; gap: 14px;
}

.dr-avatar {
  width: 52px; height: 52px; border-radius: 50%; object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.dr-info {
  flex: 1; min-width: 0;
}
.dr-info h3 {
  margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--text-bright);
  line-height: 1.3;
}
.dr-now {
  display: flex; align-items: center; gap: 5px;
  margin-top: 4px; font-size: 0.8rem; color: var(--text-secondary);
  white-space: nowrap; overflow: hidden;
}
.dr-no-data {
  color: #bfbbb6; font-style: italic;
}

.dr-act-text { color: var(--text-bright); font-weight: 500; }
.dr-sep { color: #d9d6d0; flex-shrink: 0; }
.dr-loc-text { overflow: hidden; text-overflow: ellipsis; }

.dr-close {
  display: none; align-items: center; justify-content: center;
  width: 34px; height: 34px; flex-shrink: 0;
  border: 1px solid var(--border); border-radius: 50%;
  background: var(--glass-bg); color: var(--text-secondary);
  cursor: pointer; transition: 0.15s; padding: 0;
}
.dr-close:hover { background: rgba(255,77,79,0.08); color: #ff4d4f; border-color: rgba(255,77,79,0.2); }


/* Row 2: action buttons */
.dr-row2 {
  display: flex; gap: 8px;
}

.dr-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--accent); border-radius: 8px;
  background: var(--accent);
  color: #fff; font-size: 0.82rem;
  cursor: pointer; transition: 0.15s;
}
.dr-btn svg { flex-shrink: 0; }
.dr-btn:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); box-shadow: 0 2px 12px rgba(224, 123, 108, 0.25); }
.dr-btn:disabled { opacity: 0.35; cursor: not-allowed; }

/* ── Body ── */
.dr-body { flex: 1; overflow-y: auto; padding: 14px 20px; user-select: none; cursor: default;}

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
  gap: 8px; align-items: start; padding: 4px 0;
}

.tl-node { display: flex; flex-direction: column; align-items: center; padding-top: 5px; }
.tl-d { width: 9px; height: 9px; border-radius: 50%; background: #d9d9d9; flex-shrink: 0; }
.tl-curr .tl-d { background: #52c41a; box-shadow: 0 0 0 4px rgba(82,196,26,0.12); }
.tl-sleep .tl-d { background: #bfbfbf; }
.tl-l { width: 1.5px; flex: 1; min-height: 22px; background: var(--border); margin-top: 3px; }
.tl-item:last-child .tl-l { display: none; }

.tl-t {
  font-size: 0.7rem; color: var(--text-secondary);
  font-variant-numeric: tabular-nums; padding-top: 3px; white-space: nowrap;
}
.tl-curr .tl-t { color: #389e0d; font-weight: 600; }

.tl-content {
  background: var(--glass-bg); border: 1px solid var(--glass-border);
  border-radius: 8px; padding: 0px 12px 8px;
}
.tl-curr .tl-content { border-color: rgba(82,196,26,0.2); background: rgba(82,196,26,0.03); }

.tl-top { display: flex; align-items: center; gap: 6px; }
.tl-act { font-size: 0.85rem; color: var(--text-bright); font-weight: 500; }
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
