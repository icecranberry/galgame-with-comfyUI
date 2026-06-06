<template>
  <div class="chat-view">
    <div v-if="!chat.activeCharId" class="empty-state">
      <div class="empty-icon">💬</div>
      <h2>选择一个角色开始对话</h2>
    </div>

    <template v-else>
      <div class="chat-header">
        <span class="chat-title">{{ chat.activeChar?.display_name }}</span>
        <button class="btn-header-settings" title="角色设置" @click="openSettings">⚙️</button>
      </div>

      <div ref="msgList" class="message-list" @scroll="onScroll">
        <div ref="msgInner" class="msg-inner">
          <!-- 顶部加载指示器 -->
          <div v-if="chat.loadingOlder" class="load-older">加载更早的消息...</div>
          <div v-else-if="chat.hasMoreOlder" class="load-older load-older-hint">↑ 向上滚动加载更多</div>
          <div v-for="(group, gi) in messageGroups" :key="gi">
            <div class="time-divider">{{ group.label }}</div>

            <template v-for="msg in group.msgs" :key="msg.id">
              <!-- Text bubble (user or assistant) -->
              <div v-if="msg.type !== 'image_gen'" class="message" :class="msg.role">
                <div class="msg-bubble">
                  <div class="msg-text" v-html="renderContent(msg.content)"></div>
                </div>
              </div>

              <!-- Image generation bubble -->
              <div v-else class="message assistant">
                <ImageGenBubble
                  :msg="msg"
                  @preview="previewImage = $event"
                />
              </div>
            </template>
          </div>
          <div ref="bottomAnchor"></div>
        </div>
      </div>

      <div class="input-area">
        <textarea ref="inputEl" v-model="inputText" class="chat-input"
          placeholder="输入消息..." rows="1"
          @keydown.enter.exact.prevent="send"
          @keydown.enter.shift.exact="inputText += '\n'"
        ></textarea>
        <button class="btn-primary send-btn" @click="send" :disabled="!inputText.trim() || chat.streaming">
          {{ chat.streaming ? '发送中...' : '发送' }}
        </button>
      </div>
    </template>

    <div v-if="previewImage" class="img-overlay" @click="previewImage = null">
      <img :src="previewImage" class="img-full" @click.stop />
      <button class="img-close" @click="previewImage = null">&times;</button>
    </div>

    <!-- 角色设置面板（点击 ⚙️ 弹出） -->
    <div v-if="showSettings" class="settings-overlay" @click.self="closeSettings">
      <div class="settings-panel">
        <div class="sph">
          <span>角色设置</span>
          <button class="settings-close" @click="closeSettings">&times;</button>
        </div>

        <!-- 头像设置 -->
        <div class="sp-section">
          <label class="sp-label">头像</label>
          <div class="avatar-row">
            <div
              class="avatar-preview clickable"
              :style="avatarPreviewStyle"
              @click="openAvatarPicker"
            >{{ chat.activeChar?.avatar_path ? '' : chat.activeChar?.display_name?.charAt(0) }}</div>
            <div>
              <button class="sp-btn-small" @click="openAvatarPicker">更换头像</button>
              <button v-if="chat.activeChar?.avatar_path" class="sp-btn-small sp-btn-subtle" @click="removeAvatar">移除</button>
            </div>
          </div>
        </div>

        <div class="sp-divider"></div>

        <!-- 编辑人格 → 二级弹窗 -->
        <button class="sp-btn" @click="openCharEditor">📝 编辑角色人格</button>

        <!-- 清空聊天记录 -->
        <button class="sp-btn" @click="clearChatHistory" :disabled="clearing">
          {{ clearing ? '清空中...' : '🗑️ 清空聊天记录' }}
        </button>

        <div class="sp-divider"></div>

        <!-- 删除角色 -->
        <button class="sp-btn sp-btn-danger" @click="deleteChar" :disabled="deleting || chat.activeChar?.name === 'default'"
          :title="chat.activeChar?.name === 'default' ? '不能删除默认助手' : ''">
          {{ deleting ? '删除中...' : '⚠️ 删除角色' }}
        </button>
      </div>
    </div>

    <!-- 角色人格编辑弹窗（二级菜单） -->
    <div v-if="showEditor" class="editor-overlay">
      <div class="editor-panel">
        <div class="editor-header">
          <span>编辑角色人格 — {{ chat.activeChar?.display_name }}</span>
          <button class="editor-close" @click="closeCharEditor">&times;</button>
        </div>
        <div class="editor-field">
          <label>显示名称</label>
          <input v-model="editForm.display_name" class="editor-input" />
        </div>
        <div class="editor-field">
          <label>人格提示词（base_prompt）</label>
          <textarea v-model="editForm.base_prompt" class="editor-textarea" rows="18"></textarea>
        </div>
        <div class="editor-actions">
          <div class="editor-actions-right">
            <button class="btn-cancel" @click="closeCharEditor">取消</button>
            <button class="btn-primary" @click="saveCharEditor" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 头像选择器弹窗 -->
    <div v-if="showAvatarPicker" class="avpicker-overlay" @click.self="closeAvatarPicker">
      <div class="avpicker-panel">
        <div class="avpicker-header">
          <span>选择头像</span>
          <button class="avpicker-close" @click="closeAvatarPicker">&times;</button>
        </div>
        <div class="avpicker-tabs">
          <button :class="['avtab', { active: avTab === 'upload' }]" @click="avTab = 'upload'">上传图片</button>
          <button :class="['avtab', { active: avTab === 'recent' }]" @click="switchToRecent">最近生成</button>
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

        <!-- 最近生成 tab -->
        <div v-if="avTab === 'recent'" class="avtab-body av-gallery">
          <div v-if="recentLoading" class="av-loading">加载中...</div>
          <div v-else-if="recentImages.length === 0" class="av-empty">暂无生成的图片</div>
          <img
            v-for="(url, i) in recentImages"
            :key="'rec'+i"
            :src="proxyUrl(url)"
            class="av-thumb"
            @click="selectRecentImage(url)"
            @error="onRecentImgErr(i)"
            :class="{ 'av-thumb-err': recentImgErr.has(i) }"
          />
        </div>
      </div>
    </div>

    <!-- 头像裁剪编辑器 -->
    <div v-if="cropImage" class="crop-overlay">
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
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import ImageGenBubble from '../components/ImageGenBubble.vue'

