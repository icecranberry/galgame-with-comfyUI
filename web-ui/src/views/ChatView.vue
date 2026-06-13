<template>
  <div class="chat-view">
    <div v-if="!chat.activeCharId" class="empty-state">
      <div class="empty-icon">💬</div>
      <h2>选择一个角色开始对话</h2>
      <button v-if="isMobile" class="btn-empty-pick" @click="toggleMobileSidebar">选择角色</button>
    </div>

    <template v-else>
      <div class="chat-header">
        <button v-if="isMobile" class="btn-mobile-back" @click="toggleMobileSidebar" title="角色列表">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
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
        <div class="force-img-wrap">
          <label class="force-img-toggle" :class="{ active: forceImageGen }">
            <input type="checkbox" v-model="forceImageGen" />
            <span class="force-img-icon">🎨</span>
          </label>
          <transition name="tip-float">
            <span v-if="forceTipVisible" class="force-img-tip" :class="{ 'is-mobile': isMobile }">{{ forceImageGen ? '强制配图：开' : '灵性配图：开' }}</span>
          </transition>
        </div>
        <textarea ref="inputEl" v-model="inputText" class="chat-input"
          placeholder="输入消息..." rows="1"
          @keydown.enter.exact.prevent="send"
          @keydown.enter.shift.exact="inputText += '\n'"
        ></textarea>
        <button class="send-btn" @click="send" :disabled="!inputText.trim() || chat.streaming" :title="chat.streaming ? '发送中...' : '发送'">
          <svg v-if="!chat.streaming" class="send-icon" viewBox="0 0 1024 1024" fill="#fff">
            <path d="M659.655431 521.588015q23.970037-6.71161 46.022472-13.423221 19.17603-5.752809 39.310861-11.505618t33.558052-10.546816l-13.423221 50.816479q-5.752809 21.093633-10.546816 31.640449-9.588015 25.88764-22.531835 47.940075t-24.449438 38.35206q-13.423221 19.17603-27.805243 35.475655l-117.932584 35.475655 96.838951 17.258427q-19.17603 16.299625-41.228464 33.558052-19.17603 14.382022-43.625468 30.202247t-51.29588 29.243446-59.925094 13.902622-62.801498-4.314607q-34.516854-4.794007-69.033708-16.299625 10.546816-16.299625 23.011236-36.434457 10.546816-17.258427 25.40824-40.749064t31.161049-52.254682q46.022472-77.662921 89.168539-152.449438t77.662921-135.191011q39.310861-69.992509 75.745318-132.314607-45.06367 51.775281-94.921348 116.014981-43.146067 54.651685-95.88015 129.917603t-107.385768 164.434457q-11.505618 18.217228-25.88764 42.187266t-30.202247 50.816479-32.599251 55.131086-33.078652 55.131086q-38.35206 62.322097-78.621723 130.397004 0.958801-20.134831 7.670412-51.775281 5.752809-26.846442 19.17603-67.116105t38.35206-94.921348q16.299625-34.516854 24.928839-53.692884t13.423221-29.722846q4.794007-11.505618 7.670412-15.340824-4.794007-5.752809-1.917603-23.011236 1.917603-15.340824 11.026217-44.58427t31.161049-81.977528q22.052434-53.692884 58.007491-115.535581t81.018727-122.726592 97.797753-117.932584 107.865169-101.153558 110.262172-72.389513 106.906367-32.11985q0.958801 33.558052-6.71161 88.689139t-19.17603 117.932584-25.88764 127.520599-27.805243 117.453184z"/>
          </svg>
          <svg v-else class="send-icon sending" viewBox="0 0 20 20" fill="none">
            <circle cx="6" cy="10" r="1.5" fill="#fff" opacity="0.4"/><circle cx="10" cy="10" r="1.5" fill="#fff" opacity="0.65"/><circle cx="14" cy="10" r="1.5" fill="#fff" opacity="0.9"/>
          </svg>
        </button>
      </div>
    </template>

    <VueEasyLightbox
      :visible="!!previewImage"
      :imgs="previewImage"
      :max-zoom="6"
      :min-zoom="0.3"
      :zoom-scale="0.5"
      @hide="previewImage = null"
    />

    <!-- 角色设置面板（点击 ⚙️ 弹出） -->
    <Transition name="panel-slide">
      <div v-if="showSettings" class="settings-overlay" @click.self="closeSettings">
        <div class="settings-panel">
        <div class="sph">
          <span>角色设置</span>
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
    </Transition>

    <!-- 角色人格编辑弹窗（二级菜单） -->
    <Transition name="editor-fade">
      <div v-if="showEditor" class="editor-overlay" @click.self="closeCharEditor">
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
    </Transition>

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
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import ImageGenBubble from '../components/ImageGenBubble.vue'
import AvatarCropper from '../components/AvatarCropper.vue'
import VueEasyLightbox from 'vue-easy-lightbox'
import 'vue-easy-lightbox/dist/external-css/vue-easy-lightbox.css'
import { userAvatar, loadUserAvatar } from '../userConfig.js'

