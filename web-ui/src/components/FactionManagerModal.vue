<template>
  <linshe-modal v-model="open" title="派系与组织" full body-class="faction-body">
    <div class="fl">
      <!-- ── 左：派系列表 ── -->
      <aside class="fl-list">
        <div class="fl-list-head">
          <span>派系 ({{ items.length }})</span>
          <linshe-button size="sm" variant="secondary" :disabled="!ready" @click="startCreate">＋新建</linshe-button>
        </div>
        <p v-if="loadError" class="fl-warn">{{ loadError }}</p>
        <ul class="fl-ul">
          <li
            v-for="f in items"
            :key="f.id"
            class="fl-item"
            :class="{ 'is-active': current && current.id === f.id }"
            role="button"
            tabindex="0"
            @click="select(f)"
            @keyup.enter="select(f)"
          >
            <span class="fl-dot" :style="f.color ? { background: f.color } : undefined"></span>
            <span class="fl-item-name">{{ f.name }}</span>
            <span class="fl-count">{{ f.memberCount }}</span>
          </li>
        </ul>
        <p v-if="!items.length && !loadError" class="fl-empty">还没有派系</p>
      </aside>

      <!-- ── 右：档案 ── -->
      <section class="fl-detail">
        <!-- 新建 -->
        <template v-if="creating">
          <h3 class="fl-name">新建派系</h3>
          <div class="fl-form">
            <label class="fl-field"><span>名称</span>
              <linshe-input v-model="draft.name" size="sm" placeholder="例：市政厅 / 商会 / 同乡会" /></label>
            <label class="fl-field"><span>类型</span>
              <linshe-select v-model="draft.type" size="sm" allow-free-input :options="typeOptions" /></label>
          </div>
          <div class="fl-actions">
            <linshe-button size="sm" variant="primary" :disabled="busy || !draft.name.trim()" @click="submitCreate">创建</linshe-button>
            <linshe-button size="sm" variant="ghost" :disabled="busy" @click="creating = false">取消</linshe-button>
          </div>
        </template>

        <!-- 档案 -->
        <template v-else-if="current">
          <!-- 头部：名字 + 态势标签 + 成员头像堆叠 -->
          <header class="fl-head">
            <h3 class="fl-name">{{ current.name }}</h3>
            <span class="fl-chip">{{ current.type }}</span>
            <span class="fl-chip" :class="statusClass(current.status)">{{ current.status }}</span>
            <span class="fl-chip" :class="stanceClass(current.stance)">对我：{{ current.stance }}</span>
            <div v-if="current.members.length" class="fl-stack">
              <span
                v-for="m in current.members.slice(0, 8)"
                :key="m.id"
                class="fl-av fl-av--sm"
                :style="avatarStyle(m)"
                :title="`${m.display_name}（${m.role}）`"
              >{{ m.avatar_path ? '' : (m.display_name || '?').charAt(0) }}</span>
              <span v-if="current.members.length > 8" class="fl-av-more">+{{ current.members.length - 8 }}</span>
            </div>
          </header>

          <div class="fl-form">
            <div class="fl-row">
              <label class="fl-field"><span>名称</span>
                <linshe-input v-model="draft.name" size="sm" /></label>
              <!-- ★ 2026-10-07 用户实报：新建表单有「类型」，已选档案却漏了它 →
                   已建的派系没法改类型。这里补上与新建一致的字段（脚本侧
                   dirty/resetDraft/saveFaction 本就处理了 type，缺的只是 UI）。 -->
              <label class="fl-field"><span>类型</span>
                <linshe-select v-model="draft.type" size="sm" allow-free-input :options="typeOptions" /></label>
            </div>
            <div class="fl-row">
              <label class="fl-field"><span>状态</span>
                <linshe-select v-model="draft.status" size="sm" allow-free-input :options="statusOptions" /></label>
              <label class="fl-field"><span>对我（玩家）</span>
                <linshe-select v-model="draft.stance" size="sm" allow-free-input :options="stanceOptions" /></label>
            </div>
            <label class="fl-field"><span>势力范围</span>
              <linshe-input v-model="draft.scope" size="sm" placeholder="如：城北 / 全城 / 行踪不明" /></label>
            <label class="fl-field"><span>当下目标</span>
              <linshe-input v-model="draft.goal" size="sm" placeholder="它现在想干什么 —— 对生成最有指导性" /></label>
            <div class="fl-field">
              <span>权力支柱<span class="fl-opt">（输入后回车添加，点一下可移除）</span></span>
              <!-- ★ 2026-10-07 用户口径：「不要有默认存在的标签，只留直接输入添加的输入框」。
                   原先这里平铺一排**建议值**（武力威慑/财力雄厚…）供点选，用户认为那是
                   系统预设的噪音 —— 这些词本就该由用户按世界观自己写（红线 12：
                   引擎不该内置世界观专名，而通用词平铺也是干扰）。
                   ⚠ 只去掉**建议值**；**已选中的标签仍要显示** ——
                     否则用户看不到自己加过什么、也没法删（那是"改了却看不出"的坏体验）。 -->
              <div class="fl-tags">
                <button
                  v-for="t in draft.tags"
                  :key="t"
                  type="button"
                  class="fl-tag"
                  :title="`点一下移除「${t}」`"
                  @click="removeTag(t)"
                >{{ t }}<em class="fl-tag-x">×</em></button>
                <input
                  v-model="newTag"
                  class="fl-tag-input"
                  :placeholder="draft.tags.length ? '＋再输入' : '＋直接输入'"
                  @keyup.enter="addCustomTag"
                />
                <linshe-button
                  v-if="newTag.trim()"
                  size="sm" variant="ghost" @click="addCustomTag"
                >添加</linshe-button>
              </div>
            </div>
            <label class="fl-field"><span>说明</span>
              <linshe-input v-model="draft.description" type="textarea" :rows="3" placeholder="理念、行动方式、当前处境…（可留空）" /></label>
          </div>

          <div class="fl-actions">
            <linshe-button size="sm" variant="primary" :disabled="busy || !dirty" @click="saveFaction">保存</linshe-button>
            <linshe-button size="sm" variant="ghost" :disabled="busy || !dirty" @click="resetDraft">重置</linshe-button>
            <linshe-button size="sm" variant="danger" :disabled="busy" @click="confirmDelete">删除派系</linshe-button>
          </div>

          <!-- 成员（图文；添加走按钮 + 头像网格，不留常驻空框） -->
          <div class="fl-sec">
            <h4 class="fl-sub">成员 <em>{{ current.memberCount }}</em></h4>
            <linshe-button size="sm" variant="secondary" :disabled="busy" @click="togglePicker">
              {{ pickerOpen ? '收起' : '＋ 添加角色' }}
            </linshe-button>
          </div>

          <div v-if="pickerOpen" class="fl-picker">
            <!-- ★ 2026-10-07 用户要求：候选加分类筛选 + 默认排除归档角色。
                 归档 = 禁止一切主动行为，拉进来等于登记一个"不会动"的成员。 -->
            <div class="fl-scopes">
              <button
                v-for="s in pickScopes" :key="s.key"
                type="button" class="fl-scope"
                :class="{ on: pickScope === s.key, 'is-arch': s.key === 'archived' }"
                @click="pickScope = s.key"
              >{{ s.label }}<span class="fl-scope-n">{{ s.count }}</span></button>
            </div>
            <linshe-input v-model="pickQuery" size="sm" placeholder="搜索角色…" />
            <p v-if="hiddenArchivedCount" class="fl-hidden-tip">
              已隐藏 {{ hiddenArchivedCount }} 个归档角色（归档＝不参与任何主动活动）
              <button type="button" class="fl-hidden-link" @click="pickScope = 'archived'">查看归档</button>
            </p>
            <div class="fl-pick-grid">
              <button
                v-for="c in pickList"
                :key="c.id"
                type="button"
                class="fl-pick"
                :class="{ 'is-in': isMember(c.id) }"
                :disabled="busy || isMember(c.id)"
                :title="c.archived ? '这是归档角色（不参与任何主动活动）' : ''"
                @click="pick(c)"
              >
                <span class="fl-av" :style="avatarStyle(c)">{{ c.avatar_path ? '' : (c.display_name || c.name || '?').charAt(0) }}</span>
                <span class="fl-pick-name">{{ c.display_name || c.name }}</span>
                <span v-if="c.archived" class="fl-pick-arch">已归档</span>
              </button>
            </div>
            <p v-if="!pickList.length" class="fl-hint">
              这个分类下没有角色 —— 换个分类或清空搜索词试试。
            </p>
            <p class="fl-hint">点一下即加入（职务默认「成员」）；加入后在下方的职务框里可直接改。</p>
          </div>

          <!-- ★ 2026-10-07 用户口径：成员改成与「角色区块」（TavernView 的 .char-card）
               一致的卡片式。原先是一行「头像+名字+职务输入+移除」的平淡列表，视觉上
               与整站卡片语汇脱节。现改为 glass 卡片网格：头像在顶、名字居中、职务可
               直接改、底部一行「移除」。卡片本体不做整卡点击（卡里已有输入框和按钮，
               整卡点击会抢焦点），移除走明确的按钮。 -->
          <div v-if="current.members.length" class="fl-mcards">
            <div
              v-for="m in current.members"
              :key="m.id"
              class="fl-mcard"
              :class="{ 'is-archived': m.archived }"
            >
              <span class="fl-mcard-av" :style="avatarStyle(m)">{{ m.avatar_path ? '' : (m.display_name || '?').charAt(0) }}</span>
              <div class="fl-mcard-name" :title="m.display_name">{{ m.display_name }}</div>
              <span v-if="m.archived" class="fl-mcard-arch">已归档</span>
              <input
                class="fl-mcard-role"
                :value="m.role"
                :disabled="busy"
                title="职务（可直接改，回车生效）"
                @change="e => changeRole(m, e.target.value)"
                @keyup.enter="e => changeRole(m, e.target.value)"
              />
              <button type="button" class="fl-mcard-drop" :disabled="busy" @click="dropMember(m.id)">移除</button>
            </div>
          </div>
          <p v-else class="fl-hint">还没有成员 —— 点「＋ 添加角色」。</p>

          <!-- 势力关系 -->
          <div class="fl-sec">
            <h4 class="fl-sub">与其他势力 <em>{{ current.relations.length }}</em></h4>
            <linshe-button size="sm" variant="secondary" :disabled="busy" @click="relOpen = !relOpen">
              {{ relOpen ? '收起' : '＋ 登记关系' }}
            </linshe-button>
          </div>

          <div v-if="relOpen" class="fl-picker">
            <div class="fl-row">
              <linshe-select v-model="relationDraft.toId" size="sm" searchable :options="otherFactionOptions" placeholder="选对方派系" />
              <linshe-select v-model="relationDraft.relation" size="sm" :options="relationOptions" />
              <linshe-button size="sm" variant="secondary" :disabled="busy || !relationDraft.toId" @click="submitRelation">登记</linshe-button>
            </div>
          </div>

          <ul v-if="current.relations.length" class="fl-rels">
            <li v-for="r in current.relations" :key="r.id">
              <span class="fl-rel-name">{{ r.toName }}</span>
              <span class="fl-rel-chip" :class="relClass(r.relation)">{{ r.relation }}</span>
              <linshe-button size="sm" variant="ghost" :disabled="busy" @click="dropRelation(r.id)">移除</linshe-button>
            </li>
          </ul>

          <!-- 给 LLM 的写作指导 -->
          <div class="fl-foot">
            <linshe-button size="sm" variant="ghost" :disabled="promptLoading" @click="loadPromptPreview">
              预览给 LLM 的势力态势
            </linshe-button>
          </div>
          <pre v-if="promptPreview" class="fl-prompt">{{ promptPreview }}</pre>
        </template>

        <p v-else class="fl-empty">选一个派系，或新建一个</p>
      </section>
    </div>
  </linshe-modal>
