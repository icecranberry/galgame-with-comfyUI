<template>
  <aside class="sidebar" :class="{ 'mobile-open': isMobile && mobileOpen }">
    <div ref="charListEl" class="char-list">
      <!-- 群聊分区 -->
      <div class="group-section-header">
        <span>群聊</span>
        <div class="group-create-btn" role="button" tabindex="0" title="发起群聊" aria-label="发起群聊" @click.stop="openCreateGroup" @keydown.enter.prevent="openCreateGroup" @keydown.space.prevent="openCreateGroup">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </div>
      </div>
      <div
        v-for="g in groups.groups"
        :key="'g' + g.id"
        class="char-item"
        :class="{ active: g.id === groups.activeGroupId && route.path.startsWith('/group') }"
        @click="onGroupClick(g)"
      >
        <div class="char-avatar-wrap">
          <div class="group-avatar-grid">
            <div
              v-for="m in g.members.slice(0, 4)"
              :key="m.id"
              class="group-avatar-cell"
              :style="m.avatar_path ? { backgroundImage: `url(${m.avatar_path})` } : { background: '#e07b6c' }"
            >{{ m.avatar_path ? '' : m.display_name.charAt(0) }}</div>
          </div>
        </div>
        <div class="char-info">
          <div class="char-name">{{ g.name }}</div>
          <div class="char-preview">{{ g.last_message || '暂无消息' }}</div>
        </div>
        <div class="char-meta">
          <span class="char-time">{{ formatTime(g.last_message_at) }}</span>
        </div>
        <span v-if="g.unread > 0" class="proactive-dot"></span>
      </div>

      <div v-if="groups.groups.length > 0" class="group-section-header"><span>角色</span></div>
      <div
        v-for="c in chat.characters"
        :key="c.id"
        class="char-item"
        :class="{ active: c.id === chat.activeCharId && route.path.startsWith('/chat') }"
        @click="onCharClick(c)"
      >
        <div class="char-avatar-wrap">
          <div
            class="char-avatar"
            :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: '#e07b6c' }"
          >{{ c.avatar_path ? '' : c.display_name.charAt(0) }}</div>
        </div>
        <div class="char-info">
          <div class="char-name">{{ c.display_name }}</div>
          <div class="char-schedule" v-if="scheduleMap[c.id]">{{ scheduleMap[c.id] }}</div>
          <div class="char-preview">{{ c.last_message || '点击开始对话' }}</div>
        </div>
        <div class="char-meta">
          <span class="char-time">{{ formatTime(c.last_message_at) }}</span>
        </div>
        <span v-if="proactive.hasUnread(c.id)" class="proactive-dot"></span>
      </div>

      <!-- 新手引导：仅剩默认助手时显示，点击前往酒馆创建角色 -->
      <div
        v-if="chat.characters.length === 1"
        role="button"
        tabindex="0"
        class="char-onboard"
        @click="goTavern"
        @keydown.enter.prevent="goTavern"
        @keydown.space.prevent="goTavern"
      >
        <span class="char-onboard-icon">
          <svg viewBox="0 0 1024 1024" width="18" height="18" fill="currentColor">
            <path d="M924.4 85.5H100.9c-19.3 0-35 15.7-35 35s15.7 35 35 35h59.7v790.2l348.7-179.8 355.3 179.2V155.5h59.7c19.3 0 35-15.7 35-35 0.1-19.4-15.6-35-34.9-35zM794.7 831.4L509 687.3 230.6 830.8V155.5h564.1v675.9z"/>
            <path d="M416.8 489.1h60.8v60.8c0 19.3 15.7 35 35 35s35-15.7 35-35v-60.8h60.8c19.3 0 35-15.7 35-35s-15.7-35-35-35h-60.8v-60.8c0-19.3-15.7-35-35-35s-35 15.7-35 35v60.8h-60.8c-19.3 0-35 15.7-35 35s15.7 35 35 35z"/>
          </svg>
        </span>
        <span class="char-onboard-text">
          <span class="char-onboard-title">移步酒馆</span>
          <span class="char-onboard-desc">完善你的设定，邀请更多伙伴前来</span>
        </span>
        <svg class="char-onboard-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/>
        </svg>
      </div>

      <div v-if="chat.characters.length === 0" class="char-empty">
        加载中...
      </div>
    </div>

    <!-- 移动端底部：朋友圈 + 奇遇 + 更多 -->
    <div v-if="isMobile" class="sidebar-footer">
      <div class="footer-nav-btn" :class="{ active: $route.path === '/moments' }" @click="onMomentsClick">
        <div class="nav-icon-wrap">
          <svg viewBox="0 0 1024 1024" width="18" height="18" fill="currentColor">
            <path d="M679.17 398.982V126.497s-133.338-71.481-288.989-16.366l288.99 288.851z m25.245 160.303V137.748s157.63 71.434 202.052 244.963L704.415 559.285z m-84.8 122.527l290.99-273.649s51.488 83.709-25.293 273.649H619.614z m-148.586 34.695h393.014S816.6 845.102 646.788 898.195L471.03 716.507z m-128.293-86.811v256.18s102.072 65.365 276.878 21.477L342.736 629.696z m-227.366 13.25l199.075-178.62v406.207c0-0.001-120.272-41.75-199.075-227.587z m-5.045-28.57S64.787 467.442 128.48 339.824h273.81L110.326 614.377z m35.357-303.193s57.603-130.594 214.21-191.87l186.894 191.87H145.682z" />
          </svg>
          <span v-if="moments.newPostCount > 0" class="nav-dot">{{ moments.newPostCount > 99 ? '99+' : moments.newPostCount }}</span>
        </div>
        <span>朋友圈</span>
      </div>
      <div class="footer-nav-btn" :class="{ active: $route.path === '/events' }" @click="onEventsClick">
        <div class="nav-icon-wrap">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
          </svg>
          <span v-if="events.newEventCount > 0" class="nav-dot">{{ events.newEventCount > 99 ? '99+' : events.newEventCount }}</span>
        </div>
        <span>奇遇</span>
      </div>
      <div class="footer-more-btn" role="button" tabindex="0" @click="showMoreMenu = !showMoreMenu" @keydown.enter.prevent="showMoreMenu = !showMoreMenu" @keydown.space.prevent="showMoreMenu = !showMoreMenu">
        <svg viewBox="0 0 1024 1024" width="22" height="22" fill="currentColor">
          <path d="M436 128H168a40 40 0 0 0-40 40v268a40 40 0 0 0 40 40h268a40 40 0 0 0 40-40V168a40 40 0 0 0-40-40z m-32 276H200V200h204z m32 144H168a40 40 0 0 0-40 40v268a40 40 0 0 0 40 40h268a40 40 0 0 0 40-40V588a40 40 0 0 0-40-40z m-32 276H200V620h204z m452-276H588a40 40 0 0 0-40 40v268a40 40 0 0 0 40 40h268a40 40 0 0 0 40-40V588a40 40 0 0 0-40-40z m-32 276H620V620h204zM716 118c-104.9 0-190 85.1-190 190s85.1 190 190 190 190-85.1 190-190-85.1-190-190-190z m83.4 273.4A117.8 117.8 0 1 1 834 308a117 117 0 0 1-34.6 83.4z"/>
        </svg>
      </div>
    </div>

    <!-- 更多菜单弹窗 -->
    <Transition name="menu-slide">
      <div v-if="showMoreMenu" class="more-menu-overlay" @click.self="showMoreMenu = false">
        <div class="more-menu-panel">
          <router-link to="/tavern" class="more-menu-item" @click="onMenuItemClick">
            <svg viewBox="0 0 1024 1024" width="20" height="20" fill="currentColor">
              <path d="M924.4 85.5H100.9c-19.3 0-35 15.7-35 35s15.7 35 35 35h59.7v790.2l348.7-179.8 355.3 179.2V155.5h59.7c19.3 0 35-15.7 35-35 0.1-19.4-15.6-35-34.9-35zM794.7 831.4L509 687.3 230.6 830.8V155.5h564.1v675.9z"/>
              <path d="M416.8 489.1h60.8v60.8c0 19.3 15.7 35 35 35s35-15.7 35-35v-60.8h60.8c19.3 0 35-15.7 35-35s-15.7-35-35-35h-60.8v-60.8c0-19.3-15.7-35-35-35s-35 15.7-35 35v60.8h-60.8c-19.3 0-35 15.7-35 35s15.7 35 35 35z"/>
            </svg>
            <span>酒馆</span>
          </router-link>
          <router-link to="/schedule" class="more-menu-item" @click="onMenuItemClick">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span>日程</span>
          </router-link>
          <router-link to="/gallery" class="more-menu-item" @click="onMenuItemClick">
            <svg viewBox="0 0 1024 1024" width="20" height="20" fill="currentColor">
              <path stroke="currentColor" stroke-width="20" d="M898.8 748.4c-11.9 0-21.5-9.6-21.5-21.5V254.1c0-23.7-19.3-43-43-43H189.7c-23.7 0-43 19.3-43 43v515.7c0 23.7 19.3 43 43 43h537.2c11.9 0 21.5 9.6 21.5 21.5s-9.6 21.5-21.5 21.5H189.7c-47.4 0-86-38.5-86-86V254.1c0-47.4 38.5-86 86-86h644.7c47.4 0 86 38.6 86 86v472.8c0 11.8-9.6 21.4-21.5 21.4z"/>
              <path stroke="currentColor" stroke-width="20" d="M742.1 849.5a21.3 21.3 0 0 1-15.2-6.3L311.5 427.8 139.5 571c-8.9 7.9-22.5 7.1-30.3-1.8-7.9-8.9-7.1-22.4 1.8-30.3l172-150.4c8.5-7.5 21.4-7.2 29.5 0.9l429.8 429.8c8.4 8.4 8.4 22 0 30.4zM914.2 741.9c-4.2 4.3-9.8 6.5-15.4 6.5-5.4 0-10.8-2-15-6.1L657.1 520.8l-121.9 121.9c-8.4 8.4-22 8.4-30.4 0s-8.4-22 0-30.4l137-137c8.3-8.3 21.8-8.4 30.2-0.2l221.8 213.5c8.5 8.3 8.7 21.9 0.4 30.3z"/>
            </svg>
            <span>相册</span>
          </router-link>
          <router-link to="/mailbox" class="more-menu-item" @click="onMenuItemClick">
            <div class="nav-icon-wrap">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M2 4L12 13L22 4"/>
              </svg>
              <span v-if="mailbox.unreadCount > 0" class="nav-dot">{{ mailbox.unreadCount > 99 ? '99+' : mailbox.unreadCount }}</span>
            </div>
            <span>信箱</span>
          </router-link>
          <router-link to="/settings" class="more-menu-item" @click="onMenuItemClick">
            <gear-icon :size="20" />
            <span>系统设置</span>
          </router-link>
        </div>
      </div>
    </Transition>

    <!-- 建群弹窗 -->
    <Transition name="menu-slide">
      <div v-if="showCreateGroup && isMobile" class="more-menu-overlay" @click.self="showCreateGroup = false">
        <div class="more-menu-panel create-group-panel">
          <h4 class="cg-title">发起群聊</h4>
          <input v-model="cgName" class="cg-input" type="text" maxlength="24" placeholder="群名称（留空自动生成）" />
          <input v-model="cgTopic" class="cg-input" type="text" maxlength="60" placeholder="群主题（可选）" />
          <div class="cg-members">
            <div
              v-for="c in sortedCgCharacters"
              :key="c.id"
              class="cg-member"
              :class="{ picked: cgMemberIds.includes(c.id) }"
              @click="toggleCgMember(c.id)"
            >
              <div
                class="cg-member-avatar"
                :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})` } : { background: '#e07b6c' }"
              >{{ c.avatar_path ? '' : c.display_name.charAt(0) }}</div>
              <span>{{ c.display_name }}</span>
            </div>
          </div>
          <linshe-button class="cg-submit" variant="primary" :disabled="cgMemberIds.length < 2 || cgSubmitting" @click="submitCreateGroup">
            {{ cgSubmitting ? '创建中…' : `创建群聊（已选 ${cgMemberIds.length} 人，至少 2 人）` }}
          </linshe-button>
        </div>
      </div>
    </Transition>

    <Teleport to="body">
      <Transition name="cg-pop">
        <div v-if="showCreateGroup && !isMobile" class="cg-overlay" @click.self="showCreateGroup = false">
          <section class="cg-dialog" role="dialog" aria-modal="true" aria-labelledby="create-group-title">
            <div class="cg-dialog-header">
              <h3 id="create-group-title" class="cg-dialog-title">发起群聊</h3>
              <linshe-button class="cg-close-btn" variant="icon" aria-label="关闭" @click="showCreateGroup = false">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </linshe-button>
            </div>

            <div class="cg-dialog-body">
              <div class="cg-form-col">
                <label class="cg-field">
                  <span class="cg-label">群名称</span>
                  <input v-model="cgName" class="cg-input cg-input-desktop" type="text" maxlength="24" placeholder="留空自动生成" />
                </label>
                <label class="cg-field">
                  <span class="cg-label">群主题</span>
                  <input v-model="cgTopic" class="cg-input cg-input-desktop" type="text" maxlength="60" placeholder="可选，比如今晚一起聊点轻松的" />
                </label>
              </div>

              <div class="cg-member-col">
                <div class="cg-member-head">
                  <span>选择成员</span>
                  <span>{{ cgMemberIds.length }} / {{ chat.characters.length }}</span>
                </div>
                <div class="cg-members cg-members-desktop">
                  <div
                    v-for="c in sortedCgCharacters"
                    :key="c.id"
                    role="button"
                    tabindex="0"
                    class="cg-member cg-member-desktop"
                    :class="{ picked: cgMemberIds.includes(c.id) }"
                    @click="toggleCgMember(c.id)"
                    @keydown.enter.prevent="toggleCgMember(c.id)"
                    @keydown.space.prevent="toggleCgMember(c.id)"
                  >
                    <div
                      class="cg-member-avatar"
                      :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})` } : { background: '#e07b6c' }"
                    >{{ c.avatar_path ? '' : c.display_name.charAt(0) }}</div>
                    <span>{{ c.display_name }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="cg-dialog-footer">
              <span class="cg-hint">至少选择 2 位角色</span>
              <div class="cg-actions">
                <linshe-button class="cg-cancel" variant="secondary" @click="showCreateGroup = false">取消</linshe-button>
                <linshe-button class="cg-submit cg-submit-desktop" variant="primary" :disabled="cgMemberIds.length < 2 || cgSubmitting" @click="submitCreateGroup">
                  {{ cgSubmitting ? '创建中...' : `创建群聊（已选 ${cgMemberIds.length} 人）` }}
                </linshe-button>
              </div>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, inject } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import { useMomentsStore } from '../stores/moments.js'
