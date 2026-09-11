<template>
  <TownDialogueStage :display-name="character?.display_name || displayName || '邻居'" :player-name="playerName"
    :portrait-url="character?.standing_url || standingUrl || character?.avatar_path || avatarUrl"
    :player-portrait-url="playerPortraitUrl" :messages="messages" :loading="loading" :sending="sending"
    :blocked="blocked || !settingsReady" :error="error" :draft-restore="draftRestore" :status="status" :has-more-history="hasMoreOlder" :max-length="4000"
    @send="sendWithSettings" @reload="load" @load-older="loadOlder" @close="$emit('close')">
    <template #message="{ message }">
      <details v-if="message.type === 'thinking'" class="tcc-thinking">
        <summary>{{ message.summary || (message.status === 'done' ? '思考记录' : '正在思考…') }}</summary>
        <p>{{ message.content }}</p>
      </details>
      <template v-else-if="message.type === 'event_card'">
        <strong>{{ message.eventData?.title || '奇遇' }}</strong>
        <p>{{ message.eventData?.description || '一段共同的经历' }}</p>
        <img v-if="message.eventData?.image" :src="message.eventData.image" alt="奇遇配图" class="tcc-image">
      </template>
      <template v-else-if="message.type === 'image_gen'">
        <p v-if="message.genStatus !== 'done'" role="status">{{ message.genStatus === 'error' ? '配图暂时未能完成' : '正在准备配图…' }}</p>
        <img v-for="(image, index) in message.images || []" :key="index" :src="imageSource(image)" alt="聊天配图" class="tcc-image">
      </template>
      <template v-else>
        <p v-if="message.content">{{ message.content }}</p>
        <img v-for="(image, index) in message.sticker_images || []" :key="index" :src="imageSource(image)" alt="表情" class="tcc-sticker">
        <small v-if="message.is_delayed_reply">稍后送来的回复</small>
      </template>
    </template>
  </TownDialogueStage>
</template>

<script setup>
import { ref, toRef, onMounted, onBeforeUnmount } from 'vue'
import { useSettingsStore } from '../../stores/settings.js'
import { useTownCharacterChat } from '../../town/dialogue/useTownCharacterChat.js'
import * as api from '../../api/index.js'
import TownDialogueStage from './TownDialogueStage.vue'
const props = defineProps({ characterId: { type: Number, required: true }, displayName: String, standingUrl: String,
  avatarUrl: String, townContext: Object, serviceBusy: Boolean, playerName: { type: String, default: '我' } })
const emit = defineEmits(['close', 'context-invalid'])
const settings = useSettingsStore()
const { loading, error, blocked, sending, messages, character, status, draftRestore, load, send, hasMoreOlder, loadOlder } =
  useTownCharacterChat(toRef(props, 'characterId'), { settings, serviceBusy: toRef(props, 'serviceBusy'), townContext: toRef(props, 'townContext'), onContextInvalid: err => emit('context-invalid', err) })
const playerPortraitUrl = ref(null), settingsReady = ref(false)
function sendWithSettings(text) { if (settingsReady.value) return send(text) }
let disposed = false
function imageSource(image) {
  if (typeof image === 'string') return image
  return image.url || (image.base64 ? `data:image/png;base64,${image.base64}` : undefined)
}
onMounted(async () => {
  await settings.loadComfyConfig()
  if (disposed) return
  settingsReady.value = true
  try {
    const kit = await api.fetchTownPlayerKit()
    const p = kit?.portrait
    if (!disposed && p?.status === 'ready' && p.image_path) playerPortraitUrl.value = `${p.image_path}${p.image_path.includes('?') ? '&' : '?'}v=${encodeURIComponent(p.meta?.updatedAt ?? 0)}`
  } catch { /* Missing player art never blocks the existing conversation. */ }
})
onBeforeUnmount(() => { disposed = true })
</script>

<style scoped>
p { white-space: pre-wrap; line-height: 1.8; margin: 4px 0; overflow-wrap: anywhere; }
.tcc-image { display: block; max-width: 100%; max-height: 240px; object-fit: contain; margin: 8px 0; border-radius: 12px; }
.tcc-sticker { max-width: 100px; max-height: 100px; object-fit: contain; }
.tcc-thinking, small { color: #947f6d; font-size: 12px; }
summary { cursor: pointer; }
</style>
