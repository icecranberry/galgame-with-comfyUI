<template>
  <div class="mailbox-view">
    <!-- ══ Top Bar ══ -->
    <div class="mailbox-topbar" :class="{ 'topbar-hidden': isMobile && !headerVisible }">
      <linshe-button variant="icon" class="topbar-btn" @click="onBack">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </linshe-button>
      <span class="topbar-title">信箱</span>
      <linshe-button variant="icon" class="topbar-btn" @click="startWrite">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
      </linshe-button>
    </div>

    <!-- ══ Sliding Panels ══ -->
    <div class="panels-track" :style="{ transform: `translateX(${panelOffset})` }">
      <!-- ── Panel 0: 信件列表 ── -->
      <div ref="panelListRef" class="panel panel-list" @scroll="onPanelScroll">
        <div v-if="store.loading && store.letters.length === 0" class="state-loading">
          <span class="spinner"></span>
          <p>加载中...</p>
        </div>

        <div v-else-if="store.letters.length === 0" class="state-empty">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#8a7a6a" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.12">
            <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>
          </svg>
          <p class="empty-title">还没有任何通信</p>
          <p class="empty-hint">写下第一封信吧</p>
          <linshe-button variant="primary" class="btn-compose-empty" @click="startWrite">开始写信</linshe-button>
        </div>

        <div v-else class="letter-list">
          <div
            v-for="letter in store.letters"
            :key="letter.id"
            class="letter-card"
            :class="{ active: activeLetterId === letter.id, unread: letter.direction === 'char_to_user' && !letter.is_read }"
            @click="selectLetter(letter)"
          >
            <div class="card-env-col">
              <div class="card-envelope">
                <svg width="48" height="36" viewBox="0 0 48 36" fill="none">
                  <rect x="2" y="8" width="44" height="26" rx="2" fill="#f5e6d3" stroke="#c4a882" stroke-width="1.2"/>
                  <path d="M2 8 L24 22 L46 8" fill="#e8d5c0" stroke="#c4a882" stroke-width="1.2"/>
                  <line x1="2" y1="8" x2="24" y2="22" stroke="#c4a882" stroke-width="1.2"/>
                  <line x1="46" y1="8" x2="24" y2="22" stroke="#c4a882" stroke-width="1.2"/>
                </svg>
                <img v-if="letter.avatar_path" :src="letter.avatar_path" class="card-mini-avatar" alt="" />
                <span v-else class="card-mini-avatar card-mini-fallback">{{ (letter.display_name || '?')[0] }}</span>
              </div>
            </div>
            <div class="card-body">
              <div class="card-top">
                <span class="card-name">{{ letter.display_name }}</span>
              </div>
              <div class="card-preview">{{ replyPreview(letter) }}</div>
              <span class="card-status" :class="statusTimeClass(letter)">{{ statusTimeText(letter) }}</span>
            </div>
            <span v-if="letter.direction === 'char_to_user' && !letter.is_read" class="unread-dot"></span>
          </div>
        </div>
      </div>

      <!-- ── Panel 1: 信件详情 ── -->
      <div class="panel panel-detail">
        <div v-if="activeLetter" class="detail-inner">
          <!-- Header -->
          <div class="detail-header">
            <div class="detail-header-left">
              <img v-if="activeLetter.avatar_path" :src="activeLetter.avatar_path" class="detail-avatar" alt="" />
              <span v-else class="detail-avatar detail-avatar-fallback">{{ (activeLetter.display_name || '?')[0] }}</span>
              <div class="detail-header-info">
                <div class="detail-header-name">
                  {{ isReplied(activeLetter) ? activeLetter.display_name + ' 的回信' : '寄给 ' + activeLetter.display_name }}
                </div>
                <div class="detail-header-meta" :class="statusTimeClass(activeLetter)">{{ statusTimeText(activeLetter) }}</div>
              </div>
            </div>
            <linshe-button variant="danger" class="btn-delete" @click="onDeleteLetter(activeLetter.id)">删除信件</linshe-button>
          </div>

          <!-- Content -->
          <div class="detail-card">
            <!-- 未回复：用户寄出的信 -->
            <div v-if="!isReplied(activeLetter) && activeLetter.status !== 'processing'" class="detail-content detail-outgoing">
              <div class="detail-text" :style="writeFontStyle">{{ activeLetter.content }}</div>
            </div>

            <!-- 已回复：回信在上 / 用户原信在下 -->
            <div v-else-if="isReplied(activeLetter)" class="detail-content detail-replied">
              <div
                ref="replySnippetRef"
                class="detail-snippet"
                :style="activeLetter.paper_path ? { backgroundImage: `url(${activeLetter.paper_path})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
                @click="openViewer"
              >
                <div class="detail-text detail-reply" :style="activeHandwritingFontStyle">
                  {{ activeLetter.reply_content?.slice(0, 160) }}{{ activeLetter.reply_content && activeLetter.reply_content.length > 160 ? '...' : '' }}
                </div>
              </div>
              <div class="detail-divider-row">
                <div class="detail-divider"></div>
                <div class="detail-divider"></div>
              </div>
              <div class="detail-original" :style="writeFontStyle">{{ activeLetter.content }}</div>
            </div>

            <!-- 处理中 -->
            <div v-else-if="activeLetter.status === 'processing'" class="detail-waiting">
              <span class="spinner"></span>
              <p class="waiting-text">正在等待角色回信...</p>
              <p v-if="activeLetter.reply_at" class="waiting-estimate">预计 {{ estimateReply(activeLetter) }}</p>
            </div>

            <!-- 配图：放在信纸下方 -->
            <div v-if="isReplied(activeLetter) && (activeLetter.portrait_path || activeLetter.illustration_path)" class="detail-images">
              <img v-if="activeLetter.portrait_path" :src="activeLetter.portrait_path" class="detail-img detail-img-portrait" alt="" @click="openDetailImage('portrait')" />
              <img v-if="activeLetter.illustration_path" :src="activeLetter.illustration_path" class="detail-img detail-img-illustration" alt="" @click="openDetailImage('illustration')" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Character Picker ══ -->
    <Transition name="popup-fade">
      <div v-if="showCharPicker" class="picker-overlay" @click.self="showCharPicker = false">
        <div class="picker-dialog">
          <div class="picker-header">
            <span>选择收信人</span>
            <linshe-button variant="icon" class="picker-close" @click="showCharPicker = false">&times;</linshe-button>
          </div>
          <div class="picker-grid">
            <div
              v-for="char in chatStore.characters"
              :key="char.id"
              class="picker-char"
              @click="pickCharacter(char)"
            >
              <img v-if="char.avatar_path" :src="char.avatar_path" class="picker-avatar" />
              <span v-else class="picker-avatar picker-avatar-fallback">{{ (char.display_name || char.name || '?')[0] }}</span>
              <span class="picker-name">{{ char.display_name || char.name }}</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ══ Compose Panel (Teleported to body for mobile reliability) ══ -->
    <Teleport to="body">
      <Transition name="compose-slide">
        <div v-if="writing && selectedChar" class="compose-panel" :style="composePanelStyle">
          <div class="compose-header">
            <linshe-button variant="ghost" class="compose-back" @click="cancelWrite">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              返回
            </linshe-button>
            <span class="compose-title">致 {{ selectedChar.display_name || selectedChar.name }}</span>
            <div class="compose-spacer"></div>
          </div>
          <div class="compose-body">
            <div class="paper-frame">
              <div class="paper-bg" :style="{ backgroundImage: `url(/letter-paper.avif)` }"></div>
              <div class="paper-content">
                <textarea
                  ref="composeTextareaRef"
                  v-model="composeContent"
                  class="paper-textarea"
                  placeholder="写下想对TA说的话..."
                  :style="{ fontFamily: WRITE_FONT }"
                  @focus="onComposeFocus"
                  @blur="onComposeBlur"
                ></textarea>
              </div>
            </div>
          </div>
          <div class="compose-actions">
            <linshe-button variant="secondary" @click="cancelWrite">取消</linshe-button>
            <linshe-button variant="primary" :disabled="!composeContent.trim() || sending" :loading="sending" @click="doSend">
              {{ sending ? '寄送中...' : '寄出' }}
            </linshe-button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ══ Letter Viewer (full-screen) ══ -->
    <LetterViewer
      v-if="viewingLetter"
      :letter="viewingLetter"
      :source-rect="viewerSourceRect"
      :compact="true"
      @close="onViewerClosed"
      @delete="onDeleteLetter"
    />

    <!-- ══ Image Lightbox ══ -->
    <ImageLightbox
      :visible="!!detailLightboxImgs.length"
      :imgs="detailLightboxImgs"
      :index="detailLightboxIndex"
      @hide="detailLightboxImgs = []"
    />

    <!-- ══ Confirm Dialog ══ -->
    <ConfirmDialog ref="confirmRef" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, inject, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import { useMailboxStore } from '../stores/mailbox.js'