</template>

<script setup>
// 「派系与组织」—— 酒馆页第三块（2026-10-07）。
// 与「我的关系图」（人↔人）和「世界观设置」（背景）并列：本模块看**势力格局**（势力↔势力、人↔势力）。
//
// ★ 2026-10-07 用户反馈「过于发散，要足够简约」→ 本轮做减法：
//   · 砍掉：配色 hex / 图标 / 上级组织 / 概述与详述的拆分（合并成一个「说明」）；
//   · 权力支柱：从"顿号分隔文本框"改成**点选标签**（建议值一点即加，也能自定义）；
//     ⚠ 2026-10-07 又一次调整（用户口径）：**去掉建议值**，只留"直接输入添加"的输入框 ——
//       平铺一排预设词本身也是噪音，支柱该由用户按世界观自己写。已选中的标签仍显示（可点删）。
//   · 成员改**图文**（头像 + 姓名 + 可直接改的职务）；添加走明确的「＋ 添加角色」按钮 + 头像网格 ——
//     **不再有常驻的空选择框**（用户说的"多余的框"就是这么来的）。
import { ref, reactive, computed, watch } from 'vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheSelect from './ui/LinsheSelect.vue'
import * as api from '../api/index.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 全量角色（用于成员选择） */
  characters: { type: Array, default: () => [] },
  /** 角色文件夹（用于候选分类筛选；与酒馆页/侧栏同一份口径：folder_id，未分类为 null） */
  folders: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'changed'])

