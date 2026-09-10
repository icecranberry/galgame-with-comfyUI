<template>
  <Teleport to="body">
    <div ref="overlay" class="tvp-overlay" @keydown.stop @keyup.stop @pointerdown.stop @click.stop @wheel.stop @touchstart.stop @touchmove.stop>
      <div class="tvp-stage-host">
        <town-dialogue-stage :display-name="`${providerName} · ${venueName}`" :messages="messages" :loading="loading"
          :sending="sending" :blocked="false" :status="statusText" :error="error" :retryable="!!pending && fresh"
          @close="$emit('close')" @reload="refresh" @retry="retry" @send="() => {}">
          <template #message="{ message }">
            <template v-if="message.kind === 'current'">
              <div v-if="!session && !pending" class="tvp-actions" role="group" aria-label="选择要办的事">
                <linshe-button v-for="item in serviceOptions" :key="item.serviceKey" variant="chip" size="sm"
                  :active="selectedServiceKey === item.serviceKey" :disabled="locked || !item.available"
                  @click="selectedServiceKey = item.serviceKey">{{ item.name }}</linshe-button>
              </div>
              <p><strong>{{ serviceName }}</strong></p>
              <p v-if="serviceDescription" class="tvp-muted">{{ serviceDescription }}</p>
              <p>{{ currentDialogue }}</p>
              <p v-if="serviceHours || typeof serviceOpen === 'boolean'" class="tvp-muted">
                <span v-if="typeof serviceOpen === 'boolean'">{{ serviceOpen ? `${venueName}营业中` : `${venueName}暂未营业，请稍后再来` }}</span>
                <span v-if="serviceHours"> · {{ serviceHours }}</span>
              </p>
              <p v-if="stock" class="tvp-muted">{{ venueResourceLabel }} {{ stock.available }} 份</p>
              <p v-if="regularLine" class="tvp-muted">{{ regularLine }}</p>
              <p v-if="!economyEnabled" class="tvp-muted">新的服务已暂停。已接受的服务仍可继续或取消。</p>
              <div v-if="!terminal" class="tvp-policy" aria-label="活动规则">
                <strong>{{ policyTitle }}</strong>
                <p>{{ policyText }}</p>
              </div>
              <p v-if="pending" class="tvp-muted">有一次操作等待确认。重新读取不会重发；重试沿用原请求。</p>
              <div v-if="pending" class="tvp-actions">
                <linshe-button size="sm" :disabled="loading || sending || !fresh" @click="retry">重试同一次操作</linshe-button>
                <linshe-button v-if="rejected" variant="link" size="sm" :disabled="loading || sending || !fresh" @click="discard">使用最新状态</linshe-button>
              </div>
              <div v-else-if="!session" class="tvp-actions">
                <linshe-button variant="primary" size="sm" :disabled="locked || !economyEnabled || serviceOpen === false || !selectedAvailable"
                  @click="submit('service_offer')">{{ offerLabel }}</linshe-button>
              </div>
              <div v-else-if="session.status === 'offered'" class="tvp-actions">
                <linshe-button variant="primary" size="sm" :disabled="locked || !economyEnabled" @click="submit('service_accept')">
                  {{ acceptLabel }}
                </linshe-button>
                <linshe-button variant="ghost" size="sm" :disabled="locked" @click="cancelConfirm = true">谢绝</linshe-button>
              </div>
              <template v-else-if="session.status === 'active'">
                <p class="tvp-muted">{{ activeHint }} · 第 {{ session.turnCount }} / {{ session.template?.maxTurns ?? 4 }} 回合</p>
                <div class="tvp-actions">
                  <linshe-button v-for="choice in actionChoices" :key="choice" size="sm" :disabled="locked"
                    @click="submit('service_turn', choice)">{{ choiceLabel(choice) }}</linshe-button>
                  <linshe-button v-if="session.choices?.includes('cancel')" variant="link" size="sm" :disabled="locked"
                    @click="cancelConfirm = true">取消</linshe-button>
                </div>
              </template>
              <p v-else-if="['resolving', 'settling'].includes(session.status)" role="status">正在结算，请稍后重新读取。</p>
              <div v-if="cancelConfirm && !pending" class="tvp-policy" role="group" aria-label="确认取消">
                <p>{{ cancelText }}</p>
                <div class="tvp-actions">
                  <linshe-button variant="danger" size="sm" :disabled="locked" @click="submit('service_cancel')">确认取消</linshe-button>
                  <linshe-button variant="ghost" size="sm" @click="cancelConfirm = false">继续</linshe-button>
                </div>
              </div>
              <section v-if="session && terminal" aria-label="结算收据" class="tvp-receipt">
                <strong>{{ statusNames[session.status] }}</strong>
                <template v-if="session.settlement">
                  <p v-if="isWage">工资 {{ session.settlement.payout }} · 已退回 {{ session.settlement.refund }} 邻币</p>
                  <p v-else-if="session.settlement.paid">已支付 {{ session.settlement.paid }} · 服务费用 {{ session.settlement.payout }} · 已退回 {{ session.settlement.refund }} 邻币</p>
                  <p v-else>本次没有花费邻币{{ session.settlement.itemIds?.length ? '，成品已经放进背包' : '' }}。</p>
                </template>
              </section>
              <div class="tvp-actions tvp-read">
                <linshe-button variant="ghost" size="sm" :disabled="loading || sending" @click="refresh">重新读取</linshe-button>
                <linshe-button variant="link" size="sm" @click="$emit('chat')">先和{{ providerName }}聊两句</linshe-button>
                <linshe-button variant="link" size="sm" @click="$emit('close')">回到小镇</linshe-button>
              </div>
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
  businessKey: { type: String, required: true }, sessionId: { type: String, default: null },
  providerName: { type: String, default: '店主' } })
