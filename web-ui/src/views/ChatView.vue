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

      <!--
        正常 column 布局：最旧消息在顶部，最新消息在底部
        新消息到达时 JS 平滑滚底，与列表高度变化同步
      -->
      <div ref="msgList" class="message-list" @scroll="onScroll">
        <!-- 加载指示器置于列表顶部 → 用户上滚到顶部触发 IntersectionObserver 加载历史 -->
        <div ref="loadHint" v-if="chat.loadingOlder" class="load-older">加载更早的消息...</div>
        <div ref="loadHint" v-else-if="chat.hasMoreOlder" class="load-older load-older-hint">↑ 向上滚动加载更多</div>

        <div class="msg-list-inner">
          <template v-for="item in flatItems" :key="item.id">
            <!-- 时间分隔符 -->
            <div v-if="item.type === 'divider'" class="time-divider">{{ item.label }}</div>

            <!-- Text bubble (user or assistant) -->
            <div v-else-if="item.msg.type !== 'image_gen'" class="message" :class="[item.msg.role, { 'msg-same-role': item.sameRole }]">
              <div class="msg-avatar" :style="item.msg.role === 'user' ? userAvatarStyle : agentAvatarStyle">
                <span v-if="item.msg.role === 'user' ? !userAvatar : !(chat.activeChar?.avatar_path)" class="avatar-fallback">{{ item.msg.role === 'user' ? '我' : chat.activeChar?.display_name?.charAt(0) }}</span>
              </div>
              <!-- 等待态：Agent消息内容为空时显示打字动画，不套气泡 -->
              <svg v-if="item.msg.role === 'assistant' && !item.msg.content && chat.streaming && chat.showTypingDots"
                class="typing-dots" viewBox="0 0 72 10" width="72" height="10"
                style="align-self:center"
              >
                <circle cx="4" cy="5" r="3" class="dot dot-0" />
                <circle cx="16" cy="5" r="3" class="dot dot-1" />
                <circle cx="28" cy="5" r="3" class="dot dot-2" />
                <circle cx="40" cy="5" r="3" class="dot dot-3" />
                <circle cx="52" cy="5" r="3" class="dot dot-4" />
                <circle cx="64" cy="5" r="3" class="dot dot-5" />
              </svg>
              <div v-else-if="item.msg.content" class="msg-bubble">
                <div class="msg-text" v-html="renderContent(item.msg.content)"></div>
              </div>
            </div>

            <!-- Image generation bubble -->
            <div v-else class="message assistant" :class="{ 'msg-same-role': item.sameRole }">
              <div class="msg-avatar" :style="agentAvatarStyle">
                <span v-if="!chat.activeChar?.avatar_path" class="avatar-fallback">{{ chat.activeChar?.display_name?.charAt(0) }}</span>
              </div>
              <ImageGenBubble
                :msg="item.msg"
                @preview="previewImage = $event"
                @loaded="scrollToBottom(true)"
              />
            </div>
          </template>
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
          :title="chat.activeChar?.name === 'default' ? '不能删除默认Agent' : ''">
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

    <!-- 角色头像选择器 -->
    <AvatarCropper
      v-if="showAvatarPicker"
      title="选择角色头像"
      :show-recent-tab="true"
      :recent-images="recentImages"
      :recent-loading="recentLoading"
      @close="closeAvatarPicker"
      @save="onAgentAvatarSave"
      @switch-to-recent="switchToRecent"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import ImageGenBubble from '../components/ImageGenBubble.vue'
import AvatarCropper from '../components/AvatarCropper.vue'
import { userAvatar, loadUserAvatar } from '../userConfig.js'

const route = useRoute()
const router = useRouter()
const chat = useChatStore()
const inputText = ref('')
const inputEl = ref(null)
const msgList = ref(null)
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

