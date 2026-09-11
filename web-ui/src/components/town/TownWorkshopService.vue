<template>
  <Teleport to="body">
    <div ref="overlay" class="tws-overlay" @keydown.stop @keyup.stop @pointerdown.stop @click.stop @wheel.stop @touchstart.stop @touchmove.stop>
      <div class="tws-stage-host" :class="{ 'tws-static': !canClarify }">
        <town-dialogue-stage :display-name="`${providerName} · 工坊`" :messages="messages" :loading="loading" :sending="sending"
          :blocked="!canClarify" :max-length="500" :status="statusText" :error="error" :retryable="!!pending && fresh"
          @close="$emit('close')" @reload="refresh" @retry="retry" @send="clarify">
          <template #message="{ message }">
            <template v-if="message.kind === 'current'">
              <div v-if="!session && !pending" class="tws-actions" role="group" aria-label="选择工坊服务">
                <linshe-button v-for="item in serviceOptions" :key="item.serviceKey" variant="chip" size="sm"
                  :active="selectedServiceKey === item.serviceKey" :disabled="locked || !item.available"
                  @click="selectedServiceKey = item.serviceKey">{{ item.name }}</linshe-button>
              </div>
              <p v-if="!session && !pending" class="tws-muted">解锁仅表示可选；报价和接受仍需营业、实际到场及足够邻币。</p>
              <p v-if="!session && !pending && !bobAvailable" class="tws-muted">波波头发型卡：首次工坊生产真实完成后解锁。</p>
              <p><strong>{{ serviceName }}</strong></p>
              <p v-if="serviceDescription" class="tws-muted">{{ serviceDescription }}</p>
              <p>{{ currentDialogue }}</p>
              <p v-if="isBob" class="tws-muted">获得的是发型卡；在原有背包手动使用后，波波头发型生效 24 小时。不会自动换发型或生图，本次不新增免费回访。</p>
              <p v-if="serviceHours || typeof serviceOpen === 'boolean'" class="tws-muted">
                <span v-if="typeof serviceOpen === 'boolean'">{{ serviceOpen ? '工坊营业中' : ['active', 'resolving', 'settling'].includes(session?.status) ? '新服务暂未开放；本次服务按当前会话继续' : '工坊暂未营业，请稍后再来' }}</span>
                <span v-if="serviceHours"> · {{ serviceHours }}</span>
              </p>
              <p v-if="!economyEnabled" class="tws-muted">新服务已暂停。已接受的服务仍可继续或取消。</p>
              <div v-if="!terminal" class="tws-policy" aria-label="服务收费与退款规则">
                <strong>{{ serviceName }} · 30 邻币 · 1 份材料</strong>
                <p>制作前取消全退 30；开始制作后收取 10，退回 20；系统失败全退 30。</p>
                <p v-if="session?.phaseKey === 'materials' && session.status === 'active'">点击「确认材料并开始制作」后，将适用收取 10 邻币的取消规则。</p>
              </div>
              <p v-if="pending" class="tws-muted">有一次操作等待确认。重新读取不会重发；重试沿用原请求。</p>
              <div v-if="pending" class="tws-actions">
                <linshe-button size="sm" :disabled="loading || sending || !fresh" @click="retry">重试同一次服务操作</linshe-button>
                <linshe-button v-if="rejected" variant="link" size="sm" :disabled="loading || sending || !fresh" @click="discard">使用最新服务状态</linshe-button>
              </div>
              <div v-else-if="!session" class="tws-actions">
                <linshe-button variant="primary" size="sm" :disabled="locked || !economyEnabled || serviceOpen === false || !selectedAvailable" @click="submit('service_offer')">查看本次报价（不收费）</linshe-button>
              </div>
              <div v-else-if="session.status === 'offered'" class="tws-actions">
                <linshe-button variant="primary" size="sm" :disabled="locked || !economyEnabled" @click="submit('service_accept')">接受服务并支付 30 邻币</linshe-button>
                <linshe-button variant="ghost" size="sm" :disabled="locked" @click="cancelConfirm = true">谢绝本次服务</linshe-button>
              </div>
              <template v-else-if="session.status === 'active'">
                <p class="tws-muted">{{ phaseNames[session.phaseKey] || '服务进行中' }} · 第 {{ session.turnCount }} / {{ session.template?.maxTurns ?? 8 }} 回合</p>
                <div class="tws-actions">
                  <linshe-button v-for="choice in actionChoices" :key="choice" size="sm" :disabled="locked" @click="submit('service_turn', choice)">{{ choiceLabel(choice) }}</linshe-button>
                  <linshe-button v-if="session.choices?.includes('cancel')" variant="link" size="sm" :disabled="locked" @click="cancelConfirm = true">取消服务</linshe-button>
                </div>
                <p v-if="canClarify" class="tws-muted">也可以在下方补充主题或说明；发送一次会占用一回合。</p>
              </template>
              <p v-else-if="['resolving', 'settling'].includes(session.status)" role="status">{{ session.status === 'resolving' ? '工坊正在处理本回合，请稍后重新读取。' : '正在结算，请稍后重新读取收据。' }}</p>
              <div v-if="cancelConfirm && !pending" class="tws-policy" role="group" aria-label="确认取消服务">
                <p>{{ session?.status === 'offered' ? '尚未收费，确认谢绝本次报价？' : session?.materialsConsumed ? '取消将收取 10 邻币，并退回 20 邻币。' : '尚未开始制作，取消将退回全部 30 邻币。' }}</p>
                <div class="tws-actions"><linshe-button variant="danger" size="sm" :disabled="locked" @click="submit('service_cancel')">确认取消服务</linshe-button><linshe-button variant="ghost" size="sm" @click="cancelConfirm = false">继续服务</linshe-button></div>
              </div>
              <section v-if="session && terminal" aria-label="服务结算收据" class="tws-receipt">
                <strong>{{ statusNames[session.status] }}</strong>
                <template v-if="session.settlement">
                  <p>已支付 {{ session.settlement.paid }} · 服务费用 {{ session.settlement.payout }} · 已退回 {{ session.settlement.refund }} 邻币</p>
                  <p v-if="session.settlement.itemIds?.length">已获得 {{ session.settlement.itemIds.length }} 件道具。请回到原有背包查看和使用。</p>
                  <p v-else>本次没有发放道具。</p>
                </template>
                <p v-else>收据尚未读取完成，请重新读取确认退款与道具。</p>
              </section>
              <div class="tws-actions tws-read"><linshe-button variant="ghost" size="sm" :disabled="loading || sending" @click="refresh">重新读取服务</linshe-button><linshe-button variant="link" size="sm" @click="$emit('chat')">先和{{ providerName }}聊两句</linshe-button><linshe-button variant="link" size="sm" @click="$emit('close')">回到小镇</linshe-button></div>
            </template>
            <p v-else>{{ message.content }}</p>
          </template>
        </town-dialogue-stage>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import TownDialogueStage from './TownDialogueStage.vue'
