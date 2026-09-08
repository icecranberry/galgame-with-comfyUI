<template>
  <Teleport to="body">
    <div v-if="open" class="tap-overlay" @click.self="close" @keydown.stop="keydown" @keyup.stop @click.stop @pointerdown.stop @mousedown.stop @wheel.stop @touchstart.stop @touchmove.stop>
      <section ref="panel" class="tap-panel" role="dialog" aria-modal="true" aria-label="免费回访" tabindex="-1">
        <header><div><span class="tap-muted">邻舍小镇 · 工坊回访</span><h2>再来坐坐</h2></div><linshe-button variant="icon" size="sm" aria-label="关闭免费回访" @click="close">✕</linshe-button></header>
        <div class="tap-content" :aria-busy="loading || sending">
          <p>一次30分钟的免费回访，不收费，不发放道具或工资。</p>
          <p class="tap-muted">邀请来自已完成的工坊服务，接待者须已成为正式角色。回访须在服务结算后7天内完整结束；工作、休息和离镇安排优先，最终以双方日程为准。</p>
          <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p><p v-if="loading" role="status">正在读取回访邀请…</p>
          <linshe-button variant="ghost" size="sm" :disabled="loading || sending" @click="read">重新读取</linshe-button>
          <section v-if="pending" aria-label="待确认操作" class="tap-pending">
            <h3>{{ pending.kind === 'accept' ? '预约结果待确认' : '取消结果待确认' }}</h3>
            <p v-if="pending.body.startAt">原定时间：{{ time(pending.body.startAt) }}，共30分钟。</p>
            <p class="tap-muted">重试沿用同一次操作，不会另建预约。重新读取不会自动提交。</p>
            <div class="tap-actions"><linshe-button size="sm" :disabled="!fresh || loading || sending" :loading="sending" @click="run(pending)">重试原请求</linshe-button><linshe-button v-if="pending.rejected" variant="link" size="sm" :disabled="!fresh || loading || sending" @click="discard">按最新状态重新选择</linshe-button></div>
          </section>
          <section v-if="review" aria-label="确认回访安排" class="tap-review">
            <h3>{{ review.kind === 'accept' ? '确认这次免费回访' : '确认取消回访' }}</h3>
            <p>{{ residentName(review.dto) }} · {{ locationName(review.dto.locationKey) }}</p>
            <p>{{ time(review.startAt ?? review.dto.startAt) }} 至 {{ time((review.startAt ?? review.dto.startAt) + duration) }}</p>
            <p class="tap-muted">{{ review.kind === 'accept' ? '确认后才会提交这30分钟的预约，不收取费用。' : '确认后取消这次安排，不涉及费用或道具。' }}</p>
            <div class="tap-actions"><linshe-button variant="primary" :disabled="locked" @click="confirm">{{ review.kind === 'accept' ? '确认预约此时间' : '确认取消预约' }}</linshe-button><linshe-button variant="ghost" :disabled="sending" @click="review = null">返回修改</linshe-button></div>
          </section>
          <section aria-label="回访邀请"><h3>回访邀请</h3><p v-if="data && !candidates.length" class="tap-muted">暂时没有可接受的回访邀请。</p>
            <article v-for="(candidate, index) in candidates" :key="candidate.candidateId">
              <h4>{{ residentName(candidate) }}的回访邀请</h4><p>{{ locationName(candidate.locationKey) }}</p><p class="tap-muted">须在 {{ time(candidate.expiresAt) }} 前结束。</p>
              <label :for="`tap-time-${index}`">开始时间（北京时间 UTC+8）</label>
              <linshe-input :id="`tap-time-${index}`" v-model="chosen[candidate.candidateId]" type="datetime-local" :max="localTime(candidate.expiresAt - duration)" :disabled="locked || !!review" />
              <linshe-button size="sm" :disabled="locked || !!review || !chosen[candidate.candidateId]" @click="prepare(candidate)">核对回访时间</linshe-button>
            </article>
          </section>
          <section aria-label="我的回访"><h3>我的回访</h3><p v-if="data && !appointments.length" class="tap-muted">还没有回访安排。</p>
            <article v-for="appointment in appointments" :key="appointment.appointmentId"><h4>{{ residentName(appointment) }} · {{ statuses[appointment.status] || '状态待确认' }}</h4><p>{{ locationName(appointment.locationKey) }}</p><p>{{ time(appointment.startAt) }} 至 {{ time(appointment.endAt) }}</p><p v-if="appointment.status === 'accepted'" class="tap-muted">回访不会覆盖双方原有的工作、休息或离镇安排。</p><linshe-button v-if="appointment.status === 'accepted'" variant="link" size="sm" :disabled="locked || !!review" @click="review = { kind: 'cancel', dto: appointment }">取消这次回访</linshe-button></article>
          </section>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import { getTownAppointments, parseTownAppointmentBeijingTime, createTownAppointmentCommand, executeTownAppointmentCommand, loadPendingTownAppointment, savePendingTownAppointment } from '../../api/index.js'