import { getFontFamily, loadFont, getPageDefaultFontFamily, getWriteFontFamily } from '../composables/useHandwritingFont.js'
import LetterViewer from '../components/LetterViewer.vue'
import ImageLightbox from '../components/ImageLightbox.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import LinsheButton from '../components/ui/LinsheButton.vue'

const router = useRouter()
const chatStore = useChatStore()
const store = useMailboxStore()
const isMobile = inject('isMobile')
const WRITE_FONT = getWriteFontFamily()

// ── Header scroll hide ──
const panelListRef = ref(null)
const headerVisible = ref(true)
let lastScrollY = 0
function onPanelScroll(e) {
  if (!isMobile) return
  const top = e.target.scrollTop
  if (top > 40 && top - lastScrollY > 8) headerVisible.value = false
  else if (top - lastScrollY < -4) headerVisible.value = true
  lastScrollY = top
}

// ── Panel sliding ──
const panelIndex = ref(0)
const panelOffset = computed(() => panelIndex.value === 1 ? '-50%' : '0%')

// ── Letter selection ──
const activeLetter = ref(null)
const activeLetterId = ref(null)

function selectLetter(letter) {
  activeLetter.value = letter
  activeLetterId.value = letter.id
  panelIndex.value = 1
  if (letter.handwriting_font) loadFont(letter.handwriting_font)
  if (letter.direction === 'char_to_user' && !letter.is_read) store.markRead(letter.id)
}

