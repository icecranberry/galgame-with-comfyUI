<template>
  <div
    ref="host" class="relationship-canvas" :class="{ 'is-dragging': gesturing, 'is-overview': view.scale < 0.65 }" :style="canvasStyle" tabindex="0" role="group"
    aria-label="关系图画布，可拖动、双指缩放，方向键平移，加减键缩放，Home 复位"
    @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="cancelGesture"
    @lostpointercapture="onLostCapture" @wheel.prevent="onWheel" @click.capture="guardClick"
    @dblclick.self="fit" @mouseleave="leaveHover" @keydown="onKey"
  >
    <div class="relationship-world" :style="sceneStyle">
    <svg class="relationship-lines" aria-hidden="true">
      <defs>
        <marker :id="markerId" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M 0 1 L 7 4 L 0 7" fill="none" stroke="var(--rel-gold)" stroke-width="1.6" />
        </marker>
      </defs>
      <g>
        <circle v-for="radius in layout.radii" :key="radius" :r="radius" class="relationship-orbit" />
        <g v-for="edge in drawnEdges" :key="edge.key" v-memo="[edge, activeKey]" class="relationship-edge" :class="{ 'is-user': edge.kind === 'user', 'is-related': isRelated(edge), 'is-muted': activeKey && !isRelated(edge) }">
          <path :d="edge.path" class="relationship-edge-line" :marker-end="`url(#${markerId})`" />
          <path :d="edge.path" class="relationship-edge-hit" @mouseenter="enterEdge(edge)" @mouseleave="leaveHover" @click.stop="$emit('edge-click', edge)">
            <title>{{ nameOf(edge.source) }} → {{ nameOf(edge.target) }}：{{ edge.relationship_text }}</title>
          </path>
        </g>
      </g>
    </svg>
    <div class="relationship-people">
      <div v-for="group in layout.groups" :key="group.id" class="relationship-group" :style="{ left: `${group.x}px`, top: `${group.y}px` }" :title="group.name">{{ group.name }}</div>
      <div
        v-for="node in placedNodes" :key="node.key" v-memo="[node, activeKey, dragKey, dropTarget?.key, relatedKeys, searchKeys, searching, centerKey, focusKey, failedAvatarVersion]" :data-node-key="node.key" class="relationship-person"
        :class="{ 'is-center': node.key === centerKey, 'is-selected': node.key === activeKey, 'is-carried': node.key === dragKey, 'is-drop-target': node.key === dropTarget?.key, 'is-match': searchKeys.includes(node.key), 'show-match-name': searchKeys.length === 1 && searchKeys.includes(node.key), 'is-dimmed': (activeKey && !relatedKeys.has(node.key) && node.key !== dragKey && !searchKeys.includes(node.key)) || (searching && !searchKeys.includes(node.key) && node.key !== centerKey) }"
        :style="{ left: `${node.x}px`, top: `${node.y}px` }" role="button" tabindex="0"
        :aria-label="`${node.display_name}，点击查看关系，也可按住头像拖到另一头像上创建关系`" :aria-pressed="node.key === focusKey" :title="`${node.display_name}：按住头像拖到另一头像上，创建关系`"
        @pointerenter="event => { if (event.pointerType !== 'touch') enterHover(node.key) }" @pointerleave="leaveHover" @focus="event => { if (event.target.matches(':focus-visible')) enterHover(node.key) }" @blur="leaveHover" @click.stop="$emit('node-click', node.key)" @keydown.enter.stop.prevent="$emit('node-click', node.key)"
        @keydown.space.stop.prevent="$emit('node-click', node.key)"
      >
        <div class="relationship-avatar">
          <span>{{ (node.display_name || '?').slice(0, 2) }}</span>
          <img v-if="node.avatar_path && !failedAvatars.has(node.avatar_path)" :src="node.avatar_path" alt="" draggable="false" @error="failedAvatars.add(node.avatar_path)" />
        </div>
        <span class="relationship-name">{{ node.display_name }}</span>
      </div>
    </div>
    </div>
    <Transition name="relationship-peek">
      <aside v-if="peekKey && !gesturing" class="relationship-peek" :aria-label="`${nameOf(peekKey)}的关系`" @pointerdown.stop @wheel.stop @mouseenter="holdHover" @mouseleave="leaveHover">
        <header><strong>{{ nameOf(peekKey) }}</strong><span>{{ peekEdges.length ? `${peekEdges.length} 条关系` : '尚未建立关系' }}</span></header>
        <p class="relationship-peek-drag"><span aria-hidden="true">↔</span>按住头像拖到另一头像上，即可创建关系</p>
        <div class="relationship-peek-list">
          <button v-for="edge in peekEdges" :key="edge.key" type="button" class="relationship-peek-row" @click.stop="$emit('edge-click', edge)">
            <span>{{ nameOf(edge.source) }} <i aria-hidden="true">→</i> {{ nameOf(edge.target) }}</span>
            <p>{{ edge.relationship_text }}</p>
          </button>
          <p v-if="!peekEdges.length" class="relationship-peek-empty">点击头像，为你们写下第一段关系。</p>
        </div>
      </aside>
    </Transition>
    <div v-if="dragKey && gesturing" class="relationship-drop-hint" role="status">{{ dropTarget ? `松开，与${dropTarget.display_name}建立关系` : '拖到另一个头像上建立关系' }}</div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { findRelationshipDropTarget, incidentRelationships, layoutRelationships, relationshipCurve } from '../utils/relationshipLayout.js'

