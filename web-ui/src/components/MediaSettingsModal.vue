<template>
  <linshe-modal :visible="modelValue" title="媒体设置" wide @close="close">
    <div class="ms-body">
      <p class="ms-intro">
        每个「媒体」是一个内容源（论坛 / 报纸 / 匿名社区 / 暗网 …），自带一份生成提示词；
        帖子由<b>该媒体的提示词 + 世界观</b>生成，<b>活跃角色会随机出现在帖子里</b>。
        <button type="button" class="ms-cleanup" :disabled="cleaning" @click="doCleanup">
          {{ cleaning ? '清理中…' : '清理孤儿配图' }}
        </button>
        <button type="button" class="ms-cleanup" @click="toggleOpLog">
          {{ showOpLog ? '收起操作日志' : '操作日志' }}
        </button>
      </p>

      <!-- 操作日志（T5/T7）：删除/创建/批量类的审计流水，供追溯"东西什么时候没的" -->
      <div v-if="showOpLog" class="ms-oplog">
        <div class="ms-oplog-head">
          <span class="ms-oplog-title">媒体操作日志</span>
          <span class="ms-oplog-sub">共 {{ opLogTotal }} 条 · 只记删除/创建等破坏性操作，不记浏览</span>
          <div style="flex:1"></div>
          <button type="button" class="ms-oplog-refresh" :disabled="opLogLoading" @click="loadOpLog">
            {{ opLogLoading ? '读取中…' : '刷新' }}
          </button>
        </div>
        <div v-if="opLog.length" class="ms-oplog-list">
          <div v-for="op in opLog" :key="op.id" class="ms-oplog-row" :class="'is-' + op.op_type">
            <span class="ms-oplog-badge">{{ opBadge(op.op_type) }}</span>
            <span class="ms-oplog-main">
              <span class="ms-oplog-detail">{{ op.detail || op.target_name }}</span>
              <span class="ms-oplog-meta">
                {{ op.target_name }}
                <template v-if="op.outlet_name && op.outlet_name !== op.target_name"> · {{ op.outlet_name }}</template>
                <template v-if="op.count > 1"> · {{ op.count }} 条</template>
              </span>
            </span>
            <span class="ms-oplog-time">{{ formatOpTime(op.created_at) }}</span>
          </div>
        </div>
        <div v-else class="ms-oplog-empty">{{ opLogLoading ? '读取中…' : '还没有操作记录' }}</div>
      </div>

      <div class="ms-layout">
        <!-- 左：媒体列表 -->
        <div class="ms-list">
          <div class="ms-list-head">
            <span>媒体</span>
            <button type="button" class="ms-add" @click="startCreate">＋ 新建</button>
          </div>
          <button
            v-for="o in list"
            :key="o.id"
            type="button"
            class="ms-item"
            :class="{ active: o.id === editingId, off: !o.enabled }"
            @click="selectOutlet(o)"
          >
            <span class="ms-item-icon">{{ o.icon || '📄' }}</span>
            <span class="ms-item-main">
              <span class="ms-item-name">{{ o.name }}</span>
              <span class="ms-item-sub">
                <!-- 形态徽标：两种产物差别很大，列表里标出来才好分辨 -->
                <span class="ms-item-layout" :class="{ portal: o.layout === 'portal' }">{{ layoutShortLabel(o.layout) }}</span>
                {{ o.board_count }} 板块 · {{ o.post_count }} 帖
              </span>
            </span>
          </button>
        </div>

        <!-- 右：编辑区 -->
        <div class="ms-form">
          <div v-if="!form" class="ms-form-empty">左侧选一个媒体，或点「新建」</div>

          <template v-else>
            <div class="ms-row">
              <label class="ms-label">名称</label>
              <linshe-input v-model="form.name" class="fi" maxlength="24" placeholder="如「网络热门」" />
            </div>

            <!-- 形态：两种产物的**生成与展示方式完全不同**，所以新建时必须显式选，不能默认混同 -->
            <div class="ms-row">
              <label class="ms-label">形态</label>
              <linshe-select
                v-model="form.layout"
                :options="layoutOptions"
                class="fi"
                aria-label="媒体形态"
              />
              <p class="ms-field-hint">{{ layoutHint }}</p>
              <p v-if="layoutChangeWarn" class="ms-field-warn">{{ layoutChangeWarn }}</p>
            </div>

            <div class="ms-row">
              <label class="ms-label">图标</label>
              <linshe-input v-model="form.icon" class="fi ms-icon-input" maxlength="4" placeholder="一个 emoji" />
              <label class="ms-label ms-switch-label">启用</label>
              <linshe-switch v-model="form.enabled" aria-label="启用该媒体" />
            </div>
            <div class="ms-row">
              <label class="ms-label">定位</label>
              <linshe-input v-model="form.tagline" class="fi" maxlength="60" placeholder="一句话说明这是什么内容源" />
            </div>
            <div class="ms-row">
              <label class="ms-label">生成提示词（这个媒体的角色设定 / 风格 / 规则）</label>
              <linshe-input
                v-model="form.prompt"
                type="textarea"
                class="fi ms-prompt"
                rows="10"
                placeholder="描述这个媒体的身份、内容风格、规则与写作要求。生成帖子时会把它作为 system 提示词注入。"
              />
            </div>

            <!-- 板块 -->
            <div class="ms-boards">
              <div class="ms-boards-head">
                <label class="ms-label">板块</label>
                <span class="ms-boards-hint">帖子会按板块分区</span>
              </div>
              <div v-if="boards.length" class="ms-board-chips">
                <span v-for="b in boards" :key="b.id" class="ms-board-chip">
                  <input
                    class="ms-board-input"
                    :value="b.name"
                    maxlength="16"
                    @change="renameBoard(b, $event.target.value)"
                  />
                  <button type="button" class="ms-board-del" title="删除板块" @click="removeBoard(b)">✕</button>
                </span>
              </div>
              <div v-else class="ms-board-empty">还没有板块（帖子会归到「未分类」）</div>
              <div class="ms-board-add">
                <linshe-input
                  v-model="newBoardName"
                  class="fi"
                  maxlength="16"
                  placeholder="新板块名"
                  @keyup.enter="addBoard"
                />
                <linshe-button variant="secondary" :disabled="!newBoardName.trim() || !editingId" @click="addBoard">添加</linshe-button>
              </div>
            </div>

            <div class="ms-actions">
              <linshe-button
                v-if="!isNew"
                variant="danger"
                :disabled="saving"
                @click="removeOutlet"
              >删除媒体</linshe-button>
              <div style="flex:1"></div>
              <linshe-button variant="secondary" :disabled="saving" @click="selectOutlet(null)">取消</linshe-button>
              <linshe-button variant="primary" :loading="saving" :disabled="!canSave" @click="save">
                {{ isNew ? '创建' : '保存' }}
              </linshe-button>
            </div>
            <p v-if="isNew" class="ms-new-hint">新建后即可在右侧继续添加板块。</p>
          </template>
        </div>
      </div>
    </div>
  </linshe-modal>
