<template>
  <div class="town-shell">
  <div class="town-view" ref="viewEl">
    <Transition name="town-modal">
      <div v-if="!resourcesReady && !loadError" class="town-boot-mask" role="status" aria-live="polite" aria-busy="true">
        <div class="town-boot-stage">
          <span class="town-boot-loader" aria-hidden="true"></span>
          <p class="town-boot-title">世界加载中</p>
          <p class="town-boot-desc">正在准备地图、居民和素材…</p>
        </div>
      </div>
    </Transition>
    <canvas
      ref="canvasEl"
      class="town-canvas"
      :class="canvasClass"
      @click="onCanvasClick"
      @contextmenu.prevent="onCanvasRightClick"
      @pointerdown="onCanvasDown"
      @pointermove="onCanvasMove"
      @pointerup="onCanvasUp"
      @pointercancel="onCanvasCancel"
      @pointerleave="onCanvasLeave"
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
        <linshe-button variant="ghost" size="sm" :disabled="editing || showAdmin || showWizard || dialogueInputBlocked" :aria-expanded="showWalletPanel" @click="openWalletPanel">钱袋</linshe-button>
        <linshe-switch v-if="hdActive" v-model="tiltShift" size="sm" on-text="移轴" off-text="移轴" aria-label="远景移轴" />
        <linshe-button variant="chip" size="sm" :active="editing" @click="toggleEdit">{{ editing ? '完成编辑' : '编辑' }}</linshe-button>
        <linshe-button variant="chip" size="sm" :active="showAdmin" @click="showAdmin = !showAdmin">管理</linshe-button>
      </div>
    </div>

    <div v-if="initialized && !editing" class="town-hint">
      点击空地走过去 · 点一下店门或掌柜就能进店办事 · 点一点邻居打个招呼 · WASD 移动 · 滚轮缩放
    </div>

    <div v-if="rendererNotice" class="town-render-notice" role="status">
      <span>{{ rendererNotice }}</span>
      <linshe-button v-if="!hdActive" variant="ghost" size="sm"
        :loading="rendererPending" :disabled="rendererPending" @click="!rendererPending && selectRenderer()">重试 HD2D</linshe-button>
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
    <Transition name="town-editor">
      <div v-if="editing" class="town-editor-ui">
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
          <TownAssetThumb
            v-for="asset in libAssets" :key="asset.id"
            class="tl-item"
            :asset="asset"
            :selected="selectedAssetId === asset.id"
            :show-name="true"
            :deletable="true"
            click-title="点击选用"
            @click="selectAsset(asset)"
            @edit="openAssetManager(asset)"
            @delete="requestDeleteAsset(asset)"
          />
          <div class="tl-generate">
            <linshe-input v-model="genDesc" size="sm" placeholder="描述一个新素材…" @keyup.enter="generateAsset" />
            <linshe-button variant="secondary" size="sm" :loading="generating" @click="generateAsset">AI 生成</linshe-button>
          </div>
        </div>
      </div>

      <div class="town-edit-actions" role="toolbar" aria-label="地图编辑操作">
        <div class="town-edit-card">
          <span class="town-edit-state" aria-hidden="true">地图编辑中</span>
          <linshe-button variant="primary" size="md" :loading="savingMap" @click="saveEditor">保存地图</linshe-button>
          <linshe-button variant="secondary" size="md" @click="cancelEdit">放弃</linshe-button>
        </div>
      </div>

      <!-- POI 绑定小窗 -->
      <Transition name="town-pop">
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
      </Transition>

        <div class="town-hint is-edit">{{ currentToolHint }}</div>
      </div>
    </Transition>


    <!-- 就地聊天 / 管理面板 / 向导 -->
    <Transition name="npc-stage" :duration="300">
      <div v-if="dialogueOpen" class="npc-stage" @click.self="closeDialogue">
        <TownCharacterChat v-if="chatCharacterId != null" :key="`char:${chatCharacterId}`"
          :character-id="chatCharacterId" :town-context="dialogueContext" :service-busy="dialogueServiceBusy" @context-invalid="refreshDialogueWorld" :display-name="chatResident?.displayName"
          :standing-url="chatResident?.standingUrl" :avatar-url="chatResident?.avatarPath"
          :player-name="player?.displayName || '我'" show-activity @activity="openDialogueActivity" @close="closeDialogue" />
        <TownNpcChat v-else-if="chatNpcId != null"
          :key="chatNpcId"
          :npc-id="chatNpcId" :world-id="dialogueContext?.worldId" :world-epoch="dialogueContext?.worldEpoch" :service-busy="dialogueServiceBusy"
          :player-name="player?.displayName || '我'"
          :display-name="chatNpcName"
          show-activity @activity="openDialogueActivity"
          @close="closeDialogue"
          @character-chat="openLinkedCharacterChat" @context-invalid="refreshDialogueWorld"
        />
      </div>
    </Transition>
    <p v-if="dialogueOpening || dialogueError || lifeMoveError" class="town-dialogue-notice" role="status">{{ lifeMoveError || dialogueError || '正在停下脚步…' }}</p>
    <TownWalletPanel :open="showWalletPanel" @close="closeWalletPanel" />
    <TownBoardPanel :open="showBoardPanel" @close="closeBoardPanel" @move-to="moveToLifeLocation" @appointments="openAppointments" />
    <town-workshop-service v-if="spotReady && worldSpot.type === 'workshop'" :world-id="worldScope.worldId" :world-epoch="worldScope.worldEpoch"
      :session-id="worldSpot.sessionId" :provider-name="worldSpot.providerName" @close="closeWorldSpot" @chat="openSpotDialogue" />
    <town-cafe-work-panel v-if="spotReady && worldSpot.type === 'cafe'" :world-id="worldScope.worldId" :world-epoch="worldScope.worldEpoch"
      :session-id="worldSpot.sessionId" :provider-name="worldSpot.providerName" @close="closeWorldSpot" @chat="openSpotDialogue" />
    <town-venue-service-panel v-if="spotReady && worldSpot.type === 'venue'" :world-id="worldScope.worldId" :world-epoch="worldScope.worldEpoch"
      :business-key="worldSpot.businessKey" :session-id="worldSpot.sessionId" :provider-name="worldSpot.providerName"
      @close="closeWorldSpot" @chat="openSpotDialogue" />
    <TownAppointmentPanel :open="showAppointments" :residents="agents" :locations="locations" @close="showAppointments = false" />
    <TownActivityPanel :open="!!activityActor" :actor="activityActor" @close="activityActorId = null" />
    <TownAdminPanel :open="showAdmin" @close="showAdmin = false" />
    <TownInitWizard v-if="showWizard" @close="showWizard = false" @applied="onTownApplied" />

    <Teleport to="body">
      <Transition name="town-modal">
        <div v-if="pendingDeleteAsset" class="town-card-mask" @click.self="cancelDeleteAsset">
          <div class="town-card town-delete-confirm" role="alertdialog" aria-modal="true" aria-label="确认删除素材">
            <div class="town-confirm-title">删除素材</div>
            <p class="town-confirm-text">确定删除「{{ pendingDeleteAsset.name || '未命名素材' }}」？删除后无法恢复。</p>
            <p v-if="deleteError" class="town-confirm-error">{{ deleteError }}</p>
            <div class="town-confirm-actions">
              <linshe-button variant="ghost" size="sm" :disabled="deleting" @click="cancelDeleteAsset">取消</linshe-button>
              <linshe-button variant="danger" size="sm" :loading="deleting" @click="confirmDeleteAsset">确认删除</linshe-button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
    <TownAssetManager
      :open="assetManager.open"
      :asset="assetManager.asset"
      title="素材管理"
      :regenerate="regenerateManagedAsset"
      @close="assetManager.open = false"
      @updated="onManagedAssetUpdated"
    />  </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, reactive } from 'vue'