const props = defineProps({
  nodes: { type: Array, required: true }, edges: { type: Array, required: true },
  groups: { type: Array, default: () => [] }, centerKey: { type: String, required: true },
  focusKey: { type: String, default: '' }, previewKey: { type: String, default: '' },
  searchKeys: { type: Array, default: () => [] }, searching: Boolean,
})
const emit = defineEmits(['node-click', 'edge-click', 'connect'])
const host = ref(null), size = reactive({ width: 800, height: 600 })
const view = reactive({ x: 0, y: 0, scale: 1 }), gesturing = ref(false)
const failedAvatars = reactive(new Set())
const failedAvatarVersion = computed(() => failedAvatars.size)
const markerId = `relationship-arrow-${useId().replace(/[^a-z0-9-]/gi, '')}`
const layout = computed(() => layoutRelationships(props.nodes.filter(node => node.key !== props.centerKey), props.groups, size.width < 600))
const dragKey = ref(''), dragOffset = reactive({ x: 0, y: 0 })
const baseNodes = computed(() => [...layout.value.nodes, ...props.nodes.filter(node => node.key === props.centerKey).map(node => ({ ...node, x: 0, y: 0 }))])
const placedNodes = computed(() => baseNodes.value.map(node => node.key === dragKey.value
  ? { ...node, x: node.x + dragOffset.x, y: node.y + dragOffset.y } : node))
const hoverKey = ref(''), hoverEdge = ref(null)
let hoverTimer
function holdHover() { clearTimeout(hoverTimer) }
function clearHover() { holdHover(); hoverKey.value = ''; hoverEdge.value = null }
defineExpose({ clearHover })
function enterHover(key) { if (pointers.size || gesturing.value) return; holdHover(); hoverEdge.value = null; hoverKey.value = key }
function enterEdge(edge) { if (pointers.size || gesturing.value) return; holdHover(); hoverEdge.value = edge; hoverKey.value = '' }
function leaveHover() { if (pointers.size || gesturing.value) return; holdHover(); hoverTimer = setTimeout(() => { hoverKey.value = ''; hoverEdge.value = null }, 500) }
watch(() => props.previewKey, key => { if (key) enterHover(key); else leaveHover() })
const peekKey = computed(() => hoverKey.value || hoverEdge.value?.source || props.previewKey || props.focusKey)
// 名册的选中范围持续生效；悬停只预览文字，不能覆盖已选角色的连线。
const activeKey = computed(() => props.focusKey || dragKey.value || peekKey.value)
const peekEdges = computed(() => hoverEdge.value ? [hoverEdge.value] : incidentRelationships(props.edges, peekKey.value))
const avatarScale = computed(() => Math.min(1.4, Math.max(1, 28 / (64 * view.scale))))
// 短窗口缩小全图时，中心头像也受内圈空隙约束，避免盖住外围人物。
const centerScale = computed(() => Math.min(Math.max(1, 70 / (100 * view.scale)), Math.max(1, (layout.value.radii.at(-1) - 56) / 50)))
const canvasStyle = computed(() => ({ '--avatar-scale': avatarScale.value, '--center-scale': centerScale.value,
  '--label-scale': Math.max(1, 12 / (14 * view.scale)), '--group-scale': Math.max(1, 11 / (14 * view.scale)),
  '--center-label-gap': `${8 + 50 * (centerScale.value - 1)}px`, '--center-label-scale': Math.max(1, 14 / (18 * view.scale)) }))
