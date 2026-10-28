<template>
  <linshe-modal :model-value="open && !detailOpen && !outfitConfirmation.open" title="立绘管理" full :transition-ms="300" @close="$emit('close')">
    <div class="standing-manager">
      <StandingGenerationDirection v-model="requirement" v-model:outfit-scene="outfitScene" input-id="standing-batch-direction" :disabled="!!submitting" batch />
      <div class="standing-actions">
        <linshe-button variant="primary" :disabled="!canRegenerate" :loading="submitting === 'all'" @click="generate('all')">全部重新生成</linshe-button>
        <linshe-button :disabled="!canFill" :loading="submitting === 'missing'" @click="generate('missing')">补齐缺失立绘</linshe-button>
        <linshe-button :disabled="!available || !rows.some(row => !row.hasTouchLines && row.touchStatus !== 'generating')" :loading="submitting === 'touch'" @click="fillTouchLines">补齐触摸台词</linshe-button>
        <linshe-button :disabled="!canFillSpeech" :loading="submitting === 'speech'" @click="fillTouchSpeech">一键生成反馈语音</linshe-button>
      </div>
      <p class="standing-hint">反馈语音仅为已配置声音的角色补齐已保存的台词，无声音配置自动跳过；在角色的触摸台词管理中可逐句试听或重新生成。</p>
      <Transition name="standing-task">
        <section v-if="taskRunning || message" class="standing-task-notice" aria-label="后台任务状态" role="status">
          <div v-if="taskRunning" class="standing-task-running">
            <span class="standing-task-spinner" aria-hidden="true"></span>
            <strong>后台任务进行中</strong>
            <span v-if="activity.standing">{{ activity.standing }} 位角色立绘排队或生成中</span>
            <span v-if="activity.stopping">{{ activity.stopping }} 位角色立绘正在停止</span>
            <span v-if="activity.touch">{{ activity.touch }} 位角色台词生成中</span>
            <span v-if="speechCounts.pending">{{ speechCounts.pending }} 句反馈语音排队或生成中</span>
            <span class="standing-hint">关闭窗口后仍会继续</span>
          </div>
          <p v-if="message" class="standing-feedback">{{ message }}</p>
        </section>
      </Transition>
      <div v-if="error" class="standing-error" role="alert">{{ error }} <linshe-button variant="link" size="sm" @click="refresh">重新加载</linshe-button></div>
      <div v-if="loading" class="standing-hint" role="status">正在读取立绘数量…</div>
      <div v-else-if="!characters.length" class="empty">还没有角色，先去酒馆招募吧。</div>
      <div class="standing-characters">
        <div
          v-for="character in characters" :key="character.id" class="standing-character" role="button" tabindex="0"
          :class="{ 'is-full': isFull(overview[character.id]), 'is-generating': overview[character.id]?.busy }"
          :aria-label="`查看${character.display_name || character.name}的立绘管理`"
          @click="openDetail(character)" @keydown.enter.prevent="openDetail(character)" @keydown.space.prevent="openDetail(character)"
        >
          <div class="standing-avatar">
            <img v-if="character.avatar_path" :src="character.avatar_path" :alt="character.display_name || character.name" loading="lazy">
            <span v-else>{{ (character.display_name || character.name || '?').charAt(0) }}</span>
          </div>
          <div class="standing-meta">
            <strong class="standing-name">{{ character.display_name || character.name }}</strong>
            <div v-if="overview[character.id]" class="standing-count" :aria-label="`已生成 ${overview[character.id].count} 张，共 ${overview[character.id].total} 张立绘`">
              <span class="standing-count-num">{{ overview[character.id].count }}</span>
              <span class="standing-count-total">/{{ overview[character.id].total }}</span>
              <svg v-if="isFull(overview[character.id]) && !overview[character.id].busy" class="standing-complete" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 12 3 3 5-6" /><path d="M19.5 8a8 8 0 1 1-5-4" /></svg>
            </div>
            <span v-else class="standing-pending">— / —</span>
            <div class="standing-progress" aria-hidden="true"><i :style="{ transform: `scaleX(${completion(overview[character.id])})` }"></i></div>
            <span v-if="statusText(overview[character.id])" class="standing-status" :class="{ 'is-error': !overview[character.id]?.busy }" :title="overview[character.id]?.error || ''">{{ statusText(overview[character.id]) }}</span>
            <span v-if="overview[character.id]?.touchSpeech" class="standing-voice-status" :class="{ 'is-error': overview[character.id].touchSpeech.failed }">{{ speechStatusText(overview[character.id].touchSpeech) }}</span>
          </div>
        </div>
      </div>
    </div>
  </linshe-modal>
  <ExpressionStandingManager :open="open && detailOpen" :character="selectedCharacter" :initial-outfit-scene="outfitScene" @close="closeDetail" />
  <StandingOutfitConfirmation :state="outfitConfirmation" @choose="chooseOutfitPolicy" />
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'
import StandingGenerationDirection from './standing/StandingGenerationDirection.vue'
import StandingOutfitConfirmation from './standing/StandingOutfitConfirmation.vue'
import { useStandingOutfitConfirmation } from '../composables/useStandingOutfitConfirmation.js'
import ExpressionStandingManager from './ExpressionStandingManager.vue'
import { getStandingOverview, generateAllExpressionStandings, fillAllStandingTouchLines, fillAllStandingTouchSpeech, preflightAllExpressionStandings } from '../api/index.js'
import { onEvent } from '../stores/unifiedStream.js'
import { standingTaskActivity, standingTaskEndMessage } from '../utils/standingTaskStatus.js'

