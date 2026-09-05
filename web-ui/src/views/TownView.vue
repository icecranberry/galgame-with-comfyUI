<template>
  <div class="town-view" ref="viewEl">
    <canvas
      ref="canvasEl"
      class="town-canvas"
      :class="canvasClass"
      @click="onCanvasClick"
      @contextmenu.prevent="onCanvasRightClick"
      @mousedown="onCanvasDown"
      @mousemove="onCanvasMove"
      @mouseup="onCanvasUp"
      @mouseleave="onCanvasLeave"
      @wheel.prevent="onWheel"
      @dblclick="onDblClick"
    ></canvas>

    <!-- 顶栏 -->
    <div class="town-topbar">
      <div class="town-title-row">
        <span class="town-title">世界</span>
        <span class="town-sub">{{ mapDisplayName }}</span>
      </div>
      <div class="town-chips">
        <span v-if="weatherText" class="town-chip">{{ weatherIcon }} {{ weatherText }}</span>
        <span v-if="weather?.timeDesc" class="town-chip">{{ weather.timeDesc }}</span>
        <span class="town-chip">{{ agents.length }} 位居民</span>
        <span v-if="!connected" class="town-chip is-warn">连接中…</span>
      </div>
      <div v-if="initialized" class="town-topbar-actions">
        <linshe-button variant="chip" size="sm" :active="editing" @click="toggleEdit">{{ editing ? '完成编辑' : '编辑' }}</linshe-button>
        <linshe-button variant="chip" size="sm" :active="showAdmin" @click="showAdmin = !showAdmin">管理</linshe-button>
      </div>
    </div>

    <div v-if="initialized && !editing" class="town-hint">
      点击空地走过去 · WASD 移动 · 点一点邻居打个招呼 · 滚轮缩放 · 双击跟随
    </div>

    <!-- 未开镇入口 -->
    <div v-if="loaded && !initialized" class="town-empty">
      <div class="town-empty-card">
        <div class="town-empty-title">小镇还没有建成</div>
        <p class="town-empty-desc">选一套世界观，AI 会为你生成像素素材、规划布局、送来一群小镇居民。</p>
        <linshe-button variant="primary" @click="showWizard = true">初始化小镇</linshe-button>
      </div>
    </div>

    <div v-if="loadError" class="town-loadstate">
      <p>{{ loadError }}</p>
      <linshe-button variant="secondary" size="sm" @click="retryLoad">重试</linshe-button>
    </div>

    <!-- 编辑工具条 -->
    <template v-if="editing">
      <div class="town-toolbar">
        <div
          v-for="tool in TOOLS" :key="tool.id"
          class="town-tool" :class="{ 'is-active': editTool === tool.id }"
          role="button" tabindex="0"
          :title="tool.label"
          @click="editTool = tool.id"
          @keydown.enter="editTool = tool.id"
        >{{ tool.icon }}</div>
      </div>

      <!-- 素材库面板 -->
      <div class="town-library">
        <div class="tl-tabs">
          <linshe-button
            v-for="tab in LIB_TABS" :key="tab.id"
            variant="chip" size="sm" :active="libKind === tab.id"
            @click="libKind = tab.id"
          >{{ tab.label }}</linshe-button>
        </div>
        <div class="tl-grid">
          <div
            v-for="asset in libAssets" :key="asset.id"
            class="tl-item" :class="{ 'is-selected': selectedAssetId === asset.id, 'is-pending': asset.status !== 'ready' }"
            role="button" tabindex="0"
            :title="`${asset.name}（${asset.status === 'ready' ? '点击选用' : asset.status === 'pending' ? '生成中…' : '生成失败'}）`"
            @click="selectAsset(asset)"
            @keydown.enter="selectAsset(asset)"
          >
            <img v-if="asset.status === 'ready'" :src="asset.imagePath" alt="">
            <span v-else class="tl-item-state">{{ asset.status === 'pending' ? '⏳' : '⚠️' }}</span>
            <span class="tl-item-name">{{ asset.name }}</span>
            <span v-if="asset.status === 'ready'" class="tl-item-ops">
              <span class="tl-op" role="button" title="重新生成" @click.stop="regenAsset(asset)">↻</span>
              <span class="tl-op is-danger" role="button" title="删除" @click.stop="removeAsset(asset)">✕</span>
            </span>
          </div>
          <div class="tl-generate">
            <linshe-input v-model="genDesc" size="sm" placeholder="描述一个新素材…" @keyup.enter="generateAsset" />
            <linshe-button variant="secondary" size="sm" :loading="generating" @click="generateAsset">AI 生成</linshe-button>
          </div>
        </div>
      </div>

      <div class="town-edit-actions">
        <linshe-button variant="primary" size="sm" :loading="savingMap" @click="saveEditor">保存地图</linshe-button>
        <linshe-button variant="ghost" size="sm" @click="cancelEdit">放弃</linshe-button>
      </div>

      <!-- POI 绑定小窗 -->
      <div v-if="poiEdit" class="town-poi-form">
        <div class="poi-title">{{ poiEdit.objectId ? '绑定地点' : '新地点' }}</div>
        <linshe-input v-model="poiEdit.name" size="sm" placeholder="地点名称" />
        <linshe-input v-model="poiEdit.ambient" size="sm" placeholder="环境氛围（如：咖啡香四溢）" />
        <linshe-input v-model="poiEdit.aliasText" size="sm" placeholder="别名（逗号分隔，日程匹配用）" />
        <div class="row">
          <linshe-button variant="ghost" size="sm" @click="poiEdit = null">取消</linshe-button>
          <linshe-button variant="primary" size="sm" @click="savePoiEdit">保存地点</linshe-button>
        </div>
      </div>

      <div class="town-hint is-edit">{{ currentToolHint }}</div>
    </template>

    <!-- 角色资料卡（入住角色） -->
    <Teleport to="body">
      <Transition name="town-modal">
        <div v-if="selectedChar" class="town-card-mask" @click.self="selectedAgentKey = null">
          <div class="town-card" role="dialog" aria-label="邻居资料">
            <div class="tc-head">
              <div
                class="tc-avatar"
                :style="selectedChar.avatarPath
                  ? { backgroundImage: `url(${selectedChar.avatarPath})` }
                  : { background: 'var(--accent)' }"
              >{{ selectedChar.avatarPath ? '' : selectedChar.displayName.charAt(0) }}</div>
              <div class="tc-head-info">
                <div class="tc-name">{{ selectedChar.displayName }}</div>
                <div class="tc-status-line">
                  <template v-if="selectedChar.sleeping">😴 睡得正香</template>
                  <template v-else-if="encounterPartnerName">💬 正在和 {{ encounterPartnerName }} 聊天</template>
                  <template v-else>📍 {{ selectedChar.locationName || '小镇某处' }} · {{ selectedChar.activityText || '自由活动' }}</template>
                </div>
              </div>
              <linshe-button variant="icon" size="sm" aria-label="关闭" @click="selectedAgentKey = null">✕</linshe-button>
            </div>

            <div class="tc-tags">
              <span v-if="selectedChar.mood?.dominantEmotion" class="tc-tag">{{ selectedChar.mood.dominantEmotion }}</span>
              <span v-if="selectedChar.locationName" class="tc-tag is-soft">{{ selectedChar.locationName }}</span>
              <span v-if="selectedChar.mood" class="tc-tag is-soft">
                心情 {{ moodLabel(selectedChar.mood.valence) }}
              </span>
            </div>

            <div class="tc-actions">
              <linshe-button variant="primary" size="sm" @click="goChat(selectedChar.characterId)">去聊天</linshe-button>
              <linshe-button variant="ghost" size="sm" @click="selectedAgentKey = null">先不了</linshe-button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 就地聊天 / 管理面板 / 向导 -->
    <TownNpcChat
      v-if="chatNpcId != null"
      :npc-id="chatNpcId"
      :display-name="chatNpcName"
      @close="chatNpcId = null"
    />
    <TownAdminPanel v-if="showAdmin" @close="showAdmin = false" />
    <TownInitWizard v-if="showWizard" @close="showWizard = false" @applied="onTownApplied" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useTownStore } from '../stores/town.js'