</template>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheSelect from './ui/LinsheSelect.vue'
import LinsheSwitch from './ui/LinsheSwitch.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 父级已有的媒体列表；本组件改动后通过 changed 事件让父级重取 */
  outlets: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'changed'])

const toastFn = inject('toast')
const list = ref([])
const boards = ref([])
const editingId = ref(null)
const isNew = ref(false)
const saving = ref(false)
const newBoardName = ref('')
const form = ref(null)

/**
 * 可选的媒体形态。
 *
 * 先用一份**静态兜底**，挂载后再向 `/media/layouts` 取权威清单 —— 这样：
 *   · 后端是旧代码（没这个接口）时，弹窗仍可用（不会因为拿不到选项而空掉）；
 *   · 后端加了新形态时，界面自动跟上，不用改前端。
 */
const FALLBACK_LAYOUTS = [
  { key: 'feed', label: '社交平台', hint: '一批独立帖子（瀑布流）· 一次生成多条' },
  { key: 'forum', label: '网络论坛', hint: '版聊主题帖（标题 + 正文 + 楼层回复）· 文字为主、少量图片' },
  { key: 'photos', label: '图片站（全年龄）', hint: '城市风光 / 美少女自拍 / 美食打卡 / 宣传海报 · 画面确定性生成' },
  { key: 'gallery', label: '图片站（成人）', hint: '图集条目 · 每条随机画师串与题材组合' },
  { key: 'portal', label: '数字报刊', hint: '按「期」出刊：门户版 + 板块正文（点开才生成）' },
  { key: 'poster', label: '海报', hint: '一张只讲一个瓜：热点速报条 → 大标题 → 主图 → 短文案' },
]
const layoutDefs = ref([...FALLBACK_LAYOUTS])
const layoutOptions = computed(() => layoutDefs.value.map(l => ({ label: l.label, value: l.key })))

