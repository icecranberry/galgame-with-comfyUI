<template>
  <linshe-modal :model-value="open && !detailOpen" title="立绘管理" full :transition-ms="300" @close="$emit('close')">
    <div class="standing-manager">
      <div class="standing-direction">
        <label for="standing-batch-direction">生成方向</label>
        <linshe-input id="standing-batch-direction" v-model="requirement" :maxlength="2000" :disabled="!!submitting" placeholder="例如统一穿冬装、动作更含蓄、保持相同服装…（可选）" />
        <p>填写后，本次批量生成的所有角色都会使用这个方向；留空则按各自人设生成。</p>
      </div>
      <div class="standing-actions">
        <linshe-button variant="primary" :disabled="!canRegenerate" :loading="submitting === 'all'" @click="generate('all')">全部重新生成</linshe-button>
        <linshe-button :disabled="!canFill" :loading="submitting === 'missing'" @click="generate('missing')">补齐缺失立绘</linshe-button>
        <linshe-button :disabled="!available || !rows.some(row => !row.hasTouchLines && row.touchStatus !== 'generating')" :loading="submitting === 'touch'" @click="fillTouchLines">补齐触摸台词</linshe-button>
      </div>
      <Transition name="standing-task">
        <section v-if="taskRunning || message" class="standing-task-notice" aria-label="后台任务状态" role="status">
          <div v-if="taskRunning" class="standing-task-running">
            <span class="standing-task-spinner" aria-hidden="true"></span>
            <strong>后台任务进行中</strong>
            <span v-if="activity.standing">{{ activity.standing }} 位角色立绘排队或生成中</span>
            <span v-if="activity.stopping">{{ activity.stopping }} 位角色立绘正在停止</span>
            <span v-if="activity.touch">{{ activity.touch }} 位角色台词生成中</span>
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
          v-if="archivedCount"
          class="standing-arch-toggle"
          role="button"
          tabindex="0"
          :aria-pressed="showArchived"
          :title="showArchived ? '收起归档角色' : `展开 ${archivedCount} 个归档角色`"
          @click="toggleShowArchived"
          @keydown.enter.prevent="toggleShowArchived"
          @keydown.space.prevent="toggleShowArchived"
        >
          <svg class="standing-arch-arrow" :class="{ open: showArchived }" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6,9 12,15 18,9" /></svg>
          <span>归档角色</span>
          <span class="standing-arch-count">{{ archivedCount }}</span>
        </div>
        <div
          v-for="character in displayCharacters" :key="character.id" class="standing-character" role="button" tabindex="0"
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
          </div>
        </div>
      </div>
    </div>
  </linshe-modal>
  <ExpressionStandingManager :open="open && detailOpen" :character="selectedCharacter" @close="closeDetail" />
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import ExpressionStandingManager from './ExpressionStandingManager.vue'
import { getStandingOverview, generateAllExpressionStandings, fillAllStandingTouchLines } from '../api/index.js'
import { onEvent } from '../stores/unifiedStream.js'
import { standingTaskActivity, standingTaskEndMessage } from '../utils/standingTaskStatus.js'

const props = defineProps({ open: Boolean, characters: { type: Array, default: () => [] } })
defineEmits(['close'])
const requirement = ref(''), submitting = ref(''), error = ref(''), message = ref('')
const overview = ref({}), loading = ref(false), loaded = ref(false)
const selectedCharacter = ref(null), detailOpen = ref(false)
const rows = computed(() => props.characters.map(c => overview.value[c.id]).filter(Boolean))

// ── 归档角色：默认不显示（与表情包管理同一口径）──
// 立绘管理只关心还在活动的角色；归档的不参与任何行为，也没必要生成立绘。
// 默认收起，需要时点列表上方的开关展开，状态存本地。
const SHOW_ARCHIVED_KEY = 'linshe.standing.showArchived'
const showArchived = ref((() => {
  try { return localStorage.getItem(SHOW_ARCHIVED_KEY) === '1' } catch { return false }
})())
function toggleShowArchived() {
  showArchived.value = !showArchived.value
  try { localStorage.setItem(SHOW_ARCHIVED_KEY, showArchived.value ? '1' : '0') } catch {}
}
const archivedCount = computed(() => props.characters.filter(c => c.archived).length)
/** 网格实际渲染的角色：收起归档时只留活跃角色 */
const displayCharacters = computed(() =>
  (showArchived.value || !archivedCount.value)
    ? props.characters
    : props.characters.filter(c => !c.archived)
)
const activity = computed(() => standingTaskActivity(rows.value))
const taskRunning = computed(() => activity.value.standing + activity.value.stopping + activity.value.touch > 0)
const available = computed(() => loaded.value && !submitting.value && !error.value)
const canRegenerate = computed(() => available.value && rows.value.some(row => !row.busy))
const canFill = computed(() => available.value && rows.value.some(row => !row.busy && row.count < row.total))
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