const baseNodeMap = computed(() => new Map(baseNodes.value.map(node => [node.key, { ...node,
  radius: node.key === props.centerKey ? 50 * centerScale.value : 32 * avatarScale.value }])))
const nodeMap = computed(() => {
  if (!dragKey.value) return baseNodeMap.value
  const nodes = new Map(baseNodeMap.value), node = nodes.get(dragKey.value)
  if (node) nodes.set(node.key, { ...node, x: node.x + dragOffset.x, y: node.y + dragOffset.y })
  return nodes
})
const dropTarget = computed(() => findRelationshipDropTarget(nodeMap.value.get(dragKey.value), [...nodeMap.value.values()]))
const relatedKeys = computed(() => new Set([activeKey.value, props.centerKey, ...props.edges.filter(isRelated).flatMap(edge => [edge.source, edge.target])]))
function isRelated(edge) { return edge.source === activeKey.value || edge.target === activeKey.value }
function nameOf(key) { return nodeMap.value.get(key)?.display_name || '' }
// 平移不改路径，拖动只重算端点发生变化的边；悬停仅展开相关边。
const orderedEdges = computed(() => [...props.edges].sort((a, b) => Number(isRelated(a)) - Number(isRelated(b))))
let edgeCache = new WeakMap()
const drawnEdges = computed(() => orderedEdges.value.flatMap(edge => {
  const source = nodeMap.value.get(edge.source), target = nodeMap.value.get(edge.target)
  if (!source || !target) return []
  const bundled = !isRelated(edge) && edge.source !== props.centerKey && edge.target !== props.centerKey
  const cached = edgeCache.get(edge)
  if (cached?.source === source && cached.target === target && cached.bundled === bundled && cached.text === edge.relationship_text) return [cached.value]
  const value = { ...edge, path: relationshipCurve(source, target, bundled) }
  edgeCache.set(edge, { source, target, bundled, text: edge.relationship_text, value })
  return [value]
}))
const sceneStyle = computed(() => ({ transform: `translate(${size.width / 2 + view.x}px, ${size.height / 2 + view.y}px) scale(${view.scale})` }))