const open = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const busy = ref(false)
const ready = ref(true)
const loadError = ref('')
const items = ref([])
const current = ref(null)
const creating = ref(false)
const pickerOpen = ref(false)
const relOpen = ref(false)
const pickQuery = ref('')
const newTag = ref('')
const promptPreview = ref('')
const promptLoading = ref(false)

const meta = reactive({ types: [], relations: [], statuses: [], stances: [], roleSuggestions: [], pillarSuggestions: [] })
const draft = reactive({ name: '', type: '其他', scope: '', status: '稳固', stance: '中立', goal: '', tags: [], description: '' })
const relationDraft = reactive({ toId: '', relation: '同盟' })

const typeOptions = computed(() => meta.types.map(t => ({ label: t, value: t })))
const statusOptions = computed(() => meta.statuses.map(s => ({ label: s, value: s })))
const stanceOptions = computed(() => meta.stances.map(s => ({ label: s, value: s })))
const relationOptions = computed(() => meta.relations.map(r => ({ label: r, value: r })))
const otherFactionOptions = computed(() => items.value
  .filter(f => !current.value || f.id !== current.value.id)
  .map(f => ({ label: f.name, value: f.id })))

/**
 * 「权力支柱」不再有建议值候选（用户口径 2026-10-07：不要默认存在的标签）。
 * 因此这里不再需要 `allTagOptions` —— 标签完全由用户输入产生。
 * ⚠ 后端的 `POWER_PILLAR_SUGGESTIONS` 仍保留（/meta 仍下发），
 *   只是前端不再平铺它们；将来若要恢复"可选建议"无需改后端。
 */
