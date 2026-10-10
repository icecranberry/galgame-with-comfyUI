<template>
  <!-- ── 修正外观弹窗：上传 / 粘贴 / 拖拽参考图，邻舍分析后重写「## 你的外观」──
       整卡文本由 basePrompt prop 传入（可以是待确认的草稿卡，不要求角色已入库）；
       应用结果通过 @applied 回传重组后的整卡，落库/回填由父级决定。 -->
  <linshe-modal v-model="visibleModel" :title="sceneLabel ? `修正「${sceneLabel === '工装' ? '默认' : sceneLabel}」外观 — ${displayName || ''}` : `修正外观 — ${displayName || ''}`" wide>
    <div class="refine-body" :class="{ 'is-dragging': refineDragging }" @dragover.prevent="refineDragging = true" @dragleave="onRefineDragLeave" @drop.prevent="onRefineDrop">
      <!-- 两种入口：找得到参考图就用图，只想描述就用文字。默认走图片（与旧行为一致） -->
      <LinsheTabs v-model="refineMode" :options="MODE_OPTIONS" size="sm" class="refine-mode-tabs" :disabled="refineAnalyzing" />

      <!-- ── 图片模式 ── -->
      <template v-if="refineMode === 'image'">
        <p class="refine-intro">
          提供一张该角色的参考图，邻舍会观察图片并重写<b v-if="sceneLabel">「{{ sceneLabel === '工装' ? '默认' : sceneLabel }}」</b><template v-else>人格卡里的「## 你的外观」</template>的外观描述，
          生成「名字 + 五官 + 衣着」的生图描述。支持点击上传、Ctrl+V 粘贴、拖拽到窗口<template v-if="characterId">，或从最近图片中挑选并截取</template>。
        </p>

        <!-- 上传 / 预览 -->
        <div
          v-if="!refineImage"
          class="refine-dropzone"
          role="button" tabindex="0"
          @click="openRefineFilePicker"
          @keydown.enter.prevent="openRefineFilePicker"
          @keydown.space.prevent="openRefineFilePicker"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
          </svg>
          <span class="refine-dropzone-title">点击上传或拖拽图片到这里</span>
          <span class="refine-dropzone-sub">PNG / JPG / WEBP，不超过 6MB，也可以直接 Ctrl+V 粘贴</span>
        </div>
        <linshe-button v-if="!refineImage && characterId" variant="secondary" block class="refine-recent-btn" :disabled="refineAnalyzing" @click="openRecentPicker">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
          </svg>
          从最近图片中挑选并截取
        </linshe-button>
        <div v-else-if="refineImage" class="refine-preview">
          <img :src="refineImage" class="refine-preview-img" alt="参考图预览" />
          <div class="refine-preview-actions">
            <linshe-button variant="ghost" size="sm" :disabled="refineAnalyzing" @click="clearRefineImage">移除图片</linshe-button>
          </div>
        </div>
      </template>

      <!-- ── 文字模式 ── -->
      <template v-else>
        <p class="refine-intro">
          写下你想要的服装要点——<b>几个词就够</b>（单品、颜色、材质、配饰、赤足与否…），邻舍会保留你提到的每一项，再把没说到的细节补全成一段完整的
          <b v-if="sceneLabel">「{{ sceneLabel === '工装' ? '默认' : sceneLabel }}」</b><template v-else>外观</template>描述。不用写得工整，想到哪写到哪。
        </p>

        <div class="refine-brief">
          <LinsheInput
            v-model="refineBrief"
            type="textarea"
            :rows="4"
            placeholder="例：米白宽松亚麻长衫，袖口滚细金线云纹，腰间一条红绸软带垂金铃，赤足，狐尾从衣摆后搭开"
            :disabled="refineAnalyzing"
            @keydown.ctrl.enter.prevent="startExpand"
            @keydown.meta.enter.prevent="startExpand"
          />
          <div class="refine-brief-foot">
            <span class="refine-brief-hint">Ctrl + Enter 直接扩写 · 越具体越贴合你的想法</span>
            <span class="refine-brief-count">{{ refineBrief.length }} 字</span>
          </div>
          <!-- 没头绪时点一下就填进输入框，可继续改 -->
          <div class="refine-chips">
            <span class="refine-chips-label">找灵感：</span>
            <button
              v-for="s in BRIEF_SAMPLES"
              :key="s.label"
              type="button"
              class="refine-chip"
              :disabled="refineAnalyzing"
              @click="useSample(s.text)"
            >{{ s.label }}</button>
          </div>
        </div>
      </template>

      <!-- 分析中 -->
      <div v-if="refineAnalyzing" class="refine-analyzing">
        <span class="refine-spinner"></span> {{ refineMode === 'text' ? '邻舍正在扩写…' : '邻舍正在观察图片…' }}
      </div>

      <!-- 结果预览（只读；应用后可在人格卡文本框里继续微调） -->
      <div v-if="refineResult" class="refine-result">
        <label class="fl">重写后的外观（可直接修改）</label>
        <linshe-input v-model="refineResult" type="textarea" :rows="7" class="refine-result-input" />
      </div>

      <div v-if="refineError" class="refine-error">{{ refineError }}</div>

      <input ref="refineFileInput" type="file" accept="image/png,image/jpeg,image/webp" class="refine-file-input" @change="onRefineFileChange" />
    </div>

    <template #footer>
      <span class="outfit-save-hint">{{ applyHint }}</span>
      <div style="flex:1"></div>
      <linshe-button
        variant="secondary"
        :disabled="refineMode === 'text' ? !refineBrief.trim() : !refineImage"
        :loading="refineAnalyzing"
        @click="refineMode === 'text' ? startExpand() : startRefineAnalysis()"
      >
        {{ refineResult ? '重新生成' : (refineMode === 'text' ? '扩写' : '开始分析') }}
      </linshe-button>
      <linshe-button variant="primary" :disabled="!refineResult || refineAnalyzing" @click="applyRefineResult">
        {{ applyText }}
      </linshe-button>
    </template>

  </linshe-modal>

  <!-- ── 从最近图片挑选并截取（完整展示全图，拖拽画选区）── Teleport 到 body 避免被弹窗 transform 困住 fixed 定位 -->
  <Teleport v-if="characterId" to="body">
    <RecentImageCropper
      v-if="showRefinePicker"
      :character-id="characterId"
      @close="showRefinePicker = false"
      @save="onRefineRecentPicked"
    />
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, inject, onUnmounted } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheTabs from './ui/LinsheTabs.vue'
import RecentImageCropper from './RecentImageCropper.vue'

