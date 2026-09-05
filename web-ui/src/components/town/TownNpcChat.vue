<template>
  <div class="npc-chat">
    <div class="nc-head">
      <div class="nc-name">💬 {{ displayName }}</div>
      <linshe-button variant="icon" size="sm" aria-label="关闭" @click="$emit('close')">✕</linshe-button>
    </div>

    <div ref="listEl" class="nc-list">
      <div v-if="loading" class="nc-state">翻着记忆…</div>
      <template v-else>
        <div v-if="messages.length === 0" class="nc-state">这是你们在镇上的第一次交谈</div>
        <div
          v-for="(m, i) in messages" :key="i"
          class="nc-msg" :class="{ 'is-mine': m.role === 'user' }"
        >{{ m.content }}</div>
      </template>
      <div v-if="sending" class="nc-msg is-npc is-typing">（正在回应…）</div>
    </div>

    <div class="nc-input-row">
      <linshe-input
        ref="inputEl"
        v-model="draft"
        size="sm"
        :disabled="sending"
        placeholder="说点什么…"
        maxlength="200"
        @keyup.enter="send"
      />
      <linshe-button variant="primary" size="sm" :loading="sending" @click="send">发送</linshe-button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import * as api from '../../api/index.js'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'

const props = defineProps({
  npcId: { type: Number, required: true },
  displayName: { type: String, default: '' },
})
defineEmits(['close'])

const messages = ref([])
const loading = ref(true)
const sending = ref(false)
const draft = ref('')
const listEl = ref(null)
const inputEl = ref(null)

function scrollBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  })
}

async function load() {
  loading.value = true
  try {
    const data = await api.fetchTownNpcMessages(props.npcId)
    messages.value = data.messages || []
  } catch (err) {
    console.warn('[npc-chat] load failed:', err?.message)
  } finally {
    loading.value = false
    scrollBottom()
  }
}

async function send() {
  const text = draft.value.trim()
  if (!text || sending.value) return
  sending.value = true
  messages.value.push({ role: 'user', content: text })
  draft.value = ''
  scrollBottom()
  try {
    const data = await api.chatWithTownNpc(props.npcId, text)
    messages.value.push({ role: 'npc', content: data.reply })
  } catch (err) {
    messages.value.push({ role: 'npc', content: '（好像没听清，再试一次？）' })
    console.warn('[npc-chat] send failed:', err?.message)
  } finally {
    sending.value = false
    scrollBottom()
  }
}

onMounted(() => {
  load()
  inputEl.value?.focus?.()
})
</script>

<style scoped>
.npc-chat {
  position: absolute;
  right: 14px;
  bottom: 14px;
  width: 320px;
  max-width: calc(100vw - 28px);
  height: 400px;
  max-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  background: #f4f1eeed;
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(54, 42, 38, 0.2);
  overflow: hidden;
  z-index: 60;
}

.nc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
}

.nc-name { font-size: 14px; font-weight: 700; color: var(--text-bright); }

.nc-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nc-state {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  padding: 18px 0;
}

.nc-msg {
  max-width: 82%;
  font-size: 13px;
  line-height: 1.6;
  padding: 8px 12px;
  border-radius: 14px;
  background: #fffdf8;
  border: 1px solid rgba(232, 221, 208, 0.9);
  color: var(--text-primary);
  align-self: flex-start;
  white-space: pre-wrap;
  word-break: break-word;
}

.nc-msg.is-mine {
  align-self: flex-end;
  background: rgba(224, 123, 108, 0.14);
  border-color: transparent;
  color: var(--text-bright);
}

.nc-msg.is-typing { color: var(--text-secondary); font-style: italic; }

.nc-input-row {
  display: flex;
  gap: 8px;
  padding: 10px 12px 12px;
}

.nc-input-row > :first-child { flex: 1; }
</style>
