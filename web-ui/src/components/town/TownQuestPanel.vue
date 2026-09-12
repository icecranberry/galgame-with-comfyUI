<template>
  <town-paper-panel :open="open" title="奇遇手账" kicker="邻舍小镇 · 托付与见闻" :busy="loading || sending" :refreshing="loading"
    :refresh-disabled="loading || sending" @close="$emit('close')" @refresh="refresh">
    <div class="tq-notice" aria-live="polite">
      <p v-if="error" class="tq-error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <p v-if="loading && !quests" role="status">正在读取奇遇手账…</p>
    </div>
    <div v-if="pending" class="tq-pending">
      <p>有一笔「{{ commandNames[pending.kind] || '操作' }}」等待确认。重试会沿用同一次操作。</p>
      <div class="tq-actions">
        <linshe-button size="sm" :disabled="loading || sending || !quests || !fresh" :loading="sending" @click="run(pending)">重试同一次操作</linshe-button>
        <linshe-button v-if="rejected" variant="link" size="sm" :disabled="loading || sending" @click="discardRejected">使用最新状态</linshe-button>
      </div>
    </div>
    <template v-if="quests && quests.enabled">
      <section aria-labelledby="tq-active-title">
        <div class="tq-heading"><h3 id="tq-active-title">进行中</h3></div>
        <p v-if="!active.length" class="tq-empty">手上没有进行中的奇遇。去公告站、店里或邻居那里看看吧。</p>
        <article v-for="quest in active" :key="quest.questId" class="tq-card">
          <div class="tq-card-heading"><strong>{{ quest.title }}</strong><span class="tq-status">进行中</span></div>
          <p class="tq-intro">{{ quest.intro }}</p>
          <ol class="tq-steps">
            <li v-for="(step, index) in quest.steps" :key="step.key" :class="{ done: step.done, current: step.current }">
              <span class="tq-step-mark">{{ step.done ? '✓' : index + 1 }}</span>
              <div>
                <strong>{{ step.label }}</strong>
                <p v-if="step.hint">{{ step.hint }}</p>
                <p v-if="step.locationKey" class="tq-muted">{{ locationName(step.locationKey) }}</p>
              </div>
              <linshe-button v-if="step.current && step.locationKey" variant="link" size="sm" @click="go(step.locationKey)">前往</linshe-button>
            </li>
          </ol>
          <p class="tq-reward">{{ rewardText(quest) }}</p>
          <p v-if="quest.deadlineAt" class="tq-muted">期限 {{ deadline(quest.deadlineAt) }} · 到场、完成服务或到点后稍候会自动核对进度。</p>
          <div class="tq-actions">
            <linshe-button variant="secondary" size="sm" :disabled="locked" @click="submit('quest_progress', quest)">核对进度</linshe-button>
            <linshe-button variant="link" size="sm" :disabled="locked" @click="abandonId = quest.questId">放弃</linshe-button>
          </div>
          <div v-if="abandonId === quest.questId" class="tq-cancel" role="group" aria-label="确认放弃奇遇">
            <p>放弃后这份奇遇就结束了，托管中的赏钱会原路退回，模板冷却后才会再遇到。</p>
            <div class="tq-actions">
              <linshe-button variant="danger" size="sm" :disabled="locked" @click="submit('quest_abandon', quest)">确认放弃</linshe-button>
              <linshe-button variant="ghost" size="sm" @click="abandonId = null">继续做</linshe-button>
            </div>
          </div>
        </article>
      </section>
      <section aria-labelledby="tq-offered-title">
        <div class="tq-heading"><h3 id="tq-offered-title">奇遇邀约</h3></div>
        <p v-if="!offered.length" class="tq-empty">暂时没有新的邀约。在镇上走一走、跟邻居聊聊，奇遇会自己找上门。</p>
        <article v-for="quest in offered" :key="quest.questId" class="tq-card">
          <div class="tq-card-heading"><strong>{{ quest.title }}</strong><span class="tq-status">{{ quest.offeringActorId ? '邻居相托' : triggerText(quest) }}</span></div>
          <p class="tq-intro">{{ quest.intro }}</p>
          <ol class="tq-steps">
            <li v-for="step in quest.steps" :key="step.key">
              <span class="tq-step-mark">·</span>
              <div><strong>{{ step.label }}</strong><p v-if="step.hint">{{ step.hint }}</p></div>
            </li>
          </ol>
          <p class="tq-reward">{{ rewardText(quest) }}</p>
          <p class="tq-muted">邀约保留至 {{ deadline(quest.offerExpiresAt) }}。</p>
          <div class="tq-actions">
            <linshe-button variant="primary" size="sm" :disabled="locked" @click="submit('quest_accept', quest)">接下这份托付</linshe-button>
          </div>
        </article>
      </section>
      <section aria-labelledby="tq-closed-title">
        <div class="tq-heading"><h3 id="tq-closed-title">近来见闻</h3></div>
        <p v-if="!closed.length" class="tq-empty">还没有完成或结束过的奇遇。</p>
        <article v-for="quest in closed" :key="quest.questId" class="tq-card tq-closed">
          <div class="tq-card-heading"><strong>{{ quest.title }}</strong>
            <span class="tq-status" :class="{ done: quest.status === 'completed' }">{{ statusText(quest.status) }}</span></div>
        </article>
      </section>
    </template>
    <p v-else-if="quests" class="tq-muted">奇遇功能暂未开启。先在钱袋面板里开张小镇生活，奇遇才会慢慢出现。</p>
  </town-paper-panel>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import TownPaperPanel from './TownPaperPanel.vue'
