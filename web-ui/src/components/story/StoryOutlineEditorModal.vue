<template>
  <!-- ── 剧情大纲编辑器（2026-10-07 用户口径）────────────────────
       ★ 用户原话：「大纲生成我不是很满意，我觉得你的生成功能模块应该类似于
         线列表的新建事件线」—— 也就是要**字段化表单**，而不是只读草稿预览。
         参照 `StoryView.vue` 的「新建事件线」弹窗形态：
           顶部「✨ 让 AI 按要点生成」入口（先选好角色/地点，生成时一并带上）
           → 逐字段可编辑的表单（时间/标题/类型/所属线/结果/Scene/Subtext/Think）
           → 节点可增删、可整块重写
           → 确认后点「保存」才落库。

       ★★ 两条不可回退：
         ① **只出草稿不落库** —— 组件自身不写库，保存时机与状态归 StoryView
            （与 StoryOutlineSceneModal 同构：弹窗不碰 API）。
         ② **未改动的节点必须原样保留原文块** —— 每项都带 `raw`（原文块），
            只有用户真的动过（`dirty`）才改成 `value` 交给服务端重新序列化，
            否则一律回传 `raw`。这样"没动过的节点"落库后逐字节一致。 -->
  <linshe-modal v-model="open" :title="editorTitle" wide>
    <div class="oe-body">
      <!-- ── AI 生成入口（与「新建事件线」的 sv-gen-bar 同形）── -->
      <div class="oe-gen-bar">
        <linshe-button variant="secondary" size="sm" :disabled="busy" @click="genOpen = !genOpen">
          ✨ 让 AI 按要点生成
        </linshe-button>
        <span class="oe-gen-hint">先选好角色/地点，生成时会一并带上</span>
      </div>

      <div v-if="genOpen" class="oe-gen">
        <div class="oe-field">
          <label>走向要点<span class="oe-opt">（可选；留空则完全按已有剧情材料推演）</span></label>
          <LinsheInput
            v-model="direction" type="textarea" :rows="3"
            placeholder="如：让这条线在两周内收束，中间加一次意外；围绕绯英的稿约冲突展开"
            :disabled="busy"
          />
        </div>
        <div class="oe-field">
          <label>涉及角色<span class="oe-opt">（输入名字检索，可多选）</span></label>
          <MultiPickSelect
            v-model="participantValues"
            :candidates="participantCandidates"
            placeholder="输入角色名检索…"
          />
        </div>
        <div class="oe-field">
          <label>涉及地点<span class="oe-opt">（输入检索，可多选；未收录也可直接输入）</span></label>
          <MultiPickSelect
            v-model="placeValues"
            :candidates="placeCandidates"
            placeholder="输入地名检索…"
          />
        </div>
      </div>

      <div v-if="error" class="oe-error">{{ error }}</div>

      <!-- ── 字段化节点表单 ── -->
      <div class="oe-nodes-head">
        <span class="oe-nodes-count">共 {{ nodes.length }} 个节点</span>
        <span class="oe-flex"></span>
        <linshe-button variant="ghost" size="sm" :disabled="busy" @click="addNode">+ 加一个节点</linshe-button>
      </div>

      <p v-if="!nodes.length" class="oe-empty">
        还没有节点。点上方「✨ 让 AI 按要点生成」让邻舍铺一版草稿，或点「+ 加一个节点」自己写。
      </p>

      <ol v-else class="oe-nodes">
        <li v-for="(n, i) in nodes" :key="n.uid" class="oe-node" :class="{ 'is-dirty': n.dirty }">
          <div class="oe-node-head">
            <span class="oe-node-idx">{{ i + 1 }}</span>
            <span v-if="n.dirty" class="oe-dirty" title="这个节点有未保存的修改">已改</span>
            <span class="oe-flex"></span>
            <linshe-button variant="ghost" size="sm" :disabled="busy" @click="moveNode(i, -1)">↑</linshe-button>
            <linshe-button variant="ghost" size="sm" :disabled="busy" @click="moveNode(i, 1)">↓</linshe-button>
            <linshe-button variant="ghost" size="sm" :disabled="busy" @click="openRefine(i)">✨ 重写</linshe-button>
            <linshe-button variant="ghost" size="sm" tone="danger" :disabled="busy" @click="removeNode(i)">删除</linshe-button>
          </div>

          <div class="oe-row3">
            <div class="oe-field">
              <label>推演时间</label>
              <LinsheInput v-model="n.time" size="sm" placeholder="如：第 3 天傍晚" @update:model-value="markDirty(n)" />
            </div>
            <div class="oe-field">
              <label>类型</label>
              <LinsheInput v-model="n.type" size="sm" placeholder="如：冲突 / 转折" @update:model-value="markDirty(n)" />
            </div>
            <div class="oe-field">
              <label>所属故事线<span class="oe-opt">（可空）</span></label>
              <LinsheSelect
                v-model="n.line" size="sm" allow-free-input
                :options="lineNameOptions" placeholder="如：绯英的连环画稿约"
                @update:model-value="markDirty(n)"
              />
            </div>
          </div>

          <div class="oe-field">
            <label>标题</label>
            <LinsheInput v-model="n.title" size="sm" placeholder="凝练点题的小标题" @update:model-value="markDirty(n)" />
          </div>
          <div class="oe-field">
            <label>结果</label>
            <LinsheInput v-model="n.outcome" size="sm" placeholder="这一阶段收在什么状态" @update:model-value="markDirty(n)" />
          </div>
          <div class="oe-field">
            <label>Scene<span class="oe-opt">（这一阶段发生什么）</span></label>
            <LinsheInput
              v-model="n.scene" type="textarea" :rows="3"
              placeholder="着眼阶段走向、整体推进到哪里，不写单个镜头"
              @update:model-value="markDirty(n)"
            />
          </div>
          <div class="oe-field">
            <label>Subtext<span class="oe-opt">（文学化题记，不复述 Scene）</span></label>
            <LinsheInput v-model="n.subtext" type="textarea" :rows="2" @update:model-value="markDirty(n)" />
          </div>
          <div class="oe-field">
            <label>Think<span class="oe-opt">（节点为何成立、承担的叙事作用）</span></label>
            <LinsheInput v-model="n.think" type="textarea" :rows="2" @update:model-value="markDirty(n)" />
          </div>
        </li>
      </ol>

      <p class="oe-note">
        ⚠ 节点要素（八项）齐全才会被识别为有效节点并参与注入；缺项不会丢内容，但该节点暂不计入序列。
      </p>
    </div>

    <template #footer>
      <span class="oe-foot-hint">确认后点「保存」才会落库</span>
      <div style="flex:1"></div>
      <linshe-button variant="secondary" :loading="busy" :disabled="!genOpen && !nodes.length" @click="runGenerate">
        {{ nodes.length ? '重新生成' : '生成' }}
      </linshe-button>
      <!-- 与「新建事件线」同形：取消 / 保存。取消**不落库**（未保存的编辑直接丢弃）。 -->
      <linshe-button variant="ghost" :disabled="busy" @click="open = false">取消</linshe-button>
      <linshe-button variant="primary" :disabled="busy || !nodes.length" @click="submit">保存</linshe-button>
    </template>
  </linshe-modal>

  <!-- 重写单个节点：带一句要求（不落库，只回填该节点字段） -->
  <linshe-modal v-model="refineOpen" title="重写这个节点" size="md">
    <div class="oe-refine">
      <div v-if="refineTarget" class="oe-refine-node">
        <span class="oe-node-idx">{{ refineIndex + 1 }}</span>
        <span class="oe-refine-title">{{ refineTarget.title || '（未命名）' }}</span>
      </div>
      <p class="oe-refine-intro">
        邻舍会参考<strong>相邻节点</strong>与已有剧情材料重写这一节点，其余节点不受影响。
      </p>
      <div class="oe-field">
        <label>这一节点要怎样<span class="oe-opt">（可选）</span></label>
        <LinsheInput
          v-model="refineBrief" type="textarea" :rows="3"
          placeholder="如：把冲突改成误会而不是硬碰，结尾留个台阶"
          :disabled="refineBusy"
          @keydown.ctrl.enter.prevent="runRefine"
          @keydown.meta.enter.prevent="runRefine"
        />
      </div>
      <div class="oe-refine-ctx">
        <div class="oe-field">
          <label>涉及角色<span class="oe-opt">（可多选）</span></label>
          <MultiPickSelect v-model="refineParticipants" :candidates="participantCandidates" placeholder="输入角色名检索…" />
        </div>
        <div class="oe-field">
          <label>涉及地点<span class="oe-opt">（可多选）</span></label>
          <MultiPickSelect v-model="refinePlaces" :candidates="placeCandidates" placeholder="输入地名检索…" />
        </div>
      </div>
      <p v-if="refineError" class="oe-error">{{ refineError }}</p>
    </div>
    <template #footer>
      <linshe-button variant="ghost" :disabled="refineBusy" @click="refineOpen = false">取消</linshe-button>
      <linshe-button variant="primary" :loading="refineBusy" @click="runRefine">重写</linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import * as api from '../../api/index.js'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import LinsheModal from '../ui/LinsheModal.vue'
