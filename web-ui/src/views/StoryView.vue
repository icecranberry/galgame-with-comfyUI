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

    <div v-else class="sv-body">
      <!-- 节点图（第一期形态）：按关联聚合展示，边取自后端的自动计算结果 -->
      <p v-if="!graph.nodes.length" class="sv-empty">还没有节点 —— 先建几条事件线。</p>
      <template v-else>
        <p class="sv-graph-note">
          节点＝事件线；连线为<strong>自动计算的结构性关联</strong>（共享角色 / 地点 / 派生关系），
          不是模型推断的「语义相似」—— 避免造假关系。
        </p>
        <div class="sv-graph">
          <div v-for="n in graph.nodes" :key="n.id" class="sv-node" :class="{ 'is-terminal': n.terminal }">
            <span class="sv-stage" :class="stageClass(n.stage)">{{ n.stage }}</span>
            <span class="sv-node-name">{{ n.name }}</span>
          </div>
        </div>
        <div v-if="graph.edges.length" class="sv-edges">
          <p class="sv-sect-title">关联（{{ graph.edges.length }} 条）</p>
          <div v-for="(e, i) in graph.edges" :key="i" class="sv-edge">
            <span class="sv-edge-from">{{ nameOf(e.from) }}</span>
            <span class="sv-edge-arrow">{{ e.kind === 'derive' ? '⇒ 派生自' : '↔' }}</span>
            <span class="sv-edge-to">{{ nameOf(e.to) }}</span>
            <span class="sv-edge-label">{{ e.label }}</span>
          </div>
        </div>
        <p v-else class="sv-empty">当前没有线之间存在结构性关联。</p>
      </template>
    </div>

    <!-- 新建 / 编辑（同一表单，语义不同：新建不含锁线开关） -->
    <linshe-modal v-model="editorOpen" :title="form.id ? '编辑事件线' : '新建事件线'">
      <div class="sv-form">
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
        <div class="sv-row2">
          <div class="sv-field">
            <label>涉及角色 ID<span class="sv-opt">（英文逗号分隔）</span></label>
            <linshe-input :model-value="form.participantText" @update:model-value="form.participantText = $event" placeholder="1, 2, 3" />
          </div>
          <div class="sv-field">
            <label>涉及地点<span class="sv-opt">（英文逗号分隔）</span></label>
            <linshe-input :model-value="form.placesText" @update:model-value="form.placesText = $event" placeholder="嬉步街, 鸽川大道" />
          </div>
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
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, inject } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheInput from '../components/ui/LinsheInput.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import LinsheSelect from '../components/ui/LinsheSelect.vue'

const toastFn = inject('toast', null)

const loading = ref(true)
const busy = ref(false)
const tab = ref('lines')
const lines = ref([])
const graph = ref({ nodes: [], edges: [] })
/** 阶段选项来自后端 `/story/meta`（唯一真源），前端不硬编码 —— 项目红线 8 */
const stages = ref([])

const stageOptions = computed(() => stages.value.map(s => ({ label: s, value: s })))
const deriveOptions = computed(() => [
  { label: '（无）', value: '' },
  ...lines.value.filter(l => l.id !== form.id).map(l => ({ label: l.name || `#${l.id}`, value: String(l.id) })),
])

const form = reactive({
  id: null, name: '', stage: '起线', whenText: '', agency: 'world',
  desc: '', nextText: '', participantText: '', placesText: '', derivedFrom: '',
  stall: false, adult: false,
})

function stageClass(s) {
  return { 'st-qi': s === '起线', 'st-yan': s === '延展', 'st-cheng': s === '成形', 'st-shou': s === '收束', 'st-dan': s === '淡出' }
}
function nameOf(id) {
  return lines.value.find(l => l.id === id)?.name || `#${id}`
}

async function load() {
  loading.value = true
  try {
    const [meta, ls, g] = await Promise.all([api.getStoryMeta(), api.listStoryLines(), api.getStoryGraph()])
    stages.value = Array.isArray(meta?.stages) ? meta.stages : []
    lines.value = Array.isArray(ls?.lines) ? ls.lines : []
    graph.value = { nodes: g?.nodes || [], edges: g?.edges || [] }
  } catch (err) {
    toastFn?.('读取事件线失败：' + (err?.message || ''), 'error')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  Object.assign(form, {
    id: null, name: '', stage: stages.value[0] || '起线', whenText: '', agency: 'world',
    desc: '', nextText: '', participantText: '', placesText: '', derivedFrom: '',
    stall: false, adult: false,
  })
  editorOpen.value = true
}

function openEdit(l) {
  Object.assign(form, {
    id: l.id, name: l.name, stage: l.stage, whenText: l.when || '', agency: l.agency,
    desc: l.desc, nextText: l.next,
    participantText: (l.participantIds || []).join(', '),
    placesText: (l.places || []).join(', '),
    derivedFrom: l.derivedFrom ? String(l.derivedFrom) : '',
    stall: !!l.stall, adult: !!l.adult,
  })
  editorOpen.value = true
}

const editorOpen = ref(false)

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
      participantIds: form.participantText.split(/[,，]/).map(s => Number(s.trim())).filter(Number.isFinite),
      places: form.placesText.split(/[,，]/).map(s => s.trim()).filter(Boolean),
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
.story-view { display: flex; flex-direction: column; min-height: 0; padding: 18px 20px; }
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
.sv-graph-note { margin: 0 0 12px; font-size: var(--fs-xs); line-height: 1.7; color: var(--text-secondary); }
.sv-graph { display: flex; flex-wrap: wrap; gap: 8px; }
.sv-node {
  display: flex; align-items: center; gap: 6px; padding: 6px 12px;
  border-radius: var(--radius-full); border: var(--border-strong); background: var(--glass-bg);
}
.sv-node.is-terminal { opacity: 0.6; }
.sv-node-name { font-size: var(--fs-sm); }
.sv-edges { margin-top: 16px; }
.sv-sect-title { margin: 0 0 8px; font-size: var(--fs-xs); font-weight: 600; color: var(--text-secondary); }
.sv-edge { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: var(--fs-sm); }
.sv-edge-arrow { color: var(--accent); }
.sv-edge-label { font-size: var(--fs-xs); color: var(--text-secondary); }
.sv-form { display: flex; flex-direction: column; gap: 12px; }
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