import { storeToRefs } from 'pinia'
import { useTownStore } from '../stores/town.js'
import { formatTownTemperature } from '../utils/townWeather.js'
import * as api from '../api/index.js'
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheSwitch from '../components/ui/LinsheSwitch.vue'
import { createCanvasTownRenderer } from '../town/renderers/CanvasTownRenderer.js'
import { HW, HH, cellTopWorld, cellCenterWorld, worldToCell, objectRect, buildBlockedCells } from '../town/renderers/projection.js'
import { canvasGroundImage } from '../town/renderers/groundTexture.js'
import { adaptAgent, assetUrl } from '../town/renderers/TownSceneAdapter.js'
import LinsheInput from '../components/ui/LinsheInput.vue'
import TownAssetThumb from '../components/town/TownAssetThumb.vue'
import TownAssetManager from '../components/town/TownAssetManager.vue'
import TownNpcChat from '../components/town/TownNpcChat.vue'
import TownCharacterChat from '../components/town/TownCharacterChat.vue'
import TownWalletPanel from '../components/town/TownWalletPanel.vue'
import TownBoardPanel from '../components/town/TownBoardPanel.vue'
import TownWorkshopService from '../components/town/TownWorkshopService.vue'
import TownCafeWorkPanel from '../components/town/TownCafeWorkPanel.vue'
import TownVenueServicePanel from '../components/town/TownVenueServicePanel.vue'
import TownActivityPanel from '../components/town/TownActivityPanel.vue'
import TownAppointmentPanel from '../components/town/TownAppointmentPanel.vue'
import TownAdminPanel from '../components/town/TownAdminPanel.vue'
import TownInitWizard from '../components/town/TownInitWizard.vue'

const props = defineProps({ initialPanel: { type: String, default: '' } })
const town = useTownStore()
const { map: mapMeta, locations, agents, player, weather, loaded, connected, initialized, renderMap } = storeToRefs(town)

// 地砖贴图里菱形中心的纵向位置（占贴图高度比例；生成图菱形居中 → 0.5）
const GROUND_ANCHOR_Y = 0.5

// ── 画布与渲染状态 ──
const viewEl = ref(null)
const canvasEl = ref(null)
const loadError = ref('')
const resourcesReady = ref(false)

let ctx = null
let rafId = 0
let cssW = 0
let cssH = 0
let resizeObserver = null

// Client-only preference; renderer switching never touches the world or SSE.
function readPreference(key, fallback) {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}
const tiltShift = ref(readPreference('town.tiltShift', 'true') !== 'false')
const hdActive = ref(false)
const rendererNotice = ref('')
const rendererPending = ref(false)
let rendererRequest = 0
let hdRenderer = null, canvasRenderer = null, rendererEpoch = 0, disposed = false
const bootWaits = new Set()
let activeScene = null, blockedCells = new Set()
function persistPreference(key, value) { try { localStorage.setItem(key, String(value)) } catch { /* private browsing */ } }
function fallbackRenderer(message) {
  rendererEpoch++
  hdActive.value = false
  hdRenderer?.dispose(); hdRenderer = null
  rendererNotice.value = message
}
async function selectRenderer() {
  const epoch = ++rendererEpoch
  if (disposed) return
  const request = ++rendererRequest
  rendererPending.value = true
  let next = null
  try {
    if (hdRenderer) { hdRenderer.setQuality('balanced', tiltShift.value); return }
    const { Hd2dTownRenderer } = await import('../town/renderers/Hd2dTownRenderer.js')
    if (disposed || epoch !== rendererEpoch) return
    next = new Hd2dTownRenderer({ onFailure: fallbackRenderer })
    next.mount(viewEl.value)
    next.setQuality('balanced', tiltShift.value)
    next.resize(cssW, cssH, window.devicePixelRatio || 1)
    next.setScene(activeScene)
    next.setCamera(cam)
    hdRenderer = next; hdActive.value = true; rendererNotice.value = ''
  } catch (error) {
    next?.dispose()
    console.warn('[town] HD2D unavailable:', error)
    if (!disposed && epoch === rendererEpoch) fallbackRenderer('当前设备无法启用 HD2D，世界渲染不可用')
  } finally {
    if (!disposed && request === rendererRequest) rendererPending.value = false
  }
}
watch(tiltShift, value => { persistPreference('town.tiltShift', value); hdRenderer?.setQuality('balanced', value) })

// 摄像机（世界像素坐标）
const cam = reactive({ x: 0, y: 0, zoom: 1 })
let followPlayer = true

// 静态图层烘焙
let staticDirty = true

// 图片缓存
const imgCache = new Map()
function getImg(url) {
  if (!url || disposed) return null
  let entry = imgCache.get(url)
  if (!entry) {
    const img = new Image()
    entry = { img, ok: false }
    entry.ready = new Promise(resolve => {
      entry.cancel = () => resolve(false)
      img.onload = () => { entry.ok = true; staticDirty = true; resolve(true) }
      img.onerror = () => { entry.ok = false; entry.failed = true; resolve(false) }
    })
    img.src = url
    imgCache.set(url, entry)
  }
  return entry.ok ? entry.img : null
}

function preloadImage(url) {
  if (!url) return Promise.resolve()
  getImg(url)
  return imgCache.get(url)?.ready || Promise.resolve()
}
function assetById(assetId) {
  return (editing.value && townAssets.value.find(a => a.id === assetId)) || renderMap.value?.assets?.find(a => a.id === assetId) || null
}
function assetImage(assetId) {
  const asset = assetById(assetId)
  return asset ? getImg(assetUrl(asset)) : null
}

// ── 等距坐标换算 ──
// 逻辑格 (cx, cy) 的菱形顶点：((cx-cy)*HW, (cx+cy)*HH)；中心再 +HH

function screenToWorld(cssX, cssY) {
  return {
    x: (cssX - cssW / 2) / cam.zoom + cam.x,
    y: (cssY - cssH / 2) / cam.zoom + cam.y,
  }
}

function screenToCell(cssX, cssY) {
  if (hdRenderer) return hdRenderer.pick({ x: cssX, y: cssY }, { groundOnly: true })?.cell || { x: -1, y: -1 }
  const w = screenToWorld(cssX, cssY)
  return worldToCell(w.x, w.y)
}

function inBounds(c) {
  const m = renderMap.value
  return m && c.x >= 0 && c.y >= 0 && c.x < m.cols && c.y < m.rows
}

// ── 交互状态 ──
// 地图上点谁都不再走「选中资料卡」：居民与入住角色统一直接开对话舞台。
const hoverAgentKey = ref(null)
const hoverSpotKey = ref(null)
const chatNpcId = ref(null)
const chatNpcName = ref('')
const chatCharacterId = ref(null)
const chatResident = ref(null)
const dialogueContext = ref(null)
const dialogueOpening = ref(false)
const dialogueError = ref('')
const showWalletPanel = ref(false)
const showBoardPanel = ref(false)
// 世界里点开的建筑玩法：{ type, businessKey, displayName, providerName, providerActorId, sessionId }
const worldSpot = ref(null)
const approaching = ref('')
const townEconomy = ref(null)
const showAppointments = ref(false)
const activityActorId = ref(null)
const activityActor = computed(() => {
  const actor = agents.value.find(agent => agent.actorId === activityActorId.value)
  return actor ? { ...actor, worldId: town.snapshot?.worldId, worldEpoch: town.snapshot?.worldEpoch } : null
})
const lifeMoving = ref(false)
const lifeMoveError = ref('')
let dialogueRequest = 0
let lifeMoveRequest = 0
const dialogueOpen = computed(() => chatNpcId.value != null || chatCharacterId.value != null)
const dialogueServiceBusy = computed(() => {
  const resident = agents.value.find(agent => dialogueContext.value?.actorId
    ? agent.actorId === dialogueContext.value.actorId
    : chatCharacterId.value != null ? agent.characterId === chatCharacterId.value : agent.npcId === chatNpcId.value)
  return resident?.busyReason === 'SERVICE_BUSY'
})
const dialogueInputBlocked = computed(() => dialogueOpen.value || dialogueOpening.value || showWalletPanel.value
  || showBoardPanel.value || !!worldSpot.value || lifeMoving.value || showAppointments.value || !!activityActor.value)
