<template>
  <aside class="sidebar">
    <div class="sidebar-header">
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
          :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: c.avatar_color || '#5b8def' }"
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
      <router-link to="/settings" class="nav-link" :class="{ active: $route.path === '/settings' }">
        ⚙️ 系统参数
      </router-link>
    </div>
  </aside>
</template>

<script setup>
import { useRouter, useRoute } from 'vue-router'
import { useChatStore } from '../stores/chat.js'

const router = useRouter()
const route = useRoute()
const chat = useChatStore()

async function onCharClick(c) {
  await chat.selectChar(c.id)
  router.push('/chat/' + c.id)
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
  height: 100vh; background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column; overflow: hidden;
}

.sidebar-header {
  padding: 20px 16px 12px;
  border-bottom: 1px solid var(--border);
}
.logo { font-size: 18px; font-weight: 700; color: var(--text-bright); }

.char-list { flex: 1; overflow-y: auto; }

.char-item {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; cursor: pointer; transition: background 0.1s;
}
.char-item:hover { background: var(--bg-hover); }
.char-item.active { background: var(--bg-tertiary); }

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
  padding: 12px 16px; border-top: 1px solid var(--border);
}
.nav-link {
  display: block; padding: 8px 12px; border-radius: 8px;
  font-size: 14px; color: var(--text-secondary); transition: all 0.1s;
}
.nav-link:hover, .nav-link.active { background: var(--bg-hover); color: var(--text-bright); text-decoration: none; }
</style>
