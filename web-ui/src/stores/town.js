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

  // Local observation order protects SSE movement received during an HTTP read.
  // This is not a server revision and cannot detect independently reordered SSE.
  let _moveGeneration = 0
  const _agentMoveGenerations = new Map()

  function _acceptWorldEvent(d) {
    if (d?.worldEpoch == null || snapshot.value?.worldEpoch == null) return true
    if (d.worldId !== snapshot.value.worldId || d.worldEpoch !== snapshot.value.worldEpoch) {
      if (d.worldId !== snapshot.value.worldId || d.worldEpoch > snapshot.value.worldEpoch) _scheduleAgentSpriteRefresh()
      return false
    }
    return true
  }

  function _applyMove(d) {
    const snap = snapshot.value
    if (!snap || !d || !_acceptWorldEvent(d)) return
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
    _agentMoveGenerations.set(d.charId, ++_moveGeneration)
    agent.x = d.from?.x ?? agent.x
    agent.y = d.from?.y ?? agent.y
    agent.path = d.path || []
    agent.speed = d.speed ?? agent.speed
    agent.moveStartedAt = startedAtLocal
    if (d.path && d.path.length > 0) agent.sleeping = false
  }

  function _applyBubble(d) {
    const snap = snapshot.value
    if (!snap || !d || !_acceptWorldEvent(d)) return
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
    if (!snap || !d || !_acceptWorldEvent(d)) return
    for (const a of snap.agents) {
      if (a.agentKey === d.a || a.agentKey === d.b) a.encounterId = d.id
    }
    if (!snap.encountersActive.some(e => e.id === d.id)) {
      snap.encountersActive = [...snap.encountersActive, { id: d.id, a: d.a, b: d.b, locationId: d.locationId }]
    }
  }

  function _applyEncounterEnd(d) {
    const snap = snapshot.value
    if (!snap || !d || !_acceptWorldEvent(d)) return
    if (d.removed) snap.agents = snap.agents.filter(a => a.agentKey !== d.removed)
    for (const a of snap.agents) {
      if (a.encounterId === d.id) a.encounterId = null
    }
    snap.encountersActive = snap.encountersActive.filter(e => e.id !== d.id)
  }

  let _stateRequest = 0
  let _lastStateRefreshAt = -Infinity
  async function fetchState() {
    _lastStateRefreshAt = Date.now()
    const request = ++_stateRequest
    const moveBoundary = _moveGeneration
    const data = await api.fetchTownState()
    if (request !== _stateRequest) return snapshot.value
    const sameWorld = snapshot.value?.worldId === data.worldId && snapshot.value?.worldEpoch === data.worldEpoch
    if (!sameWorld) {
      ++_mapRequest
      ++_assetRequest
      ++_initRequest
      ++_previewRequest
      _agentMoveGenerations.clear()
      mapLoading.value = false
      mapData.value = null
      assets.value = []
      draftPreview.value = null
      initState.value = null
    }
    serverOffset.value = (data.serverTime ?? Date.now()) - Date.now()
    // 快照里的 startedAt 是服务器时钟，换算成本地时钟供插值
    const nowLocal = Date.now()
    for (const a of data.agents) {
      if (a.path && a.path.length > 0) a.moveStartedAt = (a.startedAt ?? nowLocal) - serverOffset.value
      else a.moveStartedAt = nowLocal
      if (a.bubble) a.bubble.until = a.bubble.until - serverOffset.value
      if (sameWorld && (_agentMoveGenerations.get(a.agentKey) || 0) > moveBoundary) {
        const current = _findAgent(a.agentKey)
        if (current && (!a.actorId || !current.actorId || a.actorId === current.actorId)) {
          // Keep fresh snapshot metadata, but retain the move received after
          // this request started, including an explicit empty-path stop.
          for (const key of ['x', 'y', 'path', 'speed', 'moveStartedAt', 'sleeping']) a[key] = current[key]
        }
      }
    }
    if (data.player) {
      data.player.moveStartedAt = data.player.path && data.player.path.length > 0
        ? (data.player.startedAt ?? nowLocal) - serverOffset.value
        : nowLocal
      if (sameWorld && (snapshot.value?.player?.moveRevision || 0) > (data.player.moveRevision || 0)) {
        data.player = snapshot.value.player
      }
    }
    snapshot.value = data
    loaded.value = true
    connected.value = true
    // 地图版本变化才重拉瓦片载荷
    const version = data.map?.version ?? null
    if (!data.map) mapData.value = null
    else if (!mapData.value || mapData.value.id !== data.map.id || mapData.value.version !== version) {
      fetchMap(version).catch(() => {})
    }
    return data
  }

  /** 拉取瓦片地图载荷（layers + assets） */
  let _mapRequest = 0, _assetRequest = 0
  const worldKey = () => JSON.stringify([snapshot.value?.worldId, snapshot.value?.worldEpoch])
  async function fetchMap(expectVersion = undefined) {
    const request = ++_mapRequest, scope = worldKey()
    mapLoading.value = true
    try {
      const data = await api.fetchTownMap()
      if (request !== _mapRequest || scope !== worldKey()) return mapData.value
      if (expectVersion !== undefined && data && data.version !== expectVersion) {
        // 拉到的版本和快照不一致：仍接受最新数据，下次快照对齐
        console.warn('[town] map version drift:', data.version, 'vs', expectVersion)
      }
      mapData.value = data
      return data
    } finally {
      if (request === _mapRequest) mapLoading.value = false
    }
  }

  async function fetchAssets(kind = null) {
    const request = ++_assetRequest, scope = worldKey()
    const data = await api.fetchTownAssets(kind)
    if (request !== _assetRequest || scope !== worldKey()) return assets.value
    assets.value = data.assets || []
    return assets.value
  }

  function _applyAssetUpdate(d) {
    const deleted = d.deleted != null ? assets.value.find(a => a.id === d.deleted) : null
    assets.value = assets.value.filter(a => a.id !== d.deleted)
    if (d.deleted != null) _scrubDeletedAssetFromLayers(d.deleted)

    if (!d.asset) {
      // spirit重绘采用“删旧建新”的旧路径时，先退回占位图，避免继续请求已删除文件。
      if (deleted?.kind === 'player' || deleted?.kind === 'npc') _scheduleAgentSpriteRefresh()
      return
    }

    // 重绘可能换 asset id（delete + create），素材需同时按 id 和业务 key 收敛。
    assets.value = assets.value.filter(a => a.id !== d.asset.id && !(a.kind === d.asset.kind && a.key === d.asset.key))
    assets.value.push(d.asset)

    if (d.asset.kind === 'player' || d.asset.kind === 'npc') _scheduleAgentSpriteRefresh()
  }

  // 素材删除后同步清掉当前地图图层里的引用（悬空对象渲染成白块、悬空地砖渲染成黑洞）：
  // 后端会持久化清理并广播地图更新，这里让本端在重取落地前就先干净。地面格回填最常见的剩余地砖。
  function _scrubDeletedAssetFromLayers(assetId) {
    const layers = mapData.value?.layers
    if (!layers || assetId == null) return
    const ground = layers.ground
    if (Array.isArray(ground)) {
      const cleared = []
      for (let y = 0; y < ground.length; y++) {
        const row = ground[y]
        if (!Array.isArray(row)) continue
        for (let x = 0; x < row.length; x++) {
          if (row[x] === assetId) { row[x] = null; cleared.push([x, y]) }
        }
      }
      if (cleared.length) {
        const counts = new Map()
        for (const row of ground) for (const id of row || []) if (id != null) counts.set(id, (counts.get(id) || 0) + 1)
        const dominant = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
        if (dominant != null) for (const [x, y] of cleared) ground[y][x] = dominant
      }
    }
    const road = layers.road
    if (Array.isArray(road)) for (const row of road) if (Array.isArray(row)) for (let x = 0; x < row.length; x++) if (row[x] === assetId) row[x] = null
    if (Array.isArray(layers.objects)) layers.objects = layers.objects.filter(o => o?.assetId !== assetId)
  }

  let _agentSpriteRefreshTimer = null
  function _scheduleAgentSpriteRefresh() {
    if (_agentSpriteRefreshTimer) return
    _agentSpriteRefreshTimer = setTimeout(() => {
      _agentSpriteRefreshTimer = null
      if (_refs > 0) fetchState().catch(() => {})
    }, 120)
  }

  let _initRequest = 0, _previewRequest = 0
  async function fetchInitState() {
    const request = ++_initRequest, scope = worldKey()
    const data = await api.fetchTownInitState()
    if (request !== _initRequest || scope !== worldKey()) return initState.value
    initState.value = data
    return initState.value
  }

  async function refreshDraftPreview() {
    const request = ++_previewRequest, scope = worldKey()
    const data = await api.fetchTownInitPreview()
    if (request !== _previewRequest || scope !== worldKey()) return draftPreview.value
    draftPreview.value = data
    return data
  }

  function clearDraftPreview() {
    ++_previewRequest
    ++_initRequest
    draftPreview.value = null
  }

  async function movePlayer(x, y) {
    const { worldId, worldEpoch } = snapshot.value || {}
    if (typeof worldId !== 'string' || !worldId.trim() || !Number.isSafeInteger(worldEpoch) || worldEpoch < 1) {
      throw Object.assign(new Error('请等待小镇加载后再移动'), { code: 'INVALID_WORLD_SCOPE' })
    }
    return api.moveTownPlayer(x, y, { worldId, worldEpoch })
  }

  async function movePlayerDir(dx, dy) {
    const { worldId, worldEpoch } = snapshot.value || {}
    if (typeof worldId !== 'string' || !worldId.trim() || !Number.isSafeInteger(worldEpoch) || worldEpoch < 1) {
      throw Object.assign(new Error('请等待小镇加载后再移动'), { code: 'INVALID_WORLD_SCOPE' })
    }
    return api.moveTownPlayerDir(dx, dy, { worldId, worldEpoch })
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
      onEvent('town_ping', (data) => {
        if (_refs <= 0 || typeof data?.serverTime !== 'number' || !Number.isFinite(data.serverTime)) return
        const now = Date.now(), elapsed = now - _lastStateRefreshAt
        connected.value = true
        serverOffset.value = data.serverTime - now
        // Legacy ticks only ping. Reuse the shared debounce, bounded to one
        // ping-triggered read per minute; ordinary state notifications bypass it.
        if (elapsed < 0 || elapsed >= 60_000) _scheduleAgentSpriteRefresh()
      }),
      onEvent('town_state_updated', (d) => {
        if (d?.reason === 'world_reset') {
          ++_stateRequest; ++_mapRequest; ++_assetRequest; ++_initRequest; ++_previewRequest
          _agentMoveGenerations.clear()
          snapshot.value = null; mapData.value = null; assets.value = []; draftPreview.value = null
          initState.value = null; mapLoading.value = false
        }
        _scheduleAgentSpriteRefresh()
      }),
      onEvent('town_move', _applyMove),
      onEvent('town_bubble', _applyBubble),
      onEvent('town_encounter_start', _applyEncounterStart),
      onEvent('town_encounter_end', _applyEncounterEnd),
      onEvent('town_map_updated', (d) => {
        if (!_acceptWorldEvent(d)) return
        mapData.value = null
        fetchState().catch(() => {})
        fetchMap(d?.version).catch(() => {})
      }),
      onEvent('town_assets_updated', (d) => {
        if (!_acceptWorldEvent(d)) return
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
    ++_stateRequest
    ++_mapRequest
    ++_assetRequest
    ++_initRequest
    ++_previewRequest
    _agentMoveGenerations.clear()
    mapLoading.value = false
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
