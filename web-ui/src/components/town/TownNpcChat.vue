<template>
  <section class="npc-chat" role="dialog" :aria-label="`与${displayName}对话`" @keydown.esc.stop="$emit('close')">
    <figure class="nc-portrait nc-portrait-left">
      <img v-if="portraitUrl" :src="portraitUrl" :alt="`${displayName}立绘`">
      <div v-else class="nc-portrait-empty">{{ displayName?.charAt(0) || '邻' }}</div>
      <figcaption>{{ displayName }}</figcaption>
      <linshe-button v-if="portraitUrl" variant="icon" size="sm" class="nc-portrait-zoom" aria-label="放大邻居立绘" @click="zoomed = portraitUrl">⤢</linshe-button>
    </figure>
    <div class="nc-main">
      <svg class="nc-dialog-shape" viewBox="0 0 600 420" preserveAspectRatio="none" aria-hidden="true">
        <path d="M22 15 L216 8 L406 17 L574 11 L589 44 L582 174 L594 360 L574 401 L351 411 L173 400 L23 408 L9 375 L18 209 L8 53 Z" fill="#fffaf1" stroke="#8d7968" stroke-width="2" vector-effect="non-scaling-stroke" />
        <path d="M29 24 L216 18 L405 26 L567 21 M29 392 L173 385 L350 395 L566 387" fill="none" stroke="#e0c9aa" stroke-width="1.5" vector-effect="non-scaling-stroke" />
      </svg>
      <header class="nc-head">
        <div><span class="nc-kicker">小镇 · 相谈</span><div class="nc-name">{{ displayName }}</div></div>
        <linshe-button variant="icon" size="sm" aria-label="关闭对话" @click="$emit('close')">✕</linshe-button>
      </header>
      <div ref="listEl" class="nc-list" role="log" aria-live="polite" aria-label="对话记录">
        <div v-if="loading" class="nc-state">翻着记忆…</div>
        <template v-else>
          <div v-if="messages.length === 0" class="nc-state">这是你们在镇上的第一次交谈</div>
          <div v-for="(m, i) in messages" :key="i" class="nc-msg" :class="{ 'is-mine': m.role === 'user' }">
            <span class="nc-speaker">{{ m.role === 'user' ? playerName : displayName }}</span>
            <p>{{ m.content }}</p>
          </div>
        </template>
        <div v-if="sending" class="nc-msg is-typing">（正在回应…）</div>
      </div>
      <div class="nc-input-row">
        <linshe-input ref="inputEl" v-model="draft" size="sm" :disabled="sending || loading" placeholder="说点什么…" maxlength="200" aria-label="对话内容" @keyup.enter="!$event.isComposing && send()" />
        <linshe-button variant="primary" size="sm" :loading="sending" :disabled="loading || !draft.trim()" @click="send">发送</linshe-button>
      </div>
    </div>
    <figure class="nc-portrait nc-portrait-right">
      <img v-if="playerPortraitUrl" :src="playerPortraitUrl" :alt="`${playerName}立绘`">
      <div v-else class="nc-portrait-empty">我</div>
      <figcaption>{{ playerName }}</figcaption>
      <linshe-button v-if="playerPortraitUrl" variant="icon" size="sm" class="nc-portrait-zoom" aria-label="放大我的立绘" @click="zoomed = playerPortraitUrl">⤢</linshe-button>
    </figure>
    <Teleport to="body">
      <Transition name="town-modal">
        <div v-if="zoomed" class="nc-zoom-mask" @click.self="zoomed = null">
          <div class="nc-zoom" role="dialog" aria-label="立绘">
            <img :src="zoomed" alt="立绘大图">
            <linshe-button variant="icon" size="sm" class="nc-zoom-close" aria-label="关闭立绘" @click="zoomed = null">✕</linshe-button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import * as api from '../../api/index.js'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'

const props = defineProps({
  npcId: { type: Number, required: true },
  displayName: { type: String, default: '' },
  playerName: { type: String, default: '我' },
})
defineEmits(['close'])

const messages = ref([])
const loading = ref(true)
const sending = ref(false)
const draft = ref('')
const listEl = ref(null)
const inputEl = ref(null)
const portraitUrl = ref(null)
const playerPortraitUrl = ref(null)
const zoomed = ref(null)

function scrollBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  })
}

