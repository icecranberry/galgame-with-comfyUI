<template>
  <div class="chat-view">
    <div v-if="!chat.activeCharId" class="empty-state">
      <div class="empty-icon">💬</div>
      <h2>选择一个角色开始对话</h2>
    </div>

    <template v-else>
      <div class="chat-header">
        <span class="chat-title">{{ chat.activeChar?.display_name }}</span>
      </div>

      <div ref="msgList" class="message-list">
        <div v-for="(group, gi) in messageGroups" :key="gi">
          <div class="time-divider">{{ group.label }}</div>

          <template v-for="msg in group.msgs" :key="msg.id">
            <!-- Text bubble (user or assistant) -->
            <div v-if="msg.type !== 'image_gen'" class="message" :class="msg.role">
              <div class="msg-bubble">
                <div class="msg-text" v-html="renderContent(msg.content)"></div>
              </div>
            </div>

            <!-- Image generation bubble -->
            <div v-else class="message assistant">
              <ImageGenBubble
                :msg="msg"
                @preview="previewImage = $event"
              />
            </div>
          </template>
        </div>
        <div ref="bottomAnchor"></div>
      </div>

      <div class="input-area">
        <textarea ref="inputEl" v-model="inputText" class="chat-input"
          placeholder="输入消息..." rows="1"
          @keydown.enter.exact.prevent="send"
          @keydown.enter.shift.exact="inputText += '\n'"
        ></textarea>
        <button class="btn-primary send-btn" @click="send" :disabled="!inputText.trim()">发送</button>
      </div>
    </template>

    <div v-if="previewImage" class="img-overlay" @click="previewImage = null">
      <img :src="previewImage" class="img-full" @click.stop />
      <button class="img-close" @click="previewImage = null">&times;</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import ImageGenBubble from '../components/ImageGenBubble.vue'

const route = useRoute()
const chat = useChatStore()
const inputText = ref('')
const inputEl = ref(null)
const msgList = ref(null)
const bottomAnchor = ref(null)
const previewImage = ref(null)

const messageGroups = computed(() => {
  const groups = []
  for (const msg of chat.messages) {
    const t = timeLabel(msg.created_at)
    const last = groups[groups.length - 1]
    if (last && last.label === t) { last.msgs.push(msg) }
    else { groups.push({ label: t, msgs: [msg] }) }
  }
  return groups
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

onMounted(async () => {
  await chat.loadCharacters()
  if (route.params.id) chat.selectChar(parseInt(route.params.id))
  else if (chat.characters.length > 0) chat.selectChar(chat.characters[0].id)
  inputEl.value?.focus()
})

watch(() => route.params.id, async (id) => { if (id) chat.selectChar(parseInt(id)) })
watch(() => chat.messages.length, async () => { await nextTick(); scrollDown() })

function scrollDown() { bottomAnchor.value?.scrollIntoView({ behavior: 'smooth' }) }

async function send() {
  const text = inputText.value.trim()
  if (!text || chat.streaming) return
  inputText.value = ''
  await chat.sendMessage(text)
}

function renderContent(text) {
  if (!text) return ''
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br>')
}
</script>

<style scoped>
.chat-view { flex:1; display:flex; flex-direction:column; height:100vh; overflow:hidden; background:var(--bg-primary); }
.empty-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; }
.empty-icon { font-size:56px; }
.empty-state h2 { font-size:18px; color:var(--text-secondary); font-weight:400; }

.chat-header { padding:16px 24px; border-bottom:1px solid var(--border); background:var(--bg-secondary); }
.chat-title { font-size:16px; font-weight:600; color:var(--text-bright); }

.message-list { flex:1; overflow-y:auto; padding:16px 24px; display:flex; flex-direction:column; gap:2px; }

.time-divider { text-align:center; padding:16px 0 8px; font-size:12px; color:var(--text-secondary); user-select:none; }

.message { display:flex; margin:3px 0; }
.message.user { justify-content:flex-end; }
.message.assistant { justify-content:flex-start; }

.msg-bubble {
  max-width:75%; padding:10px 14px; border-radius:8px;
  font-size:14px; line-height:1.6; word-break:break-word;
}
.message.user .msg-bubble { background:#2b5278; color:#e8e8e8; }
.message.assistant .msg-bubble { background:var(--bg-secondary); color:var(--text-primary); border:1px solid var(--border); }
.msg-text { font-size:14px; line-height:1.6; }
.msg-text :deep(code) { background:rgba(0,0,0,0.2); padding:2px 6px; border-radius:4px; font-size:13px; }
.msg-text :deep(strong) { font-weight:600; }

.input-area { padding:12px 24px; border-top:1px solid var(--border); display:flex; gap:10px; align-items:flex-end; background:var(--bg-secondary); }
.chat-input { flex:1; min-height:40px; max-height:120px; padding:10px 14px; font-size:14px; background:var(--bg-primary); border:1px solid var(--border); border-radius:8px; color:var(--text-bright); outline:none; resize:none; }
.chat-input:focus { border-color:var(--accent); }
.send-btn { padding:10px 20px; height:40px; flex-shrink:0; }

.img-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; z-index:1000; cursor:zoom-out; }
.img-full { max-width:90vw; max-height:90vh; border-radius:8px; cursor:default; }
.img-close { position:absolute; top:16px; right:16px; width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,0.1); color:#fff; font-size:22px; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.img-close:hover { background:rgba(255,255,255,0.25); }
</style>