const MAX_TAGS = 8

const memberIds = computed(() => new Set((current.value?.members || []).map(m => m.character_id)))

/**
 * 「添加角色」候选的两层收窄（2026-10-07 用户要求）。
 *
 * ── 为什么候选里要排除归档 ──────────────────────────────────
 * 归档 = 禁止一切主动行为（日程/朋友圈/奇遇全停）。把一个归档角色拉进派系，
 * 等于登记了一个"不会动"的成员 —— 用户看到的就是"加进来了却毫无反应"。
 * ★ 默认**不列出**归档角色（与事件线编辑表单的候选口径一致），
 *   但**不禁止**：用户可显式切到「含归档」再选 —— 那是有意的（比如给旧成员补登关系）。
 *
 * ⚠ 已加入的归档成员**必须继续显示在成员区**（带「已归档」角标）——
 *   这是红线 0 的同源要求：不能因为"默认隐藏"就让用户找不到、删不掉已有的东西。
 *
 * ── 分类筛选 ────────────────────────────────────────────────
 * 分类取值组合：`active`（未归档，默认）/ `archived`（仅归档）/ `all`（全部）/
 * 具体文件夹 id（`f<id>`，未归档且属于该文件夹）。
 * 与左侧会话栏、酒馆页的文件夹口径一致（`folder_id`，未分类为 null）。
 */
