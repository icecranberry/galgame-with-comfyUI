<template>
  <Teleport to="body">
    <div v-if="visibleTasks.length" class="iet-root">
      <Transition name="iet-modal">
        <div v-if="modalTask" class="iet-modal">
          <div class="iet-modal-card">
            <div class="iet-modal-head">
              <div class="iet-modal-title">{{ actionLabel(modalTask.action) }}完成</div>
              <linshe-button variant="icon" size="sm" class="iet-icon-btn" title="保留原图" @click="onDiscard(modalTask)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </linshe-button>
            </div>
            <div class="iet-modal-preview">
              <BeforeAfterSlider :before="modalTask.url" :after="modalTask.previewUrl" fit-mode="container" />
            </div>
            <div v-if="modalTask.action === 'standing'" class="iet-modal-hint">确认后将覆盖当前立绘（原立绘会被删除）</div>
            <div class="iet-modal-actions">
              <linshe-button variant="secondary" class="iet-btn" :disabled="busy" @click="onRerun(modalTask)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                重新生成
              </linshe-button>
              <linshe-button variant="danger" class="iet-btn" :disabled="busy" @click="onDiscard(modalTask)">保留原图</linshe-button>
              <linshe-button variant="primary" class="iet-btn" :disabled="busy" @click="onApply(modalTask)">确认覆盖</linshe-button>
            </div>
          </div>
        </div>
      </Transition>

      <div class="iet-stack">
        <div v-for="task in cornerTasks" :key="task.id" class="iet-slot">
          <!-- 手机端收起态：屏幕右侧中下部只留一个圆环进度 + 进度数字，点一下展开详情卡 -->
          <div
            v-if="isMobile"
            class="iet-ring"
            :class="{
              'is-error': task.status === 'failed',
              'is-done': task.status === 'ready',
              'is-indeterminate': task.status === 'running' && progressPct(task) == null,
            }"
            role="button"
            tabindex="0"
            :aria-expanded="openTaskId === task.id"
            :aria-label="ringAria(task)"
            :title="ringAria(task)"
            @click="toggleOpen(task)"
            @keydown.enter.prevent="toggleOpen(task)"
            @keydown.space.prevent="toggleOpen(task)"
          >
            <svg class="iet-ring-svg" viewBox="0 0 44 44" aria-hidden="true">
              <circle class="iet-ring-track" cx="22" cy="22" :r="RING_R" />
              <circle
                class="iet-ring-fill"
                cx="22"
                cy="22"
                :r="RING_R"
                :stroke-dasharray="ringDashArray(task)"
                :stroke-dashoffset="ringDashOffset(task)"
              />
            </svg>
            <span class="iet-ring-label">{{ ringLabel(task) }}</span>
          </div>

          <!-- 详情卡：桌面常显，手机端仅在点开时从圆环上方展开 -->
          <Transition name="iet-pop">
            <div v-if="!isMobile || openTaskId === task.id" class="iet-card" :class="{ 'is-error': task.status === 'failed', 'is-done': task.status === 'ready' }">
              <div class="iet-card-body">
                <span v-if="isDiary(task)" class="iet-avatar">
                  <img v-if="diaryAvatar(task)" :src="diaryAvatar(task)" alt="" />
                  <span v-else>{{ (task.meta?.characterName || '角色').charAt(0) }}</span>
                </span>
                <span v-else-if="task.status === 'running'" class="iet-spinner"></span>
                <span v-else class="iet-state-icon">{{ task.status === 'failed' ? '!' : '✓' }}</span>
                <div class="iet-card-text">
                  <div class="iet-card-title">{{ cardTitleLabel(task) }}{{ cardStatusText(task) }}</div>
                  <div v-if="task.status === 'running'" class="iet-progress" :class="{ 'iet-progress-indeterminate': progressPct(task) == null }">
                    <div v-if="progressPct(task) != null" class="iet-progress-fill" :style="{ width: progressPct(task) + '%' }"></div>
                  </div>
                  <div v-if="['moment_backfill', 'scene_outfits'].includes(task.action) && task.status === 'running'" class="iet-error-text">{{ task.progress?.stage }}</div>
                  <div v-if="task.status === 'failed'" class="iet-error-text">{{ task.error }}</div>
                  <div v-else-if="task.status === 'pending_confirm'" class="iet-error-text">等待确认</div>
                  <div v-else-if="task.status === 'ready'" class="iet-error-text">{{ ['moment_backfill', 'scene_outfits'].includes(task.action) ? task.result?.summary : isDiary(task) ? `「${task.result?.date || task.meta?.date || ''}」的事情已经记录下来了~` : '等待确认' }}</div>
                </div>
              </div>
              <div v-if="task.action === 'moment_backfill' && task.status === 'running'" class="iet-card-actions">
                <linshe-button size="sm" :disabled="stoppingTaskId === task.id || task.progress?.phase === 'stopping'" @click="onStopBackfill(task)">{{ task.progress?.phase === 'stopping' ? '正在停止' : '停止' }}</linshe-button>
              </div>
              <div v-if="task.status === 'failed' || task.status === 'pending_confirm' || task.status === 'ready'" class="iet-card-actions">
                <linshe-button v-if="task.status === 'failed' && isDiary(task)" size="sm" @click="onRetryDiary(task)">重试</linshe-button>
                <linshe-button v-else-if="task.status === 'failed' && !['moment_backfill', 'scene_outfits'].includes(task.action)" size="sm" @click="onRerun(task)">重试</linshe-button>
                <linshe-button v-if="task.status === 'pending_confirm'" size="sm" @click="showConfirm(task)">查看</linshe-button>
                <linshe-button v-if="task.status === 'ready' && isDiary(task)" size="sm" @click="onViewDiary(task)">翻开看看</linshe-button>
                <linshe-button variant="secondary" size="sm" :disabled="busy" @click="onDiscard(task)">关闭</linshe-button>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, inject, ref, watch } from 'vue'
