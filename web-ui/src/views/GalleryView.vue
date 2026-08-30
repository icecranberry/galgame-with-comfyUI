<template>
  <div class="gallery-view">
    <!-- 顶栏 -->
    <div class="gallery-header">
      <span
        class="gallery-title"
        :class="{ 'is-clickable': isMobile }"
        @click="isMobile && toggleMobileSidebar()"
      >相册</span>
      <div class="header-right">
        <span class="gallery-count" v-if="totalCount > 0">共 {{ totalCount }} 张</span>
        <button class="btn-compress" @click="showModal = true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px">
            <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
            <line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>图片压缩
        </button>
      </div>
    </div>

    <!-- 内容区 -->
    <Gallery ref="galleryRef" @loaded="onLoaded" />

    <!-- 压缩弹窗 -->
    <Transition name="modal-fade">
      <div v-if="showModal" class="modal-overlay" @click.self="onOverlayClick">
        <div class="modal-panel" @click.stop>
          <div class="modal-header">
            <span>图片压缩</span>
            <button class="modal-close" @click="showModal = false">✕</button>
          </div>

          <div class="modal-body">
            <!-- 压缩类型 -->
            <div class="section">
              <div class="section-label">压缩类型</div>
              <div class="toggle-row">
                <button
                  class="toggle-btn"
                  :class="{ active: compressType === 'oxipng' }"
                  @click="onTypeChange('oxipng')"
                >OxiPng 无损</button>
                <button
                  class="toggle-btn"
                  :class="{ active: compressType === 'avif' }"
                  @click="onTypeChange('avif')"
                >AVIF 有损</button>
              </div>
              <div class="type-desc">
                {{ compressType === 'oxipng' ? '无损重编码 PNG，画质几乎不变，预计大小下降70%' : '转为 AVIF 格式（较新格式，过旧浏览器不支持） 有损压缩，小图压缩会微微失真，大图没区别，预计大小下降95%' }}
              </div>
              <button
                class="btn-start-inline"
                @click="onStartCompress"
                :disabled="task?.processing"
              >{{ task?.processing ? '压缩中...' : '立刻压缩' }}</button>
            </div>

            <div class="section-divider"></div>

            <!-- 定时任务开关 -->
            <div class="section">
              <div class="section-label">定时计划压缩</div>
              <div class="toggle-row">
                <button
                  class="toggle-btn"
                  :class="{ active: scheduleEnabled }"
                  @click="onScheduleToggle(true)"
                >开启</button>
                <button
                  class="toggle-btn"
                  :class="{ active: !scheduleEnabled }"
                  @click="onScheduleToggle(false)"
                >关闭</button>
              </div>
              <div class="type-desc" v-if="scheduleEnabled">
                白天每 10 分钟压缩 3 张 · 凌晨 2-5 点每 10 分钟压缩 15 张
              </div>
            </div>

            <!-- 统计 -->
            <div class="section stats" v-if="stats.totalProcessed > 0">
              <div class="stat-item">
                <span class="stat-num">{{ stats.totalProcessed }}</span>
                <span class="stat-label">已压缩</span>
              </div>
              <div class="stat-item">
                <span class="stat-num">{{ formatBytes(stats.totalOriginalBytes) }}</span>
                <span class="stat-label">原始大小</span>
              </div>
              <div class="stat-item">
                <span class="stat-num">{{ formatBytes(stats.totalCompressedBytes) }}</span>
                <span class="stat-label">压缩后</span>
              </div>
              <div class="stat-item" v-if="stats.totalOriginalBytes > 0">
                <span class="stat-num highlight">{{ overallRatio }}%</span>
                <span class="stat-label">节省</span>
              </div>
            </div>

            <!-- 立即压缩进度条 -->
            <div class="section" v-if="task && task.processing">
              <div class="progress-header">
                <span>压缩中 {{ task.current }}/{{ task.total }}</span>
                <button class="btn-bg" @click="onBackground">后台处理</button>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
              </div>
              <div class="progress-file" v-if="task.currentFile">{{ task.currentFile }}</div>
              <button class="btn-cancel" @click="onCancel" v-if="task.processing">取消压缩</button>
            </div>

            <!-- 立即压缩完成状态 -->
            <div class="section" v-if="task && !task.processing && task.phase !== 'idle'">
              <div class="progress-done" :class="{ 'is-error': task.errors > 0 }">
                {{ task.phase === 'complete' ? `完成：${task.current}/${task.total} 已压缩` : '已取消' }}
                <span v-if="task.errors > 0">，{{ task.errors }} 个错误</span>
              </div>
            </div>

            <!-- 立刻压缩按钮 -->

          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, inject } from 'vue'