const pickScope = ref('active')
const showArchivedTip = ref(false)
const pickList = computed(() => {
  const q = pickQuery.value.trim().toLowerCase()
  const all = props.characters || []
  const scope = pickScope.value
  let list = all
  if (scope === 'active') list = all.filter(c => !c.archived)
  else if (scope === 'archived') list = all.filter(c => c.archived)
  else if (scope !== 'all') {
    // `f<id>`：指定文件夹内的未归档角色
    const fid = Number(String(scope).slice(1))
    list = all.filter(c => !c.archived && Number(c.folder_id) === fid)
  }
  if (!q) return list
  return list.filter(c => String(c.display_name || c.name || '').toLowerCase().includes(q))
})

/** 候选分类项：未归档 / 归档 / 各文件夹（未分类并入「未归档」不单列，避免选项爆炸） */
const pickScopes = computed(() => {
  const all = props.characters || []
  const active = all.filter(c => !c.archived).length
  const arch = all.filter(c => c.archived).length
  const items = [{ key: 'active', label: '未归档', count: active }]
  for (const f of (props.folders || [])) {
    const n = all.filter(c => !c.archived && Number(c.folder_id) === Number(f.id)).length
    if (n > 0) items.push({ key: `f${f.id}`, label: f.name, count: n })
  }
  if (arch > 0) items.push({ key: 'archived', label: '归档', count: arch })
  return items
})

/** 候选里被"排除归档"挡掉的人数 —— 用来提示用户"人没丢，是被收起来了" */
const hiddenArchivedCount = computed(() => {
  if (pickScope.value !== 'active') return 0
  return (props.characters || []).filter(c => c.archived).length
})

