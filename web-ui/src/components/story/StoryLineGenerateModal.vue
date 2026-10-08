<template>
  <!-- ── AI 生成事件线（2026-10-07 用户要求「需要一个 AI 生成按钮」）──
       ★ 形式照 `worldmap/PlaceRefineModal.vue`（用户给了样式参考：「用文字描述」那一版）：
         要点输入 + 生成按钮 + **结果可编辑** + 「应用到编辑表单」。
       ★ 同样**只出草稿、不落库** —— 应用后填进编辑表单，用户仍可改，
         点「保存」才真正写库（与「修正地点」「修正外观」同一范式）。
       ⚠ 已有角色/地点会作为上下文一起发给后端（用户先选好人再点生成，效果最好）。 -->
  <linshe-modal v-model="visibleModel" title="AI 生成剧情线" wide>
    <div class="gl-body">
      <p class="gl-intro">
        写下这条线大概想讲什么——<b>几个词就够</b>（谁、因为什么、起了什么冲突），
        邻舍会补出一条<b>起线阶段</b>的草稿。不用写得工整。
      </p>

      <div class="gl-brief">
        <LinsheInput
          v-model="brief"
          type="textarea"
          :rows="4"
          placeholder="例：绯英接了编辑部的连环画稿约，但截稿日撞上了她另一份私活，她得决定推掉哪个"
          :disabled="busy"
          @keydown.ctrl.enter.prevent="run"
          @keydown.meta.enter.prevent="run"
        />
        <div class="gl-brief-foot">
          <span class="gl-hint">Ctrl + Enter 直接生成 · 越具体越贴合你的想法</span>
          <span class="gl-count">{{ brief.length }} 字</span>
        </div>
        <div class="gl-chips">
          <span class="gl-chips-label">找灵感：</span>
          <button
            v-for="s in SAMPLES" :key="s.label" type="button"
            class="gl-chip" :disabled="busy" @click="brief = s.text"
          >{{ s.label }}</button>
        </div>
      </div>

      <!-- 已选的角色/地点作为上下文（点生成时会一起发给后端） -->
      <div v-if="contextText" class="gl-context">
        <span class="gl-context-label">已带上：</span>
        <span class="gl-context-text">{{ contextText }}</span>
      </div>

      <div class="gl-field">
        <label class="gl-label">补充要求<span class="gl-opt">（可选）</span></label>
        <LinsheInput v-model="hints" size="sm" placeholder="如：别太严肃，写成一场闹剧" :disabled="busy" />
      </div>

      <div v-if="busy" class="gl-analyzing">
        <span class="gl-spinner"></span> 邻舍正在构思这条线…
      </div>

      <!-- 结果：字段都可编辑，应用后只回填编辑表单，不落库 -->
      <div v-if="hasResult" class="gl-result">
        <div class="gl-result-head">生成结果（可直接修改）</div>
        <label class="gl-label">线名</label>
        <LinsheInput v-model="result.name" size="sm" placeholder="这条线的名字" />
        <label class="gl-label">内容描述</label>
        <LinsheInput v-model="result.desc" type="textarea" :rows="3" />
        <label class="gl-label">下一步<span class="gl-opt">（给下轮生成的推进锚点）</span></label>
        <LinsheInput v-model="result.nextText" type="textarea" :rows="2" />
        <label class="gl-label">时间<span class="gl-opt">（自由文本）</span></label>
        <LinsheInput v-model="result.whenText" size="sm" placeholder="如：第 3 天" />
      </div>

      <div v-if="error" class="gl-error">{{ error }}</div>
    </div>

    <template #footer>
      <span class="gl-foot-hint">应用后填进编辑表单，仍需点「保存」才落库</span>
      <div style="flex:1"></div>
      <linshe-button
        variant="secondary"
        :disabled="!brief.trim()"
        :loading="busy"
        @click="run"
      >{{ hasResult ? '重新生成' : '生成' }}</linshe-button>
      <linshe-button variant="primary" :disabled="!hasResult || busy" @click="apply">
        应用到编辑表单
      </linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import * as api from '../../api/index.js'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import LinsheModal from '../ui/LinsheModal.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 当前离线表单里已选的参与角色 id（作为上下文） */
  participantIds: { type: Array, default: () => [] },
  /** 已选地点（作为上下文） */
  places: { type: Array, default: () => [] },
  /** 角色 id → 名字，用于把上下文显示成人看得懂的样子 */
  nameOfId: { type: Function, default: null },
})

const emit = defineEmits(['update:modelValue', 'applied'])

