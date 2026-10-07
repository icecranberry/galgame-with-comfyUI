<template>
  <linshe-modal v-model="open" title="派系与组织" full body-class="faction-body">
    <div class="faction-layout">
      <!-- ── 左：派系列表 ── -->
      <aside class="faction-list">
        <div class="faction-list-head">
          <span class="faction-list-title">派系 ({{ items.length }})</span>
          <linshe-button size="sm" variant="secondary" :disabled="!ready" @click="startCreate">＋新建</linshe-button>
        </div>

        <p v-if="loadError" class="faction-note faction-note--warn">{{ loadError }}</p>

        <ul class="faction-ul">
          <li
            v-for="f in items"
            :key="f.id"
            class="faction-item"
            :class="{ 'is-active': current && current.id === f.id }"
            role="button"
            tabindex="0"
            @click="select(f)"
            @keyup.enter="select(f)"
          >
            <span class="faction-dot" :style="f.color ? { background: f.color } : undefined"></span>
            <span class="faction-item-name">{{ f.name }}</span>
            <span class="faction-type-chip">{{ f.type }}</span>
            <span class="faction-item-count">{{ f.memberCount }}</span>
          </li>
        </ul>

        <p v-if="!items.length && !loadError" class="faction-empty">
          <span class="empty-title">还没有派系</span>
          <span class="empty-hint">点「＋新建」登记这个世界的第一个组织</span>
        </p>
      </aside>

      <!-- ── 右：派系档案 ── -->
      <section class="faction-detail">
        <!-- 新建态 -->
        <template v-if="creating">
          <h4 class="faction-h">新建派系</h4>
          <div class="faction-form">
            <label class="faction-field">
              <span>名称</span>
              <linshe-input v-model="draft.name" size="sm" placeholder="例：市政厅 / 商会 / 同乡会" />
            </label>
            <label class="faction-field">
              <span>类型</span>
              <linshe-select v-model="draft.type" size="sm" :options="typeOptions" />
            </label>
            <label class="faction-field">
              <span>上级组织</span>
              <linshe-select v-model="draft.parentId" size="sm" :options="parentOptions" />
            </label>
            <label class="faction-field faction-field--wide">
              <span>一句话概述</span>
              <linshe-input v-model="draft.summary" size="sm" placeholder="一句话定位：它是什么、在做什么" />
            </label>
          </div>
          <div class="faction-actions">
            <linshe-button size="sm" variant="primary" :disabled="busy || !draft.name.trim()" @click="submitCreate">创建</linshe-button>
            <linshe-button size="sm" variant="ghost" :disabled="busy" @click="creating = false">取消</linshe-button>
          </div>
        </template>

        <!-- 档案态 -->
        <template v-else-if="current">
          <h4 class="faction-h">
            {{ current.name }}
            <span class="faction-type-chip">{{ current.type }}</span>
            <span class="faction-status-chip" :class="statusClass(current.status)">{{ current.status }}</span>
            <span class="faction-stance-chip" :class="stanceClass(current.stance)">对我：{{ current.stance }}</span>
            <span v-for="t in current.tags" :key="t" class="faction-tag-chip">{{ t }}</span>
          </h4>

          <div class="faction-form">
            <label class="faction-field">
              <span>名称</span>
              <linshe-input v-model="draft.name" size="sm" />
            </label>
            <label class="faction-field">
              <span>类型</span>
              <linshe-select v-model="draft.type" size="sm" :options="typeOptions" />
            </label>
            <label class="faction-field">
              <span>上级组织</span>
              <linshe-select v-model="draft.parentId" size="sm" :options="parentOptions" />
            </label>
            <label class="faction-field">
              <span>配色（可选）</span>
              <linshe-input v-model="draft.color" size="sm" placeholder="#a06cd5" />
            </label>
            <label class="faction-field">
              <span>势力范围</span>
              <linshe-input v-model="draft.scope" size="sm" placeholder="如：城北 / 全城 / 行踪不明" />
            </label>
            <label class="faction-field">
              <span>状态</span>
              <linshe-select v-model="draft.status" size="sm" :options="statusOptions" />
            </label>
            <label class="faction-field">
              <span>对我（玩家）的态度</span>
              <linshe-select v-model="draft.stance" size="sm" :options="stanceOptions" />
            </label>
            <label class="faction-field faction-field--wide">
              <span>当下目标</span>
              <linshe-input v-model="draft.goal" size="sm" placeholder="它现在想干什么 —— 这对生成最有指导性" />
            </label>
            <label class="faction-field faction-field--wide">
              <span>权力支柱（小标签，顿号分隔，最多 8 个）</span>
              <linshe-input v-model="tagsText" size="sm" list="faction-pillars" placeholder="如：武力威慑、财力雄厚、情报网络" />
            </label>
            <label class="faction-field faction-field--wide">
              <span>概述</span>
              <linshe-input v-model="draft.summary" size="sm" placeholder="一句话定位" />
            </label>
            <label class="faction-field faction-field--wide">
              <span>详述（理念与目标）</span>
              <linshe-input v-model="draft.description" type="textarea" :rows="4" placeholder="核心理念、终极目标、行动方式…" />
            </label>
          </div>
          <datalist id="faction-pillars">
            <option v-for="p in meta.pillarSuggestions" :key="p" :value="p" />
          </datalist>
          <div class="faction-actions">
            <linshe-button size="sm" variant="primary" :disabled="busy || !dirty" @click="saveFaction">保存</linshe-button>
            <linshe-button size="sm" variant="ghost" :disabled="busy || !dirty" @click="resetDraft">重置</linshe-button>
            <linshe-button size="sm" variant="danger" :disabled="busy" @click="confirmDelete">删除派系</linshe-button>
          </div>

          <!-- 组织架构 -->
          <h5 class="faction-sub">组织架构（{{ current.memberCount }} 名在册<span v-if="current.archivedMemberCount">，{{ current.archivedMemberCount }} 名已归档</span>）</h5>
          <table class="faction-table">
            <thead><tr><th>角色</th><th>职务</th><th>等级</th><th></th></tr></thead>
            <tbody>
              <tr v-for="m in current.members" :key="m.id" :class="{ 'is-archived': m.archived }">
                <td>{{ m.display_name }}<span v-if="m.archived" class="faction-archived-tag">已归档</span></td>
                <td>{{ m.role }}</td>
                <td>{{ m.rank }}</td>
                <td class="faction-td-act">
                  <linshe-button size="sm" variant="ghost" :disabled="busy" @click="dropMember(m.id)">移除</linshe-button>
                </td>
              </tr>
              <tr v-if="!current.members.length"><td colspan="4" class="faction-empty-row">还没有成员</td></tr>
            </tbody>
          </table>
          <div class="faction-inline-form">
            <linshe-select v-model="memberDraft.characterId" size="sm" searchable :options="characterOptions" placeholder="选角色" />
            <linshe-input v-model="memberDraft.role" size="sm" :placeholder="rolePlaceholder" list="faction-roles" />
            <linshe-input v-model.number="memberDraft.rank" size="sm" type="number" min="0" max="9" placeholder="等级" />
            <linshe-button size="sm" variant="secondary" :disabled="busy || !memberDraft.characterId" @click="submitMember">加入</linshe-button>
          </div>
          <datalist id="faction-roles">
            <option v-for="r in meta.roleSuggestions" :key="r" :value="r" />
          </datalist>

          <!-- 势力关系 -->
          <h5 class="faction-sub">与其他势力的关系</h5>
          <table class="faction-table">
            <thead><tr><th>对象</th><th>关系</th><th>强度</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in current.relations" :key="r.id">
                <td>{{ r.toName }}</td>
                <td><span class="faction-rel-chip" :class="relClass(r.relation)">{{ r.relation }}</span></td>
                <td>{{ r.strength }}</td>
                <td class="faction-td-act">
                  <linshe-button size="sm" variant="ghost" :disabled="busy" @click="dropRelation(r.id)">移除</linshe-button>
                </td>
              </tr>
              <tr v-if="!current.relations.length"><td colspan="4" class="faction-empty-row">还没有登记关系</td></tr>
            </tbody>
          </table>
          <div class="faction-inline-form">
            <linshe-select v-model="relationDraft.toId" size="sm" searchable :options="otherFactionOptions" placeholder="选对方派系" />
            <linshe-select v-model="relationDraft.relation" size="sm" :options="relationOptions" />
            <linshe-input v-model.number="relationDraft.strength" size="sm" type="number" min="0" max="100" placeholder="强度" />
            <linshe-button size="sm" variant="secondary" :disabled="busy || !relationDraft.toId" @click="submitRelation">登记</linshe-button>
          </div>

          <!-- 给 LLM 的创意写作指导（只读预览 —— 真正是否注入由各功能的开关决定） -->
          <h5 class="faction-sub">给 LLM 的创意写作指导</h5>
          <div class="faction-inline-form">
            <linshe-button size="sm" variant="secondary" :disabled="promptLoading" @click="loadPromptPreview">预览「势力态势」提示词</linshe-button>
            <span class="faction-note">状态 / 立场 / 支柱 / 当下目标 都会被写进这一段</span>
          </div>
          <pre v-if="promptPreview" class="faction-prompt">{{ promptPreview }}</pre>
        </template>

        <p v-else class="faction-empty">
          <span class="empty-title">选一个派系看档案</span>
          <span class="empty-hint">左侧点选，或新建一个</span>
        </p>
      </section>
    </div>
  </linshe-modal>