import { useEventsStore } from '../stores/events.js'
import { useProactiveStore } from '../stores/notifications.js'
import { useScheduleStore } from '../stores/schedule.js'
import { useMailboxStore } from '../stores/mailbox.js'
import { useGroupsStore } from '../stores/groups.js'
import LinsheButton from './LinsheButton.vue'
import GearIcon from './GearIcon.vue'

const props = defineProps({
  isMobile: { type: Boolean, default: false },
  mobileOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['charSelected'])

const router = useRouter()
const route = useRoute()
const chat = useChatStore()
const moments = useMomentsStore()
const events = useEventsStore()
const proactive = useProactiveStore()
const schedule = useScheduleStore()
const mailbox = useMailboxStore()
const groups = useGroupsStore()
const toast = inject('toast', null)
const showMoreMenu = ref(false)
const charListEl = ref(null)

// ── 建群弹窗 ──
const showCreateGroup = ref(false)
const cgName = ref('')
const cgTopic = ref('')
const cgMemberIds = ref([])
const cgSubmitting = ref(false)
const sortedCgCharacters = computed(() => [...chat.characters].sort((left, right) => (
  (left.display_name || '').localeCompare(right.display_name || '', 'zh-CN-u-co-pinyin', { sensitivity: 'base' })
)))

function openCreateGroup() {
  cgName.value = ''
  cgTopic.value = ''
  cgMemberIds.value = []
  showCreateGroup.value = true
}

function toggleCgMember(id) {
  const idx = cgMemberIds.value.indexOf(id)
  if (idx >= 0) cgMemberIds.value.splice(idx, 1)
  else cgMemberIds.value.push(id)
}

async function submitCreateGroup() {
  if (cgMemberIds.value.length < 2 || cgSubmitting.value) return
  cgSubmitting.value = true
  try {
    const group = await groups.createGroup({
      name: cgName.value, topic: cgTopic.value, member_ids: cgMemberIds.value,
    })
    showCreateGroup.value = false
    router.push('/group/' + group.id)
    if (props.isMobile) emit('charSelected')
  } catch (e) {
    toast?.(e.message || '建群失败', 'error')
  } finally {
    cgSubmitting.value = false
  }
}

function onGroupClick(g) {
  router.push('/group/' + g.id)
  if (props.isMobile) emit('charSelected')
}

// 从 schedule store 构建 id → current_activity 映射
const scheduleMap = computed(() => {
  const map = {}
  for (const sc of schedule.characters) {
    if (sc.current_activity && sc.current_activity !== '未设置日程') {
      map[sc.id] = sc.current_activity
    }
  }
  return map
})

// 主动消息到达 → 角色冒泡到顶部 → 列表自动滚到顶部
watch(() => chat.sidebarScrollSignal, () => {
  if (charListEl.value) {
    charListEl.value.scrollTo({ top: 0, behavior: 'smooth' })
  }
})

onMounted(() => {
  // SSE 连接由 NavBar 统一管理（NavBar 在移动端 CSS 隐藏但组件仍挂载，onMounted 正常触发）
  schedule.fetchOverview(true) // silent: 不触发 loading 闪烁
  groups.connectSSE()
  groups.loadGroups()
})

onUnmounted(() => {})

async function onCharClick(c) {
  proactive.markRead(c.id)
  await chat.selectChar(c.id)
  router.push('/chat/' + c.id)
  if (props.isMobile) emit('charSelected')
}

function goTavern() {
  router.push('/tavern')
  if (props.isMobile) emit('charSelected')
}

function onMomentsClick() {
  if (route.path === '/moments') {
    moments.resetFilters()
    router.replace({ path: '/moments', query: {} })
    moments.requestScrollToTop()
  } else {
    router.push('/moments')
  }
  if (props.isMobile) emit('charSelected')
}

function onEventsClick() {
  if (route.path === '/events') {
    events.requestScrollToTop()
  } else {
    router.push('/events')
  }
  if (props.isMobile) emit('charSelected')
}

function onMenuItemClick() {
  showMoreMenu.value = false
  if (props.isMobile) emit('charSelected')
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) {
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  }
  if (diff < 172800000) return '昨天'
  if (diff < 259200000) return '前天'
  if (diff < 604800000) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return days[d.getDay()]
  }
  return (d.getMonth() + 1) + '/' + d.getDate()
}
</script>