import { useImageEditTasksStore } from '../stores/imageEditTasks.js'
import { useDiaryStore } from '../stores/diary.js'
import BeforeAfterSlider from './BeforeAfterSlider.vue'
import LinsheButton from './ui/LinsheButton.vue'
import { stopBackfillMoments } from '../api/index.js'

const store = useImageEditTasksStore()
const diaryStore = useDiaryStore()
const toastFn = inject('toast', null)
const stoppingTaskId = ref(null)
async function onStopBackfill(task) {
  if (stoppingTaskId.value || task.progress?.phase === 'stopping') return
  stoppingTaskId.value = task.id
  try {
    await stopBackfillMoments(task.id)
    await store.refresh()
  } catch (err) { toastFn?.(err.message || '停止失败', 'error') }
  finally { stoppingTaskId.value = null }
}
const busy = ref(false)
const activeTaskId = ref(null)

// ── 手机端：屏幕右侧中下部只留圆环进度 + 数字，点开才展开详情卡 ──
// App.vue 已 provide('isMobile')，这里直接复用；脱离 App 时退回 matchMedia
const injectedIsMobile = inject('isMobile', null)
const localMobile = ref(false)
if (!injectedIsMobile && typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(max-width: 767px)')
  localMobile.value = mq.matches
  mq.addEventListener?.('change', (e) => { localMobile.value = e.matches })
}
const isMobile = computed(() => (injectedIsMobile ? !!injectedIsMobile.value : localMobile.value))

const openTaskId = ref(null)
function toggleOpen(task) {
  openTaskId.value = openTaskId.value === task.id ? null : task.id
}

const RING_R = 19
const RING_CIRC = 2 * Math.PI * RING_R
const RING_ARC = 26 // 进度未知时转圈弧长

function ringLabel(task) {
  if (task.status === 'failed') return '!'
  if (task.status === 'ready') return '✓'
  const pct = progressPct(task)
  return pct == null ? '' : pct + '%'
}

function ringDashArray(task) {
  return task.status === 'running' && progressPct(task) == null ? `${RING_ARC} ${RING_CIRC}` : String(RING_CIRC)
}

function ringDashOffset(task) {
  const pct = progressPct(task)
  if (task.status !== 'running' || pct == null) return 0
  return RING_CIRC * (1 - pct / 100)
}

function ringAria(task) {
  const pct = progressPct(task)
  const state = task.status === 'failed' ? '失败' : task.status === 'ready' ? '已完成' : pct == null ? '进行中' : `进行中 ${pct}%`
  return `${cardTitleLabel(task)}：${state}，点按查看详情`
}