import LinsheSelect from '../ui/LinsheSelect.vue'
import MultiPickSelect from '../ui/MultiPickSelect.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 角色候选（已排除归档，来自 /story/options 唯一真源） */
  participantOptions: { type: Array, default: () => [] },
  /** 地点候选（来自世界地图唯一真源） */
  placeOptions: { type: Array, default: () => [] },
  /** 已有线名（「所属故事线」的联想项，允许自由输入） */
  lineNames: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'saved'])

const open = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

/** 每个节点的字段构成 —— 与 `parseCompleteOutline` 的八项一一对应 */
const BEAT_FIELDS = ['time', 'title', 'type', 'line', 'outcome', 'scene', 'subtext', 'think']

const direction = ref('')
const participantValues = ref([])
const placeValues = ref([])
const genOpen = ref(false)
const busy = ref(false)
const error = ref('')
/** 包装（原样拼回）：新建的草稿由服务端补标准包装 */
const prefix = ref('')
const suffix = ref('')
/** 块间原始分隔符（原样回传，未改动时才可能逐字节一致） */
const separator = ref('\n\n')

/** 编辑器节点：@uid 仅用于 v-for key；@raw 原文块（未改动时原样回传）；@dirty 是否被改过 */
const nodes = ref([])
let uidSeq = 0