const activeHandwritingFontStyle = computed(() => {
  const fontId = activeLetter.value?.handwriting_font
  if (!fontId) return { fontFamily: getPageDefaultFontFamily() }
  return { fontFamily: getFontFamily(fontId) }
})
const writeFontStyle = computed(() => ({ fontFamily: getWriteFontFamily() }))

// ── Character picker + compose ──
const showCharPicker = ref(false)
const selectedChar = ref(null)
const writing = ref(false)
const composeContent = ref('')
const sending = ref(false)
const composeTextareaRef = ref(null)
const keyboardHeight = ref(0)
const composePanelStyle = computed(() => {
  if (keyboardHeight.value > 0) {
    return { bottom: keyboardHeight.value + 'px' }
  }
  return {}
})
let _visualViewportHandler = null

function onComposeFocus() {
  if (!isMobile) return
  if (window.visualViewport) {
    _visualViewportHandler = () => {
      const vh = window.innerHeight - window.visualViewport.height
      if (vh > 0) {
        keyboardHeight.value = vh
        // Scroll textarea into view above keyboard
        setTimeout(() => {
          composeTextareaRef.value?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }, 100)
      }
    }
    window.visualViewport.addEventListener('resize', _visualViewportHandler)
    window.visualViewport.addEventListener('scroll', _visualViewportHandler)
  }
}

function onComposeBlur() {
  keyboardHeight.value = 0
  if (_visualViewportHandler && window.visualViewport) {
    window.visualViewport.removeEventListener('resize', _visualViewportHandler)
    window.visualViewport.removeEventListener('scroll', _visualViewportHandler)
    _visualViewportHandler = null
  }
}

function startWrite() {
  showCharPicker.value = true
}

function pickCharacter(char) {
  selectedChar.value = char
  showCharPicker.value = false
  writing.value = true
  composeContent.value = ''
  nextTick(() => composeTextareaRef.value?.focus())
}