const visibleTasks = computed(() => store.tasks)
const modalTask = computed(() => {
  if (activeTaskId.value) {
    const t = visibleTasks.value.find(x => x.id === activeTaskId.value && x.status === 'pending_confirm')
    if (t) return t
  }
  return visibleTasks.value.find(x => x.status === 'pending_confirm') || null
})
const cornerTasks = computed(() => visibleTasks.value.filter(t => t.id !== modalTask.value?.id))

watch(modalTask, (t) => {
  if (!t) activeTaskId.value = null
})

// 手机端：任务结束（完成/失败）时自动展开对应卡片，避免只看到小圆环却没察觉要处理；
// 卡片被关掉后清空展开态，避免指向已消失的任务
watch(
  () => cornerTasks.value.map(t => `${t.id}:${t.status}`).join('|'),
  () => {
    if (openTaskId.value && !cornerTasks.value.some(t => t.id === openTaskId.value)) openTaskId.value = null
    if (!isMobile.value) return
    const needAttention = cornerTasks.value.find(t => t.status !== 'running')
    if (needAttention && openTaskId.value !== needAttention.id) openTaskId.value = needAttention.id
  },
  { immediate: true },
)

store.connect()

function actionLabel(action) {
  if (action === 'moment_backfill') return '补发动态'
  if (action === 'standing') return '立绘'
  if (action === 'diary') return '日记'
  return action === 'upscale' ? 'HiresFix 细化' : '重新生成'
}

function isDiary(task) {
  return task?.action === 'diary'
}

function diaryAvatar(task) {
  return task.meta?.characterAvatar || (
    Number(task.meta?.characterId) === Number(diaryStore.characterId)
      ? diaryStore.characterAvatar
      : ''
  )
}

/** 日记任务用角色名做标题（meta 由后端 startBackgroundTask 带过来） */
function diaryTitle(task) {
  const name = task?.meta?.characterName || '角色'
  return `${name}的日记`
}

function cardTitleLabel(task) {
  if (task.action === 'scene_outfits') return `${task.meta?.characterName || '角色'}的服装与形象`
  if (isDiary(task)) return diaryTitle(task)
  return actionLabel(task.action)
}

function cardStatusText(task) {
  if (task.action === 'scene_outfits') return task.status === 'ready' ? '已完成' : task.status === 'failed' ? '生成失败' : '生成中'
  if (task.action === 'moment_backfill' && task.status === 'ready') return task.result?.cancelled ? '已停止' : '完成'
  if (task.status === 'failed') return '失败'
  if (task.status === 'pending_confirm') return '待确认'
  if (isDiary(task)) return task.status === 'ready' ? '写好了' : '生成中'
  return '中'
}

function progressPct(task) {
  const p = task.progress?.progress
  if (typeof p !== 'number') return null
  return Math.round(Math.min(1, Math.max(0, p)) * 100)
}

function showConfirm(task) {
  activeTaskId.value = task.id
}

async function onApply(task) {
  if (busy.value) return
  busy.value = true
  try {
    await store.apply(task)
    toastFn?.(task.action === 'standing' ? '已更新立绘' : '已确认覆盖原图', 'success')
    if (activeTaskId.value === task.id) activeTaskId.value = null
  } catch (err) {
    console.error('[ImageEditTaskFloater] apply failed:', err.message)
    toastFn?.(err.message || '确认覆盖失败', 'error')
  } finally {
    busy.value = false
  }
}

async function onRerun(task) {
  if (busy.value) return
  busy.value = true
  try {
    await store.rerun(task)
    toastFn?.('已重新开始任务', 'info')
    if (activeTaskId.value === task.id) activeTaskId.value = null
  } catch (err) {
    console.error('[ImageEditTaskFloater] rerun failed:', err.message)
    toastFn?.(err.message || '重新生成失败', 'error')
  } finally {
    busy.value = false
  }
}

async function onDiscard(task) {
  if (busy.value) return
  busy.value = true
  try {
    await store.discard(task)
    if (activeTaskId.value === task.id) activeTaskId.value = null
  } catch (err) {
    console.error('[ImageEditTaskFloater] discard failed:', err.message)
    toastFn?.(err.message || '保留原图失败', 'error')
  } finally {
    busy.value = false
  }
}

// ── 日记任务：没有「确认覆盖」这一步，写好了直接翻开日记本看 ──
async function onViewDiary(task) {
  const meta = task.meta || {}
  if (!meta.characterId) return
  await diaryStore.openBook({
    characterId: meta.characterId,
    characterName: meta.characterName || '',
    characterAvatar: diaryAvatar(task),
    date: meta.date,
  })
  store.discard(task).catch(() => {})
}

