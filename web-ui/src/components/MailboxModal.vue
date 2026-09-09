<template>
  <Teleport to="body">
    <Transition name="mailbox-fade">
      <div v-if="visible" class="mailbox-overlay" @click.self="close">
        <div class="mailbox-modal">
          <!-- ── Header ── -->
          <div class="mailbox-header">
            <div class="header-left">
              <svg class="header-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M22 7l-10 6L2 7"/>
              </svg>
              <div>
                <h3>信箱</h3>
                <p class="header-subtitle">来自邻舍的信件</p>
              </div>
            </div>
            <div class="header-actions">
              <linshe-button variant="primary" @click="startWrite">开始写一封信</linshe-button>
              <linshe-button variant="icon" @click="close" title="关闭">&times;</linshe-button>
            </div>
          </div>

          <!-- ── Body ── -->
          <div class="mailbox-body">
            <!-- ── Left: Letter List ── -->
            <div class="mailbox-sidebar">
              <div v-if="store.letters.length === 0 && !store.loading" class="sidebar-empty">
                <svg class="sidebar-empty-svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#8a7a6a" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="M22 7l-10 6L2 7"/>
                </svg>
                <p class="sidebar-empty-title">还没有任何通信</p>
                <p class="sidebar-empty-hint">写下第一封信吧</p>
                <linshe-button variant="primary" @click="startWrite">开始写信</linshe-button>
              </div>

              <div v-if="store.loading && store.letters.length === 0" class="loading-state">
                <span class="loading-spinner"></span>
                <p>加载中...</p>
              </div>

              <TransitionGroup name="letter-list" tag="div" class="letter-list">
                <div
                  v-for="letter in store.letters"
                  :key="letter.id"
                  class="letter-card"
                  :class="{
                    active: activeLetterId === letter.id,
                    unread: letter.direction === 'char_to_user' && !letter.is_read,
                  }"
                  @click="selectLetter(letter)"
                >
                  <div class="card-avatar-col">
                    <div class="card-envelope">
                      <svg class="card-envelope-svg" width="48" height="36" viewBox="0 0 48 36" fill="none">
                        <rect x="2" y="8" width="44" height="26" rx="2" fill="#f5e6d3" stroke="#c4a882" stroke-width="1.2"/>
                        <path d="M2 8 L24 22 L46 8" fill="#e8d5c0" stroke="#c4a882" stroke-width="1.2"/>
                        <line x1="2" y1="8" x2="24" y2="22" stroke="#c4a882" stroke-width="1.2"/>
                        <line x1="46" y1="8" x2="24" y2="22" stroke="#c4a882" stroke-width="1.2"/>
                      </svg>
                      <img
                        v-if="letter.avatar_path"
                        :src="letter.avatar_path"
                        class="card-avatar-mini"
                        alt=""
                      />
                      <span v-else class="card-avatar-mini card-avatar-mini-fallback">
                        {{ (letter.display_name || '?')[0] }}
                      </span>
                    </div>
                  </div>
                  <div class="card-body">
                    <div class="card-top-row">
                      <span class="card-name">{{ letter.display_name }}</span>
                    </div>
                    <div class="card-preview">{{ replyPreview(letter) }}</div>
                    <span class="card-status" :class="statusTimeClass(letter)">{{ statusTimeText(letter) }}</span>
                  </div>
                  <span v-if="letter.direction === 'char_to_user' && !letter.is_read" class="unread-dot"></span>
                </div>
              </TransitionGroup>
            </div>

            <!-- ── Right: Main Content ── -->
            <div class="mailbox-main">
              <Transition name="panel-fade" mode="out-in">
                <div v-if="writing && selectedChar" key="write" class="write-panel">
                  <LetterWrite
                    :char="selectedChar"
                    @sent="onLetterSent"
                    @cancel="cancelWrite"
                  />
                </div>

                <div v-else-if="activeLetter" :key="'detail-' + activeLetterId" class="detail-panel">
                  <!-- Header row -->
                  <div class="detail-header">
                    <div class="detail-header-left">
                      <img
                        v-if="activeLetter.avatar_path"
                        :src="activeLetter.avatar_path"
                        class="detail-avatar"
                        alt=""
                      />
                      <span v-else class="detail-avatar detail-avatar-fallback">{{ (activeLetter.display_name || '?')[0] }}</span>
                      <div class="detail-header-info">
                        <div class="detail-header-name">
                          {{ isReplied(activeLetter) ? activeLetter.display_name + ' 的回信' : '寄给 ' + activeLetter.display_name }}
                        </div>
                        <div class="detail-header-meta" :class="statusTimeClass(activeLetter)">{{ statusTimeText(activeLetter) }}</div>
                      </div>
                    </div>
                    <linshe-button variant="danger" @click="onDeleteLetter(activeLetter.id)">删除信件</linshe-button>
                  </div>

                  <!-- Reading card -->
                  <div class="reading-card">
                    <!-- Outgoing letter - not yet replied -->
                    <div v-if="!isReplied(activeLetter) && activeLetter.status !== 'processing'" class="reading-content reading-outgoing">
                      <div class="reading-text" :style="writeFontStyle">{{ activeLetter.content }}</div>
                    </div>

                    <!-- Replied -->
                    <div v-else-if="isReplied(activeLetter)" class="reading-content">
                      <div
                        class="reading-snippet"
                        ref="replySectionRef"
                        :style="activeLetter.paper_path ? { backgroundImage: `url(${activeLetter.paper_path})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
                        @click="openViewer"
                      >
                        <div class="reading-text reading-reply" :style="activeHandwritingFontStyle">{{ activeLetter.reply_content?.slice(0, 160) }}{{ activeLetter.reply_content && activeLetter.reply_content.length > 160 ? '...' : '' }}</div>
                      </div>
                      <div class="reading-divider-row">
                        <div class="reading-divider"></div>
                        <span class="reading-divider-label"></span>
                        <div class="reading-divider"></div>
                      </div>
                      <div class="reading-text reading-original reading-outgoing original-expanded" :style="writeFontStyle">{{ activeLetter.content }}</div>
                    </div>

                    <!-- Processing -->
                    <div v-else-if="activeLetter.status === 'processing'" class="reading-waiting">
                      <span class="waiting-spinner"></span>
                      <p class="waiting-text">正在等待角色回信...</p>
                      <p v-if="activeLetter.reply_at" class="waiting-estimate">预计 {{ estimateReply(activeLetter) }}</p>
                    </div>
                  </div>
                </div>

                <!-- Default Empty -->
                <div v-else key="empty" class="welcome-area">
                  <div class="welcome-card">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#8a7a6a" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.12">
                      <rect x="2" y="4" width="20" height="16" rx="2"/>
                      <path d="M22 7l-10 6L2 7"/>
                    </svg>
                    <p class="welcome-title">曾许下心愿♪</p>
                    <p class="welcome-hint">等待你的出现~</p>
                  </div>
                </div>
              </Transition>
            </div>
          </div>

          <!-- ── Character Picker ── -->
          <Transition name="popup-fade">
            <div v-if="showCharPicker" class="char-picker-overlay" @click.self="showCharPicker = false">
              <div class="char-picker-dialog">
                <div class="char-picker-header">
                  <span>选择收信人</span>
                  <linshe-button variant="icon" @click="showCharPicker = false">&times;</linshe-button>
                </div>
                <div class="char-grid">
                  <div
                    v-for="char in characters"
                    :key="char.id"
                    class="char-card"
                    @click="pickCharacter(char)"
                  >
                    <div class="char-card-inner">
                      <img v-if="char.avatar_path" :src="char.avatar_path" class="char-avatar" />
                      <span v-else class="char-avatar char-avatar-fallback">{{ (char.display_name || char.name || '?')[0] }}</span>
                      <span class="char-name">{{ char.display_name || char.name }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Transition>

          <!-- ── Letter Viewer Overlay ── -->
          <LetterViewer
            v-if="viewingLetter"
            :letter="viewingLetter"
            :source-rect="viewerSourceRect"
            @close="onViewerClosed"
            @delete="onDeleteLetter"
          />

          <!-- ── Confirm Dialog ── -->
          <ConfirmDialog ref="confirmRef" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { useMailboxStore } from '../stores/mailbox.js'
import { getFontFamily, loadFont, getPageDefaultFontFamily, getWriteFontFamily } from '../composables/useHandwritingFont.js'
import LetterViewer from './LetterViewer.vue'
import LetterWrite from './LetterWrite.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import LinsheButton from './ui/LinsheButton.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  characters: { type: Array, default: () => [] },
})
const emit = defineEmits(['close'])

