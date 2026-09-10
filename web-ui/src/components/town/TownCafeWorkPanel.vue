<template>
  <Teleport to="body">
    <div ref="overlay" class="tcw-overlay" @keydown.stop @keyup.stop @pointerdown.stop @click.stop @wheel.stop @touchstart.stop @touchmove.stop>
      <div class="tcw-stage-host">
        <town-dialogue-stage :display-name="`${providerName} · 咖啡馆`" :messages="messages" :loading="loading" :sending="sending"
          :blocked="!canClarify" :status="statusText" :error="error" :retryable="!!pending && fresh"
          @close="$emit('close')" @reload="refresh" @retry="retry" @send="clarify">
          <template #message="{ message }">
            <template v-if="message.kind === 'current'">
              <div v-if="!session && !pending" class="tcw-actions" role="group" aria-label="选择咖啡馆活动">
                <linshe-button v-for="item in serviceOptions" :key="item.serviceKey" variant="chip" size="sm"
                  :active="selectedServiceKey === item.serviceKey" :disabled="locked || !item.available"
                  @click="selectedServiceKey = item.serviceKey">{{ item.name }}</linshe-button>
              </div>
              <p v-if="!session && !pending" class="tcw-muted">打工不需要垫付；确认后咖啡馆把工资托管，完成后付给你。买咖啡会从钱包扣款。</p>
              <p><strong>{{ serviceName }}</strong></p>
              <p v-if="serviceDescription" class="tcw-muted">{{ serviceDescription }}</p>
              <p>{{ currentDialogue }}</p>
              <p v-if="serviceHours || typeof serviceOpen === 'boolean'" class="tcw-muted">
                <span v-if="typeof serviceOpen === 'boolean'">{{ serviceOpen ? '咖啡馆营业中' : '咖啡馆暂未营业，请稍后再来' }}</span>
                <span v-if="serviceHours"> · {{ serviceHours }}</span>
              </p>
              <p v-if="!economyEnabled" class="tcw-muted">新班次与饮品已暂停。已接受的活动仍可继续或取消。</p>
              <div v-if="!terminal" class="tcw-policy" aria-label="活动规则">
                <strong>{{ isWork ? `${serviceName} · 工资 ${wage} 邻币` : `${serviceName} · ${price} 邻币 · 1 份豆子` }}</strong>
                <p>{{ isWork ? '完成一班固定小任务后领取工资；取消全退给咖啡馆。' : '确认前取消全退；完成后才向咖啡馆支付。' }}</p>
              </div>
              <p v-if="pending" class="tcw-muted">有一次操作等待确认。重新读取不会重发；重试沿用原请求。</p>
              <div v-if="pending" class="tcw-actions">
                <linshe-button size="sm" :disabled="loading || sending || !fresh" @click="retry">重试同一次操作</linshe-button>
                <linshe-button v-if="rejected" variant="link" size="sm" :disabled="loading || sending || !fresh" @click="discard">使用最新状态</linshe-button>
              </div>
              <div v-else-if="!session" class="tcw-actions">
                <linshe-button variant="primary" size="sm" :disabled="locked || !economyEnabled || serviceOpen === false || !selectedAvailable" @click="submit('service_offer')">
                  {{ isWork ? '查看这班打工（不收费）' : '查看饮品报价（不收费）' }}
                </linshe-button>
              </div>
              <div v-else-if="session.status === 'offered'" class="tcw-actions">
                <linshe-button variant="primary" size="sm" :disabled="locked || !economyEnabled" @click="submit('service_accept')">
                  {{ isWork ? '接受这班打工' : `支付 ${price} 邻币` }}
                </linshe-button>
                <linshe-button variant="ghost" size="sm" :disabled="locked" @click="cancelConfirm = true">谢绝</linshe-button>
              </div>
              <template v-else-if="session.status === 'active'">
                <p class="tcw-muted">{{ isWork ? '正在打工' : '正在制作咖啡' }} · 第 {{ session.turnCount }} / {{ session.template?.maxTurns ?? 4 }} 回合</p>
                <div class="tcw-actions">
                  <linshe-button v-for="choice in actionChoices" :key="choice" size="sm" :disabled="locked" @click="submit('service_turn', choice)">{{ choiceLabel(choice) }}</linshe-button>
                  <linshe-button v-if="session.choices?.includes('cancel')" variant="link" size="sm" :disabled="locked" @click="cancelConfirm = true">取消</linshe-button>
                </div>
              </template>
              <p v-else-if="['resolving', 'settling'].includes(session.status)" role="status">正在结算，请稍后重新读取。</p>
              <div v-if="cancelConfirm && !pending" class="tcw-policy" role="group" aria-label="确认取消">
                <p>{{ isWork ? '取消后，托管工资会退回咖啡馆。' : session?.materialsConsumed ? '尚未完成，取消会退回全部金额。' : '尚未开始，取消将退回全部金额。' }}</p>
                <div class="tcw-actions"><linshe-button variant="danger" size="sm" :disabled="locked" @click="submit('service_cancel')">确认取消</linshe-button><linshe-button variant="ghost" size="sm" @click="cancelConfirm = false">继续</linshe-button></div>
              </div>
              <section v-if="session && terminal" aria-label="结算收据" class="tcw-receipt">
                <strong>{{ statusNames[session.status] }}</strong>
                <template v-if="session.settlement">
                  <p v-if="isWork">工资 {{ session.settlement.payout }} · 已退回 {{ session.settlement.refund }} 邻币</p>
                  <p v-else>已支付 {{ session.settlement.paid }} · 服务费用 {{ session.settlement.payout }} · 已退回 {{ session.settlement.refund }} 邻币</p>
                </template>
              </section>
              <div class="tcw-actions tcw-read"><linshe-button variant="ghost" size="sm" :disabled="loading || sending" @click="refresh">重新读取</linshe-button><linshe-button variant="link" size="sm" @click="$emit('chat')">先和{{ providerName }}聊两句</linshe-button><linshe-button variant="link" size="sm" @click="$emit('close')">回到小镇</linshe-button></div>
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
const emit = defineEmits(['close', 'chat'])
const session = ref(null), loading = ref(false), sending = ref(false), fresh = ref(false), error = ref('')
const economyEnabled = ref(false), serviceOpen = ref(null), serviceHours = ref('')
const catalog = ref(null), selectedServiceKey = ref('town.cafe.work_shift')
const serviceOptions = computed(() => [
  { serviceKey: 'town.cafe.work_shift', name: '打工 · 临时代班' },
  { serviceKey: 'town.cafe.drink_coffee', name: '手冲咖啡' },
].map(item => ({ ...item, available: catalog.value ? catalog.value.find(entry => entry.serviceKey === item.serviceKey)?.available === true : item.serviceKey === 'town.cafe.work_shift' })))
const isWork = computed(() => selectedServiceKey.value === 'town.cafe.work_shift' || session.value?.serviceKey === 'town.cafe.work_shift')
const selectedAvailable = computed(() => serviceOptions.value.find(item => item.serviceKey === selectedServiceKey.value)?.available === true)
const serviceName = computed(() => session.value?.serviceName || (isWork.value ? '打工 · 临时代班' : '手冲咖啡'))
const serviceDescription = computed(() => session.value ? session.value.serviceDescription || ''
  : catalog.value?.find(item => item.serviceKey === selectedServiceKey.value)?.description || '')
