<template>
  <linshe-modal :model-value="open && !showTouchLines && !outfitConfirmation.open" :transition-ms="300" full :panel-class="{ 'es-detail-modal': editing }" body-class="es-manager-body" :title="`${character?.display_name || ''} · 立绘管理`" @close="$emit('close')">
    <template #header-extra>
      <span v-if="!editing" class="es-count" :aria-label="`已生成 ${imageCount} 张，共 ${slots.length} 张立绘`" title="已生成 / 总数">{{ imageCount }}/{{ slots.length }}</span>
      <linshe-button v-if="editing" variant="ghost" size="sm" @click="editing = null">← 全部立绘</linshe-button>
    </template>
    <Transition name="es-content">
      <div v-if="promptGenerating" class="es-scan-overlay" role="status" aria-live="polite">
        <div class="es-scan-line" aria-hidden="true"></div>
        <div class="es-scan-content">
          <strong>立绘脚本生成中</strong>
          <Transition name="es-phrase" mode="out-in"><p :key="scanTipIndex">{{ scanTips[scanTipIndex] }}</p></Transition>
          <linshe-button size="sm" :loading="controlling" @click="controlTask()">停止任务</linshe-button>
        </div>
      </div>
    </Transition>
    <p v-if="error" role="alert" class="es-error">{{ error }}</p>
    <Transition name="es-content" mode="out-in">
      <section v-if="editing" :key="editing.id" class="es-detail">
        <div class="es-detail-heading"><span class="es-name">{{ editing.name }}</span><span class="es-status">{{ statusLabels[editing.status] || '未生成' }}</span></div>
        <TownImageEditor
v-if="editing.image_url" :key="editing.image_url" :src="editing.image_url" :asset-id="character.id" crop-mode is-portrait fit-container
          generation-step="npcs" :generation-params="generation" :show-generation="false"
          :save-image="saveImage" :crop-image="cropImage" @saved="refresh" @cropped="refresh"