function currentLayoutDef(key) {
  return layoutDefs.value.find(l => l.key === key) || FALLBACK_LAYOUTS[0]
}
/**
 * 列表里的形态短标签。
 *
 * ★ **从后端下发的权威清单派生**（`/media/layouts`），取不到才落到下面的兜底。
 *
 *   这里原本是 `if (portal) … if (weekly) … if (poster) … return '社交平台'` 的链式写法 ——
 *   新增 `forum` / `gallery` 两个形态时**漏改这里**，于是「二相论坛」「规则34」
 *   在列表里被**静默显示成「社交平台」**。
 *   这正是项目红线警告过的「同一口径只留一份定义」/「其余全归最后一档」，只是换了个文件复发。
 *
 *   兜底用**原始 key**（如 `forum`）而不是某个猜的标签：显示成英文键很扎眼，
 *   一眼就知道是"没对上"，不会被误当成正确分类。
 */
const LEGACY_LAYOUT_LABELS = { weekly: '周刊' }   // 历史形态，已不在新建列表里
function layoutShortLabel(key) {
  const hit = layoutDefs.value.find(l => l.key === key)
  if (hit?.label) return hit.label
  return LEGACY_LAYOUT_LABELS[key] || key || '未知形态'
}
/** 选中形态的说明（讲清产物差别，避免建错源） */
const layoutHint = computed(() => currentLayoutDef(form.value?.layout)?.hint || '')

/**
 * 改形态的提醒：**已有帖子时**换形态，旧帖子仍按原形态渲染，
 * 新内容才按新形态生成 —— 这是"混着两种产物"的中间状态，必须让用户知情。
 */
const layoutChangeWarn = computed(() => {
  if (isNew.value) return ''
  const o = list.value.find(x => x.id === editingId.value)
  if (!o || !form.value) return ''
  if ((o.layout || 'feed') === form.value.layout) return ''
  const n = o.post_count || 0
  return n
    ? `该媒体已有 ${n} 条内容 —— 改形态后，旧内容仍按原形态展示，只有新生成的才用新形态。`
    : '该媒体还没有内容，现在改形态没有副作用。'
})

const canSave = computed(() => !!form.value?.name?.trim() && !!form.value?.prompt?.trim())

watch(() => props.outlets, v => { list.value = [...(v || [])] }, { immediate: true, deep: true })

watch(() => props.modelValue, v => {
  if (v) { list.value = [...(props.outlets || [])]; editingId.value = null; form.value = null; boards.value = []; loadLayouts() }
})

onMounted(loadLayouts)

async function loadLayouts() {
  try {
    const d = await api.listMediaLayouts()
    const arr = Array.isArray(d?.layouts) ? d.layouts : []
    if (arr.length) layoutDefs.value = arr
  } catch {
    // 拿不到就用兜底（旧后端没有该接口）—— 不打断弹窗使用
    layoutDefs.value = [...FALLBACK_LAYOUTS]
  }
}

function close() { emit('update:modelValue', false) }

/**
 * 清理未被引用的孤儿配图。
 * 来源是早期「同一帖子被重复生图」留下的存量；现已加 CAS 防护不会再产生新的，
 * 这个入口用于把历史遗留清干净（服务启动后也会自动清一次）。
 */