const wage = computed(() => catalog.value?.find(item => item.serviceKey === 'town.cafe.work_shift')?.wage ?? 24)
const price = computed(() => catalog.value?.find(item => item.serviceKey === 'town.cafe.drink_coffee')?.price ?? 18)
const pending = ref(getPendingTownLifeCommand('cafe')), rejected = ref(false), cancelConfirm = ref(false), stale = ref(false)
const scope = ref({ worldId: props.worldId, worldEpoch: props.worldEpoch })
const statusNames = { completed: '已完成', cancelled: '已取消', failed: '未完成', expired: '已结束' }
const terminal = computed(() => !!statusNames[session.value?.status])
const locked = computed(() => loading.value || sending.value || !!pending.value || !fresh.value || stale.value)
const canClarify = computed(() => false)
const actionChoices = computed(() => (session.value?.choices || []).filter(choice => ['serve', 'choose_drink'].includes(choice)))
const choiceNames = { choose_drink: isWork.value ? '开始这班工作' : '选好咖啡，继续', serve: isWork.value ? '完成这班工作' : '完成冲煮' }
function choiceLabel(choice) { return choiceNames[choice] || choice }
const currentDialogue = computed(() => terminal.value ? `${statusNames[session.value.status]}。以下为本次结算结果。`
  : session.value?.turns?.at(-1)?.response?.dialogue || session.value?.dialogue || (isWork.value ? '今天店里忙，来搭把手吧。' : '先看看今天的咖啡吧。'))
