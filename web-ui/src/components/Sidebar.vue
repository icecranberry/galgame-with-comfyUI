<template>
  <aside class="sidebar" :class="{ 'mobile-open': isMobile && mobileOpen }">
    <div class="char-list">
      <div
        v-for="c in chat.characters"
        :key="c.id"
        class="char-item"
        :class="{ active: c.id === chat.activeCharId }"
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
        <svg viewBox="0 0 1024 1024" width="20" height="20" fill="currentColor">
          <path d="M679.17 398.982V126.497s-133.338-71.481-288.989-16.366l288.99 288.851z m25.245 160.303V137.748s157.63 71.434 202.052 244.963L704.415 559.285z m-84.8 122.527l290.99-273.649s51.488 83.709-25.293 273.649H619.614z m-148.586 34.695h393.014S816.6 845.102 646.788 898.195L471.03 716.507z m-128.293-86.811v256.18s102.072 65.365 276.878 21.477L342.736 629.696z m-227.366 13.25l199.075-178.62v406.207c0-0.001-120.272-41.75-199.075-227.587z m-5.045-28.57S64.787 467.442 128.48 339.824h273.81L110.326 614.377z m35.357-303.193s57.603-130.594 214.21-191.87l186.894 191.87H145.682z" />
        </svg>
        <span>朋友圈</span>
      </router-link>
      <button class="footer-more-btn" @click="showMoreMenu = !showMoreMenu">
        <svg viewBox="0 0 1024 1024" width="22" height="22" fill="currentColor">
          <path d="M416.4 958h191.2V849.7c0-12.7 6.4-25.5 19.1-31.9 31.9-12.7 63.7-31.9 89.2-51 12.7-6.4 25.5-6.4 38.2 0l95.6 57.3 95.6-165.7-95.6-57.3C837 588.5 830.6 575.7 837 563c0-19.1 6.4-31.9 6.4-51s0-31.9-6.4-51c0-12.7 6.4-25.5 12.7-31.9l95.6-57.3-95.6-165.7-95.6 57.3c-12.7 6.4-25.5 6.4-38.2 0-25.5-19.1-57.3-38.2-89.2-51-12.7-12.7-19.1-25.5-19.1-38.2V66H416.4v108.3c0 12.7-6.4 25.5-19.1 31.9-31.9 12.7-63.7 31.9-89.2 51-12.7 6.4-25.5 6.4-38.2 0l-95.6-51-95.6 165.6 95.6 57.3c12.7 6.4 19.1 19.1 12.7 31.9 0 19.1-6.4 31.9-6.4 51s0 31.9 6.4 51c6.4 12.7 0 25.5-12.7 31.9l-95.6 57.3 95.6 165.7 95.6-57.3c12.7-6.4 25.5-6.4 38.2 0 25.5 19.1 57.3 38.2 89.2 51 12.7 6.4 19.1 19.1 19.1 31.9V958z m223 63.7H384.6c-19.1 0-31.9-12.7-31.9-31.9v-121c-25.5-12.7-51-25.5-70.1-38.2l-101.9 63.7c-12.7 6.4-31.9 6.4-44.6-12.7L8.6 658.6c-12.7-19.1-6.4-38.2 12.7-44.6l101.9-63.7v-76.5L21.4 410.1c-19.1-6.4-25.5-25.5-12.7-44.6l127.4-223c6.4-12.7 25.5-19.1 44.6-6.4l101.9 63.7c19.1-12.7 44.6-31.9 70.1-38.2V34.1c0-19.1 12.7-31.9 31.9-31.9h254.9c19.1 0 31.9 12.7 31.9 31.9v121.1c25.5 12.7 51 25.5 70.1 38.2l101.9-63.7c12.7-6.4 31.9-6.4 44.6 12.7l127.4 223c12.7 19.1 6.4 38.2-12.7 44.6l-101.9 63.7v76.5l101.9 63.7c12.7 6.4 19.1 25.5 12.7 44.6L888 881.5c-6.4 12.7-25.5 19.1-44.6 12.7l-101.9-63.7c-19.1 12.7-44.6 31.9-70.1 38.2v121.1c-0.1 19.2-12.8 31.9-32 31.9zM512 703.2c-108.3 0-191.2-82.8-191.2-191.2S403.7 320.8 512 320.8 703.2 403.7 703.2 512 620.3 703.2 512 703.2z m0-318.6c-70.1 0-127.4 57.3-127.4 127.4S441.9 639.4 512 639.4 639.4 582.1 639.4 512 582.1 384.6 512 384.6z"/>
        </svg>
      </button>
    </div>

    <!-- 更多菜单弹窗 -->
    <Transition name="menu-slide">
      <div v-if="showMoreMenu" class="more-menu-overlay" @click.self="showMoreMenu = false">
        <div class="more-menu-panel">
          <router-link to="/settings" class="more-menu-item" @click="onMenuItemClick">
            ⚙️ 系统设置
          </router-link>
        </div>
      </div>
    </Transition>
  </aside>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useChatStore } from '../stores/chat.js'

const props = defineProps({
  isMobile: { type: Boolean, default: false },
  mobileOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['charSelected'])

const router = useRouter()
const route = useRoute()
const chat = useChatStore()
const showMoreMenu = ref(false)

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
  background: rgba(255, 255, 255, 0.08);
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
  background: rgba(255, 255, 255, 0.28);
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
