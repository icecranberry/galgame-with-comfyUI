<template>
  <div class="chat-view">
    <!-- 头部（与私聊 chat-header 同款） -->
    <div class="chat-header">
      <button v-if="isMobile" class="btn-mobile-back" @click="toggleMobileSidebar" title="角色列表">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <div class="group-avatar-grid header-avatar">
        <div
          v-for="m in (store.activeGroup?.members || []).slice(0, 4)"
          :key="m.id"
          class="group-avatar-cell"
          :style="m.avatar_path ? { backgroundImage: `url(${m.avatar_path})` } : { background: '#e07b6c' }"
        >{{ m.avatar_path ? '' : m.display_name.charAt(0) }}</div>
      </div>
      <div class="chat-header-center">
        <div class="chat-header-title-row">
          <div class="chat-title">{{ store.activeGroup?.name || '群聊' }}</div>
        </div>
        <div class="chat-header-schedule">{{ store.activeGroup?.members?.length || 0 }} 位成员{{ store.activeGroup?.topic ? ' · ' + store.activeGroup.topic : '' }}</div>
      </div>
      <div class="chat-header-right">
        <div class="btn-header-settings" title="群设置" @click="showSettings = true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
        </div>
      </div>
    </div>

    <!-- 消息区（与私聊 message-list 同款） -->
    <div ref="scrollEl" class="message-list">
      <div ref="msgListInner" class="msg-list-inner">
        <template v-for="(msg, idx) in store.messages" :key="msg.id">
          <!-- 时间分隔符（与私聊同款：间隔超 10 分钟显示） -->
          <div v-if="showTimeDivider(idx)" class="time-divider">{{ timeLabel(msg.created_at) }}</div>
          <div
            class="message"
            :class="[msg.role === 'user' ? 'user' : 'assistant', { 'msg-same-role': isSameSpeaker(idx) }]"
          >
          <div
            class="msg-avatar"
            :style="msg.role === 'user' ? userAvatarStyle : speakerAvatarStyle(msg)"
          ><span v-if="avatarFallback(msg)" class="avatar-fallback">{{ avatarFallback(msg) }}</span></div>
          <div class="msg-col">
            <div v-if="msg.role !== 'user' && !isSameSpeaker(idx)" class="speaker-name">{{ msg.speaker_name || '?' }}</div>
            <div v-if="msg.content" class="msg-bubble">
              <div class="msg-text">{{ msg.content }}</div>
            </div>
            <!-- 本次会话内的生图任务：与私聊同款遮罩/进度/错误气泡；历史图片直接展示 -->
            <ImageGenBubble
              v-if="msg.genStatus && !msg.hideImagePending"
              :msg="genMsgOf(msg)"
              :emit-loaded-when-initially-done="true"
              @preview="url => previewUrl = url"
              @loaded="onGroupImageLoaded(msg.id)"
            />
            <div v-else-if="msg.images && msg.images.length" class="msg-images">
              <img
                v-for="(url, i) in msg.images"
                :key="i"
                :src="url"
                class="msg-image"
                @click="previewUrl = url"
              />
            </div>
          </div>
          </div>
        </template>

        <div v-if="store.messages.length === 0" class="gc-empty">
          群聊已建立，发条消息热热场吧～
        </div>
      </div>
    </div>

    <!-- 输入区（与私聊 input-area 同款） -->
    <div class="input-area">
      <div v-if="showMentionPicker" class="mention-panel">
        <div
          v-for="m in store.activeGroup?.members || []"
          :key="m.id"
          class="mention-item"
          @click="pickMention(m)"
        >
          <div class="mention-avatar" :style="m.avatar_path ? { backgroundImage: `url(${m.avatar_path})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: '#e07b6c' }">{{ m.avatar_path ? '' : m.display_name.charAt(0) }}</div>
          <span>{{ m.display_name }}</span>
        </div>
      </div>
      <textarea
        ref="inputEl"
        v-model="draft"
        class="chat-input"
        rows="1"
        placeholder="输入消息… "
        @input="onInput"
        @keydown.enter.exact.prevent="onSend"
        @keydown.enter.shift.exact="draft += '\n'"
      ></textarea>
      <button
        class="send-btn"
        :class="{ 'send-disabled': !draft.trim() }"
        @click="onSendClick"
        @pointerdown="onSendPressStart"
        @pointerup="onSendPressEnd"
        @pointercancel="onSendPressEnd"
        @pointerleave="onSendPressEnd"
        @contextmenu.prevent
        :title="store.undoing ? '正在撤回…' : '发送（长按可撤回上一轮）'"
      >
        <svg class="send-icon" viewBox="0 0 1024 1024" fill="#fff">
          <path d="M659.655431 521.588015q23.970037-6.71161 46.022472-13.423221 19.17603-5.752809 39.310861-11.505618t33.558052-10.546816l-13.423221 50.816479q-5.752809 21.093633-10.546816 31.640449-9.588015 25.88764-22.531835 47.940075t-24.449438 38.35206q-13.423221 19.17603-27.805243 35.475655l-117.932584 35.475655 96.838951 17.258427q-19.17603 16.299625-41.228464 33.558052-19.17603 14.382022-43.625468 30.202247t-51.29588 29.243446-59.925094 13.902622-62.801498-4.314607q-34.516854-4.794007-69.033708-16.299625 10.546816-16.299625 23.011236-36.434457 10.546816-17.258427 25.40824-40.749064t31.161049-52.254682q46.022472-77.662921 89.168539-152.449438t77.662921-135.191011q39.310861-69.992509 75.745318-132.314607-45.06367 51.775281-94.921348 116.014981-43.146067 54.651685-95.88015 129.917603t-107.385768 164.434457q-11.505618 18.217228-25.88764 42.187266t-30.202247 50.816479-32.599251 55.131086-33.078652 55.131086q-38.35206 62.322097-78.621723 130.397004 0.958801-20.134831 7.670412-51.775281 5.752809-26.846442 19.17603-67.116105t38.35206-94.921348q16.299625-34.516854 24.928839-53.692884t13.423221-29.722846q4.794007-11.505618 7.670412-15.340824-4.794007-5.752809-1.917603-23.011236 1.917603-15.340824 11.026217-44.58427t31.161049-81.977528q22.052434-53.692884 58.007491-115.535581t81.018727-122.726592 97.797753-117.932584 107.865169-101.153558 110.262172-72.389513 106.906367-32.11985q0.958801 33.558052-6.71161 88.689139t-19.17603 117.932584-25.88764 127.520599-27.805243 117.453184z"/>
        </svg>
      </button>
    </div>

    <!-- 图片预览 -->
    <ImageLightbox
      :visible="!!previewUrl"
      :imgs="previewUrl || ''"
      :show-regenerate="false"
      :show-delete="false"
      @hide="previewUrl = null"
      @update:visible="v => { if (!v) previewUrl = null }"
    />

    <!-- 群设置抽屉 -->
    <Transition name="drawer">
      <div v-if="showSettings" class="gc-drawer-overlay" @click.self="showSettings = false">
        <div class="gc-drawer">
          <h3>群设置</h3>
          <label class="gc-field">
            <span>群名称</span>
            <input v-model="editName" type="text" maxlength="24" />
          </label>
          <label class="gc-field">
            <span>群主题</span>
            <input v-model="editTopic" type="text" maxlength="60" placeholder="（可选）大家围绕什么话题聊" />
          </label>
          <div class="gc-field gc-member-field">
            <div class="gc-member-title">
              <span>群成员</span>
              <span>{{ editMemberIds.length }} / {{ sortedCharacters.length }}</span>
            </div>
            <div class="gc-member-edit">
              <button
                v-for="c in sortedCharacters"
                :key="c.id"
                type="button"
                class="gc-member-check"
                :class="{ picked: editMemberIds.includes(c.id) }"
                :aria-pressed="editMemberIds.includes(c.id)"
                @click="toggleMember(c.id)"
              >
                <div
                  class="gc-member-avatar"
                  :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})` } : { background: '#e07b6c' }"
                >{{ c.avatar_path ? '' : c.display_name.charAt(0) }}</div>
                <span>{{ c.display_name }}</span>
              </button>
            </div>
            <span class="gc-member-hint">至少选择 2 位角色</span>
          </div>
          <div class="gc-record-actions">
            <button
              class="gc-btn gc-btn-undo"
              :disabled="!canUndo"
              @click="requestUndoLastRound"
            >撤回上一轮对话</button>
          </div>
          <div class="gc-drawer-actions">
            <button class="gc-btn gc-btn-danger" @click="onDissolve">解散群聊</button>
            <button class="gc-btn gc-btn-primary" :disabled="editMemberIds.length < 2" @click="onSaveSettings">保存</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGroupsStore } from '../stores/groups.js'
import { useChatStore } from '../stores/chat.js'
import { userAvatar, loadUserAvatar } from '../userConfig.js'
import ImageLightbox from '../components/ImageLightbox.vue'
import ImageGenBubble from '../components/ImageGenBubble.vue'

const route = useRoute()
const router = useRouter()
const store = useGroupsStore()
const chat = useChatStore()
const confirmFn = inject('confirm', null)

const scrollEl = ref(null)
const msgListInner = ref(null)
const inputEl = ref(null)
const draft = ref('')
const showMentionPicker = ref(false)
const showSettings = ref(false)
const previewUrl = ref(null)

const editName = ref('')
const editTopic = ref('')
const editMemberIds = ref([])
const canUndo = computed(() => (
  store.messages.length > 0 && !store.sending && !store.playing && !store.undoing
))
const sortedCharacters = computed(() => [...chat.characters].sort((left, right) => (
  (left.display_name || '').localeCompare(right.display_name || '', 'zh-CN-u-co-pinyin', { sensitivity: 'base' })
)))

// ── 头像 ──

const userAvatarStyle = computed(() => {
  return userAvatar.value
    ? { backgroundImage: `url(${userAvatar.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: '#a25740' }
})