async function onRetryDiary(task) {
  if (busy.value) return
  busy.value = true
  try {
    const meta = task.meta || {}
    await diaryStore.generateFor(meta.characterId, meta.date)
    toastFn?.('重新开始写日记', 'info')
    await store.discard(task)
  } catch (err) {
    console.error('[ImageEditTaskFloater] diary retry failed:', err.message)
    toastFn?.(err.message || '日记重试失败', 'error')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.iet-root {
  font-family: var(--font-ui, 'HarmonyOS Sans SC', sans-serif);
}

.iet-stack {
  position: fixed;
  right: 18px;
  bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 12000;
  max-width: min(340px, calc(100vw - 36px));
}

/* 单个任务：手机端＝圆环在上、展开的卡片在下，桌面端只有卡片 */
.iet-slot { display: flex; flex-direction: column; gap: 8px; }

.iet-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-md);
  padding: 12px 14px;
  transform-origin: top right;
}

/* 手机端收起态：只留一个圆环进度 + 进度数字 */
.iet-ring {
  position: relative;
  width: 44px;
  height: 44px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--dur-fast, 0.15s) var(--ease-standard, ease);
}
.iet-ring:active { transform: scale(0.94); }
.iet-ring:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.iet-ring-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.iet-ring-track { fill: none; stroke: var(--border); stroke-width: 3; }
.iet-ring-fill {
  fill: none;
  stroke: var(--accent);
  stroke-width: 3;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.4s var(--ease-standard, ease);
}
.iet-ring.is-done .iet-ring-fill { stroke: var(--accent-light); }
/* 进度未知：整圈弧线匀速转，表示“还在跑” */
.iet-ring.is-indeterminate .iet-ring-svg { animation: iet-spin 1.2s linear infinite; }

