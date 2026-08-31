<template>
  <div class="chat-view">
    <!-- 头部（与私聊 chat-header 同款） -->
    <div class="chat-header">
      <linshe-button v-if="isMobile" variant="icon" class="btn-mobile-back" @click="toggleMobileSidebar" title="角色列表">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
      </linshe-button>
      <div class="group-avatar-grid header-avatar">
        <div
          v-for="m in (store.activeGroup?.members || []).slice(0, 4)"
          :key="m.id"
          class="group-avatar-cell avatar-clickable"
          :style="m.avatar_path ? {} : { background: '#e07b6c' }"
          @click.stop="openAvatarMenu(m, $event)"
        >
          <img v-if="m.avatar_path" :src="m.avatar_path" class="group-avatar-img" alt="" />
          <span v-else>{{ m.display_name.charAt(0) }}</span>
        </div>
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
    <div class="message-area">
      <div
        ref="scrollEl"
        class="message-list"
        @scroll="onMessageScroll"
        @wheel="onUserScrollIntent"
        @touchstart="onUserScrollIntent"
        @pointerdown="onUserScrollIntent"
      >
        <div v-if="store.hasMoreOlder" class="load-older load-older-hint">↑ 向上滚动加载更多</div>

        <div ref="msgListInner" class="msg-list-inner">
          <template v-for="(msg, idx) in store.visibleMessages" :key="msg.id">
          <!-- 时间分隔符（与私聊同款：间隔超 10 分钟显示） -->
          <div v-if="showTimeDivider(idx)" class="time-divider">{{ timeLabel(msg.created_at) }}</div>
          <div
            class="message"
            :class="[msg.role === 'user' ? 'user' : 'assistant', { 'msg-same-role': isSameSpeaker(idx) }]"
          >
          <div
            class="msg-avatar"
            :class="{ 'avatar-clickable': msg.role !== 'user' && memberOf(msg) }"
            :style="msg.role === 'user' ? userAvatarStyle : speakerAvatarStyle(msg)"
            @click="openMsgAvatarMenu(msg, $event)"
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
                :class="{ 'msg-emoji-img': isEmojiSticker(url) }"
                @click="onImageClick(url)"
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

      <Transition name="new-message">
        <div
          v-if="hasNewMessages"
          role="button"
          tabindex="0"
          class="new-message-bubble"
          aria-label="有新消息，回到底部"
          @keydown.enter.prevent="returnToLatest"
          @keydown.space.prevent="returnToLatest"
          @click="returnToLatest"
        >
          <span>有新消息</span>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </Transition>
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
      <div
        role="button"
        tabindex="0"
        class="send-btn"
        :class="{ 'is-disabled': !draft.trim() }"
        :aria-disabled="!draft.trim()"
        @keydown.enter.prevent="onSendClick"
        @keydown.space.prevent="onSendClick"
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
      </div>
    </div>

    <!-- 图片预览 -->
    <ImageLightbox
      :visible="!!previewUrl"
      :imgs="previewUrl || ''"
      @hide="previewUrl = null"
      @update:visible="v => { if (!v) previewUrl = null }"
      @deleted="onGroupImageDeleted"
    />

    <!-- 群设置抽屉 -->
    <Transition name="drawer">
      <div v-if="showSettings" class="gc-drawer-overlay" @click.self="showSettings = false">
        <div class="gc-drawer">
          <h3>群设置</h3>
          <label class="gc-field">
            <span>群名称</span>
            <linshe-input v-model="editName" type="text" maxlength="24" />
          </label>
          <label class="gc-field">
            <span>群主题</span>
            <linshe-input v-model="editTopic" type="text" maxlength="60" placeholder="（可选）大家围绕什么话题聊" />
          </label>
          <div class="gc-field">
            <div class="gc-member-title">
              <span>温度设置</span>
              <span class="gc-temp-val">{{ Number(editTemperature).toFixed(1) }}</span>
            </div>
            <input
              class="gc-range"
              type="range" min="0.5" max="1.2" step="0.1"
              v-model.number="editTemperature"
              @change="onTemperatureChange"
            />
            <span class="gc-member-hint">群聊生成温度（所有群共享），越低越稳定、越高越有创意，默认 0.7。</span>
          </div>
          <div class="gc-field">
            <div class="gc-member-title">
              <span>携带上下文消息记忆轮数</span>
              <span class="gc-temp-val">{{ editSummaryInterval }} 轮</span>
            </div>
            <input
              class="gc-range"
              type="range" min="2" max="6" step="1"
              v-model.number="editSummaryInterval"
              @change="onSummaryIntervalChange"
            />
            <span class="gc-member-hint">达到设置轮数之后将上下文压缩成总结，默认 4 轮。</span>
          </div>
          <div class="gc-field gc-member-field">
            <div class="gc-member-title">
              <span>群成员</span>
              <span>{{ editMemberIds.length }} / {{ sortedCharacters.length }}</span>
            </div>
            <div class="gc-member-edit">
              <div
                v-for="c in sortedCharacters"
                :key="c.id"
                role="button"
                tabindex="0"
                class="gc-member-check"
                :class="{ picked: editMemberIds.includes(c.id) }"
                :aria-pressed="editMemberIds.includes(c.id)"
                @keydown.enter.prevent="toggleMember(c.id)"
                @keydown.space.prevent="toggleMember(c.id)"
                @click="toggleMember(c.id)"
              >
                <div
                  class="gc-member-avatar"
                  :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})` } : { background: '#e07b6c' }"
                >{{ c.avatar_path ? '' : c.display_name.charAt(0) }}</div>
                <span>{{ c.display_name }}</span>
              </div>
            </div>
            <span class="gc-member-hint">至少选择 2 位角色</span>
          </div>
          <div class="gc-record-actions">
            <linshe-button
              class="gc-btn gc-btn-undo"
              variant="secondary"
              :disabled="!canUndo"
              @click="requestUndoLastRound"
            >撤回上一轮对话</linshe-button>
          </div>
          <div class="gc-drawer-actions">
            <linshe-button class="gc-btn" variant="danger" @click="onDissolve">解散群聊</linshe-button>
            <linshe-button class="gc-btn" variant="primary" :disabled="editMemberIds.length < 2" @click="onSaveSettings">保存</linshe-button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 点头像弹出的成员操作小窗 -->
    <Teleport to="body">
      <Transition name="avatar-pop">
        <div v-if="avatarMenu" class="avatar-pop-layer" @click.self="avatarMenu = null">
          <div class="avatar-pop-card" :style="avatarMenuStyle" role="dialog" aria-label="成员操作">
            <div class="avatar-pop-head">
              <div class="avatar-pop-avatar" :style="memberAvatarStyle(avatarMenu.member)">
                <span v-if="!avatarMenu.member.avatar_path" class="avatar-pop-fallback">{{ avatarMenu.member.display_name?.charAt(0) || '?' }}</span>
              </div>
              <div class="avatar-pop-info">
                <div class="avatar-pop-name">{{ avatarMenu.member.display_name }}</div>
                <div class="avatar-pop-sub">群聊成员</div>
              </div>
            </div>
            <div class="avatar-pop-actions">
              <div class="avatar-pop-btn" role="button" tabindex="0" @keydown.enter.prevent="startPrivateChat(avatarMenu.member)" @keydown.space.prevent="startPrivateChat(avatarMenu.member)" @click="startPrivateChat(avatarMenu.member)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span>私聊</span>
              </div>
              <div class="avatar-pop-btn" role="button" tabindex="0" @keydown.enter.prevent="viewMemberMoments(avatarMenu.member)" @keydown.space.prevent="viewMemberMoments(avatarMenu.member)" @click="viewMemberMoments(avatarMenu.member)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
                <span>查看ta的朋友圈</span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGroupsStore } from '../stores/groups.js'
import { useChatStore } from '../stores/chat.js'
import { useMomentsStore } from '../stores/moments.js'
import { getConfig, updateGroupSummaryInterval, updateGroupTemperature } from '../api/index.js'
import { userAvatar, loadUserAvatar } from '../userConfig.js'
import ImageLightbox from '../components/ImageLightbox.vue'
import ImageGenBubble from '../components/ImageGenBubble.vue'
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheInput from '../components/ui/LinsheInput.vue'

const route = useRoute()
const router = useRouter()
const store = useGroupsStore()
const chat = useChatStore()
const momentsStore = useMomentsStore()
const confirmFn = inject('confirm', null)
const toast = inject('toast', null)

const scrollEl = ref(null)
const msgListInner = ref(null)
const inputEl = ref(null)
const draft = ref('')
const showMentionPicker = ref(false)
const showSettings = ref(false)
const previewUrl = ref(null)
const isFollowingLatest = ref(true)
const hasNewMessages = ref(false)
const avatarMenu = ref(null)

const editName = ref('')
const editTopic = ref('')
const editMemberIds = ref([])
const editTemperature = ref(0.7)
const editSummaryInterval = ref(4)
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
    || chat.characters.find(c => c.id === msg.speaker_character_id)
    || null
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
// 表情包贴纸（/images/emoji/）按 140px 渲染，与私聊 .msg-sticker-img 同款
function isEmojiSticker(url) {
  return typeof url === 'string' && url.includes('/images/emoji/')
}
// 表情包与私聊一致不可点击放大，仅普通图片打开大图预览
function onImageClick(url) {
  if (isEmojiSticker(url)) return
  previewUrl.value = url
}

const AVATAR_POP_W = 320
const AVATAR_POP_H = 168
const avatarMenuStyle = computed(() => {
  const menu = avatarMenu.value
  if (!menu) return {}
  const gap = 12
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  let left = Math.min(menu.x + gap, viewportW - AVATAR_POP_W - gap)
  let top = menu.y + gap
  if (top + AVATAR_POP_H > viewportH - gap) top = menu.y - AVATAR_POP_H - gap
  left = Math.max(gap, Math.min(left, viewportW - AVATAR_POP_W - gap))
  top = Math.max(gap, Math.min(top, viewportH - AVATAR_POP_H - gap))
  return { left: `${left}px`, top: `${top}px` }
})

function memberAvatarStyle(member) {
  return member?.avatar_path
    ? { backgroundImage: `url(${member.avatar_path})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: '#e07b6c' }
}