const agentAvatarStyle = computed(() => {
  const p = chat.activeChar?.avatar_path
  if (p) return { backgroundImage: `url(${p})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  return { background: chat.activeChar?.avatar_color || '#5b8def' }
})

const userAvatarStyle = computed(() => {
  if (userAvatar.value) return { backgroundImage: `url(${userAvatar.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  return { background: '#5b8def' }
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
// 头像选择器（使用 AvatarCropper 组件）
// ══════════════════════════════════════════════════

const showAvatarPicker = ref(false)
const recentImages = ref([])
const recentLoading = ref(false)

function openAvatarPicker() {
  recentImages.value = []
  showAvatarPicker.value = true
}

function closeAvatarPicker() {
  showAvatarPicker.value = false
}

async function switchToRecent() {
  if (recentImages.value.length > 0) return
  recentLoading.value = true
  try {
    const d = await chat.getRecentChatImages()
    recentImages.value = d.images || []
  } catch {} finally { recentLoading.value = false }
}

async function onAgentAvatarSave(base64) {
  await chat.uploadAvatar(base64)
  showAvatarPicker.value = false
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

// 扁平化列表（时间正序：最旧在上，最新在下）
const flatItems = computed(() => {
  const items = []
  for (const group of messageGroups.value) {
    items.push({ type: 'divider', label: group.label, id: `d-${group.msgs[0]?.id || group.label}` })
    for (let mi = 0; mi < group.msgs.length; mi++) {
      const msg = group.msgs[mi]
      const sameRole = mi > 0 && group.msgs[mi - 1].role === msg.role
      items.push({ type: 'message', msg, id: msg.id, sameRole })
    }
  }
  return items
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
// 滚动管理（正常 column 布局，scrollTop=0 为顶部）
// ══════════════════════════════════════════════════

let userScrolledUp = false
let scrollTimer = null

function onScroll() {
  const el = msgList.value
  if (!el) return
  const distToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  if (distToBottom > 60) {
    userScrolledUp = true
  } else if (distToBottom < 10) {
    userScrolledUp = false
  }
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    if (distToBottom < 60) userScrolledUp = false
  }, 2000)
}

// force=true: 瞬间滚底（切角色/首次加载/发消息/图片加载完毕）
// force=false: 平滑滚动（流式分句，列表高度变化有 0.2s 缓动）
async function scrollToBottom(force = false) {
  await nextTick()
  const el = msgList.value
  if (!el) return
  if (force || !userScrolledUp) {
    if (force) {
      el.scrollTop = el.scrollHeight
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }
}

// ══════════════════════════════════════════════════
// 无限滚动加载（IntersectionObserver — 监测顶部 loadHint）
// ══════════════════════════════════════════════════

const loadHint = ref(null)
let loadObs = null

function startLoadObserver() {
  stopLoadObserver()
  if (!loadHint.value) return
  loadObs = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && chat.hasMoreOlder && !chat.loadingOlder) {
      loadMore()
    }
  }, { threshold: 0.1 })
  loadObs.observe(loadHint.value)
}

function stopLoadObserver() {
  if (loadObs) { loadObs.disconnect(); loadObs = null }
}

async function loadMore() {
  if (!chat.hasMoreOlder || chat.loadingOlder) return
  const el = msgList.value
  const prevHeight = el?.scrollHeight || 0
  await chat.loadOlderMessages()
  await nextTick()
  stopLoadObserver()
  await nextTick()
  startLoadObserver()
  if (el) {
    // 旧消息插入到列表顶部，需补偿 scrollTop 保持用户当前视口不跳
    const delta = el.scrollHeight - prevHeight
    el.scrollTop += delta
  }
}

// ── 生命周期 ──
onMounted(async () => {
  await Promise.all([chat.loadCharacters(), loadUserAvatar()])
  if (route.params.id) await chat.selectChar(parseInt(route.params.id))
  else if (chat.characters.length > 0) await chat.selectChar(chat.characters[0].id)
  await nextTick()
  startLoadObserver()
  scrollToBottom(true)  // 首次加载强制滚底
  inputEl.value?.focus()
})

onUnmounted(() => {
  stopLoadObserver()
})

// 浏览器前进/后退 → 同步 store
watch(() => route.params.id, (newId) => {
  const id = parseInt(newId)
  if (id && id !== chat.activeCharId) {
    chat.selectChar(id)
  }
})

let pendingCharSwitch = false

// 切角色：停 Observer + 隐藏容器，等消息加载完成后滚底
watch(() => chat.activeCharId, (id, oldId) => {
  if (id && id !== oldId) {
    const routeId = parseInt(route.params.id)
    if (id !== routeId) router.replace('/chat/' + id)
    pendingCharSwitch = true
    userScrolledUp = false
    stopLoadObserver()
    if (msgList.value) msgList.value.style.visibility = 'hidden'
  }
})

// 消息列表变化 → 统一滚底
watch(() => flatItems.value.length, () => {
  if (flatItems.value.length === 0) return
  if (pendingCharSwitch) {
    // 切角色后消息加载完成：滚底 + 恢复可见 + 重启 Observer
    setTimeout(() => {
      const el = msgList.value
      if (!el) return
      el.scrollTop = el.scrollHeight
      el.style.visibility = ''
      setTimeout(() => {
        el.scrollTop = el.scrollHeight
        startLoadObserver()
        pendingCharSwitch = false
      }, 150)
    }, 50)
  } else {
    scrollToBottom()  // 流式分句：平滑滚动
  }
})

async function send() {
  const text = inputText.value.trim()
  if (!text || chat.streaming) return
  inputText.value = ''
  userScrolledUp = false  // 用户主动发送 → 强制跟随
  await chat.sendMessage(text)
  await scrollToBottom(true)
}

function renderContent(text) {
  if (!text) return ''
  // <br> 必须在 HTML 转义之前剥离——转义后 < 变成 &lt;，正则无法匹配
  return text.replace(/<br\s*\/?>/gi, '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
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

.message-list {
  flex:1; overflow-y:auto; padding:16px 24px;
}

.msg-list-inner {
  display:flex; flex-direction:column; gap:2px;
}


.load-older { text-align:center; padding:8px 0; font-size:12px; color:var(--text-secondary); user-select:none; }
.load-older-hint { opacity:0.6; }

.time-divider { text-align:center; padding:16px 0 8px; font-size:12px; color:var(--text-secondary); user-select:none; }

.message { display:flex; margin:3px 0; align-items:flex-end; gap:8px; }
.message.user { flex-direction:row-reverse; }
.message.assistant { flex-direction:row; }

/* 连续同角色消息：隐藏头像，用占位保持对齐 */
.msg-avatar {
  width:42px; height:42px; border-radius:50%; flex-shrink:0;
  background-size:cover; background-position:center;
  display:flex; align-items:center; justify-content:center;
  transition: opacity 0.15s;
}
.msg-same-role .msg-avatar {
  opacity: 0; pointer-events: none;
}
.avatar-fallback {
  color:#fff; font-size:14px; font-weight:700; user-select:none;
}

.msg-bubble {
  max-width:75%; padding:10px 14px; border-radius:8px;
  font-size:14px; line-height:1.6; word-break:break-word;
}
.message.user .msg-bubble { background:#2b5278; color:#e8e8e8; }
.message.assistant .msg-bubble { background:var(--bg-secondary); color:var(--text-primary); border:1px solid var(--border); }

/* 打字指示器：6 个圆点依次变色的 wave 动画 */
.typing-dots { overflow: visible; flex-shrink: 0; }
.typing-dots .dot {
  fill: #fff; animation: dotBlink 1.2s ease-in-out infinite;
}
.typing-dots .dot-0 { animation-delay: 0.00s; }
.typing-dots .dot-1 { animation-delay: 0.10s; }
.typing-dots .dot-2 { animation-delay: 0.20s; }
.typing-dots .dot-3 { animation-delay: 0.30s; }
.typing-dots .dot-4 { animation-delay: 0.40s; }
.typing-dots .dot-5 { animation-delay: 0.50s; }

@keyframes dotBlink {
  0%, 20%, 100% { fill: #fff; }
  40%, 60% { fill: #aaa; }
}

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

</style>