const worldScope = computed(() => ({ worldId: town.snapshot?.worldId || '', worldEpoch: town.snapshot?.worldEpoch ?? 0 }))
const spotReady = computed(() => !!worldSpot.value && !!worldScope.value.worldId && worldScope.value.worldEpoch > 0)
const showAdmin = ref(false)
const showWizard = ref(false)
const dragging = ref(false)

// 键盘移动（等距屏幕方向 → 逻辑格对角）
const keysDown = new Set()
let moveTimer = null

watch(dialogueInputBlocked, blocked => {
  if (!blocked) return
  clearMovementKeys()
  onCanvasLeave()
}, { flush: 'sync' })
watch(() => [town.snapshot?.worldId, town.snapshot?.worldEpoch], () => {
  activityActorId.value = null; showAppointments.value = false
  showWalletPanel.value = false; showBoardPanel.value = false; worldSpot.value = null; approaching.value = ''
  ++lifeMoveRequest; lifeMoving.value = false; lifeMoveError.value = ''
  refreshTownEconomy()
})
watch(() => [town.snapshot?.worldId, town.snapshot?.worldEpoch,
  chatCharacterId.value == null || agents.value.some(agent => agent.actorId === dialogueContext.value?.actorId && agent.characterId === chatCharacterId.value)], () => {
  if (!dialogueOpen.value || !dialogueContext.value) return
  if (town.snapshot?.worldId !== dialogueContext.value.worldId || town.snapshot?.worldEpoch !== dialogueContext.value.worldEpoch
      || (chatCharacterId.value != null && !agents.value.some(agent => agent.actorId === dialogueContext.value.actorId && agent.characterId === chatCharacterId.value))) {
    closeDialogue()
    dialogueError.value = '小镇或人物已变化，请重新选择邻居。'
  }
})

// ── 编辑器状态 ──
const editing = ref(false)
const editTool = ref('ground')
const libKind = ref('ground')
const selectedAssetId = ref(null)
const genDesc = ref('')
const generating = ref(false)
const savingMap = ref(false)
const townAssets = ref([])
const assetManager = reactive({ open: false, asset: null })
const pendingDeleteAsset = ref(null)
const deleting = ref(false)
const deleteError = ref('')

const editLayers = ref(null)
const editLocations = ref([])
const paintDrag = ref(null)
const ghostCell = ref(null)
const poiEdit = ref(null)

const TOOLS = [
  { id: 'ground', icon: '🟩', label: '地砖画笔（点涂/拖动刷矩形）' },
  { id: 'road', icon: '🟨', label: '道路画笔' },
  { id: 'place', icon: '🏠', label: '放置建筑/道具（点击处为朝向镜头的底角格）' },
  { id: 'delete', icon: '🧨', label: '删除对象' },
  { id: 'block', icon: '🚧', label: '阻挡涂刷（左键阻挡，右键恢复可走）' },
  { id: 'poi', icon: '📍', label: 'POI 绑定（点建筑）' },
]
const LIB_TABS = [
  { id: 'ground', label: '地砖' },
  { id: 'road', label: '道路' },
  { id: 'building', label: '建筑' },
  { id: 'prop', label: '道具' },
]