</template>

<script setup>
// 「派系与组织」—— 酒馆页第三块（2026-10-07）。
// 与「我的关系图」（人↔人）和「世界观设置」（背景）并列：本模块看**势力格局**（势力↔势力、人↔势力）。
// ⚠ 与「角色文件夹」不同：文件夹是用户侧分类（单层/手动），派系是世界观侧归属（可层级/多对多/有职务）。
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
const meta = reactive({ types: [], relations: [], statuses: [], stances: [], roleSuggestions: [], pillarSuggestions: [], defaultVisibleRelations: [] })
const draft = reactive({ name: '', type: '其他', parentId: '', summary: '', description: '', color: '', scope: '', status: '稳固', stance: '中立', goal: '', tags: [] })
const memberDraft = reactive({ characterId: '', role: '', rank: 5 })
const relationDraft = reactive({ toId: '', relation: '同盟', strength: 50 })
const promptPreview = ref('')
const promptLoading = ref(false)

const typeOptions = computed(() => (meta.types.length ? meta.types : ['其他']).map(t => ({ label: t, value: t })))
const relationOptions = computed(() => (meta.relations.length ? meta.relations : ['同盟']).map(r => ({ label: r, value: r })))
const parentOptions = computed(() => [
  { label: '（无 / 顶级）', value: '' },
  ...items.value.filter(f => !current.value || f.id !== current.value.id).map(f => ({ label: f.name, value: f.id })),
])
const characterOptions = computed(() => props.characters.map(c => ({ label: c.display_name || c.name, value: c.id })))
const otherFactionOptions = computed(() => items.value
  .filter(f => !current.value || f.id !== current.value.id)
  .map(f => ({ label: `${f.name}（${f.type}）`, value: f.id })))
