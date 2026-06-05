<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <button class="btn-primary new-btn" @click="handleNewChat">+ 新对话</button>
    </div>

    <!-- Character selector -->
    <div class="sidebar-section">
      <label class="section-label">角色</label>
      <select
        class="char-select"
        :value="chat.currentCharId"
        @change="chat.currentCharId = $event.target.value"
      >
        <option v-for="c in chars.characters" :key="c.id" :value="c.id">
          {{ c.display_name }}
        </option>
      </select>
    </div>

    <!-- Conversation list -->
    <div class="sidebar-section conv-section">
      <label class="section-label">对话列表</label>
      <div class="conv-list">
        <div
          v-for="conv in chat.conversations"
          :key="conv.conversation_id"
          class="conv-item"
          :class="{ active: conv.conversation_id === chat.currentConvId }"
          @click="handleSelect(conv.conversation_id)"
        >
          <div class="conv-title">
            {{ conv.last_user_message || '新对话' }}
          </div>
          <div class="conv-meta">
            <span>{{ conv.message_count || 0 }} 条</span>
            <button
              class="btn-ghost conv-delete"
              @click.stop="handleDelete(conv.conversation_id)"
              title="删除"
            >✕</button>
          </div>
        </div>
        <div v-if="chat.conversations.length === 0" class="conv-empty">
          暂无对话，点击上方按钮开始
        </div>
      </div>
    </div>

    <!-- Navigation -->
    <div class="sidebar-footer">
      <router-link to="/chat" class="nav-link" :class="{ active: $route.path.startsWith('/chat') }">
        💬 聊天
      </router-link>
      <router-link to="/characters" class="nav-link" :class="{ active: $route.path === '/characters' }">
        👤 角色管理
      </router-link>
    </div>
  </aside>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import { useCharacterStore } from '../stores/character.js'
import { deleteConversation } from '../api/index.js'

const router = useRouter()
const chat = useChatStore()
const chars = useCharacterStore()

async function handleNewChat() {
  await chat.newConversation()
  router.push(`/chat/${chat.currentConvId}`)
}

async function handleSelect(id) {
  await chat.selectConversation(id)
  router.push(`/chat/${id}`)
}

async function handleDelete(id) {
  if (!confirm('删除这个对话？消息会被软删除。')) return
  await deleteConversation(id)
  if (chat.currentConvId === id) {
    chat.currentConvId = null
    chat.messages = []
    router.push('/chat')
  }
  await chat.loadConversations()
}
</script>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  height: 100vh;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.logo {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-bright);
}

.new-btn {
  width: 100%;
  padding: 10px;
  font-size: 14px;
}

.sidebar-section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-secondary);
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  display: block;
}

.char-select {
  width: 100%;
  padding: 8px 10px;
  cursor: pointer;
}

.conv-section {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.conv-list {
  flex: 1;
  overflow-y: auto;
}

.conv-item {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
  transition: background 0.1s;
}
.conv-item:hover { background: var(--bg-hover); }
.conv-item.active { background: var(--bg-tertiary); }

.conv-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text-primary);
}

.conv-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
  margin-left: 8px;
}

.conv-delete {
  font-size: 12px;
  padding: 2px 4px;
  opacity: 0;
}
.conv-item:hover .conv-delete { opacity: 1; }

.conv-empty {
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
  padding: 24px 16px;
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-link {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-secondary);
  transition: all 0.1s;
}
.nav-link:hover, .nav-link.active {
  background: var(--bg-hover);
  color: var(--text-bright);
  text-decoration: none;
}
</style>