import LinsheButton from '../ui/LinsheButton.vue'
import { getTownEconomy, getTownServiceSession, createTownLifeCommand, executeTownLifeCommand, getPendingTownLifeCommand, savePendingTownLifeCommand } from '../../api/index.js'
const props = defineProps({ worldId: { type: String, required: true }, worldEpoch: { type: Number, required: true },
  sessionId: { type: String, default: null }, providerName: { type: String, default: '邻居' } })
const emit = defineEmits(['close', 'changed', 'chat'])
const session = ref(null), loading = ref(false), sending = ref(false), fresh = ref(false), error = ref('')
const economyEnabled = ref(false)
const serviceOpen = ref(null), serviceHours = ref('')
const catalog = ref(null), selectedServiceKey = ref('town.workshop')
const serviceOptions = computed(() => [
  { serviceKey: 'town.workshop', name: '心情修复贴' },
  { serviceKey: 'town.workshop.bob_cut', name: '波波头发型卡' },
].map(item => ({ ...item, available: catalog.value ? catalog.value.find(entry => entry.serviceKey === item.serviceKey)?.available === true : item.serviceKey === 'town.workshop' })))
const bobAvailable = computed(() => serviceOptions.value[1].available)
const selectedAvailable = computed(() => serviceOptions.value.find(item => item.serviceKey === selectedServiceKey.value)?.available === true)
// A restored session is authoritative; a pending offer keeps its original selection.
const effectiveServiceKey = computed(() => session.value ? session.value.serviceKey || 'town.workshop'
  : pending.value?.kind === 'service_offer' ? pending.value.body.serviceKey || 'town.workshop' : selectedServiceKey.value)