const refineOpen = ref(false)
const refineIndex = ref(-1)
const refineTarget = ref(null)
const refineBrief = ref('')
const refineParticipants = ref([])
const refinePlaces = ref([])
const refineBusy = ref(false)
const refineError = ref('')

const editorTitle = computed(() => (nodes.value.length ? '编辑剧情大纲' : '生成剧情大纲'))

const participantCandidates = computed(() => props.participantOptions.map(p => ({
  value: String(p.id), label: p.name, hint: '',
})))

const placeCandidates = computed(() => props.placeOptions.map(p => ({
  value: p.name, label: p.name, hint: [p.region, p.area].filter(Boolean).join(' · '),
})))

const lineNameOptions = computed(() => [
  { label: '（无）', value: '' },
  ...props.lineNames.filter(Boolean).map(n => ({ label: n, value: n })),
])

watch(() => props.modelValue, async v => {
  if (!v) return
  direction.value = ''
  participantValues.value = []
  placeValues.value = []
  genOpen.value = false
  busy.value = false
  error.value = ''
  prefix.value = ''
  suffix.value = ''
  separator.value = '\n\n'
  nodes.value = []
  await loadEditor()
})

/**
 * 拉取「字段化编辑器」载荷。
 *
 * ★ 必须带 `raw`（原文块）—— 只有让未改动节点走"原样回传"，
 *   落库后它们才与改动前逐字节一致（模型多给的字段不会被吃掉）。
 */
