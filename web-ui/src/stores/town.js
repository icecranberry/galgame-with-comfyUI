/**
 * AI 小镇（世界页）store（v2）
 *
 * 数据流：REST 全量快照（进入页面 / SSE 重连时）+ unified SSE 的 town_* 增量事件。
 * 服务端权威：本 store 只保存"移动意图"（path + speed + 服务器基准时刻），
 * 渲染层用本地时钟插值，与后端 advanceAgent 公式一致。
 *
 * v2 新增：瓦片地图载荷（layers + assets，按 version 缓存）、素材库、
 * 初始化向导状态、NPC 就地聊天；居民身份统一 agentKey（npc:{id} / char:{id} / me）。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'
import { onEvent } from './unifiedStream.js'

export const useTownStore = defineStore('town', () => {
  const snapshot = ref(null)
  const serverOffset = ref(0)      // serverTime - Date.now()
  const connected = ref(false)
  const loaded = ref(false)

  // 瓦片地图载荷（layers + assets），按 version 缓存
  const mapData = ref(null)
  const mapLoading = ref(false)
  // 素材库（编辑模式 / 管理面板用）
  const assets = ref([])
  // 初始化向导 job
  const initState = ref(null)
  // 向导布图预览载荷（结构与 mapData 同构）
  const draftPreview = ref(null)

  const map = computed(() => snapshot.value?.map ?? null)
  const locations = computed(() => snapshot.value?.locations ?? [])
  const agents = computed(() => snapshot.value?.agents ?? [])
  const player = computed(() => snapshot.value?.player ?? null)
  const weather = computed(() => snapshot.value?.weather ?? null)
  const encountersActive = computed(() => snapshot.value?.encountersActive ?? [])
  const initialized = computed(() => !!snapshot.value?.initialized)

  /** 渲染器实际使用的地图：确认前用向导预览，正式开镇后用地图载荷 */
  const renderMap = computed(() => draftPreview.value || mapData.value)

  function _findAgent(agentKey) {
    return snapshot.value?.agents.find(a => a.agentKey === agentKey) || null
  }

  function _applyMove(d) {
    const snap = snapshot.value
    if (!snap || !d) return
    // 服务器时钟 → 本地时钟
    const startedAtLocal = (d.startedAt ?? Date.now()) - serverOffset.value
    if (d.charId === 'me') {
      if (d.revision != null && d.revision <= (snap.player?.moveRevision || 0)) return
      snap.player = {
        ...snap.player,
        moveRevision: d.revision ?? snap.player?.moveRevision ?? 0,
        x: d.from?.x ?? snap.player?.x,
        y: d.from?.y ?? snap.player?.y,
        path: d.path || [],
        speed: d.speed ?? snap.player?.speed ?? 1.1,
        moveStartedAt: startedAtLocal,
      }
      return
    }
    const agent = _findAgent(d.charId)
    if (!agent) return
    agent.x = d.from?.x ?? agent.x
    agent.y = d.from?.y ?? agent.y
    agent.path = d.path || []
    agent.speed = d.speed ?? agent.speed
    agent.moveStartedAt = startedAtLocal
    if (d.path && d.path.length > 0) agent.sleeping = false
  }

  function _applyBubble(d) {
    const snap = snapshot.value
    if (!snap || !d) return
    const agent = _findAgent(d.charId)
    if (!agent) return
    if (!d.text) { agent.bubble = null; return }
    agent.bubble = {
      text: d.text,
      encounterId: d.encounterId ?? null,
      until: Date.now() + (d.ttl ?? 10) * 1000,
    }
  }

  function _applyEncounterStart(d) {
    const snap = snapshot.value
    if (!snap || !d) return
    for (const a of snap.agents) {
      if (a.agentKey === d.a || a.agentKey === d.b) a.encounterId = d.id
    }
    if (!snap.encountersActive.some(e => e.id === d.id)) {
      snap.encountersActive = [...snap.encountersActive, { id: d.id, a: d.a, b: d.b, locationId: d.locationId }]
    }
  }

  function _applyEncounterEnd(d) {
    const snap = snapshot.value
    if (!snap || !d) return
    for (const a of snap.agents) {
      if (a.encounterId === d.id) a.encounterId = null
    }
    snap.encountersActive = snap.encountersActive.filter(e => e.id !== d.id)
  }

  async function fetchState() {
    const data = await api.fetchTownState()
    serverOffset.value = (data.serverTime ?? Date.now()) - Date.now()
    // 快照里的 startedAt 是服务器时钟，换算成本地时钟供插值
    const nowLocal = Date.now()
    for (const a of data.agents) {
      if (a.path && a.path.length > 0) a.moveStartedAt = (a.startedAt ?? nowLocal) - serverOffset.value
      else a.moveStartedAt = nowLocal
      if (a.bubble) a.bubble.until = a.bubble.until - serverOffset.value
    }
    if (data.player) {
      data.player.moveStartedAt = data.player.path && data.player.path.length > 0
        ? (data.player.startedAt ?? nowLocal) - serverOffset.value
        : nowLocal
    }
    snapshot.value = data
    loaded.value = true
    connected.value = true
    // 地图版本变化才重拉瓦片载荷
    const version = data.map?.version ?? null
    if (!mapData.value || mapData.value.version !== version) {
      fetchMap(version).catch(() => {})
    }
    return data
  }

  /** 拉取瓦片地图载荷（layers + assets） */
  async function fetchMap(expectVersion = undefined) {
    if (mapLoading.value) return mapData.value
    mapLoading.value = true
    try {
      const data = await api.fetchTownMap()
      if (expectVersion !== undefined && data && data.version !== expectVersion) {
        // 拉到的版本和快照不一致：仍接受最新数据，下次快照对齐
        console.warn('[town] map version drift:', data.version, 'vs', expectVersion)
      }
      mapData.value = data
      return data
    } finally {
      mapLoading.value = false
    }
  }

  async function fetchAssets(kind = null) {
    const data = await api.fetchTownAssets(kind)
    assets.value = data.assets || []
    return assets.value
  }

  function _applyAssetUpdate(d) {
    const deleted = d.deleted != null ? assets.value.find(a => a.id === d.deleted) : null
    assets.value = assets.value.filter(a => a.id !== d.deleted)

    if (!d.asset) {
      // 精灵重绘采用“删旧建新”的旧路径时，先退回占位图，避免继续请求已删除文件。
      if (deleted?.kind === 'player' || deleted?.kind === 'npc') _scheduleAgentSpriteRefresh()
      return
    }

    // 重绘可能换 asset id（delete + create），素材需同时按 id 和业务 key 收敛。
    assets.value = assets.value.filter(a => a.id !== d.asset.id && !(a.kind === d.asset.kind && a.key === d.asset.key))
    assets.value.push(d.asset)

    if (d.asset.kind === 'player' || d.asset.kind === 'npc') _scheduleAgentSpriteRefresh()
  }

  let _agentSpriteRefreshTimer = null
  function _scheduleAgentSpriteRefresh() {
    if (_agentSpriteRefreshTimer) return
    _agentSpriteRefreshTimer = setTimeout(() => {
      _agentSpriteRefreshTimer = null
      fetchState().catch(() => {})
    }, 120)
  }

  async function fetchInitState() {
    initState.value = await api.fetchTownInitState()
    return initState.value
  }

  async function refreshDraftPreview() {
    const data = await api.fetchTownInitPreview()
    draftPreview.value = data
    return data
  }

  function clearDraftPreview() {
    draftPreview.value = null
  }

  async function movePlayer(x, y) {
    return api.moveTownPlayer(x, y)
  }

  async function movePlayerDir(dx, dy) {
    return api.moveTownPlayerDir(dx, dy)
  }

  // ── SSE 订阅（引用计数，TownView 挂载期间保持连接） ──
  let _refs = 0
  const _unsubs = []

  function startTownStream() {
    _refs++
    if (_refs > 1) return
    fetchState().catch(err => console.warn('[town] initial fetch failed:', err?.message))
    _unsubs.push(
      onEvent('connected', () => {
        connected.value = true
        fetchState().catch(() => {})
      }),
      onEvent('town_ping', () => { connected.value = true }),
      onEvent('town_move', _applyMove),
      onEvent('town_bubble', _applyBubble),
      onEvent('town_encounter_start', _applyEncounterStart),
      onEvent('town_encounter_end', _applyEncounterEnd),
      onEvent('town_map_updated', () => {
        fetchState().catch(() => {})
        fetchMap().catch(() => {})
      }),
      onEvent('town_assets_updated', (d) => {
        _applyAssetUpdate(d)
        // 素材更新影响地图渲染贴图
        if (mapData.value?.assets) {
          mapData.value.assets = mapData.value.assets.filter(a => a.id !== d.deleted)
          if (d.asset) {
            mapData.value.assets = mapData.value.assets.filter(a => a.id !== d.asset.id && !(a.kind === d.asset.kind && a.key === d.asset.key))
            mapData.value.assets.push({
              id: d.asset.id, kind: d.asset.kind, key: d.asset.key, name: d.asset.name,
              imagePath: d.asset.image_path, meta: d.asset.meta, status: d.asset.status,
            })
          }
        }
      }),
      onEvent('town_init_progress', (d) => {
        if (!initState.value) return
        initState.value = { ...initState.value, status: d.status ?? initState.value.status, progress: { ...(initState.value.progress || {}), done: d.done, total: d.total, current: d.current, stage: d.stage } }
      }),
    )
  }

  function stopTownStream() {
    _refs = Math.max(0, _refs - 1)
    if (_refs > 0) return
    while (_unsubs.length) _unsubs.pop()()
    if (_agentSpriteRefreshTimer) {
      clearTimeout(_agentSpriteRefreshTimer)
      _agentSpriteRefreshTimer = null
    }
    connected.value = false
  }

  return {
    snapshot, serverOffset, connected, loaded,
    map, locations, agents, player, weather, encountersActive, initialized,
    mapData, mapLoading, assets, initState, draftPreview, renderMap,
    fetchState, fetchMap, fetchAssets, fetchInitState, refreshDraftPreview, clearDraftPreview,
    movePlayer, movePlayerDir, startTownStream, stopTownStream,
  }
})