.iet-ring-label {
  position: relative;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.2px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.iet-ring.is-error .iet-ring-label,
.iet-ring.is-done .iet-ring-label { color: var(--accent); font-size: 13px; }

.iet-card.is-error { border-color: rgba(var(--accent-rgb), 0.5); }
.iet-card.is-done { border-color: rgba(var(--accent-rgb), 0.32); }
.iet-card.is-done .iet-state-icon { background: rgba(var(--accent-rgb), 0.16); color: var(--accent); }

.iet-card-body { display: flex; align-items: center; gap: 10px; }

.iet-avatar {
  width: 32px; height: 32px; flex: none;
  align-self: flex-start;
  display: grid; place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: var(--bg-sunken);
  color: var(--text-secondary);
  font-size: 14px; font-weight: 700;
}
.iet-avatar img { width: 100%; height: 100%; object-fit: cover; }

.iet-spinner {
  width: 18px; height: 18px; flex: none;
  border: 2px solid var(--border);
  border-top-color: var(--accent, #b0755a);
  border-radius: 50%;
  animation: iet-spin 0.8s linear infinite;
}

.iet-state-icon {
  width: 20px; height: 20px; flex: none;
  display: grid; place-items: center;
  border-radius: 50%;
  font-size: 12px; font-weight: 700;
  background: rgba(120, 90, 70, 0.12);
  color: var(--text-secondary);
}

.iet-card.is-error .iet-state-icon { background: rgba(var(--accent-rgb), 0.16); color: var(--accent); }

.iet-card-text { min-width: 0; flex: 1; }

.iet-card-title { font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; }

.iet-error-text { font-size: 12px; color: var(--accent); line-height: 1.45; word-break: break-word; }

.iet-progress {
  height: 5px; border-radius: 999px; background: rgba(120, 90, 70, 0.12);
  overflow: hidden;
}

.iet-progress-fill { height: 100%; background: var(--accent, #b0755a); border-radius: 999px; transition: width 0.3s ease; }

.iet-progress-indeterminate {
  position: relative;
}
.iet-progress-indeterminate::after {
  content: '';
  position: absolute; inset: 0;
  width: 40%;
  border-radius: 999px;
  background: var(--accent, #b0755a);
  animation: iet-slide 1.1s ease-in-out infinite;
}

.iet-card-actions { display: flex; gap: 8px; margin-top: 10px; }

.iet-modal {
  position: fixed; inset: 0;
  z-index: 15000;
  background: rgba(70, 58, 50, 0.16);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  display: grid; place-items: center;
  padding: 20px;
}

.iet-modal-card {
  width: min(1080px, 94vw);
  background: #F7F4EF;
  border: 1px solid rgba(var(--accent-rgb), 0.16);
  border-color: color-mix(in srgb, var(--accent) 24%, transparent);
  border-radius: 18px;
  box-shadow: 0 12px 35px rgba(50, 40, 35, 0.12);
  max-height: 90dvh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.iet-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 18px 10px;
}

.iet-modal-title { font-size: 15px; font-weight: 600; color: #3E3A36; }

.iet-icon-btn { opacity: 0.55; }
.iet-icon-btn svg { width: 10px; height: 10px; }
.iet-icon-btn:hover { opacity: 1; }

.iet-modal-preview {
  padding: 0 18px;
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
}
.iet-modal-preview :deep(.ba-slider) {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  border-radius: 14px;
}

.iet-modal-hint { margin: 12px 18px 0; font-size: 12.5px; line-height: 1.45; color: #8B8179; }

.iet-modal-actions {
  display: flex; gap: 10px;
  padding: 14px 18px 18px;
}
.iet-modal-actions .iet-btn { flex: 1; }

.iet-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.iet-btn svg { width: 15px; height: 15px; }

.iet-modal-enter-active, .iet-modal-leave-active { transition: opacity 0.18s ease; }
.iet-modal-enter-active .iet-modal-card, .iet-modal-leave-active .iet-modal-card { transition: transform 0.18s ease; }
.iet-modal-enter-from, .iet-modal-leave-to { opacity: 0; }
.iet-modal-enter-from .iet-modal-card, .iet-modal-leave-to .iet-modal-card { transform: scale(0.96); }

/* 手机端详情卡从圆环上方渐入渐出（0.3s，符合全局窗口动效约定） */
.iet-pop-enter-active, .iet-pop-leave-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.iet-pop-enter-from, .iet-pop-leave-to { opacity: 0; transform: translateY(6px) scale(0.96); }

@keyframes iet-spin { to { transform: rotate(360deg); } }
@keyframes iet-slide {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(320%); }
}

@media (max-width: 767px) {
  /* 手机端不再在底部堆叠整卡，收到屏幕右侧约 3/4 屏高处只留圆环进度
     （避开页头、底部输入栏与右下角角色通知）；点圆环才在它上方展开详情卡 */
  .iet-stack {
    top: auto;
    bottom: calc(20vh + env(safe-area-inset-bottom, 0px));
    bottom: calc(20dvh + env(safe-area-inset-bottom, 0px));
    right: max(14px, env(safe-area-inset-right, 0px));
    left: auto;
    max-width: calc(100vw - 24px);
    align-items: flex-end;
    gap: 8px;
  }

  /* 圆环钉在锚点（右侧中下），详情卡从它上方展开，展开过程中圆环不跟着跑 */
  .iet-slot { align-items: flex-end; flex-direction: column-reverse; }

  .iet-card {
    width: min(300px, calc(100vw - 24px));
    transform-origin: bottom right;
  }

  /* 整屏对比：把高度交给「预览区 flex:1 + 图片按容器收敛」，
     避免固定 90dvh 里图片与按钮互相挤、把按钮顶出屏幕 */
  .iet-modal {
    padding: 0;
    place-items: stretch;
  }
  .iet-modal-card {
    width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    border: none;
    border-radius: 0;
    overflow: hidden;
  }
  .iet-modal-head {
    padding: calc(12px + env(safe-area-inset-top, 0px)) 16px 8px;
  }
  /* 24px 的圆钮在手机上太难点，放大到 38px 热区（皮肤仍由 LinsheButton 决定） */
  .iet-modal-head .iet-icon-btn { width: 38px; height: 38px; flex: none; }
  .iet-modal-head .iet-icon-btn svg { width: 13px; height: 13px; }
  .iet-modal-preview {
    padding: 0 12px;
    overflow: hidden;
  }
  .iet-modal-preview :deep(.ba-slider) { border-radius: 12px; }
  .iet-modal-actions {
    flex-wrap: wrap;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  }
  .iet-modal-actions .iet-btn {
    flex: 1 1 calc(50% - 5px);
    min-height: 44px;
  }
}
</style>
