<template>
  <Teleport to="body">
    <div v-if="open" class="ta-overlay" @click.self="close" @keydown.stop="keydown" @keyup.stop @click.stop @pointerdown.stop @mousedown.stop @wheel.stop @touchstart.stop @touchmove.stop>
      <section ref="panel" class="ta-panel" role="dialog" aria-modal="true" aria-label="居民近况" tabindex="-1">
        <header><div><span class="ta-muted">邻舍小镇 · 居民近况</span><h2>{{ actor?.displayName || '小镇居民' }}</h2></div><linshe-button variant="icon" size="sm" aria-label="关闭居民近况" @click="close">✕</linshe-button></header>
        <div class="ta-content" :aria-busy="loading">
          <section aria-label="此刻"><h3>此刻</h3><p>{{ actor?.activityText || actionText }}</p><p v-if="actor?.busyReason" class="ta-muted">{{ reasonText(actor.busyReason) }}</p><p v-if="actor?.action?.type === 'work_shift'" class="ta-muted">工作状态不代表报酬已结算。</p></section>
          <p v-if="error" role="alert">{{ error }}</p><p v-if="loading" role="status">正在读取居民记录…</p>
          <linshe-button variant="ghost" size="sm" :disabled="loading || !actor?.actorId" @click="read(false)">重新读取</linshe-button>
          <section aria-label="行动缘由"><h3>行动缘由</h3><p v-if="loaded && !activities.length" class="ta-muted">暂时没有行动记录。</p><ol><li v-for="entry in activities" :key="entry.seq"><strong>{{ phaseText(entry.phase) }}</strong><p>{{ reasonText(entry.reasonCode) }}</p><p v-if="isWeatherShelter(entry.ruleKey)" class="ta-muted">本次行动用于回家避雨。</p><time>{{ dateText(entry.occurredAt) }}</time></li></ol></section>
          <section aria-label="近期已结算经历"><h3>近期已结算经历</h3><p v-if="loaded && !experiences.length" class="ta-muted">暂时没有已结算的经历。</p><ol><li v-for="entry in experiences" :key="entry.eventId"><p>{{ entry.summary }}</p><time>{{ dateText(entry.occurredAt) }}</time></li></ol></section>
          <linshe-button v-if="nextCursor != null" size="sm" :disabled="loading" @click="read(true)">加载更多</linshe-button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import { getTownActorActivities } from '../../api/index.js'
