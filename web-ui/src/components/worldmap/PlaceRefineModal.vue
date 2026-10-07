<template>
  <!-- ── 修正地点弹窗：上传 / 粘贴 / 拖拽参考图，或写文字要点，邻舍据此重写
       「类型 + 一句话简介 + 英文画面描述」三个字段。

       ★ 2026-10-07 用户口径：**明确要求照「角色 → 修正外观」那一套做**（并给了样式参考），
         所以本组件与 AppearanceRefineModal.vue 刻意**保持同构**：
         同样两条入口（用参考图 / 用文字描述）、同样"只出草稿不落库"、
         同样把可编辑结果回传给父级由父级决定怎么落库。改这里时请一并看那边。

       ⚠ 与「✨ AI 生成画面描述」的区别：那个只补 scene_prompt **一个字段**
         （输入是用户已写好的中文简介）；这个重写**整条可描述字段**（输入是图或零散要点）。 -->
  <linshe-modal v-model="visibleModel" :title="`修正地点 — ${placeName || ''}`" wide>
    <div class="pr-body" :class="{ 'is-dragging': dragging }" @dragover.prevent="dragging = true" @dragleave="onDragLeave" @drop.prevent="onDrop">
      <LinsheTabs v-model="mode" :options="MODE_OPTIONS" size="sm" class="pr-mode-tabs" :disabled="busy" />

      <!-- ── 图片模式 ── -->
      <template v-if="mode === 'image'">
        <p class="pr-intro">
          给一张这个地方的参考图（实景、插画、概念图都行），邻舍会观察画面并重写
          <b>类型、一句话简介、英文画面描述</b>。支持点击上传、Ctrl+V 粘贴、拖拽到窗口<template v-if="characterId">，或从最近图片中挑选并截取</template>。
        </p>

        <div
          v-if="!image"
          class="pr-dropzone"
          role="button" tabindex="0"
          @click="openFilePicker"
          @keydown.enter.prevent="openFilePicker"
          @keydown.space.prevent="openFilePicker"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
          </svg>
          <span class="pr-dropzone-title">点击上传或拖拽图片到这里</span>
          <span class="pr-dropzone-sub">PNG / JPG / WEBP，不超过 6MB，也可以直接 Ctrl+V 粘贴</span>
        </div>
        <!-- 「从最近图片挑选」复用角色那套，但**地图没有角色**：这里用当前地图下
             该地点的身份占位（characterId 为空时整行不出现，避免点了没反应）。 -->
        <linshe-button v-if="!image && characterId" variant="secondary" block class="pr-recent-btn" :disabled="busy" @click="showPicker = true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
          </svg>
          从最近图片中挑选并截取
        </linshe-button>
        <div v-else-if="image" class="pr-preview">
          <img :src="image" class="pr-preview-img" alt="参考图预览" />
          <div class="pr-preview-actions">
            <linshe-button variant="ghost" size="sm" :disabled="busy" @click="clearImage">移除图片</linshe-button>
          </div>
        </div>
      </template>

      <!-- ── 文字模式 ── -->
      <template v-else>
        <p class="pr-intro">
          写下这里的要点——<b>几个词就够</b>（是什么地方、长什么样、什么氛围、有什么设施…），
          邻舍会保留你提到的每一项，再把没说到的补全成完整描述。不用写得工整。
        </p>

        <div class="pr-brief">
          <LinsheInput
            v-model="brief"
            type="textarea"
            :rows="4"
            placeholder="例：地下二层的旧网吧，机位挤成一排，烟味和泡面味混着，荧光灯管一闪一闪，收银台贴着褪色的价目表"
            :disabled="busy"
            @keydown.ctrl.enter.prevent="run"
            @keydown.meta.enter.prevent="run"
          />
          <div class="pr-brief-foot">
            <span class="pr-brief-hint">Ctrl + Enter 直接生成 · 越具体越贴合你的想法</span>
            <span class="pr-brief-count">{{ brief.length }} 字</span>
          </div>
          <div class="pr-chips">
            <span class="pr-chips-label">找灵感：</span>
            <button
              v-for="s in BRIEF_SAMPLES" :key="s.label" type="button"
              class="pr-chip" :disabled="busy" @click="brief = s.text"
            >{{ s.label }}</button>
          </div>
        </div>
      </template>

      <!-- 用户补充要求（两种模式共用）：留空则不加任何额外约束 -->
      <div class="pr-field">
        <label class="pr-label">补充要求<span class="pr-opt">（可选）</span></label>
        <LinsheInput v-model="hints" size="sm" placeholder="如：不要太繁华，就写它现在这副破败样子" :disabled="busy" />
      </div>

      <div v-if="busy" class="pr-analyzing">
        <span class="pr-spinner"></span> {{ mode === 'text' ? '邻舍正在扩写…' : '邻舍正在观察图片…' }}
      </div>

      <!-- 结果预览：三个字段都可编辑，应用后写回编辑表单（仍需点「保存」才落库） -->
      <div v-if="result.scenePrompt || result.kind || result.summary" class="pr-result">
        <div class="pr-result-head">
          <span>重写后的内容（可直接修改）</span>
        </div>
        <label class="pr-label">类型</label>
        <LinsheInput v-model="result.kind" size="sm" placeholder="商店街 / 站台 / 公园…" />
        <label class="pr-label">一句话简介</label>
        <LinsheInput v-model="result.summary" type="textarea" :rows="3" />
        <label class="pr-label">画面描述<span class="pr-opt">（英文，供生图/日程取景）</span></label>
        <LinsheInput v-model="result.scenePrompt" type="textarea" :rows="4" class="pr-scene" />
      </div>

      <div v-if="error" class="pr-error">{{ error }}</div>

      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" class="pr-file-input" @change="onFileChange" />
    </div>

    <template #footer>
      <span class="pr-foot-hint">{{ applyHint }}</span>
      <div style="flex:1"></div>
      <linshe-button
        variant="secondary"
        :disabled="mode === 'text' ? !brief.trim() : !image"
        :loading="busy"
        @click="run"
      >{{ hasResult ? '重新生成' : (mode === 'text' ? '扩写' : '开始分析') }}</linshe-button>
      <linshe-button variant="primary" :disabled="!hasResult || busy" @click="apply">
        {{ applyText }}
      </linshe-button>
    </template>
  </linshe-modal>

  <Teleport v-if="characterId" to="body">
    <RecentImageCropper
      v-if="showPicker"
      :character-id="characterId"
      @close="showPicker = false"
      @save="onRecentPicked"
    />
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, inject, onUnmounted } from 'vue'
import * as api from '../../api/index.js'
// ⚠ 本文件在 `components/worldmap/` 子目录下 → Linshe UI 在上一级的 `ui/`，
//    少一层 `../` 会让构建直接失败（Could not resolve）。RecentImageCropper 在上一级根目录。
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import LinsheModal from '../ui/LinsheModal.vue'
import LinsheTabs from '../ui/LinsheTabs.vue'
import RecentImageCropper from '../RecentImageCropper.vue'

