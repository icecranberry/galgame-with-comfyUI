<template>
  <aside class="sidebar" :class="{ 'is-mobile': isMobile, 'mobile-open': isMobile && mobileOpen }">
    <!-- 移动端：顶部关闭按钮 -->
    <div class="sidebar-header">
      <button v-if="isMobile" class="mobile-close-btn" @click="$emit('charSelected')" title="返回聊天">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>返回</span>
      </button>
    </div>

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

    <div class="sidebar-footer">
      <router-link to="/settings" class="nav-link" :class="{ active: $route.path === '/settings' }" @click="onSettingsClick">
        ⚙️ 系统参数
      </router-link>
    </div>
  </aside>
</template>

<script setup>
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

async function onCharClick(c) {
  await chat.selectChar(c.id)
  router.push('/chat/' + c.id)
  if (props.isMobile) emit('charSelected')
}

function onSettingsClick() {
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
  height: 100vh;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-right: 1px solid rgba(255, 255, 255, 0.25);
  display: flex; flex-direction: column; overflow: hidden;
}

.sidebar-header {
  padding: 20px 16px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}
.logo { font-size: 18px; font-weight: 700; color: var(--text-bright); }

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

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}
.nav-link {
  display: block; padding: 10px 14px; border-radius: 10px;
  font-size: 14px; color: var(--text-secondary);
  transition: all 0.2s ease; background: transparent;
}
.nav-link:hover, .nav-link.active {
  background: rgba(255, 255, 255, 0.28);
  color: var(--text-bright);
  text-decoration: none;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.04);
}

/* ══════════════════════════════════════════════════
   移动端：Sidebar 固定定位 + 左侧滑入/滑出动画
   ══════════════════════════════════════════════════ */
.sidebar.is-mobile {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%; min-width: unset;
  z-index: 100;
  /* GPU 加速：translate3d 强制合成层，避免动画期间重绘 */
  transform: translate3d(-100%, 0, 0);
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
  border-right: none;
  /* 移动端降低模糊强度：blur(16px) 在动画时每帧重采样背景，造成卡顿 */
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  /* 提高背景不透明度补偿模糊减弱 */
  background: rgba(255, 255, 255, 0.7);
}
/* 打开态：滑入屏幕 */
.sidebar.is-mobile.mobile-open {
  transform: translate3d(0, 0, 0);
  transition: transform 0.3s cubic-bezier(0, 0, 0.2, 1);
}

/* 移动端关闭按钮（顶部左侧返回箭头） */
.mobile-close-btn {
  display: flex; align-items: center; gap: 6px;
  background: transparent; border: none; border-radius: 8px;
  color: var(--text-primary); font-size: 15px; font-weight: 500;
  cursor: pointer; padding: 6px 10px;
  transition: background 0.15s ease;
}
.mobile-close-btn:hover { background: rgba(0, 0, 0, 0.06); }
.mobile-close-btn svg { flex-shrink: 0; }

/* 移动端 sidebar-header 调整 */
.sidebar.is-mobile .sidebar-header {
  padding: 16px 16px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}
</style>