<style scoped>
.sidebar {
  width: 300px; min-width: 300px;
  height: 100vh; height: 100dvh;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-right: 1px solid rgba(255, 255, 255, 0.25);
  display: flex; flex-direction: column; overflow: hidden;
  position: relative;
  user-select: none;
}

.char-list {
  flex: 1; overflow-y: auto;
  padding-top: 10px;
  scrollbar-width: none;
  background: rgba(255, 255, 255, 0.08);
}

.char-list::-webkit-scrollbar {
  display: none;
}

.char-item {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; cursor: pointer;
  margin: 2px 8px; border-radius: 12px;
  transition: background 0.2s ease;
  background: transparent;
  position: relative;
}
.char-item:hover { background: rgba(255, 255, 255, 0.22); }
.char-item.active {
  background: rgb(226 166 122 / 28%);
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.04);
}

.char-avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.char-avatar {
  width: 44px; height: 44px; border-radius: 50%;
  color: white;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 600; flex-shrink: 0;
}

.proactive-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--danger, #ff4d4f);
  border: 2.5px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 10px rgba(255, 77, 79, 0.6), 0 0 20px rgba(255, 77, 79, 0.25);
  animation: proactive-pulse 1.2s ease-in-out infinite, jelly-pop 0.45s cubic-bezier(0.17, 0.89, 0.32, 1.35);
}

