<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="modal-overlay">
        <div class="modal-panel ded-modal">
          <div class="modal-header">
            <h3>推演{{ mode === 'user' ? '用户' : '角色' }}关系 — {{ mode === 'user' ? userName : character?.display_name }}</h3>
            <button class="modal-close" @click="$emit('close')">&times;</button>
          </div>
          <div class="modal-body">
            <Transition name="ded-collapse" mode="out-in">
              <div v-if="loading" key="loading" class="ded-loading">
                <span class="ded-spinner"></span>
                <p>正在自动推演角色关系图，等待构史完毕确认...</p>
              </div>
              <div v-else key="results">
              <div class="ded-glass-panel">
              <div class="ded-columns">
                <div class="ded-col ded-col-left">
                  <div class="ded-col-header">
                    <div>
                      <span>推演结果</span>
                      <p class="ded-col-subtitle">{{ mode === 'user' ? userName : character?.display_name }} → 小明，代表小明是{{ mode === 'user' ? userName : character?.display_name }}的老板。</p>
                    </div>
                    <span class="ded-col-count">{{ suggestions.length }}条</span>
                  </div>
                  <div class="ded-list">
                    <div
                      v-for="(item, idx) in suggestions"
                      :key="'s'+idx"
                      class="ded-item"
                    >
                      <div class="ded-item-body" v-if="editingIdx !== idx || editingSide !== 'left'">
                        <div class="ded-item-names">
                          <span class="ded-from">{{ item.from_display }}</span>
                          <span class="ded-arrow">&rarr;</span>
                          <span class="ded-to">{{ item.to_display }}</span>
                        </div>
                        <div class="ded-item-text">{{ item.relationship_text }}</div>
                      </div>
                      <div class="ded-item-edit" v-else>
                        <input v-model="editText" class="fi" @keyup.enter="saveEdit(idx, 'left')" @blur="saveEdit(idx, 'left')" />
                      </div>
                      <div class="ded-item-actions" v-if="!saving">
                        <div class="ded-act-row">
                          <button class="ded-act trash" title="排除此角色" @click="excludeCharacter(idx)">&#128465;</button>
                          <button class="ded-act edit" title="编辑" @click="startEdit(idx, 'left', item.relationship_text)">&#9998;</button>
                        </div>
                        <button class="ded-act push" title="确认添加" @click="addToConfirmed(idx)">&rarr;</button>
                      </div>
                    </div>
                    <div v-if="suggestions.length === 0" class="ded-empty">
                      暂无推演结果，请点击下方按钮生成
                    </div>
                  </div>
                </div>
                <div class="ded-col-ctrl">
                  <button class="ded-ctrl-btn ded-ctrl-right" title="全部导入右侧" :disabled="suggestions.length === 0" @click="importAll">
                    <svg class="ded-ctrl-icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M415.744 937.179429a43.885714 43.885714 0 0 1 0-62.098286l363.154286-363.154286-363.154286-363.154286a43.885714 43.885714 0 0 1 62.025143-62.025142l394.24 394.166857a43.885714 43.885714 0 0 1 0 62.025143l-394.24 394.24a43.885714 43.885714 0 0 1-62.025143 0z" fill="currentColor"></path><path d="M261.558857 762.441143a43.885714 43.885714 0 0 1 0-62.098286L449.974857 512 261.558857 323.584a43.885714 43.885714 0 0 1 62.025143-62.098286l219.428571 219.428572a43.885714 43.885714 0 0 1 0 62.098285l-219.428571 219.428572a43.885714 43.885714 0 0 1-62.025143 0z" fill="currentColor"></path></svg>
                  </button>
                  <button class="ded-ctrl-btn ded-ctrl-left" title="全部推回左侧" :disabled="confirmed.length === 0" @click="pushAllBack">
                    <svg class="ded-ctrl-icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M415.744 937.179429a43.885714 43.885714 0 0 1 0-62.098286l363.154286-363.154286-363.154286-363.154286a43.885714 43.885714 0 0 1 62.025143-62.025142l394.24 394.166857a43.885714 43.885714 0 0 1 0 62.025143l-394.24 394.24a43.885714 43.885714 0 0 1-62.025143 0z" fill="currentColor"></path><path d="M261.558857 762.441143a43.885714 43.885714 0 0 1 0-62.098286L449.974857 512 261.558857 323.584a43.885714 43.885714 0 0 1 62.025143-62.098286l219.428571 219.428572a43.885714 43.885714 0 0 1 0 62.098285l-219.428571 219.428572a43.885714 43.885714 0 0 1-62.025143 0z" fill="currentColor"></path></svg>
                  </button>
                </div>
                <div class="ded-col ded-col-right">
                  <div class="ded-col-header">
                    <span>确认添加</span>
                    <span class="ded-col-count">{{ confirmed.length }}条</span>
                  </div>
                  <div class="ded-list">
                    <div
                      v-for="(item, idx) in confirmed"
                      :key="'c'+idx"
                      class="ded-item confirmed"
                    >
                      <div class="ded-item-body" v-if="editingIdx !== idx || editingSide !== 'right'">
                        <div class="ded-item-names">
                          <span class="ded-from">{{ item.from_display }}</span>
                          <span class="ded-arrow">&rarr;</span>
                          <span class="ded-to">{{ item.to_display }}</span>
                        </div>
                        <div class="ded-item-text">{{ item.relationship_text }}</div>
                      </div>
                      <div class="ded-item-edit" v-else>
                        <input v-model="editText" class="fi" @keyup.enter="saveEdit(idx, 'right')" @blur="saveEdit(idx, 'right')" />
                      </div>
                      <div class="ded-item-actions" v-if="!saving">
                        <button class="ded-act remove" title="移回左侧" @click="removeFromConfirmed(idx)">&larr;</button>
                        <button class="ded-act edit" title="编辑" @click="startEdit(idx, 'right', item.relationship_text)">&#9998;</button>
                      </div>
                    </div>
                    <div v-if="confirmed.length === 0" class="ded-empty">
                      请从左侧推演结果中确认要添加的关系
                    </div>
                  </div>
                </div>
              </div>
              <div class="ded-footer">
                <div class="ded-footer-row">
                  <button class="ded-btn boost" :disabled="loading || saving" @click="boostDeduce">加大药量</button>
                  <button class="ded-btn normal" :disabled="loading || saving" @click="normalDeduce">常规推理</button>
                </div>
                <div class="ded-footer-row">
                  <button class="ded-btn confirm" :disabled="loading || saving || confirmed.length === 0" @click="confirmAll">
                    <span v-if="saving" class="ded-spinner-small"></span>
                    {{ saving ? '保存中...' : '确定关系' }}
                  </button>
                </div>
              </div>
              </div>
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import * as api from '../api/index.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  character: { type: Object, default: null },
  mode: { type: String, default: 'character' }, // 'character' | 'user'
  userName: { type: String, default: '' },
})