import { useChatStore } from '../stores/chat.js'
import * as api from '../api/index.js'
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheInput from '../components/ui/LinsheInput.vue'
import TownNpcChat from '../components/town/TownNpcChat.vue'
import TownAdminPanel from '../components/town/TownAdminPanel.vue'
import TownInitWizard from '../components/town/TownInitWizard.vue'

const town = useTownStore()
const chat = useChatStore()
const router = useRouter()
const { map: mapMeta, locations, agents, player, weather, loaded, connected, initialized, renderMap } = storeToRefs(town)

// ── 画布与渲染状态 ──
const viewEl = ref(null)
const canvasEl = ref(null)
const loadError = ref('')

let ctx = null
let rafId = 0
let cssW = 0
let cssH = 0
let resizeObserver = null

// 摄像机（世界像素坐标；tileSize 世界像素/格）
const TS = 32
const cam = reactive({ x: 0, y: 0, zoom: 1 })
let followPlayer = true

// 静态图层烘焙
let staticCanvas = null
let staticDirty = true
let bakedKey = ''

// 图片缓存
const imgCache = new Map()
function getImg(url) {
  if (!url) return null
  let entry = imgCache.get(url)
  if (!entry) {
    const img = new Image()
    entry = { img, ok: false }
    img.onload = () => { entry.ok = true }
    img.onerror = () => { entry.ok = false }
    img.src = url
    imgCache.set(url, entry)
  }
  return entry.ok ? entry.img : null
}
function assetImage(assetId) {
  const asset = renderMap.value?.assets?.find(a => a.id === assetId)
  return asset ? getImg(asset.imagePath) : null
}
function assetById(assetId) {
  return renderMap.value?.assets?.find(a => a.id === assetId) || null
}

// 交互状态
const hoverAgentKey = ref(null)
const selectedAgentKey = ref(null)
const chatNpcId = ref(null)
const chatNpcName = ref('')
const showAdmin = ref(false)
const showWizard = ref(false)
const dragging = ref(false)

// 键盘移动
const keysDown = new Set()
let moveTimer = null

// ── 编辑器状态 ──
const editing = ref(false)
const editTool = ref('ground')
const libKind = ref('ground')
const selectedAssetId = ref(null)
const genDesc = ref('')
const generating = ref(false)
const savingMap = ref(false)
const townAssets = ref([])

// 编辑数据（本地副本，保存时提交）
const editLayers = ref(null)     // {ground, road, objects, blockOverride}
const editLocations = ref([])    // POI 副本
const paintDrag = ref(null)      // {startCell} 矩形填充
const ghostCell = ref(null)      // 放置预览
const poiEdit = ref(null)        // {objectId?, key?, name, aliases, ambient, x, y, radius, kind}

const TOOLS = [
  { id: 'ground', icon: '🟩', label: '地砖画笔（点涂/拖动；按住刷矩形）' },
  { id: 'road', icon: '🟨', label: '道路画笔' },
  { id: 'place', icon: '🏠', label: '放置建筑/道具（选中素材后点地图）' },
  { id: 'delete', icon: '🧨', label: '删除对象' },
  { id: 'block', icon: '🚧', label: '阻挡涂刷（右键恢复可走）' },
  { id: 'poi', icon: '📍', label: 'POI 绑定（点建筑）' },
]
const LIB_TABS = [
  { id: 'ground', label: '地砖' },
  { id: 'road', label: '道路' },
  { id: 'building', label: '建筑' },
  { id: 'prop', label: '道具' },
]

const canvasClass = computed(() => ({
  'is-hoverable': !!hoverAgentKey.value,
  'is-editing': editing.value,
  'is-panning': dragging.value,
}))

const mapDisplayName = computed(() => renderMap.value?.name || mapMeta.value?.name || '邻舍小镇')

const libAssets = computed(() => townAssets.value.filter(a => a.kind === libKind.value))
const selectedAsset = computed(() => townAssets.value.find(a => a.id === selectedAssetId.value) || null)

const currentToolHint = computed(() => {
  const t = TOOLS.find(t => t.id === editTool.value)
  if (['ground', 'road', 'place'].includes(editTool.value) && !selectedAsset.value) {
    return '先在左侧素材库选一张素材'
  }
  return t?.label || ''
})

const selectedChar = computed(() => {
  const a = agents.value.find(x => x.agentKey === selectedAgentKey.value)
  return a && a.kind === 'char' ? a : null
})

const encounterPartnerName = computed(() => {
  const c = selectedChar.value
  if (!c?.encounterId) return null
  const enc = town.encountersActive.find(e => e.id === c.encounterId)
  if (!enc) return null
  const otherKey = enc.a === c.agentKey ? enc.b : enc.a
  return agents.value.find(a => a.agentKey === otherKey)?.displayName || null
})

const weatherText = computed(() => {
  const w = weather.value
  if (!w) return ''
  return [w.text, w.temperature != null ? `${w.temperature}°C` : ''].filter(Boolean).join(' ')
})

