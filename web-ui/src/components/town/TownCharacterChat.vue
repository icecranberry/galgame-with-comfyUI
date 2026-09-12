<template>
  <!-- 立绘与 NPC 同口径：小镇立绘素材（standingUrl）优先，缺失才回退酒馆立绘 / 头像 -->
  <TownDialogueStage :display-name="character?.display_name || displayName || '邻居'" :player-name="playerName"
    :portrait-url="standingUrl || character?.standing_url || character?.avatar_path || avatarUrl"
    :player-portrait-url="playerPortraitUrl" :messages="stageMessages" :loading="loading" :sending="sending"
    :blocked="blocked || !settingsReady" :error="error" :draft-restore="draftRestore" :status="status" :has-more-history="hasMoreOlder" :max-length="4000"
    :show-activity="showActivity" :actions="actions" @action="onAction"
    @send="sendWithSettings" @reload="load" @load-older="loadOlder" @activity="$emit('activity')" @close="$emit('close')">
    <template #message="{ message }">
      <div v-if="message.type === 'quest-offer'" class="tq-offer">
        <strong>{{ character?.display_name || displayName || '邻居' }}有件事想托付给你</strong>
        <p class="tq-intro">「{{ message.quest.title }}」{{ message.quest.intro }}</p>
        <p class="tq-muted">报酬：{{ questReward(message.quest) }} · 邀约保留至 {{ questDeadline(message.quest.offerExpiresAt) }}</p>
        <div class="tq-actions">
          <linshe-button variant="primary" size="sm" :loading="questBusy" :disabled="questBusy" @click="acceptQuest(message.quest)">接下这份托付</linshe-button>
          <linshe-button variant="ghost" size="sm" :disabled="questBusy" @click="questOffer = null">婉拒</linshe-button>
        </div>
        <p v-if="questNotice" role="status">{{ questNotice }}</p>
        <p v-else-if="questError" class="tq-error" role="alert">{{ questError }}</p>
      </div>
      <details v-else-if="message.type === 'thinking'" class="tcc-thinking">
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
import { ref, computed, toRef, onMounted, onBeforeUnmount } from 'vue'
import { useSettingsStore } from '../../stores/settings.js'
import { useTownCharacterChat } from '../../town/dialogue/useTownCharacterChat.js'
import * as api from '../../api/index.js'
import TownDialogueStage from './TownDialogueStage.vue'
import LinsheButton from '../ui/LinsheButton.vue'
const props = defineProps({ characterId: { type: Number, required: true }, displayName: String, standingUrl: String,
  avatarUrl: String, townContext: Object, serviceBusy: Boolean, showActivity: Boolean, playerName: { type: String, default: '我' } })
const emit = defineEmits(['close', 'context-invalid', 'activity'])
const settings = useSettingsStore()
const { loading, error, blocked, sending, messages, character, status, draftRestore, load, send, hasMoreOlder, loadOlder } =
  useTownCharacterChat(toRef(props, 'characterId'), { settings, serviceBusy: toRef(props, 'serviceBusy'), townContext: toRef(props, 'townContext'), onContextInvalid: err => emit('context-invalid', err) })
const playerPortraitUrl = ref(null), settingsReady = ref(false)
// 奇遇邀约：入住角色与镇上居民共用同一套托付入口（服务端经 town_npcs.character_id 反查档案）。
const questOffer = ref(null), questBusy = ref(false), questNotice = ref(''), questError = ref('')
const actions = [{ key: 'quest', label: '有能帮上忙的事吗' }]
const stageMessages = computed(() => [
  ...messages.value,
  ...(questOffer.value ? [{ id: 'quest-offer', role: 'npc', type: 'quest-offer', quest: questOffer.value, content: '' }] : []),
])
function questReward(quest) {
  const parts = []
  if ((quest.rewards?.coins ?? 0) > 0) parts.push(`${quest.rewards.coins} 邻币`)
  for (const item of quest.rewards?.items || []) parts.push(`${item.name || item.templateId}×${item.count ?? 1}`)
  return parts.join(' + ') || '一份心意'
}
function questDeadline(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '待确认' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
}
async function onAction(key) {
  if (key !== 'quest' || questBusy.value) return
  questError.value = ''; questNotice.value = ''
  try {
    const data = await api.askTownCharacterQuestOffer(props.characterId, { worldEpoch: props.townContext?.worldEpoch })
    if (data?.questOffer) questOffer.value = data.questOffer
    else questNotice.value = 'TA现在没有想托付的事，聊聊天也好。'
  } catch (err) {
    questError.value = ({ QUEST_ACTIVE_LIMIT: '已经有进行中的奇遇了，先完成它再说。', NOT_ARRIVED: '先走到TA身边再问问看。',
      NPC_NOT_FOUND: '这位角色还没有镇上档案。', ECONOMY_DISABLED: '小镇经济暂未开启。' })[err.code] || err.message || '没有打听到新差事。'
  }
}
async function acceptQuest(quest) {
  if (questBusy.value || !props.townContext?.worldId || !Number.isSafeInteger(props.townContext?.worldEpoch)) return
  questBusy.value = true; questNotice.value = ''; questError.value = ''
  try {
    const command = api.createTownLifeCommand('quest_accept', { worldId: props.townContext.worldId,
      worldEpoch: props.townContext.worldEpoch, questId: quest.questId })
    await api.executeTownLifeCommand(command)
    questOffer.value = null
    questNotice.value = '接下了！打开顶栏的「奇遇」手账就能看到进度。'
  } catch (err) {
    questError.value = ({ QUEST_ACTIVE_LIMIT: '已经有进行中的奇遇了，先完成它再说。', QUEST_STATE_CONFLICT: '这份邀约的状态已变化，请重新读取。',
      OFFER_EXPIRED: '这份邀约已过期。', ECONOMY_DISABLED: '小镇经济暂未开启，暂时接不了托付。' })[err.code] || err.message || '没有接下这份托付。'
    if (['QUEST_STATE_CONFLICT', 'OFFER_EXPIRED', 'QUEST_ACTIVE_LIMIT'].includes(err.code)) questOffer.value = null
  } finally { questBusy.value = false }
}
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
.tq-offer { background: #f7efe4; border: 1px solid #e6d5bf; border-radius: 12px; padding: 10px 12px; margin: 4px 0; }
.tq-offer strong { font-size: 14px; font-weight: 600; }
.tq-intro { font-size: 13px; line-height: 1.7; }
.tq-muted { font-size: 12px; color: #947f6d; }
.tq-error { font-size: 12px; color: #ad5147; }
.tq-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.tq-offer p[role='status'] { font-size: 12px; color: #779078; }
</style>
