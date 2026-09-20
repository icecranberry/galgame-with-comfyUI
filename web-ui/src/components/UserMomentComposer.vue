<template>
  <div class="user-composer" @paste.capture="onPaste">
    <div class="composer-row">
      <div class="composer-avatar" :class="{ 'is-user': true }" :style="avatarStyle">
        <img v-if="showAvatar" :src="userAvatar" alt="" @error="avatarFailed = true" />
        <span v-else>我</span>
      </div>
      <linshe-input
        v-model="text"
        class="composer-input"
        type="textarea"
        :rows="2"
        maxlength="2000"
        placeholder="分享这一刻..."
        :disabled="sending"
      />
    </div>

    <!-- 图片预览条：最多 3 张，可移除 -->
    <div v-if="images.length" class="composer-previews">
      <div v-for="(img, i) in images" :key="i" class="composer-thumb">
        <img :src="img" alt="" />
        <div
          class="thumb-remove"
          role="button"
          tabindex="0"
          aria-label="移除图片"
          @click="removeImage(i)"
          @keydown.enter.prevent="removeImage(i)"
          @keydown.space.prevent="removeImage(i)"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </div>
      </div>
      <div
        v-if="images.length < MAX_IMAGES"
        class="composer-add"
        role="button"
        tabindex="0"
        aria-label="添加图片"
        title="上传图片"
        @click="fileInput?.click()"
        @keydown.enter.prevent="fileInput?.click()"
        @keydown.space.prevent="fileInput?.click()"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
      </div>
    </div>

    <div class="composer-actions">
      <div class="composer-hint">今天~有什么想要分享？</div>
      <div class="composer-btns">
        <linshe-button
          variant="chip"
          size="sm"
          :active="hasAutoImagePrompt"
          :disabled="sending || images.length >= MAX_IMAGES"
          title="发布时自动生成配图"
          @click="showAutoImageModal = true"
        >
自动配图
        </linshe-button>
        <div
          v-if="images.length < MAX_IMAGES"
          class="composer-attach"
          role="button"
          tabindex="0"
          aria-label="上传图片"
          title="上传图片（也可直接粘贴）"
          @click="fileInput?.click()"
          @keydown.enter.prevent="fileInput?.click()"
          @keydown.space.prevent="fileInput?.click()"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
        </div>
        <linshe-button
          variant="primary"
          size="sm"
          :disabled="!canSend"
          :loading="sending"
          @click="send"
        >
发布
</linshe-button>
      </div>
    </div>

    <linshe-modal v-model="showAutoImageModal" title="自动配图">
      <label class="auto-image-label" for="auto-image-prompt">图片需求</label>
      <linshe-input
        id="auto-image-prompt"
        v-model="autoImagePrompt"
        type="textarea"
        rows="6"
        maxlength="2000"
        placeholder="描述想要生成的画面..."
        :disabled="sending"
      />
      <template #footer>
        <linshe-button
          variant="ghost"
          tone="danger"
          :disabled="!hasAutoImagePrompt || sending"
          @click="clearAutoImagePrompt"
        >
          清除
        </linshe-button>
        <linshe-button variant="primary" @click="showAutoImageModal = false">完成</linshe-button>
      </template>
    </linshe-modal>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      :multiple="allowMultiple"
      class="composer-file-input"
      @change="onFiles"
    />
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, onUnmounted } from 'vue'
import { useMomentsStore } from '../stores/moments.js'
import { onEvent } from '../stores/unifiedStream.js'
import { userAvatar } from '../userConfig.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheModal from './ui/LinsheModal.vue'
import { testStyle } from '../api/index.js'
import { appendMomentImageRequest } from '../utils/momentImageRequest.js'

const MAX_IMAGES = 3
// 超过该大小的原图统一压到最长边 1600 的 JPEG（base64 传输体积 + GIF 动图例外保留）
const COMPRESS_THRESHOLD = 1.5 * 1024 * 1024

const moments = useMomentsStore()
const toastFn = inject('toast', null)
const isMobile = inject('isMobile', null)

const text = ref('')
const images = ref([])
const sending = ref(false)
const fileInput = ref(null)
const allowMultiple = ref(true)
const avatarFailed = ref(false)
const autoImagePrompt = ref('')
const showAutoImageModal = ref(false)
let unsubscribeVisionError = null

onMounted(() => {
  // 手机相册多选返回路径不稳定（部分 ROM 会回 RESULT_CANCELED，选完不派发 change），
  // 移动端与安卓壳内一律退回单选（壳内多选解析失败时 WebView 连 change 都不会触发）
  if (isMobile?.value || (typeof window !== 'undefined' && !!window.AndroidBridge)) {
    allowMultiple.value = false
  }
  unsubscribeVisionError = onEvent('user_moment_vision_error', (data) => {
    if (!data?.message) return
    toastFn?.(data.message, 'error', 6000, data.description)
  })
})

onUnmounted(() => {
  unsubscribeVisionError?.()
})

