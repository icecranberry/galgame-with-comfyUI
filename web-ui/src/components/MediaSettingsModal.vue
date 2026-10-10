<template>
  <linshe-modal
    :visible="modelValue"
    title="媒体设置"
    wide
    panel-class="ms-modal-panel"
    body-class="ms-modal-body"
    :transition-ms="300"
    @close="close"
  >
    <div class="ms-intro">
      <div>
        <h2>让每一家媒体，都有自己的声音</h2>
        <p>选择内容源，设定它的风格与板块。故事会结合当前世界观展开。</p>
      </div>
      <span class="ms-total">{{ list.length }} 家媒体</span>
    </div>
    <div class="ms-layout">
      <aside class="ms-sidebar" aria-label="媒体列表">
        <div class="ms-list-head">
          <span>内容源</span>
          <linshe-button
            size="sm"
            variant="link"
            :disabled="saving"
            @click="startCreate"
          >
            ＋ 新建
          </linshe-button>
        </div>
        <div class="ms-list">
          <div
            v-for="o in list"
            :key="o.id"
            role="button"
            tabindex="0"
            class="ms-item"
            :class="{ active: o.id === editingId, 'is-disabled': saving }"
            :aria-pressed="o.id === editingId"
            :aria-disabled="saving"
            @click="!saving && selectOutlet(o)"
            @keydown.enter.prevent="!saving && selectOutlet(o)"
            @keydown.space.prevent="!saving && selectOutlet(o)"
          >
            <span class="ms-item-icon">{{ o.icon || '◈' }}</span>
            <span class="ms-item-main">
              <strong>{{ o.name }}</strong>
              <span>
                {{ o.board_count || 0 }} 板块 · {{ o.post_count || 0 }} 篇
              </span>
            </span>
            <span v-if="!o.enabled" class="ms-paused">停用</span>
          </div>
        </div>
        <p v-if="!list.length" class="ms-hint">从新建第一家媒体开始。</p>
      </aside>
      <Transition name="ms-fade" mode="out-in">
        <div :key="isNew ? 'new' : editingId" class="ms-form">
          <p v-if="!form" class="ms-empty">选择一家媒体，开始编辑它的故事。</p>
          <template v-else>
            <div class="ms-form-head">
              <div>
                <span class="ms-eyebrow">
                  {{ isNew ? '创建内容源' : '编辑内容源' }}
                </span>
                <h3>{{ form.name || '新的媒体' }}</h3>
              </div>
              <linshe-switch
                v-model="form.enabled"
                on-text="已启用"
                off-text="已停用"
                aria-label="启用该媒体"
                :disabled="saving"
              />
            </div>
            <fieldset :disabled="saving" class="ms-fields">
              <div class="ms-basics">
                <div class="ms-row">
                  <label for="media-name">媒体名称</label>
                  <linshe-input
                    id="media-name"
                    v-model="form.name"
                    maxlength="24"
                    placeholder="给这家媒体起个名字"
                  />
                </div>
                <div class="ms-row">
                  <label for="media-icon">图标</label>
                  <linshe-input
                    id="media-icon"
                    v-model="form.icon"
                    maxlength="8"
                    placeholder="📰"
                  />
                </div>
              </div>
              <div class="ms-row">
                <span id="media-type-label">媒体类型</span>
                <linshe-select v-model="form.layout" :options="layoutOptions" :disabled="saving" aria-labelledby="media-type-label" />
                <p class="ms-hint">数字报刊按期出刊，点开板块生成正文；社交平台生成完整帖子。切换后，该媒体及已有内容会移至对应分类，旧内容保留原有版式。</p>
              </div>
              <div class="ms-row">
                <label for="media-tagline">一句话介绍</label>
                <linshe-input
                  id="media-tagline"
                  v-model="form.tagline"
                  maxlength="60"
                  placeholder="它关心什么，又为谁发声？"
                />
              </div>
              <div class="ms-row">
                <div class="ms-label-row">
                  <label for="media-prompt">编辑风格</label>
                  <span>身份 · 语气 · 写作规则</span>
                </div>
                <linshe-input
                  id="media-prompt"
                  v-model="form.prompt"
                  type="textarea"
                  :rows="18"
                  placeholder="描述这家媒体的身份、内容偏好与写作风格…"
                />
                <p class="ms-hint">
                  保持鲜明的风格，让不同媒体讲出不同的故事。
                </p>
              </div>
              <section class="ms-boards" aria-labelledby="media-boards-title">
                <div class="ms-label-row">
                  <h4 id="media-boards-title">内容板块</h4>
                  <span>{{ boards.length }} 个板块</span>
                </div>
                <p v-if="isNew" class="ms-hint">
                  创建媒体后，即可添加和管理板块。
                </p>
                <template v-else>
                  <div class="ms-board-list">
                    <div v-for="b in boards" :key="b.id" class="ms-board-row">
                      <linshe-input
                        :model-value="b.name"
                        :aria-label="'板块名称：' + b.name"
                        size="sm"
                        maxlength="16"
                        @change="renameBoard(b, $event.target.value)"
                      />
                      <linshe-button
                        variant="icon"
                        size="sm"
                        :aria-label="'删除板块：' + b.name"
                        :title="'删除板块：' + b.name"
                        @click="removeBoard(b)"
                      >
                        ×
                      </linshe-button>
                    </div>
                  </div>
                  <p v-if="!boards.length" class="ms-hint">
                    尚未设置板块，内容将归入未分类。
                  </p>
                  <div class="ms-board-add">
                    <linshe-input
                      v-model="newBoardName"
                      size="sm"
                      maxlength="16"
                      aria-label="新板块名称"
                      placeholder="添加一个新板块"
                      @keyup.enter="addBoard"
                    />
                    <linshe-button
                      size="sm"
                      :disabled="!newBoardName.trim()"
                      @click="addBoard"
                    >
                      添加
                    </linshe-button>
                  </div>
                </template>
              </section>
            </fieldset>
          </template>
        </div>
      </Transition>
    </div>
    <template #footer>
      <div class="ms-footer">
        <div class="ms-footer-tools">
          <linshe-button
            v-if="form && !isNew"
            variant="ghost"
            tone="danger"
            size="sm"
            :disabled="saving"
            @click="removeOutlet"
          >
            删除媒体
          </linshe-button>
        </div>
        <div class="ms-footer-save">
          <linshe-button size="sm" :disabled="saving" @click="close">
            取消
          </linshe-button>
          <linshe-button
            size="sm"
            variant="primary"
            :loading="saving"
            :disabled="!canSave"
            @click="save"
          >
            {{ isNew ? '创建媒体' : '保存修改' }}
          </linshe-button>
        </div>
      </div>
    </template>
  </linshe-modal>