const props = defineProps({ open: Boolean, residents: { type: Array, default: () => [] }, locations: { type: Array, default: () => [] } })
const emit = defineEmits(['close'])
const duration = 30 * 60000, panel = ref(null), data = ref(null), chosen = ref({}), review = ref(null)
const loading = ref(false), sending = ref(false), fresh = ref(false), error = ref(''), notice = ref(''), pending = ref(null)
let lifecycle = 0, readSequence = 0, returnFocus
const statuses = { accepted: '已预约', cancelled: '已取消', expired: '已结束' }
const sameWorld = (item, overview) => item?.scope?.worldId === overview?.worldId && item?.scope?.worldEpoch === overview?.worldEpoch
const candidates = computed(() => (data.value?.candidates || []).filter(item => sameWorld(item, data.value) && item.status === 'offered'))
const appointments = computed(() => (data.value?.appointments || []).filter(item => sameWorld(item, data.value)))
const locked = computed(() => !fresh.value || loading.value || sending.value || !!pending.value)
function residentName(item) { const resident = props.residents.find(r => r.actorId === item.providerActorId || (r.characterId != null && r.characterId === item.characterId)); return resident?.displayName || resident?.display_name || resident?.name || '工坊居民' }
function locationName(key) { const location = props.locations.find(l => (l.key ?? l.locationKey) === key); return location?.name || '回访地点' }
function localTime(value) { return Number.isFinite(value) ? new Date(value + 8 * 3600000).toISOString().slice(0, 16) : '' }
function time(value) { const text = localTime(value); return text ? text.replace('T', ' ') + '（北京时间）' : '时间待确认' }
function store(command) { pending.value = command; savePendingTownAppointment(command) }
async function read() {
  if (!props.open || loading.value || sending.value) return
  const token = ++readSequence, generation = lifecycle; loading.value = true; fresh.value = false; error.value = ''; review.value = null
  try {
    const overview = await getTownAppointments()
    if (token !== readSequence || generation !== lifecycle) return
    if (data.value && (data.value.worldId !== overview.worldId || data.value.worldEpoch !== overview.worldEpoch)) chosen.value = {}
    if (pending.value && (pending.value.worldId !== overview.worldId || pending.value.body.worldEpoch !== overview.worldEpoch)) { store(null); chosen.value = {}; notice.value = '小镇已更新，旧的待确认操作已清除。' }
    data.value = overview; fresh.value = true
  } catch (e) { if (token === readSequence && generation === lifecycle) error.value = e.message }
  finally { if (token === readSequence && generation === lifecycle) loading.value = false }
}
function prepare(dto) {
  if (locked.value) return
  const startAt = parseTownAppointmentBeijingTime(chosen.value[dto.candidateId] || '')
  if (startAt == null || startAt <= Date.now() || startAt + duration > dto.expiresAt) { error.value = '请选择未来的北京时间，并确保完整30分钟在邀请有效期内。'; return }
  error.value = ''; review.value = { kind: 'accept', dto, startAt }
}
function confirm() {
  if (locked.value || !review.value) return
  const { kind, dto, startAt } = review.value
  if (!sameWorld(dto, data.value)) { review.value = null; fresh.value = false; return }
  if (kind === 'accept' && (startAt <= Date.now() || startAt + duration > dto.expiresAt)) { error.value = '所选时间已失效，请重新选择未来时间。'; review.value = null; return }
  const command = createTownAppointmentCommand(kind, dto, startAt); store(command); review.value = null; run(command)
}
async function run(command) {
  if (!fresh.value || loading.value || sending.value || !data.value || command.worldId !== data.value.worldId || command.body.worldEpoch !== data.value.worldEpoch) return
  const generation = lifecycle; sending.value = true; error.value = ''; notice.value = ''
  try {
    await executeTownAppointmentCommand(command)
    if (generation !== lifecycle) return
    store(null); notice.value = command.kind === 'accept' ? '预约已确认，请按约定时间前往。' : '回访已取消。'
  } catch (e) { if (generation === lifecycle) { error.value = e.message; store({ ...command, rejected: !e.uncertain }) } }
  finally {
    if (generation === lifecycle) { sending.value = false; const message = error.value; await read(); if (generation === lifecycle && message && !error.value) error.value = message }
  }
}
function discard() { if (pending.value?.rejected && fresh.value && !sending.value && !loading.value) { store(null); error.value = ''; chosen.value = {} } }
function close() { emit('close') }
function keydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); close() }
  if (event.key !== 'Tab') return
  const nodes = [...panel.value.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length)
  const first = nodes[0], last = nodes.at(-1)
  if (!first) { event.preventDefault(); panel.value.focus() }
  else if (event.shiftKey && [first, panel.value].includes(document.activeElement)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && [last, panel.value].includes(document.activeElement)) { event.preventDefault(); first.focus() }
}
watch([loading, sending, pending, review, data], async () => {
  await nextTick()
  if (props.open && document.activeElement === document.body) panel.value?.focus({ preventScroll: true })
})
watch(() => props.open, async open => {
  ++lifecycle; ++readSequence; loading.value = false; sending.value = false; fresh.value = false; data.value = null; review.value = null; chosen.value = {}; error.value = ''; notice.value = ''
  if (open) { returnFocus = document.activeElement; pending.value = loadPendingTownAppointment(); read(); await nextTick(); if (props.open) panel.value?.focus() }
  else if (returnFocus?.isConnected) returnFocus.focus()
}, { immediate: true })
onBeforeUnmount(() => { ++lifecycle; ++readSequence; if (returnFocus?.isConnected) returnFocus.focus() })
</script>

