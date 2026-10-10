<template>
  <linshe-modal :visible="modelValue" title="媒体设置" wide @close="close">
    <div class="ms-body">
      <p class="ms-intro">
        每个「媒体」是一个内容源（论坛 / 报纸 / 匿名社区 / 暗网 …），自带一份生成提示词；
        帖子由<b>该媒体的提示词 + 世界观</b>生成，<b>活跃角色会随机出现在帖子里</b>。
        <button type="button" class="ms-cleanup" :disabled="cleaning" @click="doCleanup">
          {{ cleaning ? '清理中…' : '清理孤儿配图' }}
        </button>
      </p>

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
              <span class="ms-item-sub">{{ o.board_count }} 板块 · {{ o.post_count }} 帖</span>
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
import { ref, computed, watch, inject } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheModal from './ui/LinsheModal.vue'
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

const canSave = computed(() => !!form.value?.name?.trim() && !!form.value?.prompt?.trim())

watch(() => props.outlets, v => { list.value = [...(v || [])] }, { immediate: true, deep: true })

watch(() => props.modelValue, v => {
  if (v) { list.value = [...(props.outlets || [])]; editingId.value = null; form.value = null; boards.value = [] }
})

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

async function selectOutlet(o) {
  if (!o) { editingId.value = null; form.value = null; boards.value = []; isNew.value = false; return }
  editingId.value = o.id
  isNew.value = false
  form.value = {
    name: o.name, icon: o.icon || '', tagline: o.tagline || '',
    prompt: o.prompt || '', enabled: !!o.enabled,
  }
  await reloadBoards()
}

function startCreate() {
  editingId.value = null
  isNew.value = true
  boards.value = []
  form.value = { name: '', icon: '', tagline: '', prompt: '', enabled: true }
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