const rolePlaceholder = computed(() => (meta.roleSuggestions.length ? meta.roleSuggestions.slice(0, 3).join(' / ') : '职务'))
const statusOptions = computed(() => (meta.statuses.length ? meta.statuses : ['稳固']).map(s => ({ label: s, value: s })))
const stanceOptions = computed(() => (meta.stances.length ? meta.stances : ['中立']).map(s => ({ label: s, value: s })))
/** 权力支柱：顿号/逗号分隔的文本 ↔ 数组（存库是 JSON 数组） */
const tagsText = computed({
  get: () => (draft.tags || []).join('、'),
  set: v => { draft.tags = String(v || '').split(/[、,，;；|]/).map(s => s.trim()).filter(Boolean) },
})

const dirty = computed(() => {
  if (!current.value) return false
  const c = current.value
  return String(draft.name) !== c.name
    || draft.type !== c.type
    || String(draft.parentId ?? '') !== String(c.parentId ?? '')
    || draft.summary !== c.summary
    || draft.description !== c.description
    || draft.color !== (c.color || '')
    || draft.scope !== (c.scope || '')
    || draft.status !== (c.status || '稳固')
    || draft.stance !== (c.stance || '中立')
    || draft.goal !== (c.goal || '')
    || tagsText.value !== (c.tags || []).join('、')
})

function relClass(rel) {
  return { 'is-ally': rel === '同盟', 'is-enemy': rel === '敌对', 'is-vassal': rel === '从属' }
}

// 状态/立场的配色：鼎盛=旺、困顿/衰落=弱；友好=绿、冷淡=灰、敌对=红
function statusClass(s) {
  return { 'is-strong': s === '鼎盛', 'is-weak': s === '困顿' || s === '衰落', 'is-new': s === '新兴' }
}
function stanceClass(s) {
  return { 'is-ally': s === '友好', 'is-enemy': s === '敌对', 'is-cold': s === '冷淡' }
}