const props = defineProps({ open: Boolean, characters: { type: Array, default: () => [] } })
defineEmits(['close'])
const { outfitConfirmation, confirmStandingOutfits, chooseOutfitPolicy } = useStandingOutfitConfirmation()
const requirement = ref(''), submitting = ref(''), error = ref(''), message = ref('')
const outfitScene = ref('work')
const overview = ref({}), loading = ref(false), loaded = ref(false)
const selectedCharacter = ref(null), detailOpen = ref(false)
const rows = computed(() => props.characters.map(c => overview.value[c.id]).filter(Boolean))

const activity = computed(() => standingTaskActivity(rows.value))
const speechCounts = computed(() => rows.value.reduce((sum,row) => ({pending:sum.pending+(row.touchSpeech?.pending||0),failed:sum.failed+(row.touchSpeech?.failed||0)}), {pending:0,failed:0}))
const taskRunning = computed(() => activity.value.standing + activity.value.stopping + activity.value.touch + speechCounts.value.pending > 0)
const available = computed(() => loaded.value && !submitting.value && !error.value)
const canRegenerate = computed(() => available.value && rows.value.some(row => !row.busy))
const canFill = computed(() => available.value && rows.value.some(row => !row.busy && row.count < row.total))
const canFillSpeech = computed(() => available.value && rows.value.some(row => row.touchStatus !== 'generating' && row.touchSpeech?.enabled && row.touchSpeech.configured && row.touchSpeech.total > row.touchSpeech.ready + row.touchSpeech.pending))
let timer, eventTimer, messageTimer, requestSeq = 0
watch([message, () => props.open && !detailOpen.value], ([text, visible]) => {
  clearTimeout(messageTimer)
  if (text && visible) messageTimer = setTimeout(() => { message.value = '' }, 6000)
})

async function fillTouchLines() {
  submitting.value='touch';error.value=''
  try { const result=await fillAllStandingTouchLines();message.value=`已安排 ${result.started} 位角色补齐台词，跳过 ${result.skipped} 位已有台词或任务中的角色。`;await refresh() }
  catch(e) { error.value=e.message }
  finally { submitting.value='' }
}
async function fillTouchSpeech() {
  if(!canFillSpeech.value)return
  submitting.value='speech';error.value=''
  try {
    const result=await fillAllStandingTouchSpeech()
    const failures=Array.isArray(result.failed)?result.failed.length:Number(result.failed)||0
    message.value=`已安排 ${result.started} 句反馈语音，跳过 ${result.skipped} 位无需生成或未配置声音的角色。${failures?` ${failures} 项未能提交，请进入角色详情查看并重试。`:''}`
    await refresh()
  } catch(e) { error.value=e.message }
  finally { submitting.value='' }
}
function speechStatusText(speech) {
  if(!speech.enabled||!speech.configured)return speech.reason||'未配置声音，已跳过'
  const parts=[`语音 ${speech.ready} / ${speech.total}`]
  if(speech.pending)parts.push(`${speech.pending} 句生成中`)
  if(speech.failed)parts.push(`${speech.failed} 句失败，可重试`)
  return parts.join(' · ')
}

