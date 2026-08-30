<template>
  <Transition name="modal-fade">
    <div v-if="modelValue" class="lib-overlay" @click.self="close">
      <div class="lib-panel">
        <!-- 头部 -->
        <div class="lib-header">
          <h3 class="lib-title">{{ title }}</h3>
          <div class="lib-header-right">
            <span class="lib-count">{{ items.length }} 条</span>
            <button class="lib-close" @click="close">✕</button>
          </div>
        </div>

        <div class="lib-body">
          <!-- 生成器 -->
          <div class="gen-section">
            <div class="gen-row">
              <div class="gen-input-wrap">
                <textarea
                  ref="directionInput"
                  @keydown.enter.exact.prevent="onDirectionEnter"
                  v-model="direction"
                  class="gen-input"
                  rows="2"
                  :placeholder="isEvents ? '输入想要生成的方向，如「校园生活」「赛博都市日常」「雨季独处」…（留空生成通用类型）' : '输入想要生成的方向，如「校园」「美食探店」「深夜emo」…（留空生成通用话题）'"
                ></textarea>
                <div v-if="generating" class="scan-overlay">
                  <div class="scan-line"></div>
                  <div class="scan-text">幻想中…</div>
                </div>
              </div>
              <button class="gen-btn" @click="doGenerate" :disabled="generating || saving">
                {{ generating ? '幻想中…' : '开始幻想' }}
              </button>
            </div>

            <!-- 生成结果预览 -->
            <div v-if="previewVisible" class="preview-section">
              <div class="preview-header">
                <span class="preview-title">生成预览（{{ previewItems.length }} 条）— 可逐条编辑，确认后入库</span>
                <div class="preview-actions">
                  <button class="preview-btn primary" @click="savePreview" :disabled="saving">
                    {{ saving ? '保存中…' : '保存到自定义库' }}
                  </button>
                  <button class="preview-btn" @click="discardPreview" :disabled="saving">丢弃</button>
                </div>
              </div>
              <TransitionGroup
                name="preview-card"
                tag="div"
                class="card-grid"
                @before-leave="onPreviewCardBeforeLeave"
                @after-leave="onPreviewCardAfterLeave"
              >
                <div
                  v-for="(item, i) in previewItems"
                  :key="item._previewKey"
                  class="item-card"
                  :class="{ editing: item._editing }"
                >
                  <CardHeightTransition :editing="item._editing">
                    <div v-if="item._editing" class="edit-form">
                      <label class="edit-field">
                        <span class="edit-label">名称</span>
                        <input v-model.trim="item.name" class="edit-input" placeholder="名称" />
                      </label>
                      <label v-if="isEvents" class="edit-field">
                        <span class="edit-label">标签（逗号分隔）</span>
                        <input v-model="item.funFromText" class="edit-input" placeholder="如 小确幸, 日常感" />
                      </label>
                      <label class="edit-field">
                        <span class="edit-label">描述</span>
                        <textarea v-model.trim="item.desc" class="edit-input edit-textarea" rows="6"></textarea>
                      </label>
                    </div>
                    <div v-else class="card-main">
                      <div class="card-title-row">
                        <span class="card-name">{{ item.name }}</span>
                      </div>
                      <div class="card-desc">{{ item.desc }}</div>
                      <div v-if="isEvents && item.funFrom && item.funFrom.length" class="card-tags">
                        <span v-for="(t, ti) in item.funFrom" :key="ti" class="tag">{{ t }}</span>
                      </div>
                    </div>
                  </CardHeightTransition>
                  <div class="card-actions">
                    <button v-if="!item._editing" class="mini-btn primary" @click="savePreviewItem(i)" :disabled="saving">单独入库</button>
                    <button class="mini-btn" @click="togglePreviewEdit(i)">{{ item._editing ? '取消' : '编辑' }}</button>
                    <button v-if="item._editing" class="mini-btn primary" @click="previewItems[i]._editing = false">完成</button>
                    <button v-else class="mini-btn danger" @click="removePreview(i)">删除</button>
                  </div>
                </div>
              </TransitionGroup>
            </div>
          </div>

          <!-- 系统组（默认折叠） -->
          <div class="group-section">
            <div class="group-header" @click="systemOpen = !systemOpen">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" :class="{ rotated: systemOpen }">
                <polyline points="9,6 15,12 9,18" />
              </svg>
              <span class="group-title">系统（{{ systemItems.length }}）</span>
              <span class="group-hint">{{ systemOpen ? '收起' : '展开' }}</span>
            </div>
            <CollapseTransition :show="systemOpen">
              <div class="card-grid">
                <LibraryItemCard
                  v-for="item in systemItems"
                  :key="item.id"
                  :item="item"
                  :is-events="isEvents"
                  @edit="startEdit"
                  @cancel="cancelEdit"
                  @save="saveItem"
                  @remove="removeItem"
                />
                <div v-if="systemItems.length === 0" class="empty-hint">暂无系统条目</div>
              </div>
            </CollapseTransition>
          </div>

          <!-- 自定义组 -->
          <div class="group-section">
            <div class="group-header" @click="customOpen = !customOpen">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" :class="{ rotated: customOpen }">
                <polyline points="9,6 15,12 9,18" />
              </svg>
              <span class="group-title">自定义（{{ customItems.length }}）</span>
              <span class="group-hint">{{ customOpen ? '收起' : '展开' }}</span>
            </div>
            <CollapseTransition :show="customOpen">
              <TransitionGroup name="custom-card" tag="div" class="card-grid">
                <button key="add-card" class="add-card" @click="addItem">＋ 手动新增</button>
                <LibraryItemCard
                  v-for="item in customItems"
                  :key="item.id || item._tempKey"
                  :item="item"
                  :is-events="isEvents"
                  @edit="startEdit"
                  @cancel="cancelEdit"
                  @save="saveItem"
                  @remove="removeItem"
                />
                <div v-if="customItems.length === 0" key="custom-empty" class="empty-hint">还没有自定义条目，用上方生成器或点「＋新增」添加</div>
              </TransitionGroup>
            </CollapseTransition>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch, inject, nextTick } from 'vue'