const MODE_OPTIONS = [
  { value: 'image', label: '用参考图' },
  { value: 'text', label: '用文字描述' },
]

/**
 * 文字模式的「找灵感」示例：点一下填进输入框，用户可继续改。
 * 刻意保持**短、口语、要素零散** —— 这正是这个模式要解决的场景（用户懒得写整段描述）；
 * 若写成完整段落，反而会让人以为"必须写这么长"。与外观修正弹窗同一取向。
 */
const BRIEF_SAMPLES = [
  { label: '街边小店', text: '窄巷口的小店、卷帘门半开、门口堆着纸箱、招牌灯只亮了一半' },
  { label: '居民楼道', text: '老居民楼的走廊、墙皮斑驳、声控灯、晾衣杆横在头顶、尽头一扇防盗门' },
  { label: '站台', text: '清晨的站台、长椅、自动售货机、积水倒映顶棚灯、远处轨道延伸进雾里' },
  { label: '河边夜市', text: '深夜的河堤夜市、塑料棚、炭炉白烟、串灯一路挂到河边、水面反光' },
]

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 地点 id（必填，后端据此读上下文） */
  placeId: { type: [Number, String], default: null },
  /** 地点名（只用于标题与给人看的语境） */
  placeName: { type: String, default: '' },
  /** 已入库角色 id（仅用于「从最近图片中挑选并截取」）；地图场景传 null 即隐藏该入口 */
  characterId: { type: [Number, String], default: null },
  /** 应用按钮文案 / 底部提示（父级可改写） */
  applyText: { type: String, default: '应用到编辑表单' },
  applyHint: { type: String, default: '应用后填进编辑表单，仍需点「保存」才落库' },
})