async function loadEditor() {
  try {
    const r = await api.getStoryOutlineEditor()
    const ed = r?.editor
    if (!ed || !Array.isArray(ed.beats)) return
    prefix.value = String(ed.prefix || '')
    suffix.value = String(ed.suffix || '')
    separator.value = String(ed.separator || '\n\n')
    const blocks = Array.isArray(ed.blocks) ? ed.blocks : []
    nodes.value = ed.beats.map((b, i) => toNode(b, blocks[i] || ''))
  } catch (err) {
    error.value = err?.message || '读取大纲失败'
  }
}

function toNode(beat = {}, raw = '') {
  const n = { uid: ++uidSeq, raw: String(raw || ''), dirty: false }
  for (const f of BEAT_FIELDS) n[f] = String(beat?.[f] ?? '')
  return n
}

/** 用户动了任一字段 → 标脏（该节点改走序列化，不再回传原文块） */
function markDirty(n) { if (n) n.dirty = true }

function addNode() {
  nodes.value.push(toNode({}, ''))
}

function removeNode(i) {
  nodes.value.splice(i, 1)
}

function moveNode(i, delta) {
  const j = i + delta
  if (j < 0 || j >= nodes.value.length) return
  const [n] = nodes.value.splice(i, 1)
  nodes.value.splice(j, 0, n)
}

/** 生成草稿：**整体替换**编辑器内容（这是"重新生成"的语义，用户点之前已看到按钮文案） */
async function runGenerate() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const r = await api.generateStoryOutline({
      direction: direction.value.trim(),
      participantIds: participantValues.value.map(Number).filter(Number.isFinite),
      places: placeValues.value.map(s => String(s).trim()).filter(Boolean),
    })
    const draft = r?.draft
    if (!draft?.beats?.length) {
      error.value = '模型没给出可用节点，请补一句走向要点或先积累一些剧情'
      return
    }
    // 全新草稿：由服务端补标准包装（composeOutlineRaw 会处理空 prefix/suffix）
    prefix.value = ''
    suffix.value = ''
    nodes.value = draft.beats.map(b => toNode(b, ''))
    genOpen.value = false
  } catch (err) {
    error.value = err?.message || '生成失败'
  } finally {
    busy.value = false
  }
}

function openRefine(i) {
  refineIndex.value = i
  refineTarget.value = nodes.value[i] || null
  refineBrief.value = ''
  refineParticipants.value = []
  refinePlaces.value = []
  refineError.value = ''
  refineBusy.value = false
  refineOpen.value = true
}

/**
 * 重写单个节点 —— **只回填该节点的字段**，不动其他节点、不动包装。
 * ⚠ 从精简字段起手：模型只被要求输出一个节点。
 */
async function runRefine() {
  if (refineBusy.value) return
  const i = refineIndex.value
  if (i < 0 || i >= nodes.value.length) return
  refineBusy.value = true
  refineError.value = ''
  try {
    const r = await api.refineStoryOutlineBeat({
      index: i,
      brief: refineBrief.value.trim(),
      participantIds: refineParticipants.value.map(Number).filter(Number.isFinite),
      places: refinePlaces.value.map(s => String(s).trim()).filter(Boolean),
    })
    const beat = r?.draft?.beat
    if (!beat) { refineError.value = '模型没能重写这个节点，请补一句要求或直接手改'; return }
    const n = nodes.value[i]
    for (const f of BEAT_FIELDS) n[f] = String(beat?.[f] ?? '')
    n.dirty = true
    refineOpen.value = false
  } catch (err) {
    refineError.value = err?.message || '重写失败'
  } finally {
    refineBusy.value = false
  }
}