async function loadPromptPreview() {
  promptLoading.value = true
  try {
    const r = await api.getFactionPromptBlock()
    promptPreview.value = r.empty ? '（还没有登记派系 —— 这一段不会出现，行为与从前一致）' : (r.text || '')
  } catch (err) {
    loadError.value = err?.message || '预览失败'
  } finally {
    promptLoading.value = false
  }
}

function resetDraft() {
  const c = current.value
  if (!c) return
  draft.name = c.name
  draft.type = c.type
  draft.parentId = c.parentId ?? ''
  draft.summary = c.summary
  draft.description = c.description
  draft.color = c.color || ''
  draft.scope = c.scope || ''
  draft.status = c.status || '稳固'
  draft.stance = c.stance || '中立'
  draft.goal = c.goal || ''
  draft.tags = [...(c.tags || [])]
}

function select(f) {
  creating.value = false
  current.value = f
  resetDraft()
  memberDraft.characterId = ''
  memberDraft.role = ''
  memberDraft.rank = 5
  relationDraft.toId = ''
  relationDraft.relation = meta.relations[0] || '同盟'
  relationDraft.strength = 50
}

function startCreate() {
  creating.value = true
  current.value = null
  draft.name = ''
  draft.type = meta.types[0] || '其他'
  draft.parentId = ''
  draft.summary = ''
  draft.description = ''
  draft.color = ''
  draft.scope = ''
  draft.status = meta.statuses[0] || '稳固'
  draft.stance = '中立'
  draft.goal = ''
  draft.tags = []
}

