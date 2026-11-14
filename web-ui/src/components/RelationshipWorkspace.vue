<template>
  <RelationshipWindow
    :visible="visible" :title="title" full :z-index="11000" :suspended="pairOpen || !!confirmation"
    @close="$emit('close')" @after-leave="resetWorkspace"
  >
    <template #header-extra>
      <span class="relationship-stat">角色 <strong>{{ graph.nodes.length }}</strong></span>
      <span class="relationship-stat">关系 <strong>{{ scoped.edges.length }}</strong></span>
      <button type="button" class="rel-button rel-deduce" v-if="mode === 'user'" @click="$emit('auto-deduce')"><span aria-hidden="true">✦</span>推演关系</button>
    </template>
    <div v-if="error" class="relationship-status is-error" role="alert">
      <span>{{ error }}</span><button type="button" class="rel-button" @click="loadGraph">重试</button>
    </div>
    <div v-if="!loaded" class="relationship-status" role="status">{{ loading ? '正在展开关系图…' : '暂未加载关系图' }}</div>
    <div v-else class="relationship-content">
      <aside class="relationship-roster" :class="{ 'is-focused': focusKey !== centerKey, 'is-revealed': rosterEmphasis }" @animationend.self="rosterEmphasis = false">
        <div ref="rosterHeading" class="relationship-roster-heading" tabindex="-1" role="heading" aria-level="3">
          <div v-if="focusKey !== centerKey" class="relationship-roster-avatar relationship-focus-avatar"><span>{{ nameOf(focusKey).slice(0, 1) }}</span><img v-if="byKey.get(focusKey)?.avatar_path && !failedAvatars.has(byKey.get(focusKey).avatar_path)" :src="byKey.get(focusKey).avatar_path" alt="" @error="failedAvatars.add(byKey.get(focusKey).avatar_path)" /></div>
          <strong>{{ focusKey !== centerKey ? `${nameOf(focusKey)}的关系` : mode === 'user' ? '关系名册' : '相关角色' }}</strong>
          <span class="relationship-roster-count">{{ roster.length }}</span>
          <button v-if="focusKey !== centerKey" type="button" class="rel-button rel-icon relationship-roster-back" aria-label="返回全部关系" title="返回全部关系" @click="setRosterFocus(centerKey)">↶</button>
        </div>
        <Transition name="relationship-roster-view" mode="out-in">
        <div :key="focusKey" ref="rosterList" class="relationship-roster-list">
          <div
            v-for="node in roster" :key="node.key" class="relationship-roster-row" role="button" tabindex="0"
            :class="{ 'is-active': pairOpen && pairKeys.includes(node.key) }"
            @pointerenter="event => { if (event.pointerType !== 'touch') previewKey = node.key }" @pointerleave="previewKey = ''" @focus="event => { if (event.target.matches(':focus-visible')) previewKey = node.key }" @blur="previewKey = ''"
            @click="onRosterClick(node.key)" @keydown.enter.prevent="onRosterClick(node.key)" @keydown.space.prevent="onRosterClick(node.key)"
          >
            <div class="relationship-roster-avatar"><span>{{ node.display_name.slice(0, 1) }}</span><img v-if="node.avatar_path && !failedAvatars.has(node.avatar_path)" :src="node.avatar_path" alt="" @error="failedAvatars.add(node.avatar_path)" /></div>
            <div class="relationship-roster-copy"><span>{{ node.display_name }}</span><small v-if="relationSummary(node.key)">{{ relationSummary(node.key) }}</small></div>
            <span class="relationship-row-arrow" aria-hidden="true">›</span>
          </div>
          <p v-if="!roster.length" class="relationship-empty">还没有相关关系</p>
        </div>
        </Transition>
      </aside>
      <RelationshipCanvas
        ref="relationshipCanvas"
        :nodes="canvasNodes" :edges="scoped.edges" :groups="graph.groups" :center-key="centerKey"
        :focus-key="focusKey === 'user' ? '' : focusKey" :preview-key="previewKey" @connect="openPair" @node-click="onNodeClick" @edge-click="edge => openPair(edge.source, edge.target)"
      />
    </div>
    <div class="relationship-hint"><span class="relationship-desktop-hint">悬停读关系 · 点击头像编辑 · 拖动头像重合建立关系</span><span class="relationship-touch-hint">点击头像读写关系 · 拖动头像重合建立关系</span><span class="relationship-legend">实线 角色之间 <i /> 虚线 与我相关</span></div>
  </RelationshipWindow>

  <RelationshipWindow
    :visible="pairOpen" :title="`${nameOf(pairKeys[0])} 与 ${nameOf(pairKeys[1])}`" :z-index="11020"
    :suspended="!!confirmation" :close-disabled="saving" :before-close="confirmPairClose" wide @close="pairOpen = false" @after-leave="revealRoster"
  >
    <div class="relationship-pair-people">
      <div v-for="key in pairKeys" :key="key" class="relationship-pair-person">
        <div class="relationship-pair-avatar"><span>{{ nameOf(key).slice(0, 1) }}</span><img v-if="byKey.get(key)?.avatar_path && !failedAvatars.has(byKey.get(key).avatar_path)" :src="byKey.get(key).avatar_path" alt="" @error="failedAvatars.add(byKey.get(key).avatar_path)" /></div>
        <strong>{{ nameOf(key) }}</strong>
      </div>
    </div>
    <div class="relationship-directions">
      <section v-for="direction in pairDirections" :key="direction.key" class="relationship-direction">
        <div class="relationship-direction-heading">
          <strong>{{ nameOf(direction.source) }} → {{ nameOf(direction.target) }}</strong>
          <button type="button" class="rel-button rel-danger" v-if="direction.edge" :disabled="saving" @click="deleteDirection(direction)">删除</button>
        </div>
        <p class="relationship-direction-desc">{{ nameOf(direction.target) }}是{{ nameOf(direction.source) }}的什么人？</p>
        <textarea class="rel-input" v-model="drafts[direction.key]" :rows="3" :disabled="saving" :aria-label="`${nameOf(direction.source)}到${nameOf(direction.target)}的关系`" placeholder="例如：从小一起长大的朋友" />
      </section>
    </div>
    <p v-if="pairError" class="relationship-pair-error" role="alert">{{ pairError }}</p>
    <template #footer>
      <button type="button" class="rel-button" v-if="mode === 'user' && pairKeys.some(key => key !== 'user')" :disabled="saving" @click="focusPerson">在名册中查看{{ nameOf(pairKeys.find(key => key !== 'user')) }}的关系</button>
      <button type="button" class="rel-button rel-primary" :disabled="saving || !hasChanges || hasBlankChange" @click="savePair">{{ saving ? '保存中…' : pairSaved && !hasChanges ? '已保存' : '保存关系' }}</button>
    </template>
  </RelationshipWindow>
  <RelationshipWindow :visible="!!confirmation" :title="confirmation?.title || ''" :z-index="11030" @close="answerConfirmation(false)">
    <p class="relationship-confirm-copy">{{ confirmation?.message }}</p>
    <template #footer>
      <button type="button" class="rel-button" @click="answerConfirmation(false)">取消</button>
      <button type="button" class="rel-button rel-danger" @click="answerConfirmation(true)">{{ confirmation?.okText }}</button>
    </template>
  </RelationshipWindow>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import * as api from '../api/index.js'
