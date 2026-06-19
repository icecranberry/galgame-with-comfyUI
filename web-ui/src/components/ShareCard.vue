<template>
  <Teleport to="body">
    <Transition name="share-fade">
      <div v-if="visible" class="share-overlay" @click.self="close">
        <!-- 截图目标：分享卡片本体 -->
        <div ref="cardRef" class="share-card">
          <!-- 顶部装饰条 -->
          <div class="share-decorator" />

          <!-- 头像 + 名称 + 时间 -->
          <div class="share-header">
            <div
              class="share-avatar"
              :style="avatarStyle"
            ><span v-if="!post.avatar_path">{{ post.display_name?.charAt(0) }}</span></div>
            <div class="share-header-text">
              <div class="share-name">{{ post.display_name }}</div>
              <div class="share-time">{{ formatFullTime(post.created_at) }}</div>
            </div>
          </div>

          <!-- 正文 -->
          <div class="share-content">{{ post.content }}</div>

          <!-- 配图 -->
          <div v-if="post.images?.length > 0" class="share-images" :class="{ 'single': post.images.length === 1 }">
            <img
              v-for="(img, i) in post.images"
              :key="i"
              :src="img"
              class="share-img"
              crossorigin="anonymous"
              alt="配图"
            />
          </div>

          <!-- 底部信息 -->
          <div class="share-footer">
            <div class="share-meta">
              <span v-if="post.like_count" class="share-meta-item">❤️ {{ post.like_count }}</span>
              <span v-if="post.comment_count" class="share-meta-item">💬 {{ post.comment_count }}</span>
            </div>
            <div class="share-brand">来自 AI 朋友圈</div>
          </div>
        </div>

        <!-- 操作栏 -->
        <div class="share-actions">
          <button class="share-btn copy-btn" :class="{ copied }" :disabled="copying" @click="copyScreenshot">
            <template v-if="!copying && !copied">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              复制截图
            </template>
            <template v-else-if="copying">
              <svg class="spin-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <circle cx="12" cy="12" r="10" stroke-dasharray="31.4 31.4" />
              </svg>
              生成中
            </template>
            <template v-else>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              已复制
            </template>
          </button>
          <button class="share-btn close-btn" @click="close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            关闭
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import html2canvas from 'html2canvas'

const props = defineProps({
  post: { type: Object, required: true },
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const cardRef = ref(null)
const copying = ref(false)
const copied = ref(false)

const avatarStyle = computed(() => {
  const p = props.post
  if (p.avatar_path) {
    return {
      backgroundImage: `url(${p.avatar_path})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }
  return { background: p.avatar_color || '#e07b6c' }
})

function formatFullTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const y = d.getFullYear()
  const M = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${y}/${M}/${day} ${h}:${m}`
}

function close() {
  emit('close')
}

async function copyScreenshot() {
  if (copying.value) return
  const el = cardRef.value
  if (!el) return

  copying.value = true
  copied.value = false

  try {
    // 等待图片加载完成
    const imgs = el.querySelectorAll('img')
    await Promise.all(Array.from(imgs).map(img => {
      if (img.complete) return Promise.resolve()
      return new Promise(resolve => { img.onload = resolve; img.onerror = resolve })
    }))

    // 额外等一下确保渲染完成
    await nextTick()
    await new Promise(r => setTimeout(r, 100))

    const canvas = await html2canvas(el, {
      backgroundColor: '#ffffff',
      scale: 2,                    // 2x 高清
      useCORS: true,
      allowTaint: true,            // 允许跨域图片（用户自己的图片服务器）
      logging: false,
    })

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
    // fallback: 如果 ClipboardItem 不支持（少数旧浏览器），降级下载
    try {
      const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2, useCORS: true, allowTaint: true, logging: false })
      canvas.toBlob(blob => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `moment_${props.post.id}.png`
        a.click()
        URL.revokeObjectURL(url)
      }, 'image/png')
      copied.value = true
    } catch (_) {
      // 彻底失败，静默
    }
  } finally {
    copying.value = false
  }
}

// 关闭时重置状态
watch(() => props.visible, v => {
  if (!v) { copying.value = false; copied.value = false }
})
</script>

<style scoped>
/* ── Overlay ── */
.share-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 24px;
}

/* ── 卡片 ── */
.share-card {
  width: 100%;
  max-width: 420px;
  max-height: 70vh;
  overflow-y: auto;
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15), 0 4px 16px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* 顶部装饰条 */
.share-decorator {
  height: 6px;
  background: linear-gradient(90deg, #e07b6c 0%, #f0a58f 40%, #e8c4a0 100%);
  border-radius: 20px 20px 0 0;
  flex-shrink: 0;
}

/* ── 头部 ── */
.share-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 24px 28px 0;
}
.share-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 22px;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.share-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.share-name {
  font-size: 18px;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 0.3px;
}
.share-time {
  font-size: 13px;
  color: #999;
}

/* ── 正文 ── */
.share-content {
  padding: 18px 28px;
  font-size: 15px;
  line-height: 1.9;
  color: #333;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── 图片 ── */
.share-images {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 0 28px;
}
.share-images.single {
  grid-template-columns: 1fr;
}
.share-img {
  width: 100%;
  max-height: 320px;
  object-fit: cover;
  border-radius: 10px;
}

/* ── 底部 ── */
.share-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 28px 24px;
}
.share-meta {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: #999;
}
.share-brand {
  font-size: 12px;
  color: #c0c0c0;
  letter-spacing: 0.5px;
}

/* ── 操作按钮 ── */
.share-actions {
  display: flex;
  gap: 12px;
}
.share-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 24px;
  border-radius: 14px;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.copy-btn {
  background: rgba(255, 255, 255, 0.92);
  color: #333;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
.copy-btn:hover:not(:disabled) {
  background: #fff;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  transform: translateY(-1px);
}
.copy-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.copy-btn.copied {
  background: #e8f5e9;
  color: #2e7d32;
}
.close-btn {
  background: rgba(255, 255, 255, 0.7);
  color: #666;
}
.close-btn:hover {
  background: rgba(255, 255, 255, 0.9);
  color: #333;
}

/* ── 动画 ── */
.share-fade-enter-active {
  transition: opacity 0.25s ease;
}
.share-fade-leave-active {
  transition: opacity 0.2s ease;
}
.share-fade-enter-from,
.share-fade-leave-to {
  opacity: 0;
}
.share-fade-enter-active .share-card {
  animation: cardUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes cardUp {
  from {
    opacity: 0;
    transform: translateY(30px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* ── 旋转图标 ── */
.spin-icon {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── 移动端 ── */
@media (max-width: 767px) {
  .share-overlay {
    padding: 16px;
    gap: 16px;
  }
  .share-card {
    max-width: 100%;
    max-height: 60vh;
    border-radius: 16px;
  }
  .share-decorator {
    border-radius: 16px 16px 0 0;
  }
  .share-header {
    padding: 20px 20px 0;
  }
  .share-content {
    padding: 14px 20px;
    font-size: 14px;
  }
  .share-images {
    padding: 0 20px;
  }
  .share-footer {
    padding: 14px 20px 20px;
  }
  .share-actions {
    flex-direction: column;
    width: 100%;
  }
  .share-btn {
    justify-content: center;
    padding: 14px 24px;
  }
}
</style>