const weatherIcon = computed(() => {
  const t = weather.value?.text || ''
  if (/雷/.test(t)) return '⛈️'
  if (/雨/.test(t)) return '🌧️'
  if (/雪/.test(t)) return '❄️'
  if (/雾|霾/.test(t)) return '🌫️'
  if (/阴/.test(t)) return '☁️'
  if (/云/.test(t)) return '⛅'
  if (/晴/.test(t)) return '☀️'
  return '🌤️'
})

function moodLabel(valence) {
  if (valence == null) return '平静'
  if (valence > 0.3) return '不错'
  if (valence < -0.3) return '有点低落'
  return '平静'
}

// ── 坐标换算 ──

function screenToWorld(cssX, cssY) {
  return {
    x: (cssX - cssW / 2) / cam.zoom + cam.x,
    y: (cssY - cssH / 2) / cam.zoom + cam.y,
  }
}

function worldToCell(wx, wy) {
  return {
    x: Math.floor(wx / TS),
    y: Math.floor(wy / TS),
  }
}

function screenToCell(cssX, cssY) {
  return worldToCell(screenToWorld(cssX, cssY).x, screenToWorld(cssX, cssY).y)
}

function inBounds(c) {
  const m = renderMap.value
  return m && c.x >= 0 && c.y >= 0 && c.x < m.cols && c.y < m.rows
}

// ── 实体拾取与插值 ──

function agentDisplayPos(a) {
  if (!a.path || a.path.length === 0 || !a.moveStartedAt) {
    return { x: a.x, y: a.y, moving: false, dx: 0, dy: 0 }
  }
  const cells = ((Date.now() - a.moveStartedAt) / 1000) * (a.speed || 0.5)
  if (cells <= 0) return { x: a.x, y: a.y, moving: true, dx: 0, dy: 0 }
  const idx = Math.floor(cells)
  if (idx >= a.path.length) return { x: a.path[a.path.length - 1].x, y: a.path[a.path.length - 1].y, moving: false, dx: 0, dy: 0 }
  const prev = idx === 0 ? { x: a.x, y: a.y } : a.path[idx - 1]
  const target = a.path[idx]
  const frac = cells - idx
  return {
    x: prev.x + (target.x - prev.x) * frac,
    y: prev.y + (target.y - prev.y) * frac,
    moving: true,
    dx: Math.sign(target.x - prev.x),
    dy: Math.sign(target.y - prev.y),
  }
}

const facing = reactive({}) // agentKey -> 'down'|'up'|'left'|'right'

function agentFacing(a, pos) {
  if (pos.moving) {
    if (Math.abs(pos.dy) > Math.abs(pos.dx)) facing[a.agentKey] = pos.dy > 0 ? 'down' : 'up'
    else if (pos.dx !== 0) facing[a.agentKey] = pos.dx > 0 ? 'right' : 'left'
  }
  return facing[a.agentKey] || 'down'
}

function hitAgent(cssX, cssY) {
  for (const a of agents.value) {
    const pos = agentDisplayPos(a)
    const px = (pos.x + 0.5) * TS
    const py = (pos.y + 0.5) * TS
    const sx = (px - cam.x) * cam.zoom + cssW / 2
    const sy = (py - cam.y) * cam.zoom + cssH / 2
    const h = TS * 1.6 * cam.zoom
    const dx = cssX - sx
    const dy = cssY - (sy - h * 0.45)
    if (Math.abs(dx) < h * 0.35 && Math.abs(dy) < h * 0.55) return a
  }
  return null
}

// ── 点击交互 ──

let downInfo = null // {x, y, button, moved}

function onCanvasDown(e) {
  downInfo = { x: e.offsetX, y: e.offsetY, button: e.button, moved: false }
  if (editing.value && e.button === 0) {
    const cell = screenToCell(e.offsetX, e.offsetY)
    if (['ground', 'road'].includes(editTool.value) && selectedAsset.value) {
      paintDrag.value = { startCell: cell, lastCell: cell }
      paintCell(cell)
    }
  }
}

function onCanvasMove(e) {
  if (editing.value) {
    ghostCell.value = screenToCell(e.offsetX, e.offsetY)
    if (paintDrag.value) {
      const cell = screenToCell(e.offsetX, e.offsetY)
      paintDrag.value.lastCell = cell
      paintLine(paintDrag.value.lastCell)
    }
  }
  // 拖拽平移（编辑模式仅右键/中键平移，左键留给画笔）
  if (downInfo && !downInfo.moved && (Math.abs(e.offsetX - downInfo.x) > 4 || Math.abs(e.offsetY - downInfo.y) > 4)) {
    downInfo.moved = true
    if (!editing.value || downInfo.button !== 0) dragging.value = true
  }
  if (dragging.value && downInfo) {
    const dx = (e.offsetX - downInfo.x) / cam.zoom
    const dy = (e.offsetY - downInfo.y) / cam.zoom
    cam.x -= dx
    cam.y -= dy
    followPlayer = false
    downInfo.x = e.offsetX
    downInfo.y = e.offsetY
  }
  hoverAgentKey.value = editing.value ? null : (hitAgent(e.offsetX, e.offsetY)?.agentKey || null)
}

function onCanvasUp() {
  // 左键矩形填充（编辑模式拖出一块）
  if (editing.value && paintDrag.value && downInfo?.moved) {
    fillRect(paintDrag.value.startCell, paintDrag.value.lastCell)
  }
  paintDrag.value = null
  dragging.value = false
  downInfo = null
}

function onCanvasLeave() {
  paintDrag.value = null
  dragging.value = false
  downInfo = null
  hoverAgentKey.value = null
}

function onCanvasClick(e) {
  // 拖拽过的 click 忽略
  if (downInfo?.moved) return
  if (!loaded.value) return
  if (editing.value) {
    handleEditClick(e)
    return
  }
  if (!initialized.value) return
  const hit = hitAgent(e.offsetX, e.offsetY)
  if (hit) {
    if (hit.kind === 'npc') {
      chatNpcName.value = hit.displayName
      chatNpcId.value = hit.npcId
    } else {
      selectedAgentKey.value = hit.agentKey
    }
    return
  }
  const cell = screenToCell(e.offsetX, e.offsetY)
  if (!inBounds(cell)) return
  town.movePlayer(cell.x, cell.y).catch(err => {
    console.warn('[town] move failed:', err?.message)
  })
}

function onCanvasRightClick(e) {
  if (editing.value && editTool.value === 'block') {
    const cell = screenToCell(e.offsetX, e.offsetY)
    paintBlock(cell, 0) // 右键 = 手动清障（恢复可走）
  }
}

function onDblClick() {
  if (!editing.value) followPlayer = true
}