async function refresh() {
  if (!props.open) return
  const seq = ++requestSeq
  try {
    const data = await getStandingOverview()
    if (seq !== requestSeq || !props.open) return
    const ended = standingTaskEndMessage(overview.value, data.characters)
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
onBeforeUnmount(() => { requestSeq++; clearInterval(timer); clearTimeout(eventTimer); clearTimeout(messageTimer); unsubscribe() })

function openDetail(character) { selectedCharacter.value = character; detailOpen.value = true }
function closeDetail() { detailOpen.value = false; refresh() }
function isFull(row) { return !!row && row.total > 0 && row.count >= row.total }
function completion(row) { return row?.total > 0 ? Math.max(0, Math.min(1, row.count / row.total)) : 0 }
function statusText(row) {
  if (!row) return ''
  if (row.busy) return ({ queued: '排队中', prompts: '生成提示词中', generating: '立绘生成中', stopping: '正在停止', paused: '已暂停' })[row.jobStatus] || '任务进行中'
  if (['failed', 'partial_failed'].includes(row.jobStatus)) return '生成失败'
  return ''
}
async function generate(mode) {
  if (mode === 'all' ? !canRegenerate.value : !canFill.value) return
  submitting.value = mode
  error.value = ''; message.value = ''
  try {
    const result = await generateAllExpressionStandings({ mode, requirement: requirement.value.trim() })
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
.standing-direction { display: flex; flex-direction: column; gap: 8px; }
.standing-direction label { color: var(--text-primary); font-size: var(--fs-sm); font-weight: 600; }
.standing-direction p, .standing-hint { margin: 0; color: var(--text-secondary); font-size: var(--fs-xs); line-height: 1.7; }
.standing-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.standing-task-notice { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; border-radius: var(--radius-md); background: var(--bg-sunken); }
.standing-task-running { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; color: var(--text-secondary); font-size: var(--fs-xs); }
.standing-task-running strong { color: var(--accent); font-weight: 600; }
.standing-task-spinner { width: 12px; height: 12px; flex-shrink: 0; border: 2px solid rgba(var(--accent-rgb), .2); border-top-color: var(--accent); border-radius: 50%; animation: cel-spin .8s linear infinite; }
.standing-task-enter-active, .standing-task-leave-active { transition: opacity .3s var(--ease-standard), transform .3s var(--ease-standard); }
.standing-task-enter-from, .standing-task-leave-to { opacity: 0; transform: translateY(-4px); }
.standing-feedback { margin: 0; color: var(--accent); font-size: var(--fs-sm); line-height: 1.7; }
.standing-error { color: var(--danger); font-size: var(--fs-sm); }
/* ── 归档角色开关（跨整行，默认收起归档角色）── */
.standing-arch-toggle {
  grid-column: 1 / -1;
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px;
  border-radius: 10px;
  font-size: 12px; font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer; user-select: none;
  transition: background 0.15s ease, color 0.15s ease;
}
.standing-arch-toggle:hover { background: var(--bg-hover); color: var(--accent); }
.standing-arch-arrow {
  flex-shrink: 0;
  transform: rotate(-90deg);
  transition: transform 0.18s var(--ease-standard);
}
.standing-arch-arrow.open { transform: rotate(0deg); }
.standing-arch-count {
  margin-left: auto;
  font-size: 10px; font-weight: 600;
  padding: 0 6px; border-radius: var(--radius-full);
  background: var(--tint-subtle);
}

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
@keyframes standing-progress-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
@media (max-width: 600px) {
  .standing-characters { grid-template-columns: 1fr; }
  .standing-actions { gap: 10px; }
  .standing-task-notice { padding: 12px; }
}
</style>