const emit = defineEmits(['close', 'chat'])

const session = ref(null), loading = ref(false), sending = ref(false), fresh = ref(false), error = ref('')
const economyEnabled = ref(false), serviceOpen = ref(null), serviceHours = ref('')
const venue = ref(null), catalog = ref(null), selectedServiceKey = ref(null)
const pending = ref(getPendingTownLifeCommand(props.businessKey)), rejected = ref(false)
const cancelConfirm = ref(false), stale = ref(false)
const scope = ref({ worldId: props.worldId, worldEpoch: props.worldEpoch })
const statusNames = { completed: '已完成', cancelled: '已取消', failed: '未完成', expired: '已结束' }
const terminal = computed(() => !!statusNames[session.value?.status])
const locked = computed(() => loading.value || sending.value || !!pending.value || !fresh.value || stale.value)

const venueName = computed(() => venue.value?.displayName || session.value?.businessKey || '店铺')
const venueResourceLabel = computed(() => venue.value?.resourceLabel || '材料')
const stock = computed(() => venue.value?.stock || null)
function regularRow(regular) {
  if (!regular) return ''
  if (regular.tier > 0) return `${regular.label || '熟客'} ${regular.visits} 次 · ${regular.topic}`
  const remaining = Math.max(0, (regular.nextTierAt ?? regular.visits) - regular.visits)
  return `再正常消费 ${remaining} 次，${venueName.value}就会记住你`
}
const regularLine = computed(() => regularRow(venue.value?.regular))
const serviceOptions = computed(() => (catalog.value || []).map(entry => ({ serviceKey: entry.serviceKey,
  name: entry.name, description: entry.description, price: entry.price, wage: entry.wage,
  available: entry.available === true })))
const selectedService = computed(() => serviceOptions.value.find(item => item.serviceKey === selectedServiceKey.value) || null)
const selectedAvailable = computed(() => selectedService.value?.available === true)
const activeService = computed(() => selectedService.value
  || serviceOptions.value.find(item => item.serviceKey === session.value?.serviceKey) || null)
const isWage = computed(() => {
  const wage = session.value?.template?.wage ?? activeService.value?.wage ?? 0
  const price = session.value?.template?.price ?? activeService.value?.price ?? 0
  return wage > 0 && price === 0
})
const hasProduct = computed(() => ['custom_order', 'help_swap', 'purchase', 'lodging', 'lesson'].includes(session.value?.playbookKey))
// 以工换物：不收钱也不付工资，只换一件成品。
const isSwap = computed(() => hasProduct.value && !isWage.value
  && (activeService.value?.wage ?? session.value?.template?.wage ?? 0) === 0
  && (activeService.value?.price ?? session.value?.template?.price ?? 0) === 0)
const serviceName = computed(() => session.value?.serviceName || activeService.value?.name || '到店帮忙')
const serviceDescription = computed(() => session.value?.serviceDescription || activeService.value?.description || '')
const policyTitle = computed(() => isWage.value
  ? `${serviceName.value} · 工资 ${activeService.value?.wage ?? session.value?.template?.wage ?? 0} 邻币`
  : isSwap.value ? `${serviceName.value} · 以工换物 · 1 份${venueResourceLabel.value}`
    : `${serviceName.value} · ${activeService.value?.price ?? session.value?.template?.price ?? 0} 邻币 · 1 份${venueResourceLabel.value}`)