const store = useMailboxStore()
const writing = ref(false)
const showCharPicker = ref(false)
const selectedChar = ref(null)
const activeLetterId = ref(null)
const activeLetter = ref(null)
const viewingLetterId = ref(null)
const replySectionRef = ref(null)
const viewerSourceRect = ref(null)
const confirmRef = ref(null)

const viewingLetter = computed(() => {
  if (!viewingLetterId.value) return null
  return store.letters.find(l => l.id === viewingLetterId.value) || null
})

const activeHandwritingFontStyle = computed(() => {
  const fontId = activeLetter.value?.handwriting_font
  if (!fontId) return { fontFamily: getPageDefaultFontFamily() }
  return { fontFamily: getFontFamily(fontId) }
})

const writeFontStyle = computed(() => ({
  fontFamily: getWriteFontFamily(),
}))

watch(() => props.visible, (v) => {
  if (v) {
    store.startPolling()
    if (store.letters.length === 0) store.fetchLetters()
  } else {
    store.stopPolling()
    writing.value = false
    selectedChar.value = null
    activeLetter.value = null
    activeLetterId.value = null
    viewingLetterId.value = null
    viewerSourceRect.value = null
    showCharPicker.value = false
  }
})

onMounted(() => { if (props.visible) store.startPolling() })
onUnmounted(() => { store.stopPolling() })

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