import { userAvatar } from '../userConfig.js'
import { emitRelationshipChanged } from '../utils/characterReactionProducers.js'
import { characterKey, normalizeRelationshipGraph, scopeRelationshipGraph } from '../utils/relationshipLayout.js'
import RelationshipWindow from './RelationshipWindow.vue'
import RelationshipCanvas from './RelationshipCanvas.vue'

const props = defineProps({ visible: Boolean, mode: { type: String, default: 'user' }, centerCharacter: { type: Object, default: null } })
defineEmits(['close', 'auto-deduce'])
const toast = inject('toast', () => {})
const confirmation = ref(null)
let resolveConfirmation
function confirm(options) {
  confirmation.value = options
  return new Promise(resolve => { resolveConfirmation = resolve })
}
function answerConfirmation(answer) {
  confirmation.value = null
  resolveConfirmation?.(answer); resolveConfirmation = null
}
const title = computed(() => props.mode === 'user' ? '我的关系图' : `${props.centerCharacter?.display_name || '角色'} 的关系图`)
const centerKey = computed(() => props.mode === 'user' ? 'user' : characterKey(props.centerCharacter?.id))
const graph = ref({ nodes: [], edges: [], groups: [] })
const scoped = computed(() => scopeRelationshipGraph(graph.value, centerKey.value))
const me = computed(() => ({ key: 'user', display_name: '我', avatar_path: userAvatar.value }))
const byKey = computed(() => new Map([...graph.value.nodes, me.value].map(node => [node.key, node])))
const canvasNodes = computed(() => {
  // 无关系的头像保留用于直接创建；角色视图仍只绘制该角色相关的连线。
  const nodes = graph.value.nodes.filter(node => node.key !== centerKey.value)
  const center = byKey.value.get(centerKey.value) || { ...props.centerCharacter, key: centerKey.value }
  return [...nodes, center, ...(centerKey.value !== 'user' ? [me.value] : [])]
})
const focusKey = ref('user'), loaded = ref(false), loading = ref(false), error = ref('')
const previewKey = ref('')
const relationshipCanvas = ref(null), rosterHeading = ref(null), rosterList = ref(null), rosterEmphasis = ref(false)
let pendingRosterReveal = false
async function setRosterFocus(key) {
  focusKey.value = key; previewKey.value = ''; rosterEmphasis.value = false
  pendingRosterReveal = true
  await nextTick()
  if (!pairOpen.value) revealRoster()
}
async function revealRoster() {
  if (!pendingRosterReveal || !props.visible || pairOpen.value) return
  pendingRosterReveal = false
  rosterEmphasis.value = true
  await nextTick()
  if (!props.visible || pairOpen.value) return
  relationshipCanvas.value?.clearHover()
  if (rosterList.value) rosterList.value.scrollTop = 0
  rosterHeading.value?.focus({ preventScroll: true })
}
const failedAvatars = reactive(new Set())
const focusEdges = computed(() => scoped.value.edges.filter(edge => edge.source === focusKey.value || edge.target === focusKey.value))
const neighbors = computed(() => new Set(focusEdges.value.flatMap(edge => [edge.source, edge.target])))
const connectedKeys = computed(() => new Set(scoped.value.edges.flatMap(edge => [edge.source, edge.target])))
const roster = computed(() => canvasNodes.value.filter(node => node.key !== focusKey.value
  && (focusKey.value === 'user' ? connectedKeys.value.has(node.key) : neighbors.value.has(node.key)))
  .sort((a, b) => a.display_name.localeCompare(b.display_name, 'zh-CN') || a.key.localeCompare(b.key)))