const policyText = computed(() => isWage.value
  ? `完成后由${venueName.value}支付工资；取消不消耗材料。`
  : isSwap.value ? `不收钱也不付工资；做好后成品直接放进背包，取消不消耗材料。`
    : hasProduct.value ? `确认前取消全退；做好后成品直接放进背包。` : `确认前取消全退；完成后才正式结算。`)
const offerLabel = computed(() => isWage.value ? '查看这班工作（不收费）'
  : isSwap.value ? '查看这份帮工（不收费）' : '查看报价（不收费）')
const acceptLabel = computed(() => isWage.value ? '接受这班工作'
  : isSwap.value ? '接受这份帮工'
    : session.value?.playbookKey === 'lodging' ? `付房钱 ${activeService.value?.price ?? session.value?.template?.price ?? 0} 邻币`
      : session.value?.playbookKey === 'lesson' ? `交束脩 ${activeService.value?.price ?? session.value?.template?.price ?? 0} 邻币`
        : `支付 ${activeService.value?.price ?? session.value?.template?.price ?? 0} 邻币`)
const activeHint = computed(() => isWage.value ? '正在当班' : isSwap.value ? '正在帮工'
  : session.value?.playbookKey === 'purchase' ? '正在备餐'
    : session.value?.playbookKey === 'lodging' ? '正在歇脚'
      : session.value?.playbookKey === 'lesson' ? '正在学手艺'
        : hasProduct.value ? '正在制作' : '正在服务')
const cancelText = computed(() => isWage.value ? `取消后，托管工资会退回${venueName.value}。`
  : isSwap.value ? '取消不消耗材料，也不会有任何扣款。'
    : session.value?.materialsConsumed ? '尚未完成，取消会退回全部金额。' : '尚未开始，取消将退回全部金额。')
const actionChoices = computed(() => (session.value?.choices || [])
  .filter(choice => ['work', 'serve', 'choose_style', 'craft', 'confirm_order', 'take',
    'settle_in', 'rest_up', 'ask_lesson', 'take_lesson'].includes(choice)))
