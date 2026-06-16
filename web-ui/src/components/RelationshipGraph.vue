<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="rel-overlay" @click.self="$emit('close')">
        <div class="rel-panel">
          <!-- Header -->
          <div class="rel-header">
            <h3>🔗 {{ centerCharacter.display_name }} 的关系图</h3>
            <button class="rel-close" @click="$emit('close')">✕</button>
          </div>

          <!-- Canvas -->
          <div class="rel-canvas-wrap">
            <VueFlow
              v-model="elements"
              :node-types="nodeTypes"
              :default-viewport="{ x: 0, y: 0, zoom: 1 }"
              :min-zoom="0.3"
              :max-zoom="2"
              :edges-updatable="false"
              :is-valid-connection="isValidConnection"
              fit-view-on-init
              @connect="onConnect"
              @edge-click="onEdgeClick"
            >
              <Background :gap="24" />

              <!-- Custom character node -->
              <template #node-charNode="nodeProps">
                <CharacterNode
                  :data="nodeProps.data"
                  :is-center="nodeProps.data.isCenter"
                />
              </template>

              <!-- Custom edge label styling -->
            </VueFlow>
          </div>

          <!-- Hint -->
          <div class="rel-hint">
            💡 从{{ centerCharacter.display_name }}的头像按住拖拽到其他角色即可连线，例如{{ centerCharacter.display_name }} —老板→ 小明，代表小明是{{ centerCharacter.display_name }}的老板。
          </div>
        </div>

        <!-- ═══════════════════════════════════════════
             关系输入弹窗
             ═══════════════════════════════════════════ -->
        <div v-if="inputDialog.show" class="rel-dialog-overlay" @click.self="cancelInput">
          <div class="rel-dialog">
            <div class="rel-dialog-header">
              <span>{{ inputDialog.isEdit ? '编辑关系' : '新建关系' }}</span>
              <button class="rel-dialog-close" @click="cancelInput">✕</button>
            </div>
            <div class="rel-dialog-body">
              <p class="rel-dialog-desc">
                {{ inputDialog.isEdit
                  ? `${centerCharacter.display_name} → ${inputDialog.targetName}`
                  : `${centerCharacter.display_name} → ${inputDialog.targetName}`
                }}
              </p>
              <input
                ref="inputRef"
                v-model="inputDialog.text"
                class="rel-input"
                placeholder="输入关系，如：女同事"
                @keydown.enter="confirmInput"
              />
              <div class="rel-dialog-actions">
                <button v-if="inputDialog.isEdit" class="btn-ghost danger" @click="deleteEdge">🗑 删除</button>
                <div class="rel-dialog-actions-right">
                  <button class="btn-ghost" @click="cancelInput">取消</button>
                  <button class="btn-primary" :disabled="!inputDialog.text.trim()" @click="confirmInput">
                    {{ inputDialog.isEdit ? '保存' : '确认' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, markRaw, inject } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import * as api from '../api/index.js'
import CharacterNode from './CharacterNode.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  centerCharacter: { type: Object, required: true },
  allCharacters: { type: Array, required: true },
})

const emit = defineEmits(['close'])
const confirmFn = inject('confirm')

const { addEdges, removeEdges } = useVueFlow()
const nodeTypes = markRaw({ charNode: markRaw(CharacterNode) })

const elements = ref([])

const inputRef = ref(null)

// ── Input dialog ──
const inputDialog = reactive({
  show: false,
  isEdit: false,
  text: '',
  targetName: '',
  sourceId: '',
  targetId: '',
  sourceHandle: null,
  targetHandle: null,
  edgeId: null,   // non-null when editing existing
  pendingEdge: null, // { source, target, sourceHandle, targetHandle }
})

// ── Existing relationships (loaded from API) ──
const existingRels = ref([])

// ── Layout constants ──
const CENTER_X = 450
const CENTER_Y = 380
const RADIUS = 280

// ── isValidConnection: only allow center → other ──
function isValidConnection(connection) {
  // source must be the center character
  if (connection.source !== String(props.centerCharacter.id)) return false
  // target must not be the center character
  if (connection.target === String(props.centerCharacter.id)) return false
  // no duplicate edges
  const exists = elements.value.some(
    el => el.source === connection.source && el.target === connection.target
  )
  if (exists) return false
  return true
}