const statusText = computed(() => stale.value ? '小镇已更新，请回到小镇里重新进店。' : terminal.value ? '本次已结束，关闭不会重复结算。' : '关闭只收起面板，不会自动取消。')
const messages = computed(() => [
  ...(session.value?.turns || []).flatMap((turn, index, turns) => [
    { id: `${turn.clientTurnId}:user`, role: 'user', content: turn.input?.text || choiceLabel(turn.input?.intentKey) || '继续' },
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
  return ({ NOT_ARRIVED: '请先到达咖啡馆，并等待店员到场，再重试。', INSUFFICIENT_FUNDS: '可用邻币不足，请先完成一班打工。',
    SERVICE_NOT_OPEN: '咖啡馆暂未营业，请稍后再来。', VERSION_CONFLICT: '状态已变化，请读取后重试。', SESSION_BUSY: '本回合处理中，请稍后重新读取。',
    SESSION_CLOSED: '本次已结束，请重新读取收据。' })[e.code] || e.message || '操作未完成。'
}
function clearPending() { pending.value = null; savePendingTownLifeCommand(null, 'cafe'); rejected.value = false }
async function refresh() {
  const sequence = ++reads, generation = lifecycle; loading.value = true; fresh.value = false
  const current = () => alive && generation === lifecycle && sequence === reads
  if (!pending.value) error.value = ''
  try {
    const overview = await getTownEconomy()
    if (!current()) return
    economyEnabled.value = overview.enabled === true
    catalog.value = Array.isArray(overview.cafe?.catalog) ? overview.cafe.catalog : null
    serviceOpen.value = overview.cafe?.open ?? null; serviceHours.value = overview.cafe?.hours || ''
    if (overview.worldId !== scope.value.worldId || overview.worldEpoch !== scope.value.worldEpoch) {
      clearPending(); stale.value = true; session.value = null; error.value = '小镇已更新，旧操作已停止。'; return
    }
    pending.value = getPendingTownLifeCommand('cafe')
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
  pending.value = command; savePendingTownLifeCommand(command, 'cafe'); run(command)
}
function clarify(text) { if (canClarify.value) submit('service_turn', 'clarify', text) }
function retry() { if (pending.value && fresh.value && !stale.value) run(pending.value) }
function discard() { if (rejected.value && fresh.value && !sending.value) { clearPending(); error.value = '' } }
async function run(command) {
  if (!fresh.value || loading.value || sending.value || stale.value || command.body.idempotencyKey !== pending.value?.body.idempotencyKey) return
  const generation = lifecycle; const current = () => alive && generation === lifecycle
  sending.value = true; rejected.value = false; error.value = ''
  try {
    const data = await executeTownLifeCommand(command)
    if (getPendingTownLifeCommand('cafe')?.body.idempotencyKey === command.body.idempotencyKey) savePendingTownLifeCommand(null, 'cafe')
    if (current()) {
      pending.value = null; cancelConfirm.value = false
      if (data?.sessionId && (!props.sessionId || data.sessionId === props.sessionId) && data.worldId === scope.value.worldId && data.worldEpoch === scope.value.worldEpoch) session.value = data
    }
  } catch (e) { if (current()) { error.value = errorMessage(e); rejected.value = !e.uncertain } }
  finally { if (current()) { await refresh(); if (current()) sending.value = false } }
}
watch(() => [props.worldId, props.worldEpoch, props.sessionId], () => {
  lifecycle++; reads++; selectedServiceKey.value = 'town.cafe.work_shift'; catalog.value = null; sending.value = false; cancelConfirm.value = false; error.value = ''
  scope.value = { worldId: props.worldId, worldEpoch: props.worldEpoch }; session.value = null; stale.value = false; refresh()
}, { immediate: true })
onBeforeUnmount(() => { alive = false; lifecycle++; reads++ })
</script>

<style scoped>
.tcw-overlay { position: fixed; inset: 0; z-index: 10030; background: rgba(0,0,0,.45); color: #574a40; }
.tcw-stage-host { position: absolute; inset: 0; container: town-world / inline-size; }
.tcw-stage-host :deep(.town-dialogue-stage) { grid-template-columns: minmax(0, 1fr) minmax(330px, 720px) minmax(0, 1fr); }
.tcw-stage-host :deep(.td-panel) { width: min(100%, 720px); max-width: 720px; height: min(560px, 100%); }
.tcw-stage-host :deep(.td-portraits figure) { max-height: 140px; }
.tcw-policy { background: #f0e8df; padding: 12px 14px; border-radius: 12px; margin: 12px 0; font-size: 13px; line-height: 1.7; }
.tcw-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 12px 0; }
.tcw-muted { color: #947f6d; font-size: 12px; line-height: 1.6; }
.tcw-receipt { margin: 16px 0; line-height: 1.7; font-size: 14px; }.tcw-receipt p { margin: 8px 0; }
.tcw-read { margin-top: 18px; }
@media (max-width: 520px) { .tcw-stage-host :deep(.td-panel) { width: 100%; max-width: none; height: 80%; } }
</style>