function memberOf(msg) {
  return (store.activeGroup?.members || []).find(m => m.id === msg.speaker_character_id)
}
function speakerAvatarStyle(msg) {
  const path = memberOf(msg)?.avatar_path || msg.speaker_avatar
  return path
    ? { backgroundImage: `url(${path})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: '#e07b6c' }
}
function avatarFallback(msg) {
  if (msg.role === 'user') {
    return userAvatar.value ? '' : '我'
  }
  const path = memberOf(msg)?.avatar_path || msg.speaker_avatar
  return path ? '' : (msg.speaker_name || '?').charAt(0)
}

/** 适配 ImageGenBubble 的 msg 结构：群聊 images 存 url 字符串数组，组件期望 [{url}] */
function genMsgOf(msg) {
  return {
    genId: msg.id,
    genStatus: msg.genStatus,
    genProgress: msg.genProgress,
    genError: msg.genError,
    images: (msg.images || []).map(u => (typeof u === 'string' ? { url: u } : u)),
  }
}

function onGroupImageLoaded(msgId) {
  store.markGroupImageLoaded(msgId)
  scrollToBottom()
}
/** 连续同一发言人 → 隐藏头像和名字（与私聊 msg-same-role 一致）；跨时间分隔符时重新显示 */
function isSameSpeaker(idx) {
  if (idx === 0) return false
  if (showTimeDivider(idx)) return false
  const cur = store.messages[idx]
  const prev = store.messages[idx - 1]
  return cur.role === prev.role && cur.speaker_character_id === prev.speaker_character_id
}

// ── 时间分隔符（与私聊同款规则：相邻消息间隔超 10 分钟显示一条时间） ──

function showTimeDivider(idx) {
  const cur = store.messages[idx]
  if (!cur?.created_at) return false
  if (idx === 0) return true
  const prev = store.messages[idx - 1]
  if (!prev?.created_at) return false
  return Math.abs(new Date(cur.created_at) - new Date(prev.created_at)) > 10 * 60 * 1000
}

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

// ── 进入/切换群 ──

async function enterGroup(id) {
  if (!id) return
  await store.loadGroups()
  await store.selectGroup(parseInt(id, 10))
  scrollToBottom(true)   // 进群直接定位底部，不要缓动
  setupResizeObserver()  // 与私聊一致：历史图片异步加载撑高列表时自动追底
  armLullTimer()
}

watch(() => route.params.id, (id) => { if (route.path.startsWith('/group/')) enterGroup(id) })
watch(() => store.scrollSignal, () => { scrollToBottom(); armLullTimer() })

watch(showSettings, (open) => {
  if (open && store.activeGroup) {
    editName.value = store.activeGroup.name
    editTopic.value = store.activeGroup.topic || ''
    editMemberIds.value = store.activeGroup.members.map(m => m.id)
  }
})

onMounted(() => {
  store.connectSSE()
  enterGroup(route.params.id)
  if (chat.characters.length === 0) chat.loadCharacters?.()
  if (!userAvatar.value) loadUserAvatar()
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  clearLullTimer()
  clearSendPressTimer()
  teardownResizeObserver()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  store.leaveGroup()
})

// ResizeObserver：进群后临时监听内容区高度变化（图片加载撑高），追底后自毁（与私聊同款）
let resizeObserver = null
let resizeRaf = null
let lastObservedSH = 0
let resizeObserverTimer = null
const RESIZE_OBSERVER_TTL = 2000

function setupResizeObserver() {
  teardownResizeObserver()
  nextTick(() => {
    const inner = msgListInner.value
    const el = scrollEl.value
    if (!inner || !el) return
    lastObservedSH = el.scrollHeight
    resizeObserver = new ResizeObserver(() => {
      if (resizeRaf) return
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null
        const el2 = scrollEl.value
        if (!el2 || store.playing) return
        const newSH = el2.scrollHeight
        if (newSH === lastObservedSH) return
        // 用旧 scrollHeight 算距底距离，用户上翻时不打扰
        const distBefore = lastObservedSH - el2.scrollTop - el2.clientHeight
        lastObservedSH = newSH
        if (distBefore > 60) return
        el2.scrollTop = el2.scrollHeight
        // 完成一次追底后延迟自毁：给剩余图片 500ms 缓冲
        clearTimeout(resizeObserverTimer)
        resizeObserverTimer = setTimeout(teardownResizeObserver, 500)
      })
    })
    resizeObserver.observe(inner)
    // TTL 到期强制自毁，防意外长驻
    resizeObserverTimer = setTimeout(teardownResizeObserver, RESIZE_OBSERVER_TTL)
  })
}

function teardownResizeObserver() {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = null }
  clearTimeout(resizeObserverTimer)
  resizeObserverTimer = null
  lastObservedSH = 0
}

// 与私聊一致：新消息平滑滚动到底，force 时（进群/切群）瞬间定位
function scrollToBottom(force = false) {
  nextTick(() => {
    const el = scrollEl.value
    if (!el) return
    if (force) el.scrollTop = el.scrollHeight
    else el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  })
}

// ── 冷场检测：停留 40s 无新消息 → 自动触发角色续聊 ──
// 自动触发最多 2 次（计数存 store，切群/离开页面不重置，仅用户发言归零），防止无限自嗨烧 token

const LULL_DELAY = 40_000
const MAX_LULL_PER_USER_MSG = 2
let lullTimer = null

function clearLullTimer() {
  if (lullTimer) { clearTimeout(lullTimer); lullTimer = null }
}

function armLullTimer() {
  clearLullTimer()
  if (!route.path.startsWith('/group/')) return
  lullTimer = setTimeout(tryLull, LULL_DELAY)
}

async function tryLull() {
  lullTimer = null
  if (!route.path.startsWith('/group/')) return
  // 页面不可见 / 正在发送 / 正在播放 / 次数用尽 → 不触发；除次数用尽外重新计时
  if (document.visibilityState !== 'visible') return  // 等 visibilitychange 恢复计时
  if (store.sending || store.playing) { armLullTimer(); return }
  if (store.lullCount >= MAX_LULL_PER_USER_MSG) return
  store.lullCount++
  const accepted = await store.nudge()
  if (!accepted) store.lullCount--
  // 新消息到达会经 scrollSignal 重新计时；这里兜底再计一次
  armLullTimer()
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') armLullTimer()
  else clearLullTimer()
}

// ── 输入 / @点名 ──

function onInput(e) {
  showMentionPicker.value = draft.value.endsWith('@')
  const el = e.target
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

function pickMention(m) {
  draft.value = draft.value.replace(/@$/, '') + `@${m.display_name} `
  showMentionPicker.value = false
  inputEl.value?.focus()
}

async function onSend() {
  if (store.undoing) return
  const text = draft.value.trim()
  if (!text) return   // 播放/请求中也允许发言：打断播放或进入 5s 聚合
  draft.value = ''
  showMentionPicker.value = false
  if (inputEl.value) inputEl.value.style.height = 'auto'
  clearLullTimer()
  store.sendMessage(text)
  armLullTimer()
}

const LONG_PRESS_MS = 600
let sendPressTimer = null
let longPressFired = false

function clearSendPressTimer() {
  if (sendPressTimer) clearTimeout(sendPressTimer)
  sendPressTimer = null
}

function onSendPressStart(event) {
  if (!canUndo.value) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  clearSendPressTimer()
  longPressFired = false
  sendPressTimer = setTimeout(() => {
    sendPressTimer = null
    longPressFired = true
    requestUndoLastRound()
  }, LONG_PRESS_MS)
}

function onSendPressEnd() {
  clearSendPressTimer()
}

function onSendClick() {
  if (longPressFired) {
    longPressFired = false
    return
  }
  onSend()
}

async function requestUndoLastRound() {
  if (!canUndo.value) return
  const options = {
    title: '撤回上一轮群聊',
    message: '确定撤回上一轮群聊吗？\n上一轮用户消息和角色回复都会被删除，本轮生成的图片和已经写入的相关记忆也会一并清理。\n\n提示：长按发送键也可以快速撤回。',
    okText: '撤回',
    danger: true,
  }
  const confirmed = confirmFn
    ? await confirmFn(options)
    : confirm(options.message)
  if (!confirmed) return

  try {
    const result = await store.undoLastRound()
    if (!result?.deleted) alert('当前没有可撤回的群聊记录')
    showSettings.value = false
    scrollToBottom(true)
    armLullTimer()
  } catch (err) {
    alert(err.message || '撤回失败，请稍后重试')
  }
}

// 与私聊一致：移动端返回键拉起角色列表侧栏
const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')

// ── 群设置 ──

function toggleMember(id) {
  const idx = editMemberIds.value.indexOf(id)
  if (idx >= 0) editMemberIds.value.splice(idx, 1)
  else editMemberIds.value.push(id)
}

async function onSaveSettings() {
  if (editMemberIds.value.length < 2) {
    alert('群聊至少保留 2 个角色成员')
    return
  }
  await store.updateGroup(store.activeGroupId, {
    name: editName.value,
    topic: editTopic.value,
    member_ids: editMemberIds.value,
  })
  await store.selectGroup(store.activeGroupId)
  showSettings.value = false
}

async function onDissolve() {
  const message = `确定解散「${store.activeGroup?.name}」吗？群消息和群记忆将被清空。`
  const confirmed = confirmFn
    ? await confirmFn({ title: '解散群聊', message, okText: '解散', danger: true })
    : confirm(message)
  if (!confirmed) return
  await store.deleteGroup(store.activeGroupId)
  showSettings.value = false
  router.push('/chat')
}
</script>

<style scoped>
/* ══ 与私聊 ChatView 对齐的基础布局 ══ */
.chat-view { flex:1; display:flex; flex-direction:column; height:100vh; height:100dvh; overflow:hidden; background:transparent; }

/* ── 头部 ── */
.chat-header {
  padding:14px 24px;
  border-bottom: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  display:flex; align-items:center; gap: 10px;
}
.chat-title { font-size:16px; font-weight:600; color:var(--text-bright); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.chat-header-center { display: flex; flex-direction: column; gap: 0; flex: 1; min-width: 0; }
.chat-header-title-row { display: flex; align-items: center; gap: 8px; }
.chat-header-schedule {
  font-size: 11px; color: var(--accent);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  opacity: 0.75; margin-top: 2px;
}
.chat-header-right { display: flex; align-items: center; gap: 10px; }

.btn-mobile-back {
  width: 44px; height: 44px; flex-shrink: 0;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.28);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s ease;
}
.btn-mobile-back:hover { color: var(--text-bright); border-color: var(--accent); }
.btn-mobile-back:active { transform: scale(0.94); }

.btn-header-settings {
  width:32px; height:32px; border-radius:10px;
  border:1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.28);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s ease;
}
.btn-header-settings:hover { color: var(--text-bright); border-color: var(--accent); }

.header-avatar { flex-shrink: 0; }
.group-avatar-grid {
  width: 42px; height: 42px; border-radius: 10px; overflow: hidden;
  display: grid; grid-template-columns: 1fr 1fr; gap: 1px;
  background: rgba(255,255,255,0.5);
}
.group-avatar-cell {
  background-size: cover; background-position: center;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 10px; font-weight: 600;
  min-height: 20px;
}

/* ── 消息区 ── */
.message-list {
  flex:1; overflow-y:auto; padding:16px 24px;
  background: transparent;
}
.msg-list-inner { display:flex; flex-direction:column; gap:4px; }

.message { display:flex; margin:3px 0; align-items:flex-end; gap:8px; }
.message.user { flex-direction:row-reverse; }
.message.assistant { flex-direction:row; }

.msg-avatar {
  width:42px; height:42px; border-radius:50%; flex-shrink:0;
  background-size:cover; background-position:center;
  display:flex; align-items:center; justify-content:center;
  /* 顶部对齐：文字+图片同属一条消息时，头像跟着第一行而不是沉到图片底部 */
  align-self:flex-start;
}
.msg-same-role .msg-avatar { opacity: 0; pointer-events: none; }
.avatar-fallback { color:#fff; font-size:14px; font-weight:700; user-select:none; }

.msg-col { display:flex; flex-direction:column; max-width:75%; }
.message.user .msg-col { align-items:flex-end; }
.speaker-name { font-size:11px; color:var(--text-secondary); margin:0 4px 3px; user-select:none; }

.msg-bubble {
  padding:10px 14px; border-radius:8px;
  font-size:14px; line-height:1.6; word-break:break-word;
  width: fit-content;
}
.message.user .msg-bubble { background:#a25740; color:#e8e8e8; }
.message.assistant .msg-bubble { background:var(--bg-secondary); color:var(--text-primary); border:1px solid var(--border); }
.msg-text { font-size:14px; line-height:1.6; white-space:pre-wrap; }

.msg-images { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
/* 与私聊 ImageGenBubble 的 .igb-img 对齐 */
.msg-image {
  max-width: min(600px, 70vw); max-height: min(800px, 60vh);
  width: auto; height: auto;
  border-radius: 20px; cursor: pointer; object-fit: contain;
}

.gc-empty { text-align:center; color:var(--text-secondary); font-size:13px; padding:60px 0; }

/* 时间分隔符（与私聊 .time-divider 同款） */
.time-divider { text-align:center; padding:16px 0 8px; font-size:12px; color:var(--text-secondary); user-select:none; }

/* ── 输入区 ── */
.input-area {
  position: relative;
  padding:8px 24px;
  padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
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

.send-btn {
  width: 42px; height: 42px; flex-shrink: 0;
  border-radius: 50%;
  font-size: 0;
  background: linear-gradient(135deg, var(--accent) 0%, #d06e5e 100%);
  color: #fff;
  border: none; padding: 0;
  opacity: 1; cursor: pointer;
  position: relative;
  display: flex; align-items: center; justify-content: center;
  box-shadow:
    0 2px 8px rgba(224, 123, 108, 0.22),
    0 0 0 0 rgba(224, 123, 108, 0);
  transition:
    opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease, transform 0.2s ease;
  touch-action: manipulation;
  -webkit-touch-callout: none;
}
.send-icon { width: 18px; height: 18px; display: block; transition: transform 0.2s ease; }
.send-btn:not(.send-disabled):hover {
  box-shadow:
    0 4px 18px rgba(224, 123, 108, 0.35),
    0 0 32px rgba(224, 123, 108, 0.10);
  transform: scale(1.06);
}
.send-btn:not(.send-disabled):active { transform: scale(0.94); }
.send-btn.send-disabled { opacity: 0.35; box-shadow: none; cursor: default; }

/* @点名面板 */
.mention-panel {
  position: absolute; bottom: calc(100% + 4px); left: 24px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border);
  border-radius: 14px; padding: 6px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.12);
  z-index: 20;
  max-height: 240px; overflow-y: auto;
}
.mention-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px 8px 8px; border-radius: 10px;
  font-size: 14px; color: var(--text-primary); cursor: pointer;
}
.mention-item:hover { background: rgba(0,0,0,0.05); }
.mention-avatar {
  width: 28px; height: 28px; border-radius: 50%;
  color: #fff; font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

/* ── 群设置抽屉 ── */
.gc-drawer-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.35);
  display: flex; justify-content: flex-end;
}
.gc-drawer {
  width: min(480px, 94vw); height: 100%;
  background: rgba(255,255,255,0.97);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  padding: 24px 20px;
  padding-top: calc(24px + env(safe-area-inset-top, 0px));
  overflow: hidden;
  display: flex; flex-direction: column; gap: 16px;
  transition: transform 0.22s ease;
}
.gc-drawer h3 { margin: 0 0 4px; font-size: 17px; color: var(--text-bright); }
.gc-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-secondary); }
.gc-field input[type="text"] {
  border: 1px solid rgba(0,0,0,0.1); border-radius: 10px;
  padding: 9px 12px; font-size: 14px; outline: none;
  background: rgba(255,255,255,0.8);
  color: var(--text-bright);
}
.gc-member-title {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 13px; color: var(--text-secondary);
}
.gc-member-field { flex: 1; min-height: 0; }
.gc-member-edit {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 8px;
  flex: 1; min-height: 160px; overflow-y: auto;
  border: 1px solid rgba(224,123,108,0.14); border-radius: 12px; padding: 8px;
  scrollbar-width: thin; scrollbar-color: rgba(224,123,108,0.35) transparent;
}
.gc-member-check {
  min-width: 0; min-height: 92px; padding: 9px 5px 8px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
  border: 1px solid #eee9e7; border-radius: 12px; background: #fff; cursor: pointer;
  font-size: 12px; color: var(--text-primary); transition: all 0.15s ease;
}
.gc-member-check:hover { background: #fff8f6; border-color: rgba(224,123,108,0.4); }
.gc-member-check.picked {
  background: rgba(224,123,108,0.1); border-color: var(--accent);
  box-shadow: inset 0 0 0 1px rgba(224,123,108,0.12);
}
.gc-member-check span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gc-member-avatar {
  width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background-size: cover; background-position: center;
  color: #fff; font-size: 16px; font-weight: 600;
}
.gc-member-hint { font-size: 12px; color: var(--text-secondary); }
.gc-record-actions { flex-shrink: 0; }
.gc-drawer-actions { display: flex; gap: 10px; flex-shrink: 0; }
.gc-btn {
  flex: 1; padding: 11px 0; border-radius: 12px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.gc-btn-primary { background: var(--accent); color: #fff; }
.gc-btn-primary:hover { background: var(--accent-hover); }
.gc-btn-primary:disabled { opacity: 0.45; cursor: default; }
.gc-btn-undo {
  width: 100%; background: #fff; color: var(--accent);
  border: 1px solid rgba(224,123,108,0.42);
}
.gc-btn-undo:hover:not(:disabled) { background: rgba(224,123,108,0.08); }
.gc-btn-undo:disabled { opacity: 0.42; cursor: default; }
.gc-btn-danger { background: rgba(255, 77, 79, 0.12); color: var(--danger, #ff4d4f); }

.drawer-enter-active, .drawer-leave-active { transition: opacity 0.22s ease; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .gc-drawer, .drawer-leave-to .gc-drawer { transform: translateX(40px); }

/* ── 移动端（与私聊断点一致） ── */
@media (max-width: 767px) {
  .chat-header { padding: 12px 16px; }
  .message-list { padding: 5px 10px; }
  .input-area { padding: 8px 16px; padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)); }
  .mention-panel { left: 16px; }
}
</style>