function openAvatarMenu(member, event) {
  if (!member?.id) return
  avatarMenu.value = { member, x: event?.clientX ?? 0, y: event?.clientY ?? 0 }
}

function openMsgAvatarMenu(msg, event) {
  const member = memberOf(msg)
  if (member) openAvatarMenu(member, event)
}

function startPrivateChat(member) {
  avatarMenu.value = null
  router.push(`/chat/${member.id}`)
}

function viewMemberMoments(member) {
  avatarMenu.value = null
  momentsStore.setFilter(member.id)
  router.push({ path: '/moments', query: { character_id: member.id } })
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
}

function onGroupImageDeleted(deletedUrl) {
  const base = String(deletedUrl || '').replace(/\?.*$/, '')
  if (!base) return
  for (const msg of store.messages) {
    if (!Array.isArray(msg.images)) continue
    msg.images = msg.images.filter(img => {
      const url = typeof img === 'string' ? img : img?.url
      return !url || url.replace(/\?.*$/, '') !== base
    })
  }
  previewUrl.value = null
}
/** 连续同一发言人 → 隐藏头像和名字（与私聊 msg-same-role 一致）；跨时间分隔符时重新显示 */
function isSameSpeaker(idx) {
  if (idx === 0) return false
  if (showTimeDivider(idx)) return false
  const cur = store.visibleMessages[idx]
  const prev = store.visibleMessages[idx - 1]
  return cur.role === prev.role && cur.speaker_character_id === prev.speaker_character_id
}