function nameOf(key) { return byKey.value.get(key)?.display_name || props.centerCharacter?.display_name || '角色' }
function relationSummary(key) {
  const outgoing = focusEdges.value.find(edge => edge.source === focusKey.value && edge.target === key)
  const incoming = focusEdges.value.find(edge => edge.target === focusKey.value && edge.source === key)
  if (outgoing && incoming) return `双向 · ${outgoing.relationship_text}`
  if (outgoing) return `→ ${outgoing.relationship_text}`
  if (incoming) return `← ${incoming.relationship_text}`
  const count = scoped.value.edges.filter(edge => edge.source === key || edge.target === key).length
  return count ? `${count} 条角色关系` : ''
}
let loadVersion = 0
async function loadGraph() {
  const version = ++loadVersion
  loading.value = true; error.value = ''
  try {
    const result = await api.getRelationshipGraph()
    if (version !== loadVersion || !props.visible) return
    graph.value = normalizeRelationshipGraph(result); loaded.value = true
  } catch (err) { if (version === loadVersion) error.value = `关系图加载失败：${err.message}` }
  finally { if (version === loadVersion) loading.value = false }
}
watch(() => [props.visible, centerKey.value], ([visible]) => {
  ++loadVersion
  if (visible) { loaded.value = false; focusKey.value = centerKey.value; void loadGraph() }
})
if (props.visible) { focusKey.value = centerKey.value; void loadGraph() }
onBeforeUnmount(() => { ++loadVersion; answerConfirmation(false) })
function resetWorkspace() { pendingRosterReveal = false; rosterEmphasis.value = false; answerConfirmation(false); pairOpen.value = false; error.value = ''; previewKey.value = '' }

