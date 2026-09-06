<template>
  <div class="npc-chat" :class="{ 'with-portrait': !!portraitUrl }">
    <!-- 立绘跳出：聊天时在旁展示（已抠除背景的透明 PNG，悬浮展示） -->
    <div v-if="portraitUrl" class="nc-portrait" aria-hidden="true">
      <img :src="portraitUrl" alt="">
      <linshe-button variant="icon" size="sm" class="nc-portrait-zoom" aria-label="放大立绘" @click="zoomed = true">⤢</linshe-button>
    </div>

    <div class="nc-main">
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

    <!-- 立绘放大 -->
    <Teleport to="body">
      <Transition name="town-modal">
        <div v-if="zoomed" class="nc-zoom-mask" @click.self="zoomed = false">
          <div class="nc-zoom" role="dialog" aria-label="立绘">
            <img :src="portraitUrl" alt="立绘大图">
            <linshe-button variant="icon" size="sm" class="nc-zoom-close" aria-label="关闭" @click="zoomed = false">✕</linshe-button>
          </div>
        </div>
      </Transition>
    </Teleport>
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
const portraitUrl = ref(null)
const zoomed = ref(false)

function scrollBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  })
}

async function load() {
  loading.value = true
  try {
    const [msgData, npcData] = await Promise.all([
      api.fetchTownNpcMessages(props.npcId),
      api.fetchTownNpc(props.npcId).catch(() => null),
    ])
    messages.value = msgData.messages || []
    const p = npcData?.npc?.portrait
    if (p?.status === 'ready' && p.image_path) {
      portraitUrl.value = `${p.image_path}?v=${p.meta?.updatedAt ?? 0}`
    }
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
  overflow: visible;
  z-index: 60;
}

/* 有立绘时聊天面板让出左侧位置，立绘悬浮在旁 */
.npc-chat.with-portrait {
  width: 300px;
}

.nc-portrait {
  position: absolute;
  right: calc(100% - 40px);
  bottom: 0;
  width: 300px;
  height: 560px;
  pointer-events: none;
}

.nc-portrait img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: bottom;
  filter: drop-shadow(0 10px 24px rgba(54, 42, 38, 0.28));
}

.nc-portrait-zoom {
  position: absolute;
  left: 6px;
  top: 6px;
  pointer-events: auto;
}

.nc-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #f4f1eeed;
  border-radius: 16px;
  overflow: hidden;
  min-height: 0;
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

.nc-zoom-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.nc-zoom {
  position: relative;
  height: min(86vh, 900px);
  aspect-ratio: 9 / 16;
  max-width: calc(100vw - 40px);
  background: #efe9de;
  border-radius: 18px;
  box-shadow: 0 20px 60px rgba(54, 42, 38, 0.25);
  overflow: hidden;
}

.nc-zoom img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: bottom;
}

.nc-zoom-close {
  position: absolute;
  top: 10px;
  right: 10px;
}
</style>
