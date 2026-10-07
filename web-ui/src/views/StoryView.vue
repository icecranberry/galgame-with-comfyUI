<template>
  <!-- 「故事」页（T2，2026-10-07）
       ── 定位 ────────────────────────────────────────────────
       这是**跨天演进的剧情线**管理页，与「奇遇」（`character_events`，一次性事件）是两层东西。
       ★ 用户已明确「不要碰奇遇」：本页**不读写**奇遇数据。

       ── 为什么第一期不做重型节点图（用户裁定 S1：同意分期）──────
       "节点"在构画里指**聊天楼层**，照搬到邻舍会画出无意义的图。
       本页的节点 = **事件线本身**，边 = **由后端自动算的结构性关联**
       （共享角色/地点/派生）—— 不让 AI 生成，否则会造假关系。
       ⚠ 第一期用**列表 + 关联摘要**呈现拓扑；重型拖拽画布留到第二期。 -->
  <div class="story-view page-host">
    <div class="sv-header">
      <h2 class="sv-title">故事</h2>
      <span class="sv-sub">跨天演进的剧情线 · 与「奇遇」无关（那是单次事件）</span>
      <span class="sv-spacer"></span>
      <div class="sv-tabs" role="group" aria-label="视图">
        <button type="button" class="sv-tab" :class="{ active: tab === 'lines' }" @click="tab = 'lines'">线列表</button>
        <button type="button" class="sv-tab" :class="{ active: tab === 'graph' }" @click="tab = 'graph'">节点图</button>
      </div>
      <linshe-button variant="primary" size="sm" @click="openCreate">+ 新建线</linshe-button>
    </div>

    <div v-if="loading" class="sv-empty">加载中…</div>

    <div v-else-if="tab === 'lines'" class="sv-body">
      <p v-if="!lines.length" class="sv-empty">
        还没有任何事件线。点「+ 新建线」手工创建，或由生成侧自动产出。
      </p>
      <div v-else class="sv-list">
        <article v-for="l in lines" :key="l.id" class="sv-card" :class="{ 'is-terminal': l.terminal }">
          <div class="sv-card-head">
            <span class="sv-stage" :class="stageClass(l.stage)">{{ l.stage }}</span>
            <h3 class="sv-name">{{ l.name }}</h3>
            <span v-if="l.pin" class="sv-pin" title="已锁定：AI 不得改动这条线">已锁定</span>
            <span v-if="l.adult" class="sv-adult">成人向</span>
            <span class="sv-flex"></span>
            <span class="sv-when">{{ l.when || '未定时间' }}</span>
          </div>
          <p v-if="l.desc" class="sv-desc">{{ l.desc }}</p>
          <p v-if="l.next" class="sv-next"><b>下一步</b>：{{ l.next }}</p>
          <div class="sv-card-foot">
            <span class="sv-meta">推进方：{{ l.agency === 'player' ? '用户推动' : '世界演进' }}</span>
            <span v-if="l.participantIds.length" class="sv-meta">涉及 {{ l.participantIds.length }} 名角色</span>
            <span v-if="l.places.length" class="sv-meta">涉及 {{ l.places.length }} 处地点</span>
            <span class="sv-flex"></span>
            <linshe-button variant="ghost" size="sm" @click="openEdit(l)">编辑</linshe-button>
            <linshe-button variant="ghost" size="sm" @click="togglePin(l)">{{ l.pin ? '解锁' : '锁定' }}</linshe-button>
            <linshe-button variant="ghost" size="sm" tone="danger" @click="removeLine(l)">删除</linshe-button>
          </div>
        </article>
      </div>
    </div>

    <div v-else class="sv-body sv-body-graph">
      <!-- 节点图（第二期）：真正的画布。
           节点＝事件线；连线为**后端自动算**的结构性关联（共享角色/地点/派生），不做语义推断。
           ⚠ 筛选必须走服务端 —— 见下方 loadGraph 的注释。 -->
      <div class="sv-graph-bar">
        <span class="sv-graph-note">
          节点＝事件线；连线为<strong>自动计算的结构性关联</strong>（共享角色 / 地点 / 派生关系），不是模型推断的「语义相似」。
        </span>
        <span class="sv-flex"></span>
        <label class="sv-filter">
          <span>按角色筛选</span>
          <linshe-select v-model="filterPid" size="sm" :options="participantFilterOptions" style="min-width: 140px" />
        </label>
        <button
          type="button" class="sv-chip" :class="{ on: !includeTerminal }"
          title="只显示仍在推进的线（隐藏收束/淡出的终态线）"
          @click="toggleTerminal"
        >只看在推进的</button>
        <linshe-button variant="ghost" size="sm" @click="fitGraph">适配视图</linshe-button>
      </div>
      <p v-if="graphTruncated" class="sv-trunc">
        ⚠ 图上有 {{ graphTruncated }} 条线超出单屏上限（已显示 {{ graph.nodes.length }} / {{ graphTotal }}），
        请用上方筛选收窄，或到「线列表」页查看全部。
      </p>
      <div class="sv-canvas">
        <StoryGraphCanvas
          ref="canvasRef"
          :nodes="graph.nodes"
          :edges="graph.edges"
          :stages="stages"
          :active-id="form.id"
          @select="openEdit"
        />
      </div>
    </div>

    <!-- 新建 / 编辑（同一表单，语义不同：新建不含锁线开关） -->
    <linshe-modal v-model="editorOpen" :title="form.id ? '编辑事件线' : '新建事件线'">
      <!-- AI 生成入口：只出草稿填进本表单，仍需点「保存」才落库 -->
      <div class="sv-form">
        <div v-if="!form.id" class="sv-gen-bar">
          <linshe-button variant="secondary" size="sm" @click="generateOpen = true">
            ✨ 让 AI 按要点生成
          </linshe-button>
          <span class="sv-gen-hint">先选好角色/地点，生成时会一并带上</span>
        </div>
        <div class="sv-field">
          <label>线名</label>
          <linshe-input v-model="form.name" placeholder="如：绯英的连环画稿约" />
        </div>
        <div class="sv-row2">
          <div class="sv-field">
            <label>阶段</label>
            <linshe-select v-model="form.stage" :options="stageOptions" size="sm" />
          </div>
          <div class="sv-field">
            <label>推进方</label>
            <linshe-select v-model="form.agency" size="sm" :options="[
              { label: '世界自行演进', value: 'world' },
              { label: '用户推动', value: 'player' },
            ]" />
          </div>
        </div>
        <div class="sv-field">
          <label>时间<span class="sv-opt">（自由文本；故事内历法待 T4）</span></label>
          <linshe-input v-model="form.whenText" placeholder="如：第 3 天傍晚" />
        </div>
        <div class="sv-field">
          <label>内容描述</label>
          <linshe-input v-model="form.desc" type="textarea" :rows="3" placeholder="这条线在讲什么" />
        </div>
        <div class="sv-field">
          <label>下一步<span class="sv-opt">（给下轮生成的推进锚点）</span></label>
          <linshe-input v-model="form.nextText" type="textarea" :rows="2" />
        </div>
        <!-- ⚠ 角色/地点各占**整行**：多选框里会累积多个 chip，挤在半栏里会被压成一条细缝，
           而且下拉浮层会盖住右侧字段（实测截图确认过）。 -->
        <div class="sv-field">
          <label>涉及角色<span class="sv-opt">（输入名字检索，可多选）</span></label>
          <MultiPickSelect
            v-model="form.participantValues"
            :candidates="participantCandidates"
            placeholder="输入角色名检索…"
          />
        </div>
        <div class="sv-field">
          <label>涉及地点<span class="sv-opt">（输入检索，可多选；未收录也可直接输入）</span></label>
          <MultiPickSelect
            v-model="form.placeValues"
            :candidates="placeCandidates"
            placeholder="输入地名检索…"
          />
        </div>
        <div class="sv-row2">
          <div class="sv-field">
            <label>派生自<span class="sv-opt">（哪条线长出来的，可空）</span></label>
            <linshe-select v-model="form.derivedFrom" size="sm" :options="deriveOptions" />
          </div>
          <div class="sv-field">
            <label>标记</label>
            <div class="sv-chips">
              <button type="button" class="sv-chip" :class="{ on: form.stall }" @click="form.stall = !form.stall">停滞</button>
              <button type="button" class="sv-chip" :class="{ on: form.adult }" @click="form.adult = !form.adult">成人向</button>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <linshe-button variant="ghost" @click="editorOpen = false">取消</linshe-button>
        <linshe-button variant="primary" :disabled="!form.name.trim() || busy" :loading="busy" @click="save">保存</linshe-button>
      </template>
    </linshe-modal>

    <!-- AI 生成事件线（只出草稿，应用后填进上面的编辑表单） -->
    <StoryLineGenerateModal
      v-model="generateOpen"
      :participant-ids="form.participantValues.map(Number).filter(Number.isFinite)"
      :places="form.placeValues"
      :name-of-id="nameOfCharacter"
      @applied="onDraftApplied"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch, inject } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheInput from '../components/ui/LinsheInput.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import LinsheSelect from '../components/ui/LinsheSelect.vue'
