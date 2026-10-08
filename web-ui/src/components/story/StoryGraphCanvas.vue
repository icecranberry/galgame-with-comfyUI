<template>
  <!-- 事件线节点图画布（T2 第二期）。
       ── 设计要点（对应用户设计文档 §2.2）────────────────────
       · 节点 = **事件线**（不是聊天楼层 —— 与「构画」的关键差别）
       · 边只有两种：**派生**（实线箭头，来自显式字段）与
         **关联**（虚线，由后端按共享角色/地点**自动算**）——
         不让 AI 生成，否则会画出一堆假关系（用户裁定 S3）
       · 布局：阶段即层（起线在上、终态在下），同层按关联聚簇 —— 见 storyGraphLayout.js
       · 只读画布：拖拽只移动视图内位置，不落库（坐标不是数据，重排随时可复原）。
         人工要改结构请点节点 → 打开编辑弹窗（复用线列表那套表单）。
       ── 边界 ─────────────────────────────────────────────
       ⚠ 本组件**不做筛选**（可见性是服务端的事，避免悬空边）。收到什么画什么。 -->
  <div class="sg-wrap">
    <div v-if="!nodes.length" class="sg-empty">
      <p class="sg-empty-title">没有可显示的事件线</p>
      <p class="sg-empty-hint">先到「线列表」新建几条，或放宽上方筛选条件。</p>
    </div>
    <VueFlow
      v-else
      ref="flowRef"
      :nodes="flowNodes"
      :edges="flowEdges"
      :node-types="nodeTypes"
      :default-viewport="{ x: 0, y: 0, zoom: 0.85 }"
      :min-zoom="0.2"
      :max-zoom="2"
      :nodes-connectable="false"
      :edges-updatable="false"
      :elevate-nodes-on-select="true"
      fit-view-on-init
      @node-click="onNodeClick"
      @pane-ready="onPaneReady"
    >
      <Background :gap="26" :size="1" />
    </VueFlow>

    <!-- 图例：让"颜色=阶段、实线/虚线=关系类型"可自解释 -->
    <div v-if="nodes.length" class="sg-legend">
      <span class="sg-lg-title">阶段</span>
      <span v-for="s in stages" :key="s" class="sg-lg-item">
        <i class="sg-dot" :class="dotClass(s)"></i>{{ s }}
      </span>
      <span class="sg-lg-sep"></span>
      <span class="sg-lg-item"><i class="sg-line solid"></i>派生</span>
      <span class="sg-lg-item"><i class="sg-line dash"></i>关联（自动算）</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, markRaw, watch, nextTick } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import StoryLineNode from './StoryLineNode.vue'
import { layoutStoryGraph } from '../../utils/storyGraphLayout.js'

const props = defineProps({
  /** 后端 /story/graph 的 nodes（事件线数组，**已由服务端筛选**） */
  nodes: { type: Array, default: () => [] },
  /** 后端 /story/graph 的 edges（{from,to,kind,label}） */
  edges: { type: Array, default: () => [] },
  /** 阶段列表（由 /story/meta 下发，前端不硬编码 —— 红线 8） */
  stages: { type: Array, default: () => [] },
  /** 当前正在编辑的线 id（高亮） */
  activeId: { type: [Number, String], default: null },
})

const emit = defineEmits(['select'])
const { fitView } = useVueFlow()

// nodeTypes 必须 markRaw，否则 vue-flow 会因组件被 reactive 包装而反复重建
const nodeTypes = markRaw({ storyLine: markRaw(StoryLineNode) })
const flowRef = ref(null)
const paneReady = ref(false)

/** 阶段 → 色点样式键（与节点卡同源，避免两处各写一份映射） */
function dotClass(s) {
  const map = { 起线: 'qi', 延展: 'yan', 成形: 'cheng', 收束: 'shou', 淡出: 'dan' }
  return `d-${map[String(s || '')] || 'qi'}`
}

function onNodeClick({ node }) {
  const raw = props.nodes.find(n => String(n.id) === String(node.id))
  if (raw) emit('select', raw)
}