const route = useRoute()
const router = useRouter()
const chat = useChatStore()
const confirmFn = inject('confirm')
const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')
const inputText = ref('')
const forceImageGen = ref(localStorage.getItem('forceImageGen') === 'true')
watch(forceImageGen, (v) => { localStorage.setItem('forceImageGen', v); showForceTip() })
const forceTipVisible = ref(false)
let forceTipTimer = null
function showForceTip() {
  forceTipVisible.value = true
  clearTimeout(forceTipTimer)
  forceTipTimer = setTimeout(() => { forceTipVisible.value = false }, 2000)
}
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
  return { background: chat.activeChar?.avatar_color || '#e07b6c' }
})

const agentAvatarStyle = computed(() => {
const p = chat.activeChar?.avatar_path
if (p) return { backgroundImage: `url(${p})`, backgroundSize: 'cover', backgroundPosition: 'center' }
return { background: chat.activeChar?.avatar_color || '#e07b6c' }
})

const userAvatarStyle = computed(() => {
if (userAvatar.value) return { backgroundImage: `url(${userAvatar.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
return { background: '#e07b6c' }
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
if (clearing.value) return
const ok = await confirmFn({ title:'清空聊天记录', message:'确定要清空当前角色的所有聊天记录吗？\n此操作不可恢复。', okText:'清空' })
if (!ok) return
clearing.value = true
try { await chat.clearActiveMessages() } catch {} finally { clearing.value = false }
}

async function deleteChar() {
if (deleting.value || chat.activeChar?.name === 'default') return
const ok = await confirmFn({
title: '删除角色',
message: `确定要删除角色「${chat.activeChar?.display_name}」吗？\n此操作不可恢复。`,
okText: '删除', danger: true,
})
if (!ok) return
deleting.value = true
try { await chat.deleteActiveCharacter(); showSettings.value = false } catch {} finally { deleting.value = false }
}

async function removeAvatar() {
const ok = await confirmFn({ title:'移除头像', message:'确定要移除当前角色的头像吗？', okText:'移除' })
if (!ok) return
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
  await chat.sendMessage(text, forceImageGen.value)
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
.chat-view { flex:1; display:flex; flex-direction:column; height:100vh; overflow:hidden; background:transparent; }
.empty-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; }
.empty-icon { font-size:56px; }
.empty-state h2 { font-size:18px; color:var(--text-secondary); font-weight:400; }
.btn-empty-pick {
  margin-top: 12px; padding: 10px 28px;
  border-radius: 12px;
  border: 1px solid var(--glass-border);
  background: var(--accent); color: #fff;
  font-size: 15px; font-weight: 500; cursor: pointer;
  transition: all 0.2s ease;
}
.btn-empty-pick:hover { background: var(--accent-hover); box-shadow: 0 4px 18px rgba(224, 123, 108, 0.3); }
.btn-empty-pick:active { transform: scale(0.96); }

/* ── 毛玻璃顶部栏 ── */
.chat-header {
  padding:14px 24px;
  border-bottom: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  display:flex; align-items:center; justify-content:space-between;
}
.chat-title { font-size:16px; font-weight:600; color:var(--text-bright); }

/* ── 移动端返回按钮（← 箭头） ── */
.btn-mobile-back {
  width: 44px; height: 44px; flex-shrink: 0;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.28);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s ease;
  margin-right: 8px;
}
.btn-mobile-back:hover { color: var(--text-bright); border-color: var(--accent); }
.btn-mobile-back:active { transform: scale(0.94); }

.btn-header-settings {
  width:32px; height:32px; border-radius:10px;
  border:1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.28);
  color:var(--text-secondary); font-size:16px; cursor:pointer;
  display:flex; align-items:center; justify-content:center;
  transition: all 0.2s ease;
}
.btn-header-settings:hover { color:var(--text-bright); border-color:var(--accent); }

.message-list {
  flex:1; overflow-y:auto; padding:16px 24px;
  background: transparent;
}

.msg-list-inner {
  display:flex; flex-direction:column; gap:4px;
}

.load-older { text-align:center; padding:8px 0; font-size:12px; color:var(--text-secondary); user-select:none; }
.load-older-hint { opacity:0.6; }

.time-divider { text-align:center; padding:16px 0 8px; font-size:12px; color:var(--text-secondary); user-select:none; }

/* ── 消息气泡保持不变 ── */
.message { display:flex; margin:3px 0; align-items:flex-end; gap:8px; }
.message.user { flex-direction:row-reverse; }
.message.assistant { flex-direction:row; }

.msg-avatar {
  width:42px; height:42px; border-radius:50%; flex-shrink:0;
  background-size:cover; background-position:center;
  display:flex; align-items:center; justify-content:center;
  transition: opacity 0.15s;
}
.msg-same-role .msg-avatar { opacity: 0; pointer-events: none; }
.avatar-fallback { color:#fff; font-size:14px; font-weight:700; user-select:none; }

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

/* ── 强制生图开关 ── */
.force-img-wrap {
  position: relative;
}
.force-img-toggle {
  display: flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; flex-shrink: 0;
  border-radius: 12px; cursor: pointer;
  background: rgba(255, 255, 255, 0.7);
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  transition: all 0.25s ease;
  opacity: 0.5;
}
.force-img-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
.force-img-icon { font-size: 18px; line-height: 1; transition: transform 0.25s ease; }
.force-img-toggle:hover { opacity: 0.8; border-color: rgba(224, 123, 108, 0.3); }
.force-img-toggle.active {
  opacity: 1;
  background: linear-gradient(135deg, rgba(224, 123, 108, 0.15) 0%, rgba(208, 110, 94, 0.15) 100%);
  border-color: var(--accent-light);
  box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.12), 0 0 16px rgba(224, 123, 108, 0.08);
}
.force-img-toggle.active .force-img-icon { transform: scale(1.1); }

.force-img-tip {
  position: absolute;
  bottom: calc(100% + 18px);
  left: calc(50% + 10px);
  transform: translateX(-50%);
  white-space: nowrap;
  padding: 6px 14px;
  font-size: 12px; font-weight: 500;
  color: var(--text-bright);
  background: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  pointer-events: none;
}
.force-img-tip.is-mobile {
  left: calc(50% + 20px);
}

/* tip 浮入浮出动画 */
.tip-float-enter-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.tip-float-leave-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.tip-float-enter-from { opacity: 0; transform: translateX(-50%) translateY(6px); }
.tip-float-leave-to   { opacity: 0; transform: translateX(-50%) translateY(6px); }

/* ── 毛玻璃输入区 ── */
.input-area {
  padding:8px 24px;
  border-top: 1px solid var(--glass-border);
  display:flex; gap:10px; align-items:flex-end;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
.chat-input {
  flex:1; min-height:40px; max-height:120px; padding:10px 14px; font-size:14px;
  background: rgba(255, 255, 255, 0.9);
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  border-radius: 14px; color:var(--text-bright); outline:none; resize:none;
  overflow: hidden; caret-color: var(--accent);
  transition: border-color 0.2s ease, box-shadow 0.3s ease, background 0.2s ease;
}
.chat-input::placeholder { color: var(--text-secondary); opacity: 0.5; }
.chat-input:hover { border-color: rgba(224, 123, 108, 0.35); }
.chat-input:focus {
  background: rgba(255, 255, 255, 0.9);
  border-color: var(--accent-light);
  box-shadow:
    0 0 0 4px rgba(224, 123, 108, 0.10),
    0 0 24px rgba(224, 123, 108, 0.08),
    inset 0 0 10px rgba(224, 123, 108, 0.04);
}

/* ── 发送按钮：圆形 + 渐变 + 发光 + 启停缓动 ── */
.send-btn {
  width: 42px; height: 42px; flex-shrink: 0;
  border-radius: 50%;
  font-size: 0;
  background: linear-gradient(135deg, var(--accent) 0%, #d06e5e 100%);
  color: #fff;
  border: none; padding: 0;
  opacity: 1; cursor: pointer;
  box-shadow:
    0 2px 8px rgba(224, 123, 108, 0.22),
    0 0 0 0 rgba(224, 123, 108, 0);
  transition:
    opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.35s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
/* 发送图标 */
.send-icon { width: 18px; height: 18px; display: block; transition: transform 0.2s ease; }
.send-icon.sending circle { animation: dotPulse 1s ease-in-out infinite; }
.send-icon.sending circle:nth-child(2) { animation-delay: 0.15s; }
.send-icon.sending circle:nth-child(3) { animation-delay: 0.3s; }
@keyframes dotPulse { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }

/* 脉冲波纹 */
.send-btn::after {
  content: '';
  position: absolute; inset: -4px;
  border-radius: 50%;
  border: 2px solid rgba(224, 123, 108, 0.25);
  opacity: 0;
  transition: opacity 0.3s ease, inset 0.3s ease;
}
.send-btn:not(:disabled):hover {
  box-shadow:
    0 4px 18px rgba(224, 123, 108, 0.35),
    0 0 32px rgba(224, 123, 108, 0.10);
  transform: scale(1.06);
}
.send-btn:not(:disabled):hover .send-icon { transform: translateX(1.5px); }
.send-btn:not(:disabled):hover::after {
  opacity: 1;
  inset: -8px;
}
.send-btn:not(:disabled):active {
  transform: scale(0.94);
  box-shadow: 0 1px 4px rgba(224, 123, 108, 0.2);
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}
/* 禁用态 — 渐变保留仅降透明度 + 收光，靠 transition 实现 0.35s 缓入缓出 */
.send-btn:disabled {
  opacity: 0.35;
  box-shadow: none;
  pointer-events: none;
}


/* ── 毛玻璃角色设置面板 ── */
.settings-overlay { position:fixed; inset:0; background:transparent; display:flex; align-items:flex-start; justify-content:flex-end; z-index:1000; padding:60px 24px 0 0; }
.settings-panel {
  width:280px;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-radius:16px;
  border:1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 8px 32px rgba(0,0,0,0.08);
  overflow:hidden;
}

/* 设置面板滑入动画 */
.panel-slide-enter-active { transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.panel-slide-leave-active { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.panel-slide-enter-from { opacity:0; transform: translateX(16px); }
.panel-slide-leave-to   { opacity:0; transform: translateX(16px); }
.sph { padding:14px 16px; border-bottom:1px solid rgba(255, 255, 255, 0.2); display:flex; align-items:center; justify-content:space-between; }
.sph span { font-size:14px; font-weight:600; color:var(--text-bright); }
.settings-close { width:28px; height:28px; border-radius:8px; border:none; background:transparent; color:var(--text-secondary); font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition: all 0.15s; }
.settings-close:hover { color:var(--text-bright); background:rgba(0,0,0,0.06); }

.sp-section { padding:14px 16px; }
.sp-label { font-size:12px; color:var(--text-secondary); display:block; margin-bottom:10px; }
.avatar-row { display:flex; align-items:center; gap:14px; }
.avatar-preview { width:48px; height:48px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-size:20px; font-weight:700; flex-shrink:0; }
.color-dot { width:22px; height:22px; border-radius:50%; border:2px solid transparent; cursor:pointer; padding:0; transition: border-color 0.15s, transform 0.15s; }
.color-dot:hover { transform:scale(1.15); }
.color-dot.active { border-color:var(--accent); transform:scale(1.15); }
.color-native { width:22px; height:22px; border:none; border-radius:50%; cursor:pointer; padding:0; background:transparent; }
.color-native::-webkit-color-swatch-wrapper { padding:0; }
.color-native::-webkit-color-swatch { border-radius:50%; border:none; }

.sp-divider { height:1px; background:rgba(255, 255, 255, 0.2); margin:0 16px; }
.sp-btn { display:block; width:100%; text-align:left; padding:12px 16px; border:none; border-radius:0; background:transparent; color:var(--text-primary); font-size:13px; cursor:pointer; transition:background 0.15s ease; }
.sp-btn:hover { background:rgba(255, 255, 255, 0.2); }
.sp-btn:disabled { opacity:0.4; cursor:not-allowed; }
.sp-btn-danger { color:var(--danger); }
.sp-btn-danger:hover:not(:disabled) { background:rgba(255, 77, 79, 0.06); }

/* ── 毛玻璃编辑弹窗 ── */
.editor-overlay { position:fixed; inset:0; background:transparent; display:flex; align-items:center; justify-content:center; z-index:1001; }
.editor-panel {
  width:640px; max-height:85vh;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-radius:16px;
  border:1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 12px 48px rgba(0,0,0,0.1);
  display:flex; flex-direction:column; overflow:hidden;
}

/* 编辑弹窗淡入缩放 */
.editor-fade-enter-active { transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.editor-fade-leave-active { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.editor-fade-enter-from { opacity:0; transform: scale(0.95); }
.editor-fade-leave-to   { opacity:0; transform: scale(0.95); }
.editor-header { padding:16px 20px; border-bottom:1px solid rgba(255, 255, 255, 0.22); display:flex; align-items:center; justify-content:space-between; }
.editor-header span { font-size:15px; font-weight:600; color:var(--text-bright); }
.editor-close { width:32px; height:32px; border-radius:8px; border:none; background:transparent; color:var(--text-secondary); font-size:20px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition: all 0.15s; }
.editor-close:hover { color:var(--text-bright); background:var(--bg-hover); }
.editor-field { padding:12px 20px 0; display:flex; flex-direction:column; gap:6px; }
.editor-field label { font-size:13px; color:var(--text-secondary); }
.editor-input { padding:8px 12px; font-size:14px; background:rgba(255,255,255,0.9); border:1px solid #d5d0ca; border-radius:8px; color:var(--text-bright); outline:none; transition: border-color 0.15s; }
.editor-input:focus { border-color:var(--accent); }
.editor-textarea { padding:10px 12px; font-size:13px; line-height:1.6; background:rgba(255,255,255,0.9); border:1px solid #d5d0ca; border-radius:8px; color:var(--text-bright); outline:none; resize:vertical; font-family:inherit; }
.editor-textarea:focus { border-color:var(--accent); }
.editor-actions { padding:16px 20px; border-top:1px solid rgba(255, 255, 255, 0.22); display:flex; justify-content:flex-end; align-items:center; }
.editor-actions-right { display:flex; gap:10px; }
.btn-cancel { padding:8px 18px; border-radius:8px; border:1px solid rgba(255, 255, 255, 0.22); background:rgba(255, 255, 255, 0.28); color:var(--text-primary); font-size:13px; cursor:pointer; transition: all 0.15s; }
.btn-cancel:hover { background:var(--bg-hover); }
.btn-danger { padding:8px 18px; border-radius:8px; border:1px solid var(--danger); background:transparent; color:var(--danger); font-size:13px; cursor:pointer; transition: all 0.15s; }
.btn-danger:hover { background:var(--danger); color:#fff; }
.btn-danger:disabled { opacity:0.5; cursor:not-allowed; }

.avatar-preview.clickable { cursor:pointer; transition: opacity 0.15s; }
.avatar-preview.clickable:hover { opacity:0.85; }
.sp-btn-small { padding:6px 14px; font-size:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.25); background:rgba(255,255,255,0.28); color:var(--text-primary); cursor:pointer; margin-right:6px; transition: all 0.15s; }
.sp-btn-small:hover { border-color:var(--accent); }
.sp-btn-subtle { color:var(--text-secondary); border-color:transparent; background:transparent; }
.sp-btn-subtle:hover { color:var(--danger); border-color:transparent; }

/* ── 移动端空间优化 ── */
@media (max-width: 767px) {
  .chat-header { padding: 12px 16px; }
  .message-list { padding: 5px 10px; }
  .input-area { padding: 8px 16px; }
}

</style>