function replyPreview(letter) {
  const text = letter.reply_content || letter.content || ''
  return text.slice(0, 40) + (text.length > 40 ? '...' : '')
}

function timeAgo(ts) {
  if (!ts) return ''
  const d = new Date(ts)
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

function estimateReply(letter) {
  if (!letter.reply_at) return ''
  const ms = new Date(letter.reply_at).getTime() - Date.now()
  if (ms <= 0) return '随时'
  const min = Math.ceil(ms / 60000)
  if (min < 60) return `${min}分钟后`
  const hr = Math.floor(min / 60)
  return `${hr}小时后`
}

function close() { emit('close') }
function startWrite() { writing.value = false; selectedChar.value = null; activeLetter.value = null; activeLetterId.value = null; viewingLetterId.value = null; viewerSourceRect.value = null; showCharPicker.value = true }
function pickCharacter(char) { selectedChar.value = char; showCharPicker.value = false; writing.value = true }
function cancelWrite() { writing.value = false; selectedChar.value = null }

function selectLetter(letter) {
  activeLetter.value = letter
  activeLetterId.value = letter.id
  writing.value = false
  viewingLetterId.value = null
  viewerSourceRect.value = null
  if (letter.handwriting_font) loadFont(letter.handwriting_font)
  if (letter.direction === 'char_to_user' && !letter.is_read) store.markRead(letter.id)
}

function isReplied(letter) {
  return !!(letter.reply_content && letter.status === 'completed')
}

function openViewer() {
  viewerSourceRect.value = replySectionRef.value ? replySectionRef.value.getBoundingClientRect() : null
  viewingLetterId.value = activeLetter.value.id
}

function onViewerClosed() {
  viewingLetterId.value = null
  viewerSourceRect.value = null
}

async function onLetterSent(result) {
  writing.value = false; selectedChar.value = null
  if (result?.letter) { activeLetter.value = result.letter; await store.fetchLetters() }
}

async function onDeleteLetter(id) {
  const confirmed = await confirmRef.value.show({
    title: '删除信件',
    message: '确定要删除这封信件吗？此操作无法撤销。',
    okText: '删除',
    cancelText: '取消',
    danger: true,
  })
  if (!confirmed) return
  await store.deleteLetter(id)
  viewingLetterId.value = null
  viewerSourceRect.value = null
  activeLetter.value = null
  activeLetterId.value = null
}
</script>

<style scoped>
/* ── Transitions ── */
.mailbox-fade-enter-active { transition: opacity 0.2s ease; }
.mailbox-fade-leave-active { transition: opacity 0.15s ease; }
.mailbox-fade-enter-from,
.mailbox-fade-leave-to { opacity: 0; }

.panel-fade-enter-active { transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1); }
.panel-fade-leave-active { transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1); }
.panel-fade-enter-from { opacity: 0; transform: translateY(8px); }
.panel-fade-leave-to { opacity: 0; transform: translateY(-4px); }

.letter-list-enter-active,
.letter-list-leave-active { transition: opacity 0.2s ease; }
.letter-list-enter-from,
.letter-list-leave-to { opacity: 0; }
.letter-list-move { transition: transform 0.2s ease; }

.popup-fade-enter-active { transition: opacity 0.2s ease; }
.popup-fade-leave-active { transition: opacity 0.15s ease; }
.popup-fade-enter-from,
.popup-fade-leave-to { opacity: 0; }