/**
 * 提交 —— 把「哪些节点改成了什么」交给服务端序列化。
 *
 * ★★ 未改动的节点一律回传 `raw`（原文块），**不重新序列化** ——
 *   这是"保留未知字段与原始包装"的落点。改动过（`dirty`）的才给 `value`。
 * ★ 校验交给服务端（`saveOutlineFromEditor` → `saveOutline`）：一个有效节点都没有就抛错，
 *   不会静默把旧大纲清空（红线 0）。
 */
function submit() {
  if (busy.value || !nodes.value.length) return
  const items = nodes.value.map(n => {
    if (n.dirty || !n.raw) {
      const value = {}
      for (const f of BEAT_FIELDS) value[f] = String(n?.[f] ?? '').replace(/\s+$/, '')
      return { value }
    }
    return { raw: n.raw }
  })
  emit('saved', { prefix: prefix.value, suffix: suffix.value, separator: separator.value, items })
}
</script>

<style scoped>
/* ⚠ 与 StoryLineGenerateModal / StoryOutlineSceneModal 同一克制版式，不引入新视觉语言 */
.oe-body { display: flex; flex-direction: column; gap: 13px; }
.oe-flex { flex: 1; }

.oe-gen-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: var(--radius-md);
  background: rgba(var(--accent-rgb), 0.06);
}
.oe-gen-hint { font-size: var(--fs-xs); color: var(--text-secondary); }

.oe-gen {
  display: flex; flex-direction: column; gap: 12px;
  padding: 12px; border-radius: var(--radius-md);
  border: 1px dashed var(--glass-border);
  background: var(--bg-tertiary);
}

.oe-nodes-head { display: flex; align-items: center; gap: 8px; }
.oe-nodes-count { font-size: var(--fs-sm); font-weight: 600; color: var(--text-bright); }
.oe-empty { margin: 0; padding: 20px 0; text-align: center; font-size: var(--fs-sm); color: var(--text-secondary); }

.oe-nodes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.oe-node {
  display: flex; flex-direction: column; gap: 9px;
  padding: 12px; border-radius: var(--radius-lg);
  border: var(--border-strong); background: var(--glass-bg);
}
.oe-node.is-dirty { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.10); }
.oe-node-head { display: flex; align-items: center; gap: 6px; }
.oe-node-idx {
  min-width: 20px; height: 20px; border-radius: 999px; display: inline-flex;
  align-items: center; justify-content: center;
  background: var(--bg-tertiary); color: var(--text-secondary); font-size: 11px; font-weight: 600;
}
.oe-dirty { padding: 1px 7px; border-radius: 999px; font-size: 10px; background: var(--accent-solid); color: #fff; }

.oe-row3 { display: grid; grid-template-columns: 1fr 1fr 1.3fr; gap: 10px; }
.oe-field { display: flex; flex-direction: column; gap: 5px; }
.oe-field label { font-size: var(--fs-xs); font-weight: 600; color: var(--text-secondary); }
.oe-opt { font-weight: 400; }

.oe-note { margin: 0; font-size: var(--fs-xs); line-height: 1.7; color: var(--text-secondary); }
.oe-error { margin: 0; font-size: var(--fs-sm); color: var(--danger); line-height: 1.5; }
.oe-foot-hint { font-size: var(--fs-xs); color: var(--text-secondary); }

.oe-refine { display: flex; flex-direction: column; gap: 12px; }
.oe-refine-node {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: 8px;
  background: rgba(var(--accent-rgb), 0.06);
}
.oe-refine-title { font-size: var(--fs-sm); font-weight: 600; color: var(--text-bright); }
.oe-refine-intro { margin: 0; font-size: var(--fs-xs); line-height: 1.7; color: var(--text-secondary); }
.oe-refine-ctx { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
</style>