<template>
  <div class="chat-view">
    <div v-if="!chat.activeCharId" class="empty-state">
      <div class="empty-icon">💬</div>
      <h2>选择一个角色开始对话</h2>
    </div>

    <template v-else>
      <div class="chat-header">
        <span class="chat-title">{{ chat.activeChar?.display_name }}</span>
        <button class="btn-header-settings" title="编辑角色人格" @click="openCharEditor">⚙️</button>
      </div>

      <div ref="msgList" class="message-list" @scroll="onScroll">
        <div ref="msgInner" class="msg-inner">
          <!-- 顶部加载指示器 -->
          <div v-if="chat.loadingOlder" class="load-older">加载更早的消息...</div>
          <div v-else-if="chat.hasMoreOlder" class="load-older load-older-hint">↑ 向上滚动加载更多</div>
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
      </div>

      <div class="input-area">
        <textarea ref="inputEl" v-model="inputText" class="chat-input"
          placeholder="输入消息..." rows="1"
          @keydown.enter.exact.prevent="send"
          @keydown.enter.shift.exact="inputText += '\n'"
        ></textarea>
        <button class="btn-primary send-btn" @click="send" :disabled="!inputText.trim() || chat.streaming">
          {{ chat.streaming ? '发送中...' : '发送' }}
        </button>
      </div>
    </template>

    <div v-if="previewImage" class="img-overlay" @click="previewImage = null">
      <img :src="previewImage" class="img-full" @click.stop />
      <button class="img-close" @click="previewImage = null">&times;</button>
    </div>

    <!-- 角色人格编辑弹窗 -->
    <div v-if="showEditor" class="editor-overlay">
      <div class="editor-panel">
        <div class="editor-header">
          <span>编辑角色人格 — {{ chat.activeChar?.display_name }}</span>
          <button class="editor-close" @click="closeCharEditor">&times;</button>
        </div>
        <div class="editor-field">
          <label>显示名称</label>
          <input v-model="editForm.display_name" class="editor-input" />
        </div>
        <div class="editor-field">
          <label>人格提示词（base_prompt）</label>
          <textarea v-model="editForm.base_prompt" class="editor-textarea" rows="18"></textarea>
        </div>
        <div class="editor-actions">
          <button class="btn-danger" @click="clearChatHistory" :disabled="clearing">
            {{ clearing ? '清空中...' : '⚠️ 清空聊天记录' }}
          </button>
          <div class="editor-actions-right">
            <button class="btn-cancel" @click="closeCharEditor">取消</button>
            <button class="btn-primary" @click="saveCharEditor" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import ImageGenBubble from '../components/ImageGenBubble.vue'

const route = useRoute()
const chat = useChatStore()
const inputText = ref('')
const inputEl = ref(null)
const msgList = ref(null)
const msgInner = ref(null)
const bottomAnchor = ref(null)
const previewImage = ref(null)

// ── 角色人格编辑器 ──
const showEditor = ref(false)
const saving = ref(false)
const clearing = ref(false)
const editForm = ref({ display_name: '', base_prompt: '' })

function openCharEditor() {
  const c = chat.activeChar
  if (!c) return
  editForm.value = { display_name: c.display_name || '', base_prompt: c.base_prompt || '' }
  showEditor.value = true
}

function closeCharEditor() {
  showEditor.value = false
}

async function saveCharEditor() {
  if (saving.value) return
  saving.value = true
  try {
    await chat.updateActiveCharacter({
      display_name: editForm.value.display_name,
      base_prompt: editForm.value.base_prompt,
    })
    showEditor.value = false
  } catch (err) {
    console.error('[chat] save character failed:', err)
  } finally {
    saving.value = false
  }
}

async function clearChatHistory() {
  if (clearing.value || !confirm('确定要清空当前角色的所有聊天记录吗？此操作不可恢复。')) return
  clearing.value = true
  try {
    await chat.clearActiveMessages()
    showEditor.value = false
  } catch (err) {
    console.error('[chat] clear messages failed:', err)
  } finally {
    clearing.value = false
  }
}