import Gallery from '../components/Gallery.vue'
import * as api from '../api/index.js'
import { onEvent } from '../stores/unifiedStream.js'

const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')
const toastFn = inject('toast')
const galleryRef = ref(null)
const totalCount = ref(0)

function onLoaded(count) {
  totalCount.value = count
}

// ── 压缩弹窗状态 ──
const showModal = ref(false)
const compressType = ref('avif')
const scheduleEnabled = ref(false)
const stats = reactive({
  totalProcessed: 0,
  totalOriginalBytes: 0,
  totalCompressedBytes: 0,
})

const task = ref(null)
let _unsubProgress = null

const overallRatio = computed(() => {
  if (stats.totalOriginalBytes === 0) return '0'
  return ((1 - stats.totalCompressedBytes / stats.totalOriginalBytes) * 100).toFixed(1)
})

const progressPct = computed(() => {
  if (!task.value || task.value.total === 0) return 0
  return ((task.value.current / task.value.total) * 100).toFixed(1)
})

function formatBytes(bytes) {
  if (!bytes) return '0 KB'
  const mb = bytes / 1048576
  if (mb >= 1) return mb.toFixed(1) + ' MB'
  return (bytes / 1024).toFixed(0) + ' KB'
}

async function fetchStatus() {
  try {
    const data = await api.getCompressStatus()
    compressType.value = data.compressionType || 'avif'
    scheduleEnabled.value = data.enabled || false
    stats.totalProcessed = data.totalProcessed || 0
    stats.totalOriginalBytes = data.totalOriginalBytes || 0
    stats.totalCompressedBytes = data.totalCompressedBytes || 0
    task.value = data.task || null
  } catch (err) {
    console.error('[compress] fetch status error:', err)
  }
}

async function onTypeChange(type) {
  compressType.value = type
  await api.updateCompressConfig({ compressionType: type })
}

async function onScheduleToggle(on) {
  scheduleEnabled.value = on
  await api.updateCompressConfig({ enabled: on })
}

async function onStartCompress() {
  try {
    const res = await api.startCompress()
    if (res.error) {
      toastFn(res.error, 'error')
      return
    }
    await fetchStatus()
  } catch (err) {
    console.error('[compress] start error:', err)
  }
}

async function onCancel() {
  await api.cancelCompress()
}

function onBackground() {
  showModal.value = false
}

function onOverlayClick() {
  // 如果有进行中的任务，关闭弹窗 = 后台处理
  showModal.value = false
}

// SSE 监听压缩进度
onMounted(() => {
  fetchStatus()

  _unsubProgress = onEvent('image_compress_progress', (data) => {
    task.value = {
      phase: data.phase || 'running',
      current: data.current || 0,
      total: data.total || 0,
      currentFile: data.currentFile || '',
      errors: data.errors?.length || 0,
      processing: data.phase === 'running',
    }

    if (data.phase === 'complete' || data.phase === 'cancelled') {
      fetchStatus()
      // 刷新相册
      galleryRef.value?.refresh?.()
    }
  })
})