function onWheel(e) {
  const factor = e.deltaY < 0 ? 1.12 : 0.89
  const newZoom = Math.min(2.5, Math.max(0.5, cam.zoom * factor))
  // 缩放向鼠标位置聚焦
  const before = screenToWorld(e.offsetX, e.offsetY)
  cam.zoom = newZoom
  const after = screenToWorld(e.offsetX, e.offsetY)
  cam.x += before.x - after.x
  cam.y += before.y - after.y
  if (Math.abs(newZoom - 1) > 0.01) followPlayer = false
}

// ── 键盘移动 ──

function onKeyDown(e) {
  if (editing.value || showAdmin.value || showWizard.value || chatNpcId.value != null) return
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
  const map = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] }
  if (map[e.code]) {
    e.preventDefault()
    keysDown.add(e.code)
    if (!moveTimer) {
      stepByKey()
      moveTimer = setInterval(stepByKey, 170)
    }
  }
}

function onKeyUp(e) {
  keysDown.delete(e.code)
  if (keysDown.size === 0 && moveTimer) {
    clearInterval(moveTimer)
    moveTimer = null
  }
}

function stepByKey() {
  for (const code of keysDown) {
    const map = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] }
    const [dx, dy] = map[code] || [0, 0]
    if (dx || dy) {
      town.movePlayerDir(dx, dy).catch(() => {})
      break
    }
  }
}

// ── 编辑器操作 ──

function toggleEdit() {
  if (editing.value) {
    cancelEdit()
  } else {
    beginEdit()
  }
}

function beginEdit() {
  const m = renderMap.value
  if (!m) return
  editLayers.value = JSON.parse(JSON.stringify(m.layers))
  editLocations.value = JSON.parse(JSON.stringify(m.locations || locations.value.map(normalizeLocation)))
  editing.value = true
  editTool.value = 'ground'
  staticDirty = true
  fetchAssetsList()
}

function normalizeLocation(l) {
  return {
    id: l.id, key: l.key, name: l.name, aliases: l.aliases || [],
    kind: l.kind, x: l.x, y: l.y, radius: l.radius, ambient: l.ambient || '', objectId: null,
  }
}

function cancelEdit() {
  editing.value = false
  editLayers.value = null
  editLocations.value = []
  poiEdit.value = null
  staticDirty = true
}

async function fetchAssetsList() {
  try {
    const data = await api.fetchTownAssets()
    townAssets.value = data.assets || []
  } catch (err) {
    console.warn('[town] assets fetch failed:', err?.message)
  }
}

function selectAsset(asset) {
  if (asset.status !== 'ready') return
  selectedAssetId.value = asset.id
  if (asset.kind === 'building' || asset.kind === 'prop') editTool.value = 'place'
  else editTool.value = asset.kind
}

async function regenAsset(asset) {
  try {
    await api.regenerateTownAsset(asset.id, {})
  } catch (err) {
    console.warn('[town] regen failed:', err?.message)
  }
}

function removeAsset(asset) {
  api.deleteTownAsset(asset.id).then(fetchAssetsList).catch(err => console.warn('[town] delete failed:', err?.message))
}

async function generateAsset() {
  const desc = genDesc.value.trim()
  if (!desc || generating.value) return
  generating.value = true
  try {
    await api.createTownAsset({ kind: libKind.value, key: null, name: desc.slice(0, 12), desc, meta: { desc } })
    genDesc.value = ''
    setTimeout(fetchAssetsList, 800)
  } catch (err) {
    console.warn('[town] generate failed:', err?.message)
  } finally {
    generating.value = false
  }
}

function ensureLayer(name) {
  const m = renderMap.value
  const layers = editLayers.value
  if (!layers || !m) return null
  if (!Array.isArray(layers[name])) {
    layers[name] = Array.from({ length: m.rows }, () => Array(m.cols).fill(name === 'blockOverride' ? -1 : null))
  }
  return layers[name]
}

function paintCell(cell) {
  const layer = ensureLayer(editTool.value === 'ground' ? 'ground' : 'road')
  if (!layer || !inBounds(cell)) return
  layer[cell.y][cell.x] = selectedAssetId.value
  staticDirty = true
}

function paintLine(cell) {
  paintCell(cell)
}

function fillRect(a, b) {
  const layer = ensureLayer(editTool.value === 'ground' ? 'ground' : 'road')
  if (!layer) return
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (inBounds({ x, y })) layer[y][x] = selectedAssetId.value
    }
  }
  staticDirty = true
}

function paintBlock(cell, value) {
  const layer = ensureLayer('blockOverride')
  if (!layer || !inBounds(cell)) return
  layer[cell.y][cell.x] = value
  staticDirty = true
}

function handleEditClick(e) {
  const cell = screenToCell(e.offsetX, e.offsetY)
  if (!inBounds(cell)) return
  const layers = editLayers.value
  if (!layers) return

  if (['ground', 'road'].includes(editTool.value)) {
    if (!selectedAsset.value) return
    fillRect(cell, cell) // 单击涂一格
    return
  }

  if (editTool.value === 'block') {
    paintBlock(cell, 1)
    return
  }

  if (editTool.value === 'place') {
    placeObject(cell)
    return
  }

  if (editTool.value === 'delete') {
    const idx = layers.objects.findIndex(o => objectContainsCell(o, cell))
    if (idx >= 0) {
      layers.objects.splice(idx, 1)
      staticDirty = true
    }
    return
  }

  if (editTool.value === 'poi') {
    const obj = layers.objects.find(o => objectContainsCell(o, cell))
    if (obj) {
      const asset = assetById(obj.assetId)
      const fp = asset?.meta?.footprint
      const existing = editLocations.value.find(l => l.objectId === obj.id)
      poiEdit.value = existing ? { ...existing } : {
        objectId: obj.id,
        key: (asset?.key || 'poi').replace(/[^a-z0-9_]/g, '_'),
        name: asset?.name || '',
        aliases: [],
        kind: 'place',
        x: obj.x + Math.floor((fp?.w || 1) / 2),
        y: obj.y,
        radius: 2,
        ambient: '',
      }
    }
  }
}

function objectContainsCell(obj, cell) {
  const fp = assetById(obj.assetId)?.meta?.footprint || { w: 1, h: 1 }
  return cell.x >= obj.x && cell.x < obj.x + fp.w && cell.y <= obj.y && cell.y > obj.y - fp.h
}

function placeObject(cell) {
  const asset = selectedAsset.value
  if (!asset || !['building', 'prop'].includes(asset.kind)) return
  const fp = asset.meta?.footprint || { w: 1, h: 1 }
  const x = cell.x
  const y = cell.y + fp.h - 1 // 点击处作为底部锚点
  if (x < 0 || y < 0 || x + fp.w > renderMap.value.cols || y >= renderMap.value.rows) return
  editLayers.value.objects.push({ assetId: asset.id, x, y, flip: false })
  staticDirty = true
}