import { fetchTownQuests, createTownLifeCommand, executeTownLifeCommand, getPendingTownLifeCommand, savePendingTownLifeCommand } from '../../api/index.js'

const props = defineProps({ open: Boolean, locations: { type: Array, default: () => [] } })
const emit = defineEmits(['close', 'move-to'])
const quests = ref(null), loading = ref(false), sending = ref(false), fresh = ref(false)
const error = ref(''), notice = ref(''), abandonId = ref(null), rejected = ref(false)
// 奇遇的待确认操作独立成通道，不与钱袋/公告站互相顶替。
const CHANNEL = 'quests'
const pending = ref(getPendingTownLifeCommand(CHANNEL))
const commandNames = { quest_accept: '接下奇遇', quest_abandon: '放弃奇遇', quest_progress: '核对进度' }
const offered = computed(() => quests.value?.offered || [])
const active = computed(() => quests.value?.active || [])
const closed = computed(() => quests.value?.closed || [])
const locked = computed(() => loading.value || sending.value || !!pending.value || !fresh.value)
const locationName = key => props.locations?.find(l => l.key === key)?.name || '镇上的某个地点'
const statusText = status => ({ completed: '已完成', expired: '已结束', abandoned: '已放弃' })[status] || status
const triggerText = quest => ({ board: '公告站委托', venue: '店里的活儿', npc: '邻居相托' })[quest.trigger?.type] || '奇遇'
function rewardText(quest) {
  const coins = quest.rewards?.coins ?? 0
  const items = (quest.rewards?.items || []).map(item => `${item.name || item.templateId}×${item.count ?? 1}`)
  const parts = []
  if (coins > 0) parts.push(`赏钱 ${coins} 邻币`)
  if (items.length) parts.push(`酬谢 ${items.join('、')}`)
  return parts.length ? parts.join(' + ') : '一份心意'
}
function deadline(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '待确认' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + '（北京时间）'
}
function message(e) {
  return ({ QUEST_ACTIVE_LIMIT: '已经有进行中的奇遇了，先完成它再说。', QUEST_STATE_CONFLICT: '奇遇状态已变化，请重新读取。',
    OFFER_EXPIRED: '这份邀约已过期，请重新读取。', QUEST_NOT_FOUND: '这份奇遇不存在，请重新读取。',
    VERSION_CONFLICT: '奇遇状态已变化，请重新读取后重试。', STALE_EPOCH: '小镇已更新，请重新读取状态。',
    INSUFFICIENT_FUNDS: '发布方暂时拿不出赏钱，稍后再试。' })[e.code] || e.message || '操作未完成，请重新读取状态。'
}
let readSequence = 0, lifecycle = 0, alive = true
async function refresh() {
  if (!props.open) return
  const sequence = ++readSequence, generation = lifecycle
  const current = () => alive && props.open && generation === lifecycle && sequence === readSequence
  if (!pending.value) error.value = ''
  loading.value = true; fresh.value = false
  try {
    const data = await fetchTownQuests()
    if (!current()) return
    if (!data || !Array.isArray(data.offered) || !Number.isSafeInteger(data.worldEpoch)) throw new Error('奇遇状态不完整，请稍后重新读取。')
    quests.value = data
    fresh.value = true
    if (pending.value && (pending.value.worldId !== data.worldId || pending.value.body.worldEpoch !== data.worldEpoch)) {
      pending.value = null; savePendingTownLifeCommand(null, CHANNEL); rejected.value = false
      notice.value = '小镇已更新，旧操作已停止。请按当前状态重新选择。'
    }
  } catch (e) { if (current()) error.value = message(e) }
  finally { if (current()) loading.value = false }
}
function submit(kind, quest) {
  if (locked.value || !quests.value) return
  if (kind === 'quest_accept' && active.value.length) { error.value = '已经有进行中的奇遇了，先完成它再说。'; return }
  const command = createTownLifeCommand(kind, { worldId: quests.value.worldId, worldEpoch: quests.value.worldEpoch, questId: quest.questId })
  pending.value = command; savePendingTownLifeCommand(command, CHANNEL)
  run(command)
}
async function run(command) {
  if (!props.open || !fresh.value || sending.value || loading.value || !command
    || command.body.idempotencyKey !== pending.value?.body.idempotencyKey
    || command.worldId !== quests.value?.worldId || command.body.worldEpoch !== quests.value?.worldEpoch) return
  const generation = lifecycle
  const current = () => alive && props.open && generation === lifecycle
  sending.value = true; error.value = ''; notice.value = ''; rejected.value = false
  try {
    const data = await executeTownLifeCommand(command)
    if (getPendingTownLifeCommand(CHANNEL)?.body.idempotencyKey === command.body.idempotencyKey) savePendingTownLifeCommand(null, CHANNEL)
    if (current()) {
      pending.value = null; abandonId.value = null
      notice.value = ({ quest_accept: '接下了！按步骤走，完成后赏钱直接进钱包。', quest_abandon: '已放下这份奇遇。', quest_progress: '进度已核对。' })[command.kind] || '操作已确认。'
      if (command.kind === 'quest_accept' && data?.questId) notice.value = '接下了！按步骤走，完成后赏钱直接进钱包。'
    }
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
  lifecycle++; readSequence++; loading.value = false; sending.value = false; fresh.value = false; abandonId.value = null
  if (open) { pending.value = getPendingTownLifeCommand(CHANNEL); rejected.value = false; refresh() }
}, { immediate: true })
onBeforeUnmount(() => { alive = false; lifecycle++; readSequence++ })
</script>