const messageGroups = computed(() => {
  const groups = []
  for (const msg of chat.messages) {
    const lastGroup = groups[groups.length - 1]
    if (lastGroup) {
      const lastMsg = lastGroup.msgs[lastGroup.msgs.length - 1]
      const diff = Math.abs(new Date(msg.created_at) - new Date(lastMsg.created_at))
      if (diff <= 10 * 60 * 1000) {
        lastGroup.msgs.push(msg)
        continue
      }
    }
    const t = timeLabel(msg.created_at)
    groups.push({ label: t, msgs: [msg] })
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

// ══════════════════════════════════════════════════
// 滚动引擎
// ══════════════════════════════════════════════════
//
// 两个独立机制协同：
//   forceScrollDown = 明确事件触发，16 帧 rAF 持续滚底（初始 / 切角色 / 发消息）
//   ResizeObserver   = 全天候监听，4px 阈值过滤抖动
//
// 用户上翻 → userScrolledUp=true → Observer 暂停跟滚，直到用户滚回底部

let userScrolledUp = false
let resizeObs = null
let _scrollGen = 0
let _lastObsHeight = 0

function isNearBottom() {
  const el = msgList.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120
}

// ── 持续滚底（最大 16 帧 rAF，连续 4 帧高度不变就提前停）──
function forceScrollDown() {
  userScrolledUp = false
  _scrollGen++
  const gen = _scrollGen
  let lastH = 0, stableFrames = 0
  function tick(count) {
    if (gen !== _scrollGen) return
    const el = msgList.value
    if (!el) return
    el.scrollTop = el.scrollHeight
    // 提前终止：scrollHeight 连续 4 帧不变说明 DOM 已稳定
    if (el.scrollHeight === lastH) {
      stableFrames++
    } else {
      lastH = el.scrollHeight; stableFrames = 0
    }
    if (stableFrames < 4 && count < 16) {
      requestAnimationFrame(() => tick(count + 1))
    }
  }
  tick(0)
}

// ── scroll 事件：加载更多 + 追踪用户意图 ──
function onScroll() {
  const el = msgList.value
  if (!el || chat.loadingOlder) return
  if (el.scrollTop < 80) loadMore()
  userScrolledUp = !isNearBottom()
}

async function loadMore() {
  if (!chat.hasMoreOlder || chat.loadingOlder) return
  const el = msgList.value
  const prevHeight = el?.scrollHeight || 0
  await chat.loadOlderMessages()
  await nextTick()
  if (el) el.scrollTop = el.scrollHeight - prevHeight
}

// ── ResizeObserver：全天候，4px 阈值防抖 ──
function startAutoScroll() {
  const target = msgInner.value
  if (!target) return
  _lastObsHeight = target.offsetHeight
  resizeObs = new ResizeObserver((entries) => {
    if (userScrolledUp || chat.loadingOlder) return
    const h = entries[0]?.contentRect?.height || 0
    if (Math.abs(h - _lastObsHeight) < 4) return  // <4px = 子像素抖动
    _lastObsHeight = h
    const el = msgList.value
    if (el) el.scrollTop = el.scrollHeight
  })
  resizeObs.observe(target)
}

function stopAutoScroll() {
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null }
}

// ── 生命周期 ──
onMounted(async () => {
  await chat.loadCharacters()
  if (route.params.id) await chat.selectChar(parseInt(route.params.id))
  else if (chat.characters.length > 0) await chat.selectChar(chat.characters[0].id)
  await nextTick()
  forceScrollDown()
  startAutoScroll()
  inputEl.value?.focus()
})

onUnmounted(() => stopAutoScroll())

// 切角色
watch(() => chat.activeCharId, async (id, oldId) => {
  if (id && id !== oldId) {
    await nextTick()
    forceScrollDown()
    stopAutoScroll()
    await nextTick()
    startAutoScroll()
  }
})

// 新消息追加
watch(() => chat.messages.length, async (newLen, oldLen) => {
  await nextTick()
  if (oldLen > 0 && newLen > oldLen && !chat.loadingOlder) forceScrollDown()
})

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

.chat-header { padding:16px 24px; border-bottom:1px solid var(--border); background:var(--bg-secondary); display:flex; align-items:center; justify-content:space-between; }
.chat-title { font-size:16px; font-weight:600; color:var(--text-bright); }
.btn-header-settings { width:32px; height:32px; border-radius:8px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-secondary); font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition: color 0.15s, border-color 0.15s; }
.btn-header-settings:hover { color:var(--text-bright); border-color:var(--accent); }

.message-list { flex:1; overflow-y:auto; padding:16px 24px; }

.msg-inner { display:flex; flex-direction:column; gap:2px; }

.load-older { text-align:center; padding:8px 0; font-size:12px; color:var(--text-secondary); user-select:none; }
.load-older-hint { opacity:0.6; }

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

/* 角色人格编辑弹窗 */
.editor-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:1000; }
.editor-panel { width:640px; max-height:85vh; background:var(--bg-secondary); border-radius:12px; border:1px solid var(--border); display:flex; flex-direction:column; overflow:hidden; }
.editor-header { padding:16px 20px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
.editor-header span { font-size:15px; font-weight:600; color:var(--text-bright); }
.editor-close { width:32px; height:32px; border-radius:8px; border:none; background:transparent; color:var(--text-secondary); font-size:20px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.editor-close:hover { color:var(--text-bright); background:var(--bg-hover); }
.editor-field { padding:12px 20px 0; display:flex; flex-direction:column; gap:6px; }
.editor-field label { font-size:13px; color:var(--text-secondary); }
.editor-input { padding:8px 12px; font-size:14px; background:var(--bg-primary); border:1px solid var(--border); border-radius:6px; color:var(--text-bright); outline:none; }
.editor-input:focus { border-color:var(--accent); }
.editor-textarea { padding:10px 12px; font-size:13px; line-height:1.6; background:var(--bg-primary); border:1px solid var(--border); border-radius:6px; color:var(--text-bright); outline:none; resize:vertical; font-family:inherit; }
.editor-textarea:focus { border-color:var(--accent); }
.editor-actions { padding:16px 20px; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
.editor-actions-right { display:flex; gap:10px; }
.btn-cancel { padding:8px 18px; border-radius:6px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary); font-size:13px; cursor:pointer; }
.btn-cancel:hover { background:var(--bg-hover); }
.btn-danger { padding:8px 18px; border-radius:6px; border:1px solid #d9534f; background:transparent; color:#d9534f; font-size:13px; cursor:pointer; transition: background 0.15s, color 0.15s; }
.btn-danger:hover { background:#d9534f; color:#fff; }
.btn-danger:disabled { opacity:0.5; cursor:not-allowed; }
</style>
