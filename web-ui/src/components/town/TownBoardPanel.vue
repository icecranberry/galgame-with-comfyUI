<template>
  <town-paper-panel :open="open" title="公告站" kicker="邻舍小镇 · 公共窗口" :busy="loading || sending" :refreshing="loading"
    :refresh-disabled="loading || sending" @close="$emit('close')" @refresh="refresh">
    <div class="tl-notice" aria-live="polite">
      <p v-if="error" class="tl-error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <p v-if="loading && !economy" role="status">正在读取公告站…</p>
    </div>
    <div v-if="pending" class="tl-pending">
      <p>有一笔「{{ commandNames[pending.kind] || '操作' }}」等待确认。重试会沿用同一次操作。</p>
      <div class="tl-actions">
        <linshe-button size="sm" :disabled="loading || sending || !economy || !fresh" :loading="sending" @click="run(pending)">重试同一次操作</linshe-button>
        <linshe-button v-if="rejected" variant="link" size="sm" :disabled="loading || sending" @click="discardRejected">使用最新状态</linshe-button>
      </div>
    </div>
    <template v-if="economy && economy.configured">
      <p v-if="!economy.enabled" class="tl-muted" role="status">新委托已暂停。已接配送仍可领取、交付或取消。</p>
      <section aria-labelledby="tl-route-title">
        <div class="tl-section-heading"><h3 id="tl-route-title">一趟配送，三站小路</h3><span class="tl-reward">{{ money(economy.slice?.reward ?? 30) }} 邻币</span></div>
        <ol class="tl-route">
          <li v-for="(step, index) in routeSteps" :key="step.key">
            <span class="tl-step-number">{{ index + 1 }}</span><div><strong>{{ step.title }}</strong><p>{{ locationName(economy.slice?.locationKeys?.[step.key]) }}</p></div>
            <linshe-button variant="link" size="sm" :disabled="!economy.slice?.locationKeys?.[step.key]" @click="go(economy.slice.locationKeys[step.key])">前往</linshe-button>
          </li>
        </ol>
        <p class="tl-muted">无需垫付邻币。先到公告站接单，再领材料、送往工坊；走到对应地点后确认。</p>
      </section>
      <section v-if="economy.production" aria-labelledby="tl-production-title">
        <div class="tl-section-heading"><h3 id="tl-production-title">工坊备料</h3></div>
        <p>备料中 {{ money(productionTotals.reserved) }} 份 · 已补货 {{ money(productionTotals.completed) }} 份</p>
        <p v-if="economy.production.resource" class="tl-muted">剩余采集容量 {{ money(economy.production.resource.remaining) }} / {{ money(economy.production.resource.capacity) }}，其中 {{ money(economy.production.resource.reserved) }} 已预留；可采集 {{ money(economy.production.resource.available) }}。</p>
        <p class="tl-muted">每完成一次服务，两位居民工作后补回 1 份原料，受剩余采集容量限制。</p>
      </section>
      <section aria-labelledby="tl-orders-title">
        <div class="tl-section-heading"><h3 id="tl-orders-title">配送委托</h3>
          <linshe-button :variant="activeOrders.length ? 'ghost' : 'primary'" size="sm" :disabled="locked || !economy.enabled" @click="submit('publish')">发布配送委托</linshe-button>
        </div>
        <p v-if="!orders.length" class="tl-empty">还没有委托。发布后，就能在这里接取。</p>
        <article v-for="order in orders" :key="order.orderId" class="tl-order">
          <div class="tl-order-heading"><strong>工坊材料配送</strong><span class="tl-status" :class="{ done: order.status === 'completed' }">{{ statuses[order.status] || '状态待确认' }}</span></div>
          <p class="tl-muted">报酬 {{ money(order.config?.reward ?? economy.slice?.reward ?? 30) }} 邻币<span v-if="order.expiresAt"> · 截止 {{ deadline(order.expiresAt) }}</span></p>
          <p v-if="nextStep(order)">{{ nextStep(order).hint }} · {{ locationName(order.config?.locationKeys?.[nextStep(order).place]) }}</p>
          <p v-else-if="order.status === 'completed'" class="tl-muted">配送已完成，报酬以钱包最新余额为准。</p>
          <div v-if="nextStep(order)" class="tl-actions">
            <linshe-button :variant="order.orderId === activeOrders[0]?.orderId ? 'primary' : 'secondary'" size="sm" :disabled="locked || (order.status === 'open' && !economy.enabled)" @click="submit(nextStep(order).action, order)">{{ nextStep(order).label }}</linshe-button>
            <linshe-button variant="ghost" size="sm" :disabled="!order.config?.locationKeys?.[nextStep(order).place]" @click="go(order.config.locationKeys[nextStep(order).place])">前往{{ nextStep(order).placeName }}</linshe-button>
            <linshe-button v-if="['accepted', 'picked_up'].includes(order.status)" variant="link" size="sm" :disabled="locked" @click="cancelId = order.orderId">取消委托</linshe-button>
          </div>
          <div v-if="cancelId === order.orderId" class="tl-cancel" role="group" aria-label="确认取消委托">
            <p>取消后，这份委托将结束，预留材料由小镇收回。</p>
            <div class="tl-actions"><linshe-button variant="danger" size="sm" :disabled="locked" @click="submit('cancel', order)">确认取消</linshe-button><linshe-button variant="ghost" size="sm" @click="cancelId = null">继续配送</linshe-button></div>
          </div>
        </article>
      </section>
      <section aria-labelledby="tl-appointments-title">
        <h3 id="tl-appointments-title">再来坐坐</h3>
        <p class="tl-muted">和已入住的工坊邻居约一次免费回访，时间由你确认。</p>
        <linshe-button variant="secondary" size="sm" :disabled="loading || sending" @click="$emit('appointments')">查看回访邀请与预约</linshe-button>
      </section>
    </template>
    <p v-else-if="economy" class="tl-muted">小镇还没开张。先在钱袋面板里为第一条配送路线选好居民和地点。</p>
  </town-paper-panel>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import TownPaperPanel from './TownPaperPanel.vue'