// ── Build nodes / edges from characters ──
async function buildGraph() {
  const center = props.centerCharacter
  const others = props.allCharacters.filter(c => c.id !== center.id)

  // Build nodes synchronously first — show avatars immediately
  const graphNodes = []

  // Center node
  graphNodes.push({
    id: String(center.id),
    type: 'charNode',
    position: { x: CENTER_X - 60, y: CENTER_Y - 60 },
    data: {
      id: center.id,
      display_name: center.display_name,
      avatar_path: center.avatar_path,
      avatar_color: center.avatar_color,
      isCenter: true,
    },
    draggable: false,
    selectable: false,
    connectable: true,
  })

  // Other nodes: circular layout
  const angleStep = (2 * Math.PI) / Math.max(others.length, 1)
  others.forEach((c, i) => {
    const angle = i * angleStep - Math.PI / 2
    const x = CENTER_X + RADIUS * Math.cos(angle) - 36
    const y = CENTER_Y + RADIUS * Math.sin(angle) - 36
    graphNodes.push({
      id: String(c.id),
      type: 'charNode',
      position: { x, y },
      data: {
        id: c.id,
        display_name: c.display_name,
        avatar_path: c.avatar_path,
        avatar_color: c.avatar_color,
        isCenter: false,
      },
      draggable: true,
      selectable: false,
      connectable: true,
    })
  })

  // Load existing relationships from API
  try {
    const res = await api.getRelationships(center.id)
    existingRels.value = res.relationships || []
  } catch (err) {
    console.warn('[RelationshipGraph] failed to load relationships:', err.message)
    existingRels.value = []
  }

  // Collect node IDs for edge validation
  const nodeIds = new Set(graphNodes.map(n => n.id))

  // Build edges — only include those whose source AND target exist in current nodes
  // Also compute sourceHandle based on target position relative to center
  const nodePosMap = Object.fromEntries(graphNodes.map(n => [n.id, n.position]))
  const centerPos = { x: CENTER_X, y: CENTER_Y }

  const graphEdges = existingRels.value
    .filter(rel => nodeIds.has(String(rel.from_character_id)) && nodeIds.has(String(rel.to_character_id)))
    .map(rel => {
      const targetPos = nodePosMap[String(rel.to_character_id)]
      let sourceHandle = 'source-top'
      let targetHandle = 'target-top'
      if (targetPos) {
        const dx = targetPos.x + 36 - centerPos.x
        const dy = targetPos.y + 36 - centerPos.y
        if (Math.abs(dx) > Math.abs(dy)) {
          sourceHandle = dx > 0 ? 'source-right' : 'source-left'
          targetHandle = dx > 0 ? 'target-left' : 'target-right'
        } else {
          sourceHandle = dy > 0 ? 'source-bottom' : 'source-top'
          targetHandle = dy > 0 ? 'target-top' : 'target-bottom'
        }
      }
      return {
        id: `e-${rel.id}`,
        source: String(rel.from_character_id),
        target: String(rel.to_character_id),
        sourceHandle,
        targetHandle,
        label: rel.relationship_text,
        style: { stroke: 'var(--accent, #e07b6c)', strokeWidth: 3 },
        labelStyle: { fill: 'var(--text-bright, #333)', fontWeight: 600, fontSize: 13 },
        labelBgStyle: { fill: 'rgba(255,255,255,0.92)', fillOpacity: 0.92 },
        labelBgPadding: [8, 4],
        labelBgBorderRadius: 6,
        animated: false,
        markerEnd: { type: 'arrowclosed', width: 12, height: 12, color: 'var(--accent, #e07b6c)' },
      }
    })

  console.log('[RelationshipGraph] built', graphNodes.length, 'nodes,', graphEdges.length, 'edges (filtered from', existingRels.value.length, 'relations)')

  // Set nodes first via v-model, wait for vue-flow to build nodeLookup, then add edges
  elements.value = graphNodes
  await new Promise(r => setTimeout(r, 0))
  if (graphEdges.length > 0) addEdges(graphEdges)
}

// ── Watch visible / centerCharacter ──
watch(
  () => [props.visible, props.centerCharacter?.id],
  ([v]) => {
    if (v) buildGraph()
  },
  { immediate: true }
)

