<template>
  <Teleport to="body">
    <div v-if="open" class="tdd-overlay" @click.self="close" @keydown.stop="keydown" @keyup.stop @click.stop @pointerdown.stop @mousedown.stop @wheel.stop @touchstart.stop @touchmove.stop>
      <section ref="panel" class="tdd-panel" role="dialog" aria-modal="true" aria-label="记录投递状态" tabindex="-1">
        <header><div><span class="tdd-muted">邻舍小镇 · 记录维护</span><h2>记录投递状态</h2></div><linshe-button variant="icon" size="sm" aria-label="关闭记录投递状态" @click="close">✕</linshe-button></header>
        <div class="tdd-content" :aria-busy="loading || sending">
          <p>这里只重试经历或回访预约记录，不重做交易，也不发放奖励。</p>
          <p class="tdd-muted">等待中或处理中的记录会由小镇继续处理。重新读取不会提交重试；重新投递成功也不代表记录已经完成。</p>
          <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p><p v-if="loading" role="status">正在读取投递状态…</p>
          <linshe-button variant="ghost" size="sm" :disabled="loading || sending" @click="read(false)">重新读取</linshe-button>
          <section v-if="pending" class="tdd-pending" aria-label="待确认的重投请求">
            <h3>{{ consumerName(pending.body.consumerKey) }} · 重投结果待确认</h3>
            <p>原请求已保留。重试会沿用同一次操作，不会重做交易或发奖励。</p>
            <div class="tdd-actions"><linshe-button size="sm" :disabled="!fresh || loading || sending" :loading="sending" @click="run(pending)">重试原请求</linshe-button><linshe-button v-if="pending.rejected" variant="link" size="sm" :disabled="!fresh || loading || sending" @click="discard">使用最新状态</linshe-button></div>
          </section>
          <p v-if="loaded && !items.length" class="tdd-muted">没有等待处理或失败的记录。</p>
          <ol aria-label="投递记录">
            <li v-for="item in items" :key="itemKey(item)">
              <div class="tdd-row"><h3>{{ consumerName(item.consumerKey) }}</h3><span>{{ statuses[item.status] || '状态待确认' }}</span></div>
              <p>{{ sources[item.sourceType] || '小镇记录' }}<span v-if="time(item.occurredAt)"> · {{ time(item.occurredAt) }}</span></p>
              <p class="tdd-muted">已尝试 {{ Number.isSafeInteger(item.attempts) ? item.attempts : 0 }} 次<span v-if="item.status === 'pending' && time(item.nextRetryAt)"> · 下次尝试 {{ time(item.nextRetryAt) }}</span></p>
              <p v-if="item.lastErrorCode" class="tdd-muted">{{ reasons[item.lastErrorCode] || '上次记录未能完成，具体缘由暂未提供。' }}</p>
              <linshe-button v-if="item.status === 'dead'" size="sm" :disabled="locked" @click="retry(item)">重新投递</linshe-button>
            </li>
          </ol>
          <linshe-button v-if="nextCursor" size="sm" :disabled="loading || sending" @click="read(true)">加载更多</linshe-button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import { getTownDeliveries, createTownDeliveryRetry, executeTownDeliveryRetry, loadPendingTownDeliveryRetry, savePendingTownDeliveryRetry } from '../../api/index.js'