const cleaning = ref(false)
async function doCleanup() {
  if (cleaning.value) return
  cleaning.value = true
  try {
    const r = await api.cleanupMediaImages()
    toastFn?.(`已清理 ${r.removed} 个孤儿配图${r.staleReset ? `，重置 ${r.staleReset} 条卡住的生成` : ''}`, 'success')
  } catch (err) {
    toastFn?.('清理失败' + '：' + (err?.message || ''), 'error')
  } finally {
    cleaning.value = false
  }
}

// ── 操作日志（T5/T7）──
// 删除/创建/批量类操作的审计流水。用于回答"某条内容/某个媒体是什么时候没的"。
const showOpLog = ref(false)
const opLog = ref([])
const opLogTotal = ref(0)
const opLogLoading = ref(false)

const OP_BADGES = {
  create: '新建', delete: '删除', batch_delete: '批量删',
  batch_regenerate: '重生图', cleanup: '清理', unknown: '其他',
}
function opBadge(t) { return OP_BADGES[t] || t || '其他' }
/** 时间显示：只到分钟，避免日志行过宽 */
function formatOpTime(s) {
  if (!s) return ''
  // 后端存的是 SQLite CURRENT_TIMESTAMP（UTC），转成本地时区展示
  try {
    const d = new Date(String(s).replace(' ', 'T') + 'Z')
    if (Number.isNaN(d.getTime())) return String(s)
    const p = n => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  } catch { return String(s) }
}
async function loadOpLog() {
  opLogLoading.value = true
  try {
    const d = await api.listMediaOpLog({ limit: 100 })
    opLog.value = Array.isArray(d?.ops) ? d.ops : []
    opLogTotal.value = Number(d?.total) || opLog.value.length
  } catch (err) {
    toastFn?.('读取操作日志失败：' + (err?.message || ''), 'error')
    opLog.value = []
  } finally {
    opLogLoading.value = false
  }
}
function toggleOpLog() {
  showOpLog.value = !showOpLog.value
  if (showOpLog.value && !opLog.value.length) loadOpLog()
}

async function selectOutlet(o) {
  if (!o) { editingId.value = null; form.value = null; boards.value = []; isNew.value = false; return }
  editingId.value = o.id
  isNew.value = false
  form.value = {
    name: o.name, icon: o.icon || '', tagline: o.tagline || '',
    prompt: o.prompt || '', enabled: !!o.enabled,
    // 形态：老数据可能没有该字段（历史默认 feed）—— 与后端 normalizeLayout 同口径
    layout: o.layout || 'feed',
  }
  await reloadBoards()
}

function startCreate() {
  editingId.value = null
  isNew.value = true
  boards.value = []
  // 新建默认「社交平台」：它是历史默认值，也是最常用的形态；但用户在保存前必须能看到并改它
  form.value = { name: '', icon: '', tagline: '', prompt: '', enabled: true, layout: 'feed' }
}

async function reloadBoards() {
  if (!editingId.value) { boards.value = []; return }
  try {
    const d = await api.listMediaBoards(editingId.value)
    boards.value = d.boards || []
  } catch (err) {
    console.error('[media-settings] 读取板块失败:', err)
    boards.value = []
  }
}

async function save() {
  if (!canSave.value || saving.value) return
  saving.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      icon: form.value.icon.trim(),
      tagline: form.value.tagline.trim(),
      prompt: form.value.prompt.trim(),
      enabled: form.value.enabled,
      // 形态：新建时决定产物格式；编辑时允许改（改了只影响**新生成**的内容）
      layout: form.value.layout || 'feed',
    }
    if (isNew.value) {
      const created = await api.createMediaOutlet(payload)
      editingId.value = created.id
      isNew.value = false
      toastFn?.('媒体已创建', 'success')
    } else {
      await api.updateMediaOutlet(editingId.value, payload)
      toastFn?.('已保存', 'success')
    }
    await refreshList()
    emit('changed')
  } catch (err) {
    console.error('[media-settings] 保存失败:', err)
    toastFn?.('保存失败：' + (err?.message || ''), 'error')
  } finally {
    saving.value = false
  }
}

