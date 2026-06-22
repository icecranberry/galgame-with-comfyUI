<template>
  <!-- 头像选择器弹窗 -->
  <div v-if="!cropImage" class="avpicker-overlay" @click.self="tryClose">
    <div class="avpicker-panel">
      <div class="avpicker-header">
        <span>{{ title }}</span>
        <button class="avpicker-close" :disabled="isGenerating" @click="tryClose">&times;</button>
      </div>
      <div v-if="showRecentTab || showGenerateTab" class="avpicker-tabs">
        <button :class="['avtab', { active: avTab === 'upload' }]" :disabled="isGenerating" @click="avTab = 'upload'">上传图片</button>
        <button v-if="showRecentTab" :class="['avtab', { active: avTab === 'recent' }]" :disabled="isGenerating" @click="switchToRecent">最近图片</button>
        <button v-if="showGenerateTab" :class="['avtab', { active: avTab === 'generate' }]" :disabled="isGenerating" @click="avTab = 'generate'">生成头像</button>
      </div>

      <!-- 上传 tab -->
      <div v-if="avTab === 'upload'" class="avtab-body">
        <label class="av-upload-zone">
          <input type="file" accept="image/*" @change="onFilePicked" hidden ref="fileInput" />
          <div class="av-upload-inner">
            <div class="av-upload-icon">📁</div>
            <div class="av-upload-text">点击选择图片文件</div>
          </div>
        </label>
      </div>

      <!-- 最近图片 tab -->
      <div v-if="showRecentTab && avTab === 'recent'" class="avtab-body av-gallery">
        <div v-if="recentLoading" class="av-loading">加载中...</div>
        <div v-else-if="recentImages.length === 0" class="av-empty">暂无生成的图片</div>
        <img
          v-for="(url, i) in recentImages"
          :key="'rec'+i"
          :src="url"
          class="av-thumb"
          @click="selectRecentImage(url)"
          @error="onRecentImgErr(i)"
          :class="{ 'av-thumb-err': recentImgErr.has(i) }"
        />
      </div>

      <!-- 生成头像 tab -->
      <div v-if="showGenerateTab && avTab === 'generate'" class="avtab-body">
        <div v-if="genError" class="gen-error">
          <div class="gen-error-icon">⚠️</div>
          <div class="gen-error-text">{{ genError }}</div>
          <button class="gen-retry-btn" @click="startGenerate">重新生成</button>
        </div>

        <div v-else-if="genStatus === 'idle'" class="gen-idle">
          <div class="gen-label">生成角色头像</div>
          <div class="gen-desc">给角色拍个大头贴⭐~</div>
          <div class="gen-meta">尺寸 1024×1024 · 约需等待30秒</div>
          <button class="gen-start-btn" @click="startGenerate" :disabled="!characterId">
            {{ characterId ? '开始生成' : '缺少角色数据' }}
          </button>
        </div>

        <div v-else-if="genStatus === 'generating'" class="gen-running">
          <div class="gen-spinner">
            <div class="gen-spinner-ring"></div>
            <div class="gen-spinner-icon">🎨</div>
          </div>
          <div class="gen-phase">{{ genPhaseText }}</div>
          <div class="gen-progress-hint">正在超速思考，请耐心等待...</div>
        </div>
      </div>
    </div>
  </div>

  <!-- 头像裁剪编辑器 -->
  <div v-else class="crop-overlay">
    <div class="crop-panel">
      <div class="crop-header">
        <span>裁剪头像 — 拖拽移动图片、滚轮缩放</span>
        <button class="crop-close" @click="cancelCrop">&times;</button>
      </div>
      <div class="crop-body">
        <canvas ref="cropCanvas" class="crop-canvas"
          @mousedown.prevent="cropMouseDown"
          @mousemove.prevent="cropMouseMove"
          @mouseup="cropMouseUp"
          @mouseleave="cropMouseUp"
          @wheel.prevent="cropWheel"
          @touchstart.prevent="cropTouchStart"
          @touchmove.prevent="cropTouchMove"
          @touchend="cropTouchEnd"
        ></canvas>
        <div class="crop-preview-container">
          <div class="crop-preview-label">预览</div>
          <canvas ref="previewCanvas" class="crop-preview"></canvas>
          <div class="crop-zoom-info">{{ Math.round(cropVars.imgScale * 100) }}%</div>
        </div>
      </div>
      <div class="crop-actions">
        <button class="btn-cancel" @click="cancelCrop">取消</button>
        <button class="btn-primary" @click="saveCrop" :disabled="cropSaving">{{ cropSaving ? '保存中...' : '保存头像' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onUnmounted } from 'vue'
import { generateAvatar } from '../api/index.js'

const props = defineProps({
  title: { type: String, default: '选择头像' },
  showRecentTab: { type: Boolean, default: true },
  showGenerateTab: { type: Boolean, default: false },
  characterId: { type: [Number, String], default: null },
  characterBasePrompt: { type: String, default: '' },
  recentImages: { type: Array, default: () => [] },
  recentLoading: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'save', 'switchToRecent'])

const avTab = ref('upload')
const fileInput = ref(null)
const recentImgErr = ref(new Set())

// 裁剪状态
const cropImage = ref(null)
const cropCanvas = ref(null)
const previewCanvas = ref(null)
const cropSaving = ref(false)

// ── 生成头像状态 ──
const genStatus = ref('idle') // idle | generating | error
const genError = ref('')
const genPhaseText = ref('准备中...')
let _genPhaseTimer = null

const isGenerating = computed(() => genStatus.value === 'generating')

function tryClose() {
  if (isGenerating.value) return
  emit('close')
}

const genPhaseMessages = [
  '正在分析角色人格...',
  '构思画面构图...',
  '生成画面描述...',
  '提交绘图引擎...',
  'AI 正在绘制中...',
  '即将完成...',
]

function cycleGenPhase(startIdx = 0) {
  let idx = startIdx
  genPhaseText.value = genPhaseMessages[idx]
  _genPhaseTimer = setInterval(() => {
    idx = (idx + 1) % genPhaseMessages.length
    genPhaseText.value = genPhaseMessages[idx]
  }, 6000)
}

function stopPhaseCycle() {
  if (_genPhaseTimer) { clearInterval(_genPhaseTimer); _genPhaseTimer = null }
}

onUnmounted(() => { stopPhaseCycle() })

async function startGenerate() {
  if (!props.characterId || genStatus.value === 'generating') return
  genStatus.value = 'generating'
  genError.value = ''
  cycleGenPhase(0)

  try {
    const result = await generateAvatar(props.characterId)
    stopPhaseCycle()

    if (result.success && result.images?.length > 0) {
      const imgData = result.images[0]
      // 加载 base64 图片并进入裁剪流程
      const img = new Image()
      img.onload = () => {
        genStatus.value = 'idle'
        startCrop(img)
      }
      img.onerror = () => {
        genStatus.value = 'idle'
        genError.value = '图片加载失败，请重试'
      }
      if (imgData.base64) {
        img.src = imgData.base64
      } else if (imgData.url) {
        // 如果返回的是 URL，需要通过 Image 加载（注意 CORS）
        img.crossOrigin = 'anonymous'
        img.src = imgData.url
      }
    } else {
      genStatus.value = 'idle'
      genError.value = result.error || '图像生成失败，请重试'
    }
  } catch (err) {
    stopPhaseCycle()
    genStatus.value = 'idle'
    genError.value = err.message || '生成失败，请检查后端服务'
    console.error('[avatar] generate failed:', err)
  }
}

function switchToRecent() {
  avTab.value = 'recent'
  emit('switchToRecent')
}

function onRecentImgErr(i) {
  const s = new Set(recentImgErr.value)
  s.add(i)
  recentImgErr.value = s
}

// ── 上传 ──
function onFilePicked(e) {
  const file = e.target.files[0]
  if (!file) return
  loadImageFromFile(file)
}

function selectRecentImage(url) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => startCrop(img)
  img.onerror = () => {}
  img.src = url
}