import { getTownEconomy, createTownLifeCommand, executeTownLifeCommand, getPendingTownLifeCommand, savePendingTownLifeCommand } from '../../api/index.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close', 'move-to', 'appointments'])
const economy = ref(null), loading = ref(false), sending = ref(false), fresh = ref(false)
const error = ref(''), notice = ref(''), cancelId = ref(null), rejected = ref(false)
// 公告站的待确认操作单独存一条通道，避免与钱袋面板里的开张操作互相顶替。
const CHANNEL = 'board'
const pending = ref(getPendingTownLifeCommand(CHANNEL))
const commandNames = { publish: '发布配送委托', accept: '接取委托', pickup: '领取材料', complete: '交付材料', cancel: '取消委托' }
const statuses = { open: '待接取', accepted: '待领取材料', picked_up: '配送中', completed: '已完成', cancelled: '已取消', expired: '已过期' }
const routeSteps = [{ key: 'board', title: '到公告站接单' }, { key: 'supplier', title: '领取配送材料' }, { key: 'workshop', title: '交付并领取报酬' }]
const steps = {
  open: { action: 'accept', label: '接取委托', place: 'board', placeName: '公告站', hint: '先到公告站接取委托' },
  accepted: { action: 'pickup', label: '领取材料', place: 'supplier', placeName: '原料点', hint: '到原料点领取材料' },
  picked_up: { action: 'complete', label: '交付材料', place: 'workshop', placeName: '工坊', hint: '到工坊交付材料，领取报酬' },
}
const nextStep = order => steps[order.status]
const orders = computed(() => economy.value?.orders || [])
const activeOrders = computed(() => orders.value.filter(order => nextStep(order)))
const productionTotals = computed(() => (economy.value?.production?.batches || []).reduce((totals, batch) => {
  if (batch.status === 'reserved' || batch.status === 'completed') {
    const quantity = batch.config?.recipe?.quantity
    totals[batch.status] += Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1
  }
  return totals
}, { reserved: 0, completed: 0 }))
const locked = computed(() => loading.value || sending.value || !!pending.value || !fresh.value)
const locationName = key => economy.value?.locations?.find(l => l.key === key)?.name || '地点待确认'
const money = value => Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
function deadline(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '待确认' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + '（北京时间）'
}
function message(e) {
  return ({ NOT_ARRIVED: '还没有到达对应地点。请先在地图上走过去，再确认。', VERSION_CONFLICT: '委托状态已变化，请重新读取后使用最新状态。',
    ORDER_EXPIRED: '这份委托已过期，请重新读取最新委托。', STALE_EPOCH: '小镇已更新，请重新读取状态。',
    LOCATION_UNAVAILABLE: '这个地点暂时不可用，请重新读取状态。' })[e.code] || e.message || '操作未完成，请重新读取状态。'
}
let readSequence = 0, lifecycle = 0, alive = true
async function refresh() {
  if (!props.open) return
  const sequence = ++readSequence, generation = lifecycle
  const current = () => alive && props.open && generation === lifecycle && sequence === readSequence
  if (!pending.value) error.value = ''
  loading.value = true; fresh.value = false
  try {
    const data = await getTownEconomy()
    if (!current()) return
    if (!data || typeof data.enabled !== 'boolean' || !Number.isSafeInteger(data.worldEpoch)) throw new Error('小镇状态不完整，请稍后重新读取。')
    economy.value = data
    fresh.value = true
    if (pending.value && (pending.value.worldId !== data.worldId || pending.value.body.worldEpoch !== data.worldEpoch)) {
      pending.value = null; savePendingTownLifeCommand(null, CHANNEL); rejected.value = false
      notice.value = '小镇已更新，旧操作已停止。请按当前状态重新选择。'
    }
  } catch (e) { if (current()) error.value = message(e) }
  finally { if (current()) loading.value = false }
}
function submit(kind, order) {
  if (locked.value || !economy.value || (['publish', 'accept'].includes(kind) && !economy.value.enabled)) return
  const command = createTownLifeCommand(kind, { worldId: economy.value.worldId, worldEpoch: economy.value.worldEpoch,
    orderId: order?.orderId, expectedVersion: order?.version })
  pending.value = command; savePendingTownLifeCommand(command, CHANNEL)
  run(command)
}
async function run(command) {
  if (!props.open || !fresh.value || sending.value || loading.value || !command || command.body.idempotencyKey !== pending.value?.body.idempotencyKey
    || command.worldId !== economy.value?.worldId || command.body.worldEpoch !== economy.value?.worldEpoch) return
  const generation = lifecycle
  const current = () => alive && props.open && generation === lifecycle
  sending.value = true; error.value = ''; notice.value = ''; rejected.value = false
  try {
    await executeTownLifeCommand(command)
    if (getPendingTownLifeCommand(CHANNEL)?.body.idempotencyKey === command.body.idempotencyKey) savePendingTownLifeCommand(null, CHANNEL)
    if (current()) { pending.value = null; notice.value = '操作已确认。'; cancelId.value = null }
  } catch (e) {
    if (current()) { error.value = message(e); rejected.value = !e.uncertain }
  } finally {
    if (current()) { await refresh(); if (current()) sending.value = false }
  }
}
function discardRejected() {
  if (!rejected.value || sending.value || loading.value) return
  pending.value = null; savePendingTownLifeCommand(null, CHANNEL); rejected.value = false; error.value = ''
}
function go(key) { if (key) emit('move-to', key) }
watch(() => props.open, open => {
  lifecycle++; readSequence++; loading.value = false; sending.value = false; fresh.value = false; cancelId.value = null
  if (open) { pending.value = getPendingTownLifeCommand(CHANNEL); rejected.value = false; refresh() }
}, { immediate: true })
onBeforeUnmount(() => { alive = false; lifecycle++; readSequence++ })
</script>