// ── 时间分隔符（与私聊同款规则：相邻消息间隔超 10 分钟显示一条时间） ──

function showTimeDivider(idx) {
  const cur = store.visibleMessages[idx]
  if (!cur?.created_at) return false
  if (idx === 0) return true
  const prev = store.visibleMessages[idx - 1]
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
  isFollowingLatest.value = true
  hasNewMessages.value = false
  await store.loadGroups()
  await store.selectGroup(parseInt(id, 10))
  scrollToBottom(true)   // 进群直接定位底部，不要缓动
  setupResizeObserver()  // 与私聊一致：历史图片异步加载撑高列表时自动追底
  armLullTimer()
}

let observedMessageCount = 0

watch(() => route.params.id, (id) => { if (route.path.startsWith('/group/')) enterGroup(id) })
watch(() => store.scrollSignal, () => {
  const messageCount = store.messages.length
  const receivedNewMessage = messageCount > observedMessageCount
  observedMessageCount = messageCount
  if (isFollowingLatest.value) scrollToBottom()
  else if (receivedNewMessage) hasNewMessages.value = true
  armLullTimer()
})

watch(showSettings, (open) => {
  if (open && store.activeGroup) {
    editName.value = store.activeGroup.name
    editTopic.value = store.activeGroup.topic || ''
    editMemberIds.value = store.activeGroup.members.map(m => m.id)
    loadGroupTemperature()
    loadGroupSummaryInterval()
  }
})