<style scoped>
.tq-notice:empty { display: none; }.tq-notice { font-size: 13px; }.tq-error { color: #b8574f; }
.tq-pending, .tq-cancel { background: #eee5db; padding: 12px 14px; border-radius: 12px; margin-bottom: 16px; font-size: 13px; }.tq-cancel { margin: 12px 0 0; }
.tq-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
h3 { font-size: 16px; margin: 0; font-weight: 600; }
p { margin: 8px 0; overflow-wrap: anywhere; }
section { margin-bottom: 24px; }
.tq-heading { margin: 24px 0 12px; }
.tq-muted { color: #918278; font-size: 13px; }
.tq-empty { color: #918278; padding: 10px 0; }
.tq-card { padding: 16px 0; border-bottom: 1px solid #e8dfd7; }.tq-card:last-child { border-bottom: 0; }
.tq-closed { padding: 10px 0; }
.tq-card-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.tq-card-heading strong { font-weight: 500; }
.tq-status { font-size: 12px; color: #ad8066; }.tq-status.done { color: #779078; }
.tq-intro { font-size: 13px; line-height: 1.7; }
.tq-steps { list-style: none; margin: 10px 0; padding: 0; }
.tq-steps li { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; }.tq-steps li > div { flex: 1; min-width: 0; }
.tq-steps strong { font-size: 13px; font-weight: 500; }.tq-steps p { font-size: 12px; color: #948579; margin: 2px 0 0; }
.tq-step-mark { border-radius: 50%; width: 24px; height: 24px; display: grid; place-items: center; background: #eadfd6; color: #9b7665; font-size: 12px; flex-shrink: 0; }
.tq-steps li.current .tq-step-mark { background: #b76c59; color: #fffaf1; }
.tq-steps li.done .tq-step-mark { background: #dde6dc; color: #779078; }
.tq-reward { color: #b76c59; font-size: 13px; }
</style>