const MODE_OPTIONS = [
  { value: 'image', label: '用参考图' },
  { value: 'text', label: '用文字描述' },
]

/**
 * 文字模式的「找灵感」示例：点一下填进输入框，用户可继续改。
 * 刻意保持**短、口语、要素零散** —— 这正是这个模式要解决的场景（用户懒得写整段描述），
 * 示例若写成完整段落，反而会让人以为"必须写这么长"。
 */
const BRIEF_SAMPLES = [
  { label: '宽松居家', text: '宽松棉麻长衫、素色、赤足、袖子挽起' },
  { label: '贴身睡裙', text: '极薄真丝吊带睡裙、细肩带、蕾丝包边、只到大腿根' },
  { label: '干练工装', text: '收腰短外套、衬衫领、深色长裤、腰带、短靴' },
  { label: '祭典和风', text: '浅色浴衣、腰后大蝴蝶结、木屐、发间一支簪' },
]

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 已入库角色 id（用于「从最近图片中挑选」）；草稿卡场景传 null，隐藏该入口 */
  characterId: { type: [Number, String], default: null },
  /** 角色名（标题 + 分析时的身份上下文） */
  displayName: { type: String, default: '' },
  /** 当前整卡文本（待重写「## 你的外观」的草稿/编辑中人格卡） */
  basePrompt: { type: String, default: '' },
  /** 目标场景名（工装/私服/居家/睡衣）；留空＝旧口径（改人格卡的外观段）。仅用于标题与说明文案 */
  sceneLabel: { type: String, default: '' },
  /** 应用按钮文案 / 底部提示（草稿卡场景父级可改写） */
  applyText: { type: String, default: '应用并保存' },
  applyHint: { type: String, default: '应用到人格卡后会自动保存' },
})

const emit = defineEmits(['update:modelValue', 'applied'])

const toastFn = inject('toast')

const visibleModel = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const refineImage = ref('')          // 参考图 dataURL
const refineMode = ref('image')      // 'image' | 'text'
const refineBrief = ref('')          // 文字模式的用户要点
const refineDragging = ref(false)
const refineAnalyzing = ref(false)
const refineResult = ref('')         // 重写后的外观段正文（可直接编辑）
const refinePromptBefore = ref('')   // 外观段之前的整卡前文（服务端切好，应用时拼接）
const refinePromptAfter = ref('')    // 外观段之后的整卡后文
const refineLegacyBasePrompt = ref('') // 兼容：服务端重组好的整卡 base_prompt（无前后文时退回整卡回填）
const refineError = ref('')
const refineFileInput = ref(null)
// 最近图片挑选（RecentImageCropper 内部负责取图与拖拽截取）
const showRefinePicker = ref(false)