async function removeOutlet() {
  const name = form.value?.name || ''
  const ok = window.confirm(`确定删除「${name}」吗？\n该媒体下的板块与所有帖子会一并删除，且不可恢复。`)
  if (!ok) return
  try {
    await api.deleteMediaOutlet(editingId.value)
    editingId.value = null
    form.value = null
    boards.value = []
    toastFn?.('媒体已删除', 'success')
    await refreshList()
    emit('changed')
  } catch (err) {
    toastFn?.('删除失败：' + (err?.message || ''), 'error')
  }
}

async function refreshList() {
  try {
    const d = await api.listMediaOutlets()
    list.value = d.outlets || []
  } catch { /* 忽略 */ }
}

// ── 板块 ──
async function addBoard() {
  const name = newBoardName.value.trim()
  if (!name || !editingId.value) return
  try {
    await api.createMediaBoard(editingId.value, { name })
    newBoardName.value = ''
    await reloadBoards()
    await refreshList()
    emit('changed')
  } catch (err) {
    toastFn?.('添加失败：' + (err?.message || ''), 'error')
  }
}

async function renameBoard(b, name) {
  const nm = String(name || '').trim()
  if (!nm || nm === b.name) return
  try {
    await api.updateMediaBoard(b.id, { name: nm })
    await reloadBoards()
  } catch (err) {
    toastFn?.('改名失败：' + (err?.message || ''), 'error')
    await reloadBoards()
  }
}

async function removeBoard(b) {
  const ok = window.confirm(`删除板块「${b.name}」？\n该板块下的帖子不会被删除，只是变成未分类。`)
  if (!ok) return
  try {
    await api.deleteMediaBoard(b.id)
    await reloadBoards()
    await refreshList()
    emit('changed')
  } catch (err) {
    toastFn?.('删除失败：' + (err?.message || ''), 'error')
  }
}
</script>