const emit = defineEmits(['update:modelValue', 'applied'])

const toastFn = inject('toast')

const visibleModel = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const image = ref('')
const mode = ref('image')
const brief = ref('')
const hints = ref('')
const dragging = ref(false)
const busy = ref(false)
const error = ref('')
const fileInput = ref(null)
const showPicker = ref(false)
/** 结果三字段（可编辑） */
const result = ref({ kind: '', summary: '', scenePrompt: '' })

const hasResult = computed(() =>
  !!(result.value.kind || result.value.summary || result.value.scenePrompt))

function resetState() {
  image.value = ''
  mode.value = 'image'
  brief.value = ''
  hints.value = ''
  dragging.value = false
  busy.value = false
  error.value = ''
  showPicker.value = false
  result.value = { kind: '', summary: '', scenePrompt: '' }
}

/** 清掉上一轮结果（切模式 / 换输入时调用，避免旧结果被误应用） */
function clearResult() {
  result.value = { kind: '', summary: '', scenePrompt: '' }
  error.value = ''
}

watch(() => props.modelValue, (open) => {
  if (open) resetState()
  document.removeEventListener('paste', onPaste)
  if (open) document.addEventListener('paste', onPaste)
})
// 切换模式时丢掉上一轮结果：否则「图片模式的结果」会被当成「文字模式的结果」直接应用
watch(mode, () => { if (!busy.value) clearResult() })
onUnmounted(() => document.removeEventListener('paste', onPaste))

function openFilePicker() { fileInput.value?.click() }

function onFileChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  handleFile(file)
}

function handleFile(file) {
  if (!file || busy.value) return
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
    toastFn('请选择 PNG / JPG / WEBP 图片', 'error')
    return
  }
  if (file.size > 6 * 1024 * 1024) {
    toastFn('图片不能超过 6MB', 'error')
    return
  }
  readFileAsDataURL(file).then(dataUrl => {
    image.value = dataUrl
    clearResult()
    run()   // 图片就位后直接开始分析
  }).catch(err => {
    toastFn('读取图片失败: ' + (err?.message || err), 'error')
  })
}

function clearImage() {
  image.value = ''
  clearResult()
}

function onRecentPicked(base64) {
  showPicker.value = false
  mode.value = 'image'
  image.value = base64
  clearResult()
  run()
}

function onDragLeave(e) {
  if (!e.currentTarget?.contains?.(e.relatedTarget)) dragging.value = false
}

function onDrop(e) {
  dragging.value = false
  const file = Array.from(e.dataTransfer?.files || []).find(f => f.type?.startsWith('image/'))
  if (file) {
    // 在文字模式下拖入图片 → 视为想换用图片模式，自动切过去（否则用户会以为拖拽没反应）
    mode.value = 'image'
    handleFile(file)
  } else toastFn('请拖入图片文件', 'warning')
}

// 弹窗打开期间监听粘贴：剪贴板里有图片就直接作为参考图。
// ⚠ 文字模式下**不劫持** —— 那时用户多半是想往输入框里粘文字，抢走粘贴会让他莫名其妙。
function onPaste(e) {
  if (busy.value || mode.value !== 'image') return
  const imgItem = Array.from(e.clipboardData?.items || []).find(it => it.type?.startsWith('image/'))
  if (imgItem) {
    e.preventDefault()
    handleFile(imgItem.getAsFile())
  }
}

/** 唯一执行入口：按当前模式走图片或文字链路 */
async function run() {
  if (busy.value) return
  if (!props.placeId) { toastFn('缺少地点信息，无法修正', 'error'); return }
  if (mode.value === 'image' && !image.value) { toastFn('请先选择一张参考图', 'warning'); return }
  if (mode.value === 'text' && !brief.value.trim()) { toastFn('请先写下你想要的要点', 'warning'); return }

  busy.value = true
  clearResult()
  try {
    const r = await api.refineWorldMapPlaceDraft({
      placeId: props.placeId,
      mode: mode.value,
      image: mode.value === 'image' ? image.value : '',
      brief: mode.value === 'text' ? brief.value.trim() : '',
      hints: hints.value.trim(),
    })
    result.value = {
      kind: String(r?.kind || ''),
      summary: String(r?.summary || ''),
      scenePrompt: String(r?.scenePrompt || ''),
    }
  } catch (err) {
    console.error('refineWorldMapPlaceDraft failed:', err)
    error.value = err?.message || '修正地点失败'
  } finally {
    busy.value = false
  }
}