</template>

<script setup>
import { ref, computed, watch, inject } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheSwitch from './ui/LinsheSwitch.vue'
import LinsheSelect from './ui/LinsheSelect.vue'

const layoutOptions = [{ label: '社交平台', value: 'feed' }, { label: '数字报刊', value: 'portal' }]

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 父级已有的媒体列表；本组件改动后通过 changed 事件让父级重取 */
  outlets: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'changed'])

const toastFn = inject('toast')
const confirmFn = inject('confirm', null)
async function confirmRemoval(message) {
  return confirmFn
    ? await confirmFn({
        title: '确认删除',
        message,
        okText: '删除',
        danger: true
      })
    : window.confirm(message)
}
const list = ref([])
const boards = ref([])
const editingId = ref(null)
const isNew = ref(false)
const saving = ref(false)
const newBoardName = ref('')
const form = ref(null)

const canSave = computed(
  () => !!form.value?.name?.trim() && !!form.value?.prompt?.trim()
)

watch(
  () => props.outlets,
  (v) => {
    list.value = [...(v || [])]
  },
  { immediate: true, deep: true }
)

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      list.value = [...(props.outlets || [])]
      if (list.value.length) selectOutlet(list.value[0])
      else startCreate()
    }
  }
)

function close() {
  emit('update:modelValue', false)
}

async function selectOutlet(o) {
  if (!o) {
    editingId.value = null
    form.value = null
    boards.value = []
    isNew.value = false
    return
  }
  boards.value = []
  newBoardName.value = ''
  editingId.value = o.id
  isNew.value = false
  form.value = {
    name: o.name,
    icon: o.icon || '',
    tagline: o.tagline || '',
    prompt: o.prompt || '',
    layout: o.layout === 'feed' || !o.layout ? 'feed' : 'portal',
    enabled: !!o.enabled
  }
  await reloadBoards()
}

function startCreate() {
  editingId.value = null
  isNew.value = true
  newBoardName.value = ''
  boards.value = []
  form.value = { name: '', icon: '', tagline: '', prompt: '', enabled: true, layout: 'feed' }
}