>
          <template #actions>
          <linshe-button size="sm" :disabled="locked || !editing.image_url || !prompt.trim()" :loading="working === 'hires'" @click="imageAction('hires').catch(() => {})">HiresFix</linshe-button>
          <linshe-button size="sm" :disabled="locked" @click="fileInput?.click()">上传图片</linshe-button>
          <linshe-button size="sm" :disabled="locked || !prompt.trim()" @click="regenerate">重新生成</linshe-button>
          <linshe-button variant="ghost" size="sm" @click="showPrompt = !showPrompt">微调提示词</linshe-button>
          <linshe-button variant="danger" size="sm" :disabled="locked || !editing.image_url" @click="removeImage">删除图片</linshe-button>
          </template>
        </TownImageEditor>
        <div v-if="!editing.image_url" class="es-toolbar">
          <linshe-button size="sm" :disabled="locked || !editing.image_url || !prompt.trim()" :loading="working === 'hires'" @click="imageAction('hires').catch(() => {})">HiresFix</linshe-button>
          <linshe-button size="sm" :disabled="locked" @click="fileInput?.click()">上传图片</linshe-button>
          <linshe-button size="sm" :disabled="locked || !prompt.trim()" @click="regenerate">重新生成</linshe-button>
          <linshe-button variant="ghost" size="sm" @click="showPrompt = !showPrompt">微调提示词</linshe-button>
          <linshe-button variant="danger" size="sm" :disabled="locked || !editing.image_url" @click="removeImage">删除图片</linshe-button>
        </div>
        <input ref="fileInput" class="es-file" type="file" accept="image/png,image/jpeg,image/webp" @change="upload">
      </section>
      <section v-else key="grid" class="es-overview">
        <StandingGenerationDirection v-model="requirement" v-model:outfit-scene="outfitScene" input-id="standing-character-direction" :disabled="locked" />
        <div class="es-toolbar">
          <linshe-button variant="primary" :disabled="(paused ? submitting || !!working : locked) || controlling || !targets.length" :loading="submitting || (paused && controlling)" @click="paused ? controlTask('restart') : generate()">{{ paused ? '重新生成' : busy ? '正在生成…' : imageCount > 0 ? '重新生成立绘' : '一键生成立绘' }}</linshe-button>
          <linshe-button v-if="busy || job?.resumable" size="sm" :loading="controlling" :disabled="job?.status === 'stopping' || controlling || submitting" @click="controlTask()">{{ paused || job?.resumable ? '继续任务' : job?.status === 'stopping' ? '正在停止…' : '停止任务' }}</linshe-button>
          <p v-if="job" class="es-progress" role="status">{{ jobText }} <span v-if="job.error"> · {{ job.error }}</span></p>
          <linshe-button class="es-touch-manage" size="sm" @click="showTouchLines=true">触摸台词管理</linshe-button>
        </div>
        <div class="es-touch-row"><p class="es-touch-status" role="status">{{ touchLineText }}</p></div>
        <div class="es-strip">
        <div class="es-grid" role="region" aria-label="立绘列表，可横向滚动" tabindex="0" @wheel="scrollStandings">
          <article v-for="slot in slots" :key="slot.id" class="es-slot">
            <div class="es-preview" role="button" tabindex="0" :aria-label="`查看${slot.name}立绘`" @click="edit(slot)" @keydown.enter="edit(slot)" @keydown.space.prevent="edit(slot)">
              <img v-if="slot.image_url" :src="slot.image_url" :alt="slot.name" loading="lazy">
              <span v-else-if="!pendingSlots.has(slot.id)" class="es-empty"><span aria-hidden="true">＋</span>待生成</span>
              <div v-if="pendingSlots.has(slot.id)" class="es-image-loading" role="status">
                <span v-if="!paused" class="es-spinner" aria-hidden="true"></span>
                <span>{{ paused ? '已停止，等待继续' : slot.status === 'generating' ? '正在生成立绘…' : '排队生成中…' }}</span>
              </div>
            </div>
            <div class="es-slot-title">
              <span class="es-name">{{ slot.name }}</span>
              <span class="es-status">{{ statusLabels[slot.status] || '未生成' }}</span>
            </div>
            <p v-if="slot.error" class="es-error">{{ slot.error }}</p>
          </article>
        </div>
        </div>
      </section>
    </Transition>
  </linshe-modal>
  <linshe-modal v-model="showPrompt" wide title="微调立绘提示词">
    <div class="es-prompt">
      <label class="es-label">生图提示词</label>
      <linshe-input v-model="prompt" type="textarea" :rows="6" :disabled="locked" />
      <TownPromptPanel :model-value="generation" step="npcs" hide-prefix show-portrait-lora @update:model-value="generation = $event" />
    </div>
    <template #footer><linshe-button variant="primary" :disabled="locked || prompt.trim().length < 10" @click="savePrompt">保存提示词与配置</linshe-button></template>
  </linshe-modal>
  <StandingTouchLinesManager :open="open && showTouchLines" :character-id="character?.id" :name="character?.display_name" @close="showTouchLines=false" @saved="refresh" />
  <StandingOutfitConfirmation :state="outfitConfirmation" @choose="chooseOutfitPolicy" />
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount, inject } from 'vue'
import StandingTouchLinesManager from './standing/StandingTouchLinesManager.vue'
import StandingGenerationDirection from './standing/StandingGenerationDirection.vue'
import StandingOutfitConfirmation from './standing/StandingOutfitConfirmation.vue'
import { useStandingOutfitConfirmation } from '../composables/useStandingOutfitConfirmation.js'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import TownImageEditor from './town/TownImageEditor.vue'
import TownPromptPanel from './town/TownPromptPanel.vue'
import * as api from '../api/index.js'
import { onEvent } from '../stores/unifiedStream.js'
const props = defineProps({ open: Boolean, character: Object, initialOutfitScene: { type: String, default: 'work' } })
defineEmits(['close'])
const { outfitConfirmation, confirmStandingOutfits, chooseOutfitPolicy } = useStandingOutfitConfirmation()
const confirm = inject('confirm', async () => false)
const slots = ref([]), jobs = ref([]), busy = ref(false)
const showTouchLines=ref(false)
const touchLines = ref({status:"empty"})
const touchLineText = computed(() => ({empty:"全身触摸默认开启；没有台词时，生成整套立绘会同步生成专属反应。",generating:"正在后台生成全身触摸台词，不影响立绘出图…",ready:"全身触摸台词已就绪 · 10 个部位，每处 3 句",failed:"触摸台词生成失败；保留已有台词，下次生成整套立绘时重试。"})[touchLines.value.status])
const requirement = ref(''), error = ref(''), submitting = ref(false), working = ref('')
const outfitScene = ref(props.initialOutfitScene)
const editingId = ref(null), prompt = ref(''), generation = ref({}), showPrompt = ref(false), fileInput = ref(null)
const editing = computed({ get: () => slots.value.find(s => s.id === editingId.value), set: value => { editingId.value = value?.id || null } })
const locked = computed(() => busy.value || submitting.value || !!working.value)
const job = computed(() => jobs.value[0])
const paused = computed(() => job.value?.status === 'paused')
const controlling = ref(false)
const pendingSlots = computed(() => {
  if (!busy.value || !job.value) return new Set()
  return new Set(JSON.parse(job.value.slots_json || '[]').slice(job.value.completed || 0))
})
async function controlTask(action = paused.value || job.value?.resumable ? 'resume' : 'stop') {
  if (controlling.value || submitting.value || !job.value) return
  error.value = ''
  controlling.value = true
  try { await api.controlExpressionStandingTask(props.character.id, job.value.id, action); await refresh() }
  catch (e) { error.value = e.message }
  finally { controlling.value = false }
}
const promptGenerating = computed(() => props.open && busy.value && job.value?.status === 'prompts')
const scanTipIndex = ref(0)
const scanTips = [
  '正在为角色提炼立绘脚本…',
  '正在翻阅角色档案与外观特征…',
  '正在推敲每个表情的姿态与神情…',
  '正在校准全身比例与服装细节…',
  '正在检查白色背景与留白…',
  '正在给立绘加入一点小情绪…',
  '正在整理角色辨识度细节…',
  '正在把灵感写进提示词…',
]
let scanTipTimer
watch(promptGenerating, active => {
  clearInterval(scanTipTimer)
  scanTipIndex.value = 0
  if (active) scanTipTimer = setInterval(() => { scanTipIndex.value = (scanTipIndex.value + 1) % scanTips.length }, 2600)
})
onBeforeUnmount(() => clearInterval(scanTipTimer))
const statusLabels = { empty: '未生成', queued: '等待出图', generating: '正在出图', done: '已完成', failed: '失败' }
const targets = computed(() => slots.value.map(s => s.id))
const imageCount = computed(() => slots.value.filter(s => s.image_url).length)
const jobText = computed(() => ({ queued: '等待任务', outfits: '正在自动补全所选服装，完成后继续生成立绘…', stopping: '当前步骤完成后停止，不再提交下一张', paused: '任务已停止，可继续剩余立绘，或按原生成方向重写本批次全部提示词并从头出图', prompts: '正在一次生成全部提示词…', generating: `正在逐张出图 ${job.value?.completed || 0}/${JSON.parse(job.value?.slots_json || '[]').length}`, done: '本批次已完成', partial_failed: '部分图片失败，可单独重试', failed: '任务失败' })[job.value?.status] || '')
let timer, requestSeq = 0
async function refresh() {
  if (!props.open || !props.character?.id) return
  const seq = ++requestSeq
  try {
    const data = await api.listExpressionStandings(props.character.id)
    if (seq !== requestSeq) return
    touchLines.value = data.touchLines || {status:"empty"}
    slots.value = data.slots; jobs.value = data.jobs; busy.value = data.busy
  } catch (e) { if (seq === requestSeq) error.value = e.message }
}
watch(() => [props.open, props.character?.id], () => {
  chooseOutfitPolicy()
  clearInterval(timer); requestSeq++
  showPrompt.value = false
  showTouchLines.value = false
  if (props.open) { outfitScene.value = props.initialOutfitScene; editingId.value = null; error.value = ''; refresh(); timer = setInterval(refresh, 2500) }
}, { immediate: true })
const unsubscribe = onEvent('expression_standings_updated', d => { if (d.characterId === props.character?.id) refresh() })
onBeforeUnmount(() => { clearInterval(timer); requestSeq++; unsubscribe() })
function edit(slot) { editingId.value = slot.id; prompt.value = slot.prompt || ''; generation.value = { ...slot.generation, portraitLoras: true }; showPrompt.value = false }
async function start(ids, reusePrompts = false) {
  if (locked.value || controlling.value) return
  error.value = ''; submitting.value = true
  try {
    const characterId = props.character.id
    const body = { slotIds: ids, requirement: requirement.value, outfitScene: outfitScene.value, reusePrompts }
    const missingOutfitPolicy = reusePrompts ? undefined : await confirmStandingOutfits(() => api.preflightExpressionStandings(characterId, body))
    if (missingOutfitPolicy === null) return
    await api.generateExpressionStandings(characterId, { ...body, missingOutfitPolicy })
    await refresh()
  }
  catch (e) { error.value = e.message }
  finally { submitting.value = false }
}
let scrollTarget = 0, scrollList = null, lastWheelAt = 0
function scrollStandings(event) {
  if (event.ctrlKey) return
  const list = event.currentTarget
  if (list.scrollWidth <= list.clientWidth) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (!delta) return
  event.preventDefault()
  const unit = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? list.clientWidth : 1
  const now = performance.now()
  if (scrollList !== list || now - lastWheelAt > 500) scrollTarget = list.scrollLeft
  scrollList = list
  lastWheelAt = now
  scrollTarget = Math.max(0, Math.min(list.scrollWidth - list.clientWidth, scrollTarget + delta * unit))
  list.scrollTo({ left: scrollTarget, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}
function generate() { return start(targets.value) }
async function savePrompt() {
  try { await api.updateExpressionStandingPrompt(props.character.id, editingId.value, prompt.value, generation.value); await refresh(); showPrompt.value = false; return true }
  catch (e) { error.value = e.message; return false }
}
async function regenerate() { if (await savePrompt()) await start([editingId.value], true) }
async function imageAction(action, body = {}) {
  const slot = editingId.value
  working.value = action; error.value = ''
  try { await api.editExpressionStanding(props.character.id, slot, action, body); await refresh() }
  catch (e) { error.value = e.message; throw e }
  finally { working.value = '' }
}
function saveImage(image) { return imageAction('image', { image }) }
function cropImage(rect) { return imageAction('crop', rect) }
async function upload(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file) return
  try {
    const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
    await imageAction('upload', { image })
  } catch (e) { error.value = e.message || '上传失败' }
}
async function removeImage() {
  if (!(await confirm({ title: '删除立绘', message: `删除「${editing.value.name}」的图片？提示词会保留。`, danger: true }))) return
  try { await api.deleteExpressionStanding(props.character.id, editingId.value); await refresh() } catch (e) { error.value = e.message }
}
</script>

<style>
.linshe-modal.es-detail-modal { height: min(960px, 94dvh); }
.linshe-modal .modal-body.es-manager-body { position:relative; display:flex; flex-direction:column; overflow:hidden; }
</style>
<style scoped>
.es-touch-manage { margin-left:auto;flex-shrink:0 }
.es-scan-overlay { position:absolute; inset:0; z-index:20; display:flex; align-items:center; justify-content:center; overflow:hidden; background:var(--glass-bg); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); border-radius:var(--radius-lg); }
.es-scan-line { position:absolute; inset:8% 12%; pointer-events:none; animation:es-scan 2.2s ease-in-out infinite; }
.es-scan-line::before { content:''; position:absolute; top:0; left:0; right:0; height:2px; background:linear-gradient(90deg,transparent,var(--accent),transparent); box-shadow:0 0 26px rgba(var(--accent-rgb),.55),0 0 8px rgba(var(--accent-rgb),.25); }
.es-scan-content { position:relative; padding:24px 20px; text-align:center; }
.es-scan-content strong { font-size:var(--fs-base); color:var(--accent); }
.es-scan-content p { margin:10px 0 16px; font-size:var(--fs-sm); color:var(--text-secondary); }
.es-phrase-enter-active,.es-phrase-leave-active { transition:transform .3s ease,opacity .3s ease; }
.es-phrase-enter-from { opacity:0; transform:translateY(10px); }
.es-phrase-leave-to { opacity:0; transform:translateY(-10px); }
.es-image-loading { position:absolute; inset:0; display:flex; flex-direction:column; gap:12px; color:var(--text-secondary); font-size:var(--fs-sm); align-items:center; justify-content:center; background:var(--glass-bg); }
.es-spinner { width:28px; height:28px; border:3px solid rgba(var(--accent-rgb),.22); border-top-color:var(--accent); border-radius:50%; animation:cel-spin .8s linear infinite; }
@keyframes es-scan { 0%,100% { transform:translateY(0); opacity:.2; } 25%,50% { transform:translateY(100%); opacity:1; } 75% { transform:translateY(0); opacity:1; } }
.es-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin:12px 0; }
.es-label { display:block; margin:8px 0; font-size:var(--fs-sm); font-weight:600; color:var(--text-primary); }
.es-help,.es-progress { color:var(--text-secondary); font-size:var(--fs-sm); }
.es-count { color:var(--text-secondary); font-size:var(--fs-sm); font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap; }
.es-touch-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 12px;flex:none}
.es-touch-status{margin:0;font-size:var(--fs-sm);color:var(--text-secondary)}
.es-overview { display:flex; flex-direction:column; flex:1; min-height:0; }
.es-overview > :not(.es-strip) { flex-shrink:0; }
.es-strip { flex:1; min-height:0; container-type:size; }
.es-grid { display:grid; height:100%; grid-auto-flow:column; grid-auto-columns:max(140px, calc((100cqh - 40px) / 2)); gap:16px; overflow-x:auto; overflow-y:hidden; padding-bottom:12px; scrollbar-width:thin; scrollbar-color:var(--accent) var(--bg-sunken); }