async function load() {
  loading.value = true
  try {
    const [msgData, npcData, kit] = await Promise.all([
      api.fetchTownNpcMessages(props.npcId),
      api.fetchTownNpc(props.npcId).catch(() => null),
      api.fetchTownPlayerKit().catch(() => null),
    ])
    messages.value = msgData.messages || []
    const mine = kit?.portrait
    if (mine?.status === 'ready' && mine.image_path) playerPortraitUrl.value = `${mine.image_path}?v=${mine.meta?.updatedAt ?? 0}`
    const p = npcData?.npc?.portrait
    if (p?.status === 'ready' && p.image_path) {
      portraitUrl.value = `${p.image_path}?v=${p.meta?.updatedAt ?? 0}`
    }
  } catch (err) {
    console.warn('[npc-chat] load failed:', err?.message)
  } finally {
    loading.value = false
    scrollBottom()
    nextTick(() => inputEl.value?.focus?.({ preventScroll: true }))
  }
}

async function send() {
  const text = draft.value.trim()
  if (!text || sending.value || loading.value) return
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
  inputEl.value?.focus?.({ preventScroll: true })
})
</script>

<style scoped>
.npc-chat { position: absolute; inset: auto 0 0; height: min(680px, calc(100% - 108px)); z-index: 60; display: grid; grid-template-rows: minmax(0, 1fr); box-sizing: border-box; grid-template-columns: minmax(0, 1fr) minmax(330px, 540px) minmax(0, 1fr); align-items: end; gap: 8px; padding: 0 18px 24px; pointer-events: none; }
.nc-portrait { pointer-events: auto; position: relative; margin: 0; height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
.nc-portrait img { width: 100%; height: calc(100% - 30px); object-fit: contain; object-position: bottom; filter: drop-shadow(0 8px 16px #362a382e); }
.nc-portrait figcaption { margin-top: 8px; color: #fffaf1; text-shadow: 0 1px 4px #302822; font-size: 14px; }
.nc-portrait-empty { width: 110px; height: 150px; display: grid; place-items: center; color: #8d7968; background: #fffaf1d9; border-radius: 60% 45% 14px 14px; font-size: 36px; }
.nc-portrait-zoom { position: absolute; bottom: 38px; right: 8px; pointer-events: auto; }
.nc-main { box-sizing: border-box; position: relative; isolation: isolate; height: min(420px, 100%); display: flex; flex-direction: column; min-height: 0; padding: 27px 30px 30px; pointer-events: auto; }
.nc-dialog-shape { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; filter: drop-shadow(0 8px 18px #362a3826); pointer-events: none; }
.nc-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 14px; }
.nc-kicker { color: #a1846e; font-size: 10px; letter-spacing: .15em; }
.nc-name { color: #59483d; font-size: 20px; font-weight: 700; margin-top: 4px; }
.nc-list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 16px; padding: 4px 4px 14px; }
.nc-state { margin: auto; font-size: 13px; color: #947f6d; text-align: center; }
.nc-msg { max-width: 92%; align-self: flex-start; color: #574a40; font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; }
.nc-speaker { font-size: 11px; color: #a08062; }
.nc-msg p { margin: 2px 0 0; white-space: pre-wrap; }
.nc-msg.is-mine { align-self: flex-end; text-align: right; }
.nc-msg.is-mine .nc-speaker { color: #ca7567; }
.nc-msg.is-typing { font-style: italic; color: #947f6d; }
.nc-input-row { display: flex; gap: 8px; padding-top: 10px; }
.nc-input-row > :first-child { flex: 1; min-width: 0; }
.nc-zoom-mask { position: fixed; inset: 0; background: #0007; display: grid; place-items: center; z-index: 1100; pointer-events: auto; }
.nc-zoom { position: relative; height: min(86vh, 900px); max-width: calc(100vw - 40px); }
.nc-zoom img { width: 100%; height: 100%; object-fit: contain; }
.nc-zoom-close { position: absolute; right: 10px; top: 10px; }
@container town-world (max-width: 700px) {
  .npc-chat { height: calc(100% - 112px); grid-template-columns: 1fr 1fr; grid-template-rows: minmax(80px, 1fr) minmax(220px, 48%); gap: 0; padding: 0 6px 10px; }
  .nc-main { grid-column: 1 / -1; grid-row: 2; width: 100%; height: 100%; padding: 23px 25px; }
  .nc-portrait { grid-row: 1; height: 100%; padding: 0 8px; }
  .nc-portrait-left { grid-column: 1; } .nc-portrait-right { grid-column: 2; }
  .nc-head { padding-bottom: 6px; } .nc-name { font-size: 17px; }
  .nc-portrait-empty { height: 85px; width: 70px; font-size: 24px; }
}
</style>