const route = useRoute()
const chat = useChatStore()
const inputText = ref('')
const inputEl = ref(null)
const msgList = ref(null)
const msgInner = ref(null)
const bottomAnchor = ref(null)
const previewImage = ref(null)

// ── 角色设置面板 ──
const showSettings = ref(false)
const showEditor = ref(false)
const saving = ref(false)
const clearing = ref(false)
const deleting = ref(false)
const editForm = ref({ display_name: '', base_prompt: '' })

const avatarPreviewStyle = computed(() => {
  const p = chat.activeChar?.avatar_path
  if (p) return { backgroundImage: `url(${p})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  return { background: chat.activeChar?.avatar_color || '#5b8def' }
})

function openSettings() { showSettings.value = true }
function closeSettings() { showSettings.value = false }

function openCharEditor() {
  const c = chat.activeChar
  if (!c) return
  editForm.value = { display_name: c.display_name || '', base_prompt: c.base_prompt || '' }
  showEditor.value = true
}
function closeCharEditor() { showEditor.value = false }

async function saveCharEditor() {
  if (saving.value) return
  saving.value = true
  try {
    await chat.updateActiveCharacter({ display_name: editForm.value.display_name, base_prompt: editForm.value.base_prompt })
    showEditor.value = false
  } catch (err) {
    console.error('[chat] save character failed:', err)
  } finally { saving.value = false }
}

async function clearChatHistory() {
  if (clearing.value || !confirm('确定要清空当前角色的所有聊天记录吗？此操作不可恢复。')) return
  clearing.value = true
  try { await chat.clearActiveMessages() } catch {} finally { clearing.value = false }
}

async function deleteChar() {
  if (deleting.value || chat.activeChar?.name === 'default') return
  if (!confirm(`确定要删除角色「${chat.activeChar?.display_name}」吗？\n此操作不可恢复。`)) return
  deleting.value = true
  try { await chat.deleteActiveCharacter(); showSettings.value = false } catch {} finally { deleting.value = false }
}

async function removeAvatar() {
  await chat.uploadAvatar(null)
}

// ══════════════════════════════════════════════════
// 头像选择器 + 裁剪编辑器
// ══════════════════════════════════════════════════

const showAvatarPicker = ref(false)
const avTab = ref('upload')
const fileInput = ref(null)
const recentImages = ref([])
const recentLoading = ref(false)
const recentImgErr = ref(new Set())

// 裁剪状态
const cropImage = ref(null)
const cropCanvas = ref(null)
const previewCanvas = ref(null)
const cropSaving = ref(false)

function openAvatarPicker() {
  avTab.value = 'upload'
  recentImages.value = []
  cropImage.value = null
  showAvatarPicker.value = true
}

function closeAvatarPicker() {
  showAvatarPicker.value = false
}

async function switchToRecent() {
  avTab.value = 'recent'
  if (recentImages.value.length > 0) return
  recentLoading.value = true
  recentImgErr.value = new Set()
  try {
    const d = await chat.getRecentChatImages()
    recentImages.value = d.images || []
  } catch {} finally { recentLoading.value = false }
}

function proxyUrl(url) {
  // Vite dev 模式下 /images/xxx 已经代理到 backend，直接用
  return url
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

const CROP_CANVAS = 400              // 画布尺寸（像素）
const CROP_CX = CROP_CANVAS / 2      // 裁剪圆心 X
const CROP_CY = CROP_CANVAS / 2      // 裁剪圆心 Y
const CROP_R = 160                   // 裁剪圆半径

const cropVars = reactive({
  imgScale: 1,         // 当前缩放（画布像素/原图像素）
  imgX: 0,             // 原图左上角在画布上的 X 坐标
  imgY: 0,             // 原图左上角在画布上的 Y 坐标
})

let cropDragging = false
let cropDragStart = { x: 0, y: 0, imgX: 0, imgY: 0 }
let cropPinchDist = 0
let cropPinchScale = 1

function startCrop(img) {
  showAvatarPicker.value = false
  cropImage.value = img

  // 初始缩放：让原图的短边刚好填满裁剪圆（圆直径 320px）
  const minDim = Math.min(img.naturalWidth, img.naturalHeight)
  const initScale = (CROP_R * 2) / minDim  // 确保短边 ≥ 圆直径

  cropVars.imgScale = initScale
  // 居中：让原图中心对齐画布中心
  cropVars.imgX = CROP_CX - (img.naturalWidth * initScale) / 2
  cropVars.imgY = CROP_CY - (img.naturalHeight * initScale) / 2

  cropDragging = false
  nextTick(() => drawCrop())
}

// ── 绘制 ──
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

  // 背景（棋盘格，便于看透明区域）
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(0, 0, CROP_CANVAS, CROP_CANVAS)

  // 图片
  ctx.save()
  ctx.drawImage(img, 0, 0, sw, sh, dx, dy, dw, dh)

  // 半透明暗色遮罩（圆形之外）
  ctx.beginPath()
  ctx.rect(0, 0, CROP_CANVAS, CROP_CANVAS)
  ctx.arc(CROP_CX, CROP_CY, CROP_R, 0, Math.PI * 2, true)
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fill()

  // 白色圆框
  ctx.beginPath()
  ctx.arc(CROP_CX, CROP_CY, CROP_R, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()

  // 预览（80px 圆形）
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
    // 从原图直接绘制（保持清晰度）
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
  const mx = e.clientX - rect.left   // 鼠标在画布上的 X
  const my = e.clientY - rect.top
  const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
  zoomAt(mx, my, factor)
}

function zoomAt(mx, my, factor) {
  const oldS = cropVars.imgScale
  const newS = Math.max(0.1, Math.min(5, oldS * factor))
  // 以 (mx, my) 为锚点：缩放后该点对应的原图坐标不变
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
    // 以两指中心为锚点
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
    // 圆形区域在画布上的范围 → 映射回原图坐标
    const srcX = (CROP_CX - CROP_R - cropVars.imgX) / s
    const srcY = (CROP_CY - CROP_R - cropVars.imgY) / s
    const srcLen = (CROP_R * 2) / s   // 原图上需要截取的正方形边长
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
    await chat.uploadAvatar(base64)
    cropImage.value = null
  } catch (err) {
    console.error('[chat] save avatar failed:', err)
  } finally { cropSaving.value = false }
}

const messageGroups = computed(() => {
  const groups = []
  for (const msg of chat.messages) {
    const lastGroup = groups[groups.length - 1]
    if (lastGroup) {
      const lastMsg = lastGroup.msgs[lastGroup.msgs.length - 1]
      const diff = Math.abs(new Date(msg.created_at) - new Date(lastMsg.created_at))
      if (diff <= 10 * 60 * 1000) {
        lastGroup.msgs.push(msg)
        continue
      }
    }
    const t = timeLabel(msg.created_at)
    groups.push({ label: t, msgs: [msg] })
  }
  return groups
})

function timeLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso); const now = new Date(); const diff = now - d
  const hh = d.getHours().toString().padStart(2,'0'); const mm = d.getMinutes().toString().padStart(2,'0')
  const time = hh + ':' + mm
  if (d.toDateString() === now.toDateString()) return time
  const y = new Date(now); y.setDate(y.getDate()-1)
  if (d.toDateString() === y.toDateString()) return '昨天 ' + time
  y.setDate(y.getDate()-1)
  if (d.toDateString() === y.toDateString()) return '前天 ' + time
  if (Math.floor(diff/86400000) < 7 && d.getDay() !== now.getDay()) {
    return ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()] + ' ' + time
  }
  return d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate()+' '+time
}

// ══════════════════════════════════════════════════
// 滚动引擎
// ══════════════════════════════════════════════════
//
// 两个独立机制协同：
//   forceScrollDown = 明确事件触发，16 帧 rAF 持续滚底（初始 / 切角色 / 发消息）
//   ResizeObserver   = 全天候监听，4px 阈值过滤抖动
//
// 用户上翻 → userScrolledUp=true → Observer 暂停跟滚，直到用户滚回底部

let userScrolledUp = false
let resizeObs = null
let _scrollGen = 0
let _lastObsHeight = 0

function isNearBottom() {
  const el = msgList.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120
}

// ── 持续滚底（最大 16 帧 rAF，连续 4 帧高度不变就提前停）──
function forceScrollDown() {
  userScrolledUp = false
  _scrollGen++
  const gen = _scrollGen
  let lastH = 0, stableFrames = 0
  function tick(count) {
    if (gen !== _scrollGen) return
    const el = msgList.value
    if (!el) return
    el.scrollTop = el.scrollHeight
    // 提前终止：scrollHeight 连续 4 帧不变说明 DOM 已稳定
    if (el.scrollHeight === lastH) {
      stableFrames++
    } else {
      lastH = el.scrollHeight; stableFrames = 0
    }
    if (stableFrames < 4 && count < 16) {
      requestAnimationFrame(() => tick(count + 1))
    }
  }
  tick(0)
}

// ── scroll 事件：加载更多 + 追踪用户意图 ──
function onScroll() {
  const el = msgList.value
  if (!el || chat.loadingOlder) return
  if (el.scrollTop < 80) loadMore()
  userScrolledUp = !isNearBottom()
}

async function loadMore() {
  if (!chat.hasMoreOlder || chat.loadingOlder) return
  const el = msgList.value
  const prevHeight = el?.scrollHeight || 0
  await chat.loadOlderMessages()
  await nextTick()
  if (el) el.scrollTop = el.scrollHeight - prevHeight
}

// ── ResizeObserver：全天候，4px 阈值防抖 ──
function startAutoScroll() {
  const target = msgInner.value
  if (!target) return
  _lastObsHeight = target.offsetHeight
  resizeObs = new ResizeObserver((entries) => {
    if (userScrolledUp || chat.loadingOlder) return
    const h = entries[0]?.contentRect?.height || 0
    if (Math.abs(h - _lastObsHeight) < 4) return  // <4px = 子像素抖动
    _lastObsHeight = h
    const el = msgList.value
    if (el) el.scrollTop = el.scrollHeight
  })
  resizeObs.observe(target)
}

function stopAutoScroll() {
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null }
}

// ── 生命周期 ──
onMounted(async () => {
  await chat.loadCharacters()
  if (route.params.id) await chat.selectChar(parseInt(route.params.id))
  else if (chat.characters.length > 0) await chat.selectChar(chat.characters[0].id)
  await nextTick()
  forceScrollDown()
  startAutoScroll()
  inputEl.value?.focus()
})

onUnmounted(() => stopAutoScroll())

// 切角色
watch(() => chat.activeCharId, async (id, oldId) => {
  if (id && id !== oldId) {
    await nextTick()
    forceScrollDown()
    stopAutoScroll()
    await nextTick()
    startAutoScroll()
  }
})

// 新消息追加
watch(() => chat.messages.length, async (newLen, oldLen) => {
  await nextTick()
  if (oldLen > 0 && newLen > oldLen && !chat.loadingOlder) forceScrollDown()
})

async function send() {
  const text = inputText.value.trim()
  if (!text || chat.streaming) return
  inputText.value = ''
  await chat.sendMessage(text)
}

function renderContent(text) {
  if (!text) return ''
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br>')
}
</script>

<style scoped>
.chat-view { flex:1; display:flex; flex-direction:column; height:100vh; overflow:hidden; background:var(--bg-primary); }
.empty-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; }
.empty-icon { font-size:56px; }
.empty-state h2 { font-size:18px; color:var(--text-secondary); font-weight:400; }

.chat-header { padding:16px 24px; border-bottom:1px solid var(--border); background:var(--bg-secondary); display:flex; align-items:center; justify-content:space-between; }
.chat-title { font-size:16px; font-weight:600; color:var(--text-bright); }
.btn-header-settings { width:32px; height:32px; border-radius:8px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-secondary); font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition: color 0.15s, border-color 0.15s; }
.btn-header-settings:hover { color:var(--text-bright); border-color:var(--accent); }

.message-list { flex:1; overflow-y:auto; padding:16px 24px; }

.msg-inner { display:flex; flex-direction:column; gap:2px; }

.load-older { text-align:center; padding:8px 0; font-size:12px; color:var(--text-secondary); user-select:none; }
.load-older-hint { opacity:0.6; }

.time-divider { text-align:center; padding:16px 0 8px; font-size:12px; color:var(--text-secondary); user-select:none; }

.message { display:flex; margin:3px 0; }
.message.user { justify-content:flex-end; }
.message.assistant { justify-content:flex-start; }

.msg-bubble {
  max-width:75%; padding:10px 14px; border-radius:8px;
  font-size:14px; line-height:1.6; word-break:break-word;
}
.message.user .msg-bubble { background:#2b5278; color:#e8e8e8; }
.message.assistant .msg-bubble { background:var(--bg-secondary); color:var(--text-primary); border:1px solid var(--border); }
.msg-text { font-size:14px; line-height:1.6; }
.msg-text :deep(code) { background:rgba(0,0,0,0.2); padding:2px 6px; border-radius:4px; font-size:13px; }
.msg-text :deep(strong) { font-weight:600; }

.input-area { padding:12px 24px; border-top:1px solid var(--border); display:flex; gap:10px; align-items:flex-end; background:var(--bg-secondary); }
.chat-input { flex:1; min-height:40px; max-height:120px; padding:10px 14px; font-size:14px; background:var(--bg-primary); border:1px solid var(--border); border-radius:8px; color:var(--text-bright); outline:none; resize:none; }
.chat-input:focus { border-color:var(--accent); }
.send-btn { padding:10px 20px; height:40px; flex-shrink:0; }

.img-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; z-index:1000; cursor:zoom-out; }
.img-full { max-width:90vw; max-height:90vh; border-radius:8px; cursor:default; }
.img-close { position:absolute; top:16px; right:16px; width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,0.1); color:#fff; font-size:22px; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.img-close:hover { background:rgba(255,255,255,0.25); }

/* 角色设置面板 */
.settings-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:flex-start; justify-content:flex-end; z-index:1000; padding:60px 24px 0 0; }
.settings-panel { width:280px; background:var(--bg-secondary); border-radius:12px; border:1px solid var(--border); overflow:hidden; }
.sph { padding:14px 16px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
.sph span { font-size:14px; font-weight:600; color:var(--text-bright); }
.settings-close { width:28px; height:28px; border-radius:6px; border:none; background:transparent; color:var(--text-secondary); font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.settings-close:hover { color:var(--text-bright); background:var(--bg-hover); }

.sp-section { padding:14px 16px; }
.sp-label { font-size:12px; color:var(--text-secondary); display:block; margin-bottom:10px; }
.avatar-row { display:flex; align-items:center; gap:14px; }
.avatar-preview { width:48px; height:48px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-size:20px; font-weight:700; flex-shrink:0; }
.color-presets { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.color-dot { width:22px; height:22px; border-radius:50%; border:2px solid transparent; cursor:pointer; padding:0; transition: border-color 0.15s, transform 0.15s; }
.color-dot:hover { transform:scale(1.15); }
.color-dot.active { border-color:var(--text-bright); transform:scale(1.15); }
.color-native { width:22px; height:22px; border:none; border-radius:50%; cursor:pointer; padding:0; background:transparent; }
.color-native::-webkit-color-swatch-wrapper { padding:0; }
.color-native::-webkit-color-swatch { border-radius:50%; border:none; }

.sp-divider { height:1px; background:var(--border); margin:0 16px; }
.sp-btn { display:block; width:100%; text-align:left; padding:12px 16px; border:none; border-radius:0; background:transparent; color:var(--text-primary); font-size:13px; cursor:pointer; transition:background 0.1s; }
.sp-btn:hover { background:var(--bg-hover); }
.sp-btn:disabled { opacity:0.4; cursor:not-allowed; }
.sp-btn-danger { color:#d9534f; }
.sp-btn-danger:hover:not(:disabled) { background:rgba(217,83,79,0.08); }

/* 角色人格编辑弹窗 */
.editor-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:1001; }
.editor-panel { width:640px; max-height:85vh; background:var(--bg-secondary); border-radius:12px; border:1px solid var(--border); display:flex; flex-direction:column; overflow:hidden; }
.editor-header { padding:16px 20px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
.editor-header span { font-size:15px; font-weight:600; color:var(--text-bright); }
.editor-close { width:32px; height:32px; border-radius:8px; border:none; background:transparent; color:var(--text-secondary); font-size:20px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.editor-close:hover { color:var(--text-bright); background:var(--bg-hover); }
.editor-field { padding:12px 20px 0; display:flex; flex-direction:column; gap:6px; }
.editor-field label { font-size:13px; color:var(--text-secondary); }
.editor-input { padding:8px 12px; font-size:14px; background:var(--bg-primary); border:1px solid var(--border); border-radius:6px; color:var(--text-bright); outline:none; }
.editor-input:focus { border-color:var(--accent); }
.editor-textarea { padding:10px 12px; font-size:13px; line-height:1.6; background:var(--bg-primary); border:1px solid var(--border); border-radius:6px; color:var(--text-bright); outline:none; resize:vertical; font-family:inherit; }
.editor-textarea:focus { border-color:var(--accent); }
.editor-actions { padding:16px 20px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; align-items:center; }
.editor-actions-right { display:flex; gap:10px; }
.btn-cancel { padding:8px 18px; border-radius:6px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary); font-size:13px; cursor:pointer; }
.btn-cancel:hover { background:var(--bg-hover); }
.btn-danger { padding:8px 18px; border-radius:6px; border:1px solid #d9534f; background:transparent; color:#d9534f; font-size:13px; cursor:pointer; transition: background 0.15s, color 0.15s; }
.btn-danger:hover { background:#d9534f; color:#fff; }
.btn-danger:disabled { opacity:0.5; cursor:not-allowed; }

/* 头像 reset */
.avatar-preview.clickable { cursor:pointer; transition: opacity 0.15s; }
.avatar-preview.clickable:hover { opacity:0.85; }
.sp-btn-small { padding:6px 14px; font-size:12px; border-radius:6px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary); cursor:pointer; margin-right:6px; }
.sp-btn-small:hover { border-color:var(--accent); }
.sp-btn-subtle { color:var(--text-secondary); border-color:transparent; background:transparent; }
.sp-btn-subtle:hover { color:#d9534f; border-color:transparent; }

/* 头像选择器 */
.avpicker-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:1001; }
.avpicker-panel { width:520px; max-height:80vh; background:var(--bg-secondary); border-radius:12px; border:1px solid var(--border); display:flex; flex-direction:column; overflow:hidden; }
.avpicker-header { padding:14px 18px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
.avpicker-header span { font-size:15px; font-weight:600; color:var(--text-bright); }
.avpicker-close { width:28px; height:28px; border-radius:6px; border:none; background:transparent; color:var(--text-secondary); font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.avpicker-close:hover { color:var(--text-bright); background:var(--bg-hover); }

.avpicker-tabs { display:flex; border-bottom:1px solid var(--border); }
.avtab { flex:1; padding:10px 0; border:none; border-radius:0; background:transparent; color:var(--text-secondary); font-size:13px; cursor:pointer; transition:color 0.15s; border-bottom:2px solid transparent; }
.avtab:hover { color:var(--text-bright); }
.avtab.active { color:var(--accent); border-bottom-color:var(--accent); }

.avtab-body { padding:16px; overflow-y:auto; max-height:380px; }
.av-upload-zone { display:block; border:2px dashed var(--border); border-radius:10px; cursor:pointer; transition:border-color 0.15s; }
.av-upload-zone:hover { border-color:var(--accent); }
.av-upload-inner { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:48px 16px; gap:10px; }
.av-upload-icon { font-size:40px; }
.av-upload-text { font-size:14px; color:var(--text-secondary); }

.av-gallery { display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; }
.av-loading, .av-empty { font-size:13px; color:var(--text-secondary); text-align:center; padding:40px 0; grid-column:1/-1; }
.av-thumb { width:100%; aspect-ratio:1; object-fit:cover; border-radius:8px; cursor:pointer; border:2px solid transparent; transition:border-color 0.15s; }
.av-thumb:hover { border-color:var(--accent); }
.av-thumb-err { opacity:0.3; cursor:default; }

/* 裁剪编辑器 */
.crop-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.75); display:flex; align-items:center; justify-content:center; z-index:1002; }
.crop-panel { background:var(--bg-secondary); border-radius:12px; border:1px solid var(--border); overflow:hidden; }
.crop-header { padding:14px 18px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
.crop-header span { font-size:14px; font-weight:600; color:var(--text-bright); }
.crop-close { width:28px; height:28px; border-radius:6px; border:none; background:transparent; color:var(--text-secondary); font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.crop-close:hover { color:var(--text-bright); background:var(--bg-hover); }

.crop-body { display:flex; gap:20px; padding:20px; align-items:flex-start; }
.crop-canvas { display:block; border-radius:8px; cursor:grab; max-width:400px; }
.crop-canvas:active { cursor:grabbing; }
.crop-preview-container { display:flex; flex-direction:column; align-items:center; gap:8px; }
.crop-preview-label { font-size:12px; color:var(--text-secondary); }
.crop-preview { width:80px; height:80px; border-radius:50%; border:2px solid var(--border); }
.crop-zoom-info { font-size:12px; color:var(--text-secondary); }

.crop-actions { padding:14px 20px; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
</style>