function fit() {
  discardFrame()
  view.x = 0; view.y = 0
  const fitted = Math.min(1.2, (size.width - 24) / (layout.value.radius * 2), (size.height - 56) / (layout.value.radius * 2))
  // 放大页面或横屏时宁可平移浏览，也不把头像压成不可点击的像素点。
  view.scale = size.height < 320 ? Math.max(0.3, fitted) : fitted
}
function zoom(factor, x = size.width / 2, y = size.height / 2) {
  const current = inputView()
  const scale = Math.max(0.08, Math.min(2.5, current.scale * factor))
  const ratio = scale / current.scale
  pendingView = { x: x - size.width / 2 - (x - size.width / 2 - current.x) * ratio,
    y: y - size.height / 2 - (y - size.height / 2 - current.y) * ratio, scale }
  scheduleFrame()
}
function onWheel(event) {
  const rect = host.value.getBoundingClientRect()
  zoom(Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.004), event.clientX - rect.left, event.clientY - rect.top)
}
let frame = null, pendingView = null, pendingDrag = null
const inputView = () => pendingView || view
function scheduleFrame() {
  if (frame === null) frame = requestAnimationFrame(flushFrame)
}
function flushFrame() {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
  if (pendingView) { Object.assign(view, pendingView); pendingView = null }
  if (pendingDrag) { Object.assign(dragOffset, pendingDrag); pendingDrag = null }
}
function discardFrame() {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null; pendingView = null; pendingDrag = null
}
const pointers = new Map()
let previous = null, origin = null, moved = false, observer
function pointerSnapshot() {
  const values = [...pointers.values()]
  return { x: values.reduce((sum, point) => sum + point.x, 0) / values.length,
    y: values.reduce((sum, point) => sum + point.y, 0) / values.length,
    distance: values.length > 1 ? Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y) : 0 }
}
function pointerDown(event) {
  if (event.button !== 0) return
  flushFrame()
  if (!pointers.size) {
    moved = false; origin = { x: event.clientX, y: event.clientY }
    dragKey.value = event.target.closest('[data-node-key]')?.dataset.nodeKey || ''
    dragOffset.x = 0; dragOffset.y = 0
  }
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  previous = pointerSnapshot()
  if (pointers.size > 1) { dragKey.value = ''; moved = true; gesturing.value = true }
}
function pointerMove(event) {
  if (!pointers.has(event.pointerId)) return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (!moved && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5) return
  moved = true; gesturing.value = true
  if (!host.value.hasPointerCapture?.(event.pointerId)) host.value.setPointerCapture(event.pointerId)
  const current = pointerSnapshot()
  if (previous.distance && current.distance) {
    const rect = host.value.getBoundingClientRect()
    zoom(current.distance / previous.distance, previous.x - rect.left, previous.y - rect.top)
  }
  if (dragKey.value && pointers.size === 1) {
    pendingDrag = { x: (event.clientX - origin.x) / inputView().scale, y: (event.clientY - origin.y) / inputView().scale }
  } else {
    const next = inputView()
    pendingView = { ...next, x: next.x + current.x - previous.x, y: next.y + current.y - previous.y }
  }
  previous = current
  scheduleFrame()
}
function pointerUp(event) {
  if (!pointers.has(event.pointerId)) return
  flushFrame() // 松开时先提交最后一帧，避免按过期位置判断重合。
  if (moved && dragKey.value && dropTarget.value) emit('connect', dragKey.value, dropTarget.value.key)
  dragKey.value = ''
  pointers.delete(event.pointerId)
  previous = pointers.size ? pointerSnapshot() : null
  if (!pointers.size) gesturing.value = false
}
function cancelGesture() { discardFrame(); pointers.clear(); previous = null; dragKey.value = ''; gesturing.value = false }
// 触屏会先在头像上隐式捕获；转交给画布时，头像冒泡的 lost 不是手势取消。
function onLostCapture(event) {
  if (event.target === host.value && pointers.has(event.pointerId)) cancelGesture()
}
function guardClick(event) { if (moved) { event.stopPropagation(); event.preventDefault(); moved = false } }
function onKey(event) {
  if (event.target !== host.value) return
  flushFrame()
  const steps = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }
  if (steps[event.key]) { event.preventDefault(); view.x += steps[event.key][0]; view.y += steps[event.key][1] }
  if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.25) }
  if (event.key === '-') { event.preventDefault(); zoom(0.8) }
  if (event.key === 'Home') { event.preventDefault(); fit() }
}
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    size.width = entry.contentRect.width; size.height = entry.contentRect.height
    if (size.width && size.height) fit()
  })
  observer.observe(host.value)
})
watch(() => props.centerKey, fit)
watch(() => props.searchKeys, keys => {
  if (keys.length !== 1) return
  flushFrame()
  const node = baseNodeMap.value.get(keys[0])
  if (!node) return
  // 唯一搜索结果放到可辨认、可操作的尺度，位置不重新排布。
  view.scale = Math.max(view.scale, 0.7)
  view.x = -node.x * view.scale; view.y = -node.y * view.scale
})
watch(() => props.searching, searching => { if (!searching) fit() })
onBeforeUnmount(() => { observer?.disconnect(); clearTimeout(hoverTimer); discardFrame(); edgeCache = new WeakMap() })
</script>