const pairOpen = ref(false), pairKeys = ref([]), drafts = reactive({}), saving = ref(false), pairError = ref(''), pairSaved = ref(false)
const pairDirections = computed(() => {
  if (pairKeys.value.length !== 2) return []
  const [a, b] = pairKeys.value
  const directions = a === 'user' ? [[a, b]] : [[a, b], [b, a]]
  return directions.map(([source, target]) => ({ source, target, key: `${source}>${target}`,
    edge: graph.value.edges.find(edge => edge.source === source && edge.target === target) }))
})
const changedDirections = computed(() => pairDirections.value.filter(direction => (drafts[direction.key] || '').trim() !== (direction.edge?.relationship_text || '')))
const hasChanges = computed(() => changedDirections.value.length > 0)
const hasBlankChange = computed(() => changedDirections.value.some(direction => !(drafts[direction.key] || '').trim()))
function openPair(a, b) {
  if (!a || !b || a === b) return
  pairKeys.value = b === 'user' ? [b, a] : [a, b]
  for (const key of Object.keys(drafts)) delete drafts[key]
  for (const direction of pairDirections.value) drafts[direction.key] = direction.edge?.relationship_text || ''
  pairError.value = ''; pairSaved.value = false; pairOpen.value = true
}
function onRosterClick(key) {
  if (focusKey.value === 'user' && !neighbors.value.has(key)) { void setRosterFocus(key); return }
  openPair(focusKey.value, key)
}
function onNodeClick(key) {
  if (key === centerKey.value) { void setRosterFocus(centerKey.value); return }
  if (key === focusKey.value) { void setRosterFocus(centerKey.value); return }
  openPair(focusKey.value, key)
}
async function confirmPairClose() {
  if (!hasChanges.value) return true
  return confirm({ title: '放弃修改', message: '还有未保存的关系修改，确定放弃吗？', okText: '放弃修改', danger: true })
}
async function focusPerson() {
  if (!await confirmPairClose()) return
  await setRosterFocus(pairKeys.value.find(key => key !== 'user'))
  pairOpen.value = false
}
function notifyChange(direction, action) {
  const source = byKey.value.get(direction.source), target = byKey.value.get(direction.target)
  emitRelationshipChanged({ characterId: direction.source === 'user' ? target.id : source.id, action, targetName: target.display_name })
}
async function savePair() {
  if (saving.value || !hasChanges.value || hasBlankChange.value) return
  saving.value = true; pairError.value = ''
  try {
    // 部分成功立即更新本地，失败保留未保存草稿，重试不会重复创建。
    for (const direction of [...changedDirections.value]) {
      const text = drafts[direction.key].trim(), source = byKey.value.get(direction.source), target = byKey.value.get(direction.target)
      const isUser = direction.source === 'user'
      const result = direction.edge
        ? await (isUser ? api.updateUserRelationship(direction.edge.id, text) : api.updateRelationship(direction.edge.id, text))
        : await (isUser ? api.createUserRelationship(target.id, text) : api.createRelationship(source.id, target.id, text))
      if (!result.relationship) throw new Error('服务器未返回已保存的关系')
      const data = isUser ? { nodes: graph.value.nodes, userEdges: [result.relationship] } : { nodes: graph.value.nodes, edges: [result.relationship] }
      const saved = normalizeRelationshipGraph(data).edges[0]
      if (!saved) throw new Error('服务器返回的关系不完整')
      graph.value = { ...graph.value, edges: [...graph.value.edges.filter(edge => edge.key !== saved.key), saved] }
      drafts[direction.key] = saved.relationship_text
      notifyChange(direction, direction.edge ? 'update' : 'create')
    }
    pairSaved.value = true; toast('关系已保存', 'success')
  } catch (err) { pairError.value = `保存失败：${err.message}` }
  finally { saving.value = false }
}
async function deleteDirection(direction) {
  if (saving.value || !direction.edge) return
  saving.value = true; pairError.value = ''
  try {
    const ok = await confirm({ title: '删除关系', message: `确定删除「${nameOf(direction.source)} → ${nameOf(direction.target)}」的关系吗？`, okText: '删除', danger: true })
    if (!ok) return
    await (direction.source === 'user' ? api.deleteUserRelationship(direction.edge.id) : api.deleteRelationship(direction.edge.id))
    graph.value = { ...graph.value, edges: graph.value.edges.filter(edge => edge.key !== direction.edge.key) }
    drafts[direction.key] = ''; notifyChange(direction, 'delete')
  } catch (err) { pairError.value = `删除失败：${err.message}` }
  finally { saving.value = false }
}
</script>