const emit = defineEmits(['close', 'saved'])

const loading = ref(false)
const saving = ref(false)
const suggestions = ref([])
const confirmed = ref([])
const excludedNames = ref([])
const isBoosted = ref(false)
const editingIdx = ref(null)
const editingSide = ref(null)
const editText = ref('')

async function deduce(boost) {
  if (props.mode === 'character' && !props.character) return
  loading.value = true
  suggestions.value = []
  try {
    const excludeNames = getExcludedNames()
    let res
    if (props.mode === 'user') {
      res = await api.deduceUserRelationships(boost, excludeNames)
    } else {
      res = await api.deduceRelationships(props.character.id, boost, excludeNames)
    }
    if (res.error) throw new Error(res.error)
    suggestions.value = dedupeByFromTo(res.relationships || [])
    if (boost) isBoosted.value = true
  } catch (e) {
    suggestions.value = []
    console.error('[deduce]', e)
  } finally {
    loading.value = false
  }
}

async function normalDeduce() {
  await deduce(false)
}

async function boostDeduce() {
  await deduce(true)
}

function getExcludedNames() {
  const set = new Set()
  for (const item of confirmed.value) {
    set.add(item.from_name)
    set.add(item.to_name)
  }
  for (const name of excludedNames.value) {
    set.add(name)
  }
  return [...set]
}