const canvasClass = computed(() => ({
  'is-hoverable': !!hoverAgentKey.value || !!hoverSpotKey.value,
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

const weatherText = computed(() => {
  const w = weather.value
  if (!w) return ''
  return [w.text, formatTownTemperature(w.temperature)].filter(Boolean).join(' ')
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
    // 两方向素材按屏幕纵向速度选择：screen dy = 16 * (dx + dy)。
    facing[a.agentKey] = pos.dx + pos.dy < 0 ? 'up' : 'down'
  }
  return facing[a.agentKey] || 'down'
}

function hitAgent(cssX, cssY) {
  return hdRenderer?.pick({ x: cssX, y: cssY }, { agentsOnly: true })?.agent || null
}

// ── 世界里的店：走到门口点一下就能进店办事 ──
// 店台账面只在服务端；前端只按 /api/town/economy 的投影把地点映成可点的热区，
// 新增建筑只改后端注册表，这里不需要再认名字。
let economyRead = 0
async function refreshTownEconomy() {
  const request = ++economyRead
  try {
    const data = await api.getTownEconomy()
    if (disposed || request !== economyRead) return
    if (!data || typeof data.configured !== 'boolean') throw new Error('小镇状态不完整')
    townEconomy.value = data
  } catch {
    if (request === economyRead) townEconomy.value = null
  }
}
function actorName(actorId, fallback) {
  if (!actorId) return fallback
  return (townEconomy.value?.participants || []).find(item => item.actorId === actorId)?.displayName || fallback
}
const venueSpots = computed(() => {
  const economy = townEconomy.value
  if (!economy?.configured) return []
  const map = renderMap.value
  // /api/town/map 的地点带 objectId，是画布所画的那一份；载荷还没到时退回快照地点，两处同源。
  const places = map?.locations?.length ? map.locations : (locations.value || [])
  const placeByKey = new Map(places.map(item => [item.key, item]))
  const objectById = new Map((map?.layers?.objects || []).map(item => [item.id, item]))
  const assetById = new Map((map?.assets || []).map(item => [item.id, item]))
  const rows = []
  const push = (type, businessKey, displayName, locationKey, providerActorId = null) => {
    const location = placeByKey.get(locationKey)
    if (!location || !Number.isInteger(location.x) || !Number.isInteger(location.y)) return
    const object = location.objectId ? objectById.get(location.objectId) : null
    const rect = object ? objectRect(object, assetById.get(object.assetId)?.meta || {}) : null
    rows.push({ type, businessKey, displayName, location, rect, providerActorId,
      providerName: actorName(providerActorId, type === 'workshop' ? '工坊邻居' : displayName) })
  }
  push('board', 'board', '公告站', economy.slice?.locationKeys?.board)
  push('workshop', 'workshop', '工坊', economy.service?.locationKey, economy.service?.providerActorId)
  push('cafe', 'cafe', '咖啡馆', economy.cafe?.locationKey, economy.cafe?.providerActorId)
  for (const venue of economy.venues || []) push('venue', venue.businessKey, venue.displayName, venue.locationKey, venue.providerActorId)
  return rows
})
/** 按格子找热区：建筑占地整块都算，没绑建筑的地点按锚点半径算。 */
function spotAtCell(cell) {
  if (!cell || cell.x < 0 || cell.y < 0) return null
  let best = null
  for (const spot of venueSpots.value) {
    const { location, rect } = spot
    if (rect && cell.x >= rect.x0 - 1 && cell.x <= rect.x1 + 1 && cell.y >= rect.y0 - 1 && cell.y <= rect.y1 + 1) return spot
    const distance = Math.max(Math.abs(cell.x - location.x), Math.abs(cell.y - location.y))
    if (distance <= (location.radius ?? 2) && (!best || distance < best.distance)) best = { spot, distance }
  }
  return best ? best.spot : null
}
function spotForActor(actorId) {
  if (!actorId) return null
  return venueSpots.value.find(spot => spot.providerActorId === actorId) || null
}
function hitWorldSpot(cssX, cssY) {
  if (!venueSpots.value.length) return null
  if (hdRenderer) {
    const picked = hdRenderer.pick({ x: cssX, y: cssY })
    // 点在建筑立面上时以真正命中那栋楼为准，避免被它身后的格子抢先。
    if (picked?.kind === 'object') {
      const objectId = picked.object?.id
      return venueSpots.value.find(spot => spot.location.objectId && spot.location.objectId === objectId) || null
    }
  }
  return spotAtCell(screenToCell(cssX, cssY))
}
/** 玩家是否已经站在地点范围内（与 townService.hasArrived 同一口径：不动且切比雪夫距离 ≤ 半径）。 */
function playerAtLocation(location) {
  const me = player.value
  if (!me || !location) return false
  const pos = agentDisplayPos(me)
  if (pos.moving) return false
  return Math.max(Math.abs(pos.x - location.x), Math.abs(pos.y - location.y)) <= (location.radius ?? 2)
}
function waitForSpot(location, current) {
  return new Promise(resolve => {
    const deadline = Date.now() + 20000
    const tick = () => {
      if (disposed || !current()) return resolve(false)
      if (playerAtLocation(location)) return resolve(true)
      if (Date.now() > deadline) return resolve(false)
      window.setTimeout(tick, 120)
    }
    tick()
  })
}
function inFlightSessionId(spot) {
  const sessions = spot.type === 'cafe' ? townEconomy.value?.cafe?.sessions
    : spot.type === 'workshop' ? townEconomy.value?.service?.sessions
      : (townEconomy.value?.venues || []).find(item => item.businessKey === spot.businessKey)?.sessions
  return (sessions || []).find(item => ['offered', 'active', 'resolving', 'settling'].includes(item.status))?.sessionId || null
}
function openSpotPanel(spot) {
  worldSpot.value = { type: spot.type, businessKey: spot.businessKey, displayName: spot.displayName,
    providerName: spot.providerName, providerActorId: spot.providerActorId, sessionId: inFlightSessionId(spot) }
}
function closeWorldSpot() {
  worldSpot.value = null
  refreshTownEconomy()
}
function openSpotDialogue() {
  const spot = worldSpot.value
  if (!spot) return
  const resident = agents.value.find(agent => agent.actorId === spot.providerActorId) || null
  closeWorldSpot()
  if (resident) openDialogue(resident)
  else dialogueError.value = `暂时找不到${spot.providerName}，请稍后再试。`
}
async function walkToSpot(spot) {
  const request = ++lifeMoveRequest
  const current = () => !disposed && request === lifeMoveRequest
  approaching.value = spot.displayName
  lifeMoveError.value = ''
  try {
    const result = await town.movePlayer(spot.location.x, spot.location.y)
    if (result?.ok === false) throw new Error('这个门口暂时走不过去，请稍后再试。')
    const arrived = await waitForSpot(spot.location, current)
    if (!current()) return
    // 到店才开店：服务端要求玩家真的站在地点范围内，面板里的报价与接受才有意义。
    if (arrived) openSpotPanel(spot)
    else lifeMoveError.value = `还没走到${spot.displayName}门口，再点一次就好。`
  } catch (err) {
    if (current()) lifeMoveError.value = err?.message || '这个门口暂时走不过去，请稍后再试。'
  } finally {
    if (current()) approaching.value = ''
  }
}
/** 点建筑或点经营者都走同一条路：先到门口，再开这家店的玩法面板。 */
function enterWorldSpot(spot) {
  if (!spot || editing.value || showAdmin.value || showWizard.value || dialogueInputBlocked.value) return
  if (spot.type === 'board') { openBoardPanel(); return }
  lifeMoveError.value = ''
  if (playerAtLocation(spot.location)) { openSpotPanel(spot); return }
  walkToSpot(spot)
}

// ── 点击/拖拽交互 ──

// 统一走 Pointer Events（鼠标 / 手指 / 触控笔一条路径）。之前只绑 mouse*，
// 在触摸设备上只能拿到浏览器合成的兼容鼠标事件：手指一滑动，浏览器就把手势
// 当成页面滚动接管，mousemove 直接断掉，于是地图拖不动。配合样式表里
// .town-canvas 的 touch-action: none，拖拽才会稳定走我们自己的平移逻辑。
// e.offsetX / e.offsetY 是元素本地坐标系下的偏移（已经扣掉 CSS transform），
// 所以手机竖屏里那层 rotate(90deg) 不用再手动换算，命中测试和位移都直接可用。

let downInfo = null
let suppressClick = false

function onCanvasDown(e) {
  if (dialogueInputBlocked.value) return
  suppressClick = false
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
  if (dialogueInputBlocked.value) return
  if (editing.value) {
    ghostCell.value = screenToCell(e.offsetX, e.offsetY)
    if (paintDrag.value) {
      paintDrag.value.lastCell = screenToCell(e.offsetX, e.offsetY)
      paintCell(paintDrag.value.lastCell)
    }
  }
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
  // 手指没有悬停态，拖动地图时不用一路做命中测试
  if (e.pointerType === 'touch') return
  hoverAgentKey.value = editing.value ? null : (hitAgent(e.offsetX, e.offsetY)?.agentKey || null)
  hoverSpotKey.value = editing.value || hoverAgentKey.value ? null : (spotAtCell(screenToCell(e.offsetX, e.offsetY))?.businessKey || null)
}

function onCanvasUp(e) {
  suppressClick = !!downInfo?.moved
  if (editing.value && paintDrag.value && downInfo?.moved) {
    fillRect(paintDrag.value.startCell, paintDrag.value.lastCell)
  }
  paintDrag.value = null
  dragging.value = false
  downInfo = null
  // 手指抬起后没有 mouseleave 那种收尾，高亮得自己清掉
  if (e?.pointerType === 'touch') {
    hoverAgentKey.value = null
    hoverSpotKey.value = null
  }
}

// pointercancel（手势被系统接管、来电等）：只收尾，不能算成“移动过”，
// 否则 suppressClick 会留着把下一次正常点击吃掉。
function onCanvasCancel() {
  paintDrag.value = null
  dragging.value = false
  downInfo = null
  suppressClick = false
  hoverAgentKey.value = null
  hoverSpotKey.value = null
}

function onCanvasLeave() {
  paintDrag.value = null
  dragging.value = false
  downInfo = null
  hoverAgentKey.value = null
  hoverSpotKey.value = null
}

function onCanvasClick(e) {
  if (dialogueInputBlocked.value) return
  if (suppressClick || downInfo?.moved) { suppressClick = false; return }
  if (!loaded.value) return
  if (editing.value) {
    handleEditClick(e)
    return
  }
  if (!initialized.value) return
  const hit = hitAgent(e.offsetX, e.offsetY)
  if (hit) {
    // 掌柜本人也是这家店的入口：点他就进店办事，面板里还留着聊天入口。
    const spot = spotForActor(hit.actorId)
    if (spot) { enterWorldSpot(spot); return }
    // 入住角色与居民同口径：点一下直接开对话舞台（立绘 + 对话框），不再弹资料卡。
    if (hit.characterId) { goChat(hit.characterId); return }
    openDialogue(hit)
    return
  }
  const spot = hitWorldSpot(e.offsetX, e.offsetY)
  if (spot) { enterWorldSpot(spot); return }
  const cell = screenToCell(e.offsetX, e.offsetY)
  if (!inBounds(cell) || blockedCells.has(`${cell.x},${cell.y}`)) return
  town.movePlayer(cell.x, cell.y).catch(err => {
    console.warn('[town] move failed:', err?.message)
  })
}

function onCanvasRightClick(e) {
  if (dialogueInputBlocked.value) return
  if (editing.value && editTool.value === 'block') {
    const cell = screenToCell(e.offsetX, e.offsetY)
    paintBlock(cell, 0) // 右键 = 手动清障（恢复可走）
  }
}

function onDblClick() {
  if (dialogueInputBlocked.value) return
  if (!editing.value) followPlayer = true
}

function onWheel(e) {
  if (dialogueInputBlocked.value) return
  const factor = e.deltaY < 0 ? 1.12 : 0.89
  const newZoom = Math.min(2.5, Math.max(0.5, cam.zoom * factor))
  const before = screenToWorld(e.offsetX, e.offsetY)
  cam.zoom = newZoom
  const after = screenToWorld(e.offsetX, e.offsetY)
  cam.x += before.x - after.x
  cam.y += before.y - after.y
  if (Math.abs(newZoom - 1) > 0.01) followPlayer = false
}

// ── 键盘移动：等距屏幕方向 → 逻辑格 ──

const KEY_DIRS = {
  KeyW: [-1, 0], ArrowUp: [-1, 0],      // 屏幕左上
  KeyD: [0, -1], ArrowRight: [0, -1],   // 屏幕右上
  KeyS: [1, 0], ArrowDown: [1, 0],      // 屏幕右下
  KeyA: [0, 1], ArrowLeft: [0, 1],      // 屏幕左下
}

function onKeyDown(e) {
  if (editing.value || showAdmin.value || showWizard.value || dialogueInputBlocked.value) return
  if (e.isComposing || document.activeElement?.closest('input, textarea, [contenteditable="true"], [role="combobox"], [role="listbox"]')) return
  if (KEY_DIRS[e.code]) {
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

function clearMovementKeys() {
  keysDown.clear()
  if (moveTimer) { clearInterval(moveTimer); moveTimer = null }
}

function stepByKey() {
  if (editing.value || showAdmin.value || showWizard.value || dialogueInputBlocked.value || document.hidden) { clearMovementKeys(); return }
  for (const code of keysDown) {
    const [dx, dy] = KEY_DIRS[code] || [0, 0]
    if (dx || dy) {
      town.movePlayerDir(dx, dy).catch(() => {})
      break
    }
  }
}

// ── 编辑器操作 ──

function toggleEdit() {
  if (editing.value) cancelEdit()
  else beginEdit()
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

function openAssetManager(asset) {
  if (asset?.status !== 'ready') return
  assetManager.asset = asset
  assetManager.open = true
}

function regenerateManagedAsset(asset) {
  return api.regenerateTownAsset(asset.id, {}).then(data => data.asset)
}

function onManagedAssetUpdated() {
  fetchAssetsList()
  town.fetchMap().catch(() => {})
}

function requestDeleteAsset(asset) {
  if (!asset?.id || deleting.value) return
  pendingDeleteAsset.value = asset
  deleteError.value = ''
}

function cancelDeleteAsset() {
  if (deleting.value) return
  pendingDeleteAsset.value = null
  deleteError.value = ''
}

async function confirmDeleteAsset() {
  const asset = pendingDeleteAsset.value
  if (!asset?.id || deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await api.deleteTownAsset(asset.id)
    if (selectedAssetId.value === asset.id) selectedAssetId.value = null
    pendingDeleteAsset.value = null
    await fetchAssetsList()
  } catch (err) {
    deleteError.value = err?.message || '删除失败，请重试'
    console.warn('[town] delete failed:', err?.message)
  } finally {
    deleting.value = false
  }
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

/** 建筑/道具 footprint 的逻辑矩形 [x0..x1] × [y0..y1]（obj.x = x0 左上列，obj.y = y1 底行） */
function objRect(obj) {
  return objectRect(obj, assetById(obj.assetId)?.meta)
}

function objectContainsCell(obj, cell) {
  const r = objRect(obj)
  return cell.x >= r.x0 && cell.x <= r.x1 && cell.y >= r.y0 && cell.y <= r.y1
}

function handleEditClick(e) {
  const cell = screenToCell(e.offsetX, e.offsetY)
  if (!inBounds(cell)) return
  const layers = editLayers.value
  if (!layers) return

  if (['ground', 'road'].includes(editTool.value)) {
    if (!selectedAsset.value) return
    fillRect(cell, cell)
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
        // 锚点 = 朝向镜头的底角格（门前）
        x: obj.x + (fp?.w || 1) - 1,
        y: obj.y,
        radius: 2,
        ambient: '',
      }
    }
  }
}

function placeObject(cell) {
  const asset = selectedAsset.value
  if (!asset || !['building', 'prop'].includes(asset.kind)) return
  const fp = asset.meta?.footprint || { w: 1, h: 1 }
  const m = renderMap.value
  // 点击格 = 底角格（最靠近镜头的一格）
  const x0 = cell.x - (fp.w - 1)
  const y1 = cell.y
  const y0 = y1 - fp.h + 1
  if (x0 < 0 || y0 < 0 || x0 + fp.w > m.cols || y1 >= m.rows) return
  editLayers.value.objects.push({ assetId: asset.id, x: x0, y: y1, flip: false })
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
      tileSize: HW * 2,
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
  town.clearDraftPreview()
  town.fetchState().catch(() => {})
}

// ── 渲染 ──

/** 地砖贴图绘制尺寸：宽 = 菱形全宽 2*HW，高按贴图纵横比 */
function groundTileDrawSize(img) {
  const w = HW * 2
  const h = img.naturalWidth ? w * (img.naturalHeight / img.naturalWidth) : w / 2
  return { w, h }
}

function diamondPath(c, cx, cy, hw, hh) {
  c.beginPath(); c.moveTo(cx, cy - hh); c.lineTo(cx + hw, cy)
  c.lineTo(cx, cy + hh); c.lineTo(cx - hw, cy); c.closePath()
}
function drawEditorOverlays(c) {
  const m = renderMap.value
  const layers = editing.value ? editLayers.value : m?.layers
  if (!m || !layers) return

  // 阻挡格：菱形红叉
  const override = layers.blockOverride
  if (Array.isArray(override)) {
    c.save()
    c.strokeStyle = 'rgba(220, 90, 70, 0.55)'
    c.lineWidth = 1.5
    for (let y = 0; y < m.rows; y++) {
      for (let x = 0; x < m.cols; x++) {
        if (override[y]?.[x] === 1) {
          const t = cellTopWorld(x, y)
          c.beginPath()
          c.moveTo(t.x, t.y + HH * 0.5)
          c.lineTo(t.x + HW * 0.6, t.y + HH)
          c.moveTo(t.x + HW * 0.6, t.y + HH * 0.5)
          c.lineTo(t.x, t.y + HH)
          c.stroke()
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
    if (editTool.value === 'place') {
      const x0 = cell.x - (fp.w - 1)
      const y1 = cell.y
      const y0 = y1 - fp.h + 1
      const north = cellTopWorld(x0, y0)
      const southY = (cell.x + y1 + 2) * HH
      const westX = (x0 - y1 - 1) * HW
      const eastX = (cell.x - y0 + 1) * HW
      const centerX = (north.x + ((cell.x - y1) * HW)) / 2
      const img = getImg(assetUrl(asset))
      c.save()
      if (img) {
        const imgW = eastX - westX
        const imgH = imgW * (img.naturalHeight / Math.max(1, img.naturalWidth))
        c.globalAlpha = 0.55
        c.drawImage(img, centerX - imgW / 2, southY - imgH, imgW, imgH)
      }
      c.globalAlpha = 0.4
      c.fillStyle = '#7fc48a'
      diamondPath(c, centerX, (north.y + southY) / 2, (eastX - westX) / 2, (southY - north.y) / 2)
      c.fill()
      c.restore()
    } else {
      const img = canvasGroundImage(getImg(assetUrl(asset)), asset)
      const t = cellTopWorld(cell.x, cell.y)
      c.save()
      c.globalAlpha = 0.5
      if (img) {
        const { w, h } = groundTileDrawSize(img)
        c.drawImage(img, t.x - HW, t.y + HH - h * (asset.meta?.projection === 'topdown_square' ? 0.5 : asset.meta?.groundAnchorY ?? GROUND_ANCHOR_Y), w, h)
      }
      c.globalAlpha = 0.4
      c.fillStyle = editTool.value === 'road' ? '#e8c86a' : '#8ab6d6'
      diamondPath(c, t.x, t.y + HH, HW, HH)
      c.fill()
      c.restore()
    }
  }

  // 矩形填充预览（逻辑矩形 → 屏幕菱形）
  if (paintDrag.value) {
    const { startCell, lastCell } = paintDrag.value
    const x0 = Math.min(startCell.x, lastCell.x)
    const y0 = Math.min(startCell.y, lastCell.y)
    const x1 = Math.max(startCell.x, lastCell.x)
    const y1 = Math.max(startCell.y, lastCell.y)
    const n = cellTopWorld(x0, y0)
    const e = cellTopWorld(x1, y0)
    const s = cellTopWorld(x1, y1)
    const w = cellTopWorld(x0, y1)
    c.save()
    c.globalAlpha = 0.3
    c.fillStyle = '#8ab6d6'
    c.beginPath()
    c.moveTo(n.x, n.y)
    c.lineTo(e.x + HW, e.y + HH)
    c.lineTo(s.x, s.y + 2 * HH)
    c.lineTo(w.x - HW, w.y + HH)
    c.closePath()
    c.fill()
    c.restore()
  }

  // POI 标记
  c.save()
  c.font = '10px "HarmonyOS Sans SC", sans-serif'
  c.textAlign = 'center'
  for (const loc of editLocations.value) {
    const center = cellCenterWorld(loc.x, loc.y)
    c.fillStyle = 'rgba(224,123,108,0.85)'
    c.beginPath()
    c.arc(center.x, center.y - 8, 4, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#5c4a3a'
    c.fillText(loc.name, center.x, center.y + 8)
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
  if (tint && !hdActive.value) {
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
  if (!ctx || disposed) return
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  const m = renderMap.value
  if (staticDirty) {
    activeScene = m ? { ...m, layers: editing.value ? editLayers.value : m.layers } : null
    // Library assets include newly generated materials not yet referenced by the saved map.
    if (activeScene && editing.value) activeScene.assets = [...new Map([...(m.assets || []), ...townAssets.value].map(a => [a.id, a])).values()]
    canvasRenderer.setScene(activeScene)
    hdRenderer?.setScene(activeScene)
    blockedCells = buildBlockedCells(activeScene)
    staticDirty = false
  }
  if (player.value && followPlayer && !editing.value) {
    const pos = agentDisplayPos(player.value)
    const center = cellCenterWorld(pos.x, pos.y)
    cam.x += (center.x - cam.x) * 0.08
    cam.y += (center.y - cam.y) * 0.08
  }
  const frames = editing.value ? [] : [...agents.value, ...(player.value ? [player.value] : [])].map(a => {
    const pos = agentDisplayPos(a)
    return adaptAgent(a, pos, agentFacing(a, pos), nowMs)
  })
  const interactionActorKeys = ['me', hoverAgentKey.value,
    chatResident.value?.actorId, activityActorId.value].filter(Boolean)
  if (hdRenderer) {
    try {
      hdRenderer.setCamera(cam)
      hdRenderer.updateAgents(frames)
      hdRenderer.render(weather.value, frames.filter(f => interactionActorKeys.includes(f.agent.agentKey)
        || interactionActorKeys.includes(f.agent.actorId)).map(f => f.ground), { interactionActorKeys })
    } catch (error) {
      console.warn('[town] render failed:', error)
      fallbackRenderer('画面渲染中断，HD2D 已停止')
    }
  }
  if (m && hdActive.value) {
    ctx.save()
    ctx.translate(cssW / 2, cssH / 2); ctx.scale(cam.zoom, cam.zoom); ctx.translate(-cam.x, -cam.y)
    ctx.imageSmoothingEnabled = false
    canvasRenderer.draw(ctx, frames, nowMs, { labelsOnly: true, hover: hoverAgentKey.value })
    if (editing.value) drawEditorOverlays(ctx)
    ctx.restore()
  } else {
    ctx.fillStyle = '#dfe5d0'; ctx.fillRect(0, 0, cssW, cssH)
    ctx.fillStyle = '#8c8074'; ctx.font = '13px "HarmonyOS Sans SC", sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(hdActive.value ? (loaded.value ? '这片土地还在等待它的故事…' : '正在唤醒这个世界…') : 'HD2D 渲染不可用，请点击重试', cssW / 2, cssH / 2)
  }
  drawWeatherOverlay(ctx, nowMs)
  if (!document.hidden) rafId = requestAnimationFrame(draw)
}

// ── 布局 / 生命周期 ──

function relayout() {
  if (!viewEl.value || !canvasEl.value) return
  // Layout dimensions stay in game coordinates even when the phone rotates the view.
  cssW = Math.max(200, viewEl.value.clientWidth)
  cssH = Math.max(200, viewEl.value.clientHeight)
  const dpr = window.devicePixelRatio || 1
  canvasEl.value.width = Math.round(cssW * dpr)
  canvasEl.value.height = Math.round(cssH * dpr)
  canvasEl.value.style.width = `${cssW}px`
  canvasEl.value.style.height = `${cssH}px`
  hdRenderer?.resize(cssW, cssH, dpr)
}

function centerCamera() {
  const m = renderMap.value
  if (!m) return
  const center = cellCenterWorld(m.cols / 2, m.rows / 2)
  cam.x = center.x
  cam.y = center.y
  cam.zoom = player.value ? (cssW < 600 ? 1.15 : 1.5) : Math.min(1.5, Math.max(0.5, Math.min(cssW / ((m.cols + m.rows) * HW), cssH / ((m.cols + m.rows) * HH))))
  if (player.value) { const p = cellCenterWorld(player.value.x, player.value.y); cam.x = p.x; cam.y = p.y }
  followPlayer = true
}

function waitForRenderMap(timeout = 6000) {
  if (disposed) return Promise.resolve(false)
  if (renderMap.value) return Promise.resolve(true)
  return new Promise(resolve => {
    const startedAt = Date.now()
    let timer
    const finish = value => { clearTimeout(timer); bootWaits.delete(cancel); resolve(value) }
    const cancel = () => finish(false)
    bootWaits.add(cancel)
    const check = () => {
      if (disposed) return finish(false)
      if (renderMap.value) return finish(true)
      if (Date.now() - startedAt >= timeout) return finish(false)
      timer = setTimeout(check, 50)
    }
    check()
  })
}

function nextFrames(count = 2) {
  if (disposed) return Promise.resolve()
  return new Promise(resolve => {
    let remaining = count, frame
    const finish = () => { cancelAnimationFrame(frame); bootWaits.delete(finish); resolve() }
    bootWaits.add(finish)
    const tick = () => {
      if (disposed || --remaining <= 0) finish()
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  })
}

function minimumBootDelay() {
  if (disposed) return Promise.resolve()
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); bootWaits.delete(finish); resolve() }
    const timer = setTimeout(finish, 300)
    bootWaits.add(finish)
  })
}

function collectWorldResourceUrls() {
  const m = renderMap.value
  if (!m) return []
  const urls = []
  const usedAssets = new Set()
  const layers = m.layers || {}
  for (const layer of [layers.ground, layers.road]) {
    for (const row of layer || []) { for (const id of row || []) if (id) usedAssets.add(id) }
  }
  for (const obj of layers.objects || []) if (obj?.assetId) usedAssets.add(obj.assetId)
  const assetsById = new Map((m.assets || []).map(asset => [asset.id, asset]))
  for (const id of usedAssets) {
    const asset = assetsById.get(id)
    if (asset?.status === 'ready') urls.push(assetUrl(asset))
  }
  for (const agent of [...agents.value, ...(player.value ? [player.value] : [])]) {
    for (const spriteUrl of Object.values(agent.sprites || {})) urls.push(spriteUrl)
    urls.push(agent.standingUrl, agent.avatarPath)
  }
  return [...new Set(urls.filter(Boolean))]
}

async function preloadWorldResources() {
  await Promise.allSettled(collectWorldResourceUrls().map(preloadImage))
}

async function prepareWorldResources() {
  if (disposed) return
  resourcesReady.value = false
  try {
    await selectRenderer()
    if (disposed) return
    const snapshot = await town.fetchState()
    if (disposed) return
    if (snapshot?.initialized) {
      refreshTownEconomy()
      await waitForRenderMap()
      if (disposed) return
      await preloadWorldResources()
      if (disposed) return
    }
    centerCamera()
    await Promise.all([nextFrames(2), minimumBootDelay()])
  } catch (err) {
    if (!disposed) loadError.value = '世界暂时联系不上：' + (err?.message || '未知错误')
  } finally {
    if (!disposed) resourcesReady.value = true
  }
}

function onVisibility() {
  if (document.hidden) clearMovementKeys()
  if (!document.hidden && rafId === 0) rafId = requestAnimationFrame(draw)
}

function retryLoad() {
  loadError.value = ''
  return prepareWorldResources()
}

watch(renderMap, (m, old) => {
  staticDirty = true
  if (m && (!old || old.version !== m.version || old.name !== m.name)) {
    if (!editing.value) centerCamera()
  }
}, { deep: true })

watch(editing, (v) => {
  if (!v) staticDirty = true
})

// A mailbox task link opens the current snapshot for review; it never accepts or moves.
watch(() => [resourcesReady.value, props.initialPanel], ([ready, panel]) => {
  if (ready && initialized.value && panel === 'life' && !disposed) openWalletPanel()
})

watch(editLayers, () => { staticDirty = true }, { deep: true })
watch(townAssets, () => { staticDirty = true }, { deep: true })

onMounted(async () => {
  ctx = canvasEl.value.getContext('2d')
  canvasRenderer = createCanvasTownRenderer({ getImg, agentFacing, isImagePending: url => { const entry = imgCache.get(url); return !!entry && !entry.ok && !entry.failed } })
  town.startTownStream()
  relayout()
  resizeObserver = new ResizeObserver(() => relayout())
  resizeObserver.observe(viewEl.value)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', clearMovementKeys)
  rafId = requestAnimationFrame(draw)
  await prepareWorldResources()
})

onBeforeUnmount(() => {
  disposed = true; rendererEpoch++
  for (const cancel of [...bootWaits]) cancel()
  hdRenderer?.dispose(); hdRenderer = null
  canvasRenderer?.dispose()
  for (const entry of imgCache.values()) { entry.img.onload = null; entry.img.onerror = null; entry.cancel?.() }
  imgCache.clear()
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null }
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', clearMovementKeys)
  if (moveTimer) { clearInterval(moveTimer); moveTimer = null }
  dialogueRequest++
  town.stopTownStream()
})

async function openDialogue(resident) {
  if (showWalletPanel.value || showBoardPanel.value || worldSpot.value || lifeMoving.value) return
  if (rejectBusyDialogue(resident)) return
  const request = ++dialogueRequest
  dialogueOpening.value = true
  dialogueError.value = ''
  try {
    // The server keeps the remaining current edge and cancels subsequent waypoints.
    const result = await api.moveTownPlayerDir(0, 0)
    if (request !== dialogueRequest) return
    if (result?.ok !== true) throw new Error('Unable to stop')
    if (rejectBusyDialogue(resident)) return
    dialogueContext.value = { worldId: town.snapshot?.worldId, worldEpoch: town.snapshot?.worldEpoch, actorId: resident.actorId }
    chatResident.value = resident
    chatCharacterId.value = resident.characterId || null
    chatNpcId.value = resident.characterId ? null : resident.npcId
    chatNpcName.value = resident.displayName || '邻居'
  } catch {
    if (request === dialogueRequest) dialogueError.value = '暂时没能停下脚步，请再点一次邻居。'
  } finally {
    if (request === dialogueRequest) dialogueOpening.value = false
  }
}
function rejectBusyDialogue(resident) {
  const current = agents.value.find(agent => resident.actorId ? agent.actorId === resident.actorId
    : resident.characterId ? agent.characterId === resident.characterId : agent.npcId === resident.npcId) || resident
  if (current.busyReason !== 'SERVICE_BUSY') return false
  dialogueError.value = `${current.displayName || '这位居民'}正在提供工坊服务，请稍后再交谈。`
  return true
}
function goChat(characterId) {
  const resident = agents.value.find(agent => agent.characterId === characterId) || { characterId }
  return openDialogue(resident)
}
function closeDialogue() {
  dialogueError.value = ''
  dialogueRequest++
  dialogueOpening.value = false
  chatNpcId.value = null
  chatCharacterId.value = null
  chatResident.value = null
  dialogueContext.value = null
}
async function refreshDialogueWorld(err) {
  if (err.code !== 'TOWN_CHAT_TOO_FAR') await town.fetchState().catch(() => {})
}
async function openLinkedCharacterChat(characterId) {
  // Invitation may have changed identity after the clicked snapshot; resolve the latest actor mapping.
  const request = dialogueRequest
  try { await town.fetchState() }
  catch { dialogueError.value = '人物信息暂时未能更新，请关闭后再试。'; return }
  if (request !== dialogueRequest) return
  return goChat(characterId)
}

function openWalletPanel() {
  if (editing.value || showAdmin.value || showWizard.value || dialogueInputBlocked.value) return
  dialogueError.value = ''
  lifeMoveError.value = ''
  showWalletPanel.value = true
  refreshTownEconomy()
}
function openBoardPanel() {
  if (editing.value || showAdmin.value || showWizard.value || dialogueInputBlocked.value) return
  dialogueError.value = ''
  lifeMoveError.value = ''
  showBoardPanel.value = true
  refreshTownEconomy()
}
function openActivityPanel(actor) {
  if (!actor?.actorId || editing.value || showAdmin.value || showWizard.value || dialogueInputBlocked.value) return
  activityActorId.value = actor.actorId
}
function openDialogueActivity() {
  const actor = chatResident.value
  closeDialogue()
  openActivityPanel(actor)
}
function closeWalletPanel() {
  showWalletPanel.value = false
}
function closeBoardPanel() {
  showBoardPanel.value = false
  refreshTownEconomy()
}
function openAppointments() {
  if (!showBoardPanel.value || lifeMoving.value) return
  closeBoardPanel()
  showAppointments.value = true
}
async function moveToLifeLocation(locationKey) {
  if (!showBoardPanel.value || lifeMoving.value) return
  const request = ++lifeMoveRequest
  const current = () => !disposed && request === lifeMoveRequest
  // Keep the shared input lock until the movement command is acknowledged.
  lifeMoving.value = true
  closeBoardPanel()
  lifeMoveError.value = ''
  const location = locations.value.find(location => location.key === locationKey)
  try {
    if (!location || !Number.isInteger(location.x) || !Number.isInteger(location.y)) {
      throw new Error('这个地点暂时不可前往，请刷新小镇后再试。')
    }
    const result = await town.movePlayer(location.x, location.y)
    if (result?.ok === false) throw new Error('暂时无法前往这个地点，请稍后再试。')
  } catch (err) {
    if (current()) lifeMoveError.value = err.message || '暂时无法前往这个地点，请稍后再试。'
  } finally {
    if (current()) lifeMoving.value = false
  }
}
</script>

<style scoped>
.town-dialogue-notice { position: absolute; left: 50%; top: 80px; transform: translateX(-50%); z-index: 65; max-width: calc(100% - 32px); padding: 10px 16px; border-radius: 14px; color: #574a40; background: #f4f1eeed; font-size: 13px; }
.npc-stage { position: absolute; inset: 0; z-index: 60; overflow: clip; }
.npc-stage-enter-active, .npc-stage-leave-active { transition: opacity .3s ease; }
.npc-stage-enter-active :deep(.td-portraits figure),
.npc-stage-leave-active :deep(.td-portraits figure),
.npc-stage-enter-active :deep(.td-panel),
.npc-stage-leave-active :deep(.td-panel) {
  transition: transform .3s cubic-bezier(.22,.61,.36,1);
  will-change: transform;
}
.npc-stage-enter-from, .npc-stage-leave-to { opacity: 0; }
.npc-stage-enter-from :deep(.td-portraits figure:first-child), .npc-stage-leave-to :deep(.td-portraits figure:first-child) { transform: translateX(-64px); }
.npc-stage-enter-from :deep(.td-portraits figure:last-child), .npc-stage-leave-to :deep(.td-portraits figure:last-child) { transform: translateX(64px); }
.npc-stage-enter-from :deep(.td-panel), .npc-stage-leave-to :deep(.td-panel) { transform: translateY(40px); }
@media (prefers-reduced-motion: reduce) {
  .npc-stage-enter-active, .npc-stage-leave-active { transition-duration: .001ms; }
  .npc-stage-enter-active :deep(.td-portraits figure), .npc-stage-leave-active :deep(.td-portraits figure),
  .npc-stage-enter-active :deep(.td-panel), .npc-stage-leave-active :deep(.td-panel) { transition: none; transform: none; }
}

.town-shell { position: absolute; inset: 0; overflow: clip; container-type: size; }
.town-view {
  container: town-world / inline-size;
  position: absolute;
  inset: 0;
  overflow: clip;
  background: #dfe5d0;
}

@media (pointer: coarse) and (max-width: 900px) and (orientation: portrait) {
  .town-view {
    inset: auto;
    top: 0;
    left: 100%;
    width: 100cqh;
    height: 100cqw;
    transform-origin: 0 0;
    transform: rotate(90deg);
  }
}

.town-render-notice { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; position: absolute; bottom: 44px; left: 50%; transform: translateX(-50%); max-width: 90%; padding: 8px 14px; border-radius: 12px; background: #fffaf2; color: #796957; font-size: 12px; }
.town-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
  /* 手指落在画布上时交给我们的 pointer 逻辑处理：不滚动页面、不做浏览器手势，
     否则手势一被接管，pointermove 就断了，地图拖不动（点按仍然会派发 click）。 */
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

.town-canvas.is-hoverable { cursor: pointer; }
.town-canvas.is-editing { cursor: cell; }
.town-canvas.is-panning { cursor: grabbing; }

/* ── 进入世界时的资源就绪遮罩 ── */
.town-boot-mask {
  position: absolute;
  inset: 0;
  z-index: 1050;
  display: grid;
  place-items: center;
  background: #f7f4ef;
}

.town-boot-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(260px, calc(100% - 48px));
  text-align: center;
}

.town-boot-loader {
  position: relative;
  width: 52px;
  height: 52px;
  border: 2px solid rgba(224, 123, 108, 0.16);
  border-radius: 50%;
  animation: town-boot-spin 1.1s linear infinite;
}

.town-boot-loader::after {
  content: "";
  position: absolute;
  top: -5px;
  left: 50%;
  width: 8px;
  height: 8px;
  background: var(--accent);
  border-radius: 50%;
  transform: translateX(-50%);
}

.town-boot-title {
  margin: 22px 0 0;
  color: var(--text-bright);
  font-size: 19px;
  font-weight: 700;
  line-height: 1.35;
}

.town-boot-desc {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

@keyframes town-boot-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .town-boot-loader { animation-duration: 2.5s; }
}

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

.town-topbar-actions { display: flex; align-items: center; flex-shrink: 0; gap: 6px; }
@container town-world (max-width: 700px) {
  .town-topbar { flex-wrap: wrap; width: calc(100% - 24px); box-sizing: border-box; gap: 6px; }
  .town-chips { flex: 1; }
  .town-topbar-actions { width: 100%; flex-wrap: wrap; }
  .town-hint { max-width: calc(100% - 28px); white-space: normal; text-align: center; }
}

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
.town-hint.is-edit { bottom: 76px; }

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
  bottom: 84px;
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

.asset-viewer-mask {
  position: fixed;
  inset: 0;
  z-index: 1150;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.asset-viewer-panel {
  width: min(560px, calc(100vw - 40px));
  max-height: min(88vh, 780px);
  overflow-y: auto;
  background: #f4f1eeed;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(54, 42, 38, 0.25);
  padding: 14px;
}

.asset-viewer-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.asset-viewer-title { font-size: 14px; font-weight: 700; color: var(--text-bright); }
.asset-viewer-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }

/* ── 编辑动作 ── */
.town-editor-ui { position: absolute; inset: 0; pointer-events: none; }
.town-editor-ui > * { pointer-events: auto; }
.town-edit-actions {
  position: absolute;
  left: 50%;
  bottom: 14px;
  z-index: 40;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
}

.town-edit-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(252, 250, 247, 0.96);
  border: 1px solid rgba(232, 221, 208, 0.85);
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(54, 42, 38, 0.14);
}

.town-edit-state {
  margin-right: 2px;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-hover);
  white-space: nowrap;
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
.poi-title { font-size: 12px; font-weight: 700; color: var(--text-secondary); }

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

/* ── 遮罩与卡片（地图上的资料卡已弃用，这里只剩删除素材确认） ── */
.town-card-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.town-delete-confirm { max-width: 320px; }
.town-confirm-title { font-size: 16px; font-weight: 700; color: var(--text-bright); }
.town-confirm-text { margin: 8px 0 0; font-size: 13px; line-height: 1.6; color: var(--text-secondary); }
.town-confirm-error { margin: 8px 0 0; font-size: 12px; color: #b85343; }
.town-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }

.town-card {
  width: 300px;
  max-width: calc(100vw - 40px);
  background: #f4f1eeed;
  border-radius: 18px;
  box-shadow: 0 20px 60px rgba(54, 42, 38, 0.2);
  padding: 18px;
}

.town-modal-enter-active,
.town-modal-leave-active { transition: opacity 0.2s ease; }

.town-modal-enter-active .town-card,
.town-modal-leave-active .town-card { transition: transform 0.2s ease; }

.town-modal-enter-from,
.town-modal-leave-to { opacity: 0; }

.town-modal-enter-from .town-card,
.town-modal-leave-to .town-card { transform: scale(0.96); }

.town-editor-enter-active,
.town-editor-leave-active { transition: opacity 0.28s ease; }

.town-editor-enter-active .town-toolbar,
.town-editor-leave-active .town-toolbar,
.town-editor-enter-active .town-library,
.town-editor-leave-active .town-library,
.town-editor-enter-active .town-edit-actions,
.town-editor-leave-active .town-edit-actions,
.town-editor-enter-active .town-hint.is-edit,
.town-editor-leave-active .town-hint.is-edit { transition: opacity 0.28s ease, transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1); }

.town-editor-enter-from,
.town-editor-leave-to { opacity: 0; }

.town-editor-enter-from .town-toolbar,
.town-editor-leave-to .town-toolbar { transform: translateX(16px); }

.town-editor-enter-from .town-library,
.town-editor-leave-to .town-library { transform: translateX(-16px); }

.town-editor-enter-from .town-edit-actions,
.town-editor-leave-to .town-edit-actions { transform: translate(-50%, 16px); }

.town-pop-enter-active,
.town-pop-leave-active { transition: opacity 0.24s ease, transform 0.24s cubic-bezier(0.22, 0.61, 0.36, 1); }

.town-pop-enter-from,
.town-pop-leave-to { opacity: 0; transform: translateY(8px); }

@media (max-width: 767px) {
  .town-topbar { top: 8px; padding: 6px 12px; gap: 8px; }
  .town-title { font-size: 14px; }
  .town-hint { bottom: 10px; }
  .town-library { width: 220px; }
  .town-edit-card { max-width: calc(100vw - 24px); gap: 8px; }
}

@media (prefers-reduced-motion: reduce) {
  .town-editor-enter-active,
  .town-editor-leave-active,
  .town-editor-enter-active .town-toolbar,
  .town-editor-leave-active .town-toolbar,
  .town-editor-enter-active .town-library,
  .town-editor-leave-active .town-library,
  .town-editor-enter-active .town-edit-actions,
  .town-editor-leave-active .town-edit-actions,
  .town-editor-enter-active .town-hint.is-edit,
  .town-editor-leave-active .town-hint.is-edit,
  .town-pop-enter-active,
  .town-pop-leave-active { transition-duration: 0.001ms; }
}
</style>