import MultiPickSelect from '../components/ui/MultiPickSelect.vue'
import StoryGraphCanvas from '../components/story/StoryGraphCanvas.vue'
import StoryLineGenerateModal from '../components/story/StoryLineGenerateModal.vue'

const toastFn = inject('toast', null)

const loading = ref(true)
const busy = ref(false)
const tab = ref('lines')
const lines = ref([])
const graph = ref({ nodes: [], edges: [] })
const graphTotal = ref(0)
const graphTruncated = ref(0)
const canvasRef = ref(null)
const generateOpen = ref(false)
/** 阶段选项来自后端 `/story/meta`（唯一真源），前端不硬编码 —— 项目红线 8 */
const stages = ref([])
/** 节点图筛选项：角色 / 是否含终态（第二期，用户设计文档 §2.2「默认按角色筛选」） */
const filterPid = ref('')
const includeTerminal = ref(true)
/** 编辑表单候选：后端给（角色**已排除归档**、地点来自世界地图唯一真源） */
const participantOptions = ref([])
const placeOptions = ref([])

const stageOptions = computed(() => stages.value.map(s => ({ label: s, value: s })))

/** 多选组件候选：角色值用 id（落库要 id），展示用人名（用户不该记 id） */
const participantCandidates = computed(() => participantOptions.value.map(p => ({
  value: String(p.id), label: p.name, hint: '',
})))
/** 地点候选带归属提示 —— 重名很常见（多个区都有「中心广场」），不带归属用户选不准 */
const placeCandidates = computed(() => placeOptions.value.map(p => ({
  value: p.name, label: p.name, hint: [p.region, p.area].filter(Boolean).join(' · '),
})))