function cancelWrite() {
  onComposeBlur()
  writing.value = false
  selectedChar.value = null
  composeContent.value = ''
}

async function doSend() {
  const text = composeContent.value.trim()
  if (!text || sending.value) return
  sending.value = true
  try {
    await store.sendLetter(selectedChar.value.id, '', text)
    writing.value = false
    selectedChar.value = null
    composeContent.value = ''
    await store.fetchLetters()
  } catch (err) {
    console.error('[MailboxView] send error:', err)
  } finally {
    sending.value = false
  }
}

// ── Letter Viewer (full-screen) ──
const viewingLetterId = ref(null)
const replySnippetRef = ref(null)
const viewerSourceRect = ref(null)

const viewingLetter = computed(() => {
  if (!viewingLetterId.value) return null
  return store.letters.find(l => l.id === viewingLetterId.value) || null
})

function openViewer() {
  viewerSourceRect.value = replySnippetRef.value ? replySnippetRef.value.getBoundingClientRect() : null
  viewingLetterId.value = activeLetter.value.id
}

function onViewerClosed() {
  viewingLetterId.value = null
  viewerSourceRect.value = null
}

// ── Detail image lightbox ──
const detailLightboxImgs = ref([])
const detailLightboxIndex = ref(0)

function openDetailImage(type) {
  if (!activeLetter.value) return
  const portrait = activeLetter.value.portrait_path
  const illustration = activeLetter.value.illustration_path
  const imgs = []
  if (portrait) imgs.push(portrait)
  if (illustration) imgs.push(illustration)
  const target = type === 'portrait' ? portrait : illustration
  detailLightboxIndex.value = imgs.indexOf(target)
  detailLightboxImgs.value = imgs
}

// ── Delete ──
const confirmRef = ref(null)

async function onDeleteLetter(id) {
  const confirmed = await confirmRef.value.show({
    title: '删除信件',
    message: '确定要删除这封信件吗？此操作无法撤销。',
    okText: '删除',
    cancelText: '取消',
    danger: true,
  })
  if (!confirmed) return
  viewingLetterId.value = null
  viewerSourceRect.value = null
  await store.deleteLetter(id)
  activeLetter.value = null
  activeLetterId.value = null
  panelIndex.value = 0
}

// ── Navigation ──
function onBack() {
  if (panelIndex.value === 1) {
    panelIndex.value = 0
    activeLetter.value = null
    activeLetterId.value = null
  } else {
    router.back()
  }
}

// ── Helpers ──
function isReplied(letter) {
  return !!(letter.reply_content && letter.status === 'completed')
}

function replyPreview(letter) {
  const text = letter.reply_content || letter.content || ''
  return text.slice(0, 40) + (text.length > 40 ? '...' : '')
}

function statusTimeText(letter) {
  const time = timeAgo(letter.created_at)
  if (letter.status === 'processing') return '回信中'
  if (letter.status === 'completed') return `已回信 · ${time}`
  if (letter.status === 'failed') return '回信失败'
  if (letter.direction === 'user_to_char') {
    if (letter.reply_at && elapsedOverHalf(letter)) return '回信中'
    return '等待回信'
  }
  return time
}

function statusTimeClass(letter) {
  if (letter.status === 'completed') return 'status-completed'
  if (letter.status === 'processing') return 'status-processing'
  if (letter.direction === 'user_to_char') {
    if (letter.reply_at && elapsedOverHalf(letter)) return 'status-processing'
    return 'status-pending'
  }
  return ''
}

function elapsedOverHalf(letter) {
  const created = new Date(letter.created_at).getTime()
  const replyAt = new Date(letter.reply_at).getTime()
  const elapsed = Date.now() - created
  return elapsed > 0 && (replyAt - created) > 0 && elapsed > (replyAt - created) * 0.5
}

function timeAgo(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (d >= today) return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  const yesterday = new Date(today.getTime() - 86400000)
  if (d >= yesterday) return '昨天'
  return (d.getMonth() + 1) + '/' + d.getDate()
}

function estimateReply(letter) {
  if (!letter.reply_at) return ''
  const ms = new Date(letter.reply_at).getTime() - Date.now()
  if (ms <= 0) return '随时'
  const min = Math.ceil(ms / 60000)
  return min < 60 ? `${min}分钟后` : `${Math.floor(min / 60)}小时后`
}