function resetRefineState() {
  refineImage.value = ''
  refineMode.value = 'image'
  refineBrief.value = ''
  refineDragging.value = false
  refineAnalyzing.value = false
  refineResult.value = ''
  refinePromptBefore.value = ''
  refinePromptAfter.value = ''
  refineLegacyBasePrompt.value = ''
  refineError.value = ''
  showRefinePicker.value = false
}

/** 清掉上一轮结果（切模式 / 换输入时调用，避免旧结果被误应用） */
function clearResult() {
  refineResult.value = ''
  refinePromptBefore.value = ''
  refinePromptAfter.value = ''
  refineLegacyBasePrompt.value = ''
  refineError.value = ''
}

/** 点示例：填入输入框并聚焦（不直接提交，让用户先改） */
function useSample(text) {
  if (refineAnalyzing.value) return
  refineBrief.value = text
}

/** 服务端返回统一收口（图片模式与文字模式共用） */
function absorbResult(res) {
  refineResult.value = res.appearance || ''
  if (res.prompt_before != null || res.prompt_after != null) {
    refinePromptBefore.value = res.prompt_before || ''
    refinePromptAfter.value = res.prompt_after || ''
  } else {
    // 后端没有前后文字段：退回整卡回填（此模式下结果框的编辑不会参与重组）
    refineLegacyBasePrompt.value = res.base_prompt || ''
  }
}

/** 文字模式：按要点扩写 */
async function startExpand() {
  const brief = refineBrief.value.trim()
  if (!brief || refineAnalyzing.value) {
    if (!brief) toastFn('请先写下你想要的服装要点', 'warning')
    return
  }
  if (!props.basePrompt.trim()) {
    toastFn('缺少人格卡内容，无法定位外观段落', 'error')
    return
  }
  refineAnalyzing.value = true
  clearResult()
  try {
    absorbResult(await api.expandAppearanceDraft({
      brief,
      basePrompt: props.basePrompt,
      displayName: props.displayName,
      sceneLabel: props.sceneLabel,
    }))
  } catch (err) {
    console.error('startExpand failed:', err)
    refineError.value = err?.message || '外观扩写失败'
  } finally {
    refineAnalyzing.value = false
  }
}

watch(() => props.modelValue, (open) => {
  if (open) resetRefineState()
  document.removeEventListener('paste', onRefinePaste)
  if (open) document.addEventListener('paste', onRefinePaste)
})
// 切换模式时丢掉上一轮结果：否则「图片模式的结果」会被当成「文字模式的结果」直接应用
watch(refineMode, () => { if (!refineAnalyzing.value) clearResult() })
onUnmounted(() => document.removeEventListener('paste', onRefinePaste))

function openRefineFilePicker() {
  refineFileInput.value?.click()
}

function onRefineFileChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  handleRefineFile(file)
}

function handleRefineFile(file) {
  if (!file || refineAnalyzing.value) return
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
    toastFn('请选择 PNG / JPG / WEBP 图片', 'error')
    return
  }
  if (file.size > 6 * 1024 * 1024) {
    toastFn('图片不能超过 6MB', 'error')
    return
  }
  readFileAsDataURL(file).then(dataUrl => {
    refineImage.value = dataUrl
    clearResult()
    // 图片就位后直接开始分析
    startRefineAnalysis()
  }).catch(err => {
    toastFn('读取图片失败: ' + (err?.message || err), 'error')
  })
}

function clearRefineImage() {
  refineImage.value = ''
  clearResult()
}

// ── 从最近图片挑选并截取 ──
function openRecentPicker() {
  if (!props.characterId || refineAnalyzing.value) return
  showRefinePicker.value = true
}

// 截取结果（dataURL）直接作为参考图，走与上传相同的链路；图片就位后直接开始分析
function onRefineRecentPicked(base64) {
  showRefinePicker.value = false
  refineMode.value = 'image'
  refineImage.value = base64
  clearResult()
  startRefineAnalysis()
}

function onRefineDragLeave(e) {
  if (!e.currentTarget?.contains?.(e.relatedTarget)) refineDragging.value = false
}

function onRefineDrop(e) {
  refineDragging.value = false
  const file = Array.from(e.dataTransfer?.files || []).find(f => f.type?.startsWith('image/'))
  if (file) {
    // 在文字模式下拖入图片 → 视为想换用图片模式，自动切过去（否则用户会以为拖拽没反应）
    refineMode.value = 'image'
    handleRefineFile(file)
  } else toastFn('请拖入图片文件', 'warning')
}