import * as api from '../api/index.js'
import LibraryItemCard from './LibraryItemCard.vue'
import CollapseTransition from './CollapseTransition.vue'
import CardHeightTransition from './CardHeightTransition.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  type: { type: String, default: 'event-types' }, // 'event-types' | 'topics'
})
const emit = defineEmits(['update:modelValue'])

const toastFn = inject('toast')
const confirmFn = inject('confirm')

const isEvents = computed(() => props.type === 'event-types')
const title = computed(() => (isEvents.value ? '奇遇事件库' : '朋友圈话题库'))

const items = ref([])
const loading = ref(false)
const systemOpen = ref(false) // 系统组默认折叠
const customOpen = ref(true)

const direction = ref('')
const directionInput = ref(null)
const generating = ref(false)
const saving = ref(false)
const previewItems = ref([])
const previewVisible = ref(false)
const previewLeavingCount = ref(0)

const systemItems = computed(() => items.value.filter(i => i.source === 'default'))
const customItems = computed(() => items.value.filter(i => i.source === 'custom'))

// ── 加载 ──

async function load() {
  loading.value = true
  try {
    items.value = isEvents.value ? await api.listEventTypes() : await api.listTopics()
  } catch (err) {
    toastFn(err.message, 'error')
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, async (v) => {
  if (v) {
    direction.value = ''
    previewItems.value = []
    previewVisible.value = false
    previewLeavingCount.value = 0
    load()
    await nextTick()
    directionInput.value?.focus()
  }
})

function close() {
  emit('update:modelValue', false)
}

// ── 生成器 ──

function onDirectionEnter(e) {
  if (e.isComposing || e.keyCode === 229) return
  if (generating.value || saving.value) return
  e.target.blur()
  doGenerate()
}

async function doGenerate() {
  if (generating.value || saving.value) return
  generating.value = true
  try {
    const res = isEvents.value
      ? await api.generateEventTypes(direction.value.trim())
      : await api.generateTopics(direction.value.trim())
    const generatedItems = (res.items || []).map((it, index) => ({
      ...it,
      funFromText: (it.funFrom || []).join(', '),
      _editing: false,
      _previewKey: `preview_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
    }))
    previewVisible.value = generatedItems.length > 0
    previewItems.value = generatedItems
    if (previewItems.value.length === 0) toastFn('没有生成到内容，换个方向试试', 'error')
  } catch (err) {
    toastFn(err.message, 'error')
  } finally {
    generating.value = false
  }
}

function discardPreview() {
  previewLeavingCount.value += previewItems.value.length
  previewItems.value = []
}

function onPreviewCardBeforeLeave(el) {
  const grid = el.parentElement
  if (!grid) return

  const cardRect = el.getBoundingClientRect()
  const gridRect = grid.getBoundingClientRect()
  el.style.left = `${cardRect.left - gridRect.left}px`
  el.style.top = `${cardRect.top - gridRect.top}px`
  el.style.width = `${cardRect.width}px`
  el.style.height = `${cardRect.height}px`
}

function onPreviewCardAfterLeave(el) {
  el.style.left = ''
  el.style.top = ''
  el.style.width = ''
  el.style.height = ''
  previewLeavingCount.value = Math.max(0, previewLeavingCount.value - 1)
  if (previewItems.value.length === 0 && previewLeavingCount.value === 0) {
    previewVisible.value = false
  }
}

function togglePreviewEdit(idx) {
  const item = previewItems.value[idx]
  if (item._editing) {
    item._editing = false
    // 还原编辑前的字段
    if (item._original) {
      const restored = JSON.parse(item._original)
      previewItems.value[idx] = { ...restored, funFromText: (restored.funFrom || []).join(', ') }
    }
  } else {
    item._original = JSON.stringify({ key: item.key, name: item.name, durationMin: item.durationMin, urgency: item.urgency, funFrom: item.funFrom, desc: item.desc, _previewKey: item._previewKey })
    item._editing = true
  }
}

function removePreview(idx) {
  previewLeavingCount.value += 1
  previewItems.value.splice(idx, 1)
}

function cleanPayload(item) {
  if (isEvents.value) {
    const funFrom = typeof item.funFromText === 'string'
      ? item.funFromText.split(/[,，]/).map(s => s.trim()).filter(Boolean)
      : (item.funFrom || [])
    return { key: item.key, name: item.name, durationMin: item.durationMin, urgency: item.urgency, funFrom, desc: item.desc }
  }
  return { name: item.name, desc: item.desc }
}

async function savePreviewItem(idx) {
  const item = previewItems.value[idx]
  if (!item || saving.value) return
  const payload = cleanPayload(item)
  if (!payload.name || !payload.name.trim()) return toastFn('名称不能为空', 'error')
  saving.value = true
  try {
    const res = isEvents.value
      ? await api.saveEventTypeBatch([payload])
      : await api.saveTopicBatch([payload])
    const saved = (res.saved || [])[0]
    if (saved) {
      if (!customOpen.value) {
        customOpen.value = true
        await nextTick()
      }
      items.value = [...items.value, saved]
      previewLeavingCount.value += 1
      previewItems.value.splice(idx, 1)
      toastFn('已入库', 'success')
    } else {
      toastFn((res.errors && res.errors[0] && res.errors[0].message) || '入库失败', 'error')
    }
  } catch (err) {
    toastFn(err.message, 'error')
  } finally {
    saving.value = false
  }
}

async function savePreview() {
  if (saving.value) return
  const payload = previewItems.value.map(it => cleanPayload(it)).filter(it => it.name && it.name.trim())
  if (payload.length === 0) return toastFn('没有可保存的有效条目（名称不能为空）', 'error')
  saving.value = true
  try {
    const res = isEvents.value
      ? await api.saveEventTypeBatch(payload)
      : await api.saveTopicBatch(payload)
    const saved = res.saved || []
    if (saved.length > 0 && !customOpen.value) {
      customOpen.value = true
      await nextTick()
    }
    items.value = [...items.value, ...saved]
    toastFn(`已保存 ${saved.length} 条${res.errors && res.errors.length ? `，跳过 ${res.errors.length} 条无效` : ''}`)
    previewLeavingCount.value += previewItems.value.length
    previewItems.value = []
  } catch (err) {
    toastFn(err.message, 'error')
  } finally {
    saving.value = false
  }
}

// ── 列表条目：编辑 / 新增 / 删除 ──

function startEdit(item) {
  item._original = JSON.stringify(item)
  item._editing = true
}

function cancelEdit(item) {
  // 新增中的空卡片：直接移除
  if (!item.id) {
    items.value = items.value.filter(i => i !== item)
    return
  }
  if (item._original) {
    const restored = JSON.parse(item._original)
    const idx = items.value.indexOf(item)
    items.value[idx] = { ...restored }
  } else {
    item._editing = false
  }
}

async function saveItem(item) {
  if (isEvents.value) {
    if (!item.key || !item.key.trim()) return toastFn('key 不能为空', 'error')
    if (!item.name || !item.name.trim()) return toastFn('名称不能为空', 'error')
  } else if (!item.name || !item.name.trim()) {
    return toastFn('名称不能为空', 'error')
  }

  try {
    let saved
    if (item.id) {
      saved = isEvents.value ? await api.updateEventType(item.id, cleanPayload(item)) : await api.updateTopic(item.id, cleanPayload(item))
    } else {
      saved = isEvents.value ? await api.createEventType(cleanPayload(item)) : await api.createTopic(cleanPayload(item))
    }
    const idx = items.value.indexOf(item)
    items.value[idx] = { ...saved }
    toastFn('已保存')
  } catch (err) {
    toastFn(err.message, 'error')
  }
}

async function removeItem(item) {
  const ok = confirmFn ? await confirmFn(`确定删除「${item.name}」吗？`) : true
  if (!ok) return
  try {
    if (item.id) {
      if (isEvents.value) await api.deleteEventType(item.id)
      else await api.deleteTopic(item.id)
    }
    items.value = items.value.filter(i => i !== item)
    toastFn('已删除')
  } catch (err) {
    toastFn(err.message, 'error')
  }
}

function addItem() {
  const blank = isEvents.value
    ? { source: 'custom', key: '', name: '', durationMin: 60, urgency: 1, funFrom: [], desc: '', _editing: true, _tempKey: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
    : { source: 'custom', name: '', desc: '', _editing: true, _tempKey: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
  items.value.push(blank)
}
</script>

<style scoped>
.lib-overlay {
  position: fixed; inset: 0; z-index: 300;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  padding: 3vh 3vw;
}
.lib-panel {
  width: 94vw; height: 92vh;
  display: flex; flex-direction: column;
  background: rgba(255, 255, 255, 0.97);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 18px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}
.lib-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--glass-border, rgba(0,0,0,0.08));
  flex-shrink: 0;
}
.lib-title { font-size: 17px; font-weight: 700; color: var(--text-bright, #2b2b2b); margin: 0; }
.lib-header-right { display: flex; align-items: center; gap: 12px; }
.lib-count { font-size: 12px; color: var(--text-secondary, #888); }
.lib-close {
  background: none; border: none; font-size: 18px;
  color: var(--text-secondary, #888); cursor: pointer;
  padding: 4px 8px; border-radius: 6px; transition: all 0.15s;
}
.lib-close:hover { background: rgba(0,0,0,0.05); color: var(--text-primary, #333); }

.lib-body {
  flex: 1; overflow-y: auto;
  padding: 16px 24px 32px;
}

/* 生成器 */
.gen-section { margin-bottom: 20px; }
.gen-row { display: flex; gap: 10px; align-items: stretch; }
.gen-input-wrap { position: relative; flex: 1; min-width: 0; }
.gen-input-wrap .gen-input { width: 100%; box-sizing: border-box; }
.gen-input {
  flex: 1; resize: vertical; min-height: 48px;
  border: 1px solid var(--glass-border, rgba(0,0,0,0.12));
  border-radius: 12px; padding: 10px 12px;
  font-size: 13px; font-family: inherit; color: var(--text-primary, #333);
  background: rgba(0,0,0,0.02); outline: none;
}
.gen-input:focus { border-color: var(--accent, var(--accent)); }
.gen-input::placeholder { color: var(--text-secondary, #888); opacity: 0.6; }

/* ── 生成中扫描线（酒馆同款）── */
.scan-overlay {
  position: absolute; inset: 0;
  background: rgba(255, 255, 255, 0.28);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  z-index: 10; overflow: hidden;
}
.scan-line {
  position: absolute; left: 8%; right: 8%; height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent, var(--accent)), transparent);
  animation: lib-scan-sweep 2s ease-in-out infinite;
  box-shadow: 0 0 24px rgba(var(--accent-rgb), 0.6), 0 0 8px rgba(var(--accent-rgb), 0.3);
}
@keyframes lib-scan-sweep {
  0%   { top: 10%; opacity: 0.2; }
  25%  { top: 90%; opacity: 1; }
  50%  { top: 90%; opacity: 0.2; }
  75%  { top: 10%; opacity: 1; }
  100% { top: 10%; opacity: 0.2; }
}
.scan-text {
  font-size: 13px; color: var(--accent, var(--accent)); font-weight: 600;
  animation: lib-scan-pulse 1.2s ease-in-out infinite;
  text-shadow: 0 0 12px rgba(var(--accent-rgb), 0.3);
}
@keyframes lib-scan-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.97); }
  50%      { opacity: 1;   transform: scale(1); }
}
.gen-btn {
  padding: 0 20px; border-radius: 12px; border: none;
  background: var(--grad-soft);
  background-size: 200% 200%;
  color: var(--accent-hover); font-size: 13px; font-weight: 600; cursor: pointer;
  white-space: nowrap; transition: all 0.2s;
}
.gen-btn:hover:not(:disabled) { animation: waterflow 1s ease-in-out infinite; box-shadow: 0 3px 20px rgba(var(--accent-rgb),0.10); }
.gen-btn:disabled { opacity: 0.4; cursor: not-allowed; }
@keyframes waterflow {
  0%, 100% { background-position: 0% 50%; }
  50%      { background-position: 100% 50%; }
}

/* 生成预览 */
.preview-section {
  margin-top: 14px; padding: 12px;
  border: 1px dashed rgba(var(--accent-rgb), 0.4);
  border-radius: 12px; background: rgba(var(--accent-rgb), 0.03);
}
.preview-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 10px;
}
.preview-title { font-size: 13px; font-weight: 600; color: var(--accent-hover); }
.preview-actions { display: flex; gap: 8px; }
.preview-btn {
  padding: 6px 14px; border-radius: 9px; border: 1px solid var(--glass-border, rgba(0,0,0,0.12));
  background: #fff; color: var(--text-primary, #333); font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.preview-btn:hover:not(:disabled) { border-color: var(--accent, var(--accent)); color: var(--accent-hover); }
.preview-btn.primary {
  border: none; background: var(--grad-soft);
  color: var(--accent-hover); font-weight: 600;
}
.preview-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* 分组 */
.group-section { margin-bottom: 22px; }
.group-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 4px; cursor: pointer; user-select: none;
  border-top: 1px solid rgba(0,0,0,0.05);
}
.group-header svg { transition: transform 0.25s; color: var(--text-secondary, #888); flex-shrink: 0; }
.group-header svg.rotated { transform: rotate(90deg); }
.group-title { font-size: 14px; font-weight: 700; color: var(--text-primary, #333); }
.group-hint { font-size: 11px; color: var(--text-secondary, #888); }
.add-card {
  min-height: 130px;
  border: 1.5px dashed var(--accent, var(--accent));
  border-radius: 12px;
  background: transparent; color: var(--accent, var(--accent));
  font-size: 13px; font-family: inherit; cursor: pointer; transition: all 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.add-card:hover { background: rgba(var(--accent-rgb),0.06); }

/* 卡片网格 */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin-top: 10px;
  position: relative;
}
.item-card {
  display: flex; flex-direction: column; justify-content: space-between;
  border: 1px solid var(--glass-border, rgba(0,0,0,0.1));
  border-radius: 12px; padding: 12px;
  background: rgba(255,255,255,0.6);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.item-card:hover { border-color: rgba(var(--accent-rgb),0.35); box-shadow: 0 3px 16px rgba(var(--accent-rgb),0.06); }
.item-card.editing { border-color: var(--accent, var(--accent)); box-shadow: 0 0 0 2px rgba(var(--accent-rgb),0.15); }
.card-main { min-width: 0; }
.card-title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.card-name { font-size: 14px; font-weight: 700; color: var(--text-bright, #2b2b2b); }
.card-desc {
  font-size: 12px; color: var(--text-primary, #555);
  line-height: 1.6; margin-top: 6px;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.card-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tag {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  background: rgba(var(--accent-rgb),0.1); color: var(--accent-hover);
}
.card-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 10px; }
.mini-btn {
  padding: 4px 12px; border-radius: 8px; border: 1px solid var(--glass-border, rgba(0,0,0,0.12));
  background: #fff; color: var(--text-primary, #555); font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.mini-btn:hover { border-color: var(--accent, var(--accent)); color: var(--accent-hover); }
.mini-btn.primary { border: none; background: var(--grad-soft); color: var(--accent-hover); font-weight: 600; }
.mini-btn.danger:hover { border-color: var(--danger, #e05050); color: var(--danger, #e05050); }

/* 编辑表单 */
.edit-form { display: flex; flex-direction: column; gap: 8px; }
.edit-field { display: flex; flex-direction: column; gap: 4px; }
.edit-label { font-size: 11px; color: var(--text-secondary, #888); }
.edit-input {
  border: 1px solid var(--glass-border, rgba(0,0,0,0.12));
  border-radius: 8px; padding: 6px 8px;
  font-size: 12px; font-family: inherit; color: var(--text-primary, #333);
  background: rgba(0,0,0,0.02); outline: none; box-sizing: border-box;
}
.edit-input:focus { border-color: var(--accent, var(--accent)); }
.edit-textarea { resize: vertical; }

.empty-hint {
  grid-column: 1 / -1;
  font-size: 12px; color: var(--text-secondary, #888);
  padding: 18px; text-align: center; background: rgba(0,0,0,0.015);
  border-radius: 10px;
}

/* 卡片入库动效：预览卡向下退场，自定义卡从下方向上进入 */
.preview-card-enter-active,
.custom-card-enter-active {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease-out;
  will-change: transform, opacity;
}
.preview-card-leave-active,
.custom-card-leave-active {
  transition: transform 0.2s cubic-bezier(0.4, 0, 1, 1), opacity 0.18s ease-in;
  will-change: transform, opacity;
  pointer-events: none;
}
.preview-card-leave-active {
  position: absolute;
  z-index: 1;
  box-sizing: border-box;
}
.preview-card-enter-from,
.custom-card-enter-from {
  opacity: 0;
  transform: translateY(20px);
}
.preview-card-leave-to,
.custom-card-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
.preview-card-move,
.custom-card-move {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .preview-card-enter-active,
  .preview-card-leave-active,
  .preview-card-move,
  .custom-card-enter-active,
  .custom-card-leave-active,
  .custom-card-move {
    transition-duration: 0.01ms !important;
  }
  .preview-card-enter-from,
  .preview-card-leave-to,
  .custom-card-enter-from,
  .custom-card-leave-to {
    transform: none;
  }
}

.modal-fade-enter-active, .modal-fade-leave-active { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; transform: scale(0.98); }
</style>