function dedupeByFromTo(items) {
  const seen = new Set()
  return items.filter(item => {
    const key = `${item.from_name}|${item.to_name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function addToConfirmed(idx) {
  const item = suggestions.value[idx]
  if (!item) return
  const dup = confirmed.value.find(c => c.from_name === item.from_name && c.to_name === item.to_name)
  if (!dup) confirmed.value.push({ ...item })
  suggestions.value.splice(idx, 1)
}

function excludeCharacter(idx) {
  const item = suggestions.value[idx]
  if (!item) return
  excludedNames.value.push(item.to_name)
  suggestions.value.splice(idx, 1)
}

function importAll() {
  for (const item of [...suggestions.value]) {
    const dup = confirmed.value.find(c => c.from_name === item.from_name && c.to_name === item.to_name)
    if (!dup) confirmed.value.push({ ...item })
  }
  suggestions.value = []
}

function pushAllBack() {
  for (const item of [...confirmed.value]) {
    const dup = suggestions.value.find(s => s.from_name === item.from_name && s.to_name === item.to_name)
    if (!dup) suggestions.value.push({ ...item })
  }
  confirmed.value = []
}

function removeFromConfirmed(idx) {
  const item = confirmed.value[idx]
  if (!item) return
  confirmed.value.splice(idx, 1)
  const dup = suggestions.value.find(s => s.from_name === item.from_name && s.to_name === item.to_name)
  if (!dup) suggestions.value.push({ ...item })
}

function startEdit(idx, side, text) {
  editingIdx.value = idx
  editingSide.value = side
  editText.value = text
  nextTick(() => {
    document.querySelector('.ded-item-edit input.fi')?.focus()
  })
}

function saveEdit(idx, side) {
  const list = side === 'left' ? suggestions.value : confirmed.value
  if (list[idx]) list[idx].relationship_text = editText.value.slice(0, 30).trim()
  editingIdx.value = null
  editingSide.value = null
  editText.value = ''
}

async function confirmAll() {
  if (confirmed.value.length === 0) return
  saving.value = true
  try {
    if (props.mode === 'user') {
      for (const item of confirmed.value) {
        const existing = await api.getUserRelationships()
        const match = (existing.relationships || []).find(r => r.character_id === item.to_id)
        if (match) {
          await api.updateUserRelationship(match.id, item.relationship_text)
        } else {
          await api.createUserRelationship(item.to_id, item.relationship_text)
        }
      }
    } else {
      for (const item of confirmed.value) {
        const existing = await api.getRelationships(item.from_id)
        const match = (existing.relationships || []).find(r => r.to_character_id === item.to_id)
        if (match) {
          await api.updateRelationship(match.id, item.relationship_text)
        } else {
          await api.createRelationship(item.from_id, item.to_id, item.relationship_text)
        }
      }
    }
    emit('saved')
    emit('close')
  } catch (e) {
    console.error('[confirmAll]', e)
  } finally {
    saving.value = false
  }
}

watch(() => props.visible, (val) => {
  if (val) {
    loading.value = true
    suggestions.value = []
    confirmed.value = []
    excludedNames.value = []
    isBoosted.value = false
    editingIdx.value = null
    editingSide.value = null
    editText.value = ''
    deduce(false)
  }
})
</script>

<style scoped>
/* ═══ 弹窗骨架已迁移至全局 .modal-*（styles/components.css）═══ */
.ded-modal { width: min(780px, 96vw); }

.ded-glass-panel {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  padding: 16px;
}

/* ── 加载态 ── */
.ded-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 60px 20px; gap: 16px;
}
.ded-spinner {
  width: 36px; height: 36px; border: 3px solid var(--glass-border, #e5e0db);
  border-top-color: var(--accent, var(--accent)); border-radius: 50%;
  animation: ded-spin 0.7s linear infinite;
}
@keyframes ded-spin { to { transform: rotate(360deg); } }
@keyframes waterflow {
  0%, 100% { background-position: 0% 50%; }
  50%      { background-position: 100% 50%; }
}
.ded-loading p {
  font-size: 14px; color: var(--text-secondary, var(--text-secondary)); margin: 0;
}

/* ── 双列布局 ── */
.ded-columns {
  display: flex; gap: 14px;
}
.ded-col {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
}
.ded-col-left { flex: 1.1; }
.ded-col-right { flex: 0.9; }
.ded-col-ctrl {
  display: flex; flex-direction: column; justify-content: center; gap: 6px;
  flex-shrink: 0; padding: 0 2px;
}
.ded-ctrl-btn {
  width: 28px; height: 28px; border: 1px solid var(--glass-border, #e5e0db);
  border-radius: 6px; background: var(--bg-primary, #fff);
  color: var(--text-secondary, var(--text-secondary));
  cursor: pointer; transition: all 0.15s; padding: 0; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.ded-ctrl-icon { display: block; }

.ded-ctrl-right .ded-ctrl-icon { transform: rotate(0deg); }
.ded-ctrl-left .ded-ctrl-icon { transform: rotate(180deg); }
.ded-ctrl-btn:hover:not(:disabled) {
  border-color: var(--accent, var(--accent)); color: var(--accent, var(--accent));
  background: rgba(var(--accent-rgb),0.06);
}
.ded-ctrl-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.ded-col-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 0 2px 8px;
  font-size: 14px; font-weight: 700; color: var(--text-primary, #3e3a37);
}
.ded-col-subtitle {
  margin: 2px 0 0; font-size: 11px; font-weight: 400; color: var(--text-secondary, var(--text-secondary));
  line-height: 1.4;
}
.ded-col-count {
  font-size: 12px; font-weight: 500; color: var(--text-secondary, var(--text-secondary));
}

/* ── 列表 ── */
.ded-list {
  flex: 1 1 480px; overflow-y: auto; height: 480px; max-height: 480px;
  display: flex; flex-direction: column; gap: 8px;
  padding-right: 4px;
}
.ded-empty {
  text-align: center; color: var(--text-secondary, var(--text-secondary));
  font-size: 13px; padding: 30px 12px;
}

/* ── 关系条目 ── */
.ded-item {
  display: flex; align-items: center; gap: 6px;
  background: #fff; border: 1px solid var(--glass-border, #e5e0db);
  border-radius: 10px; padding: 8px 8px 8px 10px;
  transition: border-color 0.15s;
}
.ded-item:hover { border-color: var(--accent, var(--accent)); }
.ded-item.confirmed { border-color: rgba(var(--accent-rgb), 0.35); background: rgba(var(--accent-rgb), 0.04); }

.ded-item-body { flex: 1; min-width: 0; }
.ded-item-names {
  display: flex; align-items: center; gap: 5px;
  font-size: 13px; font-weight: 600; color: var(--text-primary, #3e3a37);
  margin-bottom: 2px;
}
.ded-arrow { color: var(--text-secondary, var(--text-secondary)); font-size: 12px; }
.ded-item-text { font-size: 12px; color: var(--text-secondary, var(--text-secondary)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.ded-item-edit {
  flex: 1; display: flex; gap: 6px; align-items: center;
}
.ded-item-edit .fi { height: 28px; font-size: 12px; padding: 0 8px; flex: 1; }

/* ── 操作按钮 ── */
.ded-item-actions {
  display: flex; flex-direction: column; gap: 3px; flex-shrink: 0;
}
.ded-act-row {
  display: flex; gap: 3px;
}
.ded-act {
  width: 24px; height: 24px; border: none; border-radius: 6px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-size: 14px; line-height: 1; padding: 0;
  transition: all 0.15s;
}
.ded-act.push { width: auto; background: rgba(var(--accent-rgb), 0.1); color: var(--accent, var(--accent)); font-size: 16px; }
.ded-act.push:hover { background: var(--accent, var(--accent)); color: #fff; }
.ded-act.remove { background: rgba(255, 77, 79, 0.08); color: #ff4d4f; }
.ded-act.remove:hover { background: #ff4d4f; color: #fff; }
.ded-act.edit { background: rgba(0, 0, 0, 0.05); color: var(--text-secondary, var(--text-secondary)); font-size: 13px; }
.ded-act.edit:hover { background: rgba(0, 0, 0, 0.1); color: var(--text-primary, #3e3a37); }
.ded-act.trash { background: rgba(255, 77, 79, 0.06); color: #ff4d4f; font-size: 13px; }
.ded-act.trash:hover { background: #ff4d4f; color: #fff; }

/* ── 底部按钮区（两行）── */
.ded-footer {
  flex-shrink: 0; padding-top: 14px; margin-top: 10px;
  border-top: 1px solid var(--glass-border, #e5e0db);
  display: flex; flex-direction: column; gap: 8px;
}
.ded-footer-row {
  display: flex; gap: 8px; justify-content: center;
}
.ded-btn {
  flex: 1; padding: 10px 0; border: none; border-radius: 10px;
  font-size: 13px; font-weight: 700; cursor: pointer;
  transition: all 0.15s;
}
.ded-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.ded-btn.boost {
  background: var(--grad-soft);
  background-size: 200% 200%;
  color: var(--accent-hover);
}
.ded-btn.boost:hover:not(:disabled) {
  animation: waterflow 1s ease-in-out infinite;
  box-shadow: 0 3px 20px rgba(var(--accent-rgb),0.10);
}
.ded-btn.normal {
  background: var(--bg-primary, #fff); color: var(--accent-hover);
  border: 1.5px solid var(--glass-border, #e5e0db);
}
.ded-btn.normal:hover:not(:disabled) { border-color: var(--accent, var(--accent)); color: var(--accent, var(--accent)); }
.ded-btn.confirm {
  background: var(--accent, var(--accent)); color: #fff;
}
.ded-btn.confirm:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }

.ded-spinner-small {
  display: inline-block; width: 14px; height: 14px; margin-right: 6px;
  border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
  border-radius: 50%; animation: ded-spin 0.6s linear infinite;
  vertical-align: middle;
}

/* 弹窗动画已迁移至全局 animations.css */

.ded-collapse-enter-active, .ded-collapse-leave-active {
  transition: opacity 0.25s ease, transform 0.3s ease;
}
.ded-collapse-enter-from {
  opacity: 0; transform: translateY(-6px);
}
.ded-collapse-leave-to {
  opacity: 0; transform: translateY(6px);
}

@media (max-width: 767px) {
  .ded-modal { width: 100vw; max-height: 100vh; max-height: 100dvh; border-radius: 0; }
  .modal-header { padding: 10px 16px; padding-top: calc(10px + env(safe-area-inset-top, 0px)); }
  .modal-header h3 { font-size: 15px; }
  .ded-columns { flex-direction: column; }
  .ded-col { min-height: 200px; }
  .ded-list { height: 200px; max-height: 200px; }
  .ded-col-ctrl { flex-direction: row; }
  .ded-ctrl-right .ded-ctrl-icon { transform: rotate(90deg); }
  .ded-ctrl-left .ded-ctrl-icon { transform: rotate(270deg); }
}
</style>