// 弹窗打开期间监听粘贴：剪贴板里有图片就直接作为参考图。
// ⚠ 文字模式下**不劫持** —— 那时用户多半是想往输入框里粘文字，
//   抢走粘贴会让他莫名其妙。文字模式想用图，切回「用参考图」即可（也支持直接拖图自动切）。
function onRefinePaste(e) {
  if (refineAnalyzing.value || refineMode.value !== 'image') return
  const imgItem = Array.from(e.clipboardData?.items || []).find(it => it.type?.startsWith('image/'))
  if (imgItem) {
    e.preventDefault()
    handleRefineFile(imgItem.getAsFile())
  }
}

async function startRefineAnalysis() {
  if (!props.basePrompt.trim() || !refineImage.value || refineAnalyzing.value) return
  refineAnalyzing.value = true
  clearResult()
  try {
    const res = await api.refineAppearanceDraft({
      image: refineImage.value,
      basePrompt: props.basePrompt,
      displayName: props.displayName,
      sceneLabel: props.sceneLabel,
    })
    absorbResult(res)
  } catch (err) {
    console.error('startRefineAnalysis failed:', err)
    refineError.value = err?.message || '修正外观失败'
  } finally {
    refineAnalyzing.value = false
  }
}

function applyRefineResult() {
  const body = refineResult.value.trim()
  if (!body || refineAnalyzing.value) {
    if (!body) toastFn('外观内容为空，请先分析或填写', 'warning')
    return
  }
  // 用户可能编辑过结果：有前后文时用编辑后的正文重组整卡；否则退回服务端重组好的整卡
  const basePrompt = refineLegacyBasePrompt.value
    ? refineLegacyBasePrompt.value
    : `${refinePromptBefore.value}## 你的外观\n${body}${refinePromptAfter.value}`
  visibleModel.value = false
  emit('applied', { basePrompt })
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
.refine-intro { margin: 0 0 12px; font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
.outfit-save-hint { font-size: 11px; color: var(--text-secondary); }
.fl { font-size: 13px; font-weight: 600; color: var(--text-bright); display: block; margin-bottom: 4px; }

/* ═══ 修正外观 ═══ */
.refine-body { display: flex; flex-direction: column; gap: 14px; }
/* 模式切换：占满整行，让「用参考图 / 用文字描述」两条路一眼可见 */
.refine-mode-tabs { width: 100%; }

/* ── 文字模式 ── */
.refine-brief { display: flex; flex-direction: column; gap: 8px; }
.refine-brief-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.refine-brief-hint { font-size: 11px; color: var(--text-secondary); }
.refine-brief-count { font-size: 11px; color: var(--text-secondary); opacity: 0.7; font-variant-numeric: tabular-nums; }
.refine-chips { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.refine-chips-label { font-size: 11px; color: var(--text-secondary); }
.refine-chip {
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
.refine-chip:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); background: rgba(var(--accent-rgb), 0.06); }
.refine-chip:disabled { opacity: 0.5; cursor: default; }

.refine-dropzone {
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
.refine-dropzone:hover { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.04); }
.refine-dropzone svg { color: var(--accent); }
.refine-dropzone-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.refine-dropzone-sub { font-size: 11px; color: var(--text-secondary); }
/* 拖拽悬停亮显：dragover/drop 挂在整个弹窗正文上，拖到哪都能松手替换 */
.refine-body.is-dragging .refine-dropzone,
.refine-body.is-dragging .refine-preview { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.06); }
/* 最近图片入口：整行次要按钮，跟上传区并列为两大入口 */
.refine-recent-btn { margin-top: 0; }
/* 已选参考图：大图居中，图片下方一条横放的操作栏 */
.refine-preview {
  display: inline-flex; align-self: center;
  flex-direction: column;
  align-items: stretch;
  padding: 10px;
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  background: var(--bg-primary);
  transition: border-color 0.15s, background 0.15s;
}
.refine-preview-img {
  display: block;
  max-height: 260px;
  max-width: min(100%, 420px);
  border-radius: 10px;
  object-fit: contain;
}
.refine-preview-actions {
  display: flex; justify-content: center; align-items: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.refine-analyzing { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
.refine-spinner { width: 14px; height: 14px; border: 2px solid rgba(var(--accent-rgb), 0.2); border-top-color: var(--accent); border-radius: 50%; animation: refine-spin 0.6s linear infinite; }
@keyframes refine-spin { to { transform: rotate(360deg); } }
.refine-result .fl { margin-bottom: 6px; }
.refine-result-input { width: 100%; }
.refine-error { font-size: 12px; color: var(--danger); line-height: 1.5; }
.refine-file-input { display: none; }
</style>