function nameOfCharacter(id) {
  return participantOptions.value.find(p => String(p.id) === String(id))?.name || `#${id}`
}

/** 节点图按角色筛选的下拉：用真实角色候选（显示名字，而不是 `角色 #0`） */
const participantFilterOptions = computed(() => [
  { label: '全部角色', value: '' },
  ...participantOptions.value.map(p => ({ label: p.name, value: String(p.id) })),
])

const deriveOptions = computed(() => [
  { label: '（无）', value: '' },
  ...lines.value.filter(l => l.id !== form.id).map(l => ({ label: l.name || `#${l.id}`, value: String(l.id) })),
])

const form = reactive({
  id: null, name: '', stage: '起线', whenText: '', agency: 'world',
  desc: '', nextText: '', derivedFrom: '',
  /** 多选值：角色存**字符串 id**（与 MultiPickSelect 的字符串值契约一致，提交时转数字） */
  participantValues: [],
  placeValues: [],
  stall: false, adult: false,
})

function stageClass(s) {
  return { 'st-qi': s === '起线', 'st-yan': s === '延展', 'st-cheng': s === '成形', 'st-shou': s === '收束', 'st-dan': s === '淡出' }
}

async function load() {
  loading.value = true
  try {
    const [meta, ls, opts] = await Promise.all([
      api.getStoryMeta(), api.listStoryLines(), api.getStoryOptions(),
    ])
    stages.value = Array.isArray(meta?.stages) ? meta.stages : []
    lines.value = Array.isArray(ls?.lines) ? ls.lines : []
    participantOptions.value = Array.isArray(opts?.participants) ? opts.participants : []
    placeOptions.value = Array.isArray(opts?.places) ? opts.places : []
    await loadGraph()
  } catch (err) {
    toastFn?.('读取事件线失败：' + (err?.message || ''), 'error')
  } finally {
    loading.value = false
  }
}