onUnmounted(() => {
  if (_unsubProgress) _unsubProgress()
})
</script>

<style scoped>
.gallery-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

.gallery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.25);
  flex-shrink: 0;
}

.gallery-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-bright);
  user-select: none;
}
.gallery-title.is-clickable { cursor: pointer; }

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.gallery-count {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ── 压缩按钮（照搬扰动世界线样式）── */
.btn-compress {
  padding: 8px 22px;
  border-radius: 14px;
  border: 2px solid transparent;
  background: var(--grad-soft);
  background-size: 220% 100%;
  color: var(--accent-hover);
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  letter-spacing: 1px;
  transition:
    border-color 0.35s ease,
    box-shadow 0.35s ease,
    color 0.3s ease;
}
.btn-compress:hover {
  border: 2px solid rgba(var(--accent-rgb), 0.55);
  box-shadow: 0 3px 20px rgba(var(--accent-rgb), 0.10);
  color: #a85545;
  animation: waterflow 1s ease-in-out infinite;
}
@keyframes waterflow {
  0%, 100% { background-position: 0% 50%; }
  50%      { background-position: 100% 50%; }
}

/* ── 弹窗：视觉样式走全局 modal 家族，这里只保留布局差异 ── */
.modal-panel {
  width: 550px;
  max-height: 95vh;
  overflow-y: auto;
}

.modal-header {
  padding: 18px 20px 12px;
}

.modal-body {
  padding: 16px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ── 分区 ── */
.section { display: flex; flex-direction: column; gap: 8px; }
.section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

/* ── 切换按钮组 ── */
.toggle-row {
  display: flex;
  gap: 0;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.1);
}
.toggle-btn {
  flex: 1;
  padding: 8px 0;
  border: none;
  background: rgba(0, 0, 0, 0.03);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}
.toggle-btn.active {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.toggle-btn:not(.active):hover {
  background: rgba(var(--accent-rgb), 0.08);
}

.type-desc {
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.7;
  line-height: 1.5;
}

.section-divider {
  width: 90%;
  margin: 8px auto 8px;
  height: 1px;
  background: rgba(0, 0, 0, 0.08);
}

/* ── 统计 ── */
.stats {
  flex-direction: row;
  gap: 16px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 10px;
}
.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.stat-num {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-bright);
}
.stat-num.highlight { color: #4caf50; }
.stat-label {
  font-size: 11px;
  color: var(--text-secondary);
}

/* ── 进度条 ── */
.progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-bright);
}
.btn-bg {
  background: none;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
}
.btn-bg:hover { background: rgba(0, 0, 0, 0.04); }

.progress-bar {
  height: 6px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 3px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.3s ease;
}
.progress-file {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-cancel {
  background: none;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  padding: 6px 0;
  font-size: 12px;
  color: var(--accent);
  cursor: pointer;
  width: 100%;
}
.btn-cancel:hover { background: rgba(var(--accent-rgb), 0.06); }

.progress-done {
  font-size: 13px;
  color: #4caf50;
  text-align: center;
}
.progress-done.is-error { color: var(--accent); }

/* ── 立刻压缩按钮 ── */
.btn-start-inline {
  margin-top: 8px;
  padding: 7px 0;
  border: none;
  border-radius: 10px;
  background: rgba(var(--accent-rgb), 0.08);
  color: var(--accent-hover);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
  transition: background 0.2s, color 0.2s;
}
.btn-start-inline:hover:not(:disabled) {
  background: var(--accent);
  color: #fff;
}
.btn-start-inline:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── 弹窗动画 ── */
.modal-fade-enter-active { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-leave-active { transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }

@media (max-width: 767px) {
  .gallery-header {
    padding: 12px 16px;
  }
  .gallery-title {
    font-size: 16px;
  }
  .btn-compress {
    padding: 6px 14px;
    font-size: 12px;
  }
  .modal-panel {
    width: 92vw;
  }
}
</style>