function savePoiEdit() {
  const p = poiEdit.value
  if (!p?.name) { poiEdit.value = null; return }
  p.key = String(p.key || p.name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') || `poi_${Date.now()}`
  p.aliases = String(p.aliasText || '').split(/[,，、]/).map(s => s.trim()).filter(Boolean)
  const idx = editLocations.value.findIndex(l => l.key === p.key || (p.objectId && l.objectId === p.objectId))
  if (idx >= 0) editLocations.value.splice(idx, 1, { ...p })
  else editLocations.value.push({ ...p })
  poiEdit.value = null
}

async function saveEditor() {
  if (!editLayers.value || savingMap.value) return
  savingMap.value = true
  try {
    const m = renderMap.value
    await api.saveTownMap({
      name: m.name,
      cols: m.cols,
      rows: m.rows,
      tileSize: TS,
      layers: editLayers.value,
      locations: editLocations.value.map(l => ({
        key: l.key, name: l.name, aliases: l.aliases, kind: l.kind,
        x: l.x, y: l.y, radius: l.radius, ambient: l.ambient, objectId: l.objectId ?? null,
      })),
    })
    cancelEdit()
    town.fetchState().catch(() => {})
    town.fetchMap().catch(() => {})
  } catch (err) {
    loadError.value = '保存失败：' + (err?.message || '未知错误')
  } finally {
    savingMap.value = false
  }
}

function onTownApplied() {
  showWizard.value = false
  town.fetchState().catch(() => {})
}

// ── 渲染 ──

function bakeStatic() {
  const m = renderMap.value
  if (!m) { staticCanvas = null; return }
  const key = `${m.version}|${m.cols}x${m.rows}|${JSON.stringify(m.layers).length}`
  staticCanvas = staticCanvas || document.createElement('canvas')
  staticCanvas.width = m.cols * TS
  staticCanvas.height = m.rows * TS
  const c = staticCanvas.getContext('2d')
  c.imageSmoothingEnabled = false
  c.clearRect(0, 0, staticCanvas.width, staticCanvas.height)

  // ground → road 两层
  for (const layerName of ['ground', 'road']) {
    const layer = m.layers?.[layerName]
    if (!Array.isArray(layer)) continue
    for (let y = 0; y < m.rows; y++) {
      const row = layer[y] || []
      for (let x = 0; x < m.cols; x++) {
        const assetId = row[x]
        if (!assetId) continue
        const img = assetImage(assetId)
        if (img) c.drawImage(img, x * TS, y * TS, TS, TS)
      }
    }
  }
  staticDirty = false
  bakedKey = key
}

function wrapText(text, maxChars) {
  const lines = []
  let cur = ''
  for (const ch of String(text)) {
    cur += ch
    if (cur.length >= maxChars) { lines.push(cur); cur = '' }
  }
  if (cur) lines.push(cur)
  return lines.slice(0, 3)
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

function drawBubble(c, text, until, px, py) {
  const remain = until - Date.now()
  if (remain <= 0) return
  const alpha = Math.min(1, remain / 1500)
  const lines = wrapText(text, 12)
  const bw = Math.min(190, Math.max(...lines.map(l => l.length)) * 11 + 18)
  const bh = lines.length * 16 + 12
  const bx = px - bw / 2
  const by = py - bh
  c.save()
  c.globalAlpha = alpha
  roundRect(c, bx, by, bw, bh, 9)
  c.fillStyle = 'rgba(255,254,250,0.96)'
  c.fill()
  c.strokeStyle = '#e8ddd0'
  c.lineWidth = 1
  c.stroke()
  c.beginPath()
  c.moveTo(px - 5, by + bh - 1)
  c.lineTo(px + 5, by + bh - 1)
  c.lineTo(px, by + bh + 6)
  c.closePath()
  c.fill()
  c.fillStyle = '#4a3a2c'
  c.font = '11px "HarmonyOS Sans SC", sans-serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  lines.forEach((line, i) => c.fillText(line, px, by + 12 + i * 16))
  c.restore()
}

function drawNameTag(c, px, py, name) {
  c.save()
  c.font = '10px "HarmonyOS Sans SC", sans-serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  const w = c.measureText(name).width + 10
  roundRect(c, px - w / 2, py - 7, w, 15, 7)
  c.fillStyle = 'rgba(255,253,248,0.9)'
  c.fill()
  c.fillStyle = '#7a6a58'
  c.fillText(name, px, py + 0.5)
  c.restore()
}

function drawObject(c, obj, occluded) {
  const asset = assetById(obj.assetId)
  const img = asset ? getImg(asset.imagePath) : null
  const fp = asset?.meta?.footprint || { w: 1, h: 1 }
  const bottomY = (obj.y + 1) * TS
  const px = obj.x * TS
  if (img) {
    const w = fp.w * TS
    const h = w * (img.naturalHeight && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1)
    c.save()
    c.globalAlpha = occluded ? 0.62 : 1
    if (obj.flip) {
      c.translate(px + w, 0)
      c.scale(-1, 1)
      c.drawImage(img, 0, bottomY - h, w, h)
    } else {
      c.drawImage(img, px, bottomY - h, w, h)
    }
    c.restore()
  } else {
    c.save()
    c.fillStyle = occluded ? 'rgba(200,180,160,0.4)' : 'rgba(180,160,140,0.55)'
    c.fillRect(px + 2, bottomY - TS, fp.w * TS - 4, TS - 2)
    c.restore()
  }
}

function drawAgent(c, a, nowMs) {
  const pos = agentDisplayPos(a)
  const px = (pos.x + 0.5) * TS
  const baseY = (pos.y + 0.9) * TS
  const dir = agentFacing(a, pos)
  const spriteUrl = a.sprites?.[dir]
  const isPlayer = a.agentKey === 'me'
  const sleeping = a.sleeping
  const bob = pos.moving ? Math.abs(Math.sin(nowMs / 110)) * 2.2 : Math.sin(nowMs / 900 + (a.npcId || 0)) * 1.1

  // 落影
  c.save()
  c.globalAlpha = 0.22
  c.fillStyle = '#3c2f22'
  c.beginPath()
  c.ellipse(px, baseY - 2, TS * 0.34, TS * 0.12, 0, 0, Math.PI * 2)
  c.fill()
  c.restore()

  // 悬停/选中光环
  if (a.agentKey === hoverAgentKey.value || a.agentKey === selectedAgentKey.value) {
    c.save()
    c.strokeStyle = 'rgba(224,123,108,0.55)'
    c.lineWidth = 2
    c.beginPath()
    c.ellipse(px, baseY - 2, TS * 0.42, TS * 0.16, 0, 0, Math.PI * 2)
    c.stroke()
    c.restore()
  }

  const sprite = getImg(spriteUrl)
  const alpha = sleeping ? 0.85 : 1
  let drew = false
  if (sprite) {
    const h = TS * 1.55
    const w = h * (sprite.naturalWidth && sprite.naturalHeight ? sprite.naturalWidth / sprite.naturalHeight : 0.66)
    const flip = dir === 'left'
    c.save()
    c.globalAlpha = alpha
    c.translate(px, baseY - (sleeping ? 0 : bob))
    if (flip) c.scale(-1, 1)
    try { c.drawImage(sprite, -w / 2, -h, w, h); drew = true } catch { /* ignore */ }
    c.restore()
  }
  if (!drew) {
    // 兜底：立绘 / 头像圆 token / 色块 token
    const standing = a.standingUrl ? getImg(a.standingUrl) : null
    const avatar = a.avatarPath ? getImg(a.avatarPath) : null
    if (standing) {
      const h = TS * 2.1
      const w = h * (standing.naturalWidth / Math.max(1, standing.naturalHeight) || 0.7)
      c.save()
      c.globalAlpha = alpha
      c.drawImage(standing, px - w / 2, baseY - h, w, h)
      c.restore()
      drew = true
    } else {
      const r = TS * 0.5
      const cy = baseY - r - bob
      c.save()
      c.globalAlpha = alpha
      c.beginPath()
      c.arc(px, cy, r, 0, Math.PI * 2)
      c.fillStyle = isPlayer ? '#e07b6c' : '#f6efe4'
      c.fill()
      c.lineWidth = 2
      c.strokeStyle = 'rgba(255,255,255,0.95)'
      c.stroke()
      if (avatar) {
        c.beginPath()
        c.arc(px, cy, r - 2, 0, Math.PI * 2)
        c.clip()
        try { c.drawImage(avatar, px - r, cy - r, r * 2, r * 2) } catch { /* ignore */ }
      } else {
        c.fillStyle = '#ffffff'
        c.font = `700 ${Math.round(TS * 0.5)}px "HarmonyOS Sans SC", sans-serif`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillText((a.displayName || '?').charAt(0), px, cy + 1)
      }
      c.restore()
      drew = true
    }
  }

  drawNameTag(c, px, baseY + TS * 0.34, a.displayName || '我')

  if (sleeping) {
    c.save()
    c.font = `${Math.round(TS * 0.6)}px "HarmonyOS Sans SC", sans-serif`
    c.textAlign = 'center'
    c.globalAlpha = 0.5 + 0.5 * Math.sin(nowMs / 500)
    c.fillText('💤', px + TS * 0.6, baseY - TS * 1.5)
    c.restore()
  } else if (a.encounterId) {
    c.save()
    c.font = `${Math.round(TS * 0.55)}px "HarmonyOS Sans SC", sans-serif`
    c.textAlign = 'center'
    c.fillText('💬', px + TS * 0.6, baseY - TS * 1.45)
    c.restore()
  }

  if (a.bubble?.text) drawBubble(c, a.bubble.text, a.bubble.until, px, baseY - TS * 1.9)
}

/** 对象是否遮挡某居民（居民在建筑纵深内）→ 建筑半透明 */
function objectOccludes(obj) {
  for (const a of agents.value) {
    const pos = agentDisplayPos(a)
    const ay = pos.y + 0.5
    const fp = assetById(obj.assetId)?.meta?.footprint || { w: 1, h: 1 }
    if (ay <= obj.y && ay > obj.y - fp.h && pos.x + 0.5 >= obj.x && pos.x + 0.5 <= obj.x + fp.w) return true
  }
  return false
}

function drawEditorOverlays(c) {
  const m = renderMap.value
  const layers = editing.value ? editLayers.value : m?.layers
  if (!m || !layers) return

  // 阻挡格红斜线
  const override = layers.blockOverride
  if (Array.isArray(override)) {
    c.save()
    c.strokeStyle = 'rgba(220, 90, 70, 0.5)'
    c.lineWidth = 1.5
    for (let y = 0; y < m.rows; y++) {
      for (let x = 0; x < m.cols; x++) {
        const v = override[y]?.[x]
        if (v === 1) {
          c.beginPath()
          c.moveTo(x * TS + 4, y * TS + 4)
          c.lineTo((x + 1) * TS - 4, (y + 1) * TS - 4)
          c.moveTo((x + 1) * TS - 4, y * TS + 4)
          c.lineTo(x * TS + 4, (y + 1) * TS - 4)
          c.stroke()
        } else if (v === -1) {
          // 默认，不画
        }
      }
    }
    c.restore()
  }

  // 放置 ghost 预览
  const cell = ghostCell.value
  if (cell && inBounds(cell) && ['ground', 'road', 'place'].includes(editTool.value) && selectedAsset.value) {
    const asset = selectedAsset.value
    const fp = asset.meta?.footprint || { w: 1, h: 1 }
    const gx = editTool.value === 'place' ? cell.x : cell.x
    const gy = editTool.value === 'place' ? cell.y + fp.h - 1 : cell.y
    const img = getImg(asset.imagePath)
    c.save()
    c.globalAlpha = 0.55
    if (img && editTool.value === 'place') {
      const w = fp.w * TS
      const h = w * (img.naturalHeight / Math.max(1, img.naturalWidth))
      c.drawImage(img, gx * TS, (gy + 1) * TS - h, w, h)
    }
    c.globalAlpha = 0.4
    c.fillStyle = editTool.value === 'place' ? '#7fc48a' : '#8ab6d6'
    c.fillRect(gx * TS, (gy - fp.h + 1) * TS, fp.w * TS, fp.h * TS)
    c.restore()
  }

  // 矩形填充预览
  if (paintDrag.value) {
    const { startCell, lastCell } = paintDrag.value
    const x0 = Math.min(startCell.x, lastCell.x)
    const y0 = Math.min(startCell.y, lastCell.y)
    const w = Math.abs(lastCell.x - startCell.x) + 1
    const h = Math.abs(lastCell.y - startCell.y) + 1
    c.save()
    c.globalAlpha = 0.3
    c.fillStyle = '#8ab6d6'
    c.fillRect(x0 * TS, y0 * TS, w * TS, h * TS)
    c.restore()
  }

  // POI 标记
  c.save()
  c.font = '10px "HarmonyOS Sans SC", sans-serif'
  c.textAlign = 'center'
  for (const loc of editLocations.value) {
    const px = (loc.x + 0.5) * TS
    const py = (loc.y + 1.6) * TS
    c.fillStyle = 'rgba(224,123,108,0.85)'
    c.beginPath()
    c.arc(px, py - 8, 4, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#5c4a3a'
    c.fillText(loc.name, px, py + 6)
  }
  c.restore()
}

function drawWeatherOverlay(c, nowMs) {
  const w = weather.value
  const hour = w?.hour ?? new Date().getHours()
  let tint = null
  if (hour >= 20 || hour < 5) tint = 'rgba(30, 38, 72, 0.32)'
  else if (hour >= 17) tint = 'rgba(244, 160, 92, 0.14)'
  else if (hour < 8) tint = 'rgba(255, 205, 130, 0.10)'
  if (tint) {
    c.fillStyle = tint
    c.fillRect(0, 0, cssW, cssH)
  }
  const t = w?.text || ''
  if (/雨/.test(t) && !/雷/.test(t)) {
    c.strokeStyle = 'rgba(160, 180, 210, 0.4)'
    c.lineWidth = 1.2
    c.beginPath()
    for (let i = 0; i < 36; i++) {
      const speed = 0.45 + (i % 5) * 0.07
      const x = (i * 173 + 40) % cssW
      const y = ((nowMs * speed + i * 137) % (cssH + 80)) - 40
      c.moveTo(x, y)
      c.lineTo(x - 4, y + 13)
    }
    c.stroke()
  } else if (/雪/.test(t)) {
    c.fillStyle = 'rgba(240, 245, 250, 0.5)'
    for (let i = 0; i < 28; i++) {
      const speed = 0.12 + (i % 4) * 0.03
      const x = (i * 211 + 60 + Math.sin(nowMs / 900 + i) * 14) % cssW
      const y = ((nowMs * speed + i * 97) % (cssH + 40)) - 20
      c.beginPath()
      c.arc(x, y, 1.6 + (i % 3) * 0.6, 0, Math.PI * 2)
      c.fill()
    }
  }
}

function draw(nowMs) {
  rafId = 0
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  ctx.fillStyle = '#e9edda'
  ctx.fillRect(0, 0, cssW, cssH)

  const m = renderMap.value
  if (m && staticDirty) bakeStatic()

  // 跟随玩家
  if (player.value && followPlayer && !editing.value) {
    const pos = agentDisplayPos(player.value)
    cam.x += ((pos.x + 0.5) * TS - cam.x) * 0.08
    cam.y += ((pos.y + 0.5) * TS - cam.y) * 0.08
  }

  if (m && staticCanvas) {
    ctx.save()
    ctx.translate(cssW / 2, cssH / 2)
    ctx.scale(cam.zoom, cam.zoom)
    ctx.translate(-cam.x, -cam.y)
    ctx.imageSmoothingEnabled = false

    ctx.drawImage(staticCanvas, 0, 0)

    // 对象 + 居民合并 y 排序（角色可走到建筑后面）
    const drawables = []
    const layers = editing.value ? editLayers.value : m.layers
    for (const obj of layers?.objects || []) {
      drawables.push({ kind: 'object', y: obj.y + 1, obj })
    }
    if (!editing.value) {
      for (const a of agents.value) {
        const pos = agentDisplayPos(a)
        drawables.push({ kind: 'agent', y: pos.y + 0.5, a })
      }
      if (player.value) {
        const pos = agentDisplayPos(player.value)
        drawables.push({ kind: 'agent', y: pos.y + 0.5, a: player.value })
      }
    }
    drawables.sort((p, q) => p.y - q.y)
    for (const d of drawables) {
      if (d.kind === 'object') drawObject(ctx, d.obj, !editing.value && objectOccludes(d.obj))
      else drawAgent(ctx, d.a, nowMs)
    }

    if (editing.value) drawEditorOverlays(ctx)
    ctx.restore()
  } else if (!m) {
    ctx.fillStyle = '#8c8074'
    ctx.font = '13px "HarmonyOS Sans SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(loaded.value ? '这片土地还在等待它的故事…' : '正在唤醒这个世界…', cssW / 2, cssH / 2)
  }

  drawWeatherOverlay(ctx, nowMs)

  if (!document.hidden) rafId = requestAnimationFrame(draw)
}

// ── 布局 / 生命周期 ──

function relayout() {
  if (!viewEl.value || !canvasEl.value) return
  const rect = viewEl.value.getBoundingClientRect()
  cssW = Math.max(200, rect.width)
  cssH = Math.max(200, rect.height)
  const dpr = window.devicePixelRatio || 1
  canvasEl.value.width = Math.round(cssW * dpr)
  canvasEl.value.height = Math.round(cssH * dpr)
  canvasEl.value.style.width = `${cssW}px`
  canvasEl.value.style.height = `${cssH}px`
}

function centerCamera() {
  const m = renderMap.value
  if (!m) return
  cam.x = (m.cols * TS) / 2
  cam.y = (m.rows * TS) / 2
  cam.zoom = Math.min(2.5, Math.max(0.5, Math.min(cssW / (m.cols * TS), cssH / (m.rows * TS))))
  followPlayer = true
}

function onVisibility() {
  if (!document.hidden && rafId === 0) rafId = requestAnimationFrame(draw)
}

function retryLoad() {
  loadError.value = ''
  town.fetchState().catch(err => {
    loadError.value = '世界暂时联系不上：' + (err?.message || '未知错误')
  })
}

watch(renderMap, (m, old) => {
  staticDirty = true
  if (m && (!old || old.version !== m.version || old.name !== m.name)) {
    if (!editing.value) centerCamera()
  }
})

watch(editing, (v) => {
  if (!v) staticDirty = true
})

watch(editLayers, () => { staticDirty = true }, { deep: true })

onMounted(async () => {
  ctx = canvasEl.value.getContext('2d')
  town.startTownStream()
  relayout()
  resizeObserver = new ResizeObserver(() => relayout())
  resizeObserver.observe(viewEl.value)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  rafId = requestAnimationFrame(draw)

  try {
    await town.fetchState()
    centerCamera()
  } catch (err) {
    loadError.value = '世界暂时联系不上：' + (err?.message || '未知错误')
  }
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null }
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  if (moveTimer) { clearInterval(moveTimer); moveTimer = null }
  town.stopTownStream()
})

async function goChat(characterId) {
  selectedAgentKey.value = null
  try {
    await chat.selectChar(characterId)
    router.push('/chat/' + characterId)
  } catch (err) {
    router.push('/chat/' + characterId)
  }
}
</script>

<style scoped>
.town-view {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #e9edda;
}

.town-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.town-canvas.is-hoverable { cursor: pointer; }
.town-canvas.is-editing { cursor: cell; }
.town-canvas.is-panning { cursor: grabbing; }

/* ── 顶栏浮层 ── */
.town-topbar {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 16px;
  background: rgba(252, 250, 247, 0.92);
  border: 1px solid rgba(232, 221, 208, 0.8);
  border-radius: 16px;
  box-shadow: 0 2px 12px rgba(54, 42, 38, 0.08);
  max-width: calc(100% - 24px);
}

.town-title-row { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }

.town-title { font-size: 15px; font-weight: 700; color: var(--text-bright); }
.town-sub { font-size: 11px; color: var(--text-secondary); }

.town-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.town-chip {
  font-size: 11px;
  color: var(--text-primary);
  background: rgba(240, 236, 232, 0.85);
  border-radius: 999px;
  padding: 3px 9px;
  white-space: nowrap;
}

.town-chip.is-warn { color: var(--accent-hover); }

.town-topbar-actions { display: flex; gap: 6px; }

/* ── 底部提示 ── */
.town-hint {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: rgba(90, 76, 60, 0.75);
  background: rgba(252, 250, 247, 0.82);
  padding: 4px 12px;
  border-radius: 999px;
  pointer-events: none;
  white-space: nowrap;
}

.town-hint.is-edit { bottom: 14px; }

/* ── 未开镇 ── */
.town-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.town-empty-card {
  background: #f4f1eeed;
  border-radius: 18px;
  box-shadow: 0 20px 60px rgba(54, 42, 38, 0.2);
  padding: 30px 34px;
  text-align: center;
  max-width: 340px;
}

.town-empty-title { font-size: 18px; font-weight: 700; color: var(--text-bright); }

.town-empty-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin: 10px 0 18px;
}

/* ── 编辑工具条 ── */
.town-toolbar {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 6px;
  background: rgba(252, 250, 247, 0.95);
  border: 1px solid rgba(232, 221, 208, 0.8);
  border-radius: 14px;
  box-shadow: 0 2px 12px rgba(54, 42, 38, 0.08);
}

.town-tool {
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  border-radius: 10px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s ease;
}

.town-tool:hover { background: rgba(224, 123, 108, 0.1); }
.town-tool.is-active { background: rgba(224, 123, 108, 0.18); box-shadow: inset 0 0 0 1.5px rgba(224, 123, 108, 0.55); }

/* ── 素材库面板 ── */
.town-library {
  position: absolute;
  left: 14px;
  top: 64px;
  bottom: 64px;
  width: 264px;
  display: flex;
  flex-direction: column;
  background: rgba(252, 250, 247, 0.95);
  border: 1px solid rgba(232, 221, 208, 0.8);
  border-radius: 16px;
  box-shadow: 0 2px 12px rgba(54, 42, 38, 0.08);
  overflow: hidden;
}

.tl-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 10px 6px;
  flex-wrap: wrap;
}