/**
 * 拉节点图数据。
 *
 * ★★ 筛选**必须走服务端**：后端是"先选出可见节点、再只在可见集内算边"。
 *    前端若自己 `filter(nodes)` 而边仍来自全量，会出现指向被隐藏节点的**悬空边**
 *    （vue-flow 收到会告警/漏画）。所以筛选一变就重新请求，而不是本地过滤。
 */
async function loadGraph() {
  const g = await api.getStoryGraph({
    participantId: filterPid.value || null,
    includeTerminal: includeTerminal.value,
  })
  graph.value = { nodes: g?.nodes || [], edges: g?.edges || [] }
  graphTotal.value = Number(g?.total ?? graph.value.nodes.length)
  graphTruncated.value = Number(g?.truncated ?? 0)
}

watch([filterPid, includeTerminal], () => { loadGraph().catch(() => {}) })
watch(tab, v => { if (v === 'graph') loadGraph().catch(() => {}) })

function toggleTerminal() { includeTerminal.value = !includeTerminal.value }
function fitGraph() { canvasRef.value?.fit() }

function openCreate() {
  Object.assign(form, {
    id: null, name: '', stage: stages.value[0] || '起线', whenText: '', agency: 'world',
    desc: '', nextText: '', derivedFrom: '',
    participantValues: [], placeValues: [],
    stall: false, adult: false,
  })
  editorOpen.value = true
}

/**
 * 打开编辑。
 *
 * ⚠ **历史数据里的角色 id 可能已不在候选里**（角色被删/被归档 —— 归档角色会被候选排除）。
 *   这时不能把它悄悄丢掉：人工编辑不受自动护栏约束（项目红线 L10），
 *   已存在的值必须原样保留，只是候选下拉里找不到它而已。
 *   做法：把「不在候选里的既有值」也作为候选补进去（标「已不在列表」）。
 */
function openEdit(l) {
  const known = new Set(participantOptions.value.map(p => String(p.id)))
  const extraParticipants = (l.participantIds || [])
    .map(String)
    .filter(id => !known.has(id))
    .map(id => ({ id: Number(id), name: `#${id}（已不在角色列表）` }))
  if (extraParticipants.length) {
    participantOptions.value = [...participantOptions.value, ...extraParticipants]
  }
  Object.assign(form, {
    id: l.id, name: l.name, stage: l.stage, whenText: l.when || '', agency: l.agency,
    desc: l.desc, nextText: l.next,
    participantValues: (l.participantIds || []).map(String),
    placeValues: (l.places || []).map(String),
    derivedFrom: l.derivedFrom ? String(l.derivedFrom) : '',
    stall: !!l.stall, adult: !!l.adult,
  })
  editorOpen.value = true
}

const editorOpen = ref(false)

/**
 * AI 草稿应用：把生成的字段填进编辑表单。
 * ⚠ **只填非空字段**，不覆盖用户已填的内容（与「修正地点」同构）。
 */
