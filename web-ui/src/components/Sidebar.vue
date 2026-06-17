<template>
  <aside class="sidebar" :class="{ 'mobile-open': isMobile && mobileOpen }">
    <div class="char-list">
      <div
        v-for="c in chat.characters"
        :key="c.id"
        class="char-item"
        :class="{ active: c.id === chat.activeCharId && route.path.startsWith('/chat') }"
        @click="onCharClick(c)"
      >
        <div
          class="char-avatar"
          :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: c.avatar_color || '#e07b6c' }"
        >{{ c.avatar_path ? '' : c.display_name.charAt(0) }}</div>
        <div class="char-info">
          <div class="char-name">{{ c.display_name }}</div>
          <div class="char-preview">{{ c.last_message || '点击开始对话' }}</div>
        </div>
        <div class="char-meta">
          <span class="char-time">{{ formatTime(c.last_message_at) }}</span>
        </div>
      </div>

      <div v-if="chat.characters.length === 0" class="char-empty">
        加载中...
      </div>
    </div>

    <!-- 移动端底部：朋友圈 + 更多 -->
    <div v-if="isMobile" class="sidebar-footer">
      <router-link to="/moments" class="footer-moments-btn" :class="{ active: $route.path === '/moments' }" @click="onFooterClick">
        <div class="nav-icon-wrap">
          <svg viewBox="0 0 1024 1024" width="20" height="20" fill="currentColor">
            <path d="M679.17 398.982V126.497s-133.338-71.481-288.989-16.366l288.99 288.851z m25.245 160.303V137.748s157.63 71.434 202.052 244.963L704.415 559.285z m-84.8 122.527l290.99-273.649s51.488 83.709-25.293 273.649H619.614z m-148.586 34.695h393.014S816.6 845.102 646.788 898.195L471.03 716.507z m-128.293-86.811v256.18s102.072 65.365 276.878 21.477L342.736 629.696z m-227.366 13.25l199.075-178.62v406.207c0-0.001-120.272-41.75-199.075-227.587z m-5.045-28.57S64.787 467.442 128.48 339.824h273.81L110.326 614.377z m35.357-303.193s57.603-130.594 214.21-191.87l186.894 191.87H145.682z" />
          </svg>
          <span v-if="moments.newPostCount > 0" class="nav-dot">{{ moments.newPostCount > 99 ? '99+' : moments.newPostCount }}</span>
        </div>
        <span>朋友圈</span>
      </router-link>
      <button class="footer-more-btn" @click="showMoreMenu = !showMoreMenu">
        <svg viewBox="0 0 1024 1024" width="22" height="22" fill="currentColor">
          <path d="M436 128H168a40 40 0 0 0-40 40v268a40 40 0 0 0 40 40h268a40 40 0 0 0 40-40V168a40 40 0 0 0-40-40z m-32 276H200V200h204z m32 144H168a40 40 0 0 0-40 40v268a40 40 0 0 0 40 40h268a40 40 0 0 0 40-40V588a40 40 0 0 0-40-40z m-32 276H200V620h204z m452-276H588a40 40 0 0 0-40 40v268a40 40 0 0 0 40 40h268a40 40 0 0 0 40-40V588a40 40 0 0 0-40-40z m-32 276H620V620h204zM716 118c-104.9 0-190 85.1-190 190s85.1 190 190 190 190-85.1 190-190-85.1-190-190-190z m83.4 273.4A117.8 117.8 0 1 1 834 308a117 117 0 0 1-34.6 83.4z"/>
        </svg>
      </button>
    </div>

    <!-- 更多菜单弹窗 -->
    <Transition name="menu-slide">
      <div v-if="showMoreMenu" class="more-menu-overlay" @click.self="showMoreMenu = false">
        <div class="more-menu-panel">
          <router-link to="/tavern" class="more-menu-item" @click="onMenuItemClick">
            🏮 酒馆
          </router-link>
          <router-link to="/gallery" class="more-menu-item" @click="onMenuItemClick">
            🖼️ 相册
          </router-link>
          <router-link to="/settings" class="more-menu-item" @click="onMenuItemClick">
            ⚙️ 系统设置
          </router-link>
        </div>
      </div>
    </Transition>
  </aside>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import { useMomentsStore } from '../stores/moments.js'

const props = defineProps({
  isMobile: { type: Boolean, default: false },
  mobileOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['charSelected'])

const router = useRouter()
const route = useRoute()
const chat = useChatStore()
const moments = useMomentsStore()
const showMoreMenu = ref(false)

onMounted(() => {
  // SSE 连接由 NavBar 统一管理（NavBar 在移动端 CSS 隐藏但组件仍挂载，onMounted 正常触发）
})

onUnmounted(() => {})

async function onCharClick(c) {
  await chat.selectChar(c.id)
  router.push('/chat/' + c.id)
  if (props.isMobile) emit('charSelected')
}

function onFooterClick() {
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
}
.char-item:hover { background: rgba(255, 255, 255, 0.22); }
.char-item.active {
  background: rgb(226 166 122 / 28%);
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.04);
}

.char-avatar {
  width: 44px; height: 44px; border-radius: 50%;
  color: white;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 600; flex-shrink: 0;
}

.char-info { flex: 1; min-width: 0; }
.char-name { font-size: 14px; font-weight: 600; color: var(--text-bright); margin-bottom: 3px; }
.char-preview {
  font-size: 12px; color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.char-meta { flex-shrink: 0; }
.char-time { font-size: 11px; color: var(--text-secondary); }

.char-empty { color: var(--text-secondary); font-size: 13px; text-align: center; padding: 40px 16px; }

/* ── 移动端底部 ── */
.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  gap: 10px;
  align-items: center;
}

.footer-moments-btn {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 12px 16px; border-radius: 12px;
  font-size: 14px; font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  background: rgba(255, 255, 255, 0.2);
  transition: all 0.2s ease;
}
.footer-moments-btn:hover, .footer-moments-btn.active {
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