.tl-grid {
  flex: 1;
  overflow-y: auto;
  padding: 4px 10px 12px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  align-content: start;
}

.tl-item {
  position: relative;
  border-radius: 10px;
  background: #f6f1e8;
  border: 1.5px solid transparent;
  cursor: pointer;
  overflow: hidden;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tl-item:hover { border-color: rgba(224, 123, 108, 0.35); }
.tl-item.is-selected { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(224, 123, 108, 0.25); }
.tl-item.is-pending { opacity: 0.55; }

.tl-item img {
  width: 100%;
  height: 78%;
  object-fit: contain;
  image-rendering: pixelated;
}

.tl-item-state { font-size: 20px; }

.tl-item-name {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  font-size: 10px;
  color: var(--text-secondary);
  background: rgba(255, 253, 248, 0.85);
  text-align: center;
  padding: 1px 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tl-item-ops {
  position: absolute;
  top: 2px;
  right: 2px;
  display: none;
  gap: 2px;
}

.tl-item:hover .tl-item-ops { display: flex; }

.tl-op {
  width: 18px;
  height: 18px;
  border-radius: 6px;
  background: rgba(255, 253, 248, 0.92);
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}

.tl-op.is-danger { color: #c0564a; }
.tl-op:hover { background: #fff; }

.tl-generate {
  grid-column: 1 / -1;
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.tl-generate > :first-child { flex: 1; }

/* ── 编辑动作 ── */
.town-edit-actions {
  position: absolute;
  top: 64px;
  right: 66px;
  display: flex;
  gap: 8px;
}

/* ── POI 编辑小窗 ── */
.town-poi-form {
  position: absolute;
  top: 110px;
  right: 66px;
  width: 240px;
  background: #f4f1eeed;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(54, 42, 38, 0.18);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.town-poi-form .row { display: flex; gap: 6px; justify-content: flex-end; }

/* ── 加载失败 ── */
.town-loadstate {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(233, 237, 218, 0.9);
}

.town-loadstate p { font-size: 13px; color: var(--text-secondary); }

/* ── 资料卡 ── */
.town-card-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.town-card {
  width: 300px;
  max-width: calc(100vw - 40px);
  background: #f4f1eeed;
  border-radius: 18px;
  box-shadow: 0 20px 60px rgba(54, 42, 38, 0.2);
  padding: 18px;
}

.tc-head { display: flex; align-items: center; gap: 12px; }

.tc-avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 20px;
  font-weight: 700;
}

.tc-head-info { flex: 1; min-width: 0; }
.tc-name { font-size: 16px; font-weight: 700; color: var(--text-bright); }

.tc-status-line {
  margin-top: 3px;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tc-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }

.tc-tag {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(224, 123, 108, 0.12);
  color: var(--accent-hover);
}

.tc-tag.is-soft { background: rgba(240, 236, 232, 0.9); color: var(--text-secondary); }
.tc-actions { display: flex; gap: 10px; margin-top: 18px; }
.tc-actions > * { flex: 1; }

.town-modal-enter-active,
.town-modal-leave-active { transition: opacity 0.2s ease; }

.town-modal-enter-active .town-card,
.town-modal-leave-active .town-card { transition: transform 0.2s ease; }

.town-modal-enter-from,
.town-modal-leave-to { opacity: 0; }

.town-modal-enter-from .town-card,
.town-modal-leave-to .town-card { transform: scale(0.96); }

@media (max-width: 767px) {
  .town-topbar { top: 8px; padding: 6px 12px; gap: 8px; }
  .town-title { font-size: 14px; }
  .town-hint { bottom: 10px; }
  .town-library { width: 220px; }
}
</style>