/** 「找灵感」示例：短、口语、要素零散 —— 与「修正地点」的 BRIEF_SAMPLES 同一取向 */
const SAMPLES = [
  { label: '接了个活', text: '接了个棘手的活，交期很紧，但她其实还想接另一单' },
  { label: '有人找上门', text: '一个以前得罪过的人突然找上门，开口就要她帮个忙' },
  { label: '撞见一件事', text: '她撞见了一件不该看见的事，纠结要不要说出去' },
  { label: '关系生变', text: '和某个人原本相处得不错，最近对方的举动让她起了疑心' },
]

const visibleModel = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const brief = ref('')
const hints = ref('')
const busy = ref(false)
const error = ref('')
const result = ref({ name: '', desc: '', nextText: '', whenText: '' })

const hasResult = computed(() =>
  !!(result.value.name || result.value.desc || result.value.nextText))

const contextText = computed(() => {
  const parts = []
  if (props.participantIds.length) {
    const names = props.participantIds.map(id => props.nameOfId?.(id) || `#${id}`)
    parts.push(`角色：${names.join('、')}`)
  }
  if (props.places.length) parts.push(`地点：${props.places.join('、')}`)
  return parts.join('；')
})

watch(() => props.modelValue, open => {
  if (open) {
    brief.value = ''
    hints.value = ''
    busy.value = false
    error.value = ''
    result.value = { name: '', desc: '', nextText: '', whenText: '' }
  }
})

async function run() {
  if (busy.value) return
  if (!brief.value.trim()) return
  busy.value = true
  error.value = ''
  result.value = { name: '', desc: '', nextText: '', whenText: '' }
  try {
    const r = await api.generateStoryLine({
      brief: brief.value.trim(),
      hints: hints.value.trim(),
      participantIds: props.participantIds,
      places: props.places,
    })
    const d = r?.draft || {}
    result.value = {
      name: String(d.name || ''),
      desc: String(d.desc || ''),
      nextText: String(d.nextText || ''),
      whenText: String(d.whenText || ''),
    }
  } catch (err) {
    error.value = err?.message || '生成失败'
  } finally {
    busy.value = false
  }
}

/**
 * 应用结果 —— **只回传，不落库**（与「修正地点」同构）。
 * ⚠ 只回传**非空**字段：模型没给全时不做猜测性清空，空项交给父级保留原值。
 */
function apply() {
  if (!hasResult.value || busy.value) return
  const patch = {}
  if (result.value.name.trim()) patch.name = result.value.name.trim()
  if (result.value.desc.trim()) patch.desc = result.value.desc.trim()
  if (result.value.nextText.trim()) patch.nextText = result.value.nextText.trim()
  if (result.value.whenText.trim()) patch.whenText = result.value.whenText.trim()
  visibleModel.value = false
  emit('applied', patch)
}
</script>

<style scoped>
/* ⚠ 与 PlaceRefineModal / AppearanceRefineModal 保持一致的克制版式（用户给过样式参考） */
.gl-body { display: flex; flex-direction: column; gap: 14px; }
.gl-intro { margin: 0; font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
.gl-hint { font-size: 11px; color: var(--text-secondary); }
.gl-count { font-size: 11px; color: var(--text-secondary); opacity: 0.7; font-variant-numeric: tabular-nums; }
.gl-brief { display: flex; flex-direction: column; gap: 8px; }
.gl-brief-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.gl-chips { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.gl-chips-label { font-size: 11px; color: var(--text-secondary); }
.gl-chip {
  padding: 3px 10px; border: 1px solid var(--glass-border); border-radius: 999px;
  background: none; color: var(--text-secondary); font-family: inherit; font-size: 11.5px;
  cursor: pointer; transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.gl-chip:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); background: rgba(var(--accent-rgb), 0.06); }
.gl-chip:disabled { opacity: 0.5; cursor: default; }

.gl-context {
  padding: 8px 10px; border-radius: 8px;
  background: rgba(var(--accent-rgb), 0.06);
  font-size: 12px; line-height: 1.6;
}
.gl-context-label { color: var(--text-secondary); }
.gl-context-text { color: var(--text-bright); }

.gl-field { display: flex; flex-direction: column; }
.gl-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-bright); margin: 2px 0 4px; }
.gl-opt { font-weight: 400; color: var(--text-secondary); font-size: 11px; }

.gl-analyzing { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
.gl-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(var(--accent-rgb), 0.2); border-top-color: var(--accent);
  animation: gl-spin 0.6s linear infinite;
}
@keyframes gl-spin { to { transform: rotate(360deg); } }

.gl-result { display: flex; flex-direction: column; gap: 2px; padding-top: 8px; border-top: 1px solid var(--border); }
.gl-result-head { font-size: 12px; font-weight: 600; color: var(--text-bright); margin-bottom: 6px; }
.gl-error { font-size: 12px; color: var(--danger); line-height: 1.5; }
.gl-foot-hint { font-size: 11px; color: var(--text-secondary); }
</style>