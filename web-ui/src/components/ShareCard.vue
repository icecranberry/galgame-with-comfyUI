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
          <div ref="previewRef" class="share-preview">
            <div class="share-stage" :style="stageStyle">
              <!-- 截图目标 -->
              <div ref="cardRef" class="share-frame" :style="frameStyle">
                <div class="share-header">
                  <div class="share-avatar" :style="avatarStyle">
                    <span v-if="!post.avatar_path">{{ post.display_name?.charAt(0) }}</span>
                  </div>
                  <div class="share-user">
                    <div class="share-name">{{ post.display_name }}</div>
                    <div class="share-time">{{ formatTime(post.created_at) }}</div>
                  </div>
                </div>

                <div class="share-content">{{ post.content }}</div>

                <div
                  v-if="post.images?.length > 0"
                  class="share-images"
                  :class="{ single: post.images.length === 1, double: post.images.length === 2, multi: post.images.length >= 3 }"
                >
                  <img
                    v-for="(img, i) in post.images"
                    :key="i"
                    :src="img"
                    class="share-img"
                    crossorigin="anonymous"
                    alt="配图"
                    @load="fitPreview"
                    @error="fitPreview"
                  />
                </div>

                <div class="share-card-footer">
                  <div class="share-actions">
                    <div class="action-btn" :class="{ active: post.liked }">
                      <svg viewBox="0 0 24 24" width="18" height="18" :fill="post.liked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                    </div>
                    <div class="action-btn">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                      </svg>
                      <span v-if="(post.comment_count || 0) > 0">{{ post.comment_count }}</span>
                    </div>
                  </div>
                  <div class="share-watermark">来自邻舍.EXE</div>
                </div>
              </div>
            </div>
          </div>

          <footer class="share-panel-actions">
            <linshe-button
              class="share-action share-copy"
              variant="primary"
              size="lg"
              block
              :disabled="downloading"
              :loading="copying"
              @click="copyScreenshot"
            >
              <template v-if="!copying && !copied">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>复制截图</span>
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
              :disabled="copying"
              :loading="downloading"
              @click="downloadScreenshot"
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
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, inject } from 'vue'
import html2canvas from 'html2canvas'
import LinsheButton from './ui/LinsheButton.vue'

const toastFn = inject('toast', null)

