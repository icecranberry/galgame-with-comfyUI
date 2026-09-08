<template>
  <TownDialogueStage :display-name="displayName" :player-name="playerName" :portrait-url="portraitUrl"
    :player-portrait-url="playerPortraitUrl" :messages="messages" :loading="loading" :sending="sending"
    :blocked="blocked || serviceBusy || admissionBusy" :status="serviceBusy || admissionBusy ? '正在提供工坊服务，请稍后再交谈。' : ''" :error="error" :retryable="retryable" :draft-restore="draftRestore"
    :show-activity="showActivity" @activity="$emit('activity')" @send="send" @retry="retry" @reload="load" @close="$emit('close')" />
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import * as api from '../../api/index.js'
import { npcTurnKey, getNpcPendingTurn, createNpcPendingTurn, forgetNpcPendingTurn } from '../../town/dialogue/npcPendingTurns.js'
import TownDialogueStage from './TownDialogueStage.vue'
const props = defineProps({ npcId: { type: Number, required: true }, displayName: String, playerName: String, worldId: String, worldEpoch: Number, serviceBusy: Boolean, showActivity: Boolean })
const emit = defineEmits(['close', 'character-chat', 'context-invalid', 'activity'])
const messages = ref([]), loading = ref(true), sending = ref(false), blocked = ref(true), error = ref('')
const portraitUrl = ref(null), playerPortraitUrl = ref(null), draftRestore = ref(null), pendingTurn = ref(null)
const admissionBusy = ref(false)
const retryable = computed(() => pendingTurn.value?.status === 'pending' && !props.serviceBusy && !admissionBusy.value)
const scopeKey = () => npcTurnKey(props.npcId, props.worldId, props.worldEpoch)
let generation = 0
const portrait = asset => asset?.status === 'ready' && asset.image_path
  ? `${asset.image_path}${asset.image_path.includes('?') ? '&' : '?'}v=${encodeURIComponent(asset.meta?.updatedAt ?? 0)}` : null
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
    messages.value = history.messages || []
    playerPortraitUrl.value = portrait(kit?.portrait)
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
watch(() => [props.npcId, props.worldId, props.worldEpoch], () => {
  messages.value = []; portraitUrl.value = null; playerPortraitUrl.value = null; sending.value = false; pendingTurn.value = null; admissionBusy.value = false
  load()
}, { immediate: true })
onBeforeUnmount(() => { generation++ })
</script>