const isBob = computed(() => effectiveServiceKey.value === 'town.workshop.bob_cut')
const serviceName = computed(() => session.value?.serviceName || (isBob.value ? '波波头发型卡' : '心情修复贴'))
const serviceDescription = computed(() => session.value ? session.value.serviceDescription || ''
  : catalog.value?.find(item => item.serviceKey === effectiveServiceKey.value)?.description || '')
function choiceLabel(choice) { return choice === 'deliver' ? `收下${serviceName.value}` : choiceNames[choice] }
const pending = ref(getPendingTownLifeCommand('workshop')), rejected = ref(false), cancelConfirm = ref(false), stale = ref(false)
const scope = ref({ worldId: props.worldId, worldEpoch: props.worldEpoch })
const phaseNames = { theme: '挑选主题', materials: '确认材料', crafting: '共同制作', delivery: '收下成品' }
const statusNames = { completed: '制作完成', cancelled: '服务已取消', failed: '服务未完成', expired: '服务已结束' }
const choiceNames = { choose_theme: '选好主题，继续', confirm_materials: '确认材料并开始制作', craft: '完成制作', deliver: '收下心情修复贴' }
const terminal = computed(() => !!statusNames[session.value?.status])
const locked = computed(() => loading.value || sending.value || !!pending.value || !fresh.value || stale.value)
const canClarify = computed(() => !locked.value && session.value?.status === 'active' && session.value?.choices?.includes('clarify'))
const actionChoices = computed(() => (session.value?.choices || []).filter(choice => Object.hasOwn(choiceNames, choice)))
const currentDialogue = computed(() => terminal.value ? `${statusNames[session.value.status]}。以下为本次服务的结算结果。`
  : session.value?.turns?.at(-1)?.response?.dialogue || session.value?.dialogue || `一起制作${serviceName.value}吧。先了解报价，确认接受后才会收费。`)