// ── Lifecycle ──
onMounted(() => {
  store.startPolling()
  if (store.letters.length === 0) store.fetchLetters()
})

onUnmounted(() => {
  store.stopPolling()
  if (_visualViewportHandler && window.visualViewport) {
    window.visualViewport.removeEventListener('resize', _visualViewportHandler)
    window.visualViewport.removeEventListener('scroll', _visualViewportHandler)
    _visualViewportHandler = null
  }
})
</script>

<style scoped>
/* ═══════════════════════════════════════
   View Container
   ═══════════════════════════════════════ */
.mailbox-view {
  height: 100vh; height: 100dvh;
  flex: 1;
  display: flex; flex-direction: column;
  overflow: hidden;
  background: #FCFAF7;
  position: relative;
}

/* ═══════════════════════════════════════
   Top Bar
   ═══════════════════════════════════════ */
.mailbox-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 8px 12px 4px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0,0,0,0.04);
  background: #FCFAF7;
  z-index: 10;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s;
  will-change: transform, opacity;
}
.mailbox-topbar.topbar-hidden {
  transform: translateY(-100%);
  opacity: 0;
  pointer-events: none;
}

.topbar-btn {
  width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

.topbar-title {
  font-size: 17px; font-weight: 600; color: #2a1a10;
  letter-spacing: 0.02em;
}

/* ═══════════════════════════════════════
   Panels Track
   ═══════════════════════════════════════ */
.panels-track {
  flex: 1;
  display: flex;
  width: 200%;
  transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  will-change: transform;
}

.panel {
  width: 50%;
  flex-shrink: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.panel::-webkit-scrollbar { display: none; }
.panel { scrollbar-width: none; -ms-overflow-style: none; }

/* ═══════════════════════════════════════
   Panel 0: Letter List (matching desktop)
   ═══════════════════════════════════════ */
.panel-list {
  background: #FAF7F4;
}

.state-loading, .state-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 24px; text-align: center; gap: 10px;
}
.state-loading { color: #8a7a6a; font-size: 13px; }
.spinner {
  width: 22px; height: 22px; border: 2px solid rgba(0,0,0,0.06);
  border-top-color: #8a7a6a; border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.empty-title { font-size: 14px; font-weight: 600; color: #5a4a3a; margin: 0; }
.empty-hint { font-size: 12px; color: #9a8a7a; margin: 0 0 6px; }
.btn-compose-empty {
  margin-top: 6px;
}

.letter-list {
  display: flex; flex-direction: column;
  padding: 8px 10px;
}

/* ── Letter Card ── */
.letter-card {
  position: relative;
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 12px; border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.letter-card:hover { background: rgba(0,0,0,0.02); }
.letter-card:active { background: rgba(0,0,0,0.04); }
.letter-card.active {
  background: #FFF8F4;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
.letter-card.unread .card-name { font-weight: 700; color: #1a0a00; }

.unread-dot {
  position: absolute; top: 10px; right: 10px;
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--danger, #e07b6c);
}

.card-env-col { flex-shrink: 0; padding-top: 1px; }
.card-envelope { position: relative; width: 48px; height: 36px; }
.card-mini-avatar {
  position: absolute; bottom: -2px; left: -2px;
  width: 22px; height: 22px; border-radius: 16px;
  object-fit: cover;
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
}
.card-mini-fallback {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #d4a08c, #c48a78);
  color: #fff; font-size: 10px; font-weight: 700;
}

.card-body { flex: 1; min-width: 0; }
.card-top { margin-bottom: 3px; }
.card-name {
  font-size: 14px; font-weight: 500; color: #3a2a1a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.card-preview {
  font-size: 12px; color: #9a8a7a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.card-status {
  font-size: 12px; display: inline-block; padding: 1px 6px;
  border-radius: 4px; margin-top: 3px; line-height: 1.5;
}
.card-status.status-completed { color: #7FA88A; background: rgba(127,168,138,0.07); }
.card-status.status-pending   { color: #B89A68; background: rgba(184,154,104,0.07); }
.card-status.status-processing { color: #7D98B8; background: rgba(125,152,184,0.07); }

/* ═══════════════════════════════════════
   Panel 1: Letter Detail (matching desktop)
   ═══════════════════════════════════════ */
.panel-detail { display: flex; flex-direction: column; }
.detail-inner {
  height: 100%; display: flex; flex-direction: column;
  padding: 32px 28px;
  overflow-y: auto;
}
.detail-inner::-webkit-scrollbar { display: none; }
.detail-inner { scrollbar-width: none; }

/* Header */
.detail-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  margin-bottom: 28px; flex-shrink: 0;
}
.detail-header-left { display: flex; align-items: center; gap: 14px; }
.detail-avatar {
  width: 44px; height: 44px; border-radius: 12px; object-fit: cover; flex-shrink: 0;
}
.detail-avatar-fallback {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #d4a08c, #c48a78);
  color: #fff; font-size: 18px; font-weight: 700; flex-shrink: 0;
}
.detail-header-info { flex: 1; min-width: 0; }
.detail-header-name { font-size: 15px; font-weight: 600; color: #2a1a10; margin-bottom: 3px; }
.detail-header-meta { font-size: 12px; color: #aaa; }
.detail-header-meta.status-completed { color: #7FA88A; }
.detail-header-meta.status-pending   { color: #B89A68; }
.detail-header-meta.status-processing { color: #7D98B8; }

.btn-delete {
  white-space: nowrap; flex-shrink: 0;
}

/* Content card */
.detail-card {
  flex: 1; display: flex; flex-direction: column; align-items: center;
}
.detail-content {
  width: 100%;
  background: #FEFCF8; border-radius: 10px;
  padding: 36px 28px 28px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.03);
}

.detail-outgoing {
  background: #f5efe0 url(/letter-paper.avif) top center / cover no-repeat;
  flex: 1; min-height: 300px;
}

.detail-replied {
  flex-shrink: 0;
}

.detail-text {
  font-size: 17px; line-height: 1.9; color: #3a2a1a;
  white-space: pre-wrap; word-break: break-word;
}

.detail-snippet {
  flex-shrink: 0; border-radius: 12px; cursor: pointer;
  padding: 20px 40px; display: flex; justify-content: center;
}
.detail-snippet:active { opacity: 0.9; }

.detail-reply {
  text-align: center;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 16px; color: #5a4a3a;
  max-width: 260px; cursor: pointer;
  border-radius: 8px; padding: 0;
}

.detail-divider-row {
  display: flex; align-items: center; gap: 12px;
  margin: 28px 0 20px;
}
.detail-divider {
  flex: 1; height: 1px; background: rgba(0,0,0,0.06);
}

.detail-original {
  color: rgba(58,42,26,0.5); font-size: 15px; line-height: 1.8;
  white-space: pre-wrap; word-break: break-word;
  min-height: 80px; padding-top: 4px;
}

/* 配图：信纸下方 */
.detail-images {
  width: 100%; display: flex; gap: 12px; justify-content: center;
  padding: 20px 0 8px; flex-shrink: 0;
}
.detail-img {
  border-radius: 10px; object-fit: cover;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}
.detail-img-portrait {
  width: clamp(120px, 38vw, 180px); aspect-ratio: 3/4;
}
.detail-img-illustration {
  width: clamp(140px, 42vw, 220px); aspect-ratio: 4/3;
}

.detail-waiting {
  width: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 60px 0; color: #8a7a6a;
}
.waiting-text { font-size: 14px; color: #6a5a4a; margin: 0; }
.waiting-estimate { font-size: 12px; color: #aaa; margin: 0; }

/* ═══════════════════════════════════════
   Character Picker
   ═══════════════════════════════════════ */
.picker-overlay {
  position: absolute; inset: 0;
  background: rgba(252,250,247,0.96);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 20; border-radius: inherit;
}
.picker-dialog {
  width: 90%; max-width: 400px; max-height: 70%;
  overflow-y: auto; background: #fff; border-radius: 16px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.08); padding: 20px;
}
.picker-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 16px; font-size: 15px; font-weight: 600; color: #2a1a10;
}
.picker-close {
  width: 30px; height: 30px;
  font-size: 16px;
}
.picker-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 10px;
}
.picker-char {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 10px 6px; border-radius: 12px; cursor: pointer; transition: background 0.15s;
}
.picker-char:hover { background: rgba(0,0,0,0.03); }
.picker-avatar {
  width: 52px; height: 52px; border-radius: 14px; object-fit: cover;
}
.picker-avatar-fallback {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #d4a08c, #c48a78);
  color: #fff; font-size: 20px; font-weight: 700;
}
.picker-name { font-size: 12px; color: #3a2a1a; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }

/* ═══════════════════════════════════════
   Compose Panel
   ═══════════════════════════════════════ */
.compose-panel {
  position: fixed; inset: 0; z-index: 10002;
  background: #FCFAF7; display: flex; flex-direction: column;
  transition: bottom 0.15s ease;
}
.compose-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 12px; border-bottom: 1px solid rgba(0,0,0,0.04);
  flex-shrink: 0;
  background: #FCFAF7;
}
.compose-back {
  gap: 2px;
  padding: 8px 10px;
  font-size: 14px;
}
.compose-title { font-size: 15px; font-weight: 600; color: #2a1a10; }
.compose-spacer { width: 60px; }

.compose-body {
  flex: 1; display: flex; flex-direction: column;
  padding: 12px; overflow-y: auto;
  min-height: 0;
}
.compose-body::-webkit-scrollbar { display: none; }
.compose-body { scrollbar-width: none; }

.paper-frame {
  flex: 1; position: relative; border-radius: 14px; overflow: hidden;
  border: 1px solid rgba(180,160,140,0.2);
  box-shadow: 0 2px 16px rgba(0,0,0,0.04);
  min-height: 240px;
}
.paper-bg {
  position: absolute; inset: 0;
  background-size: cover; background-position: center;
}
.paper-content {
  position: relative; z-index: 1;
  height: 100%; display: flex; flex-direction: column;
  padding: 14px 16px;
}
.paper-textarea {
  flex: 1; width: 100%; resize: none;
  background: rgba(255,255,255,0.55); border: none; border-radius: 8px;
  padding: 14px 16px; font-size: 17px; line-height: 1.9; color: #3a2a1a;
  -webkit-appearance: none;
}
.paper-textarea:focus { outline: none; background: rgba(255,255,255,0.75); }
.paper-textarea::placeholder { color: #baaa9a; }

.compose-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 10px 12px; flex-shrink: 0;
  border-top: 1px solid rgba(0,0,0,0.04);
  background: #FCFAF7;
  padding-bottom: max(10px, env(safe-area-inset-bottom));
}

/* ═══════════════════════════════════════
   Transitions
   ═══════════════════════════════════════ */
.popup-fade-enter-active { transition: opacity 0.2s ease; }
.popup-fade-leave-active { transition: opacity 0.15s ease; }
.popup-fade-enter-from, .popup-fade-leave-to { opacity: 0; }

.compose-slide-enter-active { transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94); }
.compose-slide-leave-active { transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.compose-slide-enter-from { transform: translateX(100%); }
.compose-slide-leave-to { transform: translateX(100%); }

/* ═══════════════════════════════════════
   Desktop
   ═══════════════════════════════════════ */
@media (min-width: 768px) {
  .mailbox-view {
    max-width: 680px; margin: 0 auto;
    border-left: 1px solid rgba(0,0,0,0.04);
    border-right: 1px solid rgba(0,0,0,0.04);
  }
  .detail-inner { padding: 32px 40px; }
  .detail-text { font-size: 18px; }
  .paper-textarea { font-size: 18px; }
}

/* ═══════════════════════════════════════
   Mobile compose
   ═══════════════════════════════════════ */
@media (max-width: 767px) {
  .compose-header {
    padding: 14px 12px;
  }
  .compose-back {
    font-size: 15px; padding: 8px 12px;
  }
  .paper-frame {
    min-height: 280px;
    border-radius: 12px;
  }
  .paper-textarea {
    font-size: 18px; line-height: 2; padding: 16px;
  }
}
</style>