// ── 温度设置（全局共享，写入 system_settings） ──

let temperatureLoading = false

async function loadGroupTemperature() {
  if (temperatureLoading) return
  temperatureLoading = true
  try {
    const cfg = await getConfig()
    const t = cfg?.groupChat?.temperature
    if (typeof t === 'number') editTemperature.value = Math.max(0.5, Math.min(1.2, t))
  } catch { /* 拉取失败保留当前值 */ }
  finally { temperatureLoading = false }
}

async function onTemperatureChange() {
  const v = Math.max(0.5, Math.min(1.2, Number(editTemperature.value) || 0.7))
  editTemperature.value = v
  try {
    const res = await updateGroupTemperature(v)
    if (typeof res?.temperature === 'number') editTemperature.value = res.temperature
    toast?.('温度设置已保存', 'success')
  } catch (err) {
    toast?.(err.message || '温度设置保存失败', 'error')
  }
}

// ── 记忆总结轮次（全局共享，写入 system_settings） ──

let summaryIntervalLoading = false

async function loadGroupSummaryInterval() {
  if (summaryIntervalLoading) return
  summaryIntervalLoading = true
  try {
    const cfg = await getConfig()
    const n = cfg?.groupChat?.summaryInterval
    if (Number.isInteger(n)) editSummaryInterval.value = Math.max(2, Math.min(6, n))
  } catch { /* 拉取失败保留当前值 */ }
  finally { summaryIntervalLoading = false }
}

async function onSummaryIntervalChange() {
  const v = Math.max(2, Math.min(6, Math.round(Number(editSummaryInterval.value) || 4)))
  editSummaryInterval.value = v
  try {
    const res = await updateGroupSummaryInterval(v)
    if (Number.isInteger(res?.summaryInterval)) editSummaryInterval.value = res.summaryInterval
    toast?.('记忆总结轮次已保存', 'success')
  } catch (err) {
    toast?.(err.message || '记忆总结轮次保存失败', 'error')
  }
}

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
  clearTimeout(autoScrollTimer)
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
const BOTTOM_THRESHOLD = 16
let autoScrollTimer = null
let isAutoScrolling = false

function isNearBottom(el = scrollEl.value) {
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD
}

function syncFollowingState() {
  const atBottom = isNearBottom()
  isFollowingLatest.value = atBottom
  if (atBottom) hasNewMessages.value = false
}