async function refresh() {
  if (!props.open) return
  const seq = ++requestSeq
  try {
    const data = await getStandingOverview()
    if (seq !== requestSeq || !props.open) return
    const speechWasRunning = speechCounts.value.pending > 0
    const speechNowRunning = data.characters.some(row => row.touchSpeech?.pending > 0)
    const speechFailed = data.characters.reduce((sum,row) => sum+(row.touchSpeech?.failed||0),0)
    const ended = standingTaskEndMessage(overview.value, data.characters) || (speechWasRunning&&!speechNowRunning ? speechFailed ? `反馈语音生成结束，${speechFailed} 句失败，可在角色详情中重试。` : '反馈语音已生成，可在角色详情中试听。' : '')
    if (ended) message.value = ended
    overview.value = Object.fromEntries(data.characters.map(row => [row.id, row]))
    loaded.value = true
    error.value = ''
  } catch (e) {
    if (seq === requestSeq && props.open) error.value = e.message
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}
watch(() => props.open, open => {
  chooseOutfitPolicy()
  clearInterval(timer)
  clearTimeout(eventTimer)
  requestSeq++
  detailOpen.value = false
  message.value = ''
  if (open) {
    loading.value = true
    loaded.value = false
    refresh()
    timer = setInterval(refresh, 3000)
  }
}, { immediate: true })
const unsubscribe = onEvent('expression_standings_updated', () => {
  if (!props.open) return
  clearTimeout(eventTimer)
  eventTimer = setTimeout(refresh, 150)
})
const unsubscribeSpeech = onEvent('speech_update', () => {
  if(!props.open)return
  clearTimeout(eventTimer)
  eventTimer=setTimeout(refresh,150)
})
onBeforeUnmount(() => { requestSeq++; clearInterval(timer); clearTimeout(eventTimer); clearTimeout(messageTimer); unsubscribe(); unsubscribeSpeech() })

function openDetail(character) { if (submitting.value) return; selectedCharacter.value = character; detailOpen.value = true }
function closeDetail() { detailOpen.value = false; refresh() }
function isFull(row) { return !!row && row.total > 0 && row.count >= row.total }
function completion(row) { return row?.total > 0 ? Math.max(0, Math.min(1, row.count / row.total)) : 0 }
function statusText(row) {
  if (!row) return ''
  if (row.busy) return ({ queued: '排队中', outfits: '补全服装中', prompts: '生成提示词中', generating: '立绘生成中', stopping: '正在停止', paused: '已暂停' })[row.jobStatus] || '任务进行中'
  if (['failed', 'partial_failed'].includes(row.jobStatus)) return '生成失败'
  return ''
}
async function generate(mode) {
  if (mode === 'all' ? !canRegenerate.value : !canFill.value) return
  submitting.value = mode
  error.value = ''; message.value = ''
  try {
    const body = { mode, requirement: requirement.value.trim(), outfitScene: outfitScene.value }
    const missingOutfitPolicy = await confirmStandingOutfits(() => preflightAllExpressionStandings(body))
    if (missingOutfitPolicy === null) return
    const result = await generateAllExpressionStandings({ ...body, missingOutfitPolicy })
    const parts = [result.started.length ? `已提交 ${result.started.length} 位角色的${mode === 'all' ? '重新生成' : '补齐'}任务` : '没有需要提交的新任务']
    if (result.skippedBusy.length) parts.push(`${result.skippedBusy.length} 位已有任务，已跳过`)
    if (result.skippedComplete.length) parts.push(`${result.skippedComplete.length} 位立绘已齐全`)
    for (const failure of result.failed) {
      const character = props.characters.find(c => c.id === failure.characterId)
      parts.push(`${character?.display_name || character?.name || failure.characterId}：${failure.error}`)
    }
    message.value = parts.join('；')
    await refresh()
  } catch (e) { error.value = e.message }
  finally { submitting.value = '' }
}
</script>

<style scoped>
.standing-manager { display: flex; flex-direction: column; gap: 16px; }
.standing-hint { margin: 0; color: var(--text-secondary); font-size: var(--fs-xs); line-height: 1.7; }
.standing-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.standing-task-notice { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; border-radius: var(--radius-md); background: var(--bg-sunken); }
.standing-task-running { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; color: var(--text-secondary); font-size: var(--fs-xs); }
.standing-task-running strong { color: var(--accent); font-weight: 600; }
.standing-task-spinner { width: 12px; height: 12px; flex-shrink: 0; border: 2px solid rgba(var(--accent-rgb), .2); border-top-color: var(--accent); border-radius: 50%; animation: cel-spin .8s linear infinite; }
.standing-task-enter-active, .standing-task-leave-active { transition: opacity .3s var(--ease-standard), transform .3s var(--ease-standard); }
.standing-task-enter-from, .standing-task-leave-to { opacity: 0; transform: translateY(-4px); }
.standing-feedback { margin: 0; color: var(--accent); font-size: var(--fs-sm); line-height: 1.7; }
.standing-error { color: var(--danger); font-size: var(--fs-sm); }

.standing-characters { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; padding: 4px 2px; }
.standing-character { display: flex; align-items: center; gap: 16px; min-width: 0; padding: 18px; background: var(--modal-lining-bg); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); color: var(--text-primary); text-align: left; cursor: pointer; transition: transform .3s var(--ease-spring); }
.standing-character:hover, .standing-character:focus-visible { transform: translateY(-3px); border-color: var(--accent); box-shadow: var(--shadow-sm); }
.standing-character:active { transform: translateY(0) scale(.98); }
.standing-character.is-full { border-color: rgba(var(--accent-rgb), .3); background: rgba(var(--accent-rgb), .04); }
.standing-character:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.standing-avatar { width: 60px; height: 60px; flex-shrink: 0; border-radius: var(--radius-full); overflow: hidden; display: grid; place-items: center; background: rgba(var(--accent-rgb), .12); color: var(--accent); font-size: var(--fs-lg); box-shadow: 0 0 0 3px var(--modal-lining-bg), 0 0 0 4px rgba(var(--accent-rgb), .16); transition: transform .3s var(--ease-spring); }
.standing-character:hover .standing-avatar { transform: rotate(-5deg) scale(1.06); }
.standing-avatar img { width: 100%; height: 100%; object-fit: cover; }
.standing-meta { display: flex; flex: 1; flex-direction: column; gap: 8px; min-width: 0; }
.standing-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-sm); color: var(--text-bright); }
.standing-count { display: flex; align-items: baseline; gap: 3px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.standing-count-num { color: var(--text-bright); font-size: 24px; font-weight: 700; line-height: 1; }
.standing-count-total { color: var(--text-secondary); font-size: 12px; font-weight: 600; line-height: 1; }
.is-full .standing-count-num { color: var(--accent); }
.is-full .standing-count-total { color: rgba(var(--accent-rgb), .72); }
.standing-complete { width: 22px; height: 22px; margin-left: auto; align-self: center; color: var(--accent); transform: rotate(-10deg); }
.standing-progress { height: 3px; overflow: hidden; border-radius: var(--radius-full); background: var(--bg-tertiary); }
.standing-progress i { display: block; height: 100%; border-radius: inherit; background: rgba(var(--accent-rgb), .42); transform-origin: left; transition: transform .3s var(--ease-standard); }
.is-full .standing-progress i { background: var(--accent); }
.is-generating .standing-progress { animation: standing-progress-pulse 1.2s ease-in-out infinite; }
.standing-pending { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.standing-status { align-self: flex-start; padding: 3px 7px; border-radius: var(--radius-full); background: rgba(var(--accent-rgb), .1); color: var(--accent); font-size: var(--fs-xs); line-height: 1.3; }
.standing-status.is-error { color: var(--danger); background: var(--bg-sunken); }
.standing-voice-status { color: var(--text-secondary); font-size: var(--fs-xs); line-height: 1.5; overflow-wrap: anywhere; }
.standing-voice-status.is-error { color: var(--danger); }
@keyframes standing-progress-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
@media (max-width: 600px) {
  .standing-characters { grid-template-columns: 1fr; }
  .standing-actions { gap: 10px; }
  .standing-task-notice { padding: 12px; }
}
</style>
