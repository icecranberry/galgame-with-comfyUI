<template>
  <Teleport to="body">
    <Transition name="share-fade">
      <div
        v-if="visible"
        class="share-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="分享朋友圈"
        @click.self="close"
        @keydown.escape="close"
      >
        <div ref="panelRef" class="share-panel" tabindex="-1">
          <div class="share-preview" @click.self="close">
            <!-- 生成中骨架 -->
            <div v-if="rendering" class="share-skeleton" aria-hidden="true">
              <span class="share-skeleton-hint">正在生成分享图…</span>
            </div>
            <!-- 海报预览（1080×1920 竖版） -->
            <img
              v-else-if="previewUrl"
              :src="previewUrl"
              class="share-poster"
              alt="朋友圈分享图预览"
            />
          </div>

          <!-- 版式切换 -->
          <div class="share-style-bar" role="radiogroup" aria-label="分享图版式">
            <span class="share-style-label">版式</span>
            <linshe-button
              v-for="s in styles"
              :key="s.id"
              variant="chip"
              size="md"
              :active="activeStyle === s.id"
              :disabled="rendering"
              @click="switchStyle(s.id)"
            >{{ s.label }}</linshe-button>
          </div>

          <footer class="share-panel-actions">
            <linshe-button
              class="share-action"
              variant="primary"
              size="lg"
              block
              :disabled="rendering"
              :loading="copying"
              @click="copyPoster"
            >
              <template v-if="!copying && !copied">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>复制图片</span>
              </template>
              <template v-else-if="!copying">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>已复制</span>
              </template>
              <template v-else>
                <span>生成中</span>
              </template>
            </linshe-button>

            <linshe-button
              class="share-action"
              variant="secondary"
              size="lg"
              block
              :disabled="rendering"
              :loading="downloading"
              @click="downloadPoster"
            >
              <template v-if="!downloading && !downloaded">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>下载</span>
              </template>
              <template v-else-if="!downloading">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>已下载</span>
              </template>
              <template v-else>
                <span>生成中</span>
              </template>
            </linshe-button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, inject } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import { renderMomentShareCard, MOMENT_SHARE_STYLES } from '../utils/momentShareRenderer.js'

const toastFn = inject('toast', null)

const props = defineProps({
  post: { type: Object, required: true },
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const styles = MOMENT_SHARE_STYLES
const panelRef = ref(null)
const rendering = ref(false)
const copying = ref(false)
const downloading = ref(false)
const copied = ref(false)
const downloaded = ref(false)
const activeStyle = ref('auto')
const previewUrl = ref('')
let previewBlob = null
let renderSeq = 0

function revokePreview() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
  previewBlob = null
}

/** 渲染当前版式的海报并转成可预览/可导出的 blob */
async function renderPoster(styleId) {
  const seq = ++renderSeq
  rendering.value = true
  try {
    const { canvas } = await renderMomentShareCard(props.post, {
      styleId: styleId === 'auto' ? undefined : styleId,
    })
    if (seq !== renderSeq) return // 已切换到其它版式，丢弃过期结果
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
    })
    revokePreview()
    previewBlob = blob
    previewUrl.value = URL.createObjectURL(blob)
  } catch (err) {
    console.error('[ShareCard] render poster failed:', err)
    if (seq === renderSeq) toastFn?.('分享图生成失败', 'error')
  } finally {
    if (seq === renderSeq) rendering.value = false
  }
}

async function switchStyle(styleId) {
  if (rendering.value || activeStyle.value === styleId) return
  activeStyle.value = styleId
  await renderPoster(styleId)
}