/* ── Overlay ── */
.mailbox-overlay {
  position: fixed; inset: 0;
  background: rgba(18, 14, 12, 0.35);
  backdrop-filter: blur(4px);
  z-index: 10000;
  display: flex; align-items: center; justify-content: center;
}
.mailbox-modal {
  width: min(980px, 96vw);
  height: min(680px, 88vh);
  background: #FCFAF7;
  border-radius: 16px;
  box-shadow: 0 4px 32px rgba(0,0,0,0.08);
  display: flex; flex-direction: column;
  overflow: hidden;
}

/* ── Header ── */
.mailbox-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 28px;
  border-bottom: 1px solid rgba(0,0,0,0.05);
  flex-shrink: 0;
}
.header-left { display: flex; align-items: center; gap: 12px; }
.header-svg { color: #8a7a6a; flex-shrink: 0; }
.header-left h3 { margin: 0; font-size: 18px; font-weight: 600; color: #2a1a10; letter-spacing: 0.02em; }
.header-subtitle { margin: 1px 0 0; font-size: 11px; color: #aaa; }
.header-actions { display: flex; align-items: center; gap: 10px; }

/* ── Body ── */
.mailbox-body { display: flex; flex: 1; min-height: 0; }
.mailbox-body *::-webkit-scrollbar { display: none; }
.mailbox-body * { scrollbar-width: none; -ms-overflow-style: none; }

/* ── Sidebar ── */
.mailbox-sidebar {
  width: 280px; flex-shrink: 0;
  border-right: 1px solid rgba(0,0,0,0.04);
  overflow-y: auto; display: flex; flex-direction: column;
  background: #FAF7F4;
}

/* Sidebar empty */
.sidebar-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 48px 24px; text-align: center;
}
.sidebar-empty-svg { opacity: 0.15; margin-bottom: 4px; }
.sidebar-empty-title { font-size: 14px; font-weight: 600; color: #5a4a3a; margin: 0; }
.sidebar-empty-hint { font-size: 12px; color: #9a8a7a; margin: 0 0 6px; }

.loading-state {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 40px 20px; color: #8a7a6a; font-size: 13px;
}
.loading-spinner {
  width: 22px; height: 22px; border: 2px solid rgba(0,0,0,0.06);
  border-top-color: #8a7a6a; border-radius: 50%; animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.letter-list { display: flex; flex-direction: column; padding: 8px 10px; }

/* ── Letter Card ── */
.letter-card {
  position: relative;
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 12px; border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.letter-card:hover {
  background: rgba(0,0,0,0.02);
  transform: translateY(-1px);
}
.letter-card.active {
  background: #FFF8F4;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
.letter-card.unread .card-name {
  font-weight: 700;
  color: #1a0a00;
}

.unread-dot {
  position: absolute; top: 10px; right: 10px;
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--danger, var(--accent));
}

/* Avatar → Envelope + mini avatar */
.card-avatar-col { flex-shrink: 0; padding-top: 1px; }
.card-envelope {
  position: relative;
  width: 48px; height: 36px;
}
.card-envelope-svg { display: block; }
.card-avatar-mini {
  position: absolute;
  bottom: -2px; left: -2px;
  width: 22px; height: 22px;
  border-radius: 16px;
  object-fit: cover;
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
}
.card-avatar-mini-fallback {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--accent-light), var(--accent-2-light));
  color: #fff; font-size: 10px; font-weight: 700;
}

/* Content */
.card-body { flex: 1; min-width: 0; }
.card-top-row {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 6px; margin-bottom: 3px;
}
.card-name {
  font-size: 14px; font-weight: 500; color: #3a2a1a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.card-meta {
  font-size: 11px; color: #aaa; flex-shrink: 0;
  white-space: nowrap;
}

/* Status text below preview — low-saturation, subordinate */
.card-status {
  font-size: 12px;
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  margin-top: 3px;
  line-height: 1.5;
  transition: color 0.2s, background 0.2s;
}
.card-status.status-completed { color: #7FA88A; background: rgba(127, 168, 138, 0.07); }
.card-status.status-pending   { color: #B89A68; background: rgba(184, 154, 104, 0.07); }
.card-status.status-processing { color: #7D98B8; background: rgba(125, 152, 184, 0.07); }
.card-preview {
  font-size: 12px; color: #9a8a7a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── Main Content Area ── */
.mailbox-main { flex: 1; min-width: 0; overflow-y: auto; }

/* ── Detail Panel ── */
.detail-panel {
  height: 100%;
  display: flex; flex-direction: column;
  padding: 32px 40px;
  overflow-y: auto;
}

.detail-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  margin-bottom: 28px;
}
.detail-header-left { display: flex; align-items: center; gap: 14px; }
.detail-avatar {
  width: 44px; height: 44px; border-radius: 12px; object-fit: cover;
  flex-shrink: 0;
}
.detail-avatar-fallback {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--accent-light), var(--accent-2-light));
  color: #fff; font-size: 18px; font-weight: 700;
  flex-shrink: 0;
}
.detail-header-info { flex: 1; min-width: 0; }
.detail-header-name { font-size: 15px; font-weight: 600; color: #2a1a10; margin-bottom: 3px; }
.detail-header-meta { font-size: 12px; color: #aaa; }
.detail-header-meta.status-completed { color: #7FA88A; }
.detail-header-meta.status-pending   { color: #B89A68; }
.detail-header-meta.status-processing { color: #7D98B8; }

/* ── Reading Card ── */
.reading-card {
  flex: 1;
  display: flex; justify-content: center;
}

.reading-content {
  flex: 1; min-height: 0;
  width: 100%; max-width: 640px;
  background: #FEFCF8;
  border-radius: 10px;
  padding: 36px 44px 28px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.03);
  display: flex; flex-direction: column;
}

.reading-outgoing {
  width: 100%;
  min-height: 100%;
  background: #f5efe0 url(/letter-paper.avif) top center / cover no-repeat;
}

.reading-text {
  font-size: 17px; line-height: 1.9; color: #3a2a1a;
  white-space: pre-wrap; word-break: break-word;
}

.reading-snippet {
  flex-shrink: 0;
  border-radius: 12px;
  cursor: pointer;
  padding: 20px 24px;
  display: flex; justify-content: center;
}

.reading-reply {
  text-align: center;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 16px;
  color: #5a4a3a;
  max-width: 240px;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s;
  padding: 0;
}

.reading-divider-row {
  display: flex; align-items: center; gap: 12px;
  margin: 28px 0 20px;
}
.reading-divider {
  flex: 1; height: 1px; background: rgba(0,0,0,0.06);
}
.reading-divider-label {
  font-size: 11px; color: #bababa; flex-shrink: 0; letter-spacing: 0.05em;
}
.reading-original {
  color: rgba(58,42,26,0.5); font-size: 15px; line-height: 1.8;
}

.original-expanded {
  padding: 40px;
  flex: 1; overflow-y: auto;
  min-height: 220px;
  min-width: 100%;
}

/* Processing */
.reading-waiting {
  width: 100%; max-width: 640px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 60px 0;
  color: #8a7a6a;
}
.waiting-spinner {
  width: 22px; height: 22px; border: 2px solid rgba(0,0,0,0.06);
  border-top-color: #8a7a6a; border-radius: 50%;
  animation: spin 0.6s linear infinite;
  margin-bottom: 4px;
}
.waiting-text { font-size: 14px; color: #6a5a4a; margin: 0; }
.waiting-estimate { font-size: 12px; color: #aaa; margin: 0; }

/* ── Welcome / Default ── */
.welcome-area {
  height: 100%; display: flex; align-items: center; justify-content: center;
}
.welcome-card {
  text-align: center; padding: 48px;
}
.welcome-title { font-size: 15px; font-weight: 600; color: #4a3a2a; margin: 16px 0 6px; }
.welcome-hint { font-size: 13px; color: #9a8a7a; line-height: 1.7; margin: 0; }

/* ── Character Picker ── */
.char-picker-overlay {
  position: absolute; inset: 0;
  background: rgba(252,250,247,0.94);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 10; border-radius: 16px;
}
.char-picker-dialog {
  width: 85%; max-width: 480px;
  max-height: 68%; overflow-y: auto;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.06);
  padding: 24px;
}
.char-picker-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 20px; font-size: 15px; font-weight: 600; color: #2a1a10;
}
.char-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 12px;
}
.char-card {
  cursor: pointer; border-radius: 12px;
  padding: 3px;
  transition: all 0.15s;
}
.char-card:hover {
  background: rgba(0,0,0,0.02);
  transform: translateY(-1px);
}
.char-card-inner {
  display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 10px 6px;
}
.char-avatar {
  width: 56px; height: 56px; border-radius: 14px; object-fit: cover;
}
.char-avatar-fallback {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--accent-light), var(--accent-2-light));
  color: #fff; font-size: 22px; font-weight: 700;
}
.char-name { font-size: 12px; font-weight: 500; color: #3a2a1a; text-align: center; }

/* ── Write panel fills available space ── */
.write-panel { height: 100%; }
</style>