async function load(preferId) {
  busy.value = true
  try {
    const [m, res] = await Promise.all([api.getFactionMeta(), api.listFactions()])
    Object.assign(meta, m)
    items.value = res.items || []
    ready.value = true
    loadError.value = ''
    const next = items.value.find(f => f.id === preferId) || items.value.find(f => f.id === current.value?.id) || items.value[0]
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
  const idx = items.value.findIndex(x => x.id === f.id)
  if (idx >= 0) items.value[idx] = f
  else items.value.push(f)
  current.value = f
  resetDraft()
  emit('changed')
}

async function submitCreate() {
  busy.value = true
  try {
    const f = await api.createFaction({
      name: draft.name.trim(),
      type: draft.type,
      parentId: draft.parentId === '' ? null : draft.parentId,
      summary: draft.summary,
      scope: draft.scope,
      status: draft.status,
      stance: draft.stance,
    })
    creating.value = false
    items.value.push(f)
    select(f)
    emit('changed')
  } catch (err) { loadError.value = err?.message || '创建失败' } finally { busy.value = false }
}

async function saveFaction() {
  if (!current.value) return
  busy.value = true
  try {
    const f = await api.updateFaction(current.value.id, {
      name: draft.name.trim(),
      type: draft.type,
      parentId: draft.parentId === '' ? null : draft.parentId,
      summary: draft.summary,
      description: draft.description,
      color: draft.color,
      scope: draft.scope,
      status: draft.status,
      stance: draft.stance,
      goal: draft.goal,
      tags: draft.tags,
    })
    applyResult(f)
  } catch (err) { loadError.value = err?.message || '保存失败' } finally { busy.value = false }
}

async function confirmDelete() {
  if (!current.value) return
  const name = current.value.name
  if (!window.confirm(`删除派系「${name}」？其成员与关系会一并清掉，子派系的上级会被置空。`)) return
  busy.value = true
  try {
    const id = current.value.id
    await api.deleteFaction(id)
    items.value = items.value.filter(x => x.id !== id)
    current.value = items.value[0] || null
    if (current.value) select(current.value)
    emit('changed')
  } catch (err) { loadError.value = err?.message || '删除失败' } finally { busy.value = false }
}

async function submitMember() {
  if (!current.value || !memberDraft.characterId) return
  busy.value = true
  try {
    const f = await api.addFactionMember(current.value.id, {
      characterId: memberDraft.characterId,
      role: memberDraft.role || '成员',
      rank: memberDraft.rank,
    })
    applyResult(f)
    memberDraft.characterId = ''
    memberDraft.role = ''
    memberDraft.rank = 5
  } catch (err) { loadError.value = err?.message || '加入失败' } finally { busy.value = false }
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
    const f = await api.upsertFactionRelation({
      fromId: current.value.id,
      toId: relationDraft.toId,
      relation: relationDraft.relation,
      strength: relationDraft.strength,
    })
    applyResult(f)
    relationDraft.toId = ''
    relationDraft.strength = 50
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

watch(open, v => { if (v) load() })
</script>

<style scoped>
.faction-layout { display: flex; gap: 16px; min-height: 420px; }
.faction-list { width: 232px; flex: 0 0 232px; border-right: 1px solid var(--glass-border); padding-right: 12px; }
.faction-list-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.faction-list-title { font-weight: 600; font-size: var(--fs-sm); }
.faction-ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 60vh; overflow-y: auto; }
.faction-item { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--fs-sm); }
.faction-item:hover { background: rgba(var(--accent-rgb), .08); }
.faction-item.is-active { background: rgba(var(--accent-rgb), .16); color: var(--text-bright); font-weight: 600; }
.faction-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-secondary); flex: none; }
.faction-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.faction-item-count { font-size: var(--fs-xs); color: var(--text-secondary); }
.faction-type-chip { font-size: var(--fs-xs); padding: 1px 6px; border-radius: 999px; border: 1px solid var(--glass-border); color: var(--text-secondary); flex: none; }
/* ── 态势小标签（状态 / 立场 / 权力支柱）── */
.faction-status-chip, .faction-stance-chip, .faction-tag-chip {
  font-size: var(--fs-xs); padding: 1px 6px; border-radius: 999px;
  border: 1px solid var(--glass-border); color: var(--text-secondary); flex: none;
}
.faction-status-chip.is-strong { color: #c62828; border-color: #c62828; }
.faction-status-chip.is-weak { color: #6b7280; border-color: #9ca3af; }
.faction-status-chip.is-new { color: #2e7d32; border-color: #2e7d32; }
.faction-stance-chip.is-ally { color: #2e7d32; border-color: #2e7d32; }
.faction-stance-chip.is-cold { color: #6b7280; border-color: #9ca3af; }
.faction-stance-chip.is-enemy { color: #c62828; border-color: #c62828; }
.faction-tag-chip { background: rgba(var(--accent-rgb), .12); color: var(--text-bright); border-color: transparent; }
.faction-prompt {
  margin-top: 8px; padding: 10px 12px; border-radius: 10px;
  background: rgba(0, 0, 0, .04); border: 1px solid var(--glass-border);
  font-size: var(--fs-xs); line-height: 1.65; color: var(--text-secondary);
  white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto;
}
.faction-detail { flex: 1; min-width: 0; }
.faction-h { margin: 0 0 10px; font-size: var(--fs-md); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.faction-sub { margin: 18px 0 8px; font-size: var(--fs-sm); color: var(--text-bright); }
.faction-form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.faction-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-xs); color: var(--text-secondary); }
.faction-field--wide { grid-column: 1 / -1; }
.faction-actions { display: flex; gap: 8px; margin-top: 12px; }
.faction-table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.faction-table th { text-align: left; font-weight: 500; color: var(--text-secondary); font-size: var(--fs-xs); padding: 4px 6px; }
.faction-table td { padding: 5px 6px; border-top: 1px solid var(--glass-border); }
.faction-td-act { text-align: right; }
.faction-empty-row { color: var(--text-secondary); font-size: var(--fs-xs); text-align: center; padding: 10px 0; }
.faction-inline-form { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.faction-inline-form > :first-child { flex: 1; min-width: 0; }
.faction-rel-chip { font-size: var(--fs-xs); padding: 1px 6px; border-radius: 999px; border: 1px solid var(--glass-border); }
.faction-rel-chip.is-ally { color: #2e7d32; border-color: #2e7d32; }
.faction-rel-chip.is-enemy { color: #c62828; border-color: #c62828; }
.faction-rel-chip.is-vassal { color: #6a4bbd; border-color: #6a4bbd; }
.faction-archived-tag { margin-left: 6px; font-size: var(--fs-xs); color: var(--text-secondary); }
.faction-table tr.is-archived { opacity: .55; }
.faction-note { font-size: var(--fs-xs); color: var(--text-secondary); margin: 6px 0; }
.faction-note--warn { color: var(--danger, #c62828); }
.faction-empty { display: flex; flex-direction: column; gap: 4px; align-items: center; justify-content: center; height: 100%; text-align: center; }
@media (max-width: 767px) {
  .faction-layout { flex-direction: column; }
  .faction-list { width: 100%; flex: none; border-right: none; border-bottom: 1px solid var(--glass-border); padding: 0 0 10px; }
  .faction-form { grid-template-columns: 1fr; }
}
</style>