const props = defineProps({
  post: { type: Object, required: true },
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const panelRef = ref(null)
const previewRef = ref(null)
const cardRef = ref(null)
const copying = ref(false)
const downloading = ref(false)
const copied = ref(false)
const downloaded = ref(false)
const cardScale = ref(1)
const stageHeight = ref(0)
let previewObserver = null

const avatarStyle = computed(() => {
  const p = props.post
  if (p.avatar_path) {
    return {
      backgroundImage: `url(${p.avatar_path})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }
  return { background: '#e07b6c' }
})

const frameStyle = computed(() => ({ transform: `scale(${cardScale.value})` }))
const stageStyle = computed(() => stageHeight.value ? { height: `${stageHeight.value}px` } : {})

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (d >= todayStart) {
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  }
  const yesterdayStart = new Date(todayStart.getTime() - 86400000)
  if (d >= yesterdayStart) {
    return '昨天 ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  }
  const twoDaysAgoStart = new Date(todayStart.getTime() - 2 * 86400000)
  if (d >= twoDaysAgoStart) {
    return '前天 ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  }
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
    d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
}

function focusPanel() {
  requestAnimationFrame(() => panelRef.value?.focus({ preventScroll: true }))
}

function close() {
  emit('close')
}

function fitPreview() {
  requestAnimationFrame(() => {
    const viewport = previewRef.value
    const card = cardRef.value
    if (!viewport || !card) return

    const style = getComputedStyle(viewport)
    const availableWidth = viewport.clientWidth
      - Number.parseFloat(style.paddingLeft)
      - Number.parseFloat(style.paddingRight)
    const availableHeight = viewport.clientHeight
      - Number.parseFloat(style.paddingTop)
      - Number.parseFloat(style.paddingBottom)
    const scale = Math.min(
      1,
      availableWidth / card.offsetWidth,
      availableHeight / card.offsetHeight,
    )

    cardScale.value = Math.max(0.2, scale)
    stageHeight.value = Math.ceil(card.offsetHeight * cardScale.value)
  })
}

onMounted(() => {
  focusPanel()
  fitPreview()
  previewObserver = new ResizeObserver(fitPreview)
  if (previewRef.value) previewObserver.observe(previewRef.value)
})

onBeforeUnmount(() => {
  previewObserver?.disconnect()
  previewObserver = null
})

async function renderScreenshot() {
  const el = cardRef.value
  if (!el) throw new Error('share card is not ready')

  const imgs = el.querySelectorAll('img')
  await Promise.all(Array.from(imgs).map(img => {
    if (img.complete) return Promise.resolve()
    return new Promise(resolve => { img.onload = resolve; img.onerror = resolve })
  }))

  const previousScale = cardScale.value
  const previousStageHeight = stageHeight.value
  cardScale.value = 1
  stageHeight.value = el.offsetHeight
  await nextTick()
  await new Promise(r => setTimeout(r, 100))

  try {
    return await html2canvas(el, {
      backgroundColor: null,
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
    })
  } finally {
    cardScale.value = previousScale
    stageHeight.value = previousStageHeight
    await nextTick()
    fitPreview()
  }
}

async function saveScreenshot(canvas) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `moment_${props.post.id}.png`
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadScreenshot() {
  if (downloading.value || copying.value) return
  downloading.value = true
  copied.value = false
  downloaded.value = false

  try {
    const canvas = await renderScreenshot()
    await saveScreenshot(canvas)
    downloaded.value = true
    setTimeout(() => { downloaded.value = false }, 2000)
  } catch (err) {
    console.error('[ShareCard] download screenshot failed:', err)
    toastFn?.('截图下载失败', 'error')
  } finally {
    downloading.value = false
  }
}

async function copyScreenshot() {
  if (copying.value || downloading.value) return
  copying.value = true
  copied.value = false
  downloaded.value = false

  try {
    const canvas = await renderScreenshot()
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
    })

    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ])

    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch (err) {
    console.error('[ShareCard] copy screenshot failed:', err)
    // Clipboard 不可用时降级为下载，仍保证能拿到图片。
    try {
      const canvas = await renderScreenshot()
      await saveScreenshot(canvas)
      copied.value = false
      downloaded.value = true
      toastFn?.('复制失败，已保存截图到下载', 'info')
    } catch (fallbackErr) {
      console.error('[ShareCard] screenshot fallback failed:', fallbackErr)
      toastFn?.('截图生成失败', 'error')
    }
  } finally {
    copying.value = false
  }
}

// 关闭时重置状态
watch(() => props.visible, v => {
  if (v) {
    focusPanel()
    fitPreview()
  } else {
    copying.value = false
    downloading.value = false
    copied.value = false
    downloaded.value = false
  }
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
  width: min(780px, 100%);
  height: min(92dvh, 900px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f4f1eeed;
  border: 1px solid rgba(255, 255, 255, 0.58);
  border-radius: 18px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.12);
  outline: none;
}

.share-preview {
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: center;
  padding: 10px 22px 8px;
  overflow: hidden;
}

.share-stage {
  width: 100%;
}

/* ── 分享纸卡（截图目标） ── */
.share-frame {
  width: 100%;
  box-sizing: border-box;
  background: #fffdfb;
  border-radius: 14px;
  padding: 20px 22px 16px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 18px rgba(84, 61, 50, 0.06);
  transform-origin: top center;
}

.share-header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.share-avatar {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 21px;
  font-weight: 700;
  box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.1);
}

.share-user {
  min-width: 0;
}

.share-name {
  font-size: 17px;
  font-weight: 700;
  color: #232019;
  line-height: 1.3;
}

.share-time {
  margin-top: 4px;
  font-size: 12.5px;
  color: #a89b91;
  letter-spacing: 0.02em;
}

.share-content {
  margin-top: 16px;
  font-size: 16px;
  line-height: 1.85;
  color: #3b352f;
  white-space: pre-wrap;
  word-break: break-word;
  letter-spacing: 0.015em;
}

.share-images {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.share-images.single {
  grid-template-columns: 1fr;
}

.share-images.double {
  grid-template-columns: 1fr 1fr;
}

.share-images.multi {
  grid-template-columns: 1fr 1fr 1fr;
}

.share-img {
  width: 100%;
  display: block;
  border-radius: 10px;
}

.share-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 18px;
}

.share-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
}

.action-btn.active {
  color: var(--accent);
}

.share-watermark {
  flex-shrink: 0;
  font-size: 11.5px;
  color: #b5a79c;
  letter-spacing: 0.05em;
}

/* ── 弹窗操作 ── */
.share-panel-actions {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: 12px;
  padding: 12px 22px calc(16px + env(safe-area-inset-bottom, 0px));
  background: rgba(255, 255, 255, 0.38);
  border-top: 1px solid rgba(224, 216, 207, 0.45);
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
    padding: 6px 14px 6px;
  }

  .share-frame {
    padding: 17px 16px 14px;
    border-radius: 11px;
  }

  .share-header {
    gap: 12px;
  }

  .share-avatar {
    width: 48px;
    height: 48px;
    font-size: 19px;
  }

  .share-name {
    font-size: 15.5px;
  }

  .share-time {
    margin-top: 3px;
    font-size: 12px;
  }

  .share-content {
    margin-top: 14px;
    font-size: 14.5px;
    line-height: 1.78;
  }

  .share-images {
    margin-top: 15px;
    gap: 6px;
  }

  .share-img {
    border-radius: 8px;
  }

  .share-card-footer {
    margin-top: 15px;
  }

  .action-btn {
    padding: 5px 10px;
    font-size: 12.5px;
  }

  .share-watermark {
    font-size: 11px;
  }

  .share-panel-actions {
    grid-template-columns: 1.2fr 1fr;
    gap: 9px;
    padding: 10px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  }

  .share-action {
    min-height: 40px;
  }
}
</style>