const props = defineProps({ open: Boolean, actor: { type: Object, default: null } })
const emit = defineEmits(['close'])
const panel = ref(null), activities = ref([]), experiences = ref([]), nextCursor = ref(null)
const loading = ref(false), loaded = ref(false), error = ref('')
let scope = 0, controller, world = null, returnFocus
const reasons = {
  VALIDATED: '行动条件已确认。', RESERVE: '行动所需位置已预留。', START: '行动已开始。', ADVANCE: '行动正在推进。',
  RECOVER: '已重新确认行动状态。', ARRIVED: '已经到达目的地。', DURATION_ELAPSED: '本次行动的计时已完成；这不代表报酬已结算。', LEFT_TARGET: '已离开目的地，原行动无法继续。', SCHEDULE_CHANGED: '安排变化，原行动已停止。',
  SCHEDULE_BLOCKED: '当前日程不允许继续这项行动。', PATH_UNREACHABLE: '暂时无法到达目的地，将稍后再尝试。',
  LEASE_EXPIRED: '预留已到期，原行动已停止。', LEASE_LOST: '预留已失效，需要重新安排。', RESOURCE_BUSY: '所需位置正被使用，暂时等待。',
  NOT_ARRIVED: '尚未到达目的地。', TARGET_OR_ACTOR_MISSING: '居民或目的地已不可用。',
  SIMULATION_CANCELLED: '这项行动已取消。', MODE_CHANGED: '小镇运行方式变化，原行动已停止。',
  SERVICE_BUSY: '正在接待工坊服务。', WORLD_RESET: '小镇已重新建立，原行动已停止。',
  SIMULATION_SCOPE_ENDED: '本次居民行动安排已结束，原行动已停止。',
  MEMBERSHIP_CHANGED: '居民的参与状态已变化，原行动已停止。',
  SERVICE_ACCEPTED: '已接受工坊服务，原行动让位于本次接待。',
}
function isWeatherShelter(ruleKey) {
  if (typeof ruleKey !== 'string') return false
  const match = /^town\.weather\.shelter:(0|[1-9]\d*)$/.exec(ruleKey)
  return !!match && Number.isSafeInteger(Number(match[1])) && Number.isFinite(new Date(Number(match[1])).getTime())
}
const reasonText = code => reasons[code] || '具体缘由暂未提供。'
const phaseText = phase => ({ validated: '已确认行动', reserved: '准备行动', running: '进行中', completed: '行动已完成', cancelled: '已取消', failed: '未能完成' })[phase] || '状态待确认'
const actionText = computed(() => {
  const action = props.actor?.action
  if (!action) return '暂无新的近况'
  if (action.phase !== 'running') return phaseText(action.phase)
  return ({ move_to: '正在前往目的地', rest: '正在休息', wait: '正在等候', work_shift: '正在工作' })[action.type] || '行动进行中'
})
function dateText(value) { const date = new Date(value); return value != null && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + '（北京时间）' : '' }
function reset() { activities.value = []; experiences.value = []; nextCursor.value = null; loaded.value = false; world = null }
function merge(previous, incoming, key) { return [...new Map([...previous, ...incoming].map(item => [item[key], item])).values()] }
async function read(more = false) {
  if (!props.open || !props.actor?.actorId || loading.value) return
  const token = ++scope, actorId = props.actor.actorId, cursor = more ? nextCursor.value : 0
  const expectedWorldId = props.actor.worldId, expectedWorldEpoch = props.actor.worldEpoch
  controller?.abort(); controller = new AbortController(); loading.value = true; error.value = ''
  try {
    const data = await getTownActorActivities(actorId, { cursor, limit: 10, signal: controller.signal })
    if (token !== scope || !props.open || props.actor?.actorId !== actorId
      || props.actor?.worldId !== expectedWorldId || props.actor?.worldEpoch !== expectedWorldEpoch) return
    const incomingWorld = JSON.stringify([data.worldId, data.worldEpoch])
    if ((expectedWorldId != null && data.worldId !== expectedWorldId)
      || (expectedWorldEpoch != null && data.worldEpoch !== expectedWorldEpoch)
      || (more && world !== incomingWorld)) { reset(); error.value = '小镇已更新，请重新读取居民记录。'; return }
    world = incomingWorld
    activities.value = merge(more ? activities.value : [], data.activities, 'seq')
    experiences.value = merge(more ? experiences.value : [], data.experiences, 'eventId')
    nextCursor.value = data.nextCursor != null && data.nextCursor !== cursor ? data.nextCursor : null
    loaded.value = true
  } catch (e) { if (token === scope && e.name !== 'AbortError') error.value = '暂时无法读取居民记录，请重新读取；已有记录仍保留。' }
  finally { if (token === scope) loading.value = false }
}
function close() { emit('close') }
function keydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); close() }
  if (event.key !== 'Tab') return
  const nodes = [...panel.value.querySelectorAll('button:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length)
  const first = nodes[0], last = nodes.at(-1)
  if (!first) { event.preventDefault(); panel.value.focus(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.value)) { event.preventDefault(); first.focus() }
}
watch(() => [props.open, props.actor?.actorId, props.actor?.worldId, props.actor?.worldEpoch], async ([open], previous) => {
  ++scope; controller?.abort(); loading.value = false; error.value = ''; reset()
  if (open) { if (!previous?.[0]) returnFocus = document.activeElement; read(); await nextTick(); if (props.open) panel.value?.focus() }
  else if (returnFocus?.isConnected) returnFocus.focus()
}, { immediate: true })
onBeforeUnmount(() => { ++scope; controller?.abort(); if (returnFocus?.isConnected) returnFocus.focus() })
</script>

<style scoped>
.ta-overlay{position:fixed;inset:0;z-index:2200;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.ta-panel{width:560px;max-width:100%;max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:#f4f1eeed;color:#74665a;border-radius:20px;box-shadow:0 12px 40px #352c2526;overflow:hidden;outline:none}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 24px 14px}h2{margin:6px 0 0;font-size:23px;overflow-wrap:anywhere}h3{font-size:16px;margin:0 0 12px}.ta-content{overflow:auto;overscroll-behavior:contain;padding:8px 24px 24px;min-height:0}section section{margin:12px 0 24px}p{line-height:1.65;margin:6px 0;overflow-wrap:anywhere}.ta-muted,time{color:#8c8074;font-size:13px}ol{padding:0;list-style:none;margin:0}li{padding:12px 0}li+li{border-top:1px solid #e8e1da}strong{font-size:14px}time{font-size:12px}[role=alert]{color:#a44338}
@media(max-width:480px){.ta-overlay{padding:10px}.ta-panel{max-height:calc(100dvh - 20px);border-radius:16px}header{padding:16px}.ta-content{padding:4px 16px 20px}}
</style>