function loadImageFromFile(file) {
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => startCrop(img)
    img.src = reader.result
  }
  reader.readAsDataURL(file)
}

// ── 裁剪引擎 ──
// 行业标准做法：裁剪圆固定在画布中心不动，用户拖拽/缩放底图来调整选取区域
// 图片始终以原分辨率渲染到 canvas（借助 ctx.drawImage 的目标缩放），保存时直接裁原图，无精度损失

const CROP_CANVAS = 400
const CROP_CX = CROP_CANVAS / 2
const CROP_CY = CROP_CANVAS / 2
const CROP_R = 160

const cropVars = reactive({
  imgScale: 1,
  imgX: 0,
  imgY: 0,
})

let cropDragging = false
let cropDragStart = { x: 0, y: 0, imgX: 0, imgY: 0 }
let cropPinchDist = 0
let cropPinchScale = 1

function startCrop(img) {
  cropImage.value = img

  const minDim = Math.min(img.naturalWidth, img.naturalHeight)
  const initScale = (CROP_R * 2) / minDim

  cropVars.imgScale = initScale
  cropVars.imgX = CROP_CX - (img.naturalWidth * initScale) / 2
  cropVars.imgY = CROP_CY - (img.naturalHeight * initScale) / 2

  cropDragging = false
  nextTick(() => drawCrop())
}