// ── Connect handler (new edge drawn) ──
function onConnect(connection) {
  console.log('[RelationshipGraph] onConnect:', connection)
  const targetNode = elements.value.find(el => el.id === connection.target)
  if (!targetNode) {
    console.warn('[RelationshipGraph] onConnect: target node not found for id', connection.target)
    return
  }

  inputDialog.show = true
  inputDialog.isEdit = false
  inputDialog.text = ''
  inputDialog.targetName = targetNode.data.display_name
  inputDialog.sourceId = connection.source
  inputDialog.targetId = connection.target
  inputDialog.sourceHandle = connection.sourceHandle || null
  inputDialog.targetHandle = connection.targetHandle || null
  inputDialog.edgeId = null
  inputDialog.pendingEdge = connection

  nextTick(() => inputRef.value?.focus())
}

// ── Edge click → edit ──
function onEdgeClick({ edge }) {
  const relId = edge.id.startsWith('e-') ? parseInt(edge.id.slice(2)) : null
  if (!relId) return

  const targetNode = elements.value.find(el => el.id === edge.target)
  inputDialog.show = true
  inputDialog.isEdit = true
  inputDialog.text = edge.label || ''
  inputDialog.targetName = targetNode?.data?.display_name || ''
  inputDialog.edgeId = relId
  inputDialog.pendingEdge = null
  inputDialog.sourceId = edge.source
  inputDialog.targetId = edge.target

  nextTick(() => inputRef.value?.focus())
}

function cancelInput() {
  inputDialog.show = false
  inputDialog.text = ''
  inputDialog.pendingEdge = null
  inputDialog.edgeId = null
  inputDialog.sourceHandle = null
  inputDialog.targetHandle = null
}

async function confirmInput() {
  const text = inputDialog.text.trim()
  if (!text) return

  if (inputDialog.isEdit) {
    // Edit existing
    try {
      const res = await api.updateRelationship(inputDialog.edgeId, text)
      if (res.error) {
        alert('保存失败: ' + res.error)
        return
      }
      const updated = res.relationship
      if (!updated) {
        alert('保存失败: 服务器返回数据异常')
        return
      }
      // Update edge label
      const edgeId = `e-${inputDialog.edgeId}`
      const edge = elements.value.find(el => el.id === edgeId)
      if (edge) edge.label = text
      // Update local cache
      const cached = existingRels.value.find(r => r.id === inputDialog.edgeId)
      if (cached) cached.relationship_text = text
    } catch (err) {
      console.error('[RelationshipGraph] update failed:', err.message)
      alert('保存失败: ' + err.message)
      return
    }
  } else {
    // Create new
    try {
      console.log('[RelationshipGraph] creating relationship:', {
        from: parseInt(inputDialog.sourceId),
        to: parseInt(inputDialog.targetId),
        text
      })
      const res = await api.createRelationship(
        parseInt(inputDialog.sourceId),
        parseInt(inputDialog.targetId),
        text
      )
      console.log('[RelationshipGraph] API response:', res)
      if (res.error) {
        alert('创建失败: ' + res.error)
        return
      }
      const created = res.relationship
      if (!created) {
        alert('创建失败: 服务器返回数据异常')
        return
      }
      // Add edge via imperative API
      const newEdge = {
        id: `e-${created.id}`,
        source: String(created.from_character_id),
        target: String(created.to_character_id),
        sourceHandle: inputDialog.sourceHandle || undefined,
        targetHandle: inputDialog.targetHandle || undefined,
        label: created.relationship_text,
        style: { stroke: 'var(--accent, #e07b6c)', strokeWidth: 3 },
        labelStyle: { fill: 'var(--text-bright, #333)', fontWeight: 600, fontSize: 13 },
        labelBgStyle: { fill: 'rgba(255,255,255,0.92)', fillOpacity: 0.92 },
        labelBgPadding: [8, 4],
        labelBgBorderRadius: 6,
        animated: false,
        markerEnd: { type: 'arrowclosed', width: 12, height: 12, color: 'var(--accent, #e07b6c)' },
      }
      addEdges([newEdge])
      existingRels.value.push(created)
    } catch (err) {
      console.error('[RelationshipGraph] create failed:', err.message)
      alert('创建失败: ' + err.message)
      return
    }
  }

  cancelInput()
}