<style scoped>
.ms-body { display: flex; flex-direction: column; gap: 12px; }
.ms-intro { margin: 0; font-size: 12px; line-height: 1.7; color: var(--text-secondary); }
.ms-intro b { color: var(--text-primary); }
/* 就地放一个轻量清理入口，不占独立一行 */
.ms-cleanup {
  margin-left: 6px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--glass-border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-family: inherit; font-size: 11px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.ms-cleanup:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.ms-cleanup:disabled { opacity: 0.5; cursor: default; }

/* 操作日志（T5/T7）—— 审计流水面板 */
.ms-oplog {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px; border-radius: 10px;
  background: var(--bg-tertiary); border: 1px solid var(--glass-border);
}
.ms-oplog-head { display: flex; align-items: baseline; gap: 8px; }
.ms-oplog-title { font-size: 12px; font-weight: 600; color: var(--text-bright); }
.ms-oplog-sub { font-size: 10px; color: var(--text-secondary); }
.ms-oplog-refresh {
  border: 1px solid var(--glass-border); background: var(--bg-secondary);
  color: var(--text-secondary); font-family: inherit; font-size: 11px;
  padding: 2px 8px; border-radius: 6px; cursor: pointer;
}
.ms-oplog-refresh:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.ms-oplog-refresh:disabled { opacity: 0.5; cursor: default; }
.ms-oplog-list { display: flex; flex-direction: column; gap: 3px; max-height: 220px; overflow-y: auto; }
.ms-oplog-row {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 7px; border-radius: 7px;
  background: var(--bg-secondary);
  font-size: 11px;
}
.ms-oplog-badge {
  flex-shrink: 0; padding: 1px 6px; border-radius: 4px;
  font-weight: 600; font-size: 10px;
  background: var(--glass-bg); color: var(--text-secondary);
}
/* 删除类用警示色，创建类用强调色 —— 一眼分清"是不是没了" */
.ms-oplog-row.is-delete .ms-oplog-badge,
.ms-oplog-row.is-batch_delete .ms-oplog-badge,
.ms-oplog-row.is-cleanup .ms-oplog-badge { background: rgba(var(--danger-rgb, 220 60 60), 0.15); color: var(--danger, #c0392b); }
.ms-oplog-row.is-create .ms-oplog-badge { background: rgba(var(--accent-rgb), 0.16); color: var(--accent); }
.ms-oplog-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.ms-oplog-detail { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms-oplog-meta { color: var(--text-secondary); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms-oplog-time { flex-shrink: 0; color: var(--text-secondary); font-size: 10px; }
.ms-oplog-empty { padding: 14px 0; text-align: center; font-size: 11px; color: var(--text-secondary); opacity: 0.75; }

.ms-layout { display: flex; gap: 14px; align-items: flex-start; }

/* 左：媒体列表 */
.ms-list {
  flex: 0 0 190px;
  display: flex; flex-direction: column; gap: 4px;
  max-height: 460px; overflow-y: auto;
  padding-right: 4px;
}
.ms-list-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 2px 6px 8px;
  font-size: 12px; font-weight: 600; color: var(--text-secondary);
}
.ms-add {
  border: none; background: none; cursor: pointer;
  font-family: inherit; font-size: 12px; font-weight: 600;
  color: var(--accent); padding: 2px 4px; border-radius: 6px;
}
.ms-add:hover { background: rgba(var(--accent-rgb), 0.1); }
.ms-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-family: inherit; text-align: left; cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.ms-item:hover { border-color: var(--glass-border); }
.ms-item.active { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.1); }
.ms-item.off { opacity: 0.5; }
.ms-item-icon { font-size: 16px; flex-shrink: 0; }
.ms-item-main { display: flex; flex-direction: column; min-width: 0; }
.ms-item-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms-item-sub { font-size: 10px; color: var(--text-secondary); }
/* 形态徽标（列表里用来一眼区分产物格式） */
.ms-item-layout {
  display: inline-block; margin-right: 4px; padding: 0 5px;
  border-radius: 4px; font-weight: 600;
  background: var(--glass-bg); color: var(--text-secondary);
}
.ms-item-layout.portal { background: rgba(var(--accent-rgb), 0.16); color: var(--accent); }
/* 表单里字段下方的说明与提醒 */
.ms-field-hint { margin: 4px 0 0; font-size: 11px; line-height: 1.6; color: var(--text-secondary); }
.ms-field-warn { margin: 4px 0 0; font-size: 11px; line-height: 1.6; color: var(--warning, #b5691f); }

/* 右：表单 */
.ms-form { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 11px; }
.ms-form-empty { padding: 60px 0; text-align: center; font-size: 13px; color: var(--text-secondary); opacity: 0.75; }
.ms-row { display: flex; flex-direction: column; gap: 5px; }
.ms-label { font-size: 12px; font-weight: 600; color: var(--text-bright); }
.ms-icon-input { max-width: 120px; }
.ms-switch-label { margin-top: 4px; }
.ms-prompt { width: 100%; }
.ms-boards { display: flex; flex-direction: column; gap: 7px; padding-top: 4px; border-top: 1px solid var(--border); }
.ms-boards-head { display: flex; align-items: baseline; gap: 8px; }
.ms-boards-hint { font-size: 11px; color: var(--text-secondary); }
.ms-board-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ms-board-chip {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 2px 4px 2px 8px; border-radius: 8px;
  background: var(--bg-tertiary); border: 1px solid var(--glass-border);
}
.ms-board-input {
  width: 76px; border: none; background: none; outline: none;
  font-family: inherit; font-size: 12px; color: var(--text-primary);
  padding: 3px 0;
}
.ms-board-del {
  border: none; background: none; cursor: pointer;
  color: var(--text-secondary); font-size: 11px; line-height: 1;
  padding: 3px 4px; border-radius: 5px;
}
.ms-board-del:hover { color: var(--danger); background: rgba(var(--danger-rgb, 220 60 60), 0.1); }
.ms-board-empty { font-size: 11px; color: var(--text-secondary); opacity: 0.75; }
.ms-board-add { display: flex; gap: 8px; align-items: center; }
.ms-board-add .fi { max-width: 180px; }
.ms-actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.ms-new-hint { margin: 0; font-size: 11px; color: var(--text-secondary); }

@media (max-width: 767px) {
  .ms-layout { flex-direction: column; }
  .ms-list { flex: 1 1 auto; width: 100%; max-height: 180px; flex-direction: row; overflow-x: auto; }
  .ms-list-head { display: none; }
  .ms-item { flex-shrink: 0; }
}
</style>