<style scoped>
.relationship-canvas { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: radial-gradient(circle at center, color-mix(in srgb, var(--rel-gold) 6%, transparent), transparent 65%), var(--rel-canvas-bg); touch-action: none; cursor: grab; }
.relationship-canvas:focus-visible { outline: 2px solid var(--rel-gold); outline-offset: -3px; }
.relationship-canvas.is-dragging { cursor: grabbing; }
.relationship-world { position: absolute; top: 0; left: 0; width: 0; height: 0; transform-origin: 0 0; will-change: transform; }
.relationship-lines { position: absolute; top: 0; left: 0; width: 1px; height: 1px; overflow: visible; }
.relationship-orbit { fill: none; stroke: var(--rel-line); stroke-width: 1; stroke-dasharray: 2 10; pointer-events: none; }
.relationship-edge { opacity: 0.35; transition: opacity 0.3s; }
.relationship-edge.is-user { opacity: 0.55; }
.relationship-edge.is-user .relationship-edge-line { stroke-dasharray: 6 5; }
.relationship-edge.is-related { opacity: 1; }
.relationship-edge.is-muted { opacity: 0.06; }
.relationship-edge:has(.relationship-edge-hit:hover) { opacity: 1; }
.relationship-edge-line { fill: none; stroke: var(--rel-gold); stroke-width: 1; vector-effect: non-scaling-stroke; pointer-events: none; }
.relationship-edge.is-related .relationship-edge-line { stroke-width: 2.5; }
.relationship-edge-hit { fill: none; stroke: transparent; stroke-width: 14; cursor: pointer; }
.relationship-people { pointer-events: none; position: absolute; top: 0; left: 0; width: 0; height: 0; }
.relationship-person { pointer-events: auto; position: absolute; width: 104px; margin-left: -52px; margin-top: -32px; text-align: center; cursor: grab; user-select: none; transition: opacity 0.3s; }
.relationship-avatar { position: relative; display: grid; place-items: center; width: 64px; height: 64px; margin: auto; border: 2px solid var(--rel-gold); border-radius: 50%; background: var(--rel-paper); box-shadow: 0 0 0 4px var(--rel-paper), 0 0 0 5px var(--rel-line); color: var(--rel-ink); font-size: 22px; font-weight: 700; overflow: hidden; transform: scale(var(--avatar-scale)); transition: box-shadow 0.3s, border-color 0.3s; }
.relationship-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.relationship-person:hover .relationship-avatar, .relationship-person:focus-visible .relationship-avatar, .relationship-person.is-selected .relationship-avatar, .relationship-person.is-match .relationship-avatar { border-color: var(--rel-gold); box-shadow: 0 0 0 4px var(--rel-paper), 0 0 0 6px var(--rel-gold); }
.relationship-person:focus-visible { outline: none; }
.relationship-person.is-dimmed { opacity: 0.55; }
.relationship-person.is-center { width: 144px; margin-left: -72px; margin-top: -50px; }
.relationship-person.is-center .relationship-avatar { width: 100px; height: 100px; font-size: 36px; border-width: 4px; transform: scale(var(--center-scale)); }
.relationship-name { display: block; width: 100%; margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-size: 14px; line-height: 1.4; font-weight: 600; text-shadow: 0 1px var(--rel-canvas-bg); }
.relationship-name { transform: scale(var(--label-scale)); transform-origin: top center; }
.is-overview .relationship-person:not(.is-center) .relationship-name { visibility: hidden; }
.is-overview .relationship-person:is(:hover, :focus-visible, .show-match-name, .is-selected) .relationship-name { visibility: visible; background: var(--bg-secondary); border-radius: var(--radius-sm); }
.relationship-person:is(:hover, :focus-visible, .is-match, .is-selected) { z-index: 1; }
.is-center .relationship-name { font-size: 18px; margin-top: var(--center-label-gap); transform: scale(var(--center-label-scale)); }
.relationship-group { position: absolute; width: 160px; margin-left: -80px; margin-top: -10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; color: var(--text-secondary); font-size: 14px; letter-spacing: 0.08em; pointer-events: none; transform: scale(var(--group-scale)); }