/**
 * 应用结果。
 * ⚠ 这里**只回传给父级**，不自己落库 —— 与「修正外观」同构：
 *   父级把三个字段填进编辑表单，用户还能手改，点「保存」才真正写库。
 * 三个字段可能只回来一部分（模型没给全时不做猜测性清空）：只回传非空项，
 * 空项交给父级保留原值。
 */
function apply() {
  if (!hasResult.value || busy.value) return
  const patch = {}
  if (result.value.kind.trim()) patch.kind = result.value.kind.trim()
  if (result.value.summary.trim()) patch.summary = result.value.summary.trim()
  if (result.value.scenePrompt.trim()) patch.scenePrompt = result.value.scenePrompt.trim()
  visibleModel.value = false
  emit('applied', patch)
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}
</script>

<style scoped>
/* ⚠ 样式与 AppearanceRefineModal.vue 刻意保持一致（用户要求照那套做）。
   前缀用 pr-（place refine），避免与页面里的 .we-/.wd- 撞名。
   若要改视觉，请两边一起改，否则两个"修正"弹窗会长得不一样。 */
.pr-body { display: flex; flex-direction: column; gap: 14px; }
.pr-mode-tabs { width: 100%; }
.pr-intro { margin: 0; font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
.pr-foot-hint { font-size: 11px; color: var(--text-secondary); }
.pr-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-bright); margin: 2px 0 4px; }
.pr-opt { font-weight: 400; color: var(--text-secondary); font-size: 11px; }
.pr-field { display: flex; flex-direction: column; }

.pr-brief { display: flex; flex-direction: column; gap: 8px; }
.pr-brief-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pr-brief-hint { font-size: 11px; color: var(--text-secondary); }
.pr-brief-count { font-size: 11px; color: var(--text-secondary); opacity: 0.7; font-variant-numeric: tabular-nums; }
.pr-chips { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.pr-chips-label { font-size: 11px; color: var(--text-secondary); }
.pr-chip {
  padding: 3px 10px;
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  background: none;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.pr-chip:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); background: rgba(var(--accent-rgb), 0.06); }
.pr-chip:disabled { opacity: 0.5; cursor: default; }

.pr-dropzone {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  padding: 28px 16px;
  border: 1.5px dashed var(--glass-border);
  border-radius: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: center;
  user-select: none;
  transition: border-color 0.15s, background 0.15s;
}
.pr-dropzone:hover { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.04); }
.pr-dropzone svg { color: var(--accent); }
.pr-dropzone-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.pr-dropzone-sub { font-size: 11px; color: var(--text-secondary); }
.pr-body.is-dragging .pr-dropzone,
.pr-body.is-dragging .pr-preview { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.06); }
.pr-preview {
  display: inline-flex; align-self: center;
  flex-direction: column; align-items: stretch;
  padding: 10px;
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  background: var(--bg-primary);
  transition: border-color 0.15s, background 0.15s;
}
.pr-preview-img {
  display: block;
  max-height: 260px;
  max-width: min(100%, 420px);
  border-radius: 10px;
  object-fit: contain;
}
.pr-preview-actions {
  display: flex; justify-content: center; align-items: center;
  margin-top: 8px; padding-top: 8px;
  border-top: 1px solid var(--border);
}
.pr-analyzing { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
.pr-spinner { width: 14px; height: 14px; border: 2px solid rgba(var(--accent-rgb), 0.2); border-top-color: var(--accent); border-radius: 50%; animation: pr-spin 0.6s linear infinite; }
@keyframes pr-spin { to { transform: rotate(360deg); } }
.pr-result { display: flex; flex-direction: column; gap: 2px; padding-top: 4px; border-top: 1px solid var(--border); }
.pr-result-head { font-size: 12px; font-weight: 600; color: var(--text-bright); margin-bottom: 6px; }
.pr-scene { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.pr-error { font-size: 12px; color: var(--danger); line-height: 1.5; }
.pr-file-input { display: none; }
</style>