function onDraftApplied(patch = {}) {
  if (patch.name) form.name = patch.name
  if (patch.desc) form.desc = patch.desc
  if (patch.nextText) form.nextText = patch.nextText
  if (patch.whenText) form.whenText = patch.whenText
  toastFn?.('已填入编辑表单，确认后点「保存」', 'success')
}

async function save() {
  if (busy.value) return
  busy.value = true
  try {
    const payload = {
      name: form.name.trim(),
      stage: form.stage,
      whenText: form.whenText.trim(),
      agency: form.agency,
      desc: form.desc.trim(),
      nextText: form.nextText.trim(),
      stall: form.stall,
      adult: form.adult,
      derivedFrom: form.derivedFrom ? Number(form.derivedFrom) : null,
      // 多选值是字符串（组件契约）；角色要转数字 id，地点保持名字（后端按名字存）
      participantIds: form.participantValues.map(Number).filter(Number.isFinite),
      places: form.placeValues.map(s => String(s).trim()).filter(Boolean),
    }
    if (form.id) await api.updateStoryLine(form.id, payload)
    else await api.createStoryLine(payload)
    editorOpen.value = false
    await load()
    toastFn?.('已保存', 'success')
  } catch (err) {
    toastFn?.('保存失败：' + (err?.message || ''), 'error')
  } finally { busy.value = false }
}

async function togglePin(l) {
  try {
    await api.setStoryLinePin(l.id, !l.pin)
    await load()
    toastFn?.(l.pin ? '已解锁（AI 可以改动了）' : '已锁定（AI 不得改动）', 'success')
  } catch (err) {
    toastFn?.('操作失败：' + (err?.message || ''), 'error')
  }
}

async function removeLine(l) {
  if (!window.confirm(`确定删除事件线「${l.name}」？`)) return
  try {
    await api.deleteStoryLine(l.id)
    await load()
    toastFn?.('已删除', 'success')
  } catch (err) {
    toastFn?.('删除失败：' + (err?.message || ''), 'error')
  }
}

onMounted(load)
</script>

<style scoped>
/* ⚠ `min-height: 0` 必需：本页在纵向 flex 链上，且节点图页签内部有需要确定高度的画布。 */
.story-view { display: flex; flex-direction: column; min-height: 0; height: 100%; padding: 18px 20px; box-sizing: border-box; }
.sv-header { display: flex; align-items: center; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid var(--glass-border); }
.sv-title { margin: 0; font-size: var(--fs-lg); font-weight: 700; }
.sv-sub { font-size: var(--fs-xs); color: var(--text-secondary); }
.sv-spacer, .sv-flex { flex: 1; }
.sv-tabs { display: flex; gap: 4px; }
.sv-tab {
  padding: 4px 12px; border-radius: var(--radius-full); border: var(--border);
  background: var(--glass-bg); color: var(--text-secondary); font-size: var(--fs-xs); cursor: pointer;
}
/* ⚠ 实心强调底**必须**用 `--accent-solid`，不能用裸 `--accent` ——
   后者是为文字/描边调的色，暗色主题下当**实心底**配白字会对比度不足
   （项目有测试钉住这条，`darkThemeReadability.test.js`）。 */