@media (prefers-reduced-motion: reduce) { .relationship-edge, .relationship-person, .relationship-avatar { transition: none; } }
.relationship-person.is-carried { z-index: 4; cursor: grabbing; opacity: 1; }
.relationship-person.is-drop-target { opacity: 1; z-index: 3; }
.relationship-person.is-drop-target .relationship-avatar { outline: 4px dashed var(--rel-gold); outline-offset: 10px; }
.relationship-drop-hint { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); padding: 10px 16px; border: 1px solid var(--rel-gold); border-radius: 30px; background: var(--rel-paper); color: var(--rel-ink); font-size: 13px; max-width: 90%; text-align: center; pointer-events: none; }
.relationship-peek { position: absolute; left: 18px; bottom: 18px; width: min(330px, calc(100% - 36px)); max-height: 42%; display: flex; flex-direction: column; background: var(--rel-paper); border: 1px solid var(--rel-gold); border-radius: 2px 16px 2px 16px; box-shadow: 0 8px 26px rgb(0 0 0 / 12%); cursor: default; touch-action: pan-y; }
.relationship-peek header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--rel-line); }
.relationship-peek header strong { font-size: 15px; overflow-wrap: anywhere; }
.relationship-peek header > span { font-size: 12px; color: var(--rel-muted); white-space: nowrap; }
.relationship-peek-drag { display: flex; align-items: flex-start; gap: 7px; flex-shrink: 0; margin: 0; padding: 10px 14px; border-bottom: 1px solid var(--rel-line); background: color-mix(in srgb, var(--rel-gold) 9%, var(--rel-paper)); color: var(--rel-ink); font-size: 13px; line-height: 1.6; }
.relationship-peek-drag > span { color: var(--rel-gold); font-size: 17px; line-height: 1.25; }
.relationship-peek-list { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.relationship-peek-row { display: block; width: 100%; background: transparent; color: var(--rel-ink); border: 0; border-bottom: 1px solid var(--rel-line); border-radius: 0; padding: 10px 14px; font: inherit; text-align: left; cursor: pointer; box-shadow: none; transition: background .3s; }
.relationship-peek-row:hover { background: color-mix(in srgb, var(--rel-gold) 10%, transparent); transform: none; }
.relationship-peek-row > span { display: block; font-size: 12px; color: var(--rel-muted); overflow-wrap: anywhere; }
.relationship-peek-row i { margin: 0 4px; color: var(--rel-gold); font-style: normal; }
.relationship-peek-row p, .relationship-peek-empty { font-size: 14px; line-height: 1.65; margin: 5px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.relationship-peek-empty { padding: 10px 14px 14px; color: var(--rel-muted); }
.relationship-peek-enter-active, .relationship-peek-leave-active { transition: opacity .3s, transform .3s; }
.relationship-peek-enter-from, .relationship-peek-leave-to { opacity: 0; transform: translateY(8px); }
.relationship-peek-leave-active { pointer-events: none; }
@media (max-width: 767px) { .relationship-peek { left: 10px; bottom: 10px; width: min(300px, calc(100% - 20px)); max-height: 48%; } }
@media (hover: none) { .relationship-peek { display: none; } }
@media (prefers-reduced-motion: reduce) { .relationship-peek-enter-active, .relationship-peek-leave-active { transition: none; } }
</style>