// ── Delete edge from dialog ──
async function deleteEdge() {
  if (!inputDialog.edgeId) return
  const edgeId = `e-${inputDialog.edgeId}`
  const edge = elements.value.find(el => el.id === edgeId)

  const ok = await confirmFn({
    title: '删除关系',
    message: `确定删除和「${inputDialog.targetName}」的关系「${edge?.label || ''}」吗？`,
    okText: '删除',
    danger: true,
  })
  if (!ok) return

  try {
    await api.deleteRelationship(inputDialog.edgeId)
    removeEdges([edgeId])
    elements.value = elements.value.filter(el => el.id !== edgeId)
    existingRels.value = existingRels.value.filter(r => r.id !== inputDialog.edgeId)
  } catch (err) {
    console.error('[RelationshipGraph] delete failed:', err.message)
    alert('删除失败: ' + err.message)
    return
  }
  cancelInput()
}
</script>

<style scoped>
/* ── Overlay ── */
.rel-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 11000;
}
.rel-panel {
  background: #f4f1ee;
  border-radius: 18px;
  width: min(96vw, 960px);
  height: min(90vh, 700px);
  display: flex; flex-direction: column;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

/* ── Header ── */
.rel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 22px;
  border-bottom: 1px solid rgba(0,0,0,0.08);
  flex-shrink: 0;
}
.rel-header h3 { font-size: 17px; font-weight: 600; color: #333; }
.rel-close {
  width: 30px; height: 30px; border-radius: 50%;
  border: none; background: rgba(0,0,0,0.05);
  color: #666; font-size: 15px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.rel-close:hover { background: rgba(0,0,0,0.1); color: #333; }

/* ── Canvas wrap ── */
.rel-canvas-wrap {
  flex: 1;
  min-height: 0;
  background: #fafaf9;
}

/* ── Hint ── */
.rel-hint {
  padding: 10px 22px;
  border-top: 1px solid rgba(0,0,0,0.06);
  font-size: 12px; color: #999;
  flex-shrink: 0;
  text-align: center;
}

/* ── Input dialog ── */
.rel-dialog-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center;
  z-index: 12000;
}
.rel-dialog {
  background: #fff;
  border-radius: 14px;
  width: min(90vw, 420px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  overflow: hidden;
}
.rel-dialog-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  font-weight: 600; font-size: 15px; color: #333;
}
.rel-dialog-close {
  width: 26px; height: 26px; border-radius: 50%;
  border: none; background: rgba(0,0,0,0.04);
  color: #888; cursor: pointer; font-size: 13px;
  display: flex; align-items: center; justify-content: center;
}
.rel-dialog-close:hover { background: rgba(0,0,0,0.08); color: #333; }
.rel-dialog-body { padding: 16px 18px 18px; }
.rel-dialog-desc {
  font-size: 13px; color: #888; margin: 0 0 10px;
}
.rel-input {
  width: 100%; padding: 10px 12px;
  font-size: 14px; border-radius: 10px;
  border: 1px solid #d5d0ca; outline: none;
  background: #fafaf9; color: #333;
  box-sizing: border-box;
  font-family: inherit;
}
.rel-input:focus { border-color: #e07b6c; box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.1); }
.rel-dialog-actions {
  display: flex; justify-content: space-between; align-items: center; margin-top: 14px;
}
.rel-dialog-actions-right {
  display: flex; gap: 8px; margin-left: auto;
}

/* ── Reuse button styles ── */
.btn-primary {
  padding: 8px 18px; font-size: 13px; font-weight: 600;
  border-radius: 10px; border: none;
  background: #e07b6c; color: #fff;
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.btn-primary:hover { background: #d06a5a; }
.btn-primary:disabled { background: #c5c0ba; cursor: not-allowed; }
.btn-ghost {
  padding: 8px 18px; font-size: 13px;
  border-radius: 10px; border: 1px solid rgba(0,0,0,0.1);
  background: transparent; color: #666;
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.btn-ghost:hover { background: rgba(0,0,0,0.04); color: #333; }
.btn-ghost.danger { color: #e05555; border-color: rgba(224,85,85,0.25); }
.btn-ghost.danger:hover { background: rgba(224,85,85,0.06); color: #cc3a3a; }

/* ── Modal transition ── */
.modal-fade-enter-active { transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-leave-active { transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .rel-panel { animation: rel-pop 0.28s cubic-bezier(0.17, 0.89, 0.32, 1.25); }

@keyframes rel-pop {
  0% { transform: scale(0.92); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
</style>