const canSend = computed(() => !sending.value && (text.value.trim() || images.value.length > 0 || hasAutoImagePrompt.value))
const hasAutoImagePrompt = computed(() => autoImagePrompt.value.trim().length > 0)
const showAvatar = computed(() => !!userAvatar.value && !avatarFailed.value)
const avatarStyle = computed(() => (
  showAvatar.value
    ? { backgroundImage: `url(${userAvatar.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {}
))

function removeImage(i) {
  images.value.splice(i, 1)
}

function clearAutoImagePrompt() {
  autoImagePrompt.value = ''
  showAutoImageModal.value = false
}

// 部分安卓 ROM 回传的 MIME 是 application/octet-stream 或空串，这里用扩展名兜底判断
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i
function isImageFile(file) {
  return !!file && (file.type?.startsWith('image/') || IMAGE_EXT_RE.test(file.name || ''))
}

function addFiles(list) {
  const all = Array.from(list || [])
  const files = all.filter(isImageFile)
  if (!files.length) {
    if (all.length) toastFn?.('没有读取到图片，请重新选择', 'error')
    return
  }
  for (const file of files) {
    if (images.value.length >= MAX_IMAGES) {
      toastFn?.(`最多配 ${MAX_IMAGES} 张图片`, 'error')
      break
    }
    normalizeImage(file).then(dataUrl => {
      if (images.value.length < MAX_IMAGES) images.value.push(dataUrl)
    }).catch(err => {
      console.error('[UserMomentComposer] read image failed:', err)
      toastFn?.('图片读取失败', 'error')
    })
  }
}

function onFiles(e) {
  addFiles(e.target.files)
  e.target.value = ''
}

function onPaste(e) {
  const files = e.clipboardData?.files
  if (files && files.length) {
    const hasImage = Array.from(files).some(isImageFile)
    if (hasImage) {
      e.preventDefault()
      addFiles(files)
    }
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('decode failed'))
    img.src = src
  })
}

async function normalizeImage(file) {
  const dataUrl = await fileToDataUrl(file)
  if (file.size <= COMPRESS_THRESHOLD) return dataUrl
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
  canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.88)
}

async function generateAutoImage() {
  const desc = autoImagePrompt.value.trim()
  if (!desc) return null
  if (images.value.length >= MAX_IMAGES) throw new Error(`最多配 ${MAX_IMAGES} 张图片，无法自动配图`)

  // 与图片实验室的自由画面描述链路保持一致，使用当前朋友圈画师串与分辨率配置。
  const result = await testStyle({ mode: 'moments', sceneDesc: desc })
  if (!result?.success || !result.images?.length) {
    throw new Error(result?.error || '自动配图生成失败')
  }
  const dataUrl = result.images[0]?.base64
  if (!dataUrl) throw new Error('自动配图生成失败')
  return dataUrl
}

async function send() {
  const content = text.value.trim()
  if (!canSend.value) return
  sending.value = true
  try {
    const autoImage = await generateAutoImage()
    const payloadImages = [...images.value]
    if (autoImage) payloadImages.push(autoImage)

    const storedContent = appendMomentImageRequest(content, autoImagePrompt.value.trim())
    await moments.createUserPost({ content: storedContent, images: payloadImages })
    text.value = ''
    images.value = []
    autoImagePrompt.value = ''
  } catch (err) {
    console.error('[UserMomentComposer] publish error:', err)
    toastFn?.(err.message || '发布失败', 'error')
  } finally {
    sending.value = false
  }
}
</script>

<style scoped>
.user-composer {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  padding: 16px 16px;
  box-shadow: var(--glass-shadow);
}
@media (max-width: 767px) {
  .user-composer { padding: 12px 15px; }
}

@media (max-width: 480px) {
  .composer-actions { flex-wrap: wrap; }
  .composer-hint { flex-basis: 100%; }
}

.composer-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.composer-avatar {
  width: 40px; height: 40px; border-radius: 50%;
  flex-shrink: 0;
  background: var(--accent);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 16px; font-weight: 700;
  overflow: hidden;
  user-select: none;
  box-shadow: 0 0 0 1.5px rgba(var(--accent-rgb), 0.35);
}
.composer-avatar img {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.composer-input { flex: 1; }

.composer-previews {
  display: flex;
  gap: 8px;
  margin: 10px 0 0 52px;
  flex-wrap: wrap;
}
.composer-thumb {
  position: relative;
  width: 72px; height: 72px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--glass-border);
}
.composer-thumb img {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.thumb-remove {
  position: absolute;
  top: 3px; right: 3px;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
.thumb-remove:hover { background: rgba(0, 0, 0, 0.75); }

.composer-add {
  width: 72px; height: 72px;
  border-radius: 10px;
  border: 1.5px dashed var(--border-strong);
  color: var(--text-secondary);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-standard);
  user-select: none;
}
.composer-add:hover { color: var(--accent); border-color: var(--accent); }

.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
}
.composer-hint {
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.8;
}
.composer-btns {
  display: flex;
  align-items: center;
  gap: 10px;
}
.composer-attach {
  width: 30px; height: 30px;
  border-radius: 8px;
  color: var(--text-secondary);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-standard);
  user-select: none;
}
.composer-attach:hover { color: var(--accent); background: rgba(var(--accent-rgb), 0.08); }

.auto-image-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.composer-file-input { display: none; }
</style>