function onMessageScroll() {
  if (isAutoScrolling) return
  syncFollowingState()

  const el = scrollEl.value
  if (el?.scrollTop < 40 && store.hasMoreOlder) {
    const prevHeight = el.scrollHeight
    store.expandWindow()
    nextTick(() => {
      if (scrollEl.value) scrollEl.value.scrollTop += scrollEl.value.scrollHeight - prevHeight
    })
  }
}

function onUserScrollIntent() {
  isAutoScrolling = false
  clearTimeout(autoScrollTimer)
  autoScrollTimer = null
  requestAnimationFrame(syncFollowingState)
}

function returnToLatest() {
  isFollowingLatest.value = true
  hasNewMessages.value = false
  scrollToBottom()
}

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
        // 必须用变化前的高度判断：进群时异步内容撑高，不等于用户主动离开底部。
        const distBefore = lastObservedSH - el2.scrollTop - el2.clientHeight
        lastObservedSH = newSH
        if (distBefore > BOTTOM_THRESHOLD) return
        isFollowingLatest.value = true
        hasNewMessages.value = false
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
    isAutoScrolling = true
    clearTimeout(autoScrollTimer)
    autoScrollTimer = null
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (force || reduceMotion) {
      el.scrollTop = el.scrollHeight
      // 首次渲染的字体/图片可能在同一帧继续改变高度，再校正一次后才开放用户滚动判定。
      autoScrollTimer = setTimeout(() => {
        if (!isAutoScrolling) return
        el.scrollTop = el.scrollHeight
        isAutoScrolling = false
        autoScrollTimer = null
        syncFollowingState()
      }, force ? 50 : 0)
      return
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    autoScrollTimer = setTimeout(() => {
      isAutoScrolling = false
      autoScrollTimer = null
      syncFollowingState()
    }, 450)
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
  isFollowingLatest.value = true
  hasNewMessages.value = false
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
  if (!draft.value.trim()) return
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
    if (!result?.deleted) toast?.('当前没有可撤回的群聊记录', 'warning')
    showSettings.value = false
    scrollToBottom(true)
    armLullTimer()
  } catch (err) {
    toast?.(err.message || '撤回失败，请稍后重试', 'error')
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
    toast?.('群聊至少保留 2 个角色成员', 'warning')
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
}

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
.group-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* ── 消息区 ── */
.message-area { position:relative; flex:1; min-height:0; }
.message-list {
  box-sizing:border-box; width:100%; height:100%; overflow-y:auto; padding:16px 24px;
  background: transparent;
}
.msg-list-inner { display:flex; flex-direction:column; gap:4px; }
.load-older { text-align:center; padding:8px 0; font-size:12px; color:var(--text-secondary); user-select:none; }
.load-older-hint { opacity:0.6; }