async function savePoster() {
  if (!previewBlob) await renderPoster(activeStyle.value)
  if (!previewBlob) throw new Error('poster blob is not ready')
  const url = URL.createObjectURL(previewBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `moment_${props.post.id}.png`
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadPoster() {
  if (downloading.value || copying.value) return
  downloading.value = true
  copied.value = false
  downloaded.value = false
  try {
    await savePoster()
    downloaded.value = true
    setTimeout(() => { downloaded.value = false }, 2000)
  } catch (err) {
    console.error('[ShareCard] download poster failed:', err)
    toastFn?.('分享图下载失败', 'error')
  } finally {
    downloading.value = false
  }
}

async function copyPoster() {
  if (copying.value || downloading.value) return
  copying.value = true
  copied.value = false
  downloaded.value = false
  try {
    if (!previewBlob) await renderPoster(activeStyle.value)
    if (!previewBlob) throw new Error('poster blob is not ready')
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': previewBlob }),
    ])
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch (err) {
    console.error('[ShareCard] copy poster failed:', err)
    // 剪贴板不可用时降级为下载，仍保证能拿到图片
    try {
      await savePoster()
      copied.value = false
      downloaded.value = true
      toastFn?.('复制失败，已保存分享图到下载', 'info')
    } catch (fallbackErr) {
      console.error('[ShareCard] poster fallback failed:', fallbackErr)
      toastFn?.('分享图生成失败', 'error')
    }
  } finally {
    copying.value = false
  }
}

function focusPanel() {
  requestAnimationFrame(() => panelRef.value?.focus({ preventScroll: true }))
}

function close() {
  emit('close')
}

// 组件以 v-if + visible=true 挂载（MomentsView），挂载即首渲；watch 兜底外部切换 visible
onMounted(() => {
  if (props.visible && !previewUrl.value && !rendering.value) {
    focusPanel()
    renderPoster(activeStyle.value)
  }
})

watch(() => props.visible, v => {
  if (v) {
    focusPanel()
    activeStyle.value = 'auto'
    renderPoster('auto')
  } else {
    copying.value = false
    downloading.value = false
    copied.value = false
    downloaded.value = false
    renderSeq++
    rendering.value = false
    revokePreview()
  }
})

onBeforeUnmount(() => {
  renderSeq++
  revokePreview()
})
</script>

<style scoped>
.share-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: hidden;
}

.share-panel {
  width: min(640px, 100%);
  height: min(92dvh, 940px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-secondary) 93%, transparent);
  border: 1px solid rgba(255, 255, 255, 0.58);
  border-radius: 18px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.12);
  outline: none;
}

.share-preview {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px 22px 10px;
  overflow: hidden;
}

/* 海报本身是 1080×1920，这里只做展示缩放，导出始终是原尺寸 */
.share-poster {
  max-width: 100%;
  max-height: 100%;
  border-radius: 12px;
  box-shadow: 0 10px 34px rgba(60, 42, 30, 0.18);
  user-select: none;
  -webkit-user-drag: none;
}

.share-skeleton {
  width: min(46dvh, 88%);
  aspect-ratio: 9 / 16;
  max-width: 100%;
  border-radius: 12px;
  background: linear-gradient(100deg, var(--bg-tertiary) 40%, var(--bg-secondary) 50%, var(--bg-tertiary) 60%);
  background-size: 200% 100%;
  animation: shareShimmer 1.2s ease-in-out infinite;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 18px;
}

.share-skeleton-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

@keyframes shareShimmer {
  from { background-position: 120% 0; }
  to { background-position: -80% 0; }
}

/* ── 版式切换：与底部操作栏同级的控制条 ── */
.share-style-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 11px 22px;
  background: rgba(255, 255, 255, 0.38);
  border-top: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
}

.share-style-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
}

/* ── 弹窗操作 ── */
.share-panel-actions {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: 12px;
  padding: 10px 22px calc(16px + env(safe-area-inset-bottom, 0px));
  background: rgba(255, 255, 255, 0.38);
  border-top: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
}

.share-action {
  min-height: 42px;
}

/* ── 动画 ── */
.share-fade-enter-active { transition: opacity 0.25s ease; }
.share-fade-leave-active { transition: opacity 0.2s ease; }
.share-fade-enter-from,
.share-fade-leave-to { opacity: 0; }
.share-fade-enter-active .share-panel {
  animation: cardUp 0.32s cubic-bezier(0.34, 1.3, 0.64, 1);
}

@keyframes cardUp {
  from {
    opacity: 0;
    transform: translateY(22px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .share-fade-enter-active,
  .share-fade-leave-active { transition: opacity 0.15s ease; }
  .share-fade-enter-active .share-panel { animation: none; }
  .share-skeleton { animation: none; }
}

/* ── 移动端 ── */
@media (max-width: 767px) {
  .share-overlay {
    padding: max(14px, env(safe-area-inset-top, 0px)) 12px 12px;
  }

  .share-panel {
    height: 96dvh;
    border-radius: 14px;
  }

  .share-preview {
    padding: 8px 14px 4px;
  }

  .share-poster {
    border-radius: 10px;
  }

  .share-skeleton {
    width: min(52dvh, 92%);
  }

  .share-style-bar {
    gap: 8px;
    padding: 8px 12px;
  }

  .share-style-label {
    display: none;
  }

  .share-panel-actions {
    grid-template-columns: 1.2fr 1fr;
    gap: 9px;
    padding: 8px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  }

  .share-action {
    min-height: 40px;
  }
}
</style>