function drawCrop() {
  const canvas = cropCanvas.value
  if (!canvas || !cropImage.value) return
  const ctx = canvas.getContext('2d')
  canvas.width = CROP_CANVAS
  canvas.height = CROP_CANVAS

  const img = cropImage.value
  const sw = img.naturalWidth, sh = img.naturalHeight
  const dw = sw * cropVars.imgScale, dh = sh * cropVars.imgScale
  const dx = cropVars.imgX, dy = cropVars.imgY

  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(0, 0, CROP_CANVAS, CROP_CANVAS)

  ctx.save()
  ctx.drawImage(img, 0, 0, sw, sh, dx, dy, dw, dh)

  ctx.beginPath()
  ctx.rect(0, 0, CROP_CANVAS, CROP_CANVAS)
  ctx.arc(CROP_CX, CROP_CY, CROP_R, 0, Math.PI * 2, true)
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fill()

  ctx.beginPath()
  ctx.arc(CROP_CX, CROP_CY, CROP_R, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()

  const preview = previewCanvas.value
  if (preview) {
    const ps = 80
    preview.width = ps
    preview.height = ps
    const pctx = preview.getContext('2d')
    pctx.clearRect(0, 0, ps, ps)
    pctx.save()
    pctx.beginPath()
    pctx.arc(ps / 2, ps / 2, ps / 2, 0, Math.PI * 2)
    pctx.clip()
    pctx.drawImage(img,
      (CROP_CX - CROP_R - cropVars.imgX) / cropVars.imgScale,
      (CROP_CY - CROP_R - cropVars.imgY) / cropVars.imgScale,
      (CROP_R * 2) / cropVars.imgScale,
      (CROP_R * 2) / cropVars.imgScale,
      0, 0, ps, ps)
    pctx.restore()
  }
}

// ── 鼠标拖拽 ──
function cropMouseDown(e) {
  cropDragging = true
  cropDragStart = { x: e.clientX, y: e.clientY, imgX: cropVars.imgX, imgY: cropVars.imgY }
}

function cropMouseMove(e) {
  if (!cropDragging) return
  const dx = e.clientX - cropDragStart.x
  const dy = e.clientY - cropDragStart.y
  cropVars.imgX = cropDragStart.imgX + dx
  cropVars.imgY = cropDragStart.imgY + dy
  drawCrop()
}

function cropMouseUp() { cropDragging = false }

// ── 滚轮缩放（以鼠标/手指位置为中心） ──
function cropWheel(e) {
  const rect = cropCanvas.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
  zoomAt(mx, my, factor)
}

function zoomAt(mx, my, factor) {
  const oldS = cropVars.imgScale
  const newS = Math.max(0.1, Math.min(5, oldS * factor))
  cropVars.imgX = mx - (mx - cropVars.imgX) * (newS / oldS)
  cropVars.imgY = my - (my - cropVars.imgY) * (newS / oldS)
  cropVars.imgScale = newS
  drawCrop()
}

// ── 触摸（单指拖拽 + 双指缩放） ──
function cropTouchStart(e) {
  if (e.touches.length === 1) {
    cropDragging = true
    cropDragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, imgX: cropVars.imgX, imgY: cropVars.imgY }
  } else if (e.touches.length === 2) {
    cropDragging = false
    cropPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
    cropPinchScale = cropVars.imgScale
  }
}

