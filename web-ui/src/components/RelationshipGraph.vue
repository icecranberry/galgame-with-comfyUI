<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="rel-overlay" @click.self="$emit('close')">
        <div class="rel-panel">
          <!-- Header -->
          <div class="rel-header">
            <h3>🔗 {{ centerCharacter.display_name }} 的关系图</h3>
            <linshe-button variant="icon" @click="$emit('close')">&times;</linshe-button>
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
              @connect="onConnect"
              @edge-click="onEdgeClick"
              @pane-ready="onPaneReady"
            >
              <Background :gap="24" />

              <!-- Custom character node -->
              <template #node-charNode="nodeProps">
                <CharacterNode
                  :data="nodeProps.data"
                  :is-center="nodeProps.data.isCenter"
                />
              </template>

              <!-- 用户节点：与角色关系图同屏，便于把「你」也连进关系网 -->
              <template #node-userNode="nodeProps">
                <UserNode :data="nodeProps.data" />
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
        <Transition name="dialog-fade">
          <div v-if="inputDialog.show" class="rel-dialog-overlay" @mousedown.self="cancelInput">
            <div class="rel-dialog">
              <div class="rel-dialog-header">
                <span>{{ inputDialog.isEdit ? '编辑关系' : '新建关系' }}</span>
                <linshe-button variant="icon" @click="cancelInput">✕</linshe-button>
              </div>
              <div class="rel-dialog-body">
                <p class="rel-dialog-desc">
                  {{ (inputDialog.isEdit
                    ? `${centerCharacter.display_name} → ${inputDialog.targetName}`
                    : `${centerCharacter.display_name} → ${inputDialog.targetName}`)
                    + `：${inputDialog.targetName}是${centerCharacter.display_name}的什么人？`}}
                </p>
                <linshe-input
                  ref="inputRef"
                  v-model="inputDialog.text"
                  class="rel-input"
                  placeholder="输入关系，如：女同事"
                  @keydown.enter="confirmInput"
                />
                <!-- 亲密度：决定这两人能否在朋友圈同框、以及同框时的画面尺度 -->
                <div class="rel-intimacy">
                  <div class="rel-intimacy-label">
                    亲密度
                    <span class="rel-intimacy-hint">决定能否在朋友圈同框、以及画面尺度</span>
                  </div>
                  <div class="rel-intimacy-row">
                    <button
                      v-for="opt in INTIMACY_OPTIONS"
                      :key="opt.level"
                      type="button"
                      class="rel-intimacy-btn"
                      :class="{ active: inputDialog.intimacy === opt.level }"
                      :title="opt.desc"
                      @click="inputDialog.intimacy = opt.level"
                    >{{ opt.label }}</button>
                  </div>
                </div>
                <div class="rel-dialog-actions">
                  <linshe-button v-if="inputDialog.isEdit" variant="danger" @click="deleteEdge">🗑 删除</linshe-button>
                  <div class="rel-dialog-actions-right">
                    <linshe-button variant="secondary" @click="cancelInput">取消</linshe-button>
                    <linshe-button variant="primary" :disabled="!inputDialog.text.trim()" @click="confirmInput">
                      {{ inputDialog.isEdit ? '保存' : '确认' }}
                    </linshe-button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Transition>
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
import { emitRelationshipChanged } from '../utils/characterReactionProducers.js'
import CharacterNode from './CharacterNode.vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import UserNode from './UserNode.vue'
import { userAvatar, userNickname, loadUserConfig, loadUserAvatar } from '../userConfig.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  centerCharacter: { type: Object, required: true },
  allCharacters: { type: Array, required: true },
})

const emit = defineEmits(['close'])
const confirmFn = inject('confirm')
const toastFn = inject('toast')

const { addEdges, removeEdges, fitView } = useVueFlow()
// 与「我的关系图」同一套节点组件，这样两处视觉一致
const nodeTypes = markRaw({ charNode: markRaw(CharacterNode), userNode: markRaw(UserNode) })

const elements = ref([])
// 中心角色与「用户」的关系（后端 GET /api/relationships 顺带返回）
const userRel = ref(null)
const USER_NODE_ID = 'user'
let userInfoLoaded = false
/** 首次用到时才拉用户昵称/头像（关系图不总是打开，没必要启动就请求） */
async function ensureUserInfo() {
  if (userInfoLoaded) return
  userInfoLoaded = true
  try {
    await loadUserConfig()
    await loadUserAvatar()
  } catch { /* 取不到就用默认「我」 */ }
}
const paneReady = ref(false)

const inputRef = ref(null)