async function reloadBoards() {
  if (!editingId.value) {
    boards.value = []
    return
  }
  try {
    const id = editingId.value
    const d = await api.listMediaBoards(id)
    if (editingId.value === id) boards.value = d.boards || []
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
      layout: form.value.layout,
      enabled: form.value.enabled
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
  const ok = await confirmRemoval(
    `确定删除「${name}」吗？\n该媒体下的板块与所有帖子会一并删除，且不可恢复。`
  )
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
  } catch {
    /* 忽略 */
  }
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
  const ok = await confirmRemoval(
    `删除板块「${b.name}」？\n该板块下的帖子不会被删除，只是变成未分类。`
  )
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

<style>
/* 仅调整媒体设置的布局，弹窗皮肤继续由 LinsheModal 提供。 */
.linshe-modal.ms-modal-panel {
  height: 90dvh;
}
.linshe-modal .modal-body.ms-modal-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>

<style scoped>
.ms-intro {
  display: flex;
  flex-shrink: 0;
  justify-content: space-between;
  gap: 16px;
  padding: 0 0 22px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 22px;
}
.ms-intro h2 {
  margin: 0 0 8px;
  font-size: var(--fs-lg);
  color: var(--text-bright);
}
.ms-intro p {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  line-height: 1.8;
}
.ms-total {
  white-space: nowrap;
  font-size: var(--fs-xs);
  color: var(--accent-hover);
  padding-top: 4px;
}
.ms-layout {
  display: grid;
  flex: 1;
  min-height: 0;
  grid-template-columns: 190px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 28px;
  overflow: hidden;
}
.ms-sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.ms-list-head {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  color: var(--text-secondary);
  font-size: var(--fs-xs);
}
.ms-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 8px;
  padding: 0 4px 6px 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.ms-item {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  padding: 12px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  text-align: left;
  cursor: pointer;
}
.ms-item:hover {
  background: var(--bg-sunken);
}
.ms-item.active {
  border-color: var(--border-strong);
  background: var(--bg-sunken);
  box-shadow: var(--shadow-hard-sm);
}
.ms-item.is-disabled {
  cursor: default;
  opacity: 0.6;
}
.ms-item-icon {
  font-size: 20px;
  flex-shrink: 0;
}
.ms-item-main {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.ms-item-main strong {
  font-size: var(--fs-sm);
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.ms-item-main > span {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.ms-paused {
  font-size: 10px;
  color: var(--text-secondary);
  margin-left: auto;
  white-space: nowrap;
}
.ms-form {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-gutter: stable;
  padding: 4px 10px 8px 4px;
}
.ms-form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 24px;
}
.ms-eyebrow {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.ms-form-head h3 {
  margin: 6px 0 0;
  font-size: var(--fs-lg);
  color: var(--text-bright);
  overflow-wrap: anywhere;
}
.ms-fields {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.ms-basics {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 90px;
  gap: 12px;
}
.ms-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.ms-row label,
.ms-label-row h4 {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-primary);
  font-weight: 600;
}
.ms-label-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.ms-label-row > span {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.ms-hint {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  line-height: 1.8;
}
.ms-boards {
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-top: 1px solid var(--border);
  padding-top: 22px;
}
.ms-board-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.ms-board-row,
.ms-board-add {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ms-board-row > :first-child,
.ms-board-add > :first-child {
  min-width: 0;
  flex: 1;
}
.ms-empty {
  padding: 50px 0;
  color: var(--text-secondary);
  font-size: var(--fs-sm);
}
.ms-footer,
.ms-footer-tools,
.ms-footer-save {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ms-footer {
  width: 100%;
  justify-content: space-between;
  flex-wrap: wrap;
}
.ms-footer-save {
  margin-left: auto;
}
.ms-fade-enter-active,
.ms-fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.ms-fade-enter-from,
.ms-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
@media (max-width: 650px) {
  .ms-intro {
    margin-bottom: 14px;
    padding-bottom: 16px;
  }
  .ms-total {
    display: none;
  }
  .ms-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: 16px;
  }
  .ms-list {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 4px;
  }
  .ms-item {
    flex-shrink: 0;
    max-width: 190px;
  }
  .ms-list-head {
    padding-bottom: 6px;
  }
  .ms-board-list {
    grid-template-columns: minmax(0, 1fr);
  }
  .ms-footer {
    gap: 12px;
  }
  .ms-form-head {
    margin-bottom: 18px;
  }
}
</style>