function cropTouchMove(e) {
  if (e.touches.length === 2) {
    const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
    const factor = dist / cropPinchDist
    const newS = Math.max(0.1, Math.min(5, cropPinchScale * factor))
    const rect = cropCanvas.value.getBoundingClientRect()
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
    cropVars.imgX = cx - (cx - cropVars.imgX) * (newS / cropVars.imgScale)
    cropVars.imgY = cy - (cy - cropVars.imgY) * (newS / cropVars.imgScale)
    cropVars.imgScale = newS
    drawCrop()
  } else if (e.touches.length === 1 && cropDragging) {
    const dx = e.touches[0].clientX - cropDragStart.x
    const dy = e.touches[0].clientY - cropDragStart.y
    cropVars.imgX = cropDragStart.imgX + dx
    cropVars.imgY = cropDragStart.imgY + dy
    drawCrop()
  }
}

function cropTouchEnd(e) {
  if (e.touches.length === 0) cropDragging = false
}

function cancelCrop() { cropImage.value = null }

// ── 保存：直接从原图裁剪（无缩放精度损失） ──
async function saveCrop() {
  if (cropSaving.value || !cropImage.value) return
  cropSaving.value = true
  try {
    const img = cropImage.value
    const s = cropVars.imgScale
    const srcX = (CROP_CX - CROP_R - cropVars.imgX) / s
    const srcY = (CROP_CY - CROP_R - cropVars.imgY) / s
    const srcLen = (CROP_R * 2) / s
    const outSize = 200

    const tmpCanvas = document.createElement('canvas')
    tmpCanvas.width = outSize
    tmpCanvas.height = outSize
    const ctx = tmpCanvas.getContext('2d')
    ctx.beginPath()
    ctx.arc(outSize / 2, outSize / 2, outSize / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(img, srcX, srcY, srcLen, srcLen, 0, 0, outSize, outSize)
    const base64 = tmpCanvas.toDataURL('image/png')
    emit('save', base64)
  } catch (err) {
    console.error('[avatar] save crop failed:', err)
  } finally { cropSaving.value = false }
}
</script>

<style scoped>
/* ── 选择器弹窗 ── */
.avpicker-overlay {
  position:fixed; inset:0; background:transparent;
  display:flex; align-items:center; justify-content:center; z-index:11001;
  animation: avFadeIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.avpicker-panel {
  width:520px; max-height:80vh;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-radius:16px;
  border:1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 12px 48px rgba(0,0,0,0.1);
  display:flex; flex-direction:column; overflow:hidden;
  animation: avScaleIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
@keyframes avFadeIn  { from { opacity:0; } to { opacity:1; } }
@keyframes avScaleIn { from { opacity:0; transform: scale(0.95); } to { opacity:1; transform: scale(1); } }

.avpicker-header { padding:14px 18px; border-bottom:1px solid rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:space-between; }
.avpicker-header span { font-size:15px; font-weight:600; color:var(--text-bright); }
.avpicker-close { width:28px; height:28px; border-radius:6px; border:none; background:transparent; color:var(--text-secondary); font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.avpicker-close:hover:not(:disabled) { color:var(--text-bright); background:rgba(0,0,0,0.06); }
.avpicker-close:disabled { opacity:0.3; cursor:not-allowed; }

.avpicker-tabs { display:flex; border-bottom:1px solid rgba(255,255,255,0.2); }
.avtab { flex:1; padding:10px 0; border:none; border-radius:0; background:transparent; color:var(--text-secondary); font-size:13px; cursor:pointer; transition:color 0.15s; border-bottom:2px solid transparent; }
.avtab:hover:not(:disabled) { color:var(--text-bright); }
.avtab:disabled { opacity:0.35; cursor:not-allowed; }
.avtab.active { color:var(--accent); border-bottom-color:var(--accent); }

.avtab-body { padding:16px; overflow-y:auto; max-height:380px; }
.av-upload-zone { display:block; border:2px dashed rgba(255,255,255,0.25); border-radius:10px; cursor:pointer; transition:border-color 0.15s; }
.av-upload-zone:hover { border-color:var(--accent); }
.av-upload-inner { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:48px 16px; gap:10px; }
.av-upload-icon { font-size:40px; }
.av-upload-text { font-size:14px; color:var(--text-secondary); }

.av-gallery { display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; }
.av-loading, .av-empty { font-size:13px; color:var(--text-secondary); text-align:center; padding:40px 0; grid-column:1/-1; }
.av-thumb { width:100%; aspect-ratio:1; object-fit:cover; border-radius:8px; cursor:pointer; border:2px solid transparent; transition:border-color 0.15s; }
.av-thumb:hover { border-color:var(--accent); }
.av-thumb-err { opacity:0.3; cursor:default; }

/* ── 裁剪编辑器 ── */
.crop-overlay {
  position:fixed; inset:0; background:transparent;
  display:flex; align-items:center; justify-content:center; z-index:11002;
  animation: avFadeIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.crop-panel {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-radius:16px;
  border:1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 12px 48px rgba(0,0,0,0.1);
  overflow:hidden;
  animation: avScaleIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.crop-header { padding:14px 18px; border-bottom:1px solid rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:space-between; }
.crop-header span { font-size:14px; font-weight:600; color:var(--text-bright); }
.crop-close { width:28px; height:28px; border-radius:6px; border:none; background:transparent; color:var(--text-secondary); font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.crop-close:hover { color:var(--text-bright); background:rgba(0,0,0,0.06); }

.crop-body { display:flex; gap:20px; padding:20px; align-items:flex-start; }
.crop-canvas { display:block; border-radius:8px; cursor:grab; max-width:400px; }
.crop-canvas:active { cursor:grabbing; }
.crop-preview-container { display:flex; flex-direction:column; align-items:center; gap:8px; }
.crop-preview-label { font-size:12px; color:var(--text-secondary); }
.crop-preview { width:80px; height:80px; border-radius:50%; border:2px solid var(--border); }
.crop-zoom-info { font-size:12px; color:var(--text-secondary); }

.crop-actions { padding:14px 20px; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
.btn-cancel { padding:8px 18px; border-radius:6px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary); font-size:13px; cursor:pointer; }
.btn-cancel:hover { background:var(--bg-hover); }
.btn-primary { background:var(--accent); color:#fff; padding:8px 18px; border-radius:6px; border:none; font-size:13px; cursor:pointer; }
.btn-primary:hover:not(:disabled) { background:var(--accent-hover); }
.btn-primary:disabled { opacity:0.5; cursor:not-allowed; }

/* ── 生成头像 Tab ── */
.gen-idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px 32px;
  gap: 10px;
}
.gen-icon { font-size: 44px; }
.gen-label { font-size: 15px; font-weight: 600; color: var(--text-bright); }
.gen-desc { font-size: 13px; color: var(--text-secondary); text-align: center; line-height: 1.5; }
.gen-meta { font-size: 12px; color: var(--text-muted, #999); }
.gen-start-btn {
  margin-top: 12px;
  padding: 10px 28px;
  border-radius: 8px;
  border: none;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.gen-start-btn:hover:not(:disabled) { background: var(--accent-hover); }
.gen-start-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* 生成中动画 */
.gen-running {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px 40px;
  gap: 16px;
}
.gen-spinner {
  position: relative;
  width: 80px; height: 80px;
  display: flex; align-items: center; justify-content: center;
}
.gen-spinner-ring {
  position: absolute; inset: 0;
  border: 3px solid rgba(255,255,255,0.15);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: genSpin 1s linear infinite;
}
@keyframes genSpin { to { transform: rotate(360deg); } }
.gen-spinner-icon { font-size: 28px; z-index: 1; }
.gen-phase { font-size: 15px; font-weight: 600; color: var(--text-bright); }
.gen-progress-hint { font-size: 12px; color: var(--text-secondary); }

/* 生成失败 */
.gen-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px 32px;
  gap: 10px;
}
.gen-error-icon { font-size: 36px; }
.gen-error-text { font-size: 13px; color: #e07b6c; text-align: center; }
.gen-retry-btn {
  margin-top: 8px;
  padding: 8px 20px;
  border-radius: 6px;
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}
.gen-retry-btn:hover { background: rgba(var(--accent-rgb, 100, 140, 255), 0.1); }
</style>