.sv-tab.active { background: var(--accent-solid); color: #fff; border-color: transparent; }
.sv-chip.on { background: var(--accent-solid); color: #fff; border-color: transparent; }

/* 阶段色标：底/字成对取色，且**同时适配明暗主题** —— 只在暗色下用低饱和深底，
   避免浅底浅字在暗色主题里糊成一片。 */
.sv-stage { border: 1px solid transparent; }
.st-qi { background: var(--stage-qi-bg, #E6F1FB); color: var(--stage-qi-fg, #185FA5); }
.st-yan { background: var(--stage-yan-bg, #E1F5EE); color: var(--stage-yan-fg, #0F6E56); }
.st-cheng { background: var(--stage-cheng-bg, #FAEEDA); color: var(--stage-cheng-fg, #854F0B); }
.st-shou { background: var(--stage-shou-bg, #F1EFE8); color: var(--stage-shou-fg, #5F5E5A); }
.st-dan { background: var(--stage-dan-bg, #F1EFE8); color: var(--stage-dan-fg, #888780); }
.sv-body { flex: 1; min-height: 0; overflow-y: auto; padding-top: 14px; }
/* 节点图页签：父链必须一路给到确定高度，否则 vue-flow 在 0 高容器里不渲染任何节点 */
.sv-body-graph { display: flex; flex-direction: column; overflow: hidden; }
.sv-empty { padding: 28px 0; text-align: center; font-size: var(--fs-sm); color: var(--text-secondary); }
.sv-list { display: flex; flex-direction: column; gap: 10px; }
.sv-card {
  padding: 12px 14px; border-radius: var(--radius-lg);
  border: var(--border-strong); background: var(--glass-bg);
}
.sv-card.is-terminal { opacity: 0.62; }
.sv-card-head { display: flex; align-items: center; gap: 8px; }
.sv-name { margin: 0; font-size: var(--fs-md); font-weight: 600; }
.sv-stage {
  padding: 1px 8px; border-radius: var(--radius-full); font-size: 10.5px; font-weight: 600;
}
.sv-pin { padding: 1px 7px; border-radius: var(--radius-full); font-size: 10px; background: #FBEAF0; color: #993556; }
.sv-adult { padding: 1px 7px; border-radius: var(--radius-full); font-size: 10px; background: #FAECE7; color: #993C1D; }
.sv-when { font-size: var(--fs-xs); color: var(--text-secondary); }
.sv-desc { margin: 8px 0 0; font-size: var(--fs-sm); line-height: 1.7; }
.sv-next { margin: 6px 0 0; font-size: var(--fs-xs); color: var(--text-secondary); }
.sv-card-foot { display: flex; align-items: center; gap: 10px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--glass-border); }
.sv-meta { font-size: var(--fs-xs); color: var(--text-secondary); }

/* ── 节点图（第二期）：工具条 + 画布 ──
   ⚠ 画布需要有**确定的高度**：vue-flow 在 0 高度的容器里不会渲染任何节点
     （它按容器实际尺寸算 viewport）。父级链上必须一路给到 flex 高度。 */
.sv-graph-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.sv-graph-note { font-size: var(--fs-xs); line-height: 1.7; color: var(--text-secondary); }
.sv-filter { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--text-secondary); }
.sv-trunc {
  margin: 0 0 10px; padding: 6px 10px; border-radius: var(--radius-sm);
  font-size: var(--fs-xs); background: #FAEEDA; color: #854F0B;
}
[data-theme="dark"] .sv-trunc { background: #412402; color: #FAC775; }
.sv-canvas {
  flex: 1; min-height: 420px;
  border-radius: var(--radius-lg); border: var(--glass-border);
  background: var(--bg-tertiary);
  overflow: hidden;
}
.sv-form { display: flex; flex-direction: column; gap: 12px; }
/* AI 生成入口：只在「新建」时出现（编辑已有线时用不着） */
.sv-gen-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: var(--radius-md);
  background: rgba(var(--accent-rgb), 0.06);
}
.sv-gen-hint { font-size: var(--fs-xs); color: var(--text-secondary); }
.sv-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sv-field { display: flex; flex-direction: column; gap: 6px; }
.sv-field label { font-size: var(--fs-xs); font-weight: 600; color: var(--text-secondary); }
.sv-opt { font-weight: 400; }
.sv-chips { display: flex; gap: 6px; }
.sv-chip {
  padding: 3px 11px; border-radius: var(--radius-full); border: var(--border);
  background: var(--glass-bg); color: var(--text-secondary); font-size: var(--fs-xs); cursor: pointer;
}
</style>