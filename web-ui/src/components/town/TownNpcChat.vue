<template>
  <TownDialogueStage :display-name="displayName" :player-name="playerName" :portrait-url="portraitUrl"
    :player-portrait-url="playerPortraitUrl" :messages="messages" :loading="loading" :sending="sending"
    :blocked="blocked || serviceBusy || admissionBusy" :status="serviceBusy || admissionBusy ? '正在提供工坊服务，请稍后再交谈。' : ''" :error="error" :retryable="retryable" :draft-restore="draftRestore"
    :show-activity="showActivity" :actions="actions" @activity="$emit('activity')" @action="onAction"
    @send="send" @retry="retry" @reload="load" @close="$emit('close')">
    <template #message="{ message }">
      <div v-if="message.kind === 'quest-offer'" class="tq-offer">
        <strong>{{ displayName }}有件事想托付给你</strong>
        <p class="tq-intro">「{{ message.quest.title }}」{{ message.quest.intro }}</p>
        <p class="tq-muted">报酬：{{ questReward(message.quest) }} · 邀约保留至 {{ questDeadline(message.quest.offerExpiresAt) }}</p>
        <div class="tq-actions">
          <linshe-button variant="primary" size="sm" :loading="questBusy" :disabled="questBusy" @click="acceptQuest(message.quest)">接下这份托付</linshe-button>
          <linshe-button variant="ghost" size="sm" :disabled="questBusy" @click="questOffer = null">婉拒</linshe-button>
        </div>
        <p v-if="questNotice" role="status">{{ questNotice }}</p>
        <p v-else-if="questError" class="tq-error" role="alert">{{ questError }}</p>
      </div>
      <p v-else>{{ message.content }}</p>
    </template>
  </TownDialogueStage>
  <TownNpcTradePanel :npc-id="npcId" :display-name="displayName" :world-id="worldId" :world-epoch="worldEpoch"
    :open="tradeOpen" @close="tradeOpen = false" />
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import * as api from '../../api/index.js'
import { npcTurnKey, getNpcPendingTurn, createNpcPendingTurn, forgetNpcPendingTurn } from '../../town/dialogue/npcPendingTurns.js'
import TownDialogueStage from './TownDialogueStage.vue'
import TownNpcTradePanel from './TownNpcTradePanel.vue'
import LinsheButton from '../ui/LinsheButton.vue'
const props = defineProps({ npcId: { type: Number, required: true }, displayName: String, playerName: String, worldId: String, worldEpoch: Number, serviceBusy: Boolean, showActivity: Boolean })
const emit = defineEmits(['close', 'character-chat', 'context-invalid', 'activity'])
const historyMessages = ref([]), loading = ref(true), sending = ref(false), blocked = ref(true), error = ref('')
const portraitUrl = ref(null), playerPortraitUrl = ref(null), draftRestore = ref(null), pendingTurn = ref(null)
const admissionBusy = ref(false)
// 奇遇邀约：聊天回应里带出的托付，当场接下或婉拒；接下后去「奇遇」手账看进度。
const questOffer = ref(null), questBusy = ref(false), questNotice = ref(''), questError = ref('')
// NPC 功能点：给任务 / 送东西 / 做买卖；动作在对话舞台底部一行按钮里。
const npcFunctions = ref(null), tradeOpen = ref(false), giftBusy = ref(false)
const actions = computed(() => {
  const list = []
  if (npcFunctions.value?.functions?.quest_giver) list.push({ key: 'quest', label: '有能帮上忙的事吗' })
  if (npcFunctions.value?.functions?.gift_giver) list.push({ key: 'gift', label: '讨一份心意' })
  if (npcFunctions.value?.functions?.trader) list.push({ key: 'trade', label: '做点小买卖' })
  return list
})
async function onAction(key) {
  if (key === 'trade') { tradeOpen.value = true; return }
  if (key === 'quest') {
    questError.value = ''; questNotice.value = ''
    try {
      const data = await api.askTownNpcQuestOffer(props.npcId, { worldEpoch: props.worldEpoch })
      if (data?.questOffer) { questOffer.value = data.questOffer; questNotice.value = ''; }
      else questNotice.value = 'TA现在没有想托付的事，聊聊天也好。'
    } catch (err) {
      questError.value = ({ QUEST_ACTIVE_LIMIT: '已经有进行中的奇遇了，先完成它再说。', NOT_ARRIVED: '先走到TA身边再问问看。',
        ECONOMY_DISABLED: '小镇经济暂未开启。' })[err.code] || err.message || '没有打听到新差事。'
    }
    return
  }
  if (key === 'gift') {
    if (giftBusy.value) return
    giftBusy.value = true; questError.value = ''
    try {
      const result = await api.receiveTownNpcGift(props.npcId, { worldEpoch: props.worldEpoch })
      historyMessages.value = [...historyMessages.value,
        { id: `gift:${result.itemId}`, role: 'npc', content: `（把一份「${result.templateName}」塞到你手里）拿着吧，别客气。` }]
    } catch (err) {
      questError.value = ({ NOT_A_GIFT_GIVER: '这位邻居没有随身带礼物的习惯。', GIFT_COOLDOWN: '今天已经送过东西了，改天再来。',
        ECONOMY_DISABLED: '小镇经济暂未开启。' })[err.code] || err.message || '这次没有收到心意。'
    } finally { giftBusy.value = false }
  }
}
const retryable = computed(() => pendingTurn.value?.status === 'pending' && !props.serviceBusy && !admissionBusy.value)
const scopeKey = () => npcTurnKey(props.npcId, props.worldId, props.worldEpoch)
let generation = 0
const portrait = asset => asset?.status === 'ready' && asset.image_path
  ? `${asset.image_path}${asset.image_path.includes('?') ? '&' : '?'}v=${encodeURIComponent(asset.meta?.updatedAt ?? 0)}` : null
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
async function acceptQuest(quest) {
  if (questBusy.value || !props.worldId || !Number.isSafeInteger(props.worldEpoch)) return
  questBusy.value = true; questNotice.value = ''; questError.value = ''
  try {
    const command = api.createTownLifeCommand('quest_accept', { worldId: props.worldId, worldEpoch: props.worldEpoch, questId: quest.questId })
    await api.executeTownLifeCommand(command)
    questOffer.value = null
    questNotice.value = '接下了！打开顶栏的「奇遇」手账就能看到进度。'
  } catch (err) {
    questError.value = ({ QUEST_ACTIVE_LIMIT: '已经有进行中的奇遇了，先完成它再说。', QUEST_STATE_CONFLICT: '这份邀约的状态已变化，请重新读取。',
      OFFER_EXPIRED: '这份邀约已过期。', ECONOMY_DISABLED: '小镇经济暂未开启，暂时接不了托付。' })[err.code] || err.message || '没有接下这份托付。'
    if (['QUEST_STATE_CONFLICT', 'OFFER_EXPIRED', 'QUEST_ACTIVE_LIMIT'].includes(err.code)) questOffer.value = null
  } finally { questBusy.value = false }
}
async function load() {
  if (sending.value) return
  const current = ++generation, id = props.npcId, key = scopeKey()
  loading.value = true
  blocked.value = true
  error.value = ''
  try {
    // Resolve identity before touching NPC history: linked residents use the original character pipeline.
    const data = await api.fetchTownNpc(id)
    if (current !== generation) return
    if (!data.npc) throw new Error('NPC unavailable')
    if (data.npc.characterId) { emit('character-chat', data.npc.characterId); return }
    portraitUrl.value = portrait(data.npc.portrait)
    const [history, kit] = await Promise.all([api.fetchTownNpcMessages(id), api.fetchTownPlayerKit().catch(() => null)])
    if (current !== generation) return
    historyMessages.value = history.messages || []
    playerPortraitUrl.value = portrait(kit?.portrait)
    // 功能点：决定对话舞台底部有哪些动作按钮；失败就不显示按钮，不影响聊天。
    api.fetchTownNpcFunctions(id).then(data => { if (current === generation) npcFunctions.value = data }).catch(() => { npcFunctions.value = null })
    const turn = getNpcPendingTurn(key)
    if (turn?.status === 'failed' || turn?.status === 'completed') forgetNpcPendingTurn(key, turn)
    pendingTurn.value = getNpcPendingTurn(key) || null
    blocked.value = !!pendingTurn.value
    if (pendingTurn.value) error.value = `这条消息尚未确认（${pendingTurn.value.text}）。可重试同一条消息查看结果。`
  } catch {
    if (current === generation) error.value = '暂时无法读取对话，请重新读取后再发送。'
  } finally {
    if (current === generation) loading.value = false
  }
}
async function run(turn) {
  if (sending.value || loading.value || props.serviceBusy || admissionBusy.value) return
  const current = generation, id = props.npcId, key = scopeKey()
  sending.value = true; blocked.value = true; error.value = ''
  try {
    // A reopened stage can join the same in-flight request; explicit retries reuse its stable ID.
    if (!turn.promise) turn.promise = api.chatWithTownNpc(id, turn.text, turn.options).finally(() => { turn.promise = null })
    const data = await turn.promise
    if (!data.reply) throw new Error('Empty reply')
    turn.status = 'completed'
    if (current !== generation) return
    // 奇遇邀约随回应带出；同一分钟内的重复聊天会拿到同一份邀约（服务端幂等）。
    questOffer.value = data.questOffer || null
    questNotice.value = ''; questError.value = ''
    // Always reconcile the original history, including completed responses replayed by request ID.
    sending.value = false
    await load()
  } catch (err) {
    if (err.code === 'DIALOGUE_FAILED') turn.status = 'failed'
    if (err.code === 'NPC_BUSY') turn.status = 'failed'
    if (current !== generation) return
    if (err.characterId) { forgetNpcPendingTurn(key, turn); emit('character-chat', err.characterId); return }
    if (err.code === 'NPC_BUSY') {
      admissionBusy.value = true
      draftRestore.value = { text: turn.text }
      error.value = '居民正在提供工坊服务，请稍后重新打开对话。'
      emit('context-invalid', err)
    } else if (err.code === 'DIALOGUE_FAILED') {
      error.value = '这条消息未完成，请先重新读取记录，再手动发送新消息。'
      draftRestore.value = { text: turn.text }
    } else if (err.code === 'STALE_WORLD') {
      turn.status = 'invalid'
      emit('context-invalid', err)
      error.value = '小镇已变化，请关闭对话后重新选择邻居。'
    } else {
      error.value = err.code === 'DIALOGUE_PROCESSING' ? '邻居仍在回应，可稍后重试同一条消息。' : `未能确认发送结果（${turn.text}）。可重试同一条消息查看结果。`
    }
  } finally {
    if (current === generation) sending.value = false
  }
}
function send(text) {
  if (sending.value || loading.value || blocked.value || props.serviceBusy || admissionBusy.value || !text.trim()) return
  const turn = createNpcPendingTurn(scopeKey(), text, { worldId: props.worldId, worldEpoch: props.worldEpoch })
  pendingTurn.value = turn
  return run(turn)
}
function retry() { if (retryable.value) return run(pendingTurn.value) }
const messages = computed(() => [
  ...historyMessages.value,
  ...(questOffer.value ? [{ id: 'quest-offer', role: 'npc', kind: 'quest-offer', quest: questOffer.value, content: '' }] : []),
])
watch(() => [props.npcId, props.worldId, props.worldEpoch], () => {
  historyMessages.value = []; portraitUrl.value = null; playerPortraitUrl.value = null; sending.value = false; pendingTurn.value = null; admissionBusy.value = false
  questOffer.value = null; questNotice.value = ''; questError.value = ''
  load()
}, { immediate: true })
onBeforeUnmount(() => { generation++ })
</script>

<style scoped>
.tq-offer { background: #f7efe4; border: 1px solid #e6d5bf; border-radius: 12px; padding: 10px 12px; margin: 4px 0; }
.tq-offer strong { font-size: 14px; font-weight: 600; }
.tq-intro { font-size: 13px; line-height: 1.7; }
.tq-muted { font-size: 12px; color: #947f6d; }
.tq-error { font-size: 12px; color: #ad5147; }
.tq-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.tq-offer p[role='status'] { font-size: 12px; color: #779078; }
</style>
