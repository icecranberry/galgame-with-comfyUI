<template>
  <Teleport to="body">
    <Transition name="share-fade">
      <div v-if="visible" class="share-overlay" @click.self="close">
        <!-- 截图目标：彩色底板 + 卡片 + 装饰 -->
        <div ref="cardRef" class="share-frame">
          <!-- 背景装饰光斑 -->
          <div class="share-blob blob-1" />
          <div class="share-blob blob-2" />
          <div class="share-blob blob-3" />

          <!-- 白色卡片浮于底色之上 -->
          <div class="share-card">
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
            <div v-if="post.images?.length > 0" class="share-images" :class="{ 'single': post.images.length === 1, 'double': post.images.length === 2, 'multi': post.images.length >= 3 }">
              <img
                v-for="(img, i) in post.images"
                :key="i"
                :src="img"
                class="share-img"
                crossorigin="anonymous"
                alt="配图"
              />
            </div>

            <!-- 底部点赞/评论统计 -->
            <div v-if="post.like_count || post.comment_count" class="share-stats">
              <span v-if="post.like_count" class="share-stat-item">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                {{ post.like_count }}
              </span>
              <span v-if="post.comment_count" class="share-stat-item">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                {{ post.comment_count }}
              </span>
            </div>
          </div>

          <!-- 底板底部水印 -->
          <div class="share-frame-watermark">——来自{{ post.display_name }}的朋友圈</div>
        </div>

        <!-- 操作栏（在截图目标外部） -->
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
      backgroundColor: null,        // 保留 frame 自身的渐变背景
      scale: 2,
      useCORS: true,
      allowTaint: true,
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
    // fallback: 降级下载
    try {
      const canvas = await html2canvas(el, { backgroundColor: null, scale: 2, useCORS: true, allowTaint: true, logging: false })
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
    } catch (_) { /* 彻底失败，静默 */ }
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
  gap: 20px;
  padding: 24px;
  overflow-y: auto;
  overflow-x: hidden;              /* 禁止水平溢出导致左右平移 */
  overscroll-behavior: contain;    /* 滚动不传导到 body */
  justify-content: safe center;    /* 内容不超出时居中，超出时顶部对齐避免被裁 */
}

/* ============================================
   底板（截图目标）- 彩色渐变底色包裹卡片
   ============================================ */
.share-frame {
  width: 100%;
  max-width: 750px;
  box-sizing: border-box;           /* padding 不额外撑大宽度 */
  /* 不再限制高度、不再 overflow: auto — 卡片内容全量展示，超长由 overlay 层滚动 */
  position: relative;

  /* 暖色渐变底色 — 与品牌色 #e07b6c 呼应但更柔和 */
  background: linear-gradient(
    145deg,
    #fef5f3 0%,
    #fdf0ed 18%,
    #faf0ea 40%,
    #f8f1ee 65%,
    #fdf5f2 100%
  );

  border-radius: 20px;
  padding: 40px 34px;

  /* 底板自身的呼吸感 — 卡片再在其中浮起 */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

/* ── 背景装饰光斑（html2canvas 兼容：用真实 DOM 不用伪元素）── */
.share-blob {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}
.blob-1 {
  width: 180px; height: 180px;
  top: -30px; right: -40px;
  background: radial-gradient(circle, rgba(224, 123, 108, 0.12) 0%, transparent 70%);
}
.blob-2 {
  width: 140px; height: 140px;
  bottom: 60px; left: -50px;
  background: radial-gradient(circle, rgba(240, 165, 143, 0.10) 0%, transparent 70%);
}
.blob-3 {
  width: 200px; height: 200px;
  top: 50%; left: 60%;
  background: radial-gradient(circle, rgba(232, 196, 160, 0.08) 0%, transparent 70%);
  transform: translate(-50%, -50%);
}

/* ============================================
   白色卡片 — 浮在彩色底板上
   ============================================ */
.share-card {
  width: 100%;
  background: #ffffff;
  border-radius: 16px;
  position: relative;
  z-index: 1;
  overflow: hidden;  /* 配合 border-radius 裁边 */

  /* 多层阴影：近 → 远，营造悬浮感 */
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),      /* 极近：微妙的边界 */
    0 6px 20px rgba(0, 0, 0, 0.06),     /* 中距：主要立体感 */
    0 16px 48px rgba(0, 0, 0, 0.07);    /* 远距：氛围光 */
}

/* 顶部渐变装饰条 */
.share-decorator {
  height: 5px;
  background: linear-gradient(90deg, #e07b6c 0%, #f0a58f 45%, #e8c4a0 100%);
  border-radius: 16px 16px 0 0;
}

/* ── 头部 ── */
.share-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 24px 32px 0;
}
.share-avatar {
  width: 52px; height: 52px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 20px;
  font-weight: 700;
}
.share-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.share-name {
  font-size: 17px;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 0.3px;
  line-height: 1.3;
}
.share-time {
  font-size: 13px;
  color: #aaa;
  letter-spacing: 0.2px;
}

/* ── 正文 ── */
.share-content {
  padding: 18px 32px 0;
  font-size: 16px;
  line-height: 1.9;
  color: #333;
  white-space: pre-wrap;
  word-break: break-word;
  letter-spacing: 0.2px;
}

/* ── 图片 ── */
.share-images {
  display: grid;
  gap: 8px;
  padding: 20px 32px 0;
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
  /* 不再限制高度、不裁切 — 图片完整展示 */
  display: block;
  border-radius: 8px;
}

/* 确保卡片内部最后一个区域有足够的底部呼吸空间 */
.share-card > :last-child {
  padding-bottom: 28px;
}

/* ── 底部统计 ── */
.share-stats {
  display: flex;
  gap: 20px;
  padding: 18px 32px 28px;
  border-top: 1px solid #f5f5f5;
  margin-top: 20px;
}
.share-stat-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: #999;
}

/* ── 底板水印 ── */
.share-frame-watermark {
  font-size: 12px;
  color: rgba(180, 160, 155, 0.8);
  letter-spacing: 0.6px;
  text-align: right;
  position: relative;
  z-index: 1;
  margin-left: auto;
}

/* ============================================
   操作按钮
   ============================================ */
.share-actions {
  display: flex;
  gap: 12px;
}
.share-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 26px;
  border-radius: 14px;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
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
.share-fade-enter-active { transition: opacity 0.25s ease; }
.share-fade-leave-active { transition: opacity 0.2s ease; }
.share-fade-enter-from,
.share-fade-leave-to   { opacity: 0; }
.share-fade-enter-active .share-frame {
  animation: cardUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
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

.spin-icon {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── 移动端 ── */
@media (max-width: 767px) {
  .share-overlay {
    padding: 12px;
    gap: 14px;
  }
  .share-frame {
    max-width: 100%;
    /* 移动端也不限高 — 全量展示 */
    padding: 24px 16px;
    border-radius: 16px;
    gap: 14px;
  }
  .share-card {
    border-radius: 12px;
  }
  .share-decorator {
    border-radius: 12px 12px 0 0;
  }
  .share-header {
    padding: 20px 20px 0;
  }
  .share-name {
    font-size: 15px;
  }
  .share-time {
    font-size: 12px;
  }
  .share-content {
    padding: 14px 20px 0;
    font-size: 14px;
  }
  .share-images {
    padding: 14px 20px 0;
    gap: 5px;
  }
  .share-stats {
    padding: 14px 20px 22px;
    margin-top: 14px;
  }
  .share-actions {
    width: 100%;
  }
  .share-btn {
    flex: 1;
    justify-content: center;
    padding: 14px 20px;
  }
}
</style>