<style scoped>

.relationship-content { display: grid; grid-template-columns: 252px minmax(0, 1fr); flex: 1; min-height: 0; }
.relationship-roster { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--rel-line); background: color-mix(in srgb, var(--rel-gold) 5%, var(--rel-paper)); }
.relationship-roster-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 16px 10px; font-size: var(--fs-sm); color: var(--text-secondary); }
.relationship-roster-heading strong { flex: 1; min-width: 0; color: var(--text-primary); overflow-wrap: anywhere; }
.relationship-roster-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 12px; }
.relationship-roster-row { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 8px; cursor: pointer; border-radius: 0; border-bottom: 1px solid var(--rel-line); text-align: left; transition: background 0.3s; }
.relationship-roster-row:hover, .relationship-roster-row:focus-visible, .relationship-roster-row.is-active { background: color-mix(in srgb, var(--rel-gold) 12%, var(--rel-paper)); }
.relationship-roster-avatar, .relationship-pair-avatar { display: grid; place-items: center; position: relative; width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; overflow: hidden; background: color-mix(in srgb, var(--rel-gold) 12%, var(--rel-paper)); color: var(--rel-ink); font-weight: 700; }
.relationship-roster-avatar img, .relationship-pair-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.relationship-roster-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; color: var(--text-primary); font-size: var(--fs-sm); }
.relationship-roster-copy > span, .relationship-roster-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.relationship-roster-copy small { color: var(--text-secondary); font-size: var(--fs-xs); }
.relationship-row-arrow { color: var(--text-secondary); }
.relationship-hint { display: flex; justify-content: space-between; gap: 12px; flex-shrink: 0; padding: 10px 16px; border-top: 1px solid var(--rel-line); font-size: var(--fs-xs); line-height: 1.5; color: var(--text-secondary); }
.relationship-status { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: center; padding: 24px; color: var(--text-secondary); font-size: var(--fs-sm); line-height: 1.6; }
.relationship-status.is-error, .relationship-pair-error { color: var(--danger); }
.relationship-empty { margin: 16px 8px; font-size: var(--fs-sm); line-height: 1.6; color: var(--text-secondary); }
.relationship-pair-people { position: relative; display: flex; justify-content: center; align-items: flex-start; gap: 32px; padding: 6px 0 14px; }
.relationship-pair-person { display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 0; max-width: 44%; text-align: center; font-size: var(--fs-base); color: var(--text-primary); overflow-wrap: anywhere; }
.relationship-pair-avatar { width: 80px; height: 80px; font-size: 24px; border: 1px solid var(--rel-gold); outline: 1px solid var(--rel-line); outline-offset: 5px; margin: 6px; }
.relationship-directions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.relationship-directions:has(> :only-child) { grid-template-columns: minmax(0, 1fr); }
.relationship-direction { min-width: 0; }
.relationship-direction-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; font-size: var(--fs-sm); color: var(--text-primary); overflow-wrap: anywhere; }
.relationship-direction-desc { margin: 8px 0 10px; font-size: var(--fs-sm); line-height: 1.6; color: var(--text-secondary); }
.relationship-pair-error { margin: 0; font-size: var(--fs-sm); line-height: 1.6; }
@media (max-width: 767px) {
  .relationship-content { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(180px, 1fr) minmax(100px, 26%); }
  .relationship-roster { grid-row: 2; border-right: 0; border-top: 1px solid var(--rel-line); }
  .relationship-roster-heading { padding: 8px 12px 4px; }
  .relationship-roster-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; padding: 0 4px 8px; }
  .relationship-roster-row { gap: 6px; min-height: 48px; padding: 6px; }
  .relationship-roster-avatar { width: 30px; height: 30px; }
  .relationship-hint { padding: 8px 12px; }
  .relationship-directions { grid-template-columns: minmax(0, 1fr); gap: 16px; }
}
@media (prefers-reduced-motion: reduce) { .relationship-roster-row { transition: none; } }
.relationship-confirm-copy { margin: 0; font-size: 15px; line-height: 1.8; color: var(--rel-ink); }
.relationship-legend { white-space: nowrap; }
.relationship-legend i { display: inline-block; width: 18px; border-top: 1px dashed var(--rel-gold); margin: 0 5px; vertical-align: middle; }
.relationship-direction { padding-top: 12px; border-top: 1px solid var(--rel-line); }
.relationship-roster-heading { letter-spacing: .08em; padding-top: 20px; padding-bottom: 16px; }
@media (max-width: 767px) { .relationship-legend { display: none; } .relationship-roster-heading { padding: 8px 12px; } }
.relationship-touch-hint { display: none; }
@media (hover: none) { .relationship-touch-hint { display: inline; } .relationship-desktop-hint { display: none; } }
@media (max-width: 767px) and (max-height: 600px) {
  .relationship-content { grid-template-columns: 180px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
  .relationship-roster { grid-row: auto; border-top: 0; border-right: 1px solid var(--rel-line); }
  .relationship-roster-list { display: block; }
}
.relationship-roster-heading:focus { outline: none; }
.relationship-roster-count { font-variant-numeric: tabular-nums; }
.relationship-roster-back { flex-shrink: 0; }
.relationship-focus-avatar { flex-shrink: 0; }
.relationship-roster.is-focused .relationship-roster-heading { background: color-mix(in srgb, var(--rel-gold) 14%, var(--rel-paper)); border-bottom: 1px solid var(--rel-gold); }
.relationship-roster.is-revealed { animation: relationship-roster-attention 1.2s ease-out; }
@keyframes relationship-roster-attention {
  0%, 25% { box-shadow: inset 0 0 0 3px var(--rel-gold); background: color-mix(in srgb, var(--rel-gold) 20%, var(--rel-paper)); }
  100% { box-shadow: inset 0 0 0 0 transparent; background: color-mix(in srgb, var(--rel-gold) 5%, var(--rel-paper)); }
}
.relationship-roster-view-enter-active, .relationship-roster-view-leave-active { transition: opacity .3s, transform .3s; }
.relationship-roster-view-enter-from { opacity: 0; transform: translateX(-8px); }
.relationship-roster-view-leave-to { opacity: 0; transform: translateX(8px); }
@media (prefers-reduced-motion: reduce) {
  .relationship-roster.is-revealed { animation: none; }
  .relationship-roster-view-enter-active, .relationship-roster-view-leave-active { transition: none; }
  .relationship-roster-heading:focus { outline: 2px solid var(--rel-gold); outline-offset: -2px; }
}
</style>