<style scoped>
.tap-overlay{position:fixed;inset:0;z-index:2200;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.45);box-sizing:border-box}.tap-panel{display:flex;flex-direction:column;width:580px;max-width:100%;max-height:calc(100dvh - 32px);border-radius:20px;background:#f4f1eeed;color:#74665a;box-shadow:0 12px 40px #352c2526;overflow:hidden;outline:none}header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px 24px 12px}h2{font-size:23px;margin:6px 0}h3{font-size:16px;margin:0 0 12px}h4{font-size:15px;margin:0 0 8px}.tap-content{overflow:auto;overscroll-behavior:contain;min-height:0;padding:4px 24px 24px}.tap-content>section{margin-top:24px}p{line-height:1.65;margin:8px 0;overflow-wrap:anywhere}.tap-muted{font-size:13px;color:#8c8074}article{padding:16px 0}article+article{border-top:1px solid #e8e1da}label{display:block;font-size:13px;margin:12px 0 8px}article .ls-input{width:100%;box-sizing:border-box;margin-bottom:12px;min-width:0}.tap-actions{display:flex;gap:12px;flex-wrap:wrap}.tap-review,.tap-pending{padding:16px;background:#fffaf4;border-radius:12px}[role=alert]{color:#a44338}
@media(max-width:480px){.tap-overlay{padding:10px}.tap-panel{max-height:calc(100dvh - 20px);border-radius:16px}header{padding:16px}.tap-content{padding:4px 16px 20px}}
</style>