<style scoped>
.tl-notice:empty { display: none; }.tl-notice { font-size: 13px; }.tl-error { color: #b8574f; }
.tl-pending, .tl-cancel { background: #eee5db; padding: 12px 14px; border-radius: 12px; margin-bottom: 16px; font-size: 13px; }.tl-cancel { margin: 12px 0 0; }
.tl-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
h3 { font-size: 16px; margin: 0; font-weight: 600; }
p { margin: 8px 0; overflow-wrap: anywhere; }
section { margin-bottom: 24px; }
.tl-muted { color: #918278; font-size: 13px; }
.tl-section-heading { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin: 24px 0 12px; }
.tl-reward { color: #b76c59; white-space: nowrap; font-size: 13px; }.tl-route { list-style: none; margin: 10px 0; padding: 0; }
.tl-route li { display: flex; align-items: center; gap: 12px; padding: 10px 0; }.tl-route li > div { flex: 1; min-width: 0; }
.tl-route strong { font-size: 14px; font-weight: 500; }.tl-route p { font-size: 12px; color: #948579; margin: 0; }
.tl-step-number { border-radius: 50%; width: 28px; height: 28px; display: grid; place-items: center; background: #eadfd6; color: #9b7665; font-size: 12px; flex-shrink: 0; }
.tl-order { padding: 18px 0; border-bottom: 1px solid #e8dfd7; }.tl-order:last-child { border-bottom: 0; }
.tl-order-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.tl-order-heading strong { font-weight: 500; }
.tl-status { font-size: 12px; color: #ad8066; }.tl-status.done { color: #779078; }
.tl-empty { color: #918278; padding: 18px 0; }
@media (max-width: 520px) { .tl-section-heading { align-items: flex-start; } }
</style>