const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const panel = ref(null), items = ref([]), nextCursor = ref(null), world = ref(null), pending = ref(null)
const loading = ref(false), sending = ref(false), fresh = ref(false), loaded = ref(false), error = ref(''), notice = ref('')
let lifecycle = 0, readSequence = 0, returnFocus
const statuses = { dead: '投递失败', pending: '等待处理', processing: '处理中' }
const sources = { 'town.service.settled': '工坊服务结算', 'town.service.completed': '工坊服务完成', 'town.delivery.changed': '配送记录', 'town.item.changed': '道具记录', 'town.action.completed': '行动完成', 'town.production.completed': '工坊备料完成' }
const reasons = { APPOINTMENT_SOURCE_INVALID: '回访来源暂时无法核实。', CANDIDATE_EXPIRED: '回访邀请已过期。', EXPERIENCE_SOURCE_INVALID: '经历来源暂时无法核实。', PROVIDER_NOT_LINKED: '接待居民尚未关联正式角色。', ACTOR_UNAVAILABLE: '居民暂时不可用。', LOCATION_UNAVAILABLE: '地点暂时不可用。', PLAYER_UNAVAILABLE: '玩家状态暂时不可用。', APPOINTMENT_NOT_OWNED: '回访所属信息不匹配。', LEASE_RETRIES_EXHAUSTED: '处理多次未能完成。', LEASE_LOST: '本次处理已中断。', STALE_EPOCH: '小镇已更新。', MEMORY_DISABLED: '经历记录当前未启用。' }
const consumerName = key => ({ 'town.experience': '经历记录', 'town.appointment': '回访预约' })[key] || '小镇记录'
const itemKey = item => JSON.stringify([item.eventId, item.consumerKey])
const sameWorld = (a, b) => a?.worldId === b?.worldId && a?.worldEpoch === b?.worldEpoch
const locked = computed(() => !fresh.value || loading.value || sending.value || !!pending.value)
function time(value) { const date = new Date(value); return value != null && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + '（北京时间）' : '' }
function store(command) { pending.value = command; savePendingTownDeliveryRetry(command) }
async function read(more = false) {
  if (!props.open || loading.value || sending.value) return
  const token = ++readSequence, generation = lifecycle, cursor = more ? nextCursor.value : null
  loading.value = true; fresh.value = false; error.value = ''
  try {
    const data = await getTownDeliveries({ cursor, limit: 20 })
    if (token !== readSequence || generation !== lifecycle) return
    const changed = world.value && !sameWorld(world.value, data)
    if (pending.value && !sameWorld({ worldId: pending.value.worldId, worldEpoch: pending.value.body.worldEpoch }, data)) { store(null); notice.value = '小镇已更新，旧的重投请求已清除。' }
    if (changed) { items.value = []; nextCursor.value = null; loaded.value = false }
    world.value = { worldId: data.worldId, worldEpoch: data.worldEpoch }
    if (more && changed) { error.value = '小镇已更新，请从头重新读取记录。'; return }
    items.value = [...new Map([...(more ? items.value : []), ...data.items].map(item => [itemKey(item), item])).values()]
    nextCursor.value = JSON.stringify(data.nextCursor) !== JSON.stringify(cursor) ? data.nextCursor ?? null : null
    fresh.value = true; loaded.value = true
  } catch (e) { if (token === readSequence && generation === lifecycle) error.value = e.message }
  finally { if (token === readSequence && generation === lifecycle) loading.value = false }
}
function retry(item) { if (locked.value || item.status !== 'dead') return; const command = createTownDeliveryRetry(world.value, item); store(command); run(command) }
async function run(command) {
  if (!fresh.value || loading.value || sending.value || !sameWorld({ worldId: command.worldId, worldEpoch: command.body.worldEpoch }, world.value)) return
  const generation = lifecycle; sending.value = true; error.value = ''; notice.value = ''
  try {
    await executeTownDeliveryRetry(command)
    if (generation !== lifecycle) return
    store(null); notice.value = '重投请求已确认，当前处理进度以重新读取的列表为准。'
  } catch (e) { if (generation === lifecycle) { error.value = e.message; store({ ...command, rejected: !e.uncertain }) } }
  finally { if (generation === lifecycle) { sending.value = false; const message = error.value; await read(); if (generation === lifecycle && message && !error.value) error.value = message } }
}
function discard() { if (pending.value?.rejected && fresh.value && !loading.value && !sending.value) { store(null); error.value = '' } }
function close() { emit('close') }
function keydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); close() }
  if (event.key !== 'Tab') return
  const nodes = [...panel.value.querySelectorAll('button:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length), first = nodes[0], last = nodes.at(-1)
  if (!first) { event.preventDefault(); panel.value.focus() }
  else if (event.shiftKey && [first, panel.value].includes(document.activeElement)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && [last, panel.value].includes(document.activeElement)) { event.preventDefault(); first.focus() }
}
watch(() => props.open, async open => {
  ++lifecycle; ++readSequence; loading.value = false; sending.value = false; fresh.value = false; loaded.value = false; items.value = []; world.value = null; nextCursor.value = null; error.value = ''; notice.value = ''
  if (open) { returnFocus = document.activeElement; pending.value = loadPendingTownDeliveryRetry(); read(); await nextTick(); if (props.open) panel.value?.focus() }
  else if (returnFocus?.isConnected) returnFocus.focus()
}, { immediate: true })
onBeforeUnmount(() => { ++lifecycle; ++readSequence; if (returnFocus?.isConnected) returnFocus.focus() })
</script>

<style scoped>
.tdd-overlay{position:fixed;inset:0;z-index:2300;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.45);box-sizing:border-box}.tdd-panel{display:flex;flex-direction:column;width:580px;max-width:100%;max-height:calc(100dvh - 32px);border-radius:20px;background:#f4f1eeed;color:#74665a;box-shadow:0 12px 40px #352c2526;overflow:hidden;outline:none}header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px 24px 12px}h2{font-size:22px;margin:6px 0}h3{font-size:15px;margin:0}.tdd-content{overflow:auto;overscroll-behavior:contain;min-height:0;padding:4px 24px 24px}p{line-height:1.65;margin:8px 0;overflow-wrap:anywhere}.tdd-muted{font-size:13px;color:#8c8074}ol{list-style:none;margin:16px 0;padding:0}li{padding:16px 0}li+li{border-top:1px solid #e8e1da}.tdd-actions,.tdd-row{display:flex;gap:12px;flex-wrap:wrap}.tdd-row{justify-content:space-between;font-size:13px}.tdd-pending{margin-top:16px;padding:16px;background:#fffaf4;border-radius:12px}[role=alert]{color:#a44338}
@media(max-width:480px){.tdd-overlay{padding:10px}.tdd-panel{max-height:calc(100dvh - 20px);border-radius:16px}header{padding:16px}.tdd-content{padding:4px 16px 20px}}
</style>
