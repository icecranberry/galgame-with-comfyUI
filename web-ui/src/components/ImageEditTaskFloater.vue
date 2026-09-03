<template>
  <Teleport to="body">
    <div v-if="visibleTasks.length" class="iet-root">
      <Transition name="iet-modal">
        <div v-if="modalTask" class="iet-modal" @click.self="onDiscard(modalTask)">
          <div class="iet-modal-card">
            <div class="iet-modal-head">
              <div class="iet-modal-title">{{ actionLabel(modalTask.action) }}完成</div>
              <linshe-button variant="icon" size="sm" class="iet-icon-btn" title="保留原图" @click="onDiscard(modalTask)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </linshe-button>
            </div>
            <div class="iet-modal-preview">
              <BeforeAfterSlider :before="modalTask.url" :after="modalTask.previewUrl" />
            </div>
            <p class="iet-modal-hint">新图已生成，确认后才会覆盖原图。</p>
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

      <div class="iet-cards">
        <div v-for="task in cornerTasks" :key="task.id" class="iet-card" :class="{ 'is-error': task.status === 'failed' }">
          <div class="iet-card-body">
            <span v-if="task.status === 'running'" class="iet-spinner"></span>
            <span v-else class="iet-state-icon">{{ task.status === 'failed' ? '!' : '✓' }}</span>
            <div class="iet-card-text">
              <div class="iet-card-title">{{ actionLabel(task.action) }}{{ cardStatusText(task) }}</div>
              <div v-if="task.status === 'running'" class="iet-progress" :class="{ 'iet-progress-indeterminate': progressPct(task) == null }">
                <div v-if="progressPct(task) != null" class="iet-progress-fill" :style="{ width: progressPct(task) + '%' }"></div>
              </div>
              <div v-if="task.status === 'failed'" class="iet-error-text">{{ task.error }}</div>
              <div v-else-if="task.status === 'pending_confirm'" class="iet-error-text">等待确认</div>
            </div>
          </div>
          <div v-if="task.status === 'failed' || task.status === 'pending_confirm'" class="iet-card-actions">
            <linshe-button v-if="task.status === 'failed'" size="sm" @click="onRerun(task)">重试</linshe-button>
            <linshe-button v-if="task.status === 'pending_confirm'" size="sm" @click="showConfirm(task)">查看</linshe-button>
            <linshe-button variant="icon" size="sm" @click="onDiscard(task)">关闭</linshe-button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, inject, ref, watch } from 'vue'
import { useImageEditTasksStore } from '../stores/imageEditTasks.js'
import BeforeAfterSlider from './BeforeAfterSlider.vue'
import LinsheButton from './ui/LinsheButton.vue'

const store = useImageEditTasksStore()
const toastFn = inject('toast', null)
const busy = ref(false)
const activeTaskId = ref(null)

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

store.connect()

function actionLabel(action) {
  return action === 'upscale' ? 'HiresFix 细化' : '重新生成'
}

function cardStatusText(task) {
  if (task.status === 'failed') return '失败'
  if (task.status === 'pending_confirm') return '待确认'
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
    toastFn?.('已确认覆盖原图', 'success')
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
</script>

<style scoped>
.iet-root {
  font-family: var(--font-ui, 'HarmonyOS Sans SC', sans-serif);
}

.iet-cards {
  position: fixed;
  right: 18px;
  bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 12000;
  max-width: min(340px, calc(100vw - 36px));
}

.iet-card {
  background: #fff;
  border: 1px solid rgba(120, 90, 70, 0.16);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(60, 40, 25, 0.18);
  padding: 12px 14px;
}

.iet-card.is-error { border-color: rgba(var(--accent-rgb), 0.5); }

.iet-card-body { display: flex; align-items: center; gap: 10px; }

.iet-spinner {
  width: 18px; height: 18px; flex: none;
  border: 2px solid rgba(120, 90, 70, 0.2);
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
  color: #6f675f;
}

.iet-card.is-error .iet-state-icon { background: rgba(var(--accent-rgb), 0.16); color: var(--accent); }

.iet-card-text { min-width: 0; flex: 1; }

.iet-card-title { font-size: 13px; font-weight: 700; color: #3d332c; margin-bottom: 6px; }

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
  width: min(720px, 100%);
  background: #F7F4EF;
  border: 1px solid rgba(var(--accent-rgb), 0.16);
  border-color: color-mix(in srgb, var(--accent) 24%, transparent);
  border-radius: 18px;
  box-shadow: 0 12px 35px rgba(50, 40, 35, 0.12);
  max-height: 92vh;
  overflow-y: auto;
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
  max-height: 62vh;
  display: grid; place-items: center;
  overflow: hidden;
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

@keyframes iet-spin { to { transform: rotate(360deg); } }
@keyframes iet-slide {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(320%); }
}

@media (max-width: 767px) {
  .iet-cards { right: 12px; bottom: 12px; left: 12px; max-width: none; }
  .iet-modal-card { max-height: 86vh; overflow: auto; }
  .iet-modal-actions { flex-wrap: wrap; }
  .iet-modal-actions .iet-btn { flex: 1 1 40%; }
}
</style>