function avatarStyle(c) {
  return c?.avatar_path
    ? { backgroundImage: `url(${c.avatar_path})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : undefined
}
function isMember(id) { return memberIds.value.has(id) }
function statusClass(s) {
  return { 'is-strong': s === '鼎盛', 'is-weak': s === '困顿' || s === '衰落', 'is-new': s === '新兴' }
}
function stanceClass(s) {
  return { 'is-ally': s === '友好', 'is-enemy': s === '敌对', 'is-cold': s === '冷淡' }
}
function relClass(rel) {
  return { 'is-ally': rel === '同盟', 'is-enemy': rel === '敌对', 'is-vassal': rel === '从属' }
}

const dirty = computed(() => {
  const c = current.value
  if (!c) return false
  return draft.name !== c.name
    || draft.type !== c.type
    || draft.scope !== (c.scope || '')
    || draft.status !== (c.status || '稳固')
    || draft.stance !== (c.stance || '中立')
    || draft.goal !== (c.goal || '')
    || draft.description !== (c.description || '')
    || draft.tags.join('、') !== (c.tags || []).join('、')
})

function resetDraft() {
  const c = current.value
  if (!c) return
  draft.name = c.name
  draft.type = c.type
  draft.scope = c.scope || ''
  draft.status = c.status || '稳固'
  draft.stance = c.stance || '中立'
  draft.goal = c.goal || ''
  draft.description = c.description || ''
  draft.tags = [...(c.tags || [])]
  newTag.value = ''
}

/** 移除已选标签（点标签即移除 —— 与"输入即添加"对称，都能自查自删） */
function removeTag(t) {
  const i = draft.tags.indexOf(t)
  if (i >= 0) draft.tags.splice(i, 1)
}
function addCustomTag() {
  const t = newTag.value.trim().slice(0, 12)
  if (t && !draft.tags.includes(t) && draft.tags.length < MAX_TAGS) draft.tags.push(t)
  newTag.value = ''
}

function select(f) {
  creating.value = false
  current.value = f
  pickerOpen.value = false
  relOpen.value = false
  pickQuery.value = ''
  relationDraft.toId = ''
  relationDraft.relation = meta.relations[0] || '同盟'
  resetDraft()
}
function startCreate() {
  creating.value = true
  current.value = null
  draft.name = ''
  draft.type = meta.types[0] || '其他'
}
function togglePicker() {
  pickerOpen.value = !pickerOpen.value
  if (pickerOpen.value) { pickQuery.value = ''; relOpen.value = false }
}

async function load(preferId) {
  busy.value = true
  try {
    const [m, res] = await Promise.all([api.getFactionMeta(), api.listFactions()])
    Object.assign(meta, m)
    items.value = res.items || []
    ready.value = true
    loadError.value = ''
    const next = items.value.find(f => f.id === preferId)
      || items.value.find(f => f.id === current.value?.id)
      || items.value[0]
    if (next) select(next)
    else current.value = null
  } catch (err) {
    ready.value = false
    loadError.value = err?.message || '加载失败'
  } finally {
    busy.value = false
  }
}

function applyResult(f) {
  const i = items.value.findIndex(x => x.id === f.id)
  if (i >= 0) items.value[i] = f
  else items.value.push(f)
  current.value = f
  resetDraft()
  emit('changed')
}

async function submitCreate() {
  busy.value = true
  try {
    const f = await api.createFaction({ name: draft.name.trim(), type: draft.type })
    items.value.push(f)
    creating.value = false
    select(f)
    emit('changed')
  } catch (err) { loadError.value = err?.message || '创建失败' } finally { busy.value = false }
}

async function saveFaction() {
  if (!current.value) return
  busy.value = true
  try {
    applyResult(await api.updateFaction(current.value.id, {
      name: draft.name.trim(),
      type: draft.type,
      scope: draft.scope,
      status: draft.status,
      stance: draft.stance,
      goal: draft.goal,
      tags: draft.tags,
      description: draft.description,
    }))
  } catch (err) { loadError.value = err?.message || '保存失败' } finally { busy.value = false }
}

async function confirmDelete() {
  const c = current.value
  if (!c) return
  if (!window.confirm(`删除派系「${c.name}」？其成员与关系会一并清掉。`)) return
  busy.value = true
  try {
    await api.deleteFaction(c.id)
    items.value = items.value.filter(x => x.id !== c.id)
    current.value = items.value[0] || null
    if (current.value) select(current.value)
    emit('changed')
  } catch (err) { loadError.value = err?.message || '删除失败' } finally { busy.value = false }
}

async function pick(c) {
  if (!current.value || isMember(c.id)) return
  busy.value = true
  try {
    applyResult(await api.addFactionMember(current.value.id, { characterId: c.id, role: '成员' }))
  } catch (err) { loadError.value = err?.message || '加入失败' } finally { busy.value = false }
}

async function changeRole(m, role) {
  if (!current.value) return
  const next = String(role || '').trim() || '成员'
  if (next === m.role) return
  busy.value = true
  try { applyResult(await api.updateFactionMember(current.value.id, m.id, { role: next })) }
  catch (err) { loadError.value = err?.message || '改职务失败' } finally { busy.value = false }
}

async function dropMember(memberId) {
  if (!current.value) return
  busy.value = true
  try { applyResult(await api.removeFactionMember(current.value.id, memberId)) }
  catch (err) { loadError.value = err?.message || '移除失败' } finally { busy.value = false }
}

async function submitRelation() {
  if (!current.value || !relationDraft.toId) return
  busy.value = true
  try {
    applyResult(await api.upsertFactionRelation({
      fromId: current.value.id,
      toId: relationDraft.toId,
      relation: relationDraft.relation,
    }))
    relationDraft.toId = ''
    relOpen.value = false
  } catch (err) { loadError.value = err?.message || '登记失败' } finally { busy.value = false }
}

async function dropRelation(relationId) {
  if (!current.value) return
  busy.value = true
  try {
    await api.removeFactionRelation(relationId)
    applyResult(await api.getFaction(current.value.id))
  } catch (err) { loadError.value = err?.message || '移除失败' } finally { busy.value = false }
}

async function loadPromptPreview() {
  promptLoading.value = true
  try {
    const r = await api.getFactionPromptBlock()
    promptPreview.value = r.empty ? '（还没有登记派系 —— 这一段不会出现，行为与从前一致）' : (r.text || '')
  } catch (err) { loadError.value = err?.message || '预览失败' } finally { promptLoading.value = false }
}

watch(open, v => { if (v) load() })
</script>

<style scoped>
.fl { display: flex; gap: 18px; min-height: 420px; }
.fl-list { width: 210px; flex: 0 0 210px; border-right: 1px solid var(--glass-border); padding-right: 12px; }
.fl-list-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: var(--fs-sm); font-weight: 600; }
.fl-ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; max-height: 62vh; overflow-y: auto; }
.fl-item { display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--fs-sm); }
.fl-item:hover { background: rgba(var(--accent-rgb), .08); }
.fl-item.is-active { background: rgba(var(--accent-rgb), .16); color: var(--text-bright); font-weight: 600; }
.fl-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-secondary); flex: none; }
.fl-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fl-count { font-size: var(--fs-xs); color: var(--text-secondary); }

.fl-detail { flex: 1; min-width: 0; }
.fl-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.fl-name { margin: 0; font-size: var(--fs-md); color: var(--text-bright); }
.fl-chip { font-size: var(--fs-xs); padding: 1px 7px; border-radius: 999px; border: 1px solid var(--glass-border); color: var(--text-secondary); }
.fl-chip.is-strong { color: #c62828; border-color: #c62828; }
.fl-chip.is-weak { color: #6b7280; border-color: #9ca3af; }
.fl-chip.is-new { color: #2e7d32; border-color: #2e7d32; }
.fl-chip.is-ally { color: #2e7d32; border-color: #2e7d32; }
.fl-chip.is-cold { color: #6b7280; border-color: #9ca3af; }
.fl-chip.is-enemy { color: #c62828; border-color: #c62828; }

/* 成员头像（图文） */
.fl-av {
  width: 26px; height: 26px; border-radius: 50%; flex: none;
  background-color: rgba(var(--accent-rgb), .18); background-size: cover; background-position: center;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: var(--fs-xs); color: var(--text-bright); overflow: hidden;
}
.fl-stack { display: flex; align-items: center; margin-left: 4px; }
.fl-av--sm { width: 22px; height: 22px; border: 2px solid var(--bg-panel, #fff); margin-left: -7px; }
.fl-av--sm:first-child { margin-left: 0; }
.fl-av-more { font-size: var(--fs-xs); color: var(--text-secondary); margin-left: 5px; }

.fl-form { display: flex; flex-direction: column; gap: 9px; }
.fl-row { display: flex; gap: 10px; }
.fl-row > * { flex: 1; min-width: 0; }
.fl-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-xs); color: var(--text-secondary); }

/* 权力支柱：只显示"已输入"的标签（可点删）+ 输入框。不再有建议值标签 —— 见模板注释 */
.fl-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.fl-tag {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: var(--fs-xs); padding: 2px 9px; border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(var(--accent-rgb), .5);
  background: rgba(var(--accent-rgb), .16); color: var(--text-bright); font-weight: 600;
}
.fl-tag:hover { border-color: var(--accent); }
.fl-tag-x { font-style: normal; opacity: .55; font-size: 11px; line-height: 1; }
.fl-tag:hover .fl-tag-x { opacity: 1; }
.fl-opt { font-weight: 400; opacity: .75; }
.fl-tag-input {
  font-size: var(--fs-xs); padding: 2px 9px; border-radius: 999px; width: 96px;
  border: 1px dashed var(--glass-border); background: transparent; color: var(--text);
}
.fl-tag-input:focus { outline: none; border-color: var(--accent); border-style: solid; }

.fl-actions { display: flex; gap: 8px; margin: 12px 0 4px; }
.fl-sec { display: flex; align-items: center; gap: 10px; margin: 16px 0 8px; }
.fl-sub { margin: 0; font-size: var(--fs-sm); color: var(--text-bright); }
.fl-sub em { font-style: normal; color: var(--text-secondary); font-size: var(--fs-xs); margin-left: 4px; }
.fl-hint { font-size: var(--fs-xs); color: var(--text-secondary); margin: 6px 0 0; }

.fl-picker { padding: 10px; border: 1px solid var(--glass-border); border-radius: 10px; margin-bottom: 8px; }
/* 候选分类（未归档 / 各文件夹 / 归档）——与酒馆页的文件夹 chip 同一视觉语汇 */
.fl-scopes { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.fl-scope {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--glass-border); background: transparent;
  color: var(--text-secondary); font-family: inherit; font-size: 11.5px;
  transition: color .15s ease, border-color .15s ease, background .15s ease;
}
.fl-scope:hover { color: var(--accent); border-color: var(--accent); }
.fl-scope.on { color: #fff; background: var(--accent-solid); border-color: transparent; }
.fl-scope.is-arch { border-style: dashed; }
.fl-scope-n { font-size: 10px; opacity: .8; font-variant-numeric: tabular-nums; }
.fl-hidden-tip { font-size: 11px; color: var(--text-secondary); margin: 6px 0 0; line-height: 1.6; }
.fl-hidden-link {
  margin-left: 6px; padding: 0; border: none; background: none;
  color: var(--accent); font-family: inherit; font-size: 11px; cursor: pointer; text-decoration: underline;
}
.fl-pick-arch {
  font-size: 9.5px; padding: 0 6px; border-radius: 999px;
  background: rgba(0, 0, 0, .07); color: var(--text-secondary); user-select: none;
}
.fl-pick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px; margin-top: 8px; max-height: 210px; overflow-y: auto; }
.fl-pick { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 8px 4px; border: 1px solid transparent; border-radius: 10px; background: transparent; cursor: pointer; }
.fl-pick:hover:not(:disabled) { background: rgba(var(--accent-rgb), .08); }
.fl-pick.is-in { opacity: .4; cursor: default; }
.fl-pick-name { font-size: var(--fs-xs); color: var(--text); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── 成员卡片（与 TavernView 的 .char-card 同一视觉语汇）──
   glass 背景 + 16px 圆角 + 圆形头像 + 网格；不全宽铺满，跟随容器自适应列数。 */
.fl-mcards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 10px;
}
.fl-mcard {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 14px 8px 10px;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
}
.fl-mcard.is-archived { opacity: .6; }
.fl-mcard-av {
  width: 52px; height: 52px; border-radius: 50%; flex: none;
  background-color: rgba(var(--accent-rgb), .18); background-size: cover; background-position: center;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: var(--fs-md); font-weight: 700; color: var(--text-bright); overflow: hidden;
}
.fl-mcard-name {
  font-size: var(--fs-sm); font-weight: 600; color: var(--text-bright);
  text-align: center; line-height: 1.3; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fl-mcard-arch {
  font-size: 10px; padding: 0 7px; border-radius: var(--radius-full);
  background: rgba(0, 0, 0, .07); color: var(--text-secondary); user-select: none;
}
.fl-mcard-role {
  width: 100%; box-sizing: border-box; text-align: center;
  font-size: var(--fs-xs); padding: 3px 8px; border-radius: 999px;
  border: 1px solid var(--glass-border); background: transparent; color: var(--text);
}
.fl-mcard-role:focus { outline: none; border-color: var(--accent); }
.fl-mcard-drop {
  margin-top: 2px; padding: 2px 12px; border-radius: var(--radius-full);
  border: 1px solid var(--glass-border); background: transparent;
  color: var(--text-secondary); font-size: 11px; cursor: pointer;
  transition: border-color .15s ease, color .15s ease;
}
.fl-mcard-drop:hover:not(:disabled) { border-color: var(--danger, #c62828); color: var(--danger, #c62828); }
.fl-mcard-drop:disabled { opacity: .5; cursor: default; }

.fl-rels { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.fl-rels li { display: flex; align-items: center; gap: 9px; font-size: var(--fs-sm); }
.fl-rel-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fl-rel-chip { font-size: var(--fs-xs); padding: 1px 7px; border-radius: 999px; border: 1px solid var(--glass-border); }
.fl-rel-chip.is-ally { color: #2e7d32; border-color: #2e7d32; }
.fl-rel-chip.is-enemy { color: #c62828; border-color: #c62828; }
.fl-rel-chip.is-vassal { color: #6a4bbd; border-color: #6a4bbd; }

.fl-foot { margin-top: 18px; }
.fl-prompt {
  margin-top: 8px; padding: 10px 12px; border-radius: 10px;
  background: rgba(0, 0, 0, .04); border: 1px solid var(--glass-border);
  font-size: var(--fs-xs); line-height: 1.65; color: var(--text-secondary);
  white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow: auto;
}
.fl-empty { color: var(--text-secondary); font-size: var(--fs-sm); text-align: center; padding: 40px 0; }
.fl-warn { font-size: var(--fs-xs); color: var(--danger, #c62828); margin: 6px 0; }

@media (max-width: 767px) {
  .fl { flex-direction: column; }
  .fl-list { width: 100%; flex: none; border-right: none; border-bottom: 1px solid var(--glass-border); padding: 0 0 10px; }
}
</style>