.new-message-bubble {
  position:absolute; right:24px; bottom:16px; z-index:10;
  min-height:44px; padding:0 14px 0 16px;
  display:flex; align-items:center; justify-content:center; gap:6px;
  border:1px solid rgba(224,123,108,0.34); border-radius:22px;
  background:rgba(255,255,255,0.96); color:var(--accent);
  box-shadow:0 6px 22px rgba(92,55,45,0.16);
  font-size:13px; font-weight:600; cursor:pointer;
  backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
  transition:background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
  user-select: none;
}
.new-message-bubble:hover { background:#fff8f6; border-color:var(--accent); box-shadow:0 8px 26px rgba(92,55,45,0.2); }
.new-message-bubble:active { transform:scale(0.96); }
.new-message-bubble:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.new-message-enter-active, .new-message-leave-active { transition:opacity 0.2s ease, transform 0.2s ease; }
.new-message-enter-from, .new-message-leave-to { opacity:0; transform:translateY(8px); }

.message { display:flex; margin:3px 0; align-items:flex-start; gap:8px; }
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
.avatar-clickable { cursor:pointer; transition:filter 0.15s ease, transform 0.15s ease; }
.avatar-clickable:hover { filter:brightness(0.93); }
.avatar-clickable:active { transform:scale(0.96); }

/* ── 点头像弹出的成员操作小窗 ── */
.avatar-pop-layer {
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(28, 20, 16, 0.14);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.avatar-pop-card {
  position: fixed; width: 320px; max-width: calc(100vw - 24px); min-height: 150px;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  box-shadow: 0 14px 42px rgba(60, 34, 25, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.04);
  padding: 14px;
}
.avatar-pop-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
.avatar-pop-avatar {
  width: 48px; height: 48px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background-size: cover; background-position: center;
  color: #fff;
}
.avatar-pop-fallback { font-size: 17px; font-weight: 700; user-select: none; }
.avatar-pop-info { min-width: 0; }
.avatar-pop-name {
  font-size: 15px; font-weight: 600; color: var(--text-bright);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.avatar-pop-sub { font-size: 11px; color: var(--text-secondary); margin-top: 3px; }
.avatar-pop-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.avatar-pop-btn {
  min-height: 42px; padding: 8px 4px;
  display: flex; align-items: center; justify-content: center; gap: 5px;
  border: 1px solid rgba(224, 123, 108, 0.26); border-radius: 12px;
  background: #fff; color: var(--text-primary);
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
  user-select: none;
}
.avatar-pop-btn:hover { background: #fff8f6; border-color: var(--accent); color: var(--accent); }
.avatar-pop-btn:active { transform: scale(0.97); }
.avatar-pop-btn svg { width: 16px; height: 16px; flex-shrink: 0; }
.avatar-pop-enter-active, .avatar-pop-leave-active { transition: opacity 0.16s ease, transform 0.16s ease; }
.avatar-pop-enter-from, .avatar-pop-leave-to { opacity: 0; transform: translateY(-4px) scale(0.97); }


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
/* 表情包贴纸高度固定 140px，宽度随图片比例自适应，与私聊 .msg-sticker-img 同款；不可点击放大 */
.msg-image.msg-emoji-img { height:140px; width:auto; max-width:none; max-height:none; border-radius:8px; cursor:default; }

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
  user-select: none;
}
.send-icon { width: 18px; height: 18px; display: block; transition: transform 0.2s ease; }
.send-btn:not(.is-disabled):hover {
  box-shadow:
    0 4px 18px rgba(224, 123, 108, 0.35),
    0 0 32px rgba(224, 123, 108, 0.10);
  transform: scale(1.06);
}
.send-btn:not(.is-disabled):active { transform: scale(0.94); }
.send-btn.is-disabled { opacity: 0.35; box-shadow: none; cursor: default; }

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
  user-select: none;
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
.gc-temp-val { font-size: 13px; font-weight: 600; color: var(--accent); }
.gc-range {
  width: 100%; height: 6px; margin: 4px 0 2px;
  -webkit-appearance: none; appearance: none;
  border-radius: 999px;
  background: linear-gradient(90deg, #f0d5cd, var(--accent));
  outline: none; cursor: pointer;
}
.gc-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 18px; height: 18px; border-radius: 50%;
  background: #fff; border: 2px solid var(--accent);
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}
.gc-range::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: #fff; border: 2px solid var(--accent);
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}
.gc-record-actions { flex-shrink: 0; }
.gc-drawer-actions { display: flex; gap: 10px; flex-shrink: 0; }
.gc-btn {
  flex: 1; padding: 11px 0;
}
.gc-btn-undo {
  width: 100%;
}

.drawer-enter-active, .drawer-leave-active { transition: opacity 0.22s ease; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .gc-drawer, .drawer-leave-to .gc-drawer { transform: translateX(40px); }

/* ── 移动端（与私聊断点一致） ── */
@media (max-width: 767px) {
  .chat-header { padding: 12px 16px; }
  .message-list { padding: 5px 10px; }
  .new-message-bubble { right:14px; bottom:12px; }
  .input-area { padding: 8px 16px; padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)); }
  .mention-panel { left: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .new-message-bubble,
  .new-message-enter-active,
  .new-message-leave-active { transition:none; }
}
</style>
