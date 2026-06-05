<template>
  <div class="chat-view">
    <!-- Empty state -->
    <div v-if="!chat.currentConvId && chat.messages.length === 0" class="empty-state">
      <div class="empty-icon">🎨</div>
      <h2>AI 图像生成智能体</h2>
      <p>选择一个角色，然后描述你想生成的图像</p>
      <div class="suggestions">
        <button
          v-for="s in suggestions"
          :key="s"
          class="suggestion-chip"
          @click="handleSuggestion(s)"
        >{{ s }}</button>
      </div>
    </div>

    <!-- Message list -->
    <div ref="msgList" class="message-list">
      <div
        v-for="(msg, idx) in chat.messages"
        :key="msg.id"
        class="message"
        :class="msg.role"
      >
        <div class="msg-role">{{ msg.role === 'user' ? '你' : 'AI' }}</div>
        <div class="msg-content" v-html="renderContent(msg.content)"></div>

        <!-- Streaming cursor on the last AI message -->
        <span v-if="isStreamingLastAi(idx, msg)" class="cursor-blink">▌</span>

        <!-- Generated images -->
        <div v-if="msg.images && msg.images.length > 0" class="msg-images">
          <img
            v-for="(img, i) in msg.images"
            :key="i"
            :src="img.base64"
            :alt="img.filename"
            class="generated-image"
            @click="previewImage = img.base64"
          />
        </div>

        <!-- Generating indicator -->
        <div v-if="msg.generating" class="generating-indicator">
          <span class="generating-spinner"></span>
          {{ chat.generateProgress || '正在生成图片...' }}
        </div>
      </div>
    </div>

    <!-- Emotion dashboard -->
    <EmotionPanel
      v-if="chat.emotion"
      :emotion="chat.emotion"
      :character="currentCharacter"
    />

    <!-- Input area -->
    <div class="input-area">
      <textarea
        ref="inputEl"
        v-model="inputText"
        class="chat-input"
        placeholder="描述你想生成的图像，或者和 AI 聊聊想法..."
        rows="2"
        @keydown.enter.exact.prevent="handleSend"
        @keydown.enter.shift.exact="inputText += '\n'"
        :disabled="chat.streaming"
      ></textarea>
      <button
        class="btn-primary send-btn"
        @click="handleSend"
        :disabled="!inputText.trim() || chat.streaming"
      >
        {{ chat.streaming ? '...' : '发送' }}
      </button>
    </div>

    <!-- Image preview overlay -->
    <div v-if="previewImage" class="image-overlay" @click="previewImage = null">
      <img :src="previewImage" class="image-overlay-img" @click.stop />
      <button class="image-overlay-close" @click="previewImage = null">✕</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import { useCharacterStore } from '../stores/character.js'
import EmotionPanel from '../components/EmotionPanel.vue'

const route = useRoute()
const chat = useChatStore()
const chars = useCharacterStore()

const inputText = ref('')
const inputEl = ref(null)
const msgList = ref(null)
const previewImage = ref(null)

const suggestions = [
  '画一只在樱花树下的白色猫咪',
  '赛博朋克风格的城市夜景',
  '水彩画风格的海边日落',
  '一只穿着西装的企鹅',
]

const currentCharacter = computed(() =>
  chars.characters.find(c => c.id === chat.currentCharId)
)

// Load conversation from URL
onMounted(async () => {
  if (route.params.id) {
    await chat.selectConversation(route.params.id)
  }
  inputEl.value?.focus()
})

watch(() => route.params.id, async (id) => {
  if (id && id !== chat.currentConvId) {
    await chat.selectConversation(id)
  }
})

// Auto-scroll to bottom
watch(
  () => [chat.messages.length, chat.streamingContent.value],
  async () => { await nextTick(); scrollDown() },
  { deep: true }
)

function scrollDown() {
  if (msgList.value) {
    msgList.value.scrollTop = msgList.value.scrollHeight
  }
}

function isStreamingLastAi(idx, msg) {
  return chat.streaming && msg.role === 'assistant' && idx === chat.messages.length - 1
}

async function handleSend() {
  const text = inputText.value.trim()
  if (!text || chat.streaming) return
  inputText.value = ''
  await chat.sendMessage(text)
  scrollDown()
}

function handleSuggestion(s) {
  inputText.value = s
  handleSend()
}

// Simple markdown-like rendering for message content
function renderContent(text) {
  if (!text) return ''
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Newlines
    .replace(/\n/g, '<br>')
    // Generate tag highlighting
    .replace(/&lt;generate&gt;([\s\S]*?)&lt;\/generate&gt;/g, '<div class="generate-block">🎨 生图提示词<pre>$1</pre></div>')
  return html
}
</script>

<style scoped>
.chat-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* Empty state */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
}
.empty-icon { font-size: 64px; }
.empty-state h2 { font-size: 22px; color: var(--text-bright); }
.empty-state p { color: var(--text-secondary); font-size: 15px; }

.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-width: 500px;
  justify-content: center;
  margin-top: 8px;
}
.suggestion-chip {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.suggestion-chip:hover {
  background: var(--bg-hover);
  border-color: var(--accent);
}

/* Messages */
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message {
  max-width: 80%;
  padding: 12px 16px;
  border-radius: 12px;
  animation: fadeIn 0.2s ease-out;
}
.message.user {
  align-self: flex-end;
  background: var(--user-bubble);
  border-bottom-right-radius: 4px;
}
.message.assistant {
  align-self: flex-start;
  background: var(--ai-bubble);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
}

.msg-role {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.msg-content {
  font-size: 14px;
  line-height: 1.65;
  color: var(--text-primary);
  word-break: break-word;
}

.msg-content :deep(code) {
  background: var(--bg-primary);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

.msg-content :deep(.generate-block) {
  margin-top: 8px;
  background: var(--bg-primary);
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 12px;
}
.msg-content :deep(.generate-block pre) {
  color: var(--accent-light);
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
  margin-top: 4px;
}

.cursor-blink {
  color: var(--accent-light);
  animation: blink 1s step-end infinite;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes blink {
  50% { opacity: 0; }
}

/* Input */
.input-area {
  padding: 16px 24px;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 10px;
  align-items: flex-end;
  background: var(--bg-secondary);
}

.chat-input {
  flex: 1;
  min-height: 44px;
  max-height: 150px;
}

.send-btn {
  padding: 10px 24px;
  height: 44px;
  flex-shrink: 0;
}

/* Generated images */
.msg-images {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.generated-image {
  max-width: 280px;
  max-height: 280px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid var(--border);
  transition: transform 0.15s;
  object-fit: cover;
}
.generated-image:hover {
  transform: scale(1.02);
  border-color: var(--accent);
}

/* Generating indicator */
.generating-indicator {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--accent-light);
}

.generating-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Image preview overlay */
.image-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  cursor: zoom-out;
}

.image-overlay-img {
  max-width: 90vw;
  max-height: 90vh;
  border-radius: 8px;
  cursor: default;
}

.image-overlay-close {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255,255,255,0.1);
  color: white;
  font-size: 20px;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.image-overlay-close:hover {
  background: rgba(255,255,255,0.25);
}
</style>