const statusText = computed(() => stale.value ? '小镇已更新，请回到小镇里重新进店。' : terminal.value ? '本次服务已结束，关闭面板不会再收费。' : '关闭只收起面板，不会自动取消服务。')
const messages = computed(() => [
  ...(session.value?.turns || []).flatMap((turn, index, turns) => [
    { id: `${turn.clientTurnId}:user`, role: 'user', content: turn.input?.text || choiceLabel(turn.input?.intentKey) || '继续服务' },
    ...(turn.response?.dialogue && index !== turns.length - 1 ? [{ id: turn.clientTurnId, role: 'npc', content: turn.response.dialogue }] : []),
  ]),
  { id: 'current', role: 'npc', kind: 'current', content: session.value?.dialogue || '' },
])
let alive = true, reads = 0, lifecycle = 0
const overlay = ref(null)
watch([loading, sending, session, pending], async () => {
  await nextTick()
  if (alive && document.activeElement === document.body) overlay.value?.querySelector('.town-dialogue-stage')?.focus({ preventScroll: true })
})
function errorMessage(e) {
  return ({ NOT_ARRIVED: '请先到达工坊，并等待服务居民到场，再重试。', INSUFFICIENT_FUNDS: '可用邻币不足 30，请先完成配送委托。',
    INVALID_SERVICE_KEY: '暂不支持此工坊服务，请重新读取。', SERVICE_LOCKED: '首次工坊生产真实完成后才会解锁，请重新读取状态。', SERVICE_NOT_OPEN: '工坊暂未营业，请稍后再来。', VERSION_CONFLICT: '服务状态已变化，请读取后使用最新服务状态。',
    SESSION_BUSY: '本回合正在处理中，请稍后重新读取。', SESSION_CLOSED: '服务已结束，请重新读取收据。' })[e.code] || e.message || '服务操作未完成。'
}
function clearPending() { pending.value = null; savePendingTownLifeCommand(null, 'workshop'); rejected.value = false }
async function refresh() {
  const sequence = ++reads, generation = lifecycle; loading.value = true; fresh.value = false
  const current = () => alive && generation === lifecycle && sequence === reads
  if (!pending.value) error.value = ''
  try {
    const overview = await getTownEconomy()
    if (!current()) return
    economyEnabled.value = overview.enabled === true
    catalog.value = Array.isArray(overview.service?.catalog) ? overview.service.catalog : null
    serviceOpen.value = overview.service?.open ?? null; serviceHours.value = overview.service?.hours || ''
    if (overview.worldId !== scope.value.worldId || overview.worldEpoch !== scope.value.worldEpoch) {
      clearPending(); stale.value = true; session.value = null; error.value = '小镇已更新，旧服务操作已停止。请回到小镇里重新进店。'; return
    }
    pending.value = getPendingTownLifeCommand('workshop')
    if (!pending.value) rejected.value = false
    if (pending.value && (pending.value.worldId !== overview.worldId || pending.value.body.worldEpoch !== overview.worldEpoch)) clearPending()
    const sessionId = props.sessionId || session.value?.sessionId
    const data = sessionId ? await getTownServiceSession(sessionId) : null
    if (!current()) return
    if (data && (data.worldId !== scope.value.worldId || data.worldEpoch !== scope.value.worldEpoch)) throw new Error('服务状态与当前小镇不一致，请重新读取。')
    if (data) session.value = data
    fresh.value = true
  } catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) loading.value = false }
}
function submit(kind, intentKey, text = '') {
  if (locked.value || (['service_offer', 'service_accept'].includes(kind) && !economyEnabled.value)) return
  if (kind === 'service_offer' && (!selectedAvailable.value || serviceOpen.value === false)) return
  if (kind === 'service_turn' && !session.value?.choices?.includes(intentKey)) return
  const command = createTownLifeCommand(kind, { ...scope.value, sessionId: session.value?.sessionId,
    expectedVersion: session.value?.version, serviceKey: kind === 'service_offer' ? selectedServiceKey.value : undefined, intentKey, text })
  pending.value = command; savePendingTownLifeCommand(command, 'workshop'); run(command)
}
function clarify(text) { if (canClarify.value) submit('service_turn', 'clarify', text) }
function retry() { if (pending.value && fresh.value && !stale.value) run(pending.value) }
function discard() { if (rejected.value && fresh.value && !sending.value) { clearPending(); error.value = '' } }
async function run(command) {
  if (!fresh.value || loading.value || sending.value || stale.value || command.body.idempotencyKey !== pending.value?.body.idempotencyKey) return
  const generation = lifecycle
  const current = () => alive && generation === lifecycle
  sending.value = true; rejected.value = false; error.value = ''
  try {
    const data = await executeTownLifeCommand(command)
    if (getPendingTownLifeCommand('workshop')?.body.idempotencyKey === command.body.idempotencyKey) savePendingTownLifeCommand(null, 'workshop')
    if (current()) {
      pending.value = null; cancelConfirm.value = false
      if (data?.sessionId && (!props.sessionId || data.sessionId === props.sessionId) && data.worldId === scope.value.worldId && data.worldEpoch === scope.value.worldEpoch) session.value = data
      emit('changed')
    }
  } catch (e) { if (current()) { error.value = errorMessage(e); rejected.value = !e.uncertain } }
  finally { if (current()) { await refresh(); if (current()) sending.value = false } }
}
watch(() => [props.worldId, props.worldEpoch, props.sessionId], () => {
  lifecycle++; reads++; selectedServiceKey.value = 'town.workshop'; catalog.value = null; sending.value = false; cancelConfirm.value = false; error.value = ''
  scope.value = { worldId: props.worldId, worldEpoch: props.worldEpoch }; session.value = null; stale.value = false; refresh()
}, { immediate: true })
onBeforeUnmount(() => { alive = false; lifecycle++; reads++ })
</script>

<style scoped>
.tws-overlay { position: fixed; inset: 0; z-index: 10020; background: rgba(0,0,0,.45); color: #574a40; }
.tws-stage-host { position: absolute; inset: 0; container: town-world / inline-size; }
.tws-stage-host :deep(.town-dialogue-stage) { grid-template-columns: minmax(0, 1fr) minmax(330px, 720px) minmax(0, 1fr); }
.tws-stage-host :deep(.td-panel) { width: min(100%, 720px); max-width: 720px; height: min(560px, 100%); }
.tws-stage-host :deep(.td-portraits figure) { max-height: 140px; }
.tws-static :deep(.td-input) { display: none; }
.tws-policy { background: #f0e8df; padding: 12px 14px; border-radius: 12px; margin: 12px 0; font-size: 13px; line-height: 1.7; }
.tws-policy p { font-size: 13px; margin: 5px 0; }
.tws-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 12px 0; }
.tws-muted { color: #947f6d; font-size: 12px; line-height: 1.6; }
.tws-receipt { margin: 16px 0; line-height: 1.7; font-size: 14px; }.tws-receipt p { margin: 8px 0; }
.tws-read { margin-top: 18px; }
@media (max-width: 520px) { .tws-stage-host :deep(.td-panel) { width: 100%; max-width: none; height: 80%; } }
</style>