function onPaneReady() {
  paneReady.value = true
  // 首帧就绪后再 fit，避免在节点尺寸未知时算出错误的缩放
  nextTick(() => setTimeout(() => { try { fitView({ padding: 0.18, duration: 180 }) } catch { /* 空图时忽略 */ } }, 60))
}

const flowNodes = computed(() => {
  const { positions } = layoutStoryGraph(props.nodes)
  return props.nodes.map(n => ({
    id: String(n.id),
    type: 'storyLine',
    position: positions[String(n.id)] || { x: 0, y: 0 },
    draggable: true,
    selectable: true,
    data: {
      name: n.name || `#${n.id}`,
      stage: n.stage,
      terminal: !!n.terminal,
      pin: !!n.pin,
      adult: !!n.adult,
      stall: !!n.stall,
      when: n.when || '',
      participantCount: Array.isArray(n.participantIds) ? n.participantIds.length : 0,
      placeCount: Array.isArray(n.places) ? n.places.length : 0,
      busy: props.activeId != null && String(props.activeId) === String(n.id),
    },
  }))
})

const flowEdges = computed(() => {
  const ids = new Set(props.nodes.map(n => String(n.id)))
  return (props.edges || [])
    // 双保险：即便后端已保证无悬空边，前端也再挡一次（vue-flow 收到悬空边会告警）
    .filter(e => ids.has(String(e.from)) && ids.has(String(e.to)))
    .map((e, i) => {
      const derive = e.kind === 'derive'
      return {
        id: `sge-${e.from}-${e.to}-${i}`,
        source: String(e.from),
        target: String(e.to),
        label: e.label || (derive ? '派生' : ''),
        animated: false,
        style: derive
          ? { stroke: 'var(--accent-solid)', strokeWidth: 2 }
          : { stroke: 'var(--text-tertiary, #888)', strokeWidth: 1.5, strokeDasharray: '5 4' },
        labelStyle: { fill: 'var(--text-secondary)', fontSize: 11 },
        labelBgStyle: { fill: 'var(--background-secondary, #fff)', fillOpacity: 0.9 },
        labelBgPadding: [5, 3],
        labelBgBorderRadius: 5,
        markerEnd: derive
          ? { type: 'arrowclosed', width: 11, height: 11, color: 'var(--accent-solid)' }
          : undefined,
      }
    })
})

// 节点/边变化后重新适配视图（例如筛选切换、新建线回来）
watch(() => [props.nodes.length, props.edges.length], () => {
  if (!paneReady.value || !props.nodes.length) return
  nextTick(() => setTimeout(() => { try { fitView({ padding: 0.18, duration: 180 }) } catch { /* ignore */ } }, 80))
})

defineExpose({
  fit: () => { try { fitView({ padding: 0.18, duration: 180 }) } catch { /* ignore */ } },
})
</script>

<style scoped>
.sg-wrap { position: relative; width: 100%; height: 100%; min-height: 320px; }
.sg-empty { padding: 48px 0; text-align: center; }
.sg-empty-title { margin: 0 0 6px; font-size: var(--fs-sm); color: var(--text-secondary); }
.sg-empty-hint { margin: 0; font-size: var(--fs-xs); color: var(--text-tertiary, var(--text-secondary)); }

.sg-legend {
  position: absolute; left: 10px; bottom: 10px; z-index: 5;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 6px 10px; border-radius: 8px;
  background: var(--glass-bg); border: 1px solid var(--glass-border);
  font-size: 11px; color: var(--text-secondary);
}
.sg-lg-title { font-weight: 600; }
.sg-lg-item { display: inline-flex; align-items: center; gap: 4px; }
.sg-lg-sep { width: 1px; height: 12px; background: var(--glass-border); }
.sg-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.d-qi { background: #185FA5; }
.d-yan { background: #0F6E56; }
.d-cheng { background: #BA7517; }
.d-shou { background: #888780; }
.d-dan { background: #B4B2A9; }
.sg-line { width: 18px; height: 0; border-top-width: 2px; border-top-style: solid; display: inline-block; }
.sg-line.solid { border-top-color: var(--accent-solid); }
.sg-line.dash { border-top-style: dashed; border-top-color: var(--text-secondary); }
</style>