@keyframes proactive-pulse {
  0%, 100% { box-shadow: 0 0 8px rgba(255, 77, 79, 0.5), 0 0 16px rgba(255, 77, 79, 0.2); }
  50%      { box-shadow: 0 0 16px rgba(255, 77, 79, 0.8), 0 0 32px rgba(255, 77, 79, 0.4); }
}

.char-info { flex: 1; min-width: 0; }
.char-name { font-size: 14px; font-weight: 600; color: var(--text-bright); margin-bottom: 3px; }
.char-schedule {
  font-size: 11px; color: var(--accent);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-bottom: 3px;
  opacity: 0.8;
}
.char-preview {
  font-size: 12px; color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.char-meta { flex-shrink: 0; }
.char-time { font-size: 11px; color: var(--text-secondary); }

.char-empty { color: var(--text-secondary); font-size: 13px; text-align: center; padding: 40px 16px; }

/* ── 新手引导：仅剩默认助手时 ── */
.char-onboard {
  display: flex; align-items: center; gap: 12px;
  width: calc(100% - 16px);
  margin: 10px 8px 4px; padding: 12px 14px;
  border: none; border-radius: 14px;
  background: rgba(224, 123, 108, 0.09);
  font-family: inherit; text-align: left;
  cursor: pointer;
  transition: background 0.2s ease;
  user-select: none;
}
.char-onboard:hover { background: rgba(224, 123, 108, 0.15); }
.char-onboard:active { transform: scale(0.99); }

.char-onboard-icon {
  width: 36px; height: 36px; flex-shrink: 0;
  border-radius: 12px;
  background: rgba(224, 123, 108, 0.16);
  color: var(--accent);
  display: flex; align-items: center; justify-content: center;
}
.char-onboard-icon svg { flex-shrink: 0; }

.char-onboard-text {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 2px;
}
.char-onboard-title { font-size: 13px; font-weight: 600; color: var(--text-bright); }
.char-onboard-desc {
  font-size: 12px; color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.char-onboard-arrow {
  flex-shrink: 0;
  color: var(--accent); opacity: 0.7;
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.char-onboard:hover .char-onboard-arrow { transform: translateX(2px); opacity: 1; }

/* ── 群聊分区 ── */
.group-section-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 20px 4px;
  font-size: 11px; font-weight: 600; color: var(--text-secondary);
  letter-spacing: 1px;
}
.group-create-btn {
  border: none; background: rgb(224 123 108 / 12%);
  width: 24px; height: 24px; min-width: 24px; padding: 0; border-radius: 8px;
  line-height: 0; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--accent); cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}
.group-create-btn svg { width: 14px; height: 14px; flex-shrink: 0; }
.group-create-btn:hover { background: rgb(224 123 108 / 24%); }
.group-create-btn:active { transform: scale(0.94); }

.group-avatar-grid {
  width: 44px; height: 44px; border-radius: 12px; overflow: hidden;
  display: grid; grid-template-columns: 1fr 1fr; gap: 1px;
  background: rgba(255,255,255,0.5);
}
.group-avatar-cell {
  background-size: cover; background-position: center;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 10px; font-weight: 600;
  min-height: 21px;
}

/* ── 建群弹窗 ── */
.create-group-panel { display: flex; flex-direction: column; gap: 10px; max-height: 80vh; }
.cg-title { margin: 0 0 2px; font-size: 16px; color: var(--text-bright); }
.cg-input {
  border: 1px solid rgba(0,0,0,0.1); border-radius: 10px;
  padding: 9px 12px; font-size: 14px; outline: none;
  background: rgba(255,255,255,0.85);
}
.cg-members {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 8px; overflow-y: auto; max-height: 40vh; padding: 4px 0;
}
.cg-member {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 8px 4px; border-radius: 12px; cursor: pointer;
  font-size: 12px; color: var(--text-primary, #333);
  border: 2px solid transparent;
  background: transparent;
  transition: all 0.15s;
  user-select: none;
}
.cg-member.picked {
  border-color: rgb(226 166 122);
  background: rgb(226 166 122 / 15%);
}
.cg-member-avatar {
  width: 40px; height: 40px; border-radius: 50%;
  background-size: cover; background-position: center;
  color: #fff; font-size: 16px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
.cg-submit {
  padding: 12px 0;
}

.cg-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: rgba(42, 36, 30, 0.42);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.cg-dialog {
  width: min(880px, calc(100vw - 64px));
  max-height: min(780px, calc(100vh - 64px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid rgba(224, 123, 108, 0.16);
  background: #fff;
  box-shadow: 0 20px 60px rgba(54, 42, 38, 0.2), 0 2px 8px rgba(224, 123, 108, 0.08);
}
.cg-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 28px;
  border-bottom: 1px solid rgba(224, 123, 108, 0.12);
  background: #fff;
}
.cg-dialog-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-bright, #2f2927);
}
.cg-close-btn {
  flex-shrink: 0;
}
.cg-dialog-body {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 28px;
  min-height: 0;
  padding: 24px 28px;
  background: #fff;
}
.cg-form-col,
.cg-member-col {
  min-width: 0;
}
.cg-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 16px;
}
.cg-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #514845);
}
.cg-input {
  width: 100%;
}
.cg-input-desktop {
  min-height: 44px;
  border-color: rgba(224, 123, 108, 0.22);
  border-radius: 10px;
  background: #fff;
}
.cg-input-desktop:focus {
  border-color: var(--accent, #e07b6c);
  box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.12);
}
.cg-member-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #514845);
}
.cg-members-desktop {
  max-height: 450px;
  padding: 2px 4px 2px 0;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  scrollbar-width: thin;
  scrollbar-color: rgba(224, 123, 108, 0.35) transparent;
}
.cg-member-desktop {
  min-height: 88px;
  padding: 9px 6px 8px;
  background: #fff;
  border-width: 1px;
  border-color: #eee9e7;
}
.cg-member-desktop:hover {
  background: #fff8f6;
  border-color: rgba(224, 123, 108, 0.38);
}
.cg-member-desktop.picked {
  border-color: var(--accent, #e07b6c);
  background: rgba(224, 123, 108, 0.1);
  box-shadow: inset 0 0 0 1px rgba(224, 123, 108, 0.14);
}
.cg-member-desktop span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cg-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 28px 22px;
  border-top: 1px solid rgba(224, 123, 108, 0.12);
  background: #fff;
}
.cg-hint {
  font-size: 12px;
  color: var(--text-secondary, #8b817d);
}
.cg-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cg-cancel,
.cg-submit-desktop {
  min-width: 110px;
  min-height: 40px;
  padding: 10px 18px;
}
.cg-pop-enter-active,
.cg-pop-leave-active {
  transition: opacity 0.24s cubic-bezier(0.4, 0, 0.2, 1);
}
.cg-pop-enter-active .cg-dialog,
.cg-pop-leave-active .cg-dialog {
  transition: transform 0.24s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.24s cubic-bezier(0.4, 0, 0.2, 1);
}
.cg-pop-enter-from,
.cg-pop-leave-to {
  opacity: 0;
}
.cg-pop-enter-from .cg-dialog,
.cg-pop-leave-to .cg-dialog {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

/* ── 移动端底部 ── */
.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  gap: 10px;
  align-items: center;
}

.footer-nav-btn {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 12px; border-radius: 12px;
  font-size: 13px; font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  background: rgba(255, 255, 255, 0.2);
  transition: all 0.2s ease;
  position: relative;
  cursor: pointer;
}
.footer-nav-btn:hover, .footer-nav-btn.active {
  background: rgba(255, 255, 255, 0.35);
  color: var(--text-bright);
  text-decoration: none;
}

.footer-more-btn {
  width: 46px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  padding: 12px 0;
  border-radius: 12px;
  border: none;
  background: rgba(255, 255, 255, 0.2);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}
.footer-more-btn:hover { background: rgba(255, 255, 255, 0.35); color: var(--text-bright); }

.nav-icon-wrap {
  position: relative;
  display: flex;
}

.nav-dot {
  position: absolute;
  top: -6px;
  right: -10px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 10px;
  background: var(--danger);
  border: 1.5px solid rgba(255, 255, 255, 0.8);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 13px;
  text-align: center;
  white-space: nowrap;
  animation: jelly-pop 0.45s cubic-bezier(0.17, 0.89, 0.32, 1.35);
}

@keyframes jelly-pop {
  0%   { transform: scale(0); opacity: 0; }
  60%  { transform: scale(1.25); opacity: 1; }
  80%  { transform: scale(0.92); }
  100% { transform: scale(1); opacity: 1; }
}

/* ── 更多菜单弹窗 ── */
.more-menu-overlay {
  position: absolute; inset: 0;
  display: flex; align-items: flex-end;
  background: rgba(0, 0, 0, 0.35);
  z-index: 110;
}
.more-menu-panel {
  width: 100%;
  padding: 16px 16px 24px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 20px 20px 0 0;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.more-menu-item {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px; border-radius: 12px;
  font-size: 15px; color: var(--text-primary);
  text-decoration: none;
  transition: background 0.15s;
}
.more-menu-item:hover { background: rgba(0, 0, 0, 0.05); }
.more-menu-item svg { flex-shrink: 0; }

/* 弹窗动画 */
.menu-slide-enter-active, .menu-slide-leave-active {
  transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.menu-slide-enter-from, .menu-slide-leave-to {
  opacity: 0;
}
.menu-slide-enter-from .more-menu-panel, .menu-slide-leave-to .more-menu-panel {
  transform: translateY(100%);
}

/* ══════════════════════════════════════════════════
   移动端：媒体查询控制起始位置，CSS 层天生无闪动
   ══════════════════════════════════════════════════ */
@media (max-width: 767px) {
  .group-create-btn {
    width: 30px; height: 30px; min-width: 30px; border-radius: 9px;
  }
  .group-create-btn svg { width: 16px; height: 16px; }
  .sidebar {
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%; height: 100dvh; min-width: unset;
    z-index: 100;
    /* GPU 加速：translate3d 强制合成层 */
    transform: translate3d(-100%, 0, 0);
    transition: transform 0.3s cubic-bezier(0, 0, 0.2, 1);
    will-change: transform;
    border-right: none;
    /* 移动端取消毛玻璃，纯色背景减轻 GPU 负担 */
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: rgba(255, 255, 255, 0.92);
  }
  /* 打开态：滑入屏幕 */
  .sidebar.mobile-open {
    transform: translate3d(0, 0, 0);
  }
}
</style>