// ── Input dialog ──
const inputDialog = reactive({
  show: false,
  isEdit: false,
  text: '',
  intimacy: 1,           // 与后端一致：0 泛泛 / 1 熟悉 / 2 亲近 / 3 亲密
  targetName: '',
  sourceId: '',
  targetId: '',
  sourceHandle: null,
  targetHandle: null,
  edgeId: null,   // non-null when editing existing
  pendingEdge: null, // { source, target, sourceHandle, targetHandle }
})

/** 亲密度档位（label 与 desc 与后端 relationshipIntimacy.js 保持一致） */
const INTIMACY_OPTIONS = [
  { level: 0, label: '泛泛', desc: '职业性认识 / 上下级 / 对立 —— 不会在朋友圈同框' },
  { level: 1, label: '熟悉', desc: '相识但保持距离 —— 可同框，仅限公共场合、社交距离' },
  { level: 2, label: '亲近', desc: '朋友 / 搭档 —— 可同框，允许自然的亲昵举动' },
  { level: 3, label: '亲密', desc: '恋人 / 家人 —— 不做额外限制' },
]

// ── Existing relationships (loaded from API) ──
const existingRels = ref([])

// ── Layout constants ──
const CENTER_X = 540
const CENTER_Y = 456

// ── Compute optimal source/target handles based on target position relative to center ──
function computeHandles(targetPos) {
  const dx = targetPos.x + 36 - CENTER_X
  const dy = targetPos.y + 36 - CENTER_Y
  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      sourceHandle: dx > 0 ? 'source-right' : 'source-left',
      targetHandle: dx > 0 ? 'target-left' : 'target-right',
    }
  } else {
    return {
      sourceHandle: dy > 0 ? 'source-bottom' : 'source-top',
      targetHandle: dy > 0 ? 'target-top' : 'target-bottom',
    }
  }
}

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
  // 归档角色不进关系图：它们不参与任何活动，几十个节点挤在环上只会干扰拖拽连线
  const others = props.allCharacters.filter(c => c.id !== center.id && !c.archived)
  const radius = Math.max(336, Math.ceil(others.length * 16))

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
    const x = CENTER_X + radius * Math.cos(angle) - 36
    const y = CENTER_Y + radius * Math.sin(angle) - 36
    graphNodes.push({
      id: String(c.id),
      type: 'charNode',
      position: { x, y },
      data: {
        id: c.id,
        display_name: c.display_name,
        avatar_path: c.avatar_path,
        
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
    userRel.value = res.userRelationship || null
  } catch (err) {
    console.warn('[RelationshipGraph] failed to load relationships:', err.message)
    existingRels.value = []
    userRel.value = null
  }

  // ── 用户节点：放在中心角色的正上方留白处，避免与环形排布的角色挤在一起 ──
  // 只有真的存在「用户↔该角色」的关系时才加，免得图里凭空多一个孤立节点。
  await ensureUserInfo()
  if (userRel.value) {
    graphNodes.push({
      id: USER_NODE_ID,
      type: 'userNode',
      position: { x: CENTER_X - 60, y: CENTER_Y - radius - 110 },
      data: { avatar_url: userAvatar.value, nickname: userNickname.value || '我' },
      draggable: true,
      selectable: false,
      connectable: false,
    })
  }

  // Collect node IDs for edge validation
  const nodeIds = new Set(graphNodes.map(n => n.id))

  // Build edges — only include those whose source AND target exist in current nodes
  // Also compute sourceHandle based on target position relative to center
  const nodePosMap = Object.fromEntries(graphNodes.map(n => [n.id, n.position]))

  const graphEdges = existingRels.value
    .filter(rel => nodeIds.has(String(rel.from_character_id)) && nodeIds.has(String(rel.to_character_id)) && rel.relationship_text)
    .map(rel => {
      const targetPos = nodePosMap[String(rel.to_character_id)]
      const handles = targetPos ? computeHandles(targetPos) : { sourceHandle: 'source-top', targetHandle: 'target-top' }
      return {
        id: `e-${rel.id}`,
        source: String(rel.from_character_id),
        target: String(rel.to_character_id),
        sourceHandle: handles.sourceHandle,
        targetHandle: handles.targetHandle,
        label: rel.relationship_text,
        style: { stroke: 'var(--accent, var(--accent))', strokeWidth: 3 },
        labelStyle: { fill: 'var(--text-bright, #333)', fontWeight: 600, fontSize: 13 },
        labelBgStyle: { fill: 'var(--bg-secondary)', fillOpacity: 0.92 },
        labelBgPadding: [8, 4],
        labelBgBorderRadius: 6,
        animated: false,
        markerEnd: { type: 'arrowclosed', width: 12, height: 12, color: 'var(--accent, var(--accent))' },
      }
    })

  console.log('[RelationshipGraph] built', graphNodes.length, 'nodes,', graphEdges.length, 'edges (filtered from', existingRels.value.length, 'relations)')

  // 用户 ↔ 中心角色：用与角色间不同的配色（虚线），一眼区分「和你的关系」与「角色之间」
  if (userRel.value && userRel.value.text) {
    const userPos = nodePosMap[USER_NODE_ID]
    const handles = userPos ? computeHandles(userPos) : { sourceHandle: 'source-top', targetHandle: 'target-top' }
    graphEdges.push({
      id: `e-user-${userRel.value.id}`,
      source: String(center.id),
      target: USER_NODE_ID,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      label: userRel.value.text,
      style: { stroke: 'var(--accent, var(--accent))', strokeWidth: 3, strokeDasharray: '6 4' },
      labelStyle: { fill: 'var(--text-bright, #333)', fontWeight: 600, fontSize: 13 },
      labelBgStyle: { fill: 'var(--bg-secondary)', fillOpacity: 0.92 },
      labelBgPadding: [8, 4],
      labelBgBorderRadius: 6,
      animated: false,
      markerEnd: { type: 'arrowclosed', width: 12, height: 12, color: 'var(--accent, var(--accent))' },
    })
  }
  // Set nodes first via v-model, wait for vue-flow to build nodeLookup, then add edges
  elements.value = graphNodes
  await new Promise(r => setTimeout(r, 0))
  if (graphEdges.length > 0) addEdges(graphEdges)
  await nextTick()
  // Wait for VueFlow internal layout + custom node avatar images to settle
  await new Promise(r => requestAnimationFrame(r))
  await new Promise(r => requestAnimationFrame(r))
  if (paneReady.value) {
    fitView({ padding: 0.1, duration: 200 })
  }
  // Safety: delayed fitView after images have definitely loaded
  setTimeout(() => {
    fitView({ padding: 0.1, duration: 200 })
  }, 400)
}

// ── pane-ready: VueFlow 完成首次渲染后触发 ──
function onPaneReady() {
  paneReady.value = true
  // 若 buildGraph 已执行但 fitView 因 pane 未就绪而跳过，此处补刀
  if (elements.value.length > 0) {
    setTimeout(() => {
      fitView({ padding: 0.1, duration: 200 })
    }, 100)
  }
}

// ── Watch visible / centerCharacter ──
watch(
  () => [props.visible, props.centerCharacter?.id],
  ([v]) => {
    if (v) buildGraph()
    else paneReady.value = false
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
  inputDialog.intimacy = 1   // 与后端推断的兜底档一致
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
  // 回填已保存的亲密度（GET /relationships 已解析成 0~3；缺省按「熟悉」）
  inputDialog.intimacy = Number(existingRels.value.find(r => r.id === relId)?.intimacy ?? 1)
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
      const res = await api.updateRelationship(inputDialog.edgeId, text, inputDialog.intimacy)
      if (res.error) {
        toastFn('保存失败: ' + res.error, 'error')
        return
      }
      const updated = res.relationship
      if (!updated) {
        toastFn('保存失败: 服务器返回数据异常', 'error')
        return
      }
      // Update edge label
      const edgeId = `e-${inputDialog.edgeId}`
      const edge = elements.value.find(el => el.id === edgeId)
      if (edge) edge.label = text
      // Update local cache
      const cached = existingRels.value.find(r => r.id === inputDialog.edgeId)
      // ⚠ 2026-10-08 合并 v3.7.0：本地新增 intimacy 缓存（亲密度分级）、
      //    上游新增 emitRelationshipChanged 事件（通知外部刷新）—— 两者都要，合并保留。
      if (cached) {
        cached.relationship_text = text
        cached.intimacy = inputDialog.intimacy
      }
      emitRelationshipChanged({ characterId: props.centerCharacter?.id, action: 'update', targetName: inputDialog.targetName })
    } catch (err) {
      console.error('[RelationshipGraph] update failed:', err.message)
      toastFn('保存失败: ' + err.message, 'error')
      return
    }
  } else {
    // Create new
    try {
      console.log('[RelationshipGraph] creating relationship:', {
        from: parseInt(inputDialog.sourceId),
        to: parseInt(inputDialog.targetId),
        text,
        intimacy: inputDialog.intimacy,
      })
      const res = await api.createRelationship(
        parseInt(inputDialog.sourceId),
        parseInt(inputDialog.targetId),
        text,
        inputDialog.intimacy
      )
      console.log('[RelationshipGraph] API response:', res)
      if (res.error) {
        toastFn('创建失败: ' + res.error, 'error')
        return
      }
      const created = res.relationship
      if (!created) {
        toastFn('创建失败: 服务器返回数据异常', 'error')
        return
      }
      emitRelationshipChanged({ characterId: props.centerCharacter?.id, action: 'create', targetName: inputDialog.targetName })
      // Add edge via imperative API — compute optimal handles from target position
      const targetNode = elements.value.find(el => el.id === String(created.to_character_id))
      const handles = targetNode ? computeHandles(targetNode.position) : { sourceHandle: undefined, targetHandle: undefined }
      const newEdge = {
        id: `e-${created.id}`,
        source: String(created.from_character_id),
        target: String(created.to_character_id),
        sourceHandle: handles.sourceHandle,
        targetHandle: handles.targetHandle,
        label: created.relationship_text,
        style: { stroke: 'var(--accent, var(--accent))', strokeWidth: 3 },
        labelStyle: { fill: 'var(--text-bright, #333)', fontWeight: 600, fontSize: 13 },
        labelBgStyle: { fill: 'var(--bg-secondary)', fillOpacity: 0.92 },
        labelBgPadding: [8, 4],
        labelBgBorderRadius: 6,
        animated: false,
        markerEnd: { type: 'arrowclosed', width: 12, height: 12, color: 'var(--accent, var(--accent))' },
      }
      addEdges([newEdge])
      existingRels.value.push(created)
    } catch (err) {
      console.error('[RelationshipGraph] create failed:', err.message)
      toastFn('创建失败: ' + err.message, 'error')
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
    emitRelationshipChanged({ characterId: props.centerCharacter?.id, action: 'delete', targetName: inputDialog.targetName })
    elements.value = elements.value.filter(el => el.id !== edgeId)
    existingRels.value = existingRels.value.filter(r => r.id !== inputDialog.edgeId)
  } catch (err) {
    console.error('[RelationshipGraph] delete failed:', err.message)
    toastFn('删除失败: ' + err.message, 'error')
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
  background: var(--bg-secondary);
  border-radius: 18px;
  width: min(96vw, 1152px);
  height: min(90vh, 840px);
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

/* ── Header ── */
.rel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--glass-bg);
}
.rel-header h3 { margin: 0; font-size: 20px; font-weight: 700; color: var(--text-bright); }

/* ── Canvas wrap ── */
.rel-canvas-wrap {
  flex: 1;
  min-height: 0;
  background: var(--rel-canvas-bg);
}

/* ── Hint ── */
.rel-hint {
  padding: 12px 24px;
  border-top: 1px solid var(--border);
  font-size: 12px; color: var(--text-secondary);
  flex-shrink: 0;
  text-align: center;
  background: var(--glass-bg);
}

/* ── Input dialog ── */
.rel-dialog-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center;
  z-index: 12000;
}
.rel-dialog {
  background: var(--bg-secondary);
  border-radius: 14px;
  width: min(90vw, 420px);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.rel-dialog-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  font-weight: 600; font-size: 15px; color: var(--text-bright);
}
.rel-dialog-body { padding: 16px 18px 18px; }
.rel-dialog-desc {
  font-size: 13px; color: var(--text-secondary); margin: 0 0 10px;
}
.rel-input {
  width: 100%; padding: 10px 12px;
  font-size: 14px;
  box-sizing: border-box;
}
/* ── 亲密度选择（决定朋友圈同框与画面尺度） ── */
.rel-intimacy { margin-top: 10px; }
.rel-intimacy-label {
  display: flex; align-items: baseline; gap: 6px;
  font-size: 12px; font-weight: 600; color: var(--text-bright);
  margin-bottom: 6px;
}
.rel-intimacy-hint { font-size: 11px; font-weight: 400; color: var(--text-secondary); }
.rel-intimacy-row { display: flex; gap: 6px; }
.rel-intimacy-btn {
  flex: 1;
  padding: 5px 0;
  border-radius: 8px;
  border: 1px solid var(--glass-border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 12px; font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.rel-intimacy-btn:hover { color: var(--text-bright); border-color: var(--accent-light); }
.rel-intimacy-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent, #fff);
}

.rel-dialog-actions {
  display: flex; justify-content: space-between; align-items: center; margin-top: 14px;
}
.rel-dialog-actions-right {
  display: flex; gap: 8px; margin-left: auto;
}

/* ── Modal transition ── */
.modal-fade-enter-active { transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-leave-active { transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .rel-panel { animation: rel-pop 0.28s cubic-bezier(0.17, 0.89, 0.32, 1.25); }

@keyframes rel-pop {
  0% { transform: scale(0.92); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

/* ── Dialog transition ── */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.2s ease;
}
.dialog-fade-enter-active .rel-dialog,
.dialog-fade-leave-active .rel-dialog {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}
.dialog-fade-enter-from .rel-dialog {
  transform: scale(0.92);
  opacity: 0;
}
.dialog-fade-leave-to .rel-dialog {
  transform: scale(0.92);
  opacity: 0;
}
</style>