.es-slot { position:relative; min-width:0; min-height:0; display:flex; flex-direction:column; }
.es-slot > .es-error { position:absolute; left:8px; right:8px; bottom:36px; max-height:40%; overflow:auto; margin:0; padding:8px; background:var(--modal-bg); border-radius:var(--radius-sm); }
.es-name { font-weight:600; color:var(--text-primary); font-size:var(--fs-sm); }
.es-status { color:var(--text-secondary); font-size:var(--fs-xs); }
.es-empty { display:grid; gap:8px; justify-items:center; color:var(--text-muted); font-size:var(--fs-xs); }
.es-empty > span { font-size:28px; font-weight:300; }
.es-progress { margin:0; flex:1; min-width:120px; }
.es-detail { flex:1; min-height:0; display:flex; flex-direction:column; gap:8px; }
.es-detail-heading { display:flex; gap:12px; align-items:center; flex-shrink:0; }
.es-preview { position:relative; flex:1; min-height:0; display:flex; align-items:center; justify-content:center; cursor:pointer; text-align:center; background:var(--bg-sunken); border-radius:var(--radius-lg); border:1px solid var(--border); overflow:hidden; }
.es-preview img { width:100%; height:100%; object-fit:contain; }
.es-slot-title { flex-shrink:0; display:flex; align-items:center; justify-content:space-between; gap:6px; margin-top:8px; font-size:var(--fs-xs); }
.es-error { color:var(--fun-pink); overflow-wrap:anywhere; font-size:var(--fs-sm); }
.es-file { display:none; }
.es-prompt { display:grid; gap:12px; padding:12px 0; }
.es-content-enter-active,.es-content-leave-active { transition:opacity .3s ease; }
.es-content-enter-from,.es-content-leave-to { opacity:0; }
@media(max-width:600px) { .es-grid { gap:12px; } }
</style>