function choiceLabel(choice) {
  return ({ work: '开始干活', serve: hasProduct.value ? '完成这一班，领走成品' : '完成这一班',
    choose_style: '选好样式，继续', craft: '开始制作',
    confirm_order: '确认点单', take: hasProduct.value ? '拿走成品' : '拿走',
    settle_in: '说定住处，继续', rest_up: hasProduct.value ? '歇够了，退房领走' : '歇够了，退房',
    ask_lesson: '说明想学的，继续', take_lesson: hasProduct.value ? '动手做一遍，收下成品' : '动手做一遍' })[choice] || choice
}
const currentDialogue = computed(() => terminal.value ? `${statusNames[session.value.status]}。以下为本次结算结果。`
  : session.value?.turns?.at(-1)?.response?.dialogue || session.value?.dialogue || '今天店里正忙，来搭把手吧。')
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
  return ({ NOT_ARRIVED: `请先到达${venueName.value}，并等待店主到场，再重试。`, INSUFFICIENT_FUNDS: '可用邻币不足，请先攒够再来。',
    SERVICE_NOT_OPEN: `${venueName.value}暂未营业，请稍后再来。`, VERSION_CONFLICT: '状态已变化，请读取后重试。',
    SESSION_BUSY: '本回合处理中，请稍后重新读取。', SESSION_CLOSED: '本次已结束，请重新读取收据。',
    INSUFFICIENT_STOCK: '店里材料不够，请稍后再来。',
    VENUE_NOT_CONFIGURED: '这家店还没配置经营者或地点，请先在钱袋面板里开张。',
    ITEM_TEMPLATES_REQUIRED: '这家店的商品模板还没准备好，请稍后再来。',
    SERVICE_GRANT_INVALID: '商品发放未完成，已改为原路退回。' })[e.code] || e.message || '操作未完成。'
}
function clearPending() { pending.value = null; savePendingTownLifeCommand(null, props.businessKey); rejected.value = false }
async function refresh() {
  const sequence = ++reads, generation = lifecycle; loading.value = true; fresh.value = false
  const current = () => alive && generation === lifecycle && sequence === reads
  if (!pending.value) error.value = ''
  try {
    const overview = await getTownEconomy()
    if (!current()) return
    economyEnabled.value = overview.enabled === true
    venue.value = (overview.venues || []).find(item => item.businessKey === props.businessKey) || null
    catalog.value = Array.isArray(venue.value?.catalog) ? venue.value.catalog : null
    serviceOpen.value = venue.value?.open ?? null; serviceHours.value = venue.value?.hours || ''
    if (!selectedServiceKey.value || !catalog.value?.some(item => item.serviceKey === selectedServiceKey.value)) {
      selectedServiceKey.value = catalog.value?.[0]?.serviceKey || null
    }
    if (overview.worldId !== scope.value.worldId || overview.worldEpoch !== scope.value.worldEpoch) {
      clearPending(); stale.value = true; session.value = null; error.value = '小镇已更新，旧操作已停止。'; return
    }
    pending.value = getPendingTownLifeCommand(props.businessKey)
    if (!pending.value) rejected.value = false
    if (pending.value && (pending.value.worldId !== overview.worldId || pending.value.body.worldEpoch !== overview.worldEpoch)) clearPending()
    const sessionId = props.sessionId || session.value?.sessionId
    const data = sessionId ? await getTownServiceSession(sessionId) : null
    if (!current()) return
    if (data && (data.worldId !== scope.value.worldId || data.worldEpoch !== scope.value.worldEpoch)) throw new Error('服务状态与当前小镇不一致，请重新读取。')
    if (data) { session.value = data; if (data.serviceKey) selectedServiceKey.value = data.serviceKey }
    fresh.value = true
  } catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) loading.value = false }
}
function submit(kind, intentKey, text = '') {
  if (locked.value || (['service_offer', 'service_accept'].includes(kind) && !economyEnabled.value)) return
  if (kind === 'service_offer' && (!selectedAvailable.value || serviceOpen.value === false)) return
  if (kind === 'service_turn' && !session.value?.choices?.includes(intentKey)) return
  const command = createTownLifeCommand(kind, { ...scope.value, sessionId: session.value?.sessionId,
    expectedVersion: session.value?.version, serviceKey: kind === 'service_offer' ? selectedServiceKey.value : undefined,
    intentKey, text })
  pending.value = command; savePendingTownLifeCommand(command, props.businessKey); run(command)
}
function retry() { if (pending.value && fresh.value && !stale.value) run(pending.value) }
function discard() { if (rejected.value && fresh.value && !sending.value) { clearPending(); error.value = '' } }
async function run(command) {
  if (!fresh.value || loading.value || sending.value || stale.value
      || command.body.idempotencyKey !== pending.value?.body.idempotencyKey) return
  const generation = lifecycle
  const current = () => alive && generation === lifecycle
  sending.value = true; rejected.value = false; error.value = ''
  try {
    const data = await executeTownLifeCommand(command)
    if (getPendingTownLifeCommand(props.businessKey)?.body.idempotencyKey === command.body.idempotencyKey) {
      savePendingTownLifeCommand(null, props.businessKey)
    }
    if (current()) {
      pending.value = null; cancelConfirm.value = false
      if (data?.sessionId && (!props.sessionId || data.sessionId === props.sessionId)
          && data.worldId === scope.value.worldId && data.worldEpoch === scope.value.worldEpoch) session.value = data
    }
  } catch (e) { if (current()) { error.value = errorMessage(e); rejected.value = !e.uncertain } }
  finally { if (current()) { await refresh(); if (current()) sending.value = false } }
}
watch(() => [props.worldId, props.worldEpoch, props.businessKey, props.sessionId], () => {
  lifecycle++; reads++; selectedServiceKey.value = null; catalog.value = null; sending.value = false
  cancelConfirm.value = false; error.value = ''
  scope.value = { worldId: props.worldId, worldEpoch: props.worldEpoch }; session.value = null; stale.value = false
  pending.value = getPendingTownLifeCommand(props.businessKey)
  refresh()
}, { immediate: true })
onBeforeUnmount(() => { alive = false; lifecycle++; reads++ })
</script>

<style scoped>
.tvp-overlay { position: fixed; inset: 0; z-index: 10030; background: rgba(0,0,0,.45); color: #574a40; }
.tvp-stage-host { position: absolute; inset: 0; container: town-world / inline-size; }
.tvp-stage-host :deep(.town-dialogue-stage) { grid-template-columns: minmax(0, 1fr) minmax(330px, 720px) minmax(0, 1fr); }
.tvp-stage-host :deep(.td-panel) { width: min(100%, 720px); max-width: 720px; height: min(560px, 100%); }
.tvp-stage-host :deep(.td-portraits figure) { max-height: 140px; }
.tvp-policy { background: #f0e8df; padding: 12px 14px; border-radius: 12px; margin: 12px 0; font-size: 13px; line-height: 1.7; }
.tvp-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 12px 0; }
.tvp-muted { color: #947f6d; font-size: 12px; line-height: 1.6; }
.tvp-receipt { margin: 16px 0; line-height: 1.7; font-size: 14px; }.tvp-receipt p { margin: 8px 0; }
.tvp-read { margin-top: 18px; }
@media (max-width: 520px) { .tvp-stage-host :deep(.td-panel) { width: 100%; max-width: none; height: 80%; } }
</